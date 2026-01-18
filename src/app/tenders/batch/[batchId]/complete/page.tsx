"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TenderBatch, TenderBatchItem, BatchSummary } from "@/lib/types";

interface BatchData {
  batch: TenderBatch;
  items: TenderBatchItem[];
  summary: BatchSummary;
}

export default function BatchCompletePage() {
  const params = useParams();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

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

  const { items, summary } = data;
  const failedItems = items.filter(i => i.state === "failed");
  const skippedItems = items.filter(i => i.state === "skipped");

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Success header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Batch Complete</h1>
          <p className="text-gray-600">
            All {summary.total} files have been processed.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{summary.reviewed}</p>
            <p className="text-sm text-gray-600">Reviewed</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{summary.skipped}</p>
            <p className="text-sm text-gray-600">Skipped</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{summary.failed}</p>
            <p className="text-sm text-gray-600">Failed</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <p className="text-3xl font-bold text-orange-600">{summary.deduped}</p>
            <p className="text-sm text-gray-600">Duplicates</p>
          </div>
        </div>

        {/* Failed items */}
        {failedItems.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6">
            <div className="px-4 py-3 border-b border-gray-200 bg-red-50">
              <h2 className="font-semibold text-red-800">Failed Files ({failedItems.length})</h2>
              <p className="text-sm text-red-600">These files could not be processed.</p>
            </div>
            <ul className="divide-y divide-gray-200">
              {failedItems.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <p className="font-medium text-gray-900">{item.file_name}</p>
                  {item.error_message && (
                    <p className="text-sm text-red-600">{item.error_message}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Skipped items */}
        {skippedItems.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6">
            <div className="px-4 py-3 border-b border-gray-200 bg-blue-50">
              <h2 className="font-semibold text-blue-800">Skipped Files ({skippedItems.length})</h2>
              <p className="text-sm text-blue-600">You can review these later.</p>
            </div>
            <ul className="divide-y divide-gray-200">
              {skippedItems.map((item) => (
                <li key={item.id} className="px-4 py-3 flex items-center justify-between">
                  <p className="font-medium text-gray-900">{item.file_name}</p>
                  <Link
                    href={`/tenders/${item.tender_id}/review`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Review Now
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Upload More
          </Link>
          <Link
            href={`/tenders/batch/${batchId}/review`}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            View All Files
          </Link>
        </div>
      </div>
    </div>
  );
}
