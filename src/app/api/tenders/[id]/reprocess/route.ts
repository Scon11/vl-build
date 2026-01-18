import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAuth, AuthError } from "@/lib/auth";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment, EXTRACTION_VERSION } from "@/lib/classifier";
import { CustomerProfile, VerificationWarning, TenderStatus } from "@/lib/types";
import { withLock, TenderLockError } from "@/lib/tender-lock";
import { withIdempotency } from "@/lib/idempotency";
import { retry, RetryPresets } from "@/lib/retry";
import { validateTransition, InvalidStateTransitionError } from "@/lib/state-machine";
import { enforceRateLimit, RateLimits, RateLimitExceededError } from "@/lib/rate-limiter";
import { logLLMUsage } from "@/lib/llm-usage";

/**
 * POST /api/tenders/[id]/reprocess
 * 
 * Fully reprocess a tender with customer context.
 * This runs the complete extraction + classification pipeline server-side.
 * Used when user changes customer on the review page.
 * 
 * Headers:
 * - Idempotency-Key: string (optional) - Key for idempotent retry
 * 
 * Body:
 * - customer_id: string (required)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth();
    const { id: tenderId } = await params;
    const body = await request.json();
    const { customer_id } = body;

    // Get idempotency key from header
    const idempotencyKey = request.headers.get("Idempotency-Key");

    if (!customer_id) {
      return NextResponse.json(
        { error: "customer_id is required" },
        { status: 400 }
      );
    }

    // Enforce rate limit (per-tender limit for reprocessing)
    await enforceRateLimit(
      authUser.user.id,
      "/api/tenders/reprocess",
      RateLimits.reprocess,
      tenderId // Resource ID for per-tender limiting
    );

    const supabase = createServerClient();

    // Fetch tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("*")
      .eq("id", tenderId)
      .single();

    if (tenderError || !tender) {
      return NextResponse.json(
        { error: "Tender not found" },
        { status: 404 }
      );
    }

    // Validate tender can be reprocessed
    const allowedStatuses: TenderStatus[] = ["extracted", "needs_review", "reviewed", "export_failed"];
    if (!allowedStatuses.includes(tender.status as TenderStatus)) {
      return NextResponse.json({
        error: "Tender cannot be reprocessed in current state",
        current_status: tender.status,
        allowed_statuses: allowedStatuses,
      }, { status: 400 });
    }

    // Fetch customer profile
    const { data: customerProfile, error: customerError } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("id", customer_id)
      .single();

    if (customerError || !customerProfile) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Fetch the previous extraction run to preserve file metadata
    const { data: previousExtraction } = await supabase
      .from("extraction_runs")
      .select("metadata")
      .eq("tender_id", tenderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Preserve file-related metadata from previous extraction
    const previousMetadata = previousExtraction?.metadata || {};
    const preservedFileMetadata = {
      file_name: previousMetadata.file_name,
      file_type: previousMetadata.file_type,
      page_count: previousMetadata.page_count,
      word_count: previousMetadata.word_count,
    };

    // Execute reprocessing with lock and idempotency
    const executeReprocess = async () => {
      return await withLock(tenderId, authUser.user.id, "reprocessing", async () => {
        console.log(`[Reprocess] Starting reprocess for tender ${tenderId} with customer ${customerProfile.name}`);
        console.log(`[Reprocess] Customer cargo_hints: ${JSON.stringify(customerProfile.cargo_hints)}`);

        // Re-run extraction with customer profile (synchronous, no retry needed)
        const extractionResult = extractCandidates(tender.original_text, {
          customerProfile: customerProfile as CustomerProfile,
        });

        console.log(`[Reprocess] Extraction complete: ${extractionResult.candidates.length} candidates`);
        console.log(`[Reprocess] Rules applied: ${extractionResult.metadata.applied_customer_rules}`);

        // Re-run LLM classification with customer context (with retry)
        let llmOutput = null;
        let verificationWarnings: VerificationWarning[] = [];
        let normalizationMetadata = null;
        let fieldProvenance = null;
        let llmUsage = null;

        const llmStartTime = Date.now();
        try {
          const verifiedResult = await retry(
            () => classifyAndVerifyShipment({
              originalText: tender.original_text,
              candidates: extractionResult.candidates,
              customerProfile: customerProfile as CustomerProfile,
            }),
            RetryPresets.openai
          );

          llmOutput = verifiedResult.shipment;
          verificationWarnings = verifiedResult.warnings;
          normalizationMetadata = verifiedResult.normalization;
          fieldProvenance = verifiedResult.provenance;
          llmUsage = verifiedResult.usage;
          
          console.log(`[Reprocess] Classification complete`);
        } catch (llmError) {
          // Log failed LLM attempt
          await logLLMUsage({
            tenderId,
            route: `/api/tenders/${tenderId}/reprocess`,
            operation: "reprocess",
            model: "gpt-4o-mini",
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            durationMs: Date.now() - llmStartTime,
            parserType: previousMetadata.file_type as "pdf" | "docx" | "txt" | "paste" | undefined,
            inputTextLength: tender.original_text?.length || 0,
            inputCandidatesCount: extractionResult.candidates.length,
            success: false,
            errorMessage: llmError instanceof Error ? llmError.message : "Unknown error",
            extractionVersion: EXTRACTION_VERSION,
            userId: authUser.user.id,
            customerId: customer_id,
          });
          throw llmError;
        }

        // Determine new status based on warnings
        let newStatus: TenderStatus = "extracted";
        if (verificationWarnings.length > 0) {
          newStatus = "needs_review";
        }

        // Update tender with customer_id and new status
        await retry(
          async () => {
            const { error } = await supabase
              .from("tenders")
              .update({
                customer_id,
                status: newStatus,
                updated_by: authUser.user.id,
              })
              .eq("id", tenderId);
            if (error) throw error;
          },
          RetryPresets.database
        );

        // Build combined metadata preserving file info from previous extraction
        const combinedMetadata = {
          ...extractionResult.metadata,
          ...preservedFileMetadata,
          verification_warnings: verificationWarnings,
          field_provenance: fieldProvenance,
          normalization: normalizationMetadata,
          reprocessed_at: new Date().toISOString(),
          reprocessed_with_customer: customer_id,
          reprocessed_by: authUser.user.id,
        };

        // Create new extraction run with updated results
        let extractionRunId: string | null = null;
        await retry(
          async () => {
            const { data, error } = await supabase
              .from("extraction_runs")
              .insert({
                tender_id: tenderId,
                candidates: extractionResult.candidates,
                metadata: { ...combinedMetadata, extraction_version: EXTRACTION_VERSION },
                llm_output: llmOutput,
                created_by: authUser.user.id,
              })
              .select("id")
              .single();
            if (error) throw error;
            extractionRunId = data?.id;
          },
          RetryPresets.database
        );

        // Log successful LLM usage
        if (llmUsage) {
          await logLLMUsage({
            tenderId,
            extractionRunId: extractionRunId || undefined,
            route: `/api/tenders/${tenderId}/reprocess`,
            operation: "reprocess",
            model: llmUsage.model,
            promptTokens: llmUsage.promptTokens,
            completionTokens: llmUsage.completionTokens,
            totalTokens: llmUsage.totalTokens,
            durationMs: llmUsage.durationMs,
            parserType: previousMetadata.file_type as "pdf" | "docx" | "txt" | "paste" | undefined,
            inputTextLength: tender.original_text?.length || 0,
            inputCandidatesCount: extractionResult.candidates.length,
            outputStopsCount: llmOutput?.stops?.length || 0,
            outputRefsCount: llmOutput?.reference_numbers?.length || 0,
            warningsCount: verificationWarnings.length,
            success: true,
            extractionVersion: EXTRACTION_VERSION,
            userId: authUser.user.id,
            customerId: customer_id,
          });
        }

        // Return result
        const updatedTender = { ...tender, customer_id, status: newStatus };

        return {
          success: true,
          tender: updatedTender,
          extraction: {
            candidates: extractionResult.candidates,
            metadata: combinedMetadata,
            llm_output: llmOutput,
          },
          customer: customerProfile,
        };
      });
    };

    // Use idempotency wrapper
    const idempotencyResult = await withIdempotency(
      idempotencyKey,
      authUser.user.id,
      `/api/tenders/${tenderId}/reprocess`,
      body,
      executeReprocess
    );

    if ("conflict" in idempotencyResult) {
      return NextResponse.json({
        error: idempotencyResult.message,
      }, { status: 409 });
    }

    const { response, fromCache } = idempotencyResult;

    return NextResponse.json({
      ...response,
      cached: fromCache,
    });

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
    if (err instanceof TenderLockError) {
      return NextResponse.json({
        error: "Tender is currently processing",
        lock_reason: err.lockReason,
        locked_by: err.lockedBy,
      }, { status: 409 });
    }
    if (err instanceof InvalidStateTransitionError) {
      return NextResponse.json({
        error: `Invalid state transition: ${err.currentState} -> ${err.targetState}`,
      }, { status: 400 });
    }
    console.error("[Reprocess] API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
