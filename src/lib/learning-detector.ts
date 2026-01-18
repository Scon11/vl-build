/**
 * Learning Detector
 *
 * Detects when a user makes ANY edit (reference reclassification, cargo changes, etc.)
 * and suggests rules to add to the customer profile.
 * 
 * HARDENED for production use across 500+ customers:
 * - Generic pattern detection (no prefix allowlists)
 * - Collision checks to avoid overly broad patterns
 * - Scoring threshold to ensure quality suggestions
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
  RuleScope,
  ReferenceValueRule,
} from "./types";
import { getBlockTypeAtPosition } from "./segmenter";

interface DetectReclassificationsInput {
  originalShipment: StructuredShipment; // LLM output before user edits
  finalShipment: StructuredShipment; // User's final reviewed version
  candidates: ExtractedCandidate[]; // Original extracted candidates
  originalText: string; // Original tender text for fallback context extraction
}

// ============================================
// HARDENING CONFIGURATION
// ============================================

/** Minimum length for a value to be considered for value_pattern learning */
const MIN_VALUE_LENGTH = 8;

/** Maximum distinct matches before a pattern is considered too broad */
const MAX_COLLISION_COUNT = 3;

/** Minimum score required to propose a value_pattern rule */
const MIN_SCORE_THRESHOLD = 3;

/** Patterns that indicate a value is NOT a reference (phone, date, time) */
const EXCLUSION_PATTERNS = [
  /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/, // Phone: 123-456-7890
  /^\(\d{3}\)\s?\d{3}[-.\s]?\d{4}$/, // Phone: (123) 456-7890
  /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/, // Date: 1/15/2026 or 01-15-26
  /^\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?$/i, // Time: 10:30 AM
  /^\d{5}(-\d{4})?$/, // ZIP code: 12345 or 12345-6789
  /^[01]?\d{10}$/, // 10-digit phone with optional leading 0/1
  /^\+\d{10,15}$/, // International phone
];

/**
 * Check if a string has low entropy (repeated characters, all same char, etc.)
 */
function isLowEntropy(value: string): boolean {
  // All same character
  if (new Set(value).size <= 2) return true;
  
  // Check for repeated patterns like "AAAA" or "1111"
  const repeatMatch = value.match(/(.)\1{3,}/);
  if (repeatMatch) return true;
  
  // Check for sequential patterns like "12345" or "abcde"
  const digitRun = value.match(/(0123|1234|2345|3456|4567|5678|6789)/);
  if (digitRun) return true;
  
  return false;
}

/**
 * Check if a value matches any exclusion pattern (phone, date, time, etc.)
 */
