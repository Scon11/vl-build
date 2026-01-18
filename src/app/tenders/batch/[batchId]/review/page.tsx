"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TenderBatch, TenderBatchItem, BatchSummary } from "@/lib/types";

interface BatchData {
  batch: TenderBatch;
  items: TenderBatchItem[];
  summary: BatchSummary;
  next_tender_id: string | null;
  completed: boolean;
}

const STATE_COLORS: Record<string, string> = {
  ready: "bg-gray-100 text-gray-800",
  needs_review: "bg-yellow-100 text-yellow-800",
  reviewed: "bg-green-100 text-green-800",
  skipped: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
};

const STATE_LABELS: Record<string, string> = {
  ready: "Pending",
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

export default function BatchReviewPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BatchData | null>(null);

  const fetchBatch = useCallback(async () => {
    try {
      const response = await fetch(`/api/tenders/batches/${batchId}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to fetch batch");
      }
      const batchData = await response.json();
      setData(batchData);

      // If completed, redirect to completion page
      if (batchData.completed) {
        router.push(`/tenders/batch/${batchId}/complete`);
        return;
      }

      // If there's a next tender to review, we can show the list or redirect
      // For now, show the list with a prominent "Continue Review" button
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [batchId, router]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  const handleContinueReview = () => {
    if (data?.next_tender_id) {
      router.push(`/tenders/${data.next_tender_id}/review?batch=${batchId}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Batch not found"}</p>
          <Link href="/" className="text-blue-600 hover:underline">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const { batch, items, summary } = data;
  const currentItem = items.find(i => i.tender_id === data.next_tender_id);
  const currentPosition = currentItem ? currentItem.position + 1 : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Batch Review</h1>
            <p className="text-gray-600">
              {summary.reviewed + summary.skipped} of {summary.total} completed
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            Home
          </Link>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Progress</span>
            <span className="text-sm text-gray-500">
              {Math.round(((summary.reviewed + summary.skipped) / summary.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((summary.reviewed + summary.skipped) / summary.total) * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Reviewed: {summary.reviewed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
              Needs Review: {summary.needs_review}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              Skipped: {summary.skipped}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Failed: {summary.failed}
            </span>
          </div>
        </div>

        {/* Continue button */}
        {data.next_tender_id && (
          <div className="bg-white rounded-lg shadow p-6 mb-6 text-center">
            <p className="text-gray-600 mb-4">
              Next: <span className="font-medium">{currentItem?.file_name}</span>
              {" "}(Tender {currentPosition} of {summary.total})
            </p>
            <button
              onClick={handleContinueReview}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Continue Review
            </button>
          </div>
        )}

        {/* Items list */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Files in Batch</h2>
          </div>
          <ul className="divide-y divide-gray-200">
            {items.map((item, idx) => (
              <li
                key={item.id}
                className={`px-4 py-3 flex items-center justify-between ${
                  item.tender_id === data.next_tender_id ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                  <div>
                    <p className="font-medium text-gray-900">{item.file_name}</p>
                    {item.deduped && (
                      <p className="text-xs text-orange-600">Duplicate - linked to existing tender</p>
                    )}
                    {item.error_message && (
                      <p className="text-xs text-red-600">{item.error_message}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${STATE_COLORS[item.state]}`}>
                    {STATE_LABELS[item.state]}
                  </span>
                  {item.state !== "failed" && (
                    <Link
                      href={`/tenders/${item.tender_id}/review?batch=${batchId}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Completion link if all done */}
        {!data.next_tender_id && (
          <div className="mt-6 text-center">
            <Link
              href={`/tenders/batch/${batchId}/complete`}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              View Summary
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
