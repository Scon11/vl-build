/**
 * Post-LLM Verification Layer with Provenance Tracking
 *
 * Validates that every value returned by GPT classification is supported by either:
 * (a) deterministic candidates list, OR
 * (b) an exact substring match in original_text
 *
 * Key changes from previous version:
 * - Tracks provenance for each field (where the value came from)
 * - Only flags values as "hallucinated" if source_type === "llm_inference" AND no evidence
 * - Values from "rule", "user_edit", "document_text" are never flagged as hallucinated
 * - Separates "hallucinated" (LLM invented) from "unverified" (weak evidence)
 */

import {
  ExtractedCandidate,
  StructuredShipment,
  VerificationWarning,
  VerifiedShipmentResult,
  ReferenceNumber,
  Stop,
  FieldProvenance,
  FieldProvenanceMap,
  ProvenanceEvidence,
  ProvenanceSourceType,
  WarningCategory,
} from "./types";

interface VerifyInput {
  shipment: StructuredShipment;
  candidates: ExtractedCandidate[];
  originalText: string;
  /** Optional: pre-existing provenance from earlier stages (e.g., cargo defaults from rules) */
  existingProvenance?: FieldProvenanceMap;
}

interface ValueSupportResult {
  supported: boolean;
  confidence: number;
  evidence: ProvenanceEvidence[];
}

/**
 * Check if a value is supported by candidates or original text.
 * Returns detailed evidence about what was found.
 */
function checkValueSupport(
  value: string | number | null | undefined,
  candidates: ExtractedCandidate[],
  originalText: string
): ValueSupportResult {
  if (value === null || value === undefined) {
    return { supported: true, confidence: 1, evidence: [] };
  }

  const stringValue = String(value).trim();
  if (stringValue === "") {
    return { supported: true, confidence: 1, evidence: [] };
  }

  const normalizedValue = stringValue.toLowerCase();
  const evidence: ProvenanceEvidence[] = [];
  let bestConfidence = 0;

  // Check candidates list for exact or partial match
  candidates.forEach((c, index) => {
    const candidateValue = c.value.toLowerCase().trim();
    const candidateRaw = c.raw_match.toLowerCase().trim();

    if (candidateValue === normalizedValue || candidateRaw === normalizedValue) {
      // Exact match in candidate
      evidence.push({
        match_text: c.raw_match,
        char_start: c.position.start,
        char_end: c.position.end,
        label: c.label_hint ?? undefined,
        candidate_index: index,
      });
      bestConfidence = Math.max(bestConfidence, c.confidence === "high" ? 0.95 : c.confidence === "medium" ? 0.8 : 0.6);
    } else if (candidateValue.includes(normalizedValue) || normalizedValue.includes(candidateValue)) {
      // Partial match
      evidence.push({
        match_text: c.raw_match,
        char_start: c.position.start,
        char_end: c.position.end,
        label: c.label_hint ?? undefined,
        candidate_index: index,
      });
      bestConfidence = Math.max(bestConfidence, 0.7);
    }
  });

  if (evidence.length > 0) {
    return { supported: true, confidence: bestConfidence, evidence };
  }

  // Check original text for substring match
  const textLower = originalText.toLowerCase();
  const matchIndex = textLower.indexOf(normalizedValue);
  if (matchIndex !== -1) {
    evidence.push({
      match_text: originalText.substring(matchIndex, matchIndex + stringValue.length),
      char_start: matchIndex,
      char_end: matchIndex + stringValue.length,
    });
    return { supported: true, confidence: 0.85, evidence };
  }

  // For numeric values, try without comma formatting
  const numericOnly = stringValue.replace(/[,\s]/g, "");
  if (numericOnly !== stringValue) {
    const numMatchIndex = textLower.indexOf(numericOnly.toLowerCase());
    if (numMatchIndex !== -1) {
      evidence.push({
        match_text: originalText.substring(numMatchIndex, numMatchIndex + numericOnly.length),
        char_start: numMatchIndex,
        char_end: numMatchIndex + numericOnly.length,
      });
      return { supported: true, confidence: 0.8, evidence };
    }
  }

  // For addresses/multi-word values, check if key parts are present
  const words = stringValue.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    const matchingWords = words.filter((word) => textLower.includes(word.toLowerCase()));
    const ratio = matchingWords.length / words.length;
    if (ratio >= 0.7) {
      // Most significant words present - partial support
      return { 
        supported: true, 
        confidence: 0.5 + (ratio * 0.3), // 0.5-0.8 based on match ratio
        evidence: [{ match_text: matchingWords.join(" ") }] 
      };
    }
  }

  return { supported: false, confidence: 0, evidence: [] };
}

