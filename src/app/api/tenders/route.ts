import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, AuthError } from "@/lib/auth";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment, EXTRACTION_VERSION } from "@/lib/classifier";
import { VerificationWarning, CustomerProfile } from "@/lib/types";
import { hashText } from "@/lib/hash";
import { enforceRateLimit, RateLimits, RateLimitExceededError } from "@/lib/rate-limiter";
import { withIdempotency } from "@/lib/idempotency";
import { logLLMUsage } from "@/lib/llm-usage";

const DEDUPE_WINDOW_DAYS = parseInt(process.env.DEDUPE_WINDOW_DAYS || "7", 10);

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth();
    const body = await request.json();
    const { source_type, original_text, customer_id } = body;
    const idempotencyKey = request.headers.get("Idempotency-Key");

    // Validate required fields
    if (!source_type || !original_text) {
      return NextResponse.json(
        { error: "source_type and original_text are required" },
        { status: 400 }
      );
    }

    if (source_type !== "paste" && source_type !== "file") {
      return NextResponse.json(
        { error: "source_type must be 'paste' or 'file'" },
        { status: 400 }
      );
    }

    if (typeof original_text !== "string" || original_text.trim().length === 0) {
      return NextResponse.json(
        { error: "original_text must be a non-empty string" },
        { status: 400 }
      );
    }

    // Enforce rate limit
    await enforceRateLimit(
      authUser.user.id,
      "/api/tenders",
      RateLimits.extraction
    );

    const supabase = createServerClient();
    const trimmedText = original_text.trim();

    // Compute text hash for deduplication
    const textHash = hashText(trimmedText);

    // Check for duplicate text (works with or without customer - NULL matches NULL)
    const serviceClient = createServiceClient();
    const { data: existingTenderId } = await serviceClient.rpc(
      "find_duplicate_tender_by_text_hash",
      {
        p_customer_id: customer_id || null,
        p_text_hash: textHash,
        p_window_days: DEDUPE_WINDOW_DAYS,
      }
    );

    if (existingTenderId) {
      console.log(`[Paste] Duplicate detected: ${existingTenderId}`);
      return NextResponse.json(
        {
          id: existingTenderId,
          deduped: true,
          message: `Duplicate text detected. Returning existing tender from the last ${DEDUPE_WINDOW_DAYS} days.`,
        },
        { status: 200 }
      );
    }

    // Fetch customer profile if provided
    let customerProfile: CustomerProfile | null = null;
    if (customer_id) {
      const { data } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", customer_id)
        .single();
      customerProfile = data as CustomerProfile | null;
    }

    // Execute with idempotency
    const executePaste = async () => {
      // 1. Create tender with text hash
      const { data: tender, error: tenderError } = await supabase
        .from("tenders")
        .insert({
          source_type,
          original_text: trimmedText,
          customer_id: customer_id || null,
          text_hash: textHash,
          created_by: authUser.user.id,
        })
        .select("id")
        .single();

      if (tenderError) {
        console.error("Supabase tender error:", tenderError);
        throw new Error("Failed to create tender");
      }

      // 2. Run deterministic extraction with customer profile
      const extractionResult = extractCandidates(trimmedText, { customerProfile });

      // 3. Run LLM classification with verification + normalization
      let llmOutput = null;
      let verificationWarnings: VerificationWarning[] = [];
      let normalizationMetadata = null;
      let fieldProvenance = null;
      let llmUsage = null;
      let extractionRunId: string | null = null;

      const llmStartTime = Date.now();
      try {
        const verifiedResult = await classifyAndVerifyShipment({
          originalText: trimmedText,
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
        // Log failed attempt
        await logLLMUsage({
          tenderId: tender.id,
          route: "/api/tenders",
          operation: "classify",
          model: "gpt-4o-mini",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - llmStartTime,
          parserType: "paste",
          inputTextLength: trimmedText.length,
          inputCandidatesCount: extractionResult.candidates.length,
          success: false,
          errorMessage: llmError instanceof Error ? llmError.message : "Unknown error",
          extractionVersion: EXTRACTION_VERSION,
          userId: authUser.user.id,
          customerId: customer_id || undefined,
        });
      }

      // 4. Store extraction run
      const { data: extractionRun, error: extractionError } = await supabase
        .from("extraction_runs")
        .insert({
          tender_id: tender.id,
          candidates: extractionResult.candidates,
          metadata: {
            ...extractionResult.metadata,
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
          route: "/api/tenders",
          operation: "classify",
          model: llmUsage.model,
          promptTokens: llmUsage.promptTokens,
          completionTokens: llmUsage.completionTokens,
          totalTokens: llmUsage.totalTokens,
          durationMs: llmUsage.durationMs,
          parserType: "paste",
          inputTextLength: trimmedText.length,
          inputCandidatesCount: extractionResult.candidates.length,
          outputStopsCount: llmOutput?.stops?.length || 0,
          outputRefsCount: llmOutput?.reference_numbers?.length || 0,
          warningsCount: verificationWarnings.length,
          success: true,
          extractionVersion: EXTRACTION_VERSION,
          userId: authUser.user.id,
          customerId: customer_id || undefined,
        });
      }

      // Update status
      const newStatus = verificationWarnings.length > 0 ? "needs_review" : "extracted";
      await supabase
        .from("tenders")
        .update({ status: newStatus, updated_by: authUser.user.id })
        .eq("id", tender.id);

      return {
        id: tender.id,
        candidates_count: extractionResult.candidates.length,
        has_llm_output: llmOutput !== null,
      };
    };

    // Use idempotency wrapper
    const effectiveIdempotencyKey = idempotencyKey || `paste-${textHash}-${customer_id || "none"}`;

    const idempotencyResult = await withIdempotency(
      effectiveIdempotencyKey,
      authUser.user.id,
      "/api/tenders",
      { text_hash: textHash, customer_id },
      executePaste
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
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
