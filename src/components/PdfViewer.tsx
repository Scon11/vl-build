"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";

// Import styles
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

interface PdfViewerProps {
  /** Direct URL to the PDF (legacy support) */
  url?: string;
  /** Tender ID to fetch signed URL for (preferred) */
  tenderId?: string;
  fileName?: string;
  onError?: () => void;
}

export default function PdfViewer({ url, tenderId, fileName, onError }: PdfViewerProps) {
  const [isClient, setIsClient] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(url || null);
  
  // Use a ref to track render errors and update state in useEffect
  const renderErrorRef = useRef(false);

  // Create the default layout plugin instance
  const defaultLayoutPluginInstance = defaultLayoutPlugin({
    sidebarTabs: (defaultTabs) => [defaultTabs[0]], // Only show thumbnails tab
  });

  // Fetch signed URL if tenderId is provided
  const fetchSignedUrl = useCallback(async () => {
    if (!tenderId) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/file-url`);
      const data = await res.json();
      
      if (!res.ok) {
        console.error("File URL API error:", res.status, data);
        throw new Error(data.error || "Failed to fetch file URL");
      }
      
      if (data.url) {
        setResolvedUrl(data.url);
      } else {
        throw new Error("No URL in response");
      }
    } catch (err) {
      console.error("Error fetching signed URL:", err);
      setHasError(true);
      onError?.();
    } finally {
      setLoading(false);
    }
  }, [tenderId, onError]);

  useEffect(() => {
    setIsClient(true);
    
    // Prioritize tenderId for fetching signed URL (works with private storage)
    // Fall back to direct URL only if no tenderId
    if (tenderId) {
      fetchSignedUrl();
    } else if (url) {
      setResolvedUrl(url);
    }
  }, [tenderId, url, fetchSignedUrl]);

  // Handle render errors via ref to avoid setState during render
  useEffect(() => {
    if (renderErrorRef.current && !hasError) {
      setHasError(true);
      onError?.();
    }
  }, [hasError, onError]);

  if (!isClient || loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100 dark:bg-gray-800">
        <div className="text-center">
          <div className="mb-2 animate-spin">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">
            {loading ? "Loading file..." : "Loading PDF viewer..."}
          </p>
        </div>
      </div>
    );
  }

  if (!resolvedUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 p-6">
        <svg className="mb-4 h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          No file available
        </p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 p-6">
        <svg className="mb-4 h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Could not load PDF
        </p>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          {fileName || "Document"}
        </p>
        {resolvedUrl && (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Download PDF
          </a>
        )}
      </div>
    );
  }

  return (
    <Worker workerUrl={`https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`}>
      <div className="h-full">
        <Viewer
          fileUrl={resolvedUrl}
          plugins={[defaultLayoutPluginInstance]}
          onDocumentLoad={(e) => {
            // Document loaded successfully - check for empty PDFs
            if (e.doc.numPages === 0) {
              // Use setTimeout to avoid setState during render cycle
              setTimeout(() => {
                setHasError(true);
                onError?.();
              }, 0);
            }
          }}
          renderError={() => {
            // Set ref to trigger state update in useEffect (can't setState during render)
            renderErrorRef.current = true;
            return (
              <div className="flex h-full flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 p-6">
                <svg className="mb-4 h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Could not load PDF
                </p>
                {resolvedUrl && (
                  <a
                    href={resolvedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    Download PDF
                  </a>
                )}
              </div>
            );
          }}
          theme={{
            theme: "auto",
          }}
        />
      </div>
    </Worker>
  );
}
