/**
 * Tests for value pattern rule application in extractor
 * 
 * These tests verify the matchValuePatternRules logic without requiring
 * the full extractor pipeline. The actual integration with text extraction
 * is tested via end-to-end tests.
 */

import { ReferenceValueRule, CustomerProfile } from "./types";

// Since matchValuePatternRules is not exported, we test through extractCandidates
// but focus on cases where we KNOW the extractor will find the reference

import { extractCandidates } from "./extractor";

// Helper to create a minimal customer profile
function createCustomerProfile(valueRules: ReferenceValueRule[]): CustomerProfile {
  return {
    id: "test-customer",
    name: "Test Customer",
    reference_label_rules: [],
    reference_regex_rules: [],
    reference_value_rules: valueRules,
    stop_parsing_hints: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("Value Pattern Rule Application - HARDENED", () => {
  describe("deprecated rules", () => {
    it("should NOT apply deprecated rules to numeric references", () => {
      const profile = createCustomerProfile([
        {
          pattern: "^\\d{6}$", // Matches 6-digit numbers
          subtype: "order", // Would classify as ORDER
          scope: "global",
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "deprecated", // DEPRECATED - should not apply
        },
      ]);

      // Use "Load #:" which matches numeric values
      const text = "Load #: 987654";

      const result = extractCandidates(text, { customerProfile: profile });
      
      const refs = result.candidates.filter(
        (c) => c.type === "reference_number" && c.value === "987654"
      );
      
      // Should have found the reference
      expect(refs.length).toBe(1);
      // Should be BOL (default from Load #), NOT ORDER (deprecated rule)
      expect(refs[0].subtype).toBe("bol");
    });

    it("should apply active rules to numeric references", () => {
      const profile = createCustomerProfile([
        {
          pattern: "^\\d{6}$", // Matches 6-digit numbers
          subtype: "order", // Should classify as ORDER
          scope: "global",
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "active",
        },
      ]);

      // Use "Load #:" which matches numeric values
      const text = "Load #: 876543";

      const result = extractCandidates(text, { customerProfile: profile });
      
      const refs = result.candidates.filter(
        (c) => c.type === "reference_number" && c.value === "876543"
      );
      
      // Should have found the reference
      expect(refs.length).toBe(1);
      // Should be ORDER (from active value pattern rule)
      expect(refs[0].subtype).toBe("order");
    });
  });

  describe("scope enforcement with delivery keyword detection", () => {
    it("should NOT apply pickup-scoped rules when in delivery section", () => {
      const profile = createCustomerProfile([
        {
          pattern: "^\\d{6}$",
          subtype: "order",
          scope: "pickup", // Only applies to pickup
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "active",
        },
      ]);

      // Text clearly in delivery section
      const text = `
        Delivery Information
        Ship To: ABC Corp
        Load #: 765432
      `;

      const result = extractCandidates(text, { customerProfile: profile });
      
      const refs = result.candidates.filter(
        (c) => c.type === "reference_number" && c.value === "765432"
      );
      
      // Should NOT be classified as ORDER (pickup rule doesn't apply in delivery)
      if (refs.length > 0) {
        expect(refs[0].subtype).not.toBe("order");
      }
    });

    it("should apply global rules anywhere", () => {
      const profile = createCustomerProfile([
        {
          pattern: "^\\d{6}$",
          subtype: "order",
          scope: "global", // Applies everywhere
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "active",
        },
      ]);

      // Text in delivery section
      const text = `
        Delivery Information
        Load #: 654321
      `;

      const result = extractCandidates(text, { customerProfile: profile });
      
      const refs = result.candidates.filter(
        (c) => c.type === "reference_number" && c.value === "654321"
      );
      
      // Should be classified as ORDER (global rule applies everywhere)
      expect(refs.length).toBe(1);
      expect(refs[0].subtype).toBe("order");
    });
  });

  describe("priority ordering", () => {
    it("should apply higher priority rules first", () => {
      const profile = createCustomerProfile([
        {
          pattern: "^\\d{6}$",
          subtype: "bol", // Lower priority
          scope: "global",
          priority: 1,
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "active",
        },
        {
          pattern: "^\\d{6}$",
          subtype: "order", // Higher priority
          scope: "global",
          priority: 10,
          confidence: 0.8,
          created_at: new Date().toISOString(),
          status: "active",
        },
      ]);

      const text = "Load #: 543219";

      const result = extractCandidates(text, { customerProfile: profile });
      
      const refs = result.candidates.filter(
        (c) => c.type === "reference_number" && c.value === "543219"
      );
      
      // Should be classified as ORDER (higher priority)
      expect(refs.length).toBe(1);
      expect(refs[0].subtype).toBe("order");
    });
  });
});
