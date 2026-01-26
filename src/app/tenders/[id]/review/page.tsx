"use client";

import { useEffect, useState, useCallback, useRef, memo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CustomerSelector } from "@/components/CustomerSelector";
import {
  Tender,
  ExtractedCandidate,
  ExtractionRun,
  StructuredShipment,
  Stop,
  ReferenceNumber,
  ReferenceNumberSubtype,
  CargoDetails,
  VerificationWarning,
  ExtractionMetadata,
  CustomerProfile,
  SuggestedRule,
  ExportLogStatus,
  TenderBatch,
  TenderBatchItem,
  BatchSummary,
} from "@/lib/types";

// Local type for export status display
type ExportStatus = "pending" | "in_progress" | "completed" | "failed" | null;

// Local type for export log display
interface ExportLogDisplay {
  id: string;
  action: string;
  status: string;
  created_at: string;
  error_message?: string;
}

// Dynamically import PDF viewer to avoid SSR issues
const PdfViewer = dynamic(() => import("@/components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-gray-100 dark:bg-gray-800">
      <div className="text-center">
        <div className="mb-2 animate-spin">
          <svg className="h-8 w-8 text-gray-400 mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <p className="text-sm text-gray-500">Loading PDF viewer...</p>
      </div>
    </div>
  ),
});

type LoadingState = "loading" | "loaded" | "error";
type ViewMode = "structured" | "raw";
type SaveState = "idle" | "saving" | "saved" | "error";

interface TenderData {
  tender: Tender & { customer_id?: string | null };
  extraction: (ExtractionRun & { metadata: ExtractionMetadata }) | null;
  customer: CustomerProfile | null;
}

// Helper to check if a path has a warning
function hasWarningForPath(
  warnings: VerificationWarning[],
  pathPattern: string
): boolean {
  return warnings.some(
    (w) => w.path === pathPattern || w.path.startsWith(pathPattern + "[") || w.path.startsWith(pathPattern + ".")
  );
}

// Helper to get specific warning for a path
function getWarningForPath(
  warnings: VerificationWarning[],
  path: string
): VerificationWarning | undefined {
  return warnings.find((w) => w.path === path);
}

// Helper to filter warnings by category
// Default to "hallucinated" for backward compatibility with old warnings
function getWarningCategory(warning: VerificationWarning): "hallucinated" | "unverified" {
  return warning.category ?? "hallucinated";
}

// Helper to normalize time input to HH:MM 24-hour format
function normalizeTime24h(input: string): { value?: string; error?: string } {
  if (!input || !input.trim()) {
    return { value: undefined };
  }

  // Remove all non-digit and non-colon characters
  const cleaned = input.trim().replace(/[^0-9:]/g, "");
  
  if (!cleaned) {
    return { error: "Invalid time" };
  }

  let hours: number;
  let minutes: number;

  if (cleaned.includes(":")) {
    // Format: H:MM, HH:MM, H:M, etc.
    const parts = cleaned.split(":");
    hours = parseInt(parts[0], 10) || 0;
    minutes = parseInt(parts[1], 10) || 0;
  } else {
    // Format: H, HH, HMM, HHMM
    const len = cleaned.length;
    if (len === 1 || len === 2) {
      // "7" -> 07:00, "12" -> 12:00
      hours = parseInt(cleaned, 10);
      minutes = 0;
    } else if (len === 3) {
      // "730" -> 07:30
      hours = parseInt(cleaned.slice(0, 1), 10);
      minutes = parseInt(cleaned.slice(1), 10);
    } else if (len === 4) {
      // "1530" -> 15:30
      hours = parseInt(cleaned.slice(0, 2), 10);
      minutes = parseInt(cleaned.slice(2), 10);
    } else {
      return { error: "Invalid time format" };
    }
  }

  // Validate ranges
  if (hours < 0 || hours > 23) {
    return { error: "Hours must be 0-23" };
  }
  if (minutes < 0 || minutes > 59) {
    return { error: "Minutes must be 0-59" };
  }

  // Format as HH:MM
  const formatted = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  return { value: formatted };
}

// Helper to format date for display (YYYY-MM-DD to M/D/YYYY)
function formatDateForDisplay(isoDate: string | null): string {
  if (!isoDate) return "";
  // Handle various input formats
  const parts = isoDate.includes("-") ? isoDate.split("-") : isoDate.split("/");
  if (parts.length !== 3) return isoDate;
  
  // If YYYY-MM-DD format
  if (parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
  }
  // Already M/D/YYYY format
  return isoDate;
}

// Helper to format date for input[type=date] (M/D/YYYY to YYYY-MM-DD)
function formatDateForInput(displayDate: string | null): string {
  if (!displayDate) return "";
  const parts = displayDate.includes("/") ? displayDate.split("/") : displayDate.split("-");
  if (parts.length !== 3) return displayDate;
  
  // If M/D/YYYY format
  if (parts[2].length === 4) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // Already YYYY-MM-DD format
  return displayDate;
}

function getHallucinatedWarnings(warnings: VerificationWarning[]): VerificationWarning[] {
  return warnings.filter((w) => getWarningCategory(w) === "hallucinated");
}

function getUnverifiedWarnings(warnings: VerificationWarning[]): VerificationWarning[] {
  return warnings.filter((w) => getWarningCategory(w) === "unverified");
}

// Warning indicator component - shows different styles for hallucinated vs unverified
function WarningIndicator({ warning }: { warning?: VerificationWarning }) {
  if (!warning) return null;
  
  const isHallucinated = getWarningCategory(warning) === "hallucinated";
  
  // For unverified (weak evidence), show a subtler indicator
  if (!isHallucinated) {
    return (
      <div className="group relative inline-flex items-center">
        <svg
          className="h-4 w-4 text-blue-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-xs -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
          <p className="font-medium">Low confidence</p>
          <p className="opacity-80">Value: "{warning.value}"</p>
          <p className="opacity-60 text-xs mt-1">May need manual verification</p>
        </div>
      </div>
    );
  }
  
  // For hallucinated values, show the warning triangle
  return (
    <div className="group relative inline-flex items-center">
      <svg
        className="h-4 w-4 text-yellow-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <div className="absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-xs -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
        <p className="font-medium">Potentially hallucinated</p>
        <p className="opacity-80">Value: "{warning.value}"</p>
        <p className="opacity-60 text-xs mt-1">Not found in source document</p>
      </div>
    </div>
  );
}

