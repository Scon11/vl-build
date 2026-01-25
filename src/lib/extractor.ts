import {
  ExtractedCandidate,
  ExtractionResult,
  CandidateType,
  ReferenceNumberSubtype,
  CustomerProfile,
} from "./types";
import { getBlockTypeAtPosition, isInHeader } from "./segmenter";

const EXTRACTOR_VERSION = "0.5.0"; // Phone guardrails + document segmentation

// === RULE APPLICATION LOGGING ===
interface RuleApplicationLog {
  applied: { rule: string; candidate: string; reason: string }[];
  skipped: { rule: string; candidate: string; reason: string }[];
}

// Bounds for valid reference numbers
const MIN_REF_LENGTH = 4;
const MAX_REF_LENGTH = 25;
const MAX_LABEL_DISTANCE = 80; // Max chars between label and value

// Phone number patterns to detect and exclude from reference numbers
const PHONE_PATTERNS = [
  // (800) 657-7475 or (800)657-7475
  /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/,
  // 844-211-1470, 614-735-9727, 208-287-0121
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  // 8446211470 or 5097871577 (10 consecutive digits that look like phones)
  /\b[2-9]\d{9}\b/, // US phone numbers start with 2-9
  // With extensions: 844-211-1470 x 114
  /\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*(?:x|ext\.?|extension)\s*\d{1,5}/i,
  // Partial phone fragments like 657-7475
  /\b\d{3}[-.\s]\d{4}\b/,
  // Phone with area code no separator: 2082870121
  /\b\d{10}\b/,
  // Partial area code + exchange: 208-287 (first 2 parts of phone)
  /^\d{3}[-.\s]\d{3}$/,
  // 800/888/877/866/855 toll-free prefixes
  /\b8[0-9]{2}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
];

// Partial phone patterns - numbers that look like they're PART of a phone number
// Used with context checking
const PARTIAL_PHONE_PATTERNS = [
  /^\d{3}[-.\s]\d{2,3}$/, // 208-287 or 208-28
  /^\d{3}[-.\s]\d{3}[-.\s]\d{1,3}$/, // 208-287-01 (incomplete)
  /^\d{7}$/, // 7-digit local number
];

