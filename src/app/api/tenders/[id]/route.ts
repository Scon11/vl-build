import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Tender ID is required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("*")
      .eq("id", id)
      .single();

    if (tenderError || !tender) {
      return NextResponse.json(
        { error: "Tender not found" },
        { status: 404 }
      );
    }

    // Fetch latest extraction run
    const { data: extractionRun, error: extractionError } = await supabase
      .from("extraction_runs")
      .select("*")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (extractionError) {
      console.error("Extraction fetch error:", extractionError);
    }

    // Fetch customer profile if tender has customer_id
    let customerProfile = null;
    if (tender.customer_id) {
      const { data } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", tender.customer_id)
        .single();
      customerProfile = data;
    }

    // Debug: log what commodity is being returned
    const llmOutput = extractionRun?.llm_output;
    if (llmOutput?.cargo?.commodity) {
      console.log(`[API] Returning tender ${id} with commodity: "${llmOutput.cargo.commodity}"`);
    } else {
      console.log(`[API] Returning tender ${id} with NO commodity (llm_output.cargo.commodity is empty)`);
    }

    return NextResponse.json({
      tender,
      extraction: extractionRun || null,
      customer: customerProfile,
    });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
