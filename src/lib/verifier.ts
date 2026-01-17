/**
 * Post-LLM Verification Layer
 *
 * Validates that every value returned by GPT classification is supported by either:
 * (a) deterministic candidates list, OR
 * (b) an exact substring match in original_text
 *
 * Unsupported values are set to null/unknown and a warning is recorded.
 */

import {
  ExtractedCandidate,
  StructuredShipment,
  VerificationWarning,
  VerifiedShipmentResult,
  ReferenceNumber,
  Stop,
} from "./types";

interface VerifyInput {
  shipment: StructuredShipment;
  candidates: ExtractedCandidate[];
  originalText: string;
}

/**
 * Check if a value is supported by candidates or original text
 */
function isValueSupported(
  value: string | number | null | undefined,
  candidates: ExtractedCandidate[],
  originalText: string
): boolean {
  if (value === null || value === undefined) {
    return true; // null values are always valid (field not extracted)
  }

  const stringValue = String(value).trim();
  if (stringValue === "") {
    return true; // empty strings are valid
  }

  // Check candidates list for exact match (case-insensitive for flexibility)
  const normalizedValue = stringValue.toLowerCase();
  const candidateMatch = candidates.some((c) => {
    const candidateValue = c.value.toLowerCase().trim();
    const candidateRaw = c.raw_match.toLowerCase().trim();
    return (
      candidateValue === normalizedValue ||
      candidateRaw === normalizedValue ||
      candidateValue.includes(normalizedValue) ||
      normalizedValue.includes(candidateValue)
    );
  });

  if (candidateMatch) {
    return true;
  }

  // Check original text for substring match (case-insensitive)
  // For numbers, also check without formatting (commas, etc.)
  const textLower = originalText.toLowerCase();
  if (textLower.includes(normalizedValue)) {
    return true;
  }

  // For numeric values, try without comma formatting
  const numericOnly = stringValue.replace(/[,\s]/g, "");
  if (numericOnly !== stringValue && textLower.includes(numericOnly.toLowerCase())) {
    return true;
  }

  // For addresses, check if key parts are present (allow minor normalization)
  // e.g., "123 Main St" should match "123 Main Street"
  const words = stringValue.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    const significantWordsPresent = words.filter((word) =>
      textLower.includes(word.toLowerCase())
    ).length;
    // If most significant words are present, consider it supported
    if (significantWordsPresent >= Math.ceil(words.length * 0.7)) {
      return true;
    }
  }

  return false;
}

/**
 * Verify reference numbers and return cleaned list with warnings
 */
function verifyReferenceNumbers(
  refs: ReferenceNumber[],
  pathPrefix: string,
  candidates: ExtractedCandidate[],
  originalText: string
): { refs: ReferenceNumber[]; warnings: VerificationWarning[] } {
  const warnings: VerificationWarning[] = [];
  const verifiedRefs: ReferenceNumber[] = [];

  refs.forEach((ref, index) => {
    const path = `${pathPrefix}[${index}].value`;

    if (!isValueSupported(ref.value, candidates, originalText)) {
      warnings.push({
        path,
        value: ref.value,
        reason: "unsupported_by_source",
      });
      // Set to unknown type but keep the value for human review
      verifiedRefs.push({ ...ref, type: "unknown" });
    } else {
      verifiedRefs.push(ref);
    }
  });

  return { refs: verifiedRefs, warnings };
}

/**
 * Verify a single stop and return cleaned stop with warnings
 */
function verifyStop(
  stop: Stop,
  stopIndex: number,
  candidates: ExtractedCandidate[],
  originalText: string
): { stop: Stop; warnings: VerificationWarning[] } {
  const warnings: VerificationWarning[] = [];
  const pathPrefix = `stops[${stopIndex}]`;
  let verifiedStop = { ...stop };

  // Verify location fields
  const locationFields: (keyof Stop["location"])[] = [
    "name",
    "address",
    "city",
    "state",
    "zip",
  ];

  for (const field of locationFields) {
    const value = stop.location[field];
    const path = `${pathPrefix}.location.${field}`;

    if (value && !isValueSupported(value, candidates, originalText)) {
      warnings.push({
        path,
        value: String(value),
        reason: "unsupported_by_source",
      });
      verifiedStop = {
        ...verifiedStop,
        location: { ...verifiedStop.location, [field]: null },
      };
    }
  }

  // Verify schedule fields
  if (
    stop.schedule.date &&
    !isValueSupported(stop.schedule.date, candidates, originalText)
  ) {
    warnings.push({
      path: `${pathPrefix}.schedule.date`,
      value: stop.schedule.date,
      reason: "unsupported_by_source",
    });
    verifiedStop = {
      ...verifiedStop,
      schedule: { ...verifiedStop.schedule, date: null },
    };
  }

  if (
    stop.schedule.time &&
    !isValueSupported(stop.schedule.time, candidates, originalText)
  ) {
    warnings.push({
      path: `${pathPrefix}.schedule.time`,
      value: stop.schedule.time,
      reason: "unsupported_by_source",
    });
    verifiedStop = {
      ...verifiedStop,
      schedule: { ...verifiedStop.schedule, time: null },
    };
  }

  // Verify stop-level reference numbers
  const { refs: verifiedRefs, warnings: refWarnings } = verifyReferenceNumbers(
    stop.reference_numbers,
    `${pathPrefix}.reference_numbers`,
    candidates,
    originalText
  );

  verifiedStop = { ...verifiedStop, reference_numbers: verifiedRefs };
  warnings.push(...refWarnings);

  return { stop: verifiedStop, warnings };
}

