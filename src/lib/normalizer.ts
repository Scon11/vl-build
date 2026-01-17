/**
 * Shipment Normalizer
 *
 * Normalizes LLM output to properly scope reference numbers and cargo
 * to either shipment-level (global) or stop-level.
 */

import {
  StructuredShipment,
  ReferenceNumber,
  Stop,
  ExtractedCandidate,
  ReferenceNumberSubtype,
} from "./types";

export interface NormalizationResult {
  shipment: StructuredShipment;
  metadata: NormalizationMetadata;
}

export interface NormalizationMetadata {
  refs_moved_to_stops: number;
  refs_deduplicated: number;
  cargo_source: "header" | "stop" | "unknown";
}

interface RefWithContext {
  ref: ReferenceNumber;
  textPosition: number | null;
  stopContext: "pickup" | "delivery" | "header" | "unknown";
  stopIndex: number | null; // Which stop this belongs to (0-indexed)
}

// Reference subtypes that are inherently stop-level
const STOP_LEVEL_SUBTYPES: ReferenceNumberSubtype[] = [
  "pickup",
  "delivery",
  "appointment",
  "confirmation",
];

// Reference subtypes that are typically shipment-level (global)
const GLOBAL_SUBTYPES: ReferenceNumberSubtype[] = [
  "bol",
  "order",
  "pro",
];

// Keywords that indicate stop context in text
const PICKUP_CONTEXT_KEYWORDS = [
  /\bpickup\b/i,
  /\bship\s*from\b/i,
  /\borigin\b/i,
  /\bsender\b/i,
  /\bshipper\b/i,
  /\bpu\s*#/i,
  /\brelease\s*#/i,
];

const DELIVERY_CONTEXT_KEYWORDS = [
  /\bdelivery\b/i,
  /\bdeliver\s*to\b/i,
  /\bship\s*to\b/i,
  /\bconsignee\b/i,
  /\bdestination\b/i,
  /\bdel\s*#/i,
];

