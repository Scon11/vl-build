"use client";

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CustomerSelector } from "./CustomerSelector";

type SubmitState = "idle" | "submitting" | "error";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BATCH_MAX_FILES = parseInt(process.env.NEXT_PUBLIC_BATCH_MAX_FILES || "10", 10);
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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const maxHeight = 260;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
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

  // Handle file selection from paperclip (supports single or multiple)
  const handleFileSelect = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    if (fileArray.length > BATCH_MAX_FILES) {
      setErrorMessage(`Too many files. Maximum is ${BATCH_MAX_FILES} files per batch.`);
      return;
    }

    // Validate all files
    for (const file of fileArray) {
      const validation = isValidFile(file);
      if (!validation.valid) {
        setErrorMessage(`${file.name}: ${validation.error}`);
        return;
      }
    }

    setAttachedFiles(fileArray);
    setErrorMessage(null);
  }, [isValidFile]);

  const handlePaperclipClick = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
    }
    // Reset input so the same file(s) can be selected again
    e.target.value = "";
  };

  const removeAttachments = () => {
    setAttachedFiles([]);
    setErrorMessage(null);
    setBatchProgress(null);
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

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  // Keyboard handling: Ctrl/Cmd+Enter to submit
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = () => {
    if (submitState === "submitting") return false;
    return attachedFiles.length > 0 || text.trim().length > 0;
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;

    setSubmitState("submitting");
    setErrorMessage(null);
    setBatchProgress(null);

    try {
      // Batch upload mode (multiple files)
      if (attachedFiles.length > 1) {
        setBatchProgress(`Processing ${attachedFiles.length} files...`);
        
        const formData = new FormData();
        for (const file of attachedFiles) {
          formData.append("files", file);
        }
        if (selectedCustomerId) {
          formData.append("customer_id", selectedCustomerId);
        }

        const response = await fetch("/api/tenders/batch-upload", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to process batch");
        }

        setBatchProgress(null);
        
        // Navigate to batch review page
        if (data.first_tender_id) {
          router.push(`/tenders/batch/${data.batch_id}/review`);
        } else {
          // All items failed - show completion page
          router.push(`/tenders/batch/${data.batch_id}/complete`);
        }
        return;
      }

      // Single file mode
      if (attachedFiles.length === 1) {
        const formData = new FormData();
        formData.append("file", attachedFiles[0]);
        if (selectedCustomerId) {
          formData.append("customer_id", selectedCustomerId);
        }

        const response = await fetch("/api/tenders/upload", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to process tender");
        }

        // Navigate to review page (with duplicate flag if dedupe matched)
        if (data.deduped) {
          router.push(`/tenders/${data.id}/review?duplicate=true`);
        } else {
          router.push(`/tenders/${data.id}/review`);
        }
        return;
      }

      // Text paste mode
      const response = await fetch("/api/tenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "paste",
          original_text: text.trim(),
          customer_id: selectedCustomerId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process tender");
      }

      // Navigate to review page (with duplicate flag if dedupe matched)
      if (data.deduped) {
        router.push(`/tenders/${data.id}/review?duplicate=true`);
      } else {
        router.push(`/tenders/${data.id}/review`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
      setSubmitState("error");
      setBatchProgress(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isBatchMode = attachedFiles.length > 1;

  return (
    <div
      className="relative flex flex-col items-center w-full max-w-2xl mx-auto px-4 animate-fade-in-up animation-delay-300"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Batch files display (multiple files) */}
      {isBatchMode && (
        <div className="w-full mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-white">
              Batch Upload: {attachedFiles.length} files
            </span>
            <button
              onClick={removeAttachments}
              disabled={submitState === "submitting"}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-1 px-3 py-1.5 glass-card rounded-lg text-xs"
              >
                <span className="truncate max-w-[120px] text-gray-300">{file.name}</span>
                <span className="text-gray-500">({formatFileSize(file.size)})</span>
              </div>
            ))}
          </div>
          {batchProgress && (
            <p className="mt-3 text-sm text-cyan-400 icon-glow">{batchProgress}</p>
          )}
        </div>
      )}

      {/* Single file attachment chip */}
      {attachedFiles.length === 1 && (
        <div className="w-full mb-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 glass-card rounded-full text-sm">
            <svg
              className="w-4 h-4 text-cyan-400 icon-glow shrink-0"
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
            <span className="text-gray-200 truncate max-w-[200px]">
              {attachedFiles[0].name}
            </span>
            <span className="text-gray-500">
              ({formatFileSize(attachedFiles[0].size)})
            </span>
            <button
              onClick={removeAttachments}
              disabled={submitState === "submitting"}
              className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
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
            <p className="mt-2 text-xs text-gray-500">
              File will be processed. Text input will be ignored.
            </p>
          )}
        </div>
      )}

      {/* Main input bar - Glassmorphic */}
      <div
        className={`
          relative w-full glass-card rounded-2xl p-2 transition-all duration-300
          ${dragActive ? "!border-cyan-400/50 !shadow-[0_0_40px_rgba(0,240,255,0.2)]" : ""}
          ${submitState === "submitting" ? "opacity-70" : ""}
        `}
      >
        <div className="flex items-end gap-2">
          {/* Paperclip button - opens file picker with multi-select */}
          <button
            onClick={handlePaperclipClick}
            disabled={submitState === "submitting"}
            className="p-3 rounded-xl text-gray-400 hover:text-cyan-400 hover:bg-white/5 transition-all shrink-0 disabled:opacity-50 group"
            aria-label="Attach files"
            title="Attach files (select multiple with Ctrl/Cmd)"
          >
            <svg
              className="w-6 h-6 group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.5)] transition-all"
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

          {/* Hidden file input with multiple support */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            multiple
            onChange={handleInputChange}
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
            className="flex-1 resize-none bg-transparent text-white placeholder:text-gray-500 focus:outline-none py-3 min-h-[28px] max-h-[260px] text-base leading-relaxed"
            rows={1}
            aria-label="Tender text input"
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit()}
            className={`
              p-3 rounded-xl shrink-0 transition-all duration-300 group
              ${canSubmit()
                ? "bg-gradient-to-br from-cyan-500/20 to-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:border-cyan-400/50 hover:shadow-[0_0_30px_rgba(0,240,255,0.3)] hover:scale-105"
                : "bg-white/5 text-gray-600 cursor-not-allowed"
              }
              disabled:opacity-50
            `}
            aria-label="Submit tender"
          >
            {submitState === "submitting" ? (
              <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
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
                className="w-6 h-6 group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.5)] transition-all"
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
      </div>

      {/* Customer selector - below the input bar */}
      <div className="w-full sm:w-2/3 max-w-md mt-6 mx-auto animate-fade-in-up animation-delay-500">
        <CustomerSelector
          selectedCustomerId={selectedCustomerId}
          onSelect={setSelectedCustomerId}
          className="w-full"
        />
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="mt-4 w-full px-4 py-3 rounded-xl glass-card !border-red-500/30 text-sm text-red-400">
          {errorMessage}
        </div>
      )}

      {/* Drag overlay indicator */}
      {dragActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-cyan-500/5 rounded-2xl border-2 border-dashed border-cyan-400/50" />
          <div className="text-cyan-400 font-medium text-lg icon-glow">Drop files here</div>
        </div>
      )}
    </div>
  );
}
