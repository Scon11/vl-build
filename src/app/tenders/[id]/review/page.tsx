"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
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
} from "@/lib/types";

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
  const isPickup = stop.type === "pickup";
  const pathPrefix = `stops[${stopIndex}]`;
  const hasStopWarnings = hasWarningForPath(warnings, pathPrefix);
  const borderColor = isPickup ? "border-l-blue-500" : "border-l-green-500";
  const typeLabel = isPickup ? "PICKUP" : "DELIVERY";
  const typeBg = isPickup
    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";

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
    <div className={`rounded-lg border border-l-4 ${borderColor} ${hasStopWarnings ? "border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10" : "border-border bg-bg-secondary"} p-4`}>
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
            className={`flex-1 rounded border bg-bg-input px-2 py-1.5 text-sm font-medium text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.location.name`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
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
            className={`flex-1 rounded border bg-bg-input px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.location.address`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
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
        <div className="flex items-center gap-1">
          <span className="text-sm text-text-muted">📅</span>
          <input
            type="text"
            value={stop.schedule.date || ""}
            onChange={(e) => updateSchedule("date", e.target.value || null)}
            placeholder="Date"
            className={`w-28 rounded border bg-bg-input px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.schedule.date`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
          />
          <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.schedule.date`)} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm text-text-muted">🕐</span>
          <input
            type="text"
            value={stop.schedule.time || ""}
            onChange={(e) => updateSchedule("time", e.target.value || null)}
            placeholder="Time"
            className={`w-20 rounded border bg-bg-input px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${getWarningForPath(warnings, `${pathPrefix}.schedule.time`) ? "border-yellow-400" : "border-border focus:border-accent"}`}
          />
          <WarningIndicator warning={getWarningForPath(warnings, `${pathPrefix}.schedule.time`)} />
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

      {/* Notes */}
      <div className="mt-3">
        <input
          type="text"
          value={stop.notes || ""}
          onChange={(e) => onChange({ ...stop, notes: e.target.value || null })}
          placeholder="Notes..."
          className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm italic text-text-muted placeholder:text-text-muted focus:border-border focus:outline-none"
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
    <div className={`rounded-lg border p-4 ${hasCargoWarnings ? "border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10" : "border-border bg-bg-secondary"}`}>
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">
        Cargo Details
        {hasCargoWarnings && (
          <span className="ml-2 inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium normal-case text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
            </svg>
            Has warnings
          </span>
        )}
      </h3>
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

function OriginalTenderPanel({
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

  const isPdf = fileType === "pdf" && tender.source_type === "file";
  const hasFileUrl = !!tender.original_file_url;
  const canShowDocument = isPdf && hasFileUrl && !pdfError;

  // For paste tenders or non-PDF files, always show text
  if (tender.source_type === "paste" || !isPdf) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
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
        <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden" style={{ height: "600px" }}>
          <PdfViewer
            url={tender.original_file_url!}
            fileName={fileName}
            onError={() => setPdfError(true)}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary p-4" style={{ maxHeight: "600px", overflowY: "auto" }}>
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
}

// ============================================
// Main Page Component
// ============================================

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<TenderData | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("structured");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Editable shipment state
  const [editedShipment, setEditedShipment] = useState<StructuredShipment | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Customer-related state
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [suggestedRules, setSuggestedRules] = useState<SuggestedRule[]>([]);
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [needsReclassify, setNeedsReclassify] = useState(false);

  const tenderId = params.id as string;

  // Fetch customers list
  useEffect(() => {
    async function fetchCustomers() {
      try {
        const res = await fetch("/api/customers");
        if (res.ok) {
          const result = await res.json();
          setCustomers(result.customers || []);
        }
      } catch {
        // Silently fail - customers are optional
      }
    }
    fetchCustomers();
  }, []);

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

  if (loadingState === "loading") {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-center justify-center py-20">
            <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-text-secondary">Processing tender...</span>
          </div>
        </div>
      </div>
    );
  }

  if (loadingState === "error" || !data) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="rounded-lg border border-error/30 bg-error/10 p-6">
            <h2 className="font-medium text-error">Error Loading Tender</h2>
            <p className="mt-2 text-sm text-text-secondary">{error}</p>
            <button onClick={() => router.push("/")} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
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

  const statusBadge = {
    draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    reviewed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    exported: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg-secondary">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl font-semibold text-text-primary">Review Extraction</h1>
                <p className="text-sm text-text-secondary">
                  <code className="rounded bg-bg-input px-1.5 py-0.5 font-mono text-xs">
                    {tender.id.slice(0, 8)}...
                  </code>
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[tender.status || "draft"]}`}>
                {(tender.status || "draft").toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Customer Selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-text-muted">Customer:</label>
                <select
                  value={selectedCustomerId || ""}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  className="rounded-md border border-border bg-bg-input px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">-- Select Customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `(${c.code})` : ""}
                    </option>
                  ))}
                </select>
                {needsReclassify && selectedCustomerId && (
                  <button
                    onClick={handleReprocess}
                    disabled={reclassifying}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    title="Reprocess tender with customer-specific rules (server-side)"
                  >
                    {reclassifying ? (
                      <span className="flex items-center gap-1">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Reprocessing...
                      </span>
                    ) : (
                      "🔄 Reprocess with Customer"
                    )}
                  </button>
                )}
              </div>
              {/* Note: Cargo rules are now learned automatically from edits */}
              <div className="mx-2 h-6 w-px bg-border" />
              {hasChanges && (
                <span className="text-sm text-text-muted">Unsaved changes</span>
              )}
              {saveState === "saved" && (
                <span className="flex items-center gap-1 text-sm text-success">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              )}
              {saveState === "error" && (
                <span className="text-sm text-error">Save failed</span>
              )}
              <button
                onClick={() => handleSave()}
                disabled={!hasChanges && saveState !== "error"}
                className="rounded-md bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveState === "saving" ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving...
                  </span>
                ) : (
                  "Approve & Save"
                )}
              </button>
              <button
                onClick={() => router.push("/")}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-input"
              >
                ← New Tender
              </button>
            </div>
          </div>
        </div>
      </header>

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
                      className="flex items-center justify-between rounded-md bg-white/50 px-3 py-2 dark:bg-blue-900/50"
                    >
                      <div>
                        <span className="font-medium text-blue-900 dark:text-blue-200">
                          {rule.type === "label" ? `"${rule.label}"` : `Pattern: ${rule.pattern}`}
                        </span>
                        <span className="mx-2 text-blue-600 dark:text-blue-400">→</span>
                        <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-800 dark:text-blue-200">
                          {rule.subtype.toUpperCase()}
                        </span>
                        <span className="ml-2 text-sm text-blue-600 dark:text-blue-400">
                          (e.g., "{rule.example_value}")
                        </span>
                      </div>
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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left: Original Tender */}
          <div>
            <h2 className="mb-4 text-lg font-medium text-text-primary">Original Tender</h2>
            <OriginalTenderPanel
              tender={tender}
              fileType={data?.extraction?.metadata?.file_type || null}
              fileName={data?.extraction?.metadata?.file_name}
            />
          </div>

          {/* Right: Editable Structured Fields */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium text-text-primary">
                {hasStructured ? "Structured Shipment" : "Extracted Fields"}
              </h2>
              {hasStructured && (
                <div className="flex rounded-lg border border-border bg-bg-input p-0.5">
                  <button
                    onClick={() => setViewMode("structured")}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      viewMode === "structured"
                        ? "bg-bg-secondary text-text-primary shadow-sm"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      viewMode === "raw"
                        ? "bg-bg-secondary text-text-primary shadow-sm"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    Raw ({candidates.length})
                  </button>
                </div>
              )}
            </div>

            {hasStructured && viewMode === "structured" && editedShipment ? (
              <div className="space-y-6">
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
      </main>
    </div>
  );
}
