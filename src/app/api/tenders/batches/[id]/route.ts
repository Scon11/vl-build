import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAuth, AuthError } from "@/lib/auth";
import { TenderBatch, TenderBatchItem, BatchSummary } from "@/lib/types";

/**
 * GET /api/tenders/batches/[id]
 * 
 * Returns batch details with items ordered by position.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: batchId } = await params;

    const supabase = createServerClient();

    // Fetch batch
    const { data: batch, error: batchError } = await supabase
      .from("tender_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    // Fetch items ordered by position
    const { data: items, error: itemsError } = await supabase
      .from("tender_batch_items")
      .select("*")
      .eq("batch_id", batchId)
      .order("position", { ascending: true });

    if (itemsError) {
      console.error("[Batch] Items fetch error:", itemsError);
      return NextResponse.json(
        { error: "Failed to fetch batch items" },
        { status: 500 }
      );
    }

    // Get summary counts
    const summary: BatchSummary = {
      total: items?.length || 0,
      ready: items?.filter(i => i.state === "ready").length || 0,
      needs_review: items?.filter(i => i.state === "needs_review").length || 0,
      reviewed: items?.filter(i => i.state === "reviewed").length || 0,
      skipped: items?.filter(i => i.state === "skipped").length || 0,
      failed: items?.filter(i => i.state === "failed").length || 0,
      deduped: items?.filter(i => i.deduped).length || 0,
    };

    // Find next action: next tender_id to review
    let nextTenderId: string | null = null;
    const typedItems = items as TenderBatchItem[];
    
    for (let i = batch.current_index; i < typedItems.length; i++) {
      const item = typedItems[i];
      if (item.state !== "reviewed" && item.state !== "skipped" && item.state !== "failed") {
        nextTenderId = item.tender_id;
        break;
      }
    }

    // If no more items to review, check if batch should be completed
    const allProcessed = typedItems.every(
      item => item.state === "reviewed" || item.state === "skipped" || item.state === "failed"
    );

    return NextResponse.json({
      batch: batch as TenderBatch,
      items: typedItems,
      summary,
      next_tender_id: nextTenderId,
      completed: allProcessed,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[Batch] API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
