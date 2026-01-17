/**
 * Learning Detector
 *
 * Detects when a user makes ANY edit (reference reclassification, cargo changes, etc.)
 * and suggests rules to add to the customer profile.
 */

import {
  StructuredShipment,
  ExtractedCandidate,
  ReferenceNumber,
  ReferenceNumberSubtype,
  SuggestedRule,
  LearningEvent,
  LearnableFieldType,
  CargoDetails,
} from "./types";

interface DetectReclassificationsInput {
  originalShipment: StructuredShipment; // LLM output before user edits
  finalShipment: StructuredShipment; // User's final reviewed version
  candidates: ExtractedCandidate[]; // Original extracted candidates
  originalText: string; // Original tender text for fallback context extraction
}

export interface DetectAllEditsInput extends DetectReclassificationsInput {
  customerId?: string;
  tenderId?: string;
}

/**
 * Find reference numbers that were reclassified by the user.
 * Returns suggested rules based on the reclassifications.
 */
export function detectReclassifications(
  input: DetectReclassificationsInput
): SuggestedRule[] {
  const { originalShipment, finalShipment, candidates, originalText } = input;
  const suggestedRules: SuggestedRule[] = [];

  // Normalize value for comparison (strip leading zeros, trim)
  const normalizeValue = (value: string): string => {
    return value.replace(/^0+/, "").trim();
  };

  // Build a map of original classifications by value (both normalized and original)
  const originalClassifications = new Map<string, ReferenceNumberSubtype>();

  // From shipment-level refs
  for (const ref of originalShipment.reference_numbers) {
    originalClassifications.set(ref.value, ref.type);
    originalClassifications.set(normalizeValue(ref.value), ref.type);
  }

  // From stop-level refs
  for (const stop of originalShipment.stops) {
    for (const ref of stop.reference_numbers) {
      originalClassifications.set(ref.value, ref.type);
      originalClassifications.set(normalizeValue(ref.value), ref.type);
    }
  }

  // Find candidate context for a value (with flexible matching)
  const findCandidateContext = (value: string): ExtractedCandidate | undefined => {
    const normalized = normalizeValue(value);
    return candidates.find(
      (c) =>
        c.type === "reference_number" &&
        (c.value === value || 
         c.raw_match.includes(value) ||
         normalizeValue(c.value) === normalized ||
         c.raw_match.includes(normalized))
    );
  };

  // Fallback: extract context directly from original text
  const extractContextFromText = (value: string): string | null => {
    // Try to find the value in the original text
    const searchTerms = [value, normalizeValue(value)];
    
    for (const term of searchTerms) {
      const index = originalText.indexOf(term);
      if (index >= 0) {
        // Extract context window around the match
        const start = Math.max(0, index - 50);
        const end = Math.min(originalText.length, index + term.length + 30);
        let context = originalText.slice(start, end);
        
        // Clean up context
        if (start > 0) context = "..." + context;
        if (end < originalText.length) context = context + "...";
        context = context.replace(/\s+/g, " ").trim();
        
        console.log(`[Learning] Extracted context from text for "${term}": "${context}"`);
        return context;
      }
    }
    
    return null;
  };

  // Get original type with flexible matching
  const getOriginalType = (value: string): ReferenceNumberSubtype | undefined => {
    return originalClassifications.get(value) || 
           originalClassifications.get(normalizeValue(value));
  };

  // Check for reclassified shipment-level refs
  const checkRef = (ref: ReferenceNumber) => {
    const originalType = getOriginalType(ref.value);

    console.log(`[Learning] Checking ref "${ref.value}": original=${originalType}, final=${ref.type}`);

    // If the type changed from what the LLM classified (including unknown -> specific)
    if (originalType && originalType !== ref.type && ref.type !== "unknown") {
      const candidate = findCandidateContext(ref.value);
      console.log(`[Learning] Type changed! Candidate:`, candidate ? { label_hint: candidate.label_hint, context: candidate.context } : "not found");

      // Get context - from candidate, or fallback to searching original text
      let context = candidate?.context || null;
      if (!context) {
        context = extractContextFromText(ref.value);
      }

      // Try to find a label - first from hint, then from context
      let label = candidate?.label_hint;
      if (!label && context) {
        label = extractLabelFromContext(context, ref.value);
      }

      // If there's a label, suggest a label rule
      if (label) {
        suggestedRules.push({
          type: "label",
          label: label,
          subtype: ref.type,
          example_value: ref.value,
          context: context || "",
        });
        console.log(`[Learning] Suggesting label rule: "${label}" -> ${ref.type}`);
      } else if (context) {
        // Try to derive a regex pattern from the value
        const pattern = derivePattern(ref.value);
        console.log(`[Learning] Derived pattern: ${pattern}`);
        if (pattern) {
          suggestedRules.push({
            type: "regex",
            pattern,
            subtype: ref.type,
            example_value: ref.value,
            context: context,
          });
        }
      } else {
        console.log(`[Learning] No context found for "${ref.value}" - cannot suggest rule`);
      }
    }
  };

  // Check shipment-level refs
  for (const ref of finalShipment.reference_numbers) {
    checkRef(ref);
  }

  // Check stop-level refs
  for (const stop of finalShipment.stops) {
    for (const ref of stop.reference_numbers) {
      checkRef(ref);
    }
  }

  // Deduplicate suggestions
  return deduplicateSuggestions(suggestedRules);
}