/**
 * Create a provenance record for a field based on verification results.
 */
function createProvenance(
  supportResult: ValueSupportResult,
  existingProvenance?: FieldProvenance
): FieldProvenance {
  // If we have existing provenance (e.g., from a rule), preserve it
  if (existingProvenance && existingProvenance.source_type !== "llm_inference") {
    return existingProvenance;
  }

  // For LLM-inferred values, use the support check results
  const sourceType: ProvenanceSourceType = supportResult.supported ? "document_text" : "llm_inference";
  
  return {
    source_type: sourceType,
    confidence: supportResult.confidence,
    evidence: supportResult.evidence,
    applied_at: new Date().toISOString(),
  };
}

/**
 * Determine if a field should trigger a warning and what category.
 */
function shouldWarn(
  provenance: FieldProvenance,
  supportResult: ValueSupportResult
): { warn: boolean; category: WarningCategory; reason: string } {
  // Values from rules, user edits, or document text are NEVER flagged as hallucinated
  if (provenance.source_type !== "llm_inference") {
    // Could still be "unverified" if confidence is very low, but not "hallucinated"
    if (provenance.confidence < 0.4) {
      return { warn: true, category: "unverified", reason: "weak_evidence" };
    }
    return { warn: false, category: "unverified", reason: "" };
  }

  // For LLM-inferred values, check if they have source support
  if (!supportResult.supported) {
    return { warn: true, category: "hallucinated", reason: "unsupported_by_source" };
  }

  // LLM value is supported but confidence is low
  if (supportResult.confidence < 0.55) {
    return { warn: true, category: "unverified", reason: "weak_evidence" };
  }

  // Multiple matches could be ambiguous
  if (supportResult.evidence.length > 2) {
    return { warn: true, category: "unverified", reason: "ambiguous_match" };
  }

  return { warn: false, category: "unverified", reason: "" };
}

/**
 * Verify reference numbers and return cleaned list with warnings and provenance.
 */
function verifyReferenceNumbers(
  refs: ReferenceNumber[],
  pathPrefix: string,
  candidates: ExtractedCandidate[],
  originalText: string,
  existingProvenance: FieldProvenanceMap
): { refs: ReferenceNumber[]; warnings: VerificationWarning[]; provenance: FieldProvenanceMap } {
  const warnings: VerificationWarning[] = [];
  const provenance: FieldProvenanceMap = {};
  const verifiedRefs: ReferenceNumber[] = [];

  refs.forEach((ref, index) => {
    const path = `${pathPrefix}[${index}].value`;
    const supportResult = checkValueSupport(ref.value, candidates, originalText);
    const fieldProvenance = createProvenance(supportResult, existingProvenance[path]);
    provenance[path] = fieldProvenance;

    const warnResult = shouldWarn(fieldProvenance, supportResult);
    if (warnResult.warn) {
      warnings.push({
        path,
        value: ref.value,
        reason: warnResult.reason as "unsupported_by_source" | "weak_evidence" | "ambiguous_match",
        category: warnResult.category,
        source_type: fieldProvenance.source_type,
      });
      if (warnResult.category === "hallucinated") {
        // Only nullify for true hallucinations
        verifiedRefs.push({ ...ref, type: "unknown" });
      } else {
        verifiedRefs.push(ref);
      }
    } else {
      verifiedRefs.push(ref);
    }
  });

  return { refs: verifiedRefs, warnings, provenance };
}

/**
 * Verify a single stop and return cleaned stop with warnings and provenance.
 */
