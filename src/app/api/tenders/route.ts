import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment } from "@/lib/classifier";
import { VerificationWarning, CustomerProfile } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source_type, original_text, customer_id } = body;

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

    const supabase = createServerClient();
    const trimmedText = original_text.trim();

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

    // 1. Create tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .insert({
        source_type,
        original_text: trimmedText,
        customer_id: customer_id || null,
      })
      .select("id")
      .single();

    if (tenderError) {
      console.error("Supabase tender error:", tenderError);
      return NextResponse.json(
        { error: "Failed to create tender" },
        { status: 500 }
      );
    }

    // 2. Run deterministic extraction with customer profile
    const extractionResult = extractCandidates(trimmedText, { customerProfile });

    // 3. Run LLM classification with verification + normalization
    let llmOutput = null;
    let verificationWarnings: VerificationWarning[] = [];
    let normalizationMetadata = null;
    let fieldProvenance = null;
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
    } catch (llmError) {
      console.error("LLM classification error:", llmError);
      // Continue without LLM output - human can still review raw candidates
    }

    // 4. Store extraction run with LLM output, verification warnings, provenance, and normalization
    const { error: extractionError } = await supabase
      .from("extraction_runs")
      .insert({
        tender_id: tender.id,
        candidates: extractionResult.candidates,
        metadata: {
          ...extractionResult.metadata,
          verification_warnings: verificationWarnings,
          field_provenance: fieldProvenance,
          normalization: normalizationMetadata,
        },
        llm_output: llmOutput,
      });

    if (extractionError) {
      console.error("Supabase extraction error:", extractionError);
      // Don't fail the whole request - tender was created successfully
    }

    return NextResponse.json(
      {
        id: tender.id,
        candidates_count: extractionResult.candidates.length,
        has_llm_output: llmOutput !== null,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
