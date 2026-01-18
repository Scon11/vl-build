import {
  TenderBatch,
  TenderBatchItem,
  BatchSummary,
  BatchStatus,
  BatchItemState,
  BatchUploadResponse,
  BatchAdvanceResponse,
} from "./types";

describe("Batch Upload Types", () => {
  describe("BatchStatus", () => {
    it("should allow valid batch statuses", () => {
      const validStatuses: BatchStatus[] = ["active", "completed", "abandoned"];
      validStatuses.forEach((status) => {
        expect(["active", "completed", "abandoned"]).toContain(status);
      });
    });
  });

  describe("BatchItemState", () => {
    it("should allow valid item states", () => {
      const validStates: BatchItemState[] = [
        "ready",
        "needs_review",
        "reviewed",
        "skipped",
        "failed",
      ];
      validStates.forEach((state) => {
        expect([
          "ready",
          "needs_review",
          "reviewed",
          "skipped",
          "failed",
        ]).toContain(state);
      });
    });
  });

  describe("TenderBatch", () => {
    it("should have required fields", () => {
      const batch: TenderBatch = {
        id: "test-batch-id",
        created_by: "user-id",
        customer_id: null,
        status: "active",
        current_index: 0,
        total_items: 5,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(batch.id).toBe("test-batch-id");
      expect(batch.status).toBe("active");
      expect(batch.current_index).toBe(0);
      expect(batch.total_items).toBe(5);
    });

    it("should support customer_id", () => {
      const batch: TenderBatch = {
        id: "test-batch-id",
        created_by: "user-id",
        customer_id: "customer-123",
        status: "active",
        current_index: 0,
        total_items: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(batch.customer_id).toBe("customer-123");
    });
  });

  describe("TenderBatchItem", () => {
    it("should have required fields", () => {
      const item: TenderBatchItem = {
        id: "item-id",
        batch_id: "batch-id",
        tender_id: "tender-id",
        file_name: "test.pdf",
        source_type: "file",
        position: 0,
        state: "needs_review",
        deduped: false,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(item.file_name).toBe("test.pdf");
      expect(item.position).toBe(0);
      expect(item.state).toBe("needs_review");
      expect(item.deduped).toBe(false);
    });

    it("should support error_message for failed items", () => {
      const item: TenderBatchItem = {
        id: "item-id",
        batch_id: "batch-id",
        tender_id: "tender-id",
        file_name: "corrupted.pdf",
        source_type: "file",
        position: 2,
        state: "failed",
        deduped: false,
        error_message: "Failed to parse PDF",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(item.state).toBe("failed");
      expect(item.error_message).toBe("Failed to parse PDF");
    });

    it("should support deduped flag", () => {
      const item: TenderBatchItem = {
        id: "item-id",
        batch_id: "batch-id",
        tender_id: "existing-tender-id",
        file_name: "duplicate.pdf",
        source_type: "file",
        position: 1,
        state: "reviewed", // Already reviewed from previous upload
        deduped: true,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(item.deduped).toBe(true);
      expect(item.state).toBe("reviewed");
    });
  });

  describe("BatchSummary", () => {
    it("should have all count fields", () => {
      const summary: BatchSummary = {
        total: 10,
        ready: 2,
        needs_review: 4,
        reviewed: 2,
        skipped: 1,
        failed: 1,
        deduped: 2,
      };

      expect(summary.total).toBe(10);
      expect(summary.ready + summary.needs_review + summary.reviewed + summary.skipped + summary.failed).toBeLessThanOrEqual(summary.total);
    });
  });

  describe("BatchUploadResponse", () => {
    it("should contain batch_id and items", () => {
      const response: BatchUploadResponse = {
        batch_id: "batch-123",
        items: [
          {
            position: 0,
            tender_id: "tender-1",
            file_name: "doc1.pdf",
            state: "needs_review",
            deduped: false,
          },
          {
            position: 1,
            tender_id: "tender-2",
            file_name: "doc2.pdf",
            state: "needs_review",
            deduped: false,
          },
        ],
        first_tender_id: "tender-1",
      };

      expect(response.batch_id).toBe("batch-123");
      expect(response.items).toHaveLength(2);
      expect(response.first_tender_id).toBe("tender-1");
    });

    it("should handle all failed case", () => {
      const response: BatchUploadResponse = {
        batch_id: "batch-456",
        items: [
          {
            position: 0,
            tender_id: "placeholder-1",
            file_name: "bad.xyz",
            state: "failed",
            deduped: false,
            error_message: "Unsupported file type",
          },
        ],
        first_tender_id: null,
      };

      expect(response.first_tender_id).toBeNull();
      expect(response.items[0].state).toBe("failed");
    });

    it("should handle deduped items", () => {
      const response: BatchUploadResponse = {
        batch_id: "batch-789",
        items: [
          {
            position: 0,
            tender_id: "existing-tender",
            file_name: "already-uploaded.pdf",
            state: "reviewed",
            deduped: true,
          },
          {
            position: 1,
            tender_id: "new-tender",
            file_name: "new-file.pdf",
            state: "needs_review",
            deduped: false,
          },
        ],
        first_tender_id: "new-tender", // Skip already reviewed deduped item
      };

      expect(response.items[0].deduped).toBe(true);
      expect(response.first_tender_id).toBe("new-tender");
    });
  });

  describe("BatchAdvanceResponse", () => {
    it("should indicate next tender when not completed", () => {
      const response: BatchAdvanceResponse = {
        completed: false,
        next_tender_id: "tender-3",
        current_index: 2,
        summary: {
          total: 5,
          ready: 0,
          needs_review: 2,
          reviewed: 2,
          skipped: 0,
          failed: 1,
          deduped: 0,
        },
      };

      expect(response.completed).toBe(false);
      expect(response.next_tender_id).toBe("tender-3");
      expect(response.current_index).toBe(2);
    });

    it("should indicate completion when all items processed", () => {
      const response: BatchAdvanceResponse = {
        completed: true,
        next_tender_id: null,
        current_index: 5,
        summary: {
          total: 5,
          ready: 0,
          needs_review: 0,
          reviewed: 4,
          skipped: 1,
          failed: 0,
          deduped: 1,
        },
      };

      expect(response.completed).toBe(true);
      expect(response.next_tender_id).toBeNull();
    });
  });
});

describe("Batch Logic", () => {
  describe("getNextReviewableItem", () => {
    // Helper function that mirrors the database logic
    function getNextReviewableItem(
      items: TenderBatchItem[],
      fromIndex: number = 0
    ): TenderBatchItem | null {
      const sortedItems = [...items].sort((a, b) => a.position - b.position);
      for (const item of sortedItems) {
        if (
          item.position >= fromIndex &&
          item.state !== "reviewed" &&
          item.state !== "skipped" &&
          item.state !== "failed"
        ) {
          return item;
        }
      }
      return null;
    }

    it("should return first non-processed item from current index", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "reviewed", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "3", batch_id: "b", tender_id: "t3", file_name: "c.pdf", source_type: "file", position: 2, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
      ];

      const next = getNextReviewableItem(items, 0);
      expect(next?.tender_id).toBe("t2");
    });

    it("should skip failed items", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "failed", deduped: false, error_message: "Error", created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
      ];

      const next = getNextReviewableItem(items, 0);
      expect(next?.tender_id).toBe("t2");
    });

    it("should skip skipped items", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "skipped", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
      ];

      const next = getNextReviewableItem(items, 0);
      expect(next?.tender_id).toBe("t2");
    });

    it("should return null when all items are processed", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "reviewed", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "skipped", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "3", batch_id: "b", tender_id: "t3", file_name: "c.pdf", source_type: "file", position: 2, state: "failed", deduped: false, error_message: "Error", created_at: "", updated_at: "" },
      ];

      const next = getNextReviewableItem(items, 0);
      expect(next).toBeNull();
    });

    it("should respect fromIndex parameter", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "3", batch_id: "b", tender_id: "t3", file_name: "c.pdf", source_type: "file", position: 2, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
      ];

      const next = getNextReviewableItem(items, 2);
      expect(next?.tender_id).toBe("t3");
    });
  });

  describe("computeBatchSummary", () => {
    function computeBatchSummary(items: TenderBatchItem[]): BatchSummary {
      return {
        total: items.length,
        ready: items.filter(i => i.state === "ready").length,
        needs_review: items.filter(i => i.state === "needs_review").length,
        reviewed: items.filter(i => i.state === "reviewed").length,
        skipped: items.filter(i => i.state === "skipped").length,
        failed: items.filter(i => i.state === "failed").length,
        deduped: items.filter(i => i.deduped).length,
      };
    }

    it("should compute correct counts", () => {
      const items: TenderBatchItem[] = [
        { id: "1", batch_id: "b", tender_id: "t1", file_name: "a.pdf", source_type: "file", position: 0, state: "reviewed", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "2", batch_id: "b", tender_id: "t2", file_name: "b.pdf", source_type: "file", position: 1, state: "reviewed", deduped: true, error_message: null, created_at: "", updated_at: "" },
        { id: "3", batch_id: "b", tender_id: "t3", file_name: "c.pdf", source_type: "file", position: 2, state: "needs_review", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "4", batch_id: "b", tender_id: "t4", file_name: "d.pdf", source_type: "file", position: 3, state: "skipped", deduped: false, error_message: null, created_at: "", updated_at: "" },
        { id: "5", batch_id: "b", tender_id: "t5", file_name: "e.pdf", source_type: "file", position: 4, state: "failed", deduped: false, error_message: "Error", created_at: "", updated_at: "" },
      ];

      const summary = computeBatchSummary(items);
      expect(summary.total).toBe(5);
      expect(summary.reviewed).toBe(2);
      expect(summary.needs_review).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.deduped).toBe(1);
    });
  });
});
