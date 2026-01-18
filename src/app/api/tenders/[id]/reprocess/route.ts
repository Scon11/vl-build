import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment } from "@/lib/classifier";
import { CustomerProfile, VerificationWarning } from "@/lib/types";

/**
 * POST /api/tenders/[id]/reprocess
 * 
 * Fully reprocess a tender with customer context.
 * This runs the complete extraction + classification pipeline server-side.
 * Used when user changes customer on the review page.
 * 
 * IMPORTANT: This replaces client-side "apply rules" behavior.
 * Customer rules are applied BEFORE LLM classification, not after.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenderId } = await params;
    const body = await request.json();
    const { customer_id } = body;

    if (!customer_id) {
      return NextResponse.json(
        { error: "customer_id is required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch tender with all fields (including original_file_url for PDF viewer)
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

    console.log(`[Reprocess] Starting reprocess for tender ${tenderId} with customer ${customerProfile.name}`);
    console.log(`[Reprocess] Customer cargo_hints: ${JSON.stringify(customerProfile.cargo_hints)}`);

    // Re-run extraction with customer profile
    // Customer rules are applied HERE, before LLM classification
    const extractionResult = extractCandidates(tender.original_text, {
      customerProfile: customerProfile as CustomerProfile,
    });

    console.log(`[Reprocess] Extraction complete: ${extractionResult.candidates.length} candidates`);
    console.log(`[Reprocess] Rules applied: ${extractionResult.metadata.applied_customer_rules}`);

    // Re-run LLM classification with customer context
    let llmOutput = null;
    let verificationWarnings: VerificationWarning[] = [];
    let normalizationMetadata = null;
    let fieldProvenance = null;

    try {
      const verifiedResult = await classifyAndVerifyShipment({
        originalText: tender.original_text,
        candidates: extractionResult.candidates,
        customerProfile: customerProfile as CustomerProfile,
      });
      llmOutput = verifiedResult.shipment;
      verificationWarnings = verifiedResult.warnings;
      normalizationMetadata = verifiedResult.normalization;
      fieldProvenance = verifiedResult.provenance;
      
      console.log(`[Reprocess] Classification complete`);
    } catch (llmError) {
      console.error("[Reprocess] LLM classification error:", llmError);
      return NextResponse.json(
        { error: "Classification failed" },
        { status: 500 }
      );
    }

    // Update tender with customer_id
    await supabase
      .from("tenders")
      .update({ customer_id })
      .eq("id", tenderId);

    // Build combined metadata preserving file info from previous extraction
    const combinedMetadata = {
      ...extractionResult.metadata,
      ...preservedFileMetadata, // Preserve file_name, file_type, page_count, word_count
      verification_warnings: verificationWarnings,
      field_provenance: fieldProvenance,
      normalization: normalizationMetadata,
      reprocessed_at: new Date().toISOString(),
      reprocessed_with_customer: customer_id,
    };

    // Create new extraction run with updated results
    const { error: extractionError } = await supabase
      .from("extraction_runs")
      .insert({
        tender_id: tenderId,
        candidates: extractionResult.candidates,
        metadata: combinedMetadata,
        llm_output: llmOutput,
      });

    if (extractionError) {
      console.error("[Reprocess] Error saving extraction run:", extractionError);
    }

    // Return full tender with updated customer_id
    const updatedTender = { ...tender, customer_id };

    return NextResponse.json({
      success: true,
      tender: updatedTender,
      extraction: {
        candidates: extractionResult.candidates,
        metadata: combinedMetadata,
        llm_output: llmOutput,
      },
      customer: customerProfile,
    });
  } catch (err) {
    console.error("[Reprocess] API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
