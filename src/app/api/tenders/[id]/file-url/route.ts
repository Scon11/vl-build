import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, AuthError } from "@/lib/auth";

/**
 * GET /api/tenders/[id]/file-url
 * Returns a signed URL for the tender's original file.
 * Requires authentication.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require authentication
    await requireAuth();
    
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Tender ID is required" },
        { status: 400 }
      );
    }

    // Use service client to bypass RLS for this admin operation
    const supabase = createServiceClient();

    // Fetch tender to get file path
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("id, original_file_path, original_file_url")
      .eq("id", id)
      .single();

    if (tenderError) {
      console.error("[file-url] Tender query error:", tenderError);
      return NextResponse.json(
        { error: "Tender not found", details: tenderError.message },
        { status: 404 }
      );
    }
    
    if (!tender) {
      return NextResponse.json(
        { error: "Tender not found" },
        { status: 404 }
      );
    }
    
    console.log("[file-url] Tender found:", { 
      id: tender.id, 
      hasPath: !!tender.original_file_path, 
      hasUrl: !!tender.original_file_url 
    });

    // Prefer new path-based storage, fall back to old URL
    const filePath = tender.original_file_path;
    
    if (!filePath) {
      // Legacy: if no path, check if there's an old public URL
      if (tender.original_file_url) {
        // Return the old public URL (legacy support)
        return NextResponse.json({
          url: tender.original_file_url,
          expires_at: null,
          is_legacy: true,
        });
      }
      
      return NextResponse.json(
        { error: "No file associated with this tender" },
        { status: 404 }
      );
    }

    // Generate signed URL for private storage
    // URL valid for 1 hour (3600 seconds)
    const { data: signedUrl, error: signError } = await supabase.storage
      .from("tender-files")
      .createSignedUrl(filePath, 3600);

    if (signError || !signedUrl) {
      console.error("[file-url] Failed to generate signed URL:", signError);
      return NextResponse.json(
        { error: "Failed to generate file access URL", details: signError?.message },
        { status: 500 }
      );
    }
    
    console.log("[file-url] Signed URL generated successfully");

    return NextResponse.json({
      url: signedUrl.signedUrl,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      is_legacy: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    
    console.error("File URL API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
