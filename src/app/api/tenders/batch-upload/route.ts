import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, AuthError } from "@/lib/auth";
import { parseFile, isSupported, getPageCount } from "@/lib/file-parser";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment, EXTRACTION_VERSION } from "@/lib/classifier";
import { VerificationWarning, CustomerProfile, BatchItemState } from "@/lib/types";
import { hashBuffer } from "@/lib/hash";
import { logLLMUsage } from "@/lib/llm-usage";

// Configurable limits from environment
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_PDF_PAGES = parseInt(process.env.MAX_PDF_PAGES || "20", 10);
const DEDUPE_WINDOW_DAYS = parseInt(process.env.DEDUPE_WINDOW_DAYS || "7", 10);
const BATCH_MAX_FILES = parseInt(process.env.BATCH_MAX_FILES || "10", 10);

interface ProcessFileResult {
  tender_id: string;
  file_name: string;
  state: BatchItemState;
  deduped: boolean;
  error_message?: string;
  tender_status?: string;
}

/**
 * Process a single file and return the tender info.
 * Reuses most of the single upload logic.
 */
async function processSingleFile(
  file: File,
  customerId: string | null,
  userId: string,
  customerProfile: CustomerProfile | null,
  supabase: ReturnType<typeof createServerClient>,
  serviceClient: ReturnType<typeof createServiceClient>
): Promise<ProcessFileResult> {
  const fileName = file.name;

  // Check file type
  if (!isSupported(fileName)) {
    return {
      tender_id: "",
      file_name: fileName,
      state: "failed",
      deduped: false,
      error_message: "Unsupported file type. Please upload PDF, DOCX, or TXT files.",
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      tender_id: "",
      file_name: fileName,
      state: "failed",
      deduped: false,
      error_message: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
    };
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Compute file hash for deduplication
  const fileHash = hashBuffer(buffer);

  // Check for duplicate file
  if (customerId) {
    const { data: existingTenderId } = await serviceClient.rpc(
      "find_duplicate_tender_by_file_hash",
      {
        p_customer_id: customerId,
        p_file_hash: fileHash,
        p_window_days: DEDUPE_WINDOW_DAYS,
      }
    );

    if (existingTenderId) {
      console.log(`[BatchUpload] Duplicate detected for ${fileName}: ${existingTenderId}`);
      
      // Check if the existing tender is already reviewed
      const { data: existingTender } = await supabase
        .from("tenders")
        .select("status")
        .eq("id", existingTenderId)
        .single();
      
      const state: BatchItemState = existingTender?.status === "reviewed" ? "reviewed" : "needs_review";
      
      return {
        tender_id: existingTenderId,
        file_name: fileName,
        state,
        deduped: true,
        tender_status: existingTender?.status,
      };
    }
  }

  // Check PDF page count
  if (fileName.toLowerCase().endsWith(".pdf")) {
    const pageCount = await getPageCount(buffer);
    if (pageCount && pageCount > MAX_PDF_PAGES) {
      return {
        tender_id: "",
        file_name: fileName,
        state: "failed",
        deduped: false,
        error_message: `PDF has too many pages. Maximum is ${MAX_PDF_PAGES} pages.`,
      };
    }
  }

  // Parse file to extract text
  let parseResult;
  try {
    parseResult = await parseFile(buffer, fileName);
  } catch (parseError) {
    console.error(`[BatchUpload] File parsing error for ${fileName}:`, parseError);
    return {
      tender_id: "",
      file_name: fileName,
      state: "failed",
      deduped: false,
      error_message: parseError instanceof Error ? parseError.message : "Failed to parse file",
    };
  }

  const { text: extractedText, metadata: parseMetadata } = parseResult;

  if (!extractedText || extractedText.trim().length === 0) {
    return {
      tender_id: "",
      file_name: fileName,
      state: "failed",
      deduped: false,
      error_message: "No text could be extracted from the file",
    };
  }

  // Upload original file to Supabase Storage
  let fileUrl: string | null = null;
  let filePath: string | null = null;
  const fileExt = fileName.split(".").pop();
  const storageName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("tender-files")
    .upload(storageName, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error(`[BatchUpload] File upload error for ${fileName}:`, uploadError);
  } else {
    filePath = uploadData.path;
    const { data: urlData } = supabase.storage
      .from("tender-files")
      .getPublicUrl(uploadData.path);
    fileUrl = urlData.publicUrl;
  }

  // Create tender
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
      created_by: userId,
    })
    .select("id")
    .single();

  if (tenderError || !tender) {
    console.error(`[BatchUpload] Tender creation error for ${fileName}:`, tenderError);
    return {
      tender_id: "",
      file_name: fileName,
      state: "failed",
      deduped: false,
      error_message: "Failed to create tender",
    };
  }

  // Run extraction
  const extractionResult = extractCandidates(extractedText, { customerProfile });

  // Run LLM classification
  let llmOutput = null;
  let verificationWarnings: VerificationWarning[] = [];
  let normalizationMetadata = null;
  let fieldProvenance = null;
  let llmUsage = null;
  let extractionRunId: string | null = null;
  let extractionFailed = false;

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
    console.error(`[BatchUpload] LLM classification error for ${fileName}:`, llmError);
    extractionFailed = true;
    
    await logLLMUsage({
      tenderId: tender.id,
      route: "/api/tenders/batch-upload",
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
      userId,
      customerId: customerId || undefined,
    });
  }

  // Store extraction run
  const { data: extractionRun, error: extractionError } = await supabase
    .from("extraction_runs")
    .insert({
      tender_id: tender.id,
      candidates: extractionResult.candidates,
      metadata: {
        ...extractionResult.metadata,
        file_name: fileName,
        file_type: parseMetadata.file_type,
        page_count: parseMetadata.page_count,
        word_count: parseMetadata.word_count,
        verification_warnings: verificationWarnings,
        field_provenance: fieldProvenance,
        normalization: normalizationMetadata,
        extraction_version: EXTRACTION_VERSION,
      },
      llm_output: llmOutput,
      created_by: userId,
    })
    .select("id")
    .single();

  if (extractionError) {
    console.error(`[BatchUpload] Extraction run error for ${fileName}:`, extractionError);
  } else {
    extractionRunId = extractionRun?.id;
  }

  // Log successful LLM usage
  if (llmUsage) {
    await logLLMUsage({
      tenderId: tender.id,
      extractionRunId: extractionRunId || undefined,
      route: "/api/tenders/batch-upload",
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
      userId,
      customerId: customerId || undefined,
    });
  }

  // Determine state based on extraction result
  let state: BatchItemState;
  let tenderStatus: string;
  
  if (extractionFailed) {
    state = "failed";
    tenderStatus = "draft";
  } else if (verificationWarnings.length > 0) {
    state = "needs_review";
    tenderStatus = "needs_review";
  } else {
    state = "needs_review"; // Still needs review even without warnings
    tenderStatus = "extracted";
  }

  // Update tender status
  await supabase
    .from("tenders")
    .update({ status: tenderStatus, updated_by: userId })
    .eq("id", tender.id);

  return {
    tender_id: tender.id,
    file_name: fileName,
    state,
    deduped: false,
    tender_status: tenderStatus,
    error_message: extractionFailed ? "LLM classification failed" : undefined,
  };
}

