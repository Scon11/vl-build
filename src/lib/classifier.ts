import OpenAI from "openai";
import {
  ExtractedCandidate,
  StructuredShipment,
  VerifiedShipmentResult,
  CustomerProfile,
  NormalizationMetadata,
} from "./types";
import { verifyShipment } from "./verifier";
import { normalizeShipment } from "./normalizer";

const CLASSIFIER_MODEL = "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a precise load tender extractor for freight brokerage. Your ONLY data sources are the provided original text and extracted candidates. NEVER invent, infer, truncate, or hallucinate any value—return null if no exact match exists in candidates or text.

Key Rules:
- Classify ONLY from the candidates list. Ignore anything not listed.
- For reference numbers:
  - Subtypes: po, bol, order, pickup, delivery, appointment, reference, confirmation, pro, unknown.
  - CRITICAL: When a candidate is marked [HIGH CONFIDENCE - TRUST THIS], USE that subtype exactly. Do not override it.
  - "Load #" or "Load #:" followed by a number = BOL (bill of lading). This is the shipment identifier.
  - Use label_hint for classification (e.g., "PO #:" → po, "Release #:" → po, "Confirmation #:" → confirmation).
  - If label ambiguous and no high-confidence subtype, check value pattern (e.g., 6+ digits → likely po/bol, alphanumeric → reference).
  - Scope: Global (header-level like Load #, PO from non-stop sections) go in shipment.reference_numbers. Stop-level (Pickup #, Delivery #, Appt #, Confirmation # from stop blocks) go in stops[].reference_numbers.
  - De-dupe: If same value appears globally and in stop, prefer stop-level if context ties it there.
  - Reject: NEVER classify phones (XXX-XXX-XXXX, 10 digits), addresses (street numbers like "6755" in "6755 W 100 N"), dates, weights, or random verbiage as references. Mark unclear as "unknown".
- For cargo:
  - Pull from header totals first. IMPORTANT: Remove commas from numbers (e.g., "Total Lbs: 22,176" → weight value: 22176 as integer, "Total Cases: 2,464" → pieces count: 2464).
  - Weight candidates with type "weight" contain the extracted value - use it directly.
  - Fallback to aggregated stop values if header missing.
  - Temperature: Extract exact (e.g., "-10" = -10). Use customer hints for mode (frozen/refrigerated/dry). If temp < 32°F, mode is "frozen". If 32-45°F, mode is "refrigerated".
  - Commodity: From notes (e.g., "FROZEN/REFRIGERATED MIX" → "frozen/refrigerated mix").
- For stops:
  - Sequence pickups before deliveries.
  - Location: Full address string, parse city/state/zip separately if candidates provide.
  - Schedule: Date/time exact from text; appt_required true if "Call for Appt." mentioned.
- Output STRICT JSON matching the StructuredShipment schema. No explanations, no extra properties, no text outside JSON.
- If field missing or unclassifiable, set to null. Confidence notes only if low match.`;

interface ClassifyInput {
  originalText: string;
  candidates: ExtractedCandidate[];
  customerProfile?: CustomerProfile | null;
}

/**
 * Build customer-specific context for the LLM prompt.
 */
function buildCustomerContext(profile: CustomerProfile): string {
  const lines: string[] = [];
  lines.push(`\nCUSTOMER-SPECIFIC RULES (${profile.name}):`);

  // Label rules
  if (profile.reference_label_rules?.length) {
    lines.push("Reference Label Mappings:");
    for (const rule of profile.reference_label_rules) {
      lines.push(`  - "${rule.label}" → ${rule.subtype.toUpperCase()}`);
    }
  }

  // Regex rules
  if (profile.reference_regex_rules?.length) {
    lines.push("Reference Number Patterns:");
    for (const rule of profile.reference_regex_rules) {
      const desc = rule.description ? ` (${rule.description})` : "";
      lines.push(`  - Pattern /${rule.pattern}/ → ${rule.subtype.toUpperCase()}${desc}`);
    }
  }

  // Stop parsing hints
  const hints = profile.stop_parsing_hints;
  if (hints && Object.keys(hints).length > 0) {
    lines.push("Stop Parsing Hints:");
    if (hints.pickup_keywords?.length) {
      lines.push(`  - Pickup keywords: ${hints.pickup_keywords.join(", ")}`);
    }
    if (hints.delivery_keywords?.length) {
      lines.push(`  - Delivery keywords: ${hints.delivery_keywords.join(", ")}`);
    }
    if (hints.stop_delimiter) {
      lines.push(`  - Stop delimiter: "${hints.stop_delimiter}"`);
    }
  }

  // Cargo hints
  const cargoHints = profile.cargo_hints;
  if (cargoHints) {
    lines.push("Cargo Rules for this customer:");
    if (cargoHints.commodity_by_temp) {
      if (cargoHints.commodity_by_temp.frozen) {
        lines.push(`  - If temperature is frozen (< 32°F or negative): commodity = "${cargoHints.commodity_by_temp.frozen}"`);
      }
      if (cargoHints.commodity_by_temp.refrigerated) {
        lines.push(`  - If temperature is refrigerated (32-40°F): commodity = "${cargoHints.commodity_by_temp.refrigerated}"`);
      }
      if (cargoHints.commodity_by_temp.dry) {
        lines.push(`  - If no temperature/dry: commodity = "${cargoHints.commodity_by_temp.dry}"`);
      }
    }
    if (cargoHints.default_commodity) {
      lines.push(`  - Default commodity: "${cargoHints.default_commodity}"`);
    }
    if (cargoHints.default_temp_mode) {
      lines.push(`  - Default temperature mode: ${cargoHints.default_temp_mode}`);
    }
  }

  lines.push("Apply these customer-specific rules when classifying this shipment.\n");
  
  return lines.join("\n");
}

// OpenAI strict mode requires additionalProperties: false on ALL objects
const RESPONSE_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    reference_numbers: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          type: {
            type: "string" as const,
            enum: ["po", "bol", "order", "pickup", "delivery", "appointment", "reference", "confirmation", "pro", "unknown"],
          },
          value: { type: "string" as const },
          applies_to: {
            type: ["string", "null"] as const,
            enum: ["shipment", "pickup", "delivery", "stop", null],
          },
        },
        required: ["type", "value", "applies_to"],
      },
    },
    stops: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          type: { type: "string" as const, enum: ["pickup", "delivery"] },
          sequence: { type: "number" as const },
          location: {
            type: "object" as const,
            additionalProperties: false,
            properties: {
              name: { type: ["string", "null"] as const },
              address: { type: ["string", "null"] as const },
              city: { type: ["string", "null"] as const },
              state: { type: ["string", "null"] as const },
              zip: { type: ["string", "null"] as const },
              country: { type: ["string", "null"] as const },
            },
            required: ["name", "address", "city", "state", "zip", "country"],
          },
          schedule: {
            type: "object" as const,
            additionalProperties: false,
            properties: {
              date: { type: ["string", "null"] as const },
              time: { type: ["string", "null"] as const },
              appointment_required: { type: ["boolean", "null"] as const },
            },
            required: ["date", "time", "appointment_required"],
          },
          reference_numbers: {
            type: "array" as const,
            items: {
              type: "object" as const,
              additionalProperties: false,
              properties: {
                type: { type: "string" as const },
                value: { type: "string" as const },
              },
              required: ["type", "value"],
            },
          },
          notes: { type: ["string", "null"] as const },
        },
        required: ["type", "sequence", "location", "schedule", "reference_numbers", "notes"],
      },
    },
    cargo: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        weight: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            value: { type: ["number", "null"] as const },
            unit: { type: ["string", "null"] as const },
          },
          required: ["value", "unit"],
        },
        pieces: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            count: { type: ["number", "null"] as const },
            type: { type: ["string", "null"] as const },
          },
          required: ["count", "type"],
        },
        dimensions: {
          type: ["object", "null"] as const,
          additionalProperties: false,
          properties: {
            length: { type: ["number", "null"] as const },
            width: { type: ["number", "null"] as const },
            height: { type: ["number", "null"] as const },
            unit: { type: ["string", "null"] as const },
          },
          required: ["length", "width", "height", "unit"],
        },
        commodity: { type: ["string", "null"] as const },
        temperature: {
          type: ["object", "null"] as const,
          additionalProperties: false,
          properties: {
            value: { type: ["number", "null"] as const },
            unit: { type: ["string", "null"] as const },
            mode: { type: ["string", "null"] as const },
          },
          required: ["value", "unit", "mode"],
        },
      },
      required: ["weight", "pieces", "dimensions", "commodity", "temperature"],
    },
    unclassified_notes: {
      type: "array" as const,
      items: { type: "string" as const },
    },
  },
  required: ["reference_numbers", "stops", "cargo", "unclassified_notes"],
};

export async function classifyShipment(input: ClassifyInput): Promise<StructuredShipment> {
  const { originalText, candidates, customerProfile } = input;

  // Format candidates for the prompt - include confidence for high-confidence items
  const candidatesSummary = candidates
    .map((c) => {
      let desc = `- ${c.type}: "${c.value}"`;
      if (c.label_hint) desc += ` (label: "${c.label_hint}")`;
      if (c.subtype && c.subtype !== "unknown") {
        desc += ` [subtype: ${c.subtype}]`;
        if (c.confidence === "high") desc += ` [HIGH CONFIDENCE - TRUST THIS]`;
      }
      desc += ` | context: "${c.context}"`;
      return desc;
    })
    .join("\n");

  // Build customer-specific context if available
  const customerContext = customerProfile ? buildCustomerContext(customerProfile) : "";

  const userPrompt = `ORIGINAL TENDER TEXT:
"""
${originalText}
"""

EXTRACTED CANDIDATES:
${candidatesSummary || "(no candidates extracted)"}
${customerContext}
Please structure this into a shipment schema. Remember: use null for any field not clearly present in the text. Do not invent data.`;

  const response = await openai.chat.completions.create({
    model: CLASSIFIER_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "structured_shipment",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
    temperature: 0.1, // Low temp for consistency
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from LLM");
  }

  const parsed = JSON.parse(content);

  // Add classification metadata
  const result: StructuredShipment = {
    ...parsed,
    classification_metadata: {
      model: CLASSIFIER_MODEL,
      classified_at: new Date().toISOString(),
      confidence_notes: null,
    },
  };

  return result;
}

/**
 * Apply learned cargo defaults from customer profile.
 * This is a deterministic step that fills in blank cargo fields based on learned rules.
 */
function applyCargoDefaults(
  shipment: StructuredShipment,
  customerProfile?: CustomerProfile | null
): StructuredShipment {
  console.log(`[CargoDefaults] applyCargoDefaults called`);
  console.log(`[CargoDefaults]   customerProfile: ${customerProfile?.name ?? "null"}`);
  console.log(`[CargoDefaults]   cargo_hints: ${JSON.stringify(customerProfile?.cargo_hints)}`);
  console.log(`[CargoDefaults]   current commodity: "${shipment.cargo.commodity}"`);
  console.log(`[CargoDefaults]   current temp: ${shipment.cargo.temperature?.value}, mode: ${shipment.cargo.temperature?.mode}`);
  
  if (!customerProfile?.cargo_hints) {
    console.log(`[CargoDefaults] No cargo hints, returning unchanged`);
    return shipment;
  }

  const hints = customerProfile.cargo_hints;
  const cargo = { ...shipment.cargo };
  let applied = false;

  // Apply commodity based on temperature if commodity is blank
  if (!cargo.commodity && hints.commodity_by_temp) {
    const temp = cargo.temperature?.value;
    const mode = cargo.temperature?.mode;
    
    // Determine temperature category from value or mode
    let category: "frozen" | "refrigerated" | "dry" | null = null;
    
    if (temp !== null && temp !== undefined) {
      // Use temperature value if available
      if (temp < 32) {
        category = "frozen";
      } else if (temp >= 32 && temp <= 45) {
        category = "refrigerated";
      } else {
        category = "dry";
      }
    } else if (mode) {
      // Fallback to temperature mode
      const modeLower = mode.toLowerCase();
      if (modeLower === "frozen") {
        category = "frozen";
      } else if (modeLower === "refrigerated" || modeLower === "reefer") {
        category = "refrigerated";
      } else if (modeLower === "dry" || modeLower === "ambient") {
        category = "dry";
      }
    }

    // Apply commodity if we have one for this category
    const learnedCommodity = category ? hints.commodity_by_temp[category] : undefined;
    if (learnedCommodity) {
      cargo.commodity = learnedCommodity;
      applied = true;
      console.log(`[CargoDefaults] Applied ${category} commodity: "${cargo.commodity}" (temp: ${temp ?? "N/A"}, mode: ${mode ?? "N/A"})`);
    }
  }

  // Apply default commodity if still blank and we have a default
  if (!cargo.commodity && hints.default_commodity) {
    cargo.commodity = hints.default_commodity;
    applied = true;
    console.log(`[CargoDefaults] Applied default commodity: "${cargo.commodity}"`);
  }

  // Apply default temp mode if blank and we have a default
  if (!cargo.temperature?.mode && hints.default_temp_mode && cargo.temperature) {
    cargo.temperature = { ...cargo.temperature, mode: hints.default_temp_mode };
    applied = true;
    console.log(`[CargoDefaults] Applied default temp mode: "${hints.default_temp_mode}"`);
  }

  if (applied) {
    return { ...shipment, cargo };
  }

  return shipment;
}

/**
 * Classify shipment and verify the results against source data.
 * Returns both the verified shipment and any warnings about unsupported values.
 */
export async function classifyAndVerifyShipment(
  input: ClassifyInput
): Promise<VerifiedShipmentResult> {
  const { originalText, candidates, customerProfile } = input;

  // First, get the raw LLM classification (with customer context)
  const rawShipment = await classifyShipment(input);

  // Normalize to properly scope refs to stops vs shipment-level
  const normalizationResult = normalizeShipment(rawShipment, originalText, candidates);
  let normalizedShipment = normalizationResult.shipment;

  console.log(
    `[Normalization] Moved ${normalizationResult.metadata.refs_moved_to_stops} refs to stops, ` +
    `deduplicated ${normalizationResult.metadata.refs_deduplicated} refs, ` +
    `cargo source: ${normalizationResult.metadata.cargo_source}`
  );

  // First verify against source data (BEFORE applying defaults)
  // This ensures we don't reject learned defaults that aren't in the source document
  const verificationResult = verifyShipment({
    shipment: normalizedShipment,
    candidates,
    originalText,
  });

  // Apply learned cargo defaults from customer profile AFTER verification
  // This way the verifier won't reject values that come from learned rules
  const finalShipment = applyCargoDefaults(verificationResult.shipment, customerProfile);

  return {
    shipment: finalShipment,
    warnings: verificationResult.warnings,
    normalization: normalizationResult.metadata,
  };
}