/**
 * Try to extract a label from the context string.
 * Looks for patterns like "Label #: VALUE" or "Label: VALUE"
 */
function extractLabelFromContext(context: string, value: string): string | null {
  // Look for patterns like "Label #: 118585" or "Label: 118585"
  // We want to find what comes before the value
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  
  // Pattern: word(s) followed by optional # or : then the value
  const patterns = [
    new RegExp(`([A-Za-z][A-Za-z\\s]{0,15})\\s*#\\s*:?\\s*${escapedValue}`, "i"),
    new RegExp(`([A-Za-z][A-Za-z\\s]{0,15})\\s*:\\s*${escapedValue}`, "i"),
    new RegExp(`([A-Za-z][A-Za-z\\s]{0,15})\\s+${escapedValue}\\b`, "i"),
  ];
  
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (match && match[1]) {
      const label = match[1].trim();
      // Filter out common non-labels
      const ignoreLabels = ["total", "phone", "cell", "fax", "ext", "miles", "cases"];
      if (label.length >= 2 && !ignoreLabels.some(il => label.toLowerCase().includes(il))) {
        console.log(`[Learning] Extracted label from context: "${label}"`);
        return label;
      }
    }
  }
  
  return null;
}

/**
 * Try to derive a regex pattern from a reference number value.
 * Returns null if no clear pattern is detected.
 */
function derivePattern(value: string): string | null {
  // Common patterns:
  // - Prefix + numbers: "FFI25006" -> "^FFI\\d+$"
  // - Numbers with dashes: "123-456-789" -> "^\\d+-\\d+-\\d+$"
  // - Pure numbers with specific length

  // Check for letter prefix + numbers
  const prefixMatch = value.match(/^([A-Za-z]{2,5})(\d{4,})$/);
  if (prefixMatch) {
    return `^${prefixMatch[1]}\\d{4,}$`;
  }

  // Check for specific number format with dashes
  const dashMatch = value.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (dashMatch) {
    if (dashMatch[3]) {
      return `^\\d+-\\d+-\\d+$`;
    }
    return `^\\d+-\\d+$`;
  }

  // Don't suggest patterns for simple numbers - too generic
  return null;
}

/**
 * Remove duplicate suggestions (same label or pattern).
 */
