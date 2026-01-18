import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAuth, AuthError } from "@/lib/auth";
import { TenderBatchItem, BatchSummary, BatchAdvanceResponse } from "@/lib/types";

/**
 * PATCH /api/tenders/batches/[id]/advance
 * 
 * Advances the batch to the next item.
 * Body: { action: 'next' | 'skip', tender_id?: uuid }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: batchId } = await params;
    const body = await request.json();
    const { action, tender_id } = body as { action: "next" | "skip"; tender_id?: string };

    if (!action || (action !== "next" && action !== "skip")) {
      return NextResponse.json(
        { error: "action must be 'next' or 'skip'" },
        { status: 400 }
      );
    }

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

    // Fetch all items
    const { data: items, error: itemsError } = await supabase
      .from("tender_batch_items")
      .select("*")
      .eq("batch_id", batchId)
      .order("position", { ascending: true });

    if (itemsError || !items) {
      return NextResponse.json(
        { error: "Failed to fetch batch items" },
        { status: 500 }
      );
    }

    const typedItems = items as TenderBatchItem[];

    // Find current item (the one at current_index or matching tender_id)
    let currentItemIndex = batch.current_index;
    
    if (tender_id) {
      // Find by tender_id if provided
      const idx = typedItems.findIndex(i => i.tender_id === tender_id);
      if (idx >= 0) {
        currentItemIndex = idx;
      }
    }

    const currentItem = typedItems[currentItemIndex];

    // Update current item state based on action
    if (currentItem) {
      let newState = currentItem.state;
      
      if (action === "skip") {
        newState = "skipped";
      } else if (action === "next") {
        // Mark as reviewed if it's still needs_review
        if (currentItem.state === "needs_review" || currentItem.state === "ready") {
          newState = "reviewed";
        }
      }

      if (newState !== currentItem.state) {
        await supabase
          .from("tender_batch_items")
          .update({ state: newState })
          .eq("id", currentItem.id);
      }
    }

    // Find next reviewable item starting from current_index + 1
    let nextIndex = currentItemIndex + 1;
    let nextTenderId: string | null = null;

    while (nextIndex < typedItems.length) {
      const item = typedItems[nextIndex];
      if (item.state !== "reviewed" && item.state !== "skipped" && item.state !== "failed") {
        nextTenderId = item.tender_id;
        break;
      }
      nextIndex++;
    }

    // Check if batch is completed
    const allProcessed = typedItems.every(
      (item, idx) => {
        if (idx === currentItemIndex && action === "next") {
          return true; // Current item will be marked reviewed
        }
        if (idx === currentItemIndex && action === "skip") {
          return true; // Current item will be marked skipped
        }
        return item.state === "reviewed" || item.state === "skipped" || item.state === "failed";
      }
    );

    const completed = !nextTenderId || allProcessed;

    // Update batch
    await supabase
      .from("tender_batches")
      .update({
        current_index: completed ? typedItems.length : nextIndex,
        status: completed ? "completed" : "active",
      })
      .eq("id", batchId);

    // Get summary for response
    const summary: BatchSummary = {
      total: typedItems.length,
      ready: typedItems.filter(i => i.state === "ready").length,
      needs_review: typedItems.filter(i => i.state === "needs_review").length - (action === "next" && currentItem?.state === "needs_review" ? 1 : 0),
      reviewed: typedItems.filter(i => i.state === "reviewed").length + (action === "next" && currentItem?.state !== "reviewed" ? 1 : 0),
      skipped: typedItems.filter(i => i.state === "skipped").length + (action === "skip" ? 1 : 0),
      failed: typedItems.filter(i => i.state === "failed").length,
      deduped: typedItems.filter(i => i.deduped).length,
    };

    const response: BatchAdvanceResponse = {
      completed,
      next_tender_id: completed ? null : nextTenderId,
      current_index: completed ? typedItems.length : nextIndex,
      summary,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[BatchAdvance] API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
