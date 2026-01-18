import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, AuthError } from "@/lib/auth";
import { parseFile, isSupported, getPageCount } from "@/lib/file-parser";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment, EXTRACTION_VERSION } from "@/lib/classifier";
import { VerificationWarning, CustomerProfile } from "@/lib/types";
import { hashBuffer } from "@/lib/hash";
import { enforceRateLimit, RateLimits, RateLimitExceededError } from "@/lib/rate-limiter";
import { withIdempotency, hashRequestPayload } from "@/lib/idempotency";
import { logLLMUsage } from "@/lib/llm-usage";

// Configurable limits from environment
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_PDF_PAGES = parseInt(process.env.MAX_PDF_PAGES || "20", 10);
const DEDUPE_WINDOW_DAYS = parseInt(process.env.DEDUPE_WINDOW_DAYS || "7", 10);

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customerId = formData.get("customer_id") as string | null;
    const idempotencyKey = request.headers.get("Idempotency-Key");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!isSupported(file.name)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, DOCX, or TXT files." },
        { status: 400 }
      );
    }

    // Check file size limit
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { 
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
          max_size_mb: MAX_FILE_SIZE_MB,
          file_size_mb: Math.round(file.size / 1024 / 1024 * 100) / 100,
        },
        { status: 413 }
      );
    }

    // Enforce rate limit
    await enforceRateLimit(
      authUser.user.id,
      "/api/tenders/upload",
      RateLimits.extraction
    );

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Compute file hash for deduplication
    const fileHash = hashBuffer(buffer);

    // Check for duplicate file (same hash + customer within window)
    // Note: Deduplication works with or without customer - NULL customer_id matches NULL
    const serviceClient = createServiceClient();
    const { data: existingTenderId } = await serviceClient.rpc(
      "find_duplicate_tender_by_file_hash",
      {
        p_customer_id: customerId || null,
        p_file_hash: fileHash,
        p_window_days: DEDUPE_WINDOW_DAYS,
      }
    );

    if (existingTenderId) {
      console.log(`[Upload] Duplicate detected: ${existingTenderId}`);
      return NextResponse.json(
        {
          id: existingTenderId,
          deduped: true,
          message: `Duplicate file detected. Returning existing tender from the last ${DEDUPE_WINDOW_DAYS} days.`,
        },
        { status: 200 }
      );
    }

    // Check PDF page count before full parsing
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const pageCount = await getPageCount(buffer);
      if (pageCount && pageCount > MAX_PDF_PAGES) {
        return NextResponse.json(
          {
            error: `PDF has too many pages. Maximum is ${MAX_PDF_PAGES} pages.`,
            max_pages: MAX_PDF_PAGES,
            page_count: pageCount,
          },
          { status: 422 }
        );
      }
    }

    // Parse file to extract text
    let parseResult;
    try {
      parseResult = await parseFile(buffer, file.name);
    } catch (parseError) {
      console.error("File parsing error:", parseError);
      return NextResponse.json(
        {
          error:
            parseError instanceof Error
              ? parseError.message
              : "Failed to parse file",
        },
        { status: 400 }
      );
    }

    const { text: extractedText, metadata: parseMetadata } = parseResult;

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json(
        { error: "No text could be extracted from the file" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch customer profile if provided
    let customerProfile: CustomerProfile | null = null;
    if (customerId) {
      const { data } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", customerId)
        .single();
      customerProfile = data as CustomerProfile | null;
      console.log(`[Upload] Customer profile loaded: ${customerProfile?.name}`);
      console.log(`[Upload] Customer cargo_hints: ${JSON.stringify(customerProfile?.cargo_hints)}`);
    } else {
      console.log(`[Upload] No customer selected - no cargo defaults will be applied`);
    }

    // 1. Upload original file to Supabase Storage (private bucket)
    let fileUrl: string | null = null;
    let filePath: string | null = null;
    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("tender-files")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("File upload error:", uploadError);
      // Don't fail the request - continue without storing the file
    } else {
      // Store the path for signed URL generation (private storage)
      filePath = uploadData.path;
      
      // Also get public URL for backwards compatibility (if bucket is public)
      const { data: urlData } = supabase.storage
        .from("tender-files")
        .getPublicUrl(uploadData.path);
      fileUrl = urlData.publicUrl;
    }

    // Execute the upload with idempotency
    const executeUpload = async () => {
      // 2. Create tender with file hash
      const { data: tender, error: tenderError } = await supabase
        .from("tenders")
        .insert({
          source_type: "file",
          original_text: extractedText.trim(),
          original_file_url: fileUrl,
          original_file_path: filePath,
          customer_id: customerId || null,
          status: "draft",
          file_hash: fileHash,
          created_by: authUser.user.id,
        })
        .select("id")
        .single();

      if (tenderError) {
        console.error("Supabase tender error:", tenderError);
        throw new Error("Failed to create tender");
      }

      // 3. Run deterministic extraction with customer profile
      const extractionResult = extractCandidates(extractedText, { customerProfile });

      // 4. Run LLM classification with verification + normalization
      let llmOutput = null;
      let verificationWarnings: VerificationWarning[] = [];
      let normalizationMetadata = null;
      let fieldProvenance = null;
      let llmUsage = null;
      let extractionRunId: string | null = null;

      const llmStartTime = Date.now();
      try {
        const verifiedResult = await classifyAndVerifyShipment({
          originalText: extractedText,
          candidates: extractionResult.candidates,
          customerProfile,
        });
        llmOutput = verifiedResult.shipment;
        verificationWarnings = verifiedResult.warnings;
        normalizationMetadata = verifiedResult.normalization;
        fieldProvenance = verifiedResult.provenance;
        llmUsage = verifiedResult.usage;
      } catch (llmError) {
        console.error("LLM classification error:", llmError);
        // Log failed LLM attempt
        await logLLMUsage({
          tenderId: tender.id,
          route: "/api/tenders/upload",
          operation: "classify",
          model: "gpt-4o-mini",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - llmStartTime,
          parserType: parseMetadata.file_type as "pdf" | "docx" | "txt",
          inputTextLength: extractedText.length,
          inputCandidatesCount: extractionResult.candidates.length,
          success: false,
          errorMessage: llmError instanceof Error ? llmError.message : "Unknown error",
          extractionVersion: EXTRACTION_VERSION,
          userId: authUser.user.id,
          customerId: customerId || undefined,
        });
      }

      // 5. Store extraction run
      const { data: extractionRun, error: extractionError } = await supabase
        .from("extraction_runs")
        .insert({
          tender_id: tender.id,
          candidates: extractionResult.candidates,
          metadata: {
            ...extractionResult.metadata,
            file_name: file.name,
            file_type: parseMetadata.file_type,
            page_count: parseMetadata.page_count,
            word_count: parseMetadata.word_count,
            verification_warnings: verificationWarnings,
            field_provenance: fieldProvenance,
            normalization: normalizationMetadata,
            extraction_version: EXTRACTION_VERSION,
          },
          llm_output: llmOutput,
          created_by: authUser.user.id,
        })
        .select("id")
        .single();

      if (extractionError) {
        console.error("Supabase extraction error:", extractionError);
      } else {
        extractionRunId = extractionRun?.id;
      }

      // Log successful LLM usage
      if (llmUsage) {
        await logLLMUsage({
          tenderId: tender.id,
          extractionRunId: extractionRunId || undefined,
          route: "/api/tenders/upload",
          operation: "classify",
          model: llmUsage.model,
          promptTokens: llmUsage.promptTokens,
          completionTokens: llmUsage.completionTokens,
          totalTokens: llmUsage.totalTokens,
          durationMs: llmUsage.durationMs,
          parserType: parseMetadata.file_type as "pdf" | "docx" | "txt",
          inputTextLength: extractedText.length,
          inputCandidatesCount: extractionResult.candidates.length,
          outputStopsCount: llmOutput?.stops?.length || 0,
          outputRefsCount: llmOutput?.reference_numbers?.length || 0,
          warningsCount: verificationWarnings.length,
          success: true,
          extractionVersion: EXTRACTION_VERSION,
          userId: authUser.user.id,
          customerId: customerId || undefined,
        });
      }

      // 6. Update tender status
      const newStatus = verificationWarnings.length > 0 ? "needs_review" : "extracted";
      await supabase
        .from("tenders")
        .update({ status: newStatus, updated_by: authUser.user.id })
        .eq("id", tender.id);

      return {
        id: tender.id,
        file_name: file.name,
        file_url: fileUrl,
        text_length: extractedText.length,
        word_count: parseMetadata.word_count,
        candidates_count: extractionResult.candidates.length,
        has_llm_output: llmOutput !== null,
      };
    };

    // Use idempotency wrapper if key provided, or generate deterministic key
    const effectiveIdempotencyKey = idempotencyKey || `upload-${fileHash}-${customerId || "none"}`;
    
    const idempotencyResult = await withIdempotency(
      effectiveIdempotencyKey,
      authUser.user.id,
      "/api/tenders/upload",
      { file_hash: fileHash, customer_id: customerId },
      executeUpload
    );

    if ("conflict" in idempotencyResult) {
      return NextResponse.json(
        { error: idempotencyResult.message },
        { status: 409 }
      );
    }

    const { response, fromCache } = idempotencyResult;

    return NextResponse.json(
      { ...response, cached: fromCache },
      { status: fromCache ? 200 : 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message, retry_after: err.retryAfter },
        { status: 429, headers: { "Retry-After": String(err.retryAfter) } }
      );
    }
    console.error("Upload API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