function deduplicateSuggestions(suggestions: SuggestedRule[]): SuggestedRule[] {
  const seen = new Set<string>();
  const unique: SuggestedRule[] = [];

  for (const suggestion of suggestions) {
    const key =
      suggestion.type === "label"
        ? `label:${suggestion.label?.toLowerCase()}`
        : `regex:${suggestion.pattern}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(suggestion);
    }
  }

  return unique;
}

/**
 * Check if a suggested rule already exists in the customer profile rules.
 */
export function isRuleAlreadyLearned(
  suggestion: SuggestedRule,
  existingLabelRules: { label: string; subtype: ReferenceNumberSubtype }[],
  existingRegexRules: { pattern: string; subtype: ReferenceNumberSubtype }[]
): boolean {
  if (suggestion.type === "label" && suggestion.label) {
    return existingLabelRules.some(
      (r) =>
        r.label.toLowerCase() === suggestion.label!.toLowerCase() &&
        r.subtype === suggestion.subtype
    );
  }

  if (suggestion.type === "regex" && suggestion.pattern) {
    return existingRegexRules.some(
      (r) => r.pattern === suggestion.pattern && r.subtype === suggestion.subtype
    );
  }

  return false;
}

/**
 * Detect ALL edits the user made (references, cargo, stops, etc.)
 * Returns learning events that can be stored for global learning.
 */
export function detectAllEdits(input: DetectAllEditsInput): LearningEvent[] {
  const { originalShipment, finalShipment, candidates, originalText, customerId, tenderId } = input;
  const events: LearningEvent[] = [];

  if (!customerId || !tenderId) {
    return events;
  }

  const now = new Date().toISOString();

  // Detect reference reclassifications (shipment-level)
  detectRefEdits(
    originalShipment.reference_numbers,
    finalShipment.reference_numbers,
    "reference_numbers",
    events,
    customerId,
    tenderId,
    candidates,
    originalText,
    now
  );

  // Detect reference reclassifications (stop-level)
  for (let i = 0; i < finalShipment.stops.length; i++) {
    const originalStop = originalShipment.stops[i];
    const finalStop = finalShipment.stops[i];
    if (originalStop && finalStop) {
      detectRefEdits(
        originalStop.reference_numbers,
        finalStop.reference_numbers,
        `stops[${i}].reference_numbers`,
        events,
        customerId,
        tenderId,
        candidates,
        originalText,
        now
      );
    }
  }

  // Detect cargo edits
  detectCargoEdits(
    originalShipment.cargo,
    finalShipment.cargo,
    events,
    customerId,
    tenderId,
    now
  );

  return events;
}

function detectRefEdits(
  originalRefs: ReferenceNumber[],
  finalRefs: ReferenceNumber[],
  pathPrefix: string,
  events: LearningEvent[],
  customerId: string,
  tenderId: string,
  candidates: ExtractedCandidate[],
  originalText: string,
  now: string
): void {
  const normalizeValue = (value: string): string => value.replace(/^0+/, "").trim();

  // Map original refs by value
  const originalByValue = new Map<string, ReferenceNumber>();
  for (const ref of originalRefs) {
    originalByValue.set(ref.value, ref);
    originalByValue.set(normalizeValue(ref.value), ref);
  }

  // Check for changed types
  for (let i = 0; i < finalRefs.length; i++) {
    const finalRef = finalRefs[i];
    const originalRef = originalByValue.get(finalRef.value) || 
                        originalByValue.get(normalizeValue(finalRef.value));

    if (originalRef && originalRef.type !== finalRef.type && finalRef.type !== "unknown") {
      // Find context
      const candidate = candidates.find(
        (c) => c.type === "reference_number" && 
               (c.value === finalRef.value || normalizeValue(c.value) === normalizeValue(finalRef.value))
      );

      events.push({
        id: `${tenderId}-${pathPrefix}[${i}]-${now}`,
        customer_id: customerId,
        tender_id: tenderId,
        field_type: "reference_subtype",
        field_path: `${pathPrefix}[${i}].type`,
        before_value: originalRef.type,
        after_value: finalRef.type,
        context: {
          label_hint: candidate?.label_hint || undefined,
          nearby_text: candidate?.context || extractNearbyText(originalText, finalRef.value),
          original_subtype: originalRef.type,
        },
        created_at: now,
      });
    }
  }
}

function detectCargoEdits(
  originalCargo: CargoDetails,
  finalCargo: CargoDetails,
  events: LearningEvent[],
  customerId: string,
  tenderId: string,
  now: string
): void {
  console.log(`[Learning] detectCargoEdits called:`);
  console.log(`[Learning]   originalCargo.commodity: "${originalCargo.commodity}" (${typeof originalCargo.commodity})`);
  console.log(`[Learning]   finalCargo.commodity: "${finalCargo.commodity}" (${typeof finalCargo.commodity})`);
  console.log(`[Learning]   temperature: ${finalCargo.temperature?.value}, mode: ${finalCargo.temperature?.mode}`);
  console.log(`[Learning]   Are they different? ${originalCargo.commodity !== finalCargo.commodity}`);
  
  // Commodity changes - normalize null/undefined comparison
  const origCommodity = originalCargo.commodity ?? null;
  const finalCommodity = finalCargo.commodity ?? null;
  
  if (origCommodity !== finalCommodity && finalCommodity) {
    console.log(`[Learning] Commodity changed! Creating learning event...`);
    events.push({
      id: `${tenderId}-cargo.commodity-${now}`,
      customer_id: customerId,
      tender_id: tenderId,
      field_type: "cargo_commodity",
      field_path: "cargo.commodity",
      before_value: originalCargo.commodity,
      after_value: finalCargo.commodity,
      context: {
        temperature_value: finalCargo.temperature?.value ?? undefined,
        temperature_mode: finalCargo.temperature?.mode ?? undefined,
      },
      created_at: now,
    });
  }

  // Temperature mode changes
  const originalMode = originalCargo.temperature?.mode;
  const finalMode = finalCargo.temperature?.mode;
  if (originalMode !== finalMode && finalMode) {
    events.push({
      id: `${tenderId}-cargo.temperature.mode-${now}`,
      customer_id: customerId,
      tender_id: tenderId,
      field_type: "cargo_temp_mode",
      field_path: "cargo.temperature.mode",
      before_value: originalMode ?? null,
      after_value: finalMode,
      context: {
        temperature_value: finalCargo.temperature?.value ?? undefined,
      },
      created_at: now,
    });
  }

  // Weight changes (significant - user corrected an extraction issue)
  const originalWeight = originalCargo.weight?.value;
  const finalWeight = finalCargo.weight?.value;
  if (originalWeight !== finalWeight && finalWeight && finalWeight > 0) {
    // Only log if there was a meaningful correction (not just 0 -> value)
    if (originalWeight && originalWeight !== 0 && originalWeight !== finalWeight) {
      events.push({
        id: `${tenderId}-cargo.weight.value-${now}`,
        customer_id: customerId,
        tender_id: tenderId,
        field_type: "cargo_weight",
        field_path: "cargo.weight.value",
        before_value: originalWeight,
        after_value: finalWeight,
        context: {},
        created_at: now,
      });
    }
  }
}

function extractNearbyText(text: string, value: string): string | undefined {
  const index = text.indexOf(value);
  if (index < 0) return undefined;

  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + value.length + 20);
  let context = text.slice(start, end);
  if (start > 0) context = "..." + context;
  if (end < text.length) context = context + "...";
  return context.replace(/\s+/g, " ").trim();
}
