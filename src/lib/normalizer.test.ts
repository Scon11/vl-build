/**
 * Unit tests for the shipment normalizer
 */

import { normalizeShipment, needsNormalization } from "./normalizer";
import { StructuredShipment, ExtractedCandidate } from "./types";

// Helper to create a minimal valid shipment
function createShipment(overrides: Partial<StructuredShipment> = {}): StructuredShipment {
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
      model: "test",
      classified_at: new Date().toISOString(),
      confidence_notes: null,
    },
    ...overrides,
  };
}

// Helper to create a pickup stop
function createPickupStop(sequence: number, refs: Array<{ type: string; value: string }> = []) {
  return {
    type: "pickup" as const,
    sequence,
    location: { name: null, address: null, city: null, state: null, zip: null, country: null },
    schedule: { date: null, time: null, appointment_required: null },
    reference_numbers: refs.map((r) => ({ type: r.type as any, value: r.value })),
    notes: null,
  };
}

// Helper to create a delivery stop
function createDeliveryStop(sequence: number, refs: Array<{ type: string; value: string }> = []) {
  return {
    type: "delivery" as const,
    sequence,
    location: { name: null, address: null, city: null, state: null, zip: null, country: null },
    schedule: { date: null, time: null, appointment_required: null },
    reference_numbers: refs.map((r) => ({ type: r.type as any, value: r.value })),
    notes: null,
  };
}

describe("normalizeShipment", () => {
  test("should move pickup-subtype refs from global to pickup stop", () => {
    const originalText = "Pickup: ABC Company\nPickup #: 12345\nDelivery: XYZ Inc";
    const candidates: ExtractedCandidate[] = [
      {
        type: "reference_number",
        value: "12345",
        raw_match: "12345",
        label_hint: "Pickup #",
        subtype: "pickup",
        confidence: "high",
        position: { start: 30, end: 35 },
        context: "Pickup #: 12345",
      },
    ];

    const shipment = createShipment({
      reference_numbers: [{ type: "pickup", value: "12345" }],
      stops: [createPickupStop(1), createDeliveryStop(2)],
    });

    const result = normalizeShipment(shipment, originalText, candidates);

    // Global refs should be empty
    expect(result.shipment.reference_numbers).toHaveLength(0);
    // Pickup stop should have the ref
    expect(result.shipment.stops[0].reference_numbers).toHaveLength(1);
    expect(result.shipment.stops[0].reference_numbers[0].value).toBe("12345");
    expect(result.metadata.refs_moved_to_stops).toBe(1);
  });

  test("should move delivery confirmation refs to delivery stop", () => {
    // Confirmation refs should go to delivery stops based on subtype alone
    const originalText = "Pickup: Sender\nDelivery: Consignee\nConfirmation #: CONF123";
    const candidates: ExtractedCandidate[] = [
      {
        type: "reference_number",
        value: "CONF123",
        raw_match: "CONF123",
        label_hint: "Confirmation #",
        subtype: "confirmation",
        confidence: "high",
        position: { start: 51, end: 58 }, // Correct position in text
        context: "Delivery: Consignee\nConfirmation #: CONF123",
      },
    ];

    const shipment = createShipment({
      reference_numbers: [{ type: "confirmation", value: "CONF123" }],
      stops: [createPickupStop(1), createDeliveryStop(2)],
    });

    const result = normalizeShipment(shipment, originalText, candidates);

    // Confirmation type should auto-move to delivery stop
    expect(result.shipment.reference_numbers).toHaveLength(0);
    expect(result.shipment.stops[1].reference_numbers).toHaveLength(1);
    expect(result.shipment.stops[1].reference_numbers[0].value).toBe("CONF123");
    expect(result.metadata.refs_moved_to_stops).toBe(1);
  });

  test("should keep BOL/Load refs at shipment level", () => {
    const originalText = "Load #: 121224\nPickup: Origin\nDelivery: Destination";
    const candidates: ExtractedCandidate[] = [
      {
        type: "reference_number",
        value: "121224",
        raw_match: "121224",
        label_hint: "Load #",
        subtype: "bol",
        confidence: "high",
        position: { start: 8, end: 14 },
        context: "Load #: 121224\nPickup:",
      },
    ];

    const shipment = createShipment({
      reference_numbers: [{ type: "bol", value: "121224" }],
      stops: [createPickupStop(1), createDeliveryStop(2)],
    });

    const result = normalizeShipment(shipment, originalText, candidates);

    // Global refs should still have the BOL
    expect(result.shipment.reference_numbers).toHaveLength(1);
    expect(result.shipment.reference_numbers[0].value).toBe("121224");
    expect(result.metadata.refs_moved_to_stops).toBe(0);
  });

  test("should deduplicate refs that appear in both global and stops", () => {
    // When a ref exists in both global and a stop, it should be removed from global
    // but not duplicated within the stop
    const originalText = "Load Info Section\nRelease #: PO123\nPickup: Origin";
    const candidates: ExtractedCandidate[] = [];

    const shipment = createShipment({
      reference_numbers: [{ type: "po", value: "PO123" }],
      stops: [
        createPickupStop(1, [{ type: "po", value: "PO123" }]),
        createDeliveryStop(2),
      ],
    });

    const result = normalizeShipment(shipment, originalText, candidates);

    // Global refs should be empty (moved to stop or deduped)
    expect(result.shipment.reference_numbers).toHaveLength(0);
    // Stop should still have exactly 1 (not duplicated)
    expect(result.shipment.stops[0].reference_numbers).toHaveLength(1);
    // Either moved or deduped - total operations should be > 0
    expect(result.metadata.refs_moved_to_stops + result.metadata.refs_deduplicated).toBeGreaterThan(0);
  });

  test("should handle PO in pickup context moving to stop", () => {
    const originalText = "Pickup Information\nRelease #: TRFR0010713\nShip From: ABC Company";
    const candidates: ExtractedCandidate[] = [
      {
        type: "reference_number",
        value: "TRFR0010713",
        raw_match: "TRFR0010713",
        label_hint: "Release #",
        subtype: "po",
        confidence: "high",
        position: { start: 30, end: 41 },
        context: "Pickup Information\nRelease #: TRFR0010713",
      },
    ];

    const shipment = createShipment({
      reference_numbers: [{ type: "po", value: "TRFR0010713" }],
      stops: [createPickupStop(1), createDeliveryStop(2)],
    });

    const result = normalizeShipment(shipment, originalText, candidates);

    // Global should be empty - PO in pickup context goes to stop
    expect(result.shipment.reference_numbers).toHaveLength(0);
    // Pickup stop should have it
    expect(result.shipment.stops[0].reference_numbers).toHaveLength(1);
  });
});

describe("needsNormalization", () => {
  test("should return true for shipments with stop-level subtypes in global refs", () => {
    const shipment = createShipment({
      reference_numbers: [
        { type: "pickup", value: "123" },
        { type: "bol", value: "456" },
      ],
    });

    expect(needsNormalization(shipment)).toBe(true);
  });

  test("should return false for shipments with only global subtypes", () => {
    const shipment = createShipment({
      reference_numbers: [
        { type: "bol", value: "123" },
        { type: "order", value: "456" },
      ],
    });

    expect(needsNormalization(shipment)).toBe(false);
  });

  test("should return true for refs with stop applies_to hint", () => {
    const shipment = createShipment({
      reference_numbers: [
        { type: "po", value: "123", applies_to: "pickup" },
      ],
    });

    expect(needsNormalization(shipment)).toBe(true);
  });
});