function verifyStop(
  stop: Stop,
  stopIndex: number,
  candidates: ExtractedCandidate[],
  originalText: string,
  existingProvenance: FieldProvenanceMap
): { stop: Stop; warnings: VerificationWarning[]; provenance: FieldProvenanceMap } {
  const warnings: VerificationWarning[] = [];
  const provenance: FieldProvenanceMap = {};
  const pathPrefix = `stops[${stopIndex}]`;
  let verifiedStop = { ...stop };

  // Verify location fields
  const locationFields: (keyof Stop["location"])[] = ["name", "address", "city", "state", "zip"];

  for (const field of locationFields) {
    const value = stop.location[field];
    const path = `${pathPrefix}.location.${field}`;
    
    if (value) {
      const supportResult = checkValueSupport(value, candidates, originalText);
      const fieldProvenance = createProvenance(supportResult, existingProvenance[path]);
      provenance[path] = fieldProvenance;

      const warnResult = shouldWarn(fieldProvenance, supportResult);
      if (warnResult.warn) {
        warnings.push({
          path,
          value: String(value),
          reason: warnResult.reason as "unsupported_by_source" | "weak_evidence" | "ambiguous_match",
          category: warnResult.category,
          source_type: fieldProvenance.source_type,
        });
        if (warnResult.category === "hallucinated") {
          verifiedStop = {
            ...verifiedStop,
            location: { ...verifiedStop.location, [field]: null },
          };
        }
      }
    }
  }

  // Verify schedule fields
  if (stop.schedule.date) {
    const path = `${pathPrefix}.schedule.date`;
    const supportResult = checkValueSupport(stop.schedule.date, candidates, originalText);
    const fieldProvenance = createProvenance(supportResult, existingProvenance[path]);
    provenance[path] = fieldProvenance;

    const warnResult = shouldWarn(fieldProvenance, supportResult);
    if (warnResult.warn) {
      warnings.push({
        path,
        value: stop.schedule.date,
        reason: warnResult.reason as "unsupported_by_source" | "weak_evidence" | "ambiguous_match",
        category: warnResult.category,
        source_type: fieldProvenance.source_type,
      });
      if (warnResult.category === "hallucinated") {
        verifiedStop = {
          ...verifiedStop,
          schedule: { ...verifiedStop.schedule, date: null },
        };
      }
    }
  }

  if (stop.schedule.time) {
    const path = `${pathPrefix}.schedule.time`;
    const supportResult = checkValueSupport(stop.schedule.time, candidates, originalText);
    const fieldProvenance = createProvenance(supportResult, existingProvenance[path]);
    provenance[path] = fieldProvenance;

    const warnResult = shouldWarn(fieldProvenance, supportResult);
    if (warnResult.warn) {
      warnings.push({
        path,
        value: stop.schedule.time,
        reason: warnResult.reason as "unsupported_by_source" | "weak_evidence" | "ambiguous_match",
        category: warnResult.category,
        source_type: fieldProvenance.source_type,
      });
      if (warnResult.category === "hallucinated") {
        verifiedStop = {
          ...verifiedStop,
          schedule: { ...verifiedStop.schedule, time: null },
        };
      }
    }
  }

  // Verify stop-level reference numbers
  const { refs: verifiedRefs, warnings: refWarnings, provenance: refProvenance } = 
    verifyReferenceNumbers(
      stop.reference_numbers,
      `${pathPrefix}.reference_numbers`,
      candidates,
      originalText,
      existingProvenance
    );

  verifiedStop = { ...verifiedStop, reference_numbers: verifiedRefs };
  warnings.push(...refWarnings);
  Object.assign(provenance, refProvenance);

  return { stop: verifiedStop, warnings, provenance };
}

/**
 * Verify a cargo field value.
 */
function verifyCargoField(
  value: string | number | null | undefined,
  path: string,
  candidates: ExtractedCandidate[],
  originalText: string,
  existingProvenance: FieldProvenanceMap
): { warnings: VerificationWarning[]; provenance: FieldProvenance | null; nullify: boolean } {
  if (value === null || value === undefined) {
    return { warnings: [], provenance: null, nullify: false };
  }

  const supportResult = checkValueSupport(value, candidates, originalText);
  const fieldProvenance = createProvenance(supportResult, existingProvenance[path]);
  const warnResult = shouldWarn(fieldProvenance, supportResult);

  const warnings: VerificationWarning[] = [];
  if (warnResult.warn) {
    warnings.push({
      path,
      value: String(value),
      reason: warnResult.reason as "unsupported_by_source" | "weak_evidence" | "ambiguous_match",
      category: warnResult.category,
      source_type: fieldProvenance.source_type,
    });
  }

  return {
    warnings,
    provenance: fieldProvenance,
    nullify: warnResult.warn && warnResult.category === "hallucinated",
  };
}

/**
 * Main verification function - validates all LLM output against source data.
 * Now with provenance tracking for each field.
 */
