import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseFile, isSupported } from "@/lib/file-parser";
import { extractCandidates } from "@/lib/extractor";
import { classifyAndVerifyShipment } from "@/lib/classifier";
import { VerificationWarning, CustomerProfile } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customerId = formData.get("customer_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!isSupported(file.name)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, DOCX, or TXT files." },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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

    // 1. Upload original file to Supabase Storage
    let fileUrl: string | null = null;
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
      // Get public URL
      const { data: urlData } = supabase.storage
        .from("tender-files")
        .getPublicUrl(uploadData.path);
      fileUrl = urlData.publicUrl;
    }

    // 2. Create tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .insert({
        source_type: "file",
        original_text: extractedText.trim(),
        original_file_url: fileUrl,
        customer_id: customerId || null,
        status: "draft",
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

    // 3. Run deterministic extraction with customer profile
    const extractionResult = extractCandidates(extractedText, { customerProfile });

    // 4. Run LLM classification with verification + normalization
    let llmOutput = null;
    let verificationWarnings: VerificationWarning[] = [];
    let normalizationMetadata = null;
    try {
      const verifiedResult = await classifyAndVerifyShipment({
        originalText: extractedText,
        candidates: extractionResult.candidates,
        customerProfile,
      });
      llmOutput = verifiedResult.shipment;
      verificationWarnings = verifiedResult.warnings;
      normalizationMetadata = verifiedResult.normalization;
    } catch (llmError) {
      console.error("LLM classification error:", llmError);
      // Continue without LLM output
    }

    // Debug: log commodity before saving
    if (llmOutput?.cargo?.commodity) {
      console.log(`[Upload] Saving llm_output with commodity: "${llmOutput.cargo.commodity}"`);
    } else {
      console.log(`[Upload] WARNING: llm_output has NO commodity before saving!`);
    }

    // 5. Store extraction run with verification warnings and normalization metadata
    const { error: extractionError } = await supabase
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
          normalization: normalizationMetadata,
        },
        llm_output: llmOutput,
      });

    if (extractionError) {
      console.error("Supabase extraction error:", extractionError);
    }

    return NextResponse.json(
      {
        id: tender.id,
        file_name: file.name,
        file_url: fileUrl,
        text_length: extractedText.length,
        word_count: parseMetadata.word_count,
        candidates_count: extractionResult.candidates.length,
        has_llm_output: llmOutput !== null,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Upload API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
