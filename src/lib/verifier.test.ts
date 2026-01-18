/**
 * Unit tests for the post-LLM verification layer with provenance tracking
 *
 * Test cases:
 * 1. Supported reference number (found in candidates)
 * 2. Unsupported reference number (hallucinated - not in text or candidates)
 * 3. Supported address normalization (words found in original text)
 * 4. Unsupported time (hallucinated time not in source)
 * 5. Multi-stop references (multiple stops with mixed supported/unsupported refs)
 * 6. Provenance tracking for verified fields
 * 7. Rule-based values should not trigger hallucination warnings
 * 8. Warning categories (hallucinated vs unverified)
 */

import { verifyShipment, getHallucinatedWarnings, getUnverifiedWarnings } from "./verifier";
import {
  StructuredShipment,
  ExtractedCandidate,
  VerifiedShipmentResult,
  FieldProvenanceMap,
} from "./types";

// Helper to create a minimal valid shipment structure
function createBaseShipment(
  overrides: Partial<StructuredShipment> = {}
): StructuredShipment {
  return {
    reference_numbers: [],
    stops: [],
    cargo: {
      weight: { value: null, unit: null },
      pieces: { count: null, type: null },
      dimensions: null,
      commodity: null,
      temperature: null,
    },
    unclassified_notes: [],
    classification_metadata: {
      model: "gpt-4o-mini",
      classified_at: new Date().toISOString(),
      confidence_notes: null,
    },
    ...overrides,
  };
}

// Helper to create a candidate
function createCandidate(
  value: string,
  type: ExtractedCandidate["type"] = "reference_number",
  confidence: "high" | "medium" | "low" = "high"
): ExtractedCandidate {
  return {
    type,
    value,
    raw_match: value,
    label_hint: null,
    subtype: type === "reference_number" ? "unknown" : null,
    confidence,
    position: { start: 0, end: value.length },
    context: `...${value}...`,
  };
}