/**
 * POST /api/tenders/batch-upload
 * 
 * Upload multiple files and create a batch for sequential review.
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth();
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const customerId = formData.get("customer_id") as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (files.length > BATCH_MAX_FILES) {
      return NextResponse.json(
        {
          error: `Too many files. Maximum is ${BATCH_MAX_FILES} files per batch.`,
          max_files: BATCH_MAX_FILES,
          provided_files: files.length,
        },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const serviceClient = createServiceClient();

    // Fetch customer profile if provided
    let customerProfile: CustomerProfile | null = null;
    if (customerId) {
      const { data } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", customerId)
        .single();
      customerProfile = data as CustomerProfile | null;
      console.log(`[BatchUpload] Customer profile loaded: ${customerProfile?.name}`);
    }

    // Create the batch
    const { data: batch, error: batchError } = await supabase
      .from("tender_batches")
      .insert({
        created_by: authUser.user.id,
        customer_id: customerId || null,
        status: "active",
        current_index: 0,
        total_items: files.length,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      console.error("[BatchUpload] Batch creation error:", batchError);
      return NextResponse.json(
        { error: "Failed to create batch" },
        { status: 500 }
      );
    }

    console.log(`[BatchUpload] Created batch ${batch.id} with ${files.length} files`);

    // Process files sequentially (concurrency = 1 for rate limit safety)
    const items: Array<{
      position: number;
      tender_id: string;
      file_name: string;
      state: BatchItemState;
      deduped: boolean;
      error_message?: string;
    }> = [];

    let firstTenderId: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[BatchUpload] Processing file ${i + 1}/${files.length}: ${file.name}`);

      const result = await processSingleFile(
        file,
        customerId,
        authUser.user.id,
        customerProfile,
        supabase,
        serviceClient
      );

      // Create batch item
      // For failed items with no tender_id, we still need a placeholder
      // We'll create a "failed" tender entry or skip the tender_id
      let itemTenderId = result.tender_id;
      
      if (!itemTenderId && result.state === "failed") {
        // Create a placeholder tender for tracking
        const { data: placeholderTender, error: placeholderError } = await supabase
          .from("tenders")
          .insert({
            source_type: "file",
            original_text: `[Failed to process: ${result.file_name}]`,
            customer_id: customerId || null,
            status: "draft",
            created_by: authUser.user.id,
          })
          .select("id")
          .single();

        if (!placeholderError && placeholderTender) {
          itemTenderId = placeholderTender.id;
        } else {
          // Skip this item if we can't create a placeholder
          console.error(`[BatchUpload] Failed to create placeholder for ${result.file_name}`);
          continue;
        }
      }

      // Insert batch item
      const { error: itemError } = await supabase
        .from("tender_batch_items")
        .insert({
          batch_id: batch.id,
          tender_id: itemTenderId,
          file_name: result.file_name,
          source_type: "file",
          position: i,
          state: result.state,
          deduped: result.deduped,
          error_message: result.error_message || null,
        });

      if (itemError) {
        console.error(`[BatchUpload] Batch item creation error for ${result.file_name}:`, itemError);
      }

      items.push({
        position: i,
        tender_id: itemTenderId,
        file_name: result.file_name,
        state: result.state,
        deduped: result.deduped,
        error_message: result.error_message,
      });

      // Track first reviewable tender
      if (!firstTenderId && result.state !== "failed" && result.state !== "reviewed") {
        firstTenderId = itemTenderId;
      }
    }

    console.log(`[BatchUpload] Batch ${batch.id} complete. First tender: ${firstTenderId}`);

    return NextResponse.json(
      {
        batch_id: batch.id,
        items,
        first_tender_id: firstTenderId,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[BatchUpload] API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