export function verifyShipment(input: VerifyInput): VerifiedShipmentResult {
  const { shipment, candidates, originalText, existingProvenance = {} } = input;
  const allWarnings: VerificationWarning[] = [];
  const allProvenance: FieldProvenanceMap = { ...existingProvenance };

  // Deep clone the shipment to avoid mutations
  let verifiedShipment: StructuredShipment = JSON.parse(JSON.stringify(shipment));

  // 1. Verify shipment-level reference numbers
  const { refs: verifiedShipmentRefs, warnings: shipmentRefWarnings, provenance: refProvenance } =
    verifyReferenceNumbers(
      verifiedShipment.reference_numbers,
      "reference_numbers",
      candidates,
      originalText,
      existingProvenance
    );
  verifiedShipment.reference_numbers = verifiedShipmentRefs;
  allWarnings.push(...shipmentRefWarnings);
  Object.assign(allProvenance, refProvenance);

  // 2. Verify all stops
  const verifiedStops: Stop[] = [];
  for (let i = 0; i < verifiedShipment.stops.length; i++) {
    const { stop: verifiedStop, warnings: stopWarnings, provenance: stopProvenance } = verifyStop(
      verifiedShipment.stops[i],
      i,
      candidates,
      originalText,
      existingProvenance
    );
    verifiedStops.push(verifiedStop);
    allWarnings.push(...stopWarnings);
    Object.assign(allProvenance, stopProvenance);
  }
  verifiedShipment.stops = verifiedStops;

  // 3. Verify cargo fields
  const cargo = verifiedShipment.cargo;

  // Weight value
  const weightResult = verifyCargoField(
    cargo.weight.value,
    "cargo.weight.value",
    candidates,
    originalText,
    existingProvenance
  );
  allWarnings.push(...weightResult.warnings);
  if (weightResult.provenance) allProvenance["cargo.weight.value"] = weightResult.provenance;
  if (weightResult.nullify) {
    verifiedShipment.cargo = {
      ...verifiedShipment.cargo,
      weight: { ...verifiedShipment.cargo.weight, value: null },
    };
  }

  // Pieces count
  const piecesResult = verifyCargoField(
    cargo.pieces.count,
    "cargo.pieces.count",
    candidates,
    originalText,
    existingProvenance
  );
  allWarnings.push(...piecesResult.warnings);
  if (piecesResult.provenance) allProvenance["cargo.pieces.count"] = piecesResult.provenance;
  if (piecesResult.nullify) {
    verifiedShipment.cargo = {
      ...verifiedShipment.cargo,
      pieces: { ...verifiedShipment.cargo.pieces, count: null },
    };
  }

  // Pieces type
  const piecesTypeResult = verifyCargoField(
    cargo.pieces.type,
    "cargo.pieces.type",
    candidates,
    originalText,
    existingProvenance
  );
  allWarnings.push(...piecesTypeResult.warnings);
  if (piecesTypeResult.provenance) allProvenance["cargo.pieces.type"] = piecesTypeResult.provenance;
  if (piecesTypeResult.nullify) {
    verifiedShipment.cargo = {
      ...verifiedShipment.cargo,
      pieces: { ...verifiedShipment.cargo.pieces, type: null },
    };
  }

  // Commodity
  const commodityResult = verifyCargoField(
    cargo.commodity,
    "cargo.commodity",
    candidates,
    originalText,
    existingProvenance
  );
  allWarnings.push(...commodityResult.warnings);
  if (commodityResult.provenance) allProvenance["cargo.commodity"] = commodityResult.provenance;
  if (commodityResult.nullify) {
    verifiedShipment.cargo = { ...verifiedShipment.cargo, commodity: null };
  }

  // Temperature value
  if (cargo.temperature) {
    const tempResult = verifyCargoField(
      cargo.temperature.value,
      "cargo.temperature.value",
      candidates,
      originalText,
      existingProvenance
    );
    allWarnings.push(...tempResult.warnings);
    if (tempResult.provenance) allProvenance["cargo.temperature.value"] = tempResult.provenance;
    if (tempResult.nullify) {
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
    for (const dimField of ["length", "width", "height"] as const) {
      const dimValue = cargo.dimensions[dimField];
      const dimResult = verifyCargoField(
        dimValue,
        `cargo.dimensions.${dimField}`,
        candidates,
        originalText,
        existingProvenance
      );
      allWarnings.push(...dimResult.warnings);
      if (dimResult.provenance) allProvenance[`cargo.dimensions.${dimField}`] = dimResult.provenance;
      if (dimResult.nullify) {
        verifiedShipment.cargo = {
          ...verifiedShipment.cargo,
          dimensions: verifiedShipment.cargo.dimensions
            ? { ...verifiedShipment.cargo.dimensions, [dimField]: null }
            : null,
        };
      }
    }
  }

  return {
    shipment: verifiedShipment,
    warnings: allWarnings,
    provenance: allProvenance,
  };
}

/**
 * Get only hallucinated warnings (for the banner)
 */
export function getHallucinatedWarnings(warnings: VerificationWarning[]): VerificationWarning[] {
  return warnings.filter((w) => w.category === "hallucinated");
}

/**
 * Get only unverified warnings (for inline indicators)
 */
export function getUnverifiedWarnings(warnings: VerificationWarning[]): VerificationWarning[] {
  return warnings.filter((w) => w.category === "unverified");
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
export function hasWarning(warnings: VerificationWarning[], pathPattern: string): boolean {
  return warnings.some(
    (w) => w.path === pathPattern || w.path.startsWith(pathPattern + ".")
  );
}