describe("verifyShipment", () => {
  // Test Case 1: Supported reference number (found in candidates)
  describe("supported reference number", () => {
    it("should pass through reference numbers that exist in candidates", () => {
      const originalText = "Load #12345 for customer ABC Corp";
      const candidates = [createCandidate("12345")];
      const shipment = createBaseShipment({
        reference_numbers: [{ type: "reference", value: "12345" }],
      });

      const result: VerifiedShipmentResult = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(getHallucinatedWarnings(result.warnings)).toHaveLength(0);
      expect(result.shipment.reference_numbers[0].value).toBe("12345");
      expect(result.shipment.reference_numbers[0].type).toBe("reference");
      // Provenance should be tracked
      expect(result.provenance["reference_numbers[0].value"]).toBeDefined();
      expect(result.provenance["reference_numbers[0].value"].source_type).toBe("document_text");
    });

    it("should pass through reference numbers found in original text", () => {
      const originalText = "Please pick up order 9876543 from warehouse.";
      const candidates: ExtractedCandidate[] = [];
      const shipment = createBaseShipment({
        reference_numbers: [{ type: "order", value: "9876543" }],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(getHallucinatedWarnings(result.warnings)).toHaveLength(0);
      expect(result.shipment.reference_numbers[0].value).toBe("9876543");
    });
  });

  // Test Case 2: Unsupported reference number (hallucinated)
  describe("unsupported reference number - hallucinated", () => {
    it("should flag with hallucinated category when reference number is not in text or candidates", () => {
      const originalText = "Load #12345 for delivery to Chicago";
      const candidates = [createCandidate("12345")];
      const shipment = createBaseShipment({
        reference_numbers: [
          { type: "po", value: "FAKE-99999" }, // This doesn't exist anywhere
          { type: "reference", value: "12345" }, // This is valid
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].path).toBe("reference_numbers[0].value");
      expect(hallucinated[0].value).toBe("FAKE-99999");
      expect(hallucinated[0].reason).toBe("unsupported_by_source");
      expect(hallucinated[0].category).toBe("hallucinated");
      
      // Should be marked as unknown
      expect(result.shipment.reference_numbers[0].type).toBe("unknown");
      // Valid one should remain unchanged
      expect(result.shipment.reference_numbers[1].type).toBe("reference");
    });

    it("should accept values that contain the extracted candidate", () => {
      const originalText = "Reference: 1234567890";
      const candidates = [createCandidate("1234567890")];
      const shipment = createBaseShipment({
        reference_numbers: [
          { type: "reference", value: "999-1234567890-ZZZ" }, // Contains the number
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(getHallucinatedWarnings(result.warnings)).toHaveLength(0);
    });

    it("should reject values that share no overlap with source", () => {
      const originalText = "Reference: 1234567890";
      const candidates = [createCandidate("1234567890")];
      const shipment = createBaseShipment({
        reference_numbers: [
          { type: "reference", value: "COMPLETELY-DIFFERENT" }, // No overlap at all
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].value).toBe("COMPLETELY-DIFFERENT");
    });
  });

  // Test Case 3: Supported address normalization
  describe("supported address normalization", () => {
    it("should accept addresses with minor normalization when key words are in text", () => {
      const originalText =
        "Pickup at 123 Main Street, Chicago, IL 60601. Deliver to warehouse.";
      const candidates = [
        createCandidate("123 Main Street", "address"),
        createCandidate("Chicago, IL 60601", "city_state_zip"),
      ];
      const shipment = createBaseShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: {
              name: null,
              address: "123 Main St", // Normalized from "Street" to "St"
              city: "Chicago",
              state: "IL",
              zip: "60601",
              country: null,
            },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [],
            notes: null,
          },
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(getHallucinatedWarnings(result.warnings)).toHaveLength(0);
      expect(result.shipment.stops[0].location.address).toBe("123 Main St");
    });

    it("should flag completely fabricated addresses as hallucinated", () => {
      const originalText = "Pickup at 123 Main Street, Chicago, IL 60601.";
      const candidates = [createCandidate("123 Main Street", "address")];
      const shipment = createBaseShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: {
              name: null,
              address: "999 Fake Boulevard", // Completely made up
              city: "Chicago",
              state: "IL",
              zip: "60601",
              country: null,
            },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [],
            notes: null,
          },
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated.length).toBeGreaterThan(0);
      const addressWarning = hallucinated.find((w) =>
        w.path.includes("address")
      );
      expect(addressWarning).toBeDefined();
      expect(addressWarning?.value).toBe("999 Fake Boulevard");
      expect(addressWarning?.category).toBe("hallucinated");
      // Address should be nulled out
      expect(result.shipment.stops[0].location.address).toBeNull();
    });
  });

  // Test Case 4: Unsupported time (hallucinated)
  describe("unsupported time - hallucinated", () => {
    it("should flag times not found in source with hallucinated category", () => {
      const originalText = "Pickup scheduled for 01/15/2026 at 8:00 AM";
      const candidates = [
        createCandidate("01/15/2026", "date"),
        createCandidate("8:00 AM", "time"),
      ];
      const shipment = createBaseShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: {
              name: null,
              address: null,
              city: null,
              state: null,
              zip: null,
              country: null,
            },
            schedule: {
              date: "01/15/2026",
              time: "14:30", // This time was never mentioned!
              appointment_required: null,
            },
            reference_numbers: [],
            notes: null,
          },
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].path).toBe("stops[0].schedule.time");
      expect(hallucinated[0].value).toBe("14:30");
      expect(hallucinated[0].category).toBe("hallucinated");
      
      // Time should be nulled
      expect(result.shipment.stops[0].schedule.time).toBeNull();
      // Date should remain valid
      expect(result.shipment.stops[0].schedule.date).toBe("01/15/2026");
    });

    it("should accept times found in original text", () => {
      const originalText = "Delivery window: 2:30 PM - 4:00 PM";
      const candidates = [
        createCandidate("2:30 PM", "time"),
        createCandidate("4:00 PM", "time"),
      ];
      const shipment = createBaseShipment({
        stops: [
          {
            type: "delivery",
            sequence: 1,
            location: {
              name: null,
              address: null,
              city: null,
              state: null,
              zip: null,
              country: null,
            },
            schedule: {
              date: null,
              time: "2:30 PM",
              appointment_required: null,
            },
            reference_numbers: [],
            notes: null,
          },
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(getHallucinatedWarnings(result.warnings)).toHaveLength(0);
    });
  });

  // Test Case 5: Multi-stop references
  describe("multi-stop references", () => {
    it("should verify reference numbers across multiple stops independently", () => {
      const originalText = `
        Pickup #1: PO 111111 at Denver, CO
        Pickup #2: PO 222222 at Salt Lake City, UT
        Delivery: Order 333333 at Los Angeles, CA
      `;
      const candidates = [
        createCandidate("111111"),
        createCandidate("222222"),
        createCandidate("333333"),
        createCandidate("Denver, CO", "city_state_zip"),
        createCandidate("Salt Lake City, UT", "city_state_zip"),
        createCandidate("Los Angeles, CA", "city_state_zip"),
      ];
      const shipment = createBaseShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: {
              name: null,
              address: null,
              city: "Denver",
              state: "CO",
              zip: null,
              country: null,
            },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [{ type: "po", value: "111111" }],
            notes: null,
          },
          {
            type: "pickup",
            sequence: 2,
            location: {
              name: null,
              address: null,
              city: "Salt Lake City",
              state: "UT",
              zip: null,
              country: null,
            },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [
              { type: "po", value: "222222" },
              { type: "reference", value: "FAKE-REF" }, // Hallucinated
            ],
            notes: null,
          },
          {
            type: "delivery",
            sequence: 3,
            location: {
              name: null,
              address: null,
              city: "Los Angeles",
              state: "CA",
              zip: null,
              country: null,
            },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [{ type: "order", value: "333333" }],
            notes: null,
          },
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].path).toBe("stops[1].reference_numbers[1].value");
      expect(hallucinated[0].value).toBe("FAKE-REF");
      expect(hallucinated[0].category).toBe("hallucinated");

      // Valid references should be unchanged
      expect(result.shipment.stops[0].reference_numbers[0].value).toBe("111111");
      expect(result.shipment.stops[1].reference_numbers[0].value).toBe("222222");
      expect(result.shipment.stops[2].reference_numbers[0].value).toBe("333333");

      // Invalid reference should be marked as unknown
      expect(result.shipment.stops[1].reference_numbers[1].type).toBe("unknown");
    });

    it("should handle empty stops array", () => {
      const originalText = "Some tender text";
      const candidates: ExtractedCandidate[] = [];
      const shipment = createBaseShipment({
        stops: [],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(result.warnings).toHaveLength(0);
      expect(result.shipment.stops).toHaveLength(0);
    });
  });

  // Test Case 6: Provenance tracking
  describe("provenance tracking", () => {
    it("should create provenance records for verified fields", () => {
      const originalText = "Load #12345, Weight: 45000 lbs";
      const candidates = [
        createCandidate("12345"),
        createCandidate("45000", "weight"),
      ];
      const shipment = createBaseShipment({
        reference_numbers: [{ type: "bol", value: "12345" }],
        cargo: {
          weight: { value: 45000, unit: "lbs" },
          pieces: { count: null, type: null },
          dimensions: null,
          commodity: null,
          temperature: null,
        },
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      // Check provenance for reference number
      const refProvenance = result.provenance["reference_numbers[0].value"];
      expect(refProvenance).toBeDefined();
      expect(refProvenance.source_type).toBe("document_text");
      expect(refProvenance.confidence).toBeGreaterThan(0);
      expect(refProvenance.evidence.length).toBeGreaterThan(0);

      // Check provenance for weight
      const weightProvenance = result.provenance["cargo.weight.value"];
      expect(weightProvenance).toBeDefined();
      expect(weightProvenance.source_type).toBe("document_text");
    });

    it("should preserve existing rule-based provenance", () => {
      const originalText = "Temperature: -10°F";
      const candidates = [createCandidate("-10", "temperature")];
      const shipment = createBaseShipment({
        cargo: {
          weight: { value: null, unit: null },
          pieces: { count: null, type: null },
          dimensions: null,
          commodity: "Frozen Food", // This came from a customer rule
          temperature: { value: -10, unit: "F", mode: "frozen" },
        },
      });

      // Pre-existing provenance from cargo defaults
      const existingProvenance: FieldProvenanceMap = {
        "cargo.commodity": {
          source_type: "rule",
          confidence: 0.9,
          evidence: [],
          reason: "customer cargo rule: temp -10 => Frozen Food",
          applied_at: new Date().toISOString(),
        },
      };

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
        existingProvenance,
      });

      // Commodity should NOT be flagged as hallucinated because it has rule-based provenance
      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(0);
      
      // Commodity should remain unchanged
      expect(result.shipment.cargo.commodity).toBe("Frozen Food");
      
      // Provenance should be preserved
      expect(result.provenance["cargo.commodity"].source_type).toBe("rule");
    });
  });

  // Test Case 7: Rule-based values
  describe("rule-based values", () => {
    it("should never flag rule-based values as hallucinated", () => {
      const originalText = "Weight: 45000 lbs, Temperature: -10°F";
      const candidates = [
        createCandidate("45000", "weight"),
        createCandidate("-10", "temperature"),
      ];
      const shipment = createBaseShipment({
        cargo: {
          weight: { value: 45000, unit: "lbs" },
          pieces: { count: null, type: null },
          dimensions: null,
          commodity: "Frozen Food", // From customer rule
          temperature: { value: -10, unit: "F", mode: "frozen" },
        },
      });

      const existingProvenance: FieldProvenanceMap = {
        "cargo.commodity": {
          source_type: "rule",
          confidence: 0.9,
          evidence: [],
          reason: "customer cargo rule",
        },
        "cargo.temperature.mode": {
          source_type: "rule",
          confidence: 0.85,
          evidence: [],
          reason: "customer default temp mode",
        },
      };

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
        existingProvenance,
      });

      // No hallucination warnings for rule-based values
      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(0);

      // Values should remain
      expect(result.shipment.cargo.commodity).toBe("Frozen Food");
    });
  });

  // Test Case 8: Warning categories
  describe("warning categories", () => {
    it("should correctly categorize hallucinated vs unverified warnings", () => {
      const originalText = "Reference: 1234567890";
      const candidates = [createCandidate("1234567890")];
      const shipment = createBaseShipment({
        reference_numbers: [
          { type: "reference", value: "INVENTED-VALUE" }, // No source - hallucinated
        ],
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      const hallucinated = getHallucinatedWarnings(result.warnings);
      const unverified = getUnverifiedWarnings(result.warnings);

      // INVENTED-VALUE should be hallucinated
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].value).toBe("INVENTED-VALUE");
      expect(hallucinated[0].category).toBe("hallucinated");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("should handle null values gracefully", () => {
      const originalText = "Some tender text";
      const candidates: ExtractedCandidate[] = [];
      const shipment = createBaseShipment({
        cargo: {
          weight: { value: null, unit: null },
          pieces: { count: null, type: null },
          dimensions: null,
          commodity: null,
          temperature: null,
        },
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      expect(result.warnings).toHaveLength(0);
    });

    it("should verify cargo fields and flag hallucinated commodity", () => {
      const originalText = "Weight: 45000 lbs, 10 pallets of frozen goods";
      const candidates = [
        createCandidate("45000", "weight"),
        createCandidate("10", "pieces"),
      ];
      const shipment = createBaseShipment({
        cargo: {
          weight: { value: 45000, unit: "lbs" },
          pieces: { count: 10, type: "pallets" },
          dimensions: null,
          commodity: "Imaginary Product XYZ", // Not in text
          temperature: null,
        },
      });

      const result = verifyShipment({
        shipment,
        candidates,
        originalText,
      });

      // Commodity should be flagged as hallucinated
      const hallucinated = getHallucinatedWarnings(result.warnings);
      expect(hallucinated).toHaveLength(1);
      expect(hallucinated[0].path).toBe("cargo.commodity");
      expect(hallucinated[0].category).toBe("hallucinated");
      expect(result.shipment.cargo.commodity).toBeNull();

      // Valid fields should remain
      expect(result.shipment.cargo.weight.value).toBe(45000);
      expect(result.shipment.cargo.pieces.count).toBe(10);
    });
  });
});