// Labels that indicate the following value is a phone number, not a reference
const PHONE_LABEL_PATTERNS = [
  /\b(phone|fax|cell|mobile|tel|telephone)\s*[#:]?\s*/i,
  /\bcall\s+(?:for\s+)?(?:appt|appointment)\.?\s*[#:]?\s*/i,
  /\bcall\s+for\s+appt\.?\s*#?\s*:?\s*/i, // "Call for Appt. #:" format
  /\b[PF]:\s*\(/i, // P: (800) or F: (208) format
  /\boffice\s*phone/i,
  /\bcell\s*phone/i,
  /\bcontact\s*:/i, // "Contact:" often followed by phone
  /\bcontact\s+[A-Za-z]+\s*$/i, // "Contact Ken Jones" at end of lookback
];

// Labels that indicate the following value is NOT a reference number
const NON_REFERENCE_LABELS = [
  /\btotal\s*(miles?|lbs?|cases?|pallets?|weight)/i,
  /\bline\s*haul/i,
  /\btotal\s*:/i,
  /\$\s*\d/i, // Dollar amounts
  /\bload\s*temp/i,
  /\btrailer\s*type/i,
  /\bmiles\s*:/i, // "Miles: 2448" - not a reference
  /\bweight\s*:/i, // "Weight: 35840" - not a reference
  /\btemp\s*:/i, // "Temp: -10" - not a reference
  /\bpieces\s*:/i, // "Pieces: 1330" - not a reference
];

/**
 * COMPREHENSIVE phone number detection.
 * This is the FINAL check - if true, value MUST NOT be treated as a reference.
 * Phone exclusion ALWAYS wins over customer rules.
 */
function isDefinitelyPhone(value: string, text: string, position: number): { isPhone: boolean; reason: string } {
  const cleanValue = value.replace(/\s+/g, " ").trim();
  const digitsOnly = cleanValue.replace(/\D/g, "");
  
  // Check 1: Value matches a phone pattern directly
  if (PHONE_PATTERNS.some((pattern) => pattern.test(cleanValue))) {
    return { isPhone: true, reason: "matches_phone_pattern" };
  }
  
  // Check 2: Value is a partial phone (truncated)
  if (PARTIAL_PHONE_PATTERNS.some((pattern) => pattern.test(cleanValue.replace(/\s+/g, "")))) {
    return { isPhone: true, reason: "partial_phone" };
  }
  
  // Check 3: 10-digit number (very likely phone)
  if (/^\d{10}$/.test(digitsOnly)) {
    return { isPhone: true, reason: "10_digit_number" };
  }
  
  // Check 4: 7-digit number with phone-like context
  if (/^\d{7}$/.test(digitsOnly)) {
    const lookback = text.slice(Math.max(0, position - 60), position);
    if (PHONE_LABEL_PATTERNS.some((p) => p.test(lookback))) {
      return { isPhone: true, reason: "7_digit_with_phone_label" };
    }
  }
  
  // Check 5: Label context indicates phone
  const lookbackWindow = text.slice(Math.max(0, position - 60), position);
  if (PHONE_LABEL_PATTERNS.some((pattern) => pattern.test(lookbackWindow))) {
    return { isPhone: true, reason: "phone_label_nearby" };
  }
  
  // Check 6: Adjacent to phone number in text (OCR split)
  const windowStart = Math.max(0, position - 20);
  const windowEnd = Math.min(text.length, position + value.length + 20);
  const window = text.slice(windowStart, windowEnd);
  const fullPhonePattern = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/;
  if (fullPhonePattern.test(window)) {
    // Make sure it's not just our value matching
    const valueRemoved = window.replace(value, "XXX");
    if (fullPhonePattern.test(valueRemoved) || digitsOnly.length < 6) {
      return { isPhone: true, reason: "adjacent_to_phone" };
    }
  }
  
  return { isPhone: false, reason: "" };
}

/**
 * Check if a value looks like a phone number (simple check for backwards compat).
 */
function isPhoneNumber(value: string): boolean {
  const cleanValue = value.replace(/\s+/g, " ").trim();
  return PHONE_PATTERNS.some((pattern) => pattern.test(cleanValue));
}

/**
 * Check if a value looks like a PARTIAL phone number (e.g., truncated by OCR).
 */
function isPartialPhone(value: string): boolean {
  const cleanValue = value.replace(/\s+/g, "").trim();
  return PARTIAL_PHONE_PATTERNS.some((pattern) => pattern.test(cleanValue));
}

/**
 * Check if the context suggests this is a phone number (by label).
 */
function hasPhoneLabel(text: string, position: number): boolean {
  const lookbackWindow = text.slice(Math.max(0, position - 60), position);
  return PHONE_LABEL_PATTERNS.some((pattern) => pattern.test(lookbackWindow));
}

/**
 * Check if the context suggests this is NOT a reference number (e.g., total miles, dollar amounts).
 */
function hasNonReferenceLabel(text: string, position: number): boolean {
  const lookbackWindow = text.slice(Math.max(0, position - 40), position);
  return NON_REFERENCE_LABELS.some((pattern) => pattern.test(lookbackWindow));
}

// Patterns with their associated label hints
interface PatternConfig {
  pattern: RegExp;
  type: CandidateType;
  subtype?: ReferenceNumberSubtype;
  confidence: "high" | "medium" | "low";
  valueGroup?: number; // which capture group contains the value
}

// Reference number label patterns - used to detect what kind of number follows
const REFERENCE_LABELS: { pattern: RegExp; subtype: ReferenceNumberSubtype }[] = [
  { pattern: /\b(po|purchase\s*order|p\.o\.)\s*[#:]?\s*/i, subtype: "po" },
  { pattern: /\b(bol|bill\s*of\s*lading|b\/l)\s*[#:]?\s*/i, subtype: "bol" },
  { pattern: /\b(load)\s*[#:]?\s*/i, subtype: "bol" }, // Load # = BOL
  { pattern: /\b(order|ord)\s*[#:]?\s*/i, subtype: "order" },
  { pattern: /\b(pu|pick\s*up|pickup)\s*[#:]?\s*/i, subtype: "pickup" },
  { pattern: /\b(del|delivery|dlv)\s*[#:]?\s*/i, subtype: "delivery" },
  { pattern: /\b(appt|appointment)\s*[#:]?\s*/i, subtype: "appointment" },
  { pattern: /\b(ref|reference)\s*[#:]?\s*/i, subtype: "reference" },
  { pattern: /\b(conf|confirmation)\s*[#:]?\s*/i, subtype: "confirmation" },
  { pattern: /\b(pro)\s*[#:]?\s*/i, subtype: "pro" },
  { pattern: /\b(release)\s*[#:]?\s*/i, subtype: "po" }, // Release # = PO
];

// Core extraction patterns
const PATTERNS: PatternConfig[] = [
  // Dates: MM/DD/YYYY, MM-DD-YYYY, Month DD YYYY, etc.
  {
    pattern: /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
    type: "date",
    confidence: "high",
  },
  {
    pattern: /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}?)\b/gi,
    type: "date",
    confidence: "medium",
  },
  {
    pattern: /\b(today|tomorrow|next\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\b/gi,
    type: "date",
    confidence: "medium",
  },

  // Times: HH:MM, HH:MM AM/PM, military time, "at noon", etc.
  {
    pattern: /\b(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)\b/gi,
    type: "time",
    confidence: "high",
  },
  {
    pattern: /\b(\d{4})\s*(?:hrs?|hours?)\b/gi,
    type: "time",
    confidence: "high",
    valueGroup: 1,
  },
  {
    pattern: /\bat\s+(noon|midnight|\d{1,2}(?:\s*[ap]\.?m\.?)?)\b/gi,
    type: "time",
    confidence: "medium",
    valueGroup: 1,
  },

  // City, State ZIP patterns
  {
    pattern: /\b([A-Za-z][A-Za-z\s]{1,25}),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/g,
    type: "city_state_zip",
    confidence: "high",
  },
  // City, State (no zip)
  {
    pattern: /\b([A-Za-z][A-Za-z\s]{1,25}),?\s+([A-Z]{2})\b(?!\s*\d)/g,
    type: "city_state_zip",
    confidence: "medium",
  },

  // Street addresses
  {
    pattern: /\b(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9\s]{2,30}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|hwy|highway|pkwy|parkway)\.?)\b/gi,
    type: "address",
    confidence: "medium",
  },

  // Weight: lbs, pounds, kg (value before unit)
  {
    pattern: /\b(\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*(lbs?|pounds?|kg|kilos?|kgs?)\b/gi,
    type: "weight",
    confidence: "high",
  },
  // Weight: "Total Lbs: 22,176" or "Total Lbs 22,176" format (very permissive)
  {
    pattern: /\btotal\s*(?:lbs?|pounds?|weight)\s*[:\s]*\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)\b/gi,
    type: "weight",
    confidence: "high",
    valueGroup: 1,
  },
  // Weight: "Lbs: 22,176" or "Lbs 22,176" format
  {
    pattern: /\b(?:lbs?|pounds?)\s*[:\s]*\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)\b/gi,
    type: "weight",
    confidence: "medium",
    valueGroup: 1,
  },
  // Weight in table format: just a large number (>1000) in weight context
  {
    pattern: /\bweight\s*[:\s]*\s*(\d{1,3}(?:,\d{3})+|\d{4,})\b/gi,
    type: "weight",
    confidence: "medium",
    valueGroup: 1,
  },

  // Pieces/pallets/skids (value before unit)
  {
    pattern: /\b(\d{1,4})\s*(pieces?|pcs?|pallets?|plts?|skids?|cases?|cartons?|boxes?|units?)\b/gi,
    type: "pieces",
    confidence: "high",
  },
  // Pieces: "Total Cases: 2,464" or "Total Cases 2464" format (label before value)
  {
    pattern: /\btotal\s*(?:cases?|pallets?|pieces?|pcs?|plts?|skids?)\s*[:\s]*\s*(\d{1,3}(?:,\d{3})*|\d+)\b/gi,
    type: "pieces",
    confidence: "high",
    valueGroup: 1,
  },
  // Pieces in table format: "Cases: 2464" or "Pallets: 28"
  {
    pattern: /\b(cases?|pallets?|pieces?|skids?)\s*[:\s]*\s*(\d{1,3}(?:,\d{3})*|\d{1,5})\b/gi,
    type: "pieces",
    confidence: "medium",
    valueGroup: 2,
  },

  // Dimensions: LxWxH
  {
    pattern: /\b(\d{1,3})\s*[xX×]\s*(\d{1,3})\s*[xX×]\s*(\d{1,3})(?:\s*(in|inches|cm|ft|feet))?\b/gi,
    type: "dimensions",
    confidence: "high",
  },

  // Temperature
  {
    pattern: /\b(-?\d{1,3})\s*(?:°|deg(?:rees?)?)?\s*([FC])\b/gi,
    type: "temperature",
    confidence: "high",
  },
  {
    pattern: /\b(frozen|refrigerated|reefer|dry|ambient)\b/gi,
    type: "temperature",
    confidence: "medium",
  },
  // Load Temp: -10 format
  {
    pattern: /\b(?:load\s*)?temp(?:erature)?\s*[:\s]\s*(-?\d{1,3})\b/gi,
    type: "temperature",
    confidence: "high",
    valueGroup: 1,
  },

  // Explicitly labeled reference numbers (high confidence)
  // Handles: "Load #: 121224", "Load # 121224", "Load: 121224", "Load #:121224"
  {
    pattern: /\bload\s*(?:#\s*:?|:)\s*(\d{4,20})\b/gi,
    type: "reference_number",
    subtype: "bol",
    confidence: "high",
    valueGroup: 1,
  },
  // PO #: 12345 -> PO (numbers only to avoid word matches)
  {
    pattern: /\b(?:po|p\.o\.)\s*[#:]\s*([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "po",
    confidence: "high",
    valueGroup: 1,
  },
  // Release #: TRFR001071 -> PO
  {
    pattern: /\brelease\s*[#:]\s*([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "po",
    confidence: "high",
    valueGroup: 1,
  },
  // Confirmation #: 32163543 -> Confirmation
  {
    pattern: /\bconfirmation\s*[#:]\s*([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "confirmation",
    confidence: "high",
    valueGroup: 1,
  },
  // Order #: 12345 -> Order (handles "Order Order:" Brakebush format too)
  {
    pattern: /\border(?:\s+order)?\s*[#:]?\s*:?\s*(\d{4,20})\b/gi,
    type: "reference_number",
    subtype: "order",
    confidence: "high",
    valueGroup: 1,
  },
  // Reference: 8406730 -> Reference (Brakebush format)
  {
    pattern: /\breference\s*:\s*([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "reference",
    confidence: "high",
    valueGroup: 1,
  },
  // Shipper ref # L512210 -> Reference (TOPCO/e2open format)
  {
    pattern: /\bshipper\s+ref\s*#?\s*:?\s*([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "reference",
    confidence: "high",
    valueGroup: 1,
  },
  // Ref #(s) Shipments: 4502458490 -> Shipment reference (TOPCO format)
  // Exclude common words like INFO, ORDER that might follow "Ref #(s)"
  {
    pattern: /\bref\s*#\(?s?\)?\s*:?\s*(?:shipments?\s*:?\s*)?(\d{6,20})\b/gi,
    type: "reference_number",
    subtype: "reference",
    confidence: "high",
    valueGroup: 1,
  },
  // loadID=200906660 in URLs -> Load ID (TOPCO format)
  {
    pattern: /\bloadID=(\d{6,15})\b/gi,
    type: "reference_number",
    subtype: "bol",
    confidence: "high",
    valueGroup: 1,
  },
  // Reference number: PO 8406730 -> PO (Brakebush format)
  {
    pattern: /\breference\s*number\s*:\s*(?:PO|po)\s+([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "po",
    confidence: "high",
    valueGroup: 1,
  },
  // Reference number: PU 19127010 -> Pickup number
  {
    pattern: /\breference\s*number\s*:\s*(?:PU|pu)\s+([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "pickup",
    confidence: "high",
    valueGroup: 1,
  },
  // Reference number: AC 1045823 -> Confirmation/Account
  {
    pattern: /\breference\s*number\s*:\s*(?:AC|ac)\s+([A-Za-z0-9]{4,20})\b/gi,
    type: "reference_number",
    subtype: "confirmation",
    confidence: "high",
    valueGroup: 1,
  },

  // Standalone numbers that might be reference numbers (4+ digits)
  {
    pattern: /\b(\d{4,20})\b/g,
    type: "reference_number",
    subtype: "unknown",
    confidence: "low",
  },
];

function getContext(text: string, start: number, end: number, windowSize = 40): string {
  const contextStart = Math.max(0, start - windowSize);
  const contextEnd = Math.min(text.length, end + windowSize);
  let context = text.slice(contextStart, contextEnd);

  // Add ellipsis if truncated
  if (contextStart > 0) context = "..." + context;
  if (contextEnd < text.length) context = context + "...";

  // Normalize whitespace
  return context.replace(/\s+/g, " ").trim();
}

/**
 * Find label hint using customer rules first, then generic rules.
 * Now includes distance checking and block scope awareness.
 */
function findLabelHint(
  text: string,
  position: number,
  customerProfile?: CustomerProfile | null,
  ruleLog?: RuleApplicationLog
): { hint: string; subtype: ReferenceNumberSubtype; source: "customer" | "generic"; distance: number } | null {
  // Look backwards from the position to find a label (within MAX_LABEL_DISTANCE)
  const lookbackStart = Math.max(0, position - MAX_LABEL_DISTANCE);
  const lookbackWindow = text.slice(lookbackStart, position);

  // First, check customer-specific label rules (higher priority)
  if (customerProfile?.reference_label_rules?.length) {
    for (const rule of customerProfile.reference_label_rules) {
      // Create a regex from the label (case-insensitive, allows optional # or :)
      const escapedLabel = rule.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const labelPattern = new RegExp(`\\b${escapedLabel}\\s*[#:]?\\s*`, "i");
      const match = lookbackWindow.match(labelPattern);
      if (match && match.index !== undefined) {
        const distance = lookbackWindow.length - match.index - match[0].length;
        // Only apply if within reasonable distance
        if (distance <= MAX_LABEL_DISTANCE) {
          ruleLog?.applied.push({
            rule: `customer_label:${rule.label}`,
            candidate: `at position ${position}`,
            reason: `distance=${distance}`,
          });
          return { hint: match[0].trim(), subtype: rule.subtype, source: "customer", distance };
        } else {
          ruleLog?.skipped.push({
            rule: `customer_label:${rule.label}`,
            candidate: `at position ${position}`,
            reason: `distance ${distance} > ${MAX_LABEL_DISTANCE}`,
          });
        }
      }
    }
  }

  // Fall back to generic rules
  for (const { pattern, subtype } of REFERENCE_LABELS) {
    const match = lookbackWindow.match(pattern);
    if (match && match.index !== undefined) {
      const distance = lookbackWindow.length - match.index - match[0].length;
      return { hint: match[0].trim(), subtype, source: "generic", distance };
    }
  }

  return null;
}

/**
 * Check if a value matches any customer-specific regex rules.
 */
function matchCustomerRegexRules(
  value: string,
  customerProfile?: CustomerProfile | null
): { subtype: ReferenceNumberSubtype; source: "customer" } | null {
  if (!customerProfile?.reference_regex_rules?.length) {
    return null;
  }

  for (const rule of customerProfile.reference_regex_rules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (regex.test(value)) {
        return { subtype: rule.subtype, source: "customer" };
      }
    } catch {
      // Invalid regex, skip it
      console.warn(`Invalid customer regex pattern: ${rule.pattern}`);
    }
  }

  return null;
}

/**
 * Check if a value matches any customer-specific VALUE PATTERN rules.
 * These are the highest-priority rules - if a value matches the pattern,
 * it's classified as that type regardless of label.
 * 
 * HARDENED behavior:
 * - Enforces scope at application time (pickup/delivery/header/global)
 * - Skips deprecated rules (status !== "active")
 * - Returns rule index for hit tracking
 * 
 * @param value The reference number value to check
 * @param blockType The block type where this value was found (for scope checking)
 * @param customerProfile Customer profile with value rules
 */
function matchValuePatternRules(
  value: string,
  blockType: "header" | "pickup" | "delivery" | "unknown",
  customerProfile?: CustomerProfile | null
): { subtype: ReferenceNumberSubtype; rule: { pattern: string; scope: string }; ruleIndex: number } | null {
  if (!customerProfile?.reference_value_rules?.length) {
    return null;
  }

  // Filter out deprecated rules FIRST
  const activeRules = customerProfile.reference_value_rules
    .map((rule, index) => ({ rule, originalIndex: index }))
    .filter(({ rule }) => rule.status !== "deprecated");

  // Sort rules by priority (higher first), then by specificity (non-global before global)
  const sortedRules = activeRules.sort((a, b) => {
    // Priority first
    const priorityDiff = (b.rule.priority ?? 0) - (a.rule.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    // Then specificity - scoped rules before global
    if (a.rule.scope !== "global" && b.rule.scope === "global") return -1;
    if (a.rule.scope === "global" && b.rule.scope !== "global") return 1;
    return 0;
  });

  for (const { rule, originalIndex } of sortedRules) {
    // ENFORCE SCOPE at application time
    // Scoped rules only apply when blockType matches
    const scopeMatches = 
      rule.scope === "global" || 
      rule.scope === blockType ||
      (rule.scope === "header" && blockType === "unknown"); // header rules apply to unknown blocks

    if (!scopeMatches) {
      console.log(`[Extractor] Skipping rule ${rule.pattern}: scope ${rule.scope} != block ${blockType}`);
      continue;
    }

    try {
      const regex = new RegExp(rule.pattern, "i");
      if (regex.test(value)) {
        console.log(`[Extractor] Value pattern rule matched: "${value}" -> ${rule.subtype} (pattern: ${rule.pattern}, scope: ${rule.scope}, block: ${blockType})`);
        return { 
          subtype: rule.subtype, 
          rule: { pattern: rule.pattern, scope: rule.scope },
          ruleIndex: originalIndex,
        };
      }
    } catch {
      console.warn(`Invalid customer value pattern: ${rule.pattern}`);
    }
  }

  return null;
}

export interface ExtractCandidatesOptions {
  customerProfile?: CustomerProfile | null;
}

export function extractCandidates(
  text: string,
  options: ExtractCandidatesOptions = {}
): ExtractionResult {
  const { customerProfile } = options;
  const candidates: ExtractedCandidate[] = [];
  const seenPositions = new Set<string>(); // Avoid duplicates at same position
  let appliedCustomerRules = 0;
  
  // Rule application logging
  const ruleLog: RuleApplicationLog = { applied: [], skipped: [] };

  for (const config of PATTERNS) {
    // Reset regex lastIndex
    config.pattern.lastIndex = 0;

    let match;
    while ((match = config.pattern.exec(text)) !== null) {
      const posKey = `${match.index}-${match.index + match[0].length}`;
      if (seenPositions.has(posKey)) continue;

      let value = config.valueGroup !== undefined
        ? match[config.valueGroup]
        : match[0];

      // Strip commas from weight and pieces values for clean numeric parsing
      if ((config.type === "weight" || config.type === "pieces") && value) {
        value = value.replace(/,/g, "");
      }

      let labelHint: string | null = null;
      let subtype = config.subtype || null;
      let usedCustomerRule = false;

      // For reference numbers, apply COMPREHENSIVE phone detection
      // Phone exclusion ALWAYS wins - EXCEPT for high-confidence labeled patterns
      // If a pattern has explicit subtype and high confidence (like "Load #: 121230"),
      // we trust the label over heuristic-based phone detection
      if (config.type === "reference_number") {
        const phoneCheck = isDefinitelyPhone(value, text, match.index);
        if (phoneCheck.isPhone) {
          // For high-confidence patterns with explicit labels (subtype defined in pattern),
          // only reject if it's DEFINITELY a phone by format (10-digit, explicit phone pattern)
          // Trust explicit labels over heuristics like partial_phone or phone_label_nearby
          const isHighConfidenceLabeled = config.confidence === "high" && config.subtype;
          const isDefinitePhoneFormat = phoneCheck.reason === "matches_phone_pattern" || 
                                        phoneCheck.reason === "10_digit_number";
          
          if (!isHighConfidenceLabeled || isDefinitePhoneFormat) {
            ruleLog.skipped.push({
              rule: "phone_exclusion",
              candidate: value,
              reason: phoneCheck.reason,
            });
            continue;
          }
          // Otherwise, trust the explicit label and continue processing
        }
        
        // Also check bounds - refs should be 4-25 chars
        if (value.length < MIN_REF_LENGTH || value.length > MAX_REF_LENGTH) {
          ruleLog.skipped.push({
            rule: "length_bounds",
            candidate: value,
            reason: `length ${value.length} outside ${MIN_REF_LENGTH}-${MAX_REF_LENGTH}`,
          });
          continue;
        }
        
        // Skip if label suggests it's not a reference (total miles, dollar amounts, etc.)
        if (hasNonReferenceLabel(text, match.index)) {
          ruleLog.skipped.push({
            rule: "non_reference_label",
            candidate: value,
            reason: "near non-reference label (total miles, etc.)",
          });
          continue;
        }
      }

      // For reference numbers, try to find a label hint or match regex rules
      // Also determine block scope (header vs stop)
      // 
      // Rule precedence (highest to lowest):
      // 1. Value pattern rules - match on the VALUE itself (e.g., TRFR* -> PO)
      // 2. Customer regex rules - legacy, match on value with context
      // 3. Customer label rules - match on nearby label
      // 4. Generic label rules - built-in patterns
      if (config.type === "reference_number") {
        // Determine what block this candidate is in
        const blockType = getBlockTypeAtPosition(text, match.index);
        
        // HIGHEST PRIORITY: Value pattern rules
        // If the value matches a pattern, classify it regardless of label
        const valuePatternMatch = matchValuePatternRules(value.trim(), blockType, customerProfile);
        if (valuePatternMatch) {
          subtype = valuePatternMatch.subtype;
          usedCustomerRule = true;
          ruleLog.applied.push({
            rule: `value_pattern:${valuePatternMatch.rule.pattern}`,
            candidate: value,
            reason: `block=${blockType}, scope=${valuePatternMatch.rule.scope}`,
          });
        }
        
        if (!usedCustomerRule) {
          // Second priority: Customer regex rules on the value itself
          // But only if we have label context nearby (safety guard)
          const regexMatch = matchCustomerRegexRules(value.trim(), customerProfile);
          if (regexMatch) {
            // Verify there's some label context - don't apply regex globally without context
            const nearbyContext = text.slice(Math.max(0, match.index - 100), match.index + value.length + 50);
            const hasLabelContext = /[#:]/.test(nearbyContext) || /\b(load|order|po|ref|bol|confirmation|release)\b/i.test(nearbyContext);
            
            if (hasLabelContext) {
              subtype = regexMatch.subtype;
              usedCustomerRule = true;
              ruleLog.applied.push({
                rule: `customer_regex`,
                candidate: value,
                reason: `block=${blockType}, has_context=${hasLabelContext}`,
              });
            } else {
              ruleLog.skipped.push({
                rule: `customer_regex`,
                candidate: value,
                reason: "no_label_context_nearby",
              });
            }
          }
        }
        
        if (!usedCustomerRule) {
          // Third priority: Label hints (customer rules checked first inside findLabelHint)
          const hintResult = findLabelHint(text, match.index, customerProfile, ruleLog);
          if (hintResult) {
            labelHint = hintResult.hint;
            subtype = hintResult.subtype;
            if (hintResult.source === "customer") {
              usedCustomerRule = true;
            }
          }
        }
      }

      if (usedCustomerRule) {
        appliedCustomerRules++;
      }

      const candidate: ExtractedCandidate = {
        type: config.type,
        value: value.trim(),
        raw_match: match[0],
        label_hint: labelHint,
        subtype,
        confidence: config.confidence,
        position: {
          start: match.index,
          end: match.index + match[0].length,
        },
        context: getContext(text, match.index, match.index + match[0].length),
      };

      candidates.push(candidate);
      seenPositions.add(posKey);
    }
  }

  // Sort by position
  candidates.sort((a, b) => a.position.start - b.position.start);

  // Filter out low-confidence reference numbers that overlap with high-confidence matches
  const filtered = filterOverlappingCandidates(candidates);

  return {
    candidates: filtered,
    metadata: {
      extracted_at: new Date().toISOString(),
      text_length: text.length,
      version: EXTRACTOR_VERSION,
      customer_id: customerProfile?.id,
      applied_customer_rules: appliedCustomerRules,
      rules_applied_count: ruleLog.applied.length,
      rules_skipped_count: ruleLog.skipped.length,
      rules_applied_details: ruleLog.applied,
      rules_skipped_reasons: ruleLog.skipped,
    },
  };
}

function filterOverlappingCandidates(candidates: ExtractedCandidate[]): ExtractedCandidate[] {
  const result: ExtractedCandidate[] = [];

  for (const candidate of candidates) {
    // Check if this candidate overlaps with a higher-confidence one already added
    const overlapsWithBetter = result.some((existing) => {
      const overlaps =
        candidate.position.start < existing.position.end &&
        candidate.position.end > existing.position.start;

      if (!overlaps) return false;

      // Keep the higher confidence one, or the more specific type
      if (candidate.confidence === "low" && existing.confidence !== "low") {
        return true;
      }
      if (candidate.type === "reference_number" && existing.type !== "reference_number") {
        return true;
      }

      return false;
    });

    if (!overlapsWithBetter) {
      result.push(candidate);
    }
  }

  return result;
}