const REF_TYPE_OPTIONS: { value: ReferenceNumberSubtype; label: string }[] = [
  { value: "po", label: "PO" },
  { value: "bol", label: "BOL" },
  { value: "order", label: "Order" },
  { value: "pickup", label: "Pickup #" },
  { value: "delivery", label: "Delivery #" },
  { value: "appointment", label: "Appointment" },
  { value: "reference", label: "Reference" },
  { value: "confirmation", label: "Confirmation" },
  { value: "pro", label: "PRO" },
  { value: "unknown", label: "Unknown" },
];

// ============================================
// Editable Components
// ============================================

function EditableRefBadge({
  ref,
  onChange,
  onDelete,
  warning,
}: {
  ref: ReferenceNumber;
  onChange: (updated: ReferenceNumber) => void;
  onDelete: () => void;
  warning?: VerificationWarning;
}) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-md border p-1 ${warning ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" : "border-border bg-bg-input"}`}>
      <input
        type="text"
        value={ref.value}
        onChange={(e) => onChange({ ...ref, value: e.target.value })}
        className="w-20 rounded bg-transparent px-1 text-sm font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <select
        value={ref.type}
        onChange={(e) =>
          onChange({ ...ref, type: e.target.value as ReferenceNumberSubtype })
        }
        className="rounded bg-bg-secondary px-1 py-0.5 text-xs font-medium text-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {REF_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <WarningIndicator warning={warning} />
      <button
        onClick={onDelete}
        className="ml-1 rounded p-0.5 text-text-muted hover:bg-error/20 hover:text-error"
        title="Remove"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function EditableStopCard({
  stop,
  onChange,
  stopIndex,
  typeIndex,
  warnings,
}: {
  stop: Stop;
  onChange: (updated: Stop) => void;
  stopIndex: number;
  typeIndex: number;
  warnings: VerificationWarning[];
}) {
  const [timeInput, setTimeInput] = useState(stop.schedule.time || "");
  const [timeError, setTimeError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const isPickup = stop.type === "pickup";
  const pathPrefix = `stops[${stopIndex}]`;
  const hasStopWarnings = hasWarningForPath(warnings, pathPrefix);
  const borderColor = isPickup ? "border-l-cyan-400" : "border-l-green-400";
  const typeLabel = isPickup ? "PICKUP" : "DELIVERY";
  const typeBg = isPickup
    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
    : "bg-green-500/20 text-green-400 border border-green-500/30";

  // Auto-resize notes textarea up to max height
  useEffect(() => {
    const textarea = notesRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 72; // ~3 lines
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [stop.notes]);

  // Sync time input when stop changes externally
  useEffect(() => {
    setTimeInput(stop.schedule.time || "");
  }, [stop.schedule.time]);

  const updateLocation = (field: string, value: string) => {
    onChange({
      ...stop,
      location: { ...stop.location, [field]: value || null },
    });
  };

  const updateSchedule = (field: string, value: string | boolean | null) => {
    onChange({
      ...stop,
      schedule: { ...stop.schedule, [field]: value },
    });
  };

  const updateRefNumber = (index: number, updated: ReferenceNumber) => {
    const newRefs = [...stop.reference_numbers];
    newRefs[index] = updated;
    onChange({ ...stop, reference_numbers: newRefs });
  };

  const deleteRefNumber = (index: number) => {
    onChange({
      ...stop,
      reference_numbers: stop.reference_numbers.filter((_, i) => i !== index),
    });
  };

  const addRefNumber = () => {
    onChange({
      ...stop,
      reference_numbers: [
        ...stop.reference_numbers,
        { type: "reference", value: "" },
      ],
    });
  };

  return (
    <div className={`rounded-xl border border-l-4 ${borderColor} ${hasStopWarnings ? "border-yellow-400 bg-yellow-900/10" : "glass-card"} p-5`}>
      {/* Stop header with type badge */}
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${typeBg}`}>
          {typeLabel} #{typeIndex}
        </span>
        {hasStopWarnings && (
          <span className="flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
            </svg>
            Needs review
          </span>
        )}
      </div>

      {/* Stacked Address Block */}
      <div className="mb-3 space-y-2">
        {/* Line 1: Facility Name */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={stop.location.name || ""}
            onChange={(e) => updateLocation("name", e.target.value)}
            placeholder="Facility / Company name"
            className={`flex-1 rounded-lg border bg-white/5 px-3 py-2 text-sm font-medium text-white placeholder:text-gray-500 focus:outline-none transition-all ${getWarningForPath(warnings, `${pathPrefix}.location.name`) ? "border-yellow-400" : "border-white/10 focus:border-cyan-400/50 focus:shadow-[0_0_10px_rgba(0,240,255,0.1)]"}`}
          />
          <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.location.name`)} />
        </div>

        {/* Line 2: Street Address */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={stop.location.address || ""}
            onChange={(e) => updateLocation("address", e.target.value)}
            placeholder="Street address"
            className={`flex-1 rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none transition-all ${getWarningForPath(warnings, `${pathPrefix}.location.address`) ? "border-yellow-400" : "border-white/10 focus:border-cyan-400/50 focus:shadow-[0_0_10px_rgba(0,240,255,0.1)]"}`}
          />
          <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.location.address`)} />
        </div>

        {/* Line 3: City, State ZIP */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <input
              type="text"
              value={stop.location.city || ""}
              onChange={(e) => updateLocation("city", e.target.value)}
              placeholder="City"
              className={`min-w-0 flex-1 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.location.city`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.location.city`)} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="text"
              value={stop.location.state || ""}
              onChange={(e) => updateLocation("state", e.target.value)}
              placeholder="ST"
              className={`w-14 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.location.state`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.location.state`)} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="text"
              value={stop.location.zip || ""}
              onChange={(e) => updateLocation("zip", e.target.value)}
              placeholder="ZIP"
              className={`w-20 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.location.zip`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.location.zip`)} />
          </div>
        </div>
      </div>

      {/* Schedule Fields */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* Date with calendar picker */}
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          <input
            type="date"
            value={formatDateForInput(stop.schedule.date)}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                // Convert YYYY-MM-DD to M/D/YYYY for storage
                const [year, month, day] = val.split("-");
                updateSchedule("date", `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`);
              } else {
                updateSchedule("date", null);
              }
            }}
            className={`w-36 rounded border bg-bg-input px-2 py-1 text-sm text-text-primary focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.schedule.date`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
          />
          <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.schedule.date`)} />
        </div>
        {/* Time with auto-normalization */}
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <input
              type="text"
              value={timeInput}
              onChange={(e) => {
                setTimeInput(e.target.value);
                setTimeError(null);
              }}
              onBlur={() => {
                if (!timeInput.trim()) {
                  updateSchedule("time", null);
                  setTimeError(null);
                  return;
                }
                const result = normalizeTime24h(timeInput);
                if (result.error) {
                  setTimeError(result.error);
                } else if (result.value) {
                  setTimeInput(result.value);
                  updateSchedule("time", result.value);
                  setTimeError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  const result = normalizeTime24h(timeInput);
                  if (result.value) {
                    setTimeInput(result.value);
                    updateSchedule("time", result.value);
                    setTimeError(null);
                  } else if (result.error) {
                    setTimeError(result.error);
                  }
                }
              }}
              placeholder="HH:MM"
              className={`w-20 rounded border bg-bg-input px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
                timeError 
                  ? "border-red-400 focus:border-red-500" 
                  : getWarningForPath(warnings, `${pathPrefix}.schedule.time`) 
                    ? "border-yellow-400" 
                    : "border-border focus:border-accent"
              }`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.schedule.time`)} />
          </div>
          {timeError && (
            <span className="mt-0.5 text-xs text-red-500">{timeError}</span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={stop.schedule.appointment_required || false}
            onChange={(e) => updateSchedule("appointment_required", e.target.checked)}
            className="rounded"
          />
          Appt Required
        </label>
      </div>

      {/* Stop Reference Numbers */}
      <div>
        <span className="mb-1 block text-xs text-text-muted">Stop References:</span>
        <div className="flex flex-wrap items-center gap-2">
          {stop.reference_numbers.length === 0 ? (
            <span className="text-xs italic text-text-muted">None</span>
          ) : (
            stop.reference_numbers.map((ref, i) => (
              <EditableRefBadge
                key={i}
                ref={ref}
                onChange={(updated) => updateRefNumber(i, updated)}
                onDelete={() => deleteRefNumber(i)}
                warning={getWarningForPath(warnings, `${pathPrefix}.reference_numbers[${i}].value`)}
              />
            ))
          )}
          <button
            onClick={addRefNumber}
            className="rounded border border-dashed border-border px-2 py-1 text-xs text-text-muted hover:border-accent hover:text-accent"
          >
            + Add Ref
          </button>
        </div>
      </div>

      {/* Notes - Auto-expanding up to 3 lines, then scrollable */}
      <div className="mt-3">
        <textarea
          ref={notesRef}
          value={stop.notes || ""}
          onChange={(e) => {
            onChange({ ...stop, notes: e.target.value || null });
            // Auto-resize on input up to max height
            if (notesRef.current) {
              notesRef.current.style.height = "auto";
              const maxHeight = 72; // ~3 lines
              const newHeight = Math.min(notesRef.current.scrollHeight, maxHeight);
              notesRef.current.style.height = `${newHeight}px`;
              notesRef.current.style.overflowY = notesRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
            }
          }}
          placeholder="Notes..."
          rows={1}
          className="w-full resize-none rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-secondary placeholder:text-text-muted focus:border-accent focus:outline-none whitespace-pre-wrap break-words"
          style={{ minHeight: "32px", maxHeight: "72px" }}
        />
      </div>
    </div>
  );
}