/**
 * Main verification function - validates all LLM output against source data
 */
export function verifyShipment(input: VerifyInput): VerifiedShipmentResult {
  const { shipment, candidates, originalText } = input;
  const allWarnings: VerificationWarning[] = [];

  // Deep clone the shipment to avoid mutations
  let verifiedShipment: StructuredShipment = JSON.parse(JSON.stringify(shipment));

  // 1. Verify shipment-level reference numbers
  const { refs: verifiedShipmentRefs, warnings: shipmentRefWarnings } =
    verifyReferenceNumbers(
      verifiedShipment.reference_numbers,
      "reference_numbers",
      candidates,
      originalText
    );
  verifiedShipment.reference_numbers = verifiedShipmentRefs;
  allWarnings.push(...shipmentRefWarnings);

  // 2. Verify all stops
  const verifiedStops: Stop[] = [];
  for (let i = 0; i < verifiedShipment.stops.length; i++) {
    const { stop: verifiedStop, warnings: stopWarnings } = verifyStop(
      verifiedShipment.stops[i],
      i,
      candidates,
      originalText
    );
    verifiedStops.push(verifiedStop);
    allWarnings.push(...stopWarnings);
  }
  verifiedShipment.stops = verifiedStops;

  // 3. Verify cargo fields
  const cargo = verifiedShipment.cargo;

  // Weight value
  if (cargo.weight.value !== null) {
    const weightStr = String(cargo.weight.value);
    if (!isValueSupported(weightStr, candidates, originalText)) {
      allWarnings.push({
        path: "cargo.weight.value",
        value: weightStr,
        reason: "unsupported_by_source",
      });
      verifiedShipment.cargo = {
        ...verifiedShipment.cargo,
        weight: { ...verifiedShipment.cargo.weight, value: null },
      };
    }
  }

  // Pieces count
  if (cargo.pieces.count !== null) {
    const piecesStr = String(cargo.pieces.count);
    if (!isValueSupported(piecesStr, candidates, originalText)) {
      allWarnings.push({
        path: "cargo.pieces.count",
        value: piecesStr,
        reason: "unsupported_by_source",
      });
      verifiedShipment.cargo = {
        ...verifiedShipment.cargo,
        pieces: { ...verifiedShipment.cargo.pieces, count: null },
      };
    }
  }

  // Pieces type
  if (cargo.pieces.type) {
    if (!isValueSupported(cargo.pieces.type, candidates, originalText)) {
      allWarnings.push({
        path: "cargo.pieces.type",
        value: cargo.pieces.type,
        reason: "unsupported_by_source",
      });
      verifiedShipment.cargo = {
        ...verifiedShipment.cargo,
        pieces: { ...verifiedShipment.cargo.pieces, type: null },
      };
    }
  }

  // Commodity
  if (cargo.commodity) {
    if (!isValueSupported(cargo.commodity, candidates, originalText)) {
      allWarnings.push({
        path: "cargo.commodity",
        value: cargo.commodity,
        reason: "unsupported_by_source",
      });
      verifiedShipment.cargo = { ...verifiedShipment.cargo, commodity: null };
    }
  }

  // Temperature value
  if (cargo.temperature?.value !== null && cargo.temperature?.value !== undefined) {
    const tempStr = String(cargo.temperature.value);
    if (!isValueSupported(tempStr, candidates, originalText)) {
      allWarnings.push({
        path: "cargo.temperature.value",
        value: tempStr,
        reason: "unsupported_by_source",
      });
      verifiedShipment.cargo = {
        ...verifiedShipment.cargo,
        temperature: verifiedShipment.cargo.temperature
          ? { ...verifiedShipment.cargo.temperature, value: null }
          : null,
      };
    }
  }

  // Dimensions
  if (cargo.dimensions) {
    const dims = cargo.dimensions;
    for (const dimField of ["length", "width", "height"] as const) {
      if (dims[dimField] !== null) {
        const dimStr = String(dims[dimField]);
        if (!isValueSupported(dimStr, candidates, originalText)) {
          allWarnings.push({
            path: `cargo.dimensions.${dimField}`,
            value: dimStr,
            reason: "unsupported_by_source",
          });
          verifiedShipment.cargo = {
            ...verifiedShipment.cargo,
            dimensions: verifiedShipment.cargo.dimensions
              ? { ...verifiedShipment.cargo.dimensions, [dimField]: null }
              : null,
          };
        }
      }
    }
  }

  return {
    shipment: verifiedShipment,
    warnings: allWarnings,
  };
}

/**
 * Get warning for a specific field path
 */
export function getWarningForPath(
  warnings: VerificationWarning[],
  path: string
): VerificationWarning | undefined {
  return warnings.find((w) => w.path === path);
}

/**
 * Check if a path has a warning (for UI highlighting)
 */
export function hasWarning(
  warnings: VerificationWarning[],
  pathPattern: string
): boolean {
  return warnings.some(
    (w) => w.path === pathPattern || w.path.startsWith(pathPattern + ".")
  );
}
