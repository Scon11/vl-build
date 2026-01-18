/**
 * McLeod Provider Tests
 */

import { McLeodProvider } from "./McLeodProvider";
import { CanonicalExportPayload } from "./IExportProvider";
import { StructuredShipment } from "@/lib/types";

// Helper to create a valid shipment
function createValidShipment(): StructuredShipment {
  return {
    stops: [
      {
        type: "pickup",
        sequence: 1,
        location: { name: "Origin", address: "123 Main", city: "Phoenix", state: "AZ", zip: "85001", country: "US" },
        schedule: { date: "2024-01-15", time: "08:00", appointment_required: false },
        reference_numbers: [],
        notes: null,
      },
      {
        type: "delivery",
        sequence: 2,
        location: { name: "Destination", address: "456 Oak", city: "Los Angeles", state: "CA", zip: "90001", country: "US" },
        schedule: { date: "2024-01-16", time: "14:00", appointment_required: true },
        reference_numbers: [],
        notes: null,
      },
    ],
    reference_numbers: [{ value: "PO123456", type: "po" }],
    cargo: {
      weight: { value: 42000, unit: "lbs" },
      pieces: { count: 24, type: "pallets" },
      dimensions: null,
      commodity: "Fresh Produce",
      temperature: { value: 34, unit: "F", mode: "refrigerated" },
    },
    unclassified_notes: [],
    classification_metadata: { model: "gpt-4", classified_at: new Date().toISOString(), confidence_notes: null },
  };
}

describe("McLeodProvider", () => {
  let provider: McLeodProvider;

  beforeEach(() => {
    provider = new McLeodProvider();
  });

  describe("config", () => {
    it("has correct id and name", () => {
      expect(provider.config.id).toBe("mcleod");
      expect(provider.config.name).toBe("McLeod TMS");
    });

    it("is enabled", () => {
      expect(provider.config.enabled).toBe(true);
    });
  });

  describe("isConfigured", () => {
    it("returns false when MCLEOD_API_BASE_URL is not set", () => {
      const originalEnv = process.env.MCLEOD_API_BASE_URL;
      delete process.env.MCLEOD_API_BASE_URL;
      
      expect(provider.isConfigured()).toBe(false);
      
      process.env.MCLEOD_API_BASE_URL = originalEnv;
    });

    it("returns true when MCLEOD_API_BASE_URL is set", () => {
      const originalEnv = process.env.MCLEOD_API_BASE_URL;
      process.env.MCLEOD_API_BASE_URL = "https://api.mcleod.test";
      
      const newProvider = new McLeodProvider();
      expect(newProvider.isConfigured()).toBe(true);
      
      process.env.MCLEOD_API_BASE_URL = originalEnv;
    });
  });

  describe("dryRun", () => {
    it("validates required stops", async () => {
      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment: {
          ...createValidShipment(),
          stops: [],
        },
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors?.some(e => e.field === "stops")).toBe(true);
    });

    it("validates pickup stop required", async () => {
      const shipment = createValidShipment();
      shipment.stops = [shipment.stops[1]]; // Only delivery

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment,
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(false);
      expect(result.validationErrors?.some(e => e.message.includes("pickup"))).toBe(true);
    });

    it("validates delivery stop required", async () => {
      const shipment = createValidShipment();
      shipment.stops = [shipment.stops[0]]; // Only pickup

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment,
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(false);
      expect(result.validationErrors?.some(e => e.message.includes("delivery"))).toBe(true);
    });

    it("validates city and state required for stops", async () => {
      const shipment = createValidShipment();
      shipment.stops[0].location.city = null;
      shipment.stops[1].location.state = null;

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment,
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(false);
      expect(result.validationErrors?.some(e => e.field.includes("city"))).toBe(true);
      expect(result.validationErrors?.some(e => e.field.includes("state"))).toBe(true);
    });

    it("validates customer required", async () => {
      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        // No customer_code or customer_id
        shipment: createValidShipment(),
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(false);
      expect(result.validationErrors?.some(e => e.field === "customer")).toBe(true);
    });

    it("returns warnings for missing optional fields", async () => {
      const shipment = createValidShipment();
      shipment.reference_numbers = [];
      shipment.cargo = null as unknown as typeof shipment.cargo; // No cargo

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment,
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      // Note: cargo being null might cause validation to fail depending on implementation
      // If it fails, adjust the test
      expect(result.warnings?.some(w => w.includes("reference"))).toBe(true);
    });

    it("returns mapped payload on success", async () => {
      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment: createValidShipment(),
        metadata: { source: "VL Build" },
      };

      const result = await provider.dryRun(payload);

      expect(result.ok).toBe(true);
      expect(result.mappedPayload).toBeDefined();
      expect(result.mappedPayload?.customer_code).toBe("CUST001");
      expect(result.mappedPayload?.stops).toHaveLength(2);
      expect(result.mappedPayload?.references).toHaveLength(1);
    });
  });

  describe("export", () => {
    it("returns NOT_CONFIGURED when API URL is not set", async () => {
      const originalEnv = process.env.MCLEOD_API_BASE_URL;
      delete process.env.MCLEOD_API_BASE_URL;

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment: createValidShipment(),
        metadata: { source: "VL Build" },
      };

      const result = await provider.export(payload);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("NOT_CONFIGURED");
      
      process.env.MCLEOD_API_BASE_URL = originalEnv;
    });

    it("returns VALIDATION_FAILED for invalid payload", async () => {
      const originalBaseUrl = process.env.MCLEOD_API_BASE_URL;
      const originalApiKey = process.env.MCLEOD_API_KEY;
      process.env.MCLEOD_API_BASE_URL = "https://api.mcleod.test";
      process.env.MCLEOD_API_KEY = "test-key";

      const payload: CanonicalExportPayload = {
        tender_id: "test-123",
        customer_code: "CUST001",
        shipment: {
          ...createValidShipment(),
          stops: [], // Invalid - no stops
        },
        metadata: { source: "VL Build" },
      };

      const result = await provider.export(payload);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
      
      process.env.MCLEOD_API_BASE_URL = originalBaseUrl;
      process.env.MCLEOD_API_KEY = originalApiKey;
    });
  });
});