function EditableCargoCard({
  cargo,
  onChange,
  warnings,
}: {
  cargo: CargoDetails;
  onChange: (updated: CargoDetails) => void;
  warnings: VerificationWarning[];
}) {
  const hasCargoWarnings = hasWarningForPath(warnings, "cargo");
  
  return (
    <div className={`rounded-xl border border-l-4 border-l-orange-400 ${hasCargoWarnings ? "border-yellow-400 bg-yellow-900/10" : "glass-card"} p-5`}>
      {/* Cargo header with type badge */}
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full px-3 py-1 text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
          CARGO DETAILS
        </span>
        {hasCargoWarnings && (
          <span className="flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
            </svg>
            Has warnings
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Weight */}
        <div>
          <label className="mb-1 block text-xs text-text-muted">Weight</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={cargo.weight.value ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  weight: {
                    ...cargo.weight,
                    value: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="0"
              className={`flex-1 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:outline-none ${getWarningForPath(warnings, "cargo.weight.value") ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <select
              value={cargo.weight.unit || "lbs"}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  weight: { ...cargo.weight, unit: e.target.value as "lbs" | "kg" },
                })
              }
              className="rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
            <WarningIndicator warning={getWarningForPath(warnings, "cargo.weight.value")} />
          </div>
        </div>

        {/* Pieces */}
        <div>
          <label className="mb-1 block text-xs text-text-muted">Pieces</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={cargo.pieces.count ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  pieces: {
                    ...cargo.pieces,
                    count: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="0"
              className={`w-20 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:outline-none ${getWarningForPath(warnings, "cargo.pieces.count") ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, "cargo.pieces.count")} />
            <input
              type="text"
              value={cargo.pieces.type || ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  pieces: { ...cargo.pieces, type: e.target.value || null },
                })
              }
              placeholder="pallets, skids..."
              className={`flex-1 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, "cargo.pieces.type") ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, "cargo.pieces.type")} />
          </div>
        </div>

        {/* Dimensions */}
        <div>
          <label className="mb-1 block text-xs text-text-muted">Dimensions (L × W × H)</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={cargo.dimensions?.length ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  dimensions: {
                    ...(cargo.dimensions || { length: null, width: null, height: null, unit: "in" }),
                    length: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="L"
              className="w-14 rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
            <span className="text-text-muted">×</span>
            <input
              type="number"
              value={cargo.dimensions?.width ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  dimensions: {
                    ...(cargo.dimensions || { length: null, width: null, height: null, unit: "in" }),
                    width: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="W"
              className="w-14 rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
            <span className="text-text-muted">×</span>
            <input
              type="number"
              value={cargo.dimensions?.height ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  dimensions: {
                    ...(cargo.dimensions || { length: null, width: null, height: null, unit: "in" }),
                    height: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="H"
              className="w-14 rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
            <select
              value={cargo.dimensions?.unit || "in"}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  dimensions: {
                    ...(cargo.dimensions || { length: null, width: null, height: null, unit: "in" }),
                    unit: e.target.value as "in" | "cm" | "ft",
                  },
                })
              }
              className="rounded border border-border bg-bg-input px-1 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="in">in</option>
              <option value="cm">cm</option>
              <option value="ft">ft</option>
            </select>
          </div>
        </div>

        {/* Commodity */}
        <div>
          <label className="mb-1 block text-xs text-text-muted">Commodity</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={cargo.commodity || ""}
              onChange={(e) =>
                onChange({ ...cargo, commodity: e.target.value || null })
              }
              placeholder="Commodity description"
              className={`w-full rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, "cargo.commodity") ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, "cargo.commodity")} />
          </div>
        </div>

        {/* Temperature */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-text-muted">Temperature</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={cargo.temperature?.mode || ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  temperature: {
                    ...(cargo.temperature || { value: null, unit: "F", mode: null }),
                    mode: (e.target.value as "frozen" | "refrigerated" | "dry") || null,
                  },
                })
              }
              className="rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="">N/A</option>
              <option value="dry">Dry</option>
              <option value="refrigerated">Refrigerated</option>
              <option value="frozen">Frozen</option>
            </select>
            <input
              type="number"
              value={cargo.temperature?.value ?? ""}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  temperature: {
                    ...(cargo.temperature || { value: null, unit: "F", mode: null }),
                    value: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="Temp"
              className={`w-20 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:outline-none ${getWarningForPath(warnings, "cargo.temperature.value") ? "border-yellow-400" : "border-border focus:border-accent"}`}
            />
            <WarningIndicator warning={getWarningForPath(warnings, "cargo.temperature.value")} />
            <select
              value={cargo.temperature?.unit || "F"}
              onChange={(e) =>
                onChange({
                  ...cargo,
                  temperature: {
                    ...(cargo.temperature || { value: null, unit: "F", mode: null }),
                    unit: e.target.value as "F" | "C",
                  },
                })
              }
              className="rounded border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="F">°F</option>
              <option value="C">°C</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// CargoHintsPanel removed - cargo rules are now learned automatically from user edits

// ============================================
// Raw Candidates View (unchanged)
// ============================================

function groupCandidates(candidates: ExtractedCandidate[]) {
  const groups: Record<string, ExtractedCandidate[]> = {};
  for (const candidate of candidates) {
    const key = candidate.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(candidate);
  }
  return groups;
}

const TYPE_LABELS: Record<string, string> = {
  reference_number: "Reference Numbers",
  date: "Dates",
  time: "Times",
  address: "Addresses",
  city_state_zip: "Locations",
  weight: "Weights",
  pieces: "Pieces/Pallets",
  dimensions: "Dimensions",
  temperature: "Temperature",
  commodity: "Commodity",
};

const CONFIDENCE_STYLES = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function RawCandidatesView({ candidates }: { candidates: ExtractedCandidate[] }) {
  const grouped = groupCandidates(candidates);
  const groupKeys = Object.keys(grouped).sort();

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
        <p className="text-text-secondary">No fields extracted.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupKeys.map((type) => (
        <div key={type}>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-text-muted">
            {TYPE_LABELS[type] || type}
          </h3>
          <div className="space-y-2">
            {grouped[type].map((candidate, idx) => (
              <div key={`${type}-${idx}`} className="rounded-lg border border-border bg-bg-secondary p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{candidate.value}</span>
                      {candidate.subtype && candidate.subtype !== "unknown" && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
                          {candidate.subtype.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-text-secondary">{candidate.context}</p>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[candidate.confidence]}`}>
                    {candidate.confidence}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Original Tender Panel (PDF viewer or text)
// ============================================

type OriginalViewMode = "document" | "text";

// Memoized to prevent re-renders when parent state changes (e.g., on keystroke)
const OriginalTenderPanel = memo(function OriginalTenderPanel({
  tender,
  fileType,
  fileName,
}: {
  tender: Tender;
  fileType: string | null;
  fileName?: string;
}) {
  const [viewMode, setViewMode] = useState<OriginalViewMode>("document");
  const [pdfError, setPdfError] = useState(false);

  // Memoize the error handler to prevent PdfViewer re-renders
  const handlePdfError = useCallback(() => {
    setPdfError(true);
  }, []);

  const isPdf = fileType === "pdf" && tender.source_type === "file";
  const hasFileUrl = !!tender.original_file_url;
  const canShowDocument = isPdf && hasFileUrl && !pdfError;

  // For paste tenders or non-PDF files, always show text
  if (tender.source_type === "paste" || !isPdf) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4 h-[calc(100vh-220px)] min-h-[300px] overflow-y-auto">
        <pre className="whitespace-pre-wrap font-mono text-sm text-text-primary">
          {tender.original_text}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toggle buttons for PDF files */}
      {isPdf && hasFileUrl && (
        <div className="mb-2 flex rounded-lg border border-border bg-bg-input p-0.5 self-start">
          <button
            onClick={() => setViewMode("document")}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              viewMode === "document"
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Document
          </button>
          <button
            onClick={() => setViewMode("text")}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              viewMode === "text"
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Extracted Text
          </button>
        </div>
      )}

      {/* PDF Viewer or Text */}
      {viewMode === "document" && canShowDocument ? (
        <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden h-[calc(100vh-220px)] min-h-[500px]">
          <PdfViewer
            tenderId={tender.id}
            url={tender.original_file_url || undefined}
            fileName={fileName}
            onError={handlePdfError}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary p-4 max-h-[calc(100vh-220px)] min-h-[300px] overflow-y-auto">
          {pdfError && (
            <div className="mb-3 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              Could not load PDF preview. Showing extracted text instead.
            </div>
          )}
          <pre className="whitespace-pre-wrap font-mono text-sm text-text-primary">
            {tender.original_text}
          </pre>
        </div>
      )}
    </div>
  );
});

// ============================================
// Main Page Component
// ============================================

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<TenderData | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("structured");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Editable shipment state
  const [editedShipment, setEditedShipment] = useState<StructuredShipment | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Customer-related state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [suggestedRules, setSuggestedRules] = useState<SuggestedRule[]>([]);
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [needsReclassify, setNeedsReclassify] = useState(false);

  // Export-related state
  const [exportStatus, setExportStatus] = useState<ExportStatus>(null);
  const [exportLogs, setExportLogs] = useState<ExportLogDisplay[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [lastExportResult, setLastExportResult] = useState<{
    success: boolean;
    message?: string;
    dry_run?: boolean;
    payload?: Record<string, unknown>;
    warnings?: string[];
  } | null>(null);

  // Duplicate detection flag (from single upload dedupe)
  const isDuplicate = searchParams.get("duplicate") === "true";

  // Batch-related state
  const batchId = searchParams.get("batch");
  const [batchData, setBatchData] = useState<{
    batch: TenderBatch;
    items: TenderBatchItem[];
    summary: BatchSummary;
  } | null>(null);
  const [batchAdvancing, setBatchAdvancing] = useState(false);

  const tenderId = params.id as string;

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/tenders/${tenderId}`);
        if (!res.ok) throw new Error("Failed to load tender");
        const result = await res.json();
        setData(result);

        // Initialize editable state from LLM output
        if (result.extraction?.llm_output) {
          setEditedShipment(result.extraction.llm_output);
        }

        // Initialize customer selection
        if (result.tender?.customer_id) {
          setSelectedCustomerId(result.tender.customer_id);
        }

        setLoadingState("loaded");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoadingState("error");
      }
    }
    if (tenderId) fetchData();
  }, [tenderId]);

  // Fetch batch data when in batch mode
  useEffect(() => {
    if (!batchId) return;

    async function fetchBatchData() {
      try {
        const res = await fetch(`/api/tenders/batches/${batchId}`);
        if (!res.ok) return;
        const result = await res.json();
        setBatchData(result);
      } catch (err) {
        console.error("Failed to fetch batch data:", err);
      }
    }
    fetchBatchData();
  }, [batchId]);

  // Handle Save & Next for batch mode
  const handleSaveAndNext = async () => {
    if (!batchId || !editedShipment) return;

    // First save the current tender
    setSaveState("saving");
    try {
      const saveRes = await fetch(`/api/tenders/${tenderId}/final-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment: editedShipment,
          customer_id: selectedCustomerId,
        }),
      });

      if (!saveRes.ok) {
        throw new Error("Failed to save");
      }

      setSaveState("saved");
      setHasChanges(false);

      // Now advance the batch
      setBatchAdvancing(true);
      const advanceRes = await fetch(`/api/tenders/batches/${batchId}/advance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "next", tender_id: tenderId }),
      });

      if (!advanceRes.ok) {
        throw new Error("Failed to advance batch");
      }

      const advanceResult = await advanceRes.json();

      if (advanceResult.completed) {
        router.push(`/tenders/batch/${batchId}/complete`);
      } else if (advanceResult.next_tender_id) {
        router.push(`/tenders/${advanceResult.next_tender_id}/review?batch=${batchId}`);
      }
    } catch (err) {
      console.error("Save & Next error:", err);
      setSaveState("error");
    } finally {
      setBatchAdvancing(false);
    }
  };

  // Handle Skip for batch mode
  const handleSkip = async () => {
    if (!batchId) return;

    setBatchAdvancing(true);
    try {
      const res = await fetch(`/api/tenders/batches/${batchId}/advance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip", tender_id: tenderId }),
      });

      if (!res.ok) {
        throw new Error("Failed to skip");
      }

      const result = await res.json();

      if (result.completed) {
        router.push(`/tenders/batch/${batchId}/complete`);
      } else if (result.next_tender_id) {
        router.push(`/tenders/${result.next_tender_id}/review?batch=${batchId}`);
      }
    } catch (err) {
      console.error("Skip error:", err);
    } finally {
      setBatchAdvancing(false);
    }
  };

  const updateShipment = useCallback((updates: Partial<StructuredShipment>) => {
    setEditedShipment((prev) => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
    setHasChanges(true);
    setSaveState("idle");
  }, []);

  const updateStop = useCallback((index: number, updated: Stop) => {
    setEditedShipment((prev) => {
      if (!prev) return prev;
      const newStops = [...prev.stops];
      newStops[index] = updated;
      return { ...prev, stops: newStops };
    });
    setHasChanges(true);
    setSaveState("idle");
  }, []);

  const updateRefNumber = useCallback((index: number, updated: ReferenceNumber) => {
    setEditedShipment((prev) => {
      if (!prev) return prev;
      const newRefs = [...prev.reference_numbers];
      newRefs[index] = updated;
      return { ...prev, reference_numbers: newRefs };
    });
    setHasChanges(true);
    setSaveState("idle");
  }, []);

  const deleteRefNumber = useCallback((index: number) => {
    setEditedShipment((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reference_numbers: prev.reference_numbers.filter((_, i) => i !== index),
      };
    });
    setHasChanges(true);
    setSaveState("idle");
  }, []);

  const addRefNumber = useCallback(() => {
    setEditedShipment((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reference_numbers: [
          ...prev.reference_numbers,
          { type: "reference" as ReferenceNumberSubtype, value: "" },
        ],
      };
    });
    setHasChanges(true);
    setSaveState("idle");
  }, []);

  const handleSave = async (applyRules: SuggestedRule[] = []) => {
    if (!editedShipment) return;

    setSaveState("saving");
    try {
      const res = await fetch(`/api/tenders/${tenderId}/final-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment: editedShipment,
          customer_id: selectedCustomerId,
          apply_suggested_rules: applyRules,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      const result = await res.json();

      // Store suggested rules for display
      if (result.suggested_rules?.length > 0) {
        setSuggestedRules(result.suggested_rules);
        setShowRulesPanel(true);
      }

      setSaveState("saved");
      setHasChanges(false);

      // Update local tender status
      if (data) {
        setData({
          ...data,
          tender: { ...data.tender, status: "reviewed", customer_id: selectedCustomerId },
        });
      }
    } catch (err) {
      console.error("Save error:", err);
      setSaveState("error");
    }
  };

  const handleCustomerChange = (customerId: string) => {
    const newCustomerId = customerId || null;
    setSelectedCustomerId(newCustomerId);
    setHasChanges(true);
    setSaveState("idle");
    
    // If selecting a NEW customer (different from what tender was classified with),
    // show the reclassify option
    const wasClassifiedWithCustomer = data?.extraction?.metadata?.customer_id;
    if (newCustomerId && newCustomerId !== wasClassifiedWithCustomer) {
      setNeedsReclassify(true);
    } else {
      setNeedsReclassify(false);
    }
  };

  // Reprocess with customer context - runs full extraction pipeline server-side
  const handleReprocess = async () => {
    if (!selectedCustomerId || !tenderId) return;

    setReclassifying(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: selectedCustomerId }),
      });

      if (!res.ok) {
        throw new Error("Reprocessing failed");
      }

      const result = await res.json();

      // Update local state with new extraction results
      if (result.extraction?.llm_output) {
        setEditedShipment(result.extraction.llm_output);
      }

      // Update data with new extraction - use returned tender to preserve file URL
      if (data) {
        setData({
          ...data,
          tender: result.tender || { ...data.tender, customer_id: selectedCustomerId },
          extraction: result.extraction,
          customer: result.customer,
        });
      }

      setNeedsReclassify(false);
      setHasChanges(false);
      setSaveState("idle");
    } catch (err) {
      console.error("Reprocess error:", err);
    } finally {
      setReclassifying(false);
    }
  };

  const handleApplyRules = async (rulesToApply: SuggestedRule[]) => {
    if (!selectedCustomerId || rulesToApply.length === 0) return;

    try {
      for (const rule of rulesToApply) {
        await fetch(`/api/customers/${selectedCustomerId}/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: rule.type,
            label: rule.label,
            pattern: rule.pattern,
            subtype: rule.subtype,
            learned_from: tenderId,
          }),
        });
      }
      setSuggestedRules([]);
      setShowRulesPanel(false);
    } catch (err) {
      console.error("Failed to apply rules:", err);
    }
  };

  // handleSaveCargoHints removed - cargo rules are now learned automatically from user edits

  // Fetch export status and logs
  const fetchExportStatus = useCallback(async () => {
    if (!tenderId) return;
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export`);
      if (res.ok) {
        const result = await res.json();
        // Map status from tender.status for export-related states
        const tenderStatus = result.tender?.status;
        const exportStatusMap: Record<string, ExportStatus> = {
          "export_pending": "in_progress",
          "exported": "completed",
          "export_failed": "failed",
        };
        setExportStatus(exportStatusMap[tenderStatus] || null);
        // Use attempts instead of logs (new API format)
        setExportLogs((result.attempts || []).map((a: { 
          id: string; 
          mode: string; 
          status: string; 
          created_at: string;
          error_message?: string;
        }) => ({
          id: a.id,
          action: a.mode,
          status: a.status,
          created_at: a.created_at,
          error_message: a.error_message,
        })));
      }
    } catch (err) {
      console.error("Failed to fetch export status:", err);
    }
  }, [tenderId]);

  // Handle export (dry-run or live)
  const handleExport = async (dryRun: boolean = true) => {
    if (!tenderId) return;
    
    setExporting(true);
    setExportError(null);
    setLastExportResult(null);
    
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: dryRun ? "dry_run" : "live",
          provider: "mcleod",
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setExportError(result.error || "Export failed");
        setLastExportResult({
          success: false,
          message: result.error || result.errorMessage,
          warnings: result.validationErrors?.map((e: { message: string }) => e.message) || [],
        });
        return;
      }

      setLastExportResult({
        success: result.ok,
        message: result.ok 
          ? (dryRun ? "Dry run successful" : "Export successful") 
          : (result.errorMessage || "Export failed"),
        dry_run: result.mode === "dry_run",
        payload: result.mappedPayload,
        warnings: result.warnings || [],
      });

      if (result.ok && !dryRun) {
        // Update local tender status
        if (data) {
          setData({
            ...data,
            tender: {
              ...data.tender,
              status: "exported",
            } as Tender & { customer_id?: string | null },
          });
        }
      }

      // Refresh export logs
      fetchExportStatus();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Fetch export status on load (for reviewed, exported, or export_failed tenders)
  useEffect(() => {
    const status = data?.tender?.status;
    if (tenderId && (status === "reviewed" || status === "exported" || status === "export_failed")) {
      fetchExportStatus();
    }
  }, [tenderId, data?.tender?.status, fetchExportStatus]);

  if (loadingState === "loading") {
    return (
      <div className="min-h-screen bg-hero-gradient">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin mb-4 shadow-[0_0_20px_rgba(0,240,255,0.3)]" />
            <span className="text-gray-400">Processing tender...</span>
          </div>
        </div>
      </div>
    );
  }

  if (loadingState === "error" || !data) {
    return (
      <div className="min-h-screen bg-hero-gradient">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="glass-card !border-red-500/30 rounded-xl p-6">
            <h2 className="font-semibold text-red-400">Error Loading Tender</h2>
            <p className="mt-2 text-sm text-gray-400">{error}</p>
            <button onClick={() => router.push("/")} className="cta-button mt-4">
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { tender, extraction } = data;
  const candidates = extraction?.candidates || [];
  const hasStructured = editedShipment !== null;
  const verificationWarnings: VerificationWarning[] = extraction?.metadata?.verification_warnings || [];

  // Get current position in batch
  const currentBatchItem = batchData?.items.find(i => i.tender_id === tenderId);
  const currentPosition = currentBatchItem ? currentBatchItem.position + 1 : 0;

  return (
    <div className="min-h-screen bg-hero-gradient">
      {/* Header - compact single row */}
      <header className="sticky top-0 z-10 glass-card !rounded-none border-x-0 border-t-0">
        <div className="mx-auto max-w-6xl px-6 py-2">
          <div className="flex items-center justify-between gap-4">
            {/* Left side: Batch info (if in batch mode) OR just spacer */}
            <div className="flex items-center gap-3 min-w-0">
              {batchId && batchData ? (
                <>
                  {/* Compact batch info */}
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                    Batch Review: Tender {currentPosition} of {batchData.summary.total}
                  </span>
                  <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">
                    {batchData.summary.reviewed} reviewed
                  </span>
                  <span className="text-xs text-yellow-600 dark:text-yellow-400 whitespace-nowrap">
                    {batchData.summary.needs_review} pending
                  </span>
                  <Link
                    href={`/tenders/batch/${batchId}/review`}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
                  >
                    View All Files
                  </Link>
                  <button
                    onClick={handleSkip}
                    disabled={batchAdvancing}
                    className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleSaveAndNext}
                    disabled={batchAdvancing || saveState === "saving"}
                    className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                  >
                    {batchAdvancing || saveState === "saving" ? (
                      <>
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      "Save & Next"
                    )}
                  </button>
                </>
              ) : null}
            </div>

            {/* Right side: Customer selector + actions */}
            <div className="flex items-center gap-3 shrink-0">
              {/* Customer Selection */}
              <div className="flex items-center gap-2">
                <CustomerSelector
                  selectedCustomerId={selectedCustomerId}
                  onSelect={(id) => handleCustomerChange(id || "")}
                  className="w-[320px]"
                />
                {needsReclassify && selectedCustomerId && (
                  <button
                    onClick={handleReprocess}
                    disabled={reclassifying}
                    className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    title="Reprocess tender with customer-specific rules (server-side)"
                  >
                    {reclassifying ? (
                      <span className="flex items-center gap-1">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        ...
                      </span>
                    ) : (
                      "Reprocess"
                    )}
                  </button>
                )}
              </div>
              <div className="h-5 w-px bg-border" />
              {hasChanges && (
                <span className="text-xs text-text-muted">Unsaved</span>
              )}
              {saveState === "saved" && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              )}
              {saveState === "error" && (
                <span className="text-xs text-error">Failed</span>
              )}
              <button
                onClick={() => handleSave()}
                disabled={!hasChanges && saveState !== "error"}
                className="rounded-lg bg-gradient-to-r from-green-500/80 to-green-600/80 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveState === "saving" ? (
                  <span className="flex items-center gap-1">
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    ...
                  </span>
                ) : (
                  "Approve & Save"
                )}
              </button>
              {/* Export Button - Show for reviewed, exported, or export_failed tenders */}
              {(tender.status === "reviewed" || tender.status === "exported" || tender.status === "export_failed") && (
                <>
                  <div className="h-5 w-px bg-border" />
                  <div className="relative">
                    <button
                      onClick={() => setShowExportPanel(!showExportPanel)}
                      disabled={exporting}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        tender.status === "exported"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : tender.status === "export_failed"
                          ? "bg-error text-white hover:bg-error/90 disabled:opacity-50"
                          : "bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
                      }`}
                    >
                      {tender.status === "exported" ? (
                        <span className="flex items-center gap-1">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Exported
                        </span>
                      ) : tender.status === "export_failed" ? (
                        "Retry"
                      ) : exporting ? (
                        <span className="flex items-center gap-1">
                          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          ...
                        </span>
                      ) : (
                        "Export"
                      )}
                    </button>

                    {/* Export Dropdown Panel */}
                    {showExportPanel && (tender.status === "reviewed" || tender.status === "export_failed") && (
                      <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-bg-secondary p-4 shadow-xl">
                        <h3 className="mb-3 text-sm font-medium text-text-primary">Export Options</h3>
                        
                        {exportError && (
                          <div className="mb-3 rounded-md bg-error/10 border border-error/30 p-2">
                            <p className="text-xs text-error">{exportError}</p>
                          </div>
                        )}

                        {lastExportResult && (
                          <div className={`mb-3 rounded-md p-2 ${
                            lastExportResult.success 
                              ? "bg-success/10 border border-success/30" 
                              : "bg-error/10 border border-error/30"
                          }`}>
                            <p className={`text-xs ${lastExportResult.success ? "text-success" : "text-error"}`}>
                              {lastExportResult.message}
                            </p>
                            {lastExportResult.warnings && lastExportResult.warnings.length > 0 && (
                              <ul className="mt-1 list-disc list-inside text-xs text-yellow-600">
                                {lastExportResult.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        <div className="space-y-2">
                          <button
                            onClick={() => handleExport(true)}
                            disabled={exporting}
                            className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-secondary disabled:opacity-50"
                          >
                            Dry Run (Preview)
                          </button>
                          <button
                            onClick={() => handleExport(false)}
                            disabled={exporting}
                            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                          >
                            Export to McLeod
                          </button>
                        </div>

                        <p className="mt-3 text-xs text-text-muted">
                          Dry run validates the data without sending to McLeod.
                        </p>

                        {/* Export Logs */}
                        {exportLogs.length > 0 && (
                          <div className="mt-4 border-t border-border pt-3">
                            <h4 className="mb-2 text-xs font-medium text-text-muted">Recent Export Attempts</h4>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {exportLogs.slice(0, 5).map((log) => (
                                <div key={log.id} className="flex items-center justify-between text-xs">
                                  <span className={`px-1.5 py-0.5 rounded ${
                                    log.status === "success" ? "bg-success/20 text-success" :
                                    log.status === "failed" ? "bg-error/20 text-error" :
                                    "bg-gray-200 text-gray-600"
                                  }`}>
                                    {log.action === "dry_run" ? "DRY" : log.status.toUpperCase()}
                                  </span>
                                  <span className="text-text-muted">
                                    {new Date(log.created_at).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => setShowExportPanel(false)}
                          className="mt-3 w-full text-center text-xs text-text-muted hover:text-text-primary"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <button
                onClick={() => router.push("/")}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-cyan-400/30 hover:text-cyan-400 transition-all flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
                Home
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Duplicate Detection Banner - shows when single upload matched existing tender */}
      {isDuplicate && (
        <div className="border-b border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20">
          <div className="mx-auto max-w-6xl px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-200 dark:bg-orange-800">
                <svg
                  className="h-5 w-5 text-orange-700 dark:text-orange-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <p className="font-medium text-orange-800 dark:text-orange-300">
                  Duplicate - linked to existing tender
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-400">
                  This file was already uploaded. You are viewing the existing tender record.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hallucination Warning Banner - only shows for truly hallucinated values */}
      {(() => {
        const hallucinatedWarnings = getHallucinatedWarnings(verificationWarnings);
        const unverifiedWarnings = getUnverifiedWarnings(verificationWarnings);
        
        if (hallucinatedWarnings.length === 0 && unverifiedWarnings.length === 0) {
          return null;
        }
        
        // Only show banner for hallucinated values (LLM invented without source support)
        if (hallucinatedWarnings.length > 0) {
          return (
            <div className="border-b border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/30">
              <div className="mx-auto max-w-6xl px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-200 dark:bg-yellow-800">
                    <svg
                      className="h-5 w-5 text-yellow-700 dark:text-yellow-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-yellow-800 dark:text-yellow-300">
                      {hallucinatedWarnings.length} field{hallucinatedWarnings.length !== 1 ? "s" : ""} may contain hallucinated data
                    </p>
                    <p className="text-sm text-yellow-700 dark:text-yellow-400">
                      These values could not be verified against the source document. Please review the highlighted fields below.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        
        // For unverified-only warnings, show a subtler info banner (optional)
        // Currently we just don't show a banner for unverified fields
        return null;
      })()}

      {/* Suggested Rules Panel */}
      {showRulesPanel && suggestedRules.length > 0 && selectedCustomerId && (
        <div className="border-b border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30">
          <div className="mx-auto max-w-6xl px-6 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-200 dark:bg-blue-800">
                <svg
                  className="h-5 w-5 text-blue-700 dark:text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-blue-800 dark:text-blue-300">
                  {suggestedRules.length} learned rule{suggestedRules.length !== 1 ? "s" : ""} detected
                </p>
                <p className="mb-3 text-sm text-blue-700 dark:text-blue-400">
                  Based on your corrections, we can learn these patterns for future extractions:
                </p>
                <div className="space-y-2">
                  {suggestedRules.map((rule, i) => (
                    <div
                      key={i}
                      className="rounded-md bg-white/50 px-3 py-2 dark:bg-blue-900/50"
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        {/* Rule type badge */}
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          rule.type === "value_pattern" 
                            ? "bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-200"
                            : rule.type === "label"
                            ? "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200"
                            : "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                        }`}>
                          {rule.type === "value_pattern" ? "Value Pattern" : rule.type === "label" ? "Label" : "Regex"}
                        </span>
                        
                        {/* Rule details - monospace for regex patterns */}
                        <code className={`font-medium ${
                          rule.type === "value_pattern" 
                            ? "font-mono text-sm text-purple-900 dark:text-purple-200"
                            : "text-blue-900 dark:text-blue-200"
                        }`}>
                          {rule.type === "value_pattern" 
                            ? `${rule.pattern}` 
                            : rule.type === "label" 
                            ? `"${rule.label}"` 
                            : `${rule.pattern}`}
                        </code>
                        
                        <span className="text-blue-600 dark:text-blue-400">→</span>
                        
                        {/* Subtype */}
                        <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-800 dark:text-blue-200">
                          {rule.subtype.toUpperCase()}
                        </span>
                        
                        {/* Scope badge */}
                        {rule.scope && rule.scope !== "global" && (
                          <span className="rounded bg-orange-200 px-1.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-800 dark:text-orange-200">
                            {rule.scope}
                          </span>
                        )}
                        
                        {/* Match count for value_pattern rules */}
                        {rule.type === "value_pattern" && rule.match_count !== undefined && (
                          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                            {rule.match_count} match{rule.match_count !== 1 ? "es" : ""}
                          </span>
                        )}
                      </div>
                      
                      {/* Example matches for value_pattern rules - more transparency */}
                      {rule.type === "value_pattern" && rule.example_matches && rule.example_matches.length > 0 ? (
                        <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                          Matches: {rule.example_matches.slice(0, 3).map((m, j) => (
                            <code key={j} className="mx-0.5 rounded bg-blue-100 px-1 py-0.5 font-mono dark:bg-blue-800">
                              {m}
                            </code>
                          ))}
                          {rule.example_matches.length > 3 && <span>...</span>}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                          (e.g., <code className="rounded bg-blue-100 px-1 py-0.5 font-mono dark:bg-blue-800">{rule.example_value}</code>)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleApplyRules(suggestedRules)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Learn All Rules
                  </button>
                  <button
                    onClick={() => setShowRulesPanel(false)}
                    className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-600 dark:text-blue-300 dark:hover:bg-blue-900"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Profile Info */}
      {data.customer && (
        <div className="border-b border-border bg-bg-secondary/50">
          <div className="mx-auto max-w-6xl px-6 py-2">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-text-muted">Customer:</span>
              <span className="font-medium text-text-primary">{data.customer.name}</span>
              {extraction?.metadata?.applied_customer_rules && extraction.metadata.applied_customer_rules > 0 && (
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
                  {extraction.metadata.applied_customer_rules} rule{extraction.metadata.applied_customer_rules !== 1 ? "s" : ""} applied
                </span>
              )}
              {data.customer.reference_label_rules?.length > 0 && (
                <span className="text-text-muted">
                  ({data.customer.reference_label_rules.length} label rules)
                </span>
              )}
              {data.customer.cargo_hints?.commodity_by_temp && (
                <span className="text-text-muted">
                  (cargo rules set)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cargo rules are now learned automatically from user edits */}

      {/* Main Content */}
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          {/* Left: Original Tender */}
          <div className="flex flex-col">
            <h2 className="mb-3 text-lg font-semibold text-white">Original Tender</h2>
            <div className="flex-1 min-h-0">
              <OriginalTenderPanel
                tender={tender}
                fileType={data?.extraction?.metadata?.file_type || null}
                fileName={data?.extraction?.metadata?.file_name}
              />
            </div>
          </div>

          {/* Right: Editable Structured Fields */}
          <div className="flex flex-col h-[calc(100vh-180px)] min-h-[500px]">
            <div className="mb-3 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold text-white">
                {hasStructured ? "Structured Shipment" : "Extracted Fields"}
              </h2>
              {hasStructured && (
                <div className="flex rounded-lg glass-card p-1">
                  <button
                    onClick={() => setViewMode("structured")}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-all ${
                      viewMode === "structured"
                        ? "bg-cyan-500/20 text-cyan-400 shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-all ${
                      viewMode === "raw"
                        ? "bg-cyan-500/20 text-cyan-400 shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Raw ({candidates.length})
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
            {hasStructured && viewMode === "structured" && editedShipment ? (
              <div className="space-y-6 pr-2">
                {/* Shipment-level Reference Numbers */}
                <div>
                  <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-text-muted">
                    Shipment-Level References
                    {hasWarningForPath(verificationWarnings, "reference_numbers") && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium normal-case text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                        </svg>
                        Has warnings
                      </span>
                    )}
                  </h3>
                  {editedShipment.reference_numbers.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-bg-input/50 px-3 py-2">
                      <span className="text-sm text-text-muted">No shipment-level refs detected</span>
                      <button
                        onClick={addRefNumber}
                        className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:border-accent hover:text-accent"
                      >
                        + Add
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {editedShipment.reference_numbers.map((ref, i) => (
                        <EditableRefBadge
                          key={i}
                          ref={ref}
                          onChange={(updated) => updateRefNumber(i, updated)}
                          onDelete={() => deleteRefNumber(i)}
                          warning={getWarningForPath(verificationWarnings, `reference_numbers[${i}].value`)}
                        />
                      ))}
                      <button
                        onClick={addRefNumber}
                        className="rounded border border-dashed border-border px-2 py-1 text-xs text-text-muted hover:border-accent hover:text-accent"
                      >
                        + Add Reference
                      </button>
                    </div>
                  )}
                </div>

                {/* Stops */}
                <div className="space-y-4">
                  {(() => {
                    // Compute per-type indices for stop labeling
                    let pickupCount = 0;
                    let deliveryCount = 0;
                    return editedShipment.stops.map((stop, i) => {
                      const typeIndex = stop.type === "pickup" 
                        ? ++pickupCount 
                        : ++deliveryCount;
                      return (
                        <EditableStopCard
                          key={`stop-${i}`}
                          stop={stop}
                          onChange={(updated) => updateStop(i, updated)}
                          stopIndex={i}
                          typeIndex={typeIndex}
                          warnings={verificationWarnings}
                        />
                      );
                    });
                  })()}
                </div>

                {/* Cargo */}
                <EditableCargoCard
                  cargo={editedShipment.cargo}
                  onChange={(updated) => updateShipment({ cargo: updated })}
                  warnings={verificationWarnings}
                />

                {/* Unclassified Notes */}
                {editedShipment.unclassified_notes.length > 0 && (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-900/20">
                    <h3 className="mb-2 text-sm font-medium text-yellow-800 dark:text-yellow-400">
                      Unclassified / Needs Review
                    </h3>
                    <ul className="list-inside list-disc space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
                      {editedShipment.unclassified_notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Metadata */}
                <div className="rounded-lg border border-border bg-bg-input p-3 text-xs text-text-muted">
                  <p>
                    Classified by {editedShipment.classification_metadata.model} •{" "}
                    {new Date(editedShipment.classification_metadata.classified_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <RawCandidatesView candidates={candidates} />
            )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