function matchesExclusionPattern(value: string): boolean {
  return EXCLUSION_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if a value is purely numeric (no letters) - these are risky to learn
 */
function isPurelyNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Derive a SPECIFIC regex pattern from a value.
 * Returns null if no safe pattern can be derived.
 * 
 * Pattern generation rules:
 * - Always anchored with ^ and $
 * - Preserve the exact prefix letters
 * - Use \\d{N,} where N is based on observed digit length (minimum 4)
 * - Support optional separator characters (-, _)
 */
function deriveSpecificPattern(value: string): string | null {
  // Pattern 1: PREFIX + NUMBERS (e.g., TRFR0010713 -> ^TRFR\d{7,}$)
  const prefixNumMatch = value.match(/^([A-Z]{2,6})(\d{4,})$/i);
  if (prefixNumMatch) {
    const prefix = prefixNumMatch[1].toUpperCase();
    const digitLen = prefixNumMatch[2].length;
    // Require at least 4 digits, allow up to 2 more
    const minDigits = Math.max(4, digitLen - 2);
    return `^${prefix}\\d{${minDigits},}$`;
  }

  // Pattern 2: PREFIX-NUMBERS (e.g., PO-123456 -> ^PO-\d{5,}$)
  const dashMatch = value.match(/^([A-Z]{2,5})[-_](\d{4,})$/i);
  if (dashMatch) {
    const prefix = dashMatch[1].toUpperCase();
    const digitLen = dashMatch[2].length;
    const minDigits = Math.max(4, digitLen - 2);
    return `^${prefix}[-_]?\\d{${minDigits},}$`;
  }

  // Pattern 3: PREFIX + MIXED ALPHANUMERIC (e.g., ABC12X456 -> ^ABC[A-Z0-9]{6,}$)
  const mixedMatch = value.match(/^([A-Z]{2,4})([A-Z0-9]{5,})$/i);
  if (mixedMatch) {
    const prefix = mixedMatch[1].toUpperCase();
    const restLen = mixedMatch[2].length;
    // Only if the rest contains both letters and numbers
    const rest = mixedMatch[2];
    if (/[A-Z]/i.test(rest) && /\d/.test(rest)) {
      const minLen = Math.max(5, restLen - 2);
      return `^${prefix}[A-Z0-9]{${minLen},}$`;
    }
  }

  // Pattern 4: NUMBER-PREFIX-NUMBER (e.g., 25-FFI-001)
  const numPrefixNumMatch = value.match(/^(\d{2,4})[-_]([A-Z]{2,5})[-_](\d{2,})$/i);
  if (numPrefixNumMatch) {
    const prefix = numPrefixNumMatch[2].toUpperCase();
    return `^\\d{2,4}[-_]${prefix}[-_]\\d{2,}$`;
  }

  return null;
}

/**
 * Count how many DISTINCT values in the text match a given regex pattern.
 * Used for collision detection - if too many match, the pattern is too broad.
 */
function countPatternCollisions(
  pattern: string,
  candidates: ExtractedCandidate[],
  originalText: string
): { count: number; matches: string[] } {
  const matches = new Set<string>();
  
  try {
    const regex = new RegExp(pattern, "gi");
    
    // Check against all candidates
    for (const candidate of candidates) {
      if (candidate.type === "reference_number" && regex.test(candidate.value)) {
        matches.add(candidate.value);
      }
      regex.lastIndex = 0; // Reset for next test
    }
    
    // Also scan the raw text for additional matches
    let match;
    const textRegex = new RegExp(pattern, "gi");
    while ((match = textRegex.exec(originalText)) !== null) {
      const value = match[0];
      // Only count if it looks like a reference (not embedded in longer text)
      const before = originalText[match.index - 1] || " ";
      const after = originalText[match.index + value.length] || " ";
      if (/[\s\n:,;]/.test(before) && /[\s\n:,;]/.test(after)) {
        matches.add(value);
      }
    }
  } catch {
    // Invalid regex - return high collision count to reject
    return { count: 999, matches: [] };
  }
  
  return { count: matches.size, matches: Array.from(matches).slice(0, 5) };
}

/**
 * Compute a score for a value_pattern proposal.
 * Higher score = more likely to be a good rule.
 * 
 * Scoring factors:
 * +2: Value appears in multiple blocks (pickup + delivery, or header + stop)
 * +2: User changed from null/unknown to concrete subtype
 * +1: Labels differ across occurrences (suggests value-based, not label-based)
 * +1: Value has clear alphanumeric structure
 * -2: Value length < MIN_VALUE_LENGTH
 * -2: Collision count > MAX_COLLISION_COUNT
 * -2: Matches exclusion pattern (phone/date/time)
 * -1: Low entropy (repeated chars)
 * -1: Purely numeric
 */
interface PatternScoreResult {
  score: number;
  reasons: string[];
  collisionCount: number;
  exampleMatches: string[];
}

function computePatternScore(
  value: string,
  pattern: string,
  originalType: ReferenceNumberSubtype | undefined,
  candidates: ExtractedCandidate[],
  originalText: string,
  occurrencesInMultipleBlocks: boolean,
  labelsDiffer: boolean
): PatternScoreResult {
  let score = 0;
  const reasons: string[] = [];
  
  // Check collisions first
  const { count: collisionCount, matches: exampleMatches } = countPatternCollisions(
    pattern, 
    candidates, 
    originalText
  );
  
  // Positive factors
  if (occurrencesInMultipleBlocks) {
    score += 2;
    reasons.push("+2: appears in multiple blocks");
  }
  
  if (!originalType || originalType === "unknown") {
    score += 2;
    reasons.push("+2: changed from unknown to specific type");
  }
  
  if (labelsDiffer) {
    score += 1;
    reasons.push("+1: labels differ across occurrences");
  }
  
  // Check if value has clear alphanumeric structure (letters + digits)
  if (/[A-Z]/i.test(value) && /\d/.test(value)) {
    score += 1;
    reasons.push("+1: clear alphanumeric structure");
  }
  
  // Negative factors
  if (value.length < MIN_VALUE_LENGTH) {
    score -= 2;
    reasons.push(`-2: length ${value.length} < ${MIN_VALUE_LENGTH}`);
  }
  
  if (collisionCount > MAX_COLLISION_COUNT) {
    score -= 2;
    reasons.push(`-2: collision count ${collisionCount} > ${MAX_COLLISION_COUNT}`);
  }
  
  if (matchesExclusionPattern(value)) {
    score -= 2;
    reasons.push("-2: matches exclusion pattern (phone/date/time)");
  }
  
  if (isLowEntropy(value)) {
    score -= 1;
    reasons.push("-1: low entropy value");
  }
  
  if (isPurelyNumeric(value)) {
    score -= 1;
    reasons.push("-1: purely numeric (risky)");
  }
  
  return { score, reasons, collisionCount, exampleMatches };
}

/**
 * Check if a value has a strong pattern worth learning as a value_pattern rule.
 * Returns null if no safe pattern can be derived, or if the pattern is too broad.
 * 
 * This is the HARDENED version that:
 * - Uses generic detection (no prefix allowlists)
 * - Requires minimum length
 * - Avoids phone/date/time patterns
 * - Avoids low-entropy values
 * - Generates specific, anchored patterns
 */
function detectStrongValuePattern(
  value: string,
  candidates: ExtractedCandidate[],
  originalText: string,
  originalType: ReferenceNumberSubtype | undefined,
  occurrencesInMultipleBlocks: boolean = false,
  labelsDiffer: boolean = false
): { pattern: string; score: number; collisionCount: number; exampleMatches: string[]; reasons: string[] } | null {
  // Quick rejection checks
  if (value.length < MIN_VALUE_LENGTH) {
    return null;
  }
  
  if (matchesExclusionPattern(value)) {
    return null;
  }
  
  if (isLowEntropy(value)) {
    return null;
  }
  
  // Derive a specific pattern
  const pattern = deriveSpecificPattern(value);
  if (!pattern) {
    return null;
  }
  
  // Compute score with collision check
  const scoreResult = computePatternScore(
    value,
    pattern,
    originalType,
    candidates,
    originalText,
    occurrencesInMultipleBlocks,
    labelsDiffer
  );
  
  // Reject if score is below threshold
  if (scoreResult.score < MIN_SCORE_THRESHOLD) {
    console.log(`[Learning] Pattern ${pattern} rejected: score ${scoreResult.score} < ${MIN_SCORE_THRESHOLD}`);
    console.log(`[Learning]   Reasons: ${scoreResult.reasons.join(", ")}`);
    return null;
  }
  
  console.log(`[Learning] Pattern ${pattern} accepted: score ${scoreResult.score}`);
  console.log(`[Learning]   Reasons: ${scoreResult.reasons.join(", ")}`);
  
  return {
    pattern,
    score: scoreResult.score,
    collisionCount: scoreResult.collisionCount,
    exampleMatches: scoreResult.exampleMatches,
    reasons: scoreResult.reasons,
  };
}

/**
 * Determine the scope for a reference based on its location in stops.
 */
function determineRefScope(
  ref: ReferenceNumber,
  stopIndex: number | null,
  stopType: "pickup" | "delivery" | null
): RuleScope {
  if (stopIndex !== null && stopType) {
    return stopType;
  }
  return "global";
}

export interface DetectAllEditsInput extends DetectReclassificationsInput {
  customerId?: string;
  tenderId?: string;
}

/**
 * Analyze where a value appears across the shipment.
 * Returns info about multiple block occurrences and label differences.
 */
function analyzeValueOccurrences(
  value: string,
  originalShipment: StructuredShipment,
  finalShipment: StructuredShipment,
  candidates: ExtractedCandidate[]
): { multipleBlocks: boolean; labelsDiffer: boolean; scopes: RuleScope[] } {
  const scopes = new Set<RuleScope>();
  const labels = new Set<string>();
  
  const normalizeValue = (v: string): string => v.replace(/^0+/, "").trim();
  const normalized = normalizeValue(value);
  
  // Check all shipments for this value
  const allShipments = [originalShipment, finalShipment];
  for (const shipment of allShipments) {
    // Shipment-level refs
    for (const ref of shipment.reference_numbers) {
      if (ref.value === value || normalizeValue(ref.value) === normalized) {
        scopes.add("global");
      }
    }
    // Stop-level refs
    for (const stop of shipment.stops) {
      for (const ref of stop.reference_numbers) {
        if (ref.value === value || normalizeValue(ref.value) === normalized) {
          scopes.add(stop.type as RuleScope);
        }
      }
    }
  }
  
  // Check candidates for label differences
  for (const candidate of candidates) {
    if (candidate.type === "reference_number") {
      if (candidate.value === value || normalizeValue(candidate.value) === normalized) {
        if (candidate.label_hint) {
          labels.add(candidate.label_hint.toLowerCase());
        }
      }
    }
  }
  
  return {
    multipleBlocks: scopes.size > 1,
    labelsDiffer: labels.size > 1,
    scopes: Array.from(scopes),
  };
}

/**
 * Find reference numbers that were reclassified by the user.
 * Returns suggested rules based on the reclassifications.
 * 
 * HARDENED rule suggestion with scoring:
 * 1. value_pattern - only if score >= threshold and collision check passes
 * 2. label - if there's a clear label, suggest label -> subtype
 * 3. regex - fallback for complex patterns (rare)
 */
export function detectReclassifications(
  input: DetectReclassificationsInput
): SuggestedRule[] {
  const { originalShipment, finalShipment, candidates, originalText } = input;
  const suggestedRules: SuggestedRule[] = [];
  
  // Track values we've already processed (for deduplication)
  const processedValues = new Set<string>();
  
  // Track value patterns we've suggested (to avoid duplicates)
  const suggestedPatterns = new Set<string>();

  // Normalize value for comparison (strip leading zeros, trim)
  const normalizeValue = (value: string): string => {
    return value.replace(/^0+/, "").trim();
  };

  // Build a map of original classifications by value (both normalized and original)
  const originalClassifications = new Map<string, { type: ReferenceNumberSubtype; scope: RuleScope }>();

  // From shipment-level refs
  for (const ref of originalShipment.reference_numbers) {
    originalClassifications.set(ref.value, { type: ref.type, scope: "global" });
    originalClassifications.set(normalizeValue(ref.value), { type: ref.type, scope: "global" });
  }

  // From stop-level refs
  for (let i = 0; i < originalShipment.stops.length; i++) {
    const stop = originalShipment.stops[i];
    const stopScope: RuleScope = stop.type as RuleScope;
    for (const ref of stop.reference_numbers) {
      originalClassifications.set(ref.value, { type: ref.type, scope: stopScope });
      originalClassifications.set(normalizeValue(ref.value), { type: ref.type, scope: stopScope });
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
  const extractContextFromText = (value: string): { context: string; position: number } | null => {
    const searchTerms = [value, normalizeValue(value)];
    
    for (const term of searchTerms) {
      const index = originalText.indexOf(term);
      if (index >= 0) {
        const start = Math.max(0, index - 50);
        const end = Math.min(originalText.length, index + term.length + 30);
        let context = originalText.slice(start, end);
        
        if (start > 0) context = "..." + context;
        if (end < originalText.length) context = context + "...";
        context = context.replace(/\s+/g, " ").trim();
        
        return { context, position: index };
      }
    }
    
    return null;
  };

  // Get original type with flexible matching
  const getOriginalInfo = (value: string): { type: ReferenceNumberSubtype; scope: RuleScope } | undefined => {
    return originalClassifications.get(value) || 
           originalClassifications.get(normalizeValue(value));
  };

  // Check for reclassified ref with scope awareness
  const checkRef = (
    ref: ReferenceNumber, 
    stopIndex: number | null, 
    stopType: "pickup" | "delivery" | null
  ) => {
    // Skip if we've already processed this value
    if (processedValues.has(ref.value)) {
      return;
    }
    
    const originalInfo = getOriginalInfo(ref.value);
    const currentScope = determineRefScope(ref, stopIndex, stopType);

    console.log(`[Learning] Checking ref "${ref.value}": original=${originalInfo?.type}, final=${ref.type}, scope=${currentScope}`);

    // If the type changed from what the LLM classified (including unknown -> specific)
    if (originalInfo && originalInfo.type !== ref.type && ref.type !== "unknown") {
      processedValues.add(ref.value);
      
      const candidate = findCandidateContext(ref.value);
      console.log(`[Learning] Type changed! Candidate:`, candidate ? { label_hint: candidate.label_hint, context: candidate.context } : "not found");

      // Get context and position
      let context = candidate?.context || null;
      let position: number | null = candidate?.position?.start ?? null;
      
      if (!context) {
        const textResult = extractContextFromText(ref.value);
        if (textResult) {
          context = textResult.context;
          position = textResult.position;
        }
      }

      // Determine scope from text position if available
      let detectedScope: RuleScope = currentScope;
      if (position !== null) {
        const blockType = getBlockTypeAtPosition(originalText, position);
        if (blockType === "pickup" || blockType === "delivery") {
          detectedScope = blockType;
        } else if (blockType === "header") {
          detectedScope = "header";
        }
      }

      // Analyze value occurrences for scoring
      const occurrences = analyzeValueOccurrences(
        ref.value,
        originalShipment,
        finalShipment,
        candidates
      );

      // PRIORITY 1: Check for strong value pattern with HARDENED detection
      const patternResult = detectStrongValuePattern(
        ref.value,
        candidates,
        originalText,
        originalInfo.type,
        occurrences.multipleBlocks,
        occurrences.labelsDiffer
      );
      
      if (patternResult && !suggestedPatterns.has(patternResult.pattern)) {
        suggestedPatterns.add(patternResult.pattern);
        suggestedRules.push({
          type: "value_pattern",
          pattern: patternResult.pattern,
          subtype: ref.type,
          scope: "global", // Value patterns are typically global
          example_value: ref.value,
          context: context || "",
          // Include match metadata for UI transparency
          match_count: patternResult.collisionCount,
          example_matches: patternResult.exampleMatches,
          score: patternResult.score,
        });
        console.log(`[Learning] Suggesting value_pattern rule: ${patternResult.pattern} -> ${ref.type} (score: ${patternResult.score})`);
        return; // Don't also suggest label rule for same value
      }

      // PRIORITY 2: Label-based rule
      let label = candidate?.label_hint;
      if (!label && context) {
        label = extractLabelFromContext(context, ref.value);
      }

      if (label) {
        suggestedRules.push({
          type: "label",
          label: label,
          subtype: ref.type,
          scope: detectedScope,
          example_value: ref.value,
          context: context || "",
        });
        console.log(`[Learning] Suggesting label rule: "${label}" -> ${ref.type} (${detectedScope})`);
      } else if (context) {
        // PRIORITY 3: Legacy regex pattern
        const pattern = derivePattern(ref.value);
        console.log(`[Learning] Derived pattern: ${pattern}`);
        if (pattern) {
          suggestedRules.push({
            type: "regex",
            pattern,
            subtype: ref.type,
            scope: detectedScope,
            example_value: ref.value,
            context: context,
          });
        }
      } else {
        console.log(`[Learning] No context found for "${ref.value}" - cannot suggest rule`);
      }
    }
  };

  // Check shipment-level refs (global scope)
  for (const ref of finalShipment.reference_numbers) {
    checkRef(ref, null, null);
  }

  // Check stop-level refs (with scope)
  for (let i = 0; i < finalShipment.stops.length; i++) {
    const stop = finalShipment.stops[i];
    const stopType = stop.type as "pickup" | "delivery";
    for (const ref of stop.reference_numbers) {
      checkRef(ref, i, stopType);
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
    let key: string;
    if (suggestion.type === "label") {
      key = `label:${suggestion.label?.toLowerCase()}`;
    } else if (suggestion.type === "value_pattern") {
      key = `value_pattern:${suggestion.pattern}`;
    } else {
      key = `regex:${suggestion.pattern}`;
    }

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(suggestion);
    }
  }

  return unique;
}

/**
 * Check if a suggested rule already exists in the customer profile rules.
 * Now supports value_pattern rules with scope checking.
 */
export function isRuleAlreadyLearned(
  suggestion: SuggestedRule,
  existingLabelRules: { label: string; subtype: ReferenceNumberSubtype }[],
  existingRegexRules: { pattern: string; subtype: ReferenceNumberSubtype }[],
  existingValueRules?: ReferenceValueRule[]
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

  if (suggestion.type === "value_pattern" && suggestion.pattern) {
    if (!existingValueRules?.length) return false;
    
    return existingValueRules.some((r) => {
      // Pattern must match
      if (r.pattern !== suggestion.pattern) return false;
      // Subtype must match
      if (r.subtype !== suggestion.subtype) return false;
      // Scope must match (or existing rule is global which covers all scopes)
      if (r.scope !== "global" && r.scope !== suggestion.scope) return false;
      return true;
    });
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
