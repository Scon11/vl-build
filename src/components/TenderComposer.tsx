"use client";

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CustomerSelector } from "./CustomerSelector";

type SubmitState = "idle" | "submitting" | "error";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_EXTENSIONS = [".pdf", ".docx", ".txt"];
const VALID_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

export function TenderComposer() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to calculate new height
    textarea.style.height = "auto";
    // Set to scrollHeight but cap at max
    const maxHeight = 260;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    // Enable scroll if content exceeds max height
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text]);

  const isValidFile = useCallback((file: File): { valid: boolean; error?: string } => {
    const hasValidType = VALID_TYPES.includes(file.type);
    const hasValidExt = VALID_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidType && !hasValidExt) {
      return { valid: false, error: "Unsupported file type. Please use PDF, DOCX, or TXT." };
    }

    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: "File too large. Maximum size is 10MB." };
    }

    return { valid: true };
  }, []);

  const handleFileAttach = useCallback((file: File) => {
    const validation = isValidFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error || "Invalid file");
      return;
    }
    setAttachedFile(file);
    setErrorMessage(null);
  }, [isValidFile]);

  const handlePaperclipClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileAttach(file);
    }
    // Reset input so the same file can be selected again
    e.target.value = "";
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setErrorMessage(null);
  };

  // Drag and drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileAttach(file);
    }
  }, [handleFileAttach]);

  // Keyboard handling: Ctrl/Cmd+Enter to submit
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = () => {
    if (submitState === "submitting") return false;
    return attachedFile !== null || text.trim().length > 0;
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;

    setSubmitState("submitting");
    setErrorMessage(null);

    try {
      let response: Response;

      if (attachedFile) {
        // File mode: upload via FormData
        const formData = new FormData();
        formData.append("file", attachedFile);
        // Include customer_id if selected
        if (selectedCustomerId) {
          formData.append("customer_id", selectedCustomerId);
        }

        response = await fetch("/api/tenders/upload", {
          method: "POST",
          body: formData,
        });
      } else {
        // Text mode: submit JSON
        response = await fetch("/api/tenders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: "paste",
            original_text: text.trim(),
            customer_id: selectedCustomerId, // Include customer_id
          }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process tender");
      }

      // Navigate to review page
      router.push(`/tenders/${data.id}/review`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
      setSubmitState("error");
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div
      className="relative flex flex-col items-center w-full max-w-2xl mx-auto px-4"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Customer selector - above the input bar */}
      <div className="w-full mb-3">
        <CustomerSelector
          selectedCustomerId={selectedCustomerId}
          onSelect={setSelectedCustomerId}
          className="w-full"
        />
      </div>

      {/* File attachment chip */}
      {attachedFile && (
        <div className="w-full mb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-border rounded-full text-sm">
            <svg
              className="w-4 h-4 text-accent shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-text-primary truncate max-w-[200px]">
              {attachedFile.name}
            </span>
            <span className="text-text-muted">
              ({formatFileSize(attachedFile.size)})
            </span>
            <button
              onClick={removeAttachment}
              disabled={submitState === "submitting"}
              className="p-0.5 rounded hover:bg-bg-input text-text-muted hover:text-text-primary transition-colors"
              aria-label="Remove attachment"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          {text.trim() && (
            <p className="mt-1 text-xs text-text-muted">
              File will be processed. Text input will be ignored.
            </p>
          )}
        </div>
      )}

      {/* Main input bar */}
      <div
        className={`
          relative w-full flex items-end gap-2 
          bg-bg-secondary border rounded-2xl 
          px-3 py-2 transition-all duration-200
          ${dragActive
            ? "border-accent ring-2 ring-accent/20 bg-accent/5"
            : "border-border hover:border-text-muted/50"
          }
          ${submitState === "submitting" ? "opacity-70" : ""}
        `}
      >
        {/* Paperclip button */}
        <button
          onClick={handlePaperclipClick}
          disabled={submitState === "submitting"}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input transition-colors shrink-0 disabled:opacity-50"
          aria-label="Attach file"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={handleFileSelect}
          className="hidden"
          aria-hidden="true"
        />

        {/* Auto-sizing textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste email text or drop a tender file…"
          disabled={submitState === "submitting"}
          className="flex-1 resize-none bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none py-2 min-h-[24px] max-h-[260px] text-sm leading-relaxed"
          rows={1}
          aria-label="Tender text input"
        />

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit()}
          className={`
            p-2 rounded-lg shrink-0 transition-all duration-200
            ${canSubmit()
              ? "bg-accent text-white hover:bg-accent-hover"
              : "bg-bg-input text-text-muted cursor-not-allowed"
            }
            disabled:opacity-50
          `}
          aria-label="Submit tender"
        >
          {submitState === "submitting" ? (
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Helper text */}
      <p className="mt-2 text-xs text-text-muted">
        Press <kbd className="px-1 py-0.5 bg-bg-input rounded text-[10px]">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-bg-input rounded text-[10px]">Enter</kbd> to submit • PDF, DOCX, TXT up to 10MB
      </p>

      {/* Error message */}
      {errorMessage && (
        <div className="mt-3 w-full px-4 py-2 rounded-lg bg-error/10 border border-error/20 text-sm text-error">
          {errorMessage}
        </div>
      )}

      {/* Drag overlay indicator */}
      {dragActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-accent/5 rounded-2xl border-2 border-dashed border-accent" />
        </div>
      )}
    </div>
  );
}