const HEADER_CONTEXT_KEYWORDS = [
  /\bload\s*(#|number|info)/i,
  /\bshipment\s*(#|number|info)/i,
  /\bfreight\s*bill/i,
  /\btender\s*(#|number)/i,
  /\bcarrier\s*confirmation/i,
  /\btotal\s*(cases|weight|lbs)/i,
];

/**
 * Find the position of a reference value in the original text.
 */
function findRefPosition(
  value: string,
  originalText: string,
  candidates: ExtractedCandidate[]
): number | null {
  // First check candidates for exact match
  const candidate = candidates.find(
    (c) =>
      c.type === "reference_number" &&
      (c.value === value || c.value.replace(/^0+/, "") === value.replace(/^0+/, ""))
  );
  if (candidate) {
    return candidate.position.start;
  }

  // Fallback to text search
  const normalizedValue = value.replace(/^0+/, "");
  let index = originalText.indexOf(value);
  if (index === -1) {
    index = originalText.indexOf(normalizedValue);
  }
  return index >= 0 ? index : null;
}

/**
 * Determine stop context for a reference based on its position in the text.
 */
function determineStopContext(
  position: number | null,
  originalText: string,
  stops: Stop[]
): { context: "pickup" | "delivery" | "header" | "unknown"; stopIndex: number | null } {
  if (position === null) {
    return { context: "unknown", stopIndex: null };
  }

  // Get text window around the position
  const windowStart = Math.max(0, position - 200);
  const windowEnd = Math.min(originalText.length, position + 100);
  const textWindow = originalText.slice(windowStart, windowEnd);

  // Check for header context first (highest priority for global refs)
  for (const pattern of HEADER_CONTEXT_KEYWORDS) {
    if (pattern.test(textWindow)) {
      // But make sure it's not also in a stop context
      const hasPickup = PICKUP_CONTEXT_KEYWORDS.some((p) => p.test(textWindow));
      const hasDelivery = DELIVERY_CONTEXT_KEYWORDS.some((p) => p.test(textWindow));
      if (!hasPickup && !hasDelivery) {
        return { context: "header", stopIndex: null };
      }
    }
  }

  // Check for pickup context
  for (const pattern of PICKUP_CONTEXT_KEYWORDS) {
    if (pattern.test(textWindow)) {
      // Find which pickup stop this is closest to
      const pickupStops = stops.filter((s) => s.type === "pickup");
      return { context: "pickup", stopIndex: pickupStops.length > 0 ? 0 : null };
    }
  }

  // Check for delivery context
  for (const pattern of DELIVERY_CONTEXT_KEYWORDS) {
    if (pattern.test(textWindow)) {
      // Find which delivery stop this is closest to
      const deliveryStopIndex = stops.findIndex((s) => s.type === "delivery");
      return { context: "delivery", stopIndex: deliveryStopIndex >= 0 ? deliveryStopIndex : null };
    }
  }

  return { context: "unknown", stopIndex: null };
}

/**
 * Check if a reference should be stop-level based on its subtype and context.
 */
function shouldBeStopLevel(
  ref: ReferenceNumber,
  context: RefWithContext["stopContext"]
): boolean {
  // Global subtypes should stay global (BOL, Order, PRO are shipment-level)
  if (GLOBAL_SUBTYPES.includes(ref.type)) {
    return false;
  }

  // Header context = shipment-level
  if (context === "header") {
    return false;
  }

  // Stop-level subtypes should always go to stops (when context allows)
  if (STOP_LEVEL_SUBTYPES.includes(ref.type)) {
    return true;
  }

  // PO/Release numbers in pickup context should go to pickup stop
  if (ref.type === "po" && context === "pickup") {
    return true;
  }

  // References with clear stop context should go to stops
  if (context === "pickup" || context === "delivery") {
    return true;
  }

  return false;
}

/**
 * Normalize a shipment by properly scoping references and cargo.
 */
export function normalizeShipment(
  shipment: StructuredShipment,
  originalText: string,
  candidates: ExtractedCandidate[]
): NormalizationResult {
  let refsMovedToStops = 0;
  let refsDeduplicated = 0;

  // Deep clone the shipment to avoid mutations
  const normalized: StructuredShipment = JSON.parse(JSON.stringify(shipment));

  // Track all reference values that end up in stops (for deduplication)
  const stopRefValues = new Set<string>();

  // First, collect existing stop-level refs
  for (const stop of normalized.stops) {
    for (const ref of stop.reference_numbers) {
      stopRefValues.add(ref.value);
    }
  }

  // Analyze each global reference and determine if it should move to a stop
  const globalRefsToKeep: ReferenceNumber[] = [];
  const refsToMoveToStops: Map<number, ReferenceNumber[]> = new Map();

  for (const ref of normalized.reference_numbers) {
    // Find position in text
    const position = findRefPosition(ref.value, originalText, candidates);
    
    // Determine context from text
    const { context, stopIndex } = determineStopContext(position, originalText, normalized.stops);
    
    // Decide if this should be stop-level
    if (shouldBeStopLevel(ref, context)) {
      // Determine target stop index - subtype takes priority over context
      let targetIndex: number | null = null;
      
      // First, infer from subtype (this is the most reliable indicator)
      if (ref.type === "pickup") {
        // Pickup# refs always go to pickup stops
        targetIndex = normalized.stops.findIndex((s) => s.type === "pickup");
      } else if (ref.type === "delivery" || ref.type === "confirmation" || ref.type === "appointment") {
        // Delivery/confirmation/appointment refs go to delivery stops
        targetIndex = normalized.stops.findIndex((s) => s.type === "delivery");
      } else if (ref.type === "po" && context === "pickup") {
        // PO in pickup context goes to pickup
        targetIndex = normalized.stops.findIndex((s) => s.type === "pickup");
      } else if (stopIndex !== null) {
        // Use context-derived stopIndex for other types
        targetIndex = stopIndex;
      } else if (context === "pickup") {
        targetIndex = normalized.stops.findIndex((s) => s.type === "pickup");
      } else if (context === "delivery") {
        targetIndex = normalized.stops.findIndex((s) => s.type === "delivery");
      }
      
      if (targetIndex !== null && targetIndex >= 0) {
        const existingRefs = refsToMoveToStops.get(targetIndex) || [];
        existingRefs.push(ref);
        refsToMoveToStops.set(targetIndex, existingRefs);
        stopRefValues.add(ref.value);
        refsMovedToStops++;
      } else {
        // Couldn't find a target stop, keep global
        globalRefsToKeep.push(ref);
      }
    } else {
      globalRefsToKeep.push(ref);
    }
  }

  // Apply moved refs to stops
  for (const [stopIndex, refs] of refsToMoveToStops) {
    if (normalized.stops[stopIndex]) {
      // Avoid duplicates within the stop
      for (const ref of refs) {
        const exists = normalized.stops[stopIndex].reference_numbers.some(
          (r) => r.value === ref.value
        );
        if (!exists) {
          normalized.stops[stopIndex].reference_numbers.push(ref);
        }
      }
    }
  }

  // Deduplicate global refs (remove any that also exist in stops)
  const deduplicatedGlobalRefs: ReferenceNumber[] = [];
  for (const ref of globalRefsToKeep) {
    if (stopRefValues.has(ref.value)) {
      refsDeduplicated++;
    } else {
      deduplicatedGlobalRefs.push(ref);
    }
  }

  // Also deduplicate within global refs (same value, different types)
  const seenValues = new Set<string>();
  const finalGlobalRefs: ReferenceNumber[] = [];
  for (const ref of deduplicatedGlobalRefs) {
    if (!seenValues.has(ref.value)) {
      seenValues.add(ref.value);
      finalGlobalRefs.push(ref);
    } else {
      refsDeduplicated++;
    }
  }

  normalized.reference_numbers = finalGlobalRefs;

  // Determine cargo source
  const cargoSource = determineCargoSource(originalText);

  return {
    shipment: normalized,
    metadata: {
      refs_moved_to_stops: refsMovedToStops,
      refs_deduplicated: refsDeduplicated,
      cargo_source: cargoSource,
    },
  };
}

/**
 * Determine if cargo values come from header or stop blocks.
 */
function determineCargoSource(originalText: string): "header" | "stop" | "unknown" {
  // Check for header/summary indicators
  const headerPatterns = [
    /total\s+(cases|weight|lbs|pounds)/i,
    /load\s+(weight|total)/i,
    /equipment\s*:/i,
    /trailer\s*type/i,
    /load\s*temp/i,
  ];

  for (const pattern of headerPatterns) {
    if (pattern.test(originalText)) {
      return "header";
    }
  }

  return "unknown";
}

/**
 * Quick check to see if a shipment needs normalization.
 * Returns true if there are global refs that look like they belong to stops.
 */
export function needsNormalization(shipment: StructuredShipment): boolean {
  for (const ref of shipment.reference_numbers) {
    // Stop-level subtypes in global refs = needs normalization
    if (STOP_LEVEL_SUBTYPES.includes(ref.type)) {
      return true;
    }
    // Check applies_to hint
    if (ref.applies_to === "pickup" || ref.applies_to === "delivery" || ref.applies_to === "stop") {
      return true;
    }
  }
  return false;
}
