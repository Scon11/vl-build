/**
 * Unit tests for the post-LLM verification layer
 *
 * Test cases:
 * 1. Supported reference number (found in candidates)
 * 2. Unsupported reference number (hallucinated - not in text or candidates)
 * 3. Supported address normalization (words found in original text)
 * 4. Unsupported time (hallucinated time not in source)
 * 5. Multi-stop references (multiple stops with mixed supported/unsupported refs)
 */

import { verifyShipment } from "./verifier";
import {
  StructuredShipment,
  ExtractedCandidate,
  VerifiedShipmentResult,
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
  type: ExtractedCandidate["type"] = "reference_number"
): ExtractedCandidate {
  return {
    type,
    value,
    raw_match: value,
    label_hint: null,
    subtype: type === "reference_number" ? "unknown" : null,
    confidence: "high",
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

      expect(result.warnings).toHaveLength(0);
      expect(result.shipment.reference_numbers[0].value).toBe("12345");
      expect(result.shipment.reference_numbers[0].type).toBe("reference");
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

      expect(result.warnings).toHaveLength(0);
      expect(result.shipment.reference_numbers[0].value).toBe("9876543");
    });
  });

  // Test Case 2: Unsupported reference number (hallucinated)
  describe("unsupported reference number - hallucinated", () => {
    it("should flag and mark as unknown when reference number is not in text or candidates", () => {
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

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        path: "reference_numbers[0].value",
        value: "FAKE-99999",
        reason: "unsupported_by_source",
      });
      // Should be marked as unknown
      expect(result.shipment.reference_numbers[0].type).toBe("unknown");
      // Valid one should remain unchanged
      expect(result.shipment.reference_numbers[1].type).toBe("reference");
    });

    it("should accept values that contain the extracted candidate", () => {
      // This tests that minor formatting differences (like dashes) are acceptable
      // when the core value is present in candidates
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

      // We allow this because the core value exists in candidates/text
      // This supports common normalization (adding dashes, formatting)
      expect(result.warnings).toHaveLength(0);
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

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].value).toBe("COMPLETELY-DIFFERENT");
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

      // Should accept because "123", "Main", "St" are all present
      expect(result.warnings).toHaveLength(0);
      expect(result.shipment.stops[0].location.address).toBe("123 Main St");
    });

    it("should flag completely fabricated addresses", () => {
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

      expect(result.warnings.length).toBeGreaterThan(0);
      const addressWarning = result.warnings.find((w) =>
        w.path.includes("address")
      );
      expect(addressWarning).toBeDefined();
      expect(addressWarning?.value).toBe("999 Fake Boulevard");
      // Address should be nulled out
      expect(result.shipment.stops[0].location.address).toBeNull();
    });
  });

  // Test Case 4: Unsupported time (hallucinated)
  describe("unsupported time - hallucinated", () => {
    it("should flag times not found in source", () => {
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

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        path: "stops[0].schedule.time",
        value: "14:30",
        reason: "unsupported_by_source",
      });
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

      expect(result.warnings).toHaveLength(0);
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

      // Should only have 1 warning for the fake reference
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        path: "stops[1].reference_numbers[1].value",
        value: "FAKE-REF",
        reason: "unsupported_by_source",
      });

      // Valid references should be unchanged
      expect(result.shipment.stops[0].reference_numbers[0].value).toBe(
        "111111"
      );
      expect(result.shipment.stops[1].reference_numbers[0].value).toBe(
        "222222"
      );
      expect(result.shipment.stops[2].reference_numbers[0].value).toBe(
        "333333"
      );

      // Invalid reference should be marked as unknown
      expect(result.shipment.stops[1].reference_numbers[1].type).toBe(
        "unknown"
      );
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

  // Additional edge cases
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

    it("should verify cargo fields", () => {
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

      // Commodity should be flagged
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].path).toBe("cargo.commodity");
      expect(result.shipment.cargo.commodity).toBeNull();

      // Valid fields should remain
      expect(result.shipment.cargo.weight.value).toBe(45000);
      expect(result.shipment.cargo.pieces.count).toBe(10);
    });
  });
});
