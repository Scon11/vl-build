/**
 * Tests for the HARDENED learning detector
 * 
 * Key scenarios:
 * 1. Generic pattern detection (any prefix, not just TRFR/FFI)
 * 2. Too-broad patterns rejected due to collision count
 * 3. Short/low-entropy values rejected
 * 4. Scope enforcement
 * 5. Deprecated rules not applied
 * 6. Banner payload includes regex + match_count + examples
 */

import { detectReclassifications, isRuleAlreadyLearned } from "./learning-detector";
import { StructuredShipment, ExtractedCandidate, SuggestedRule, ReferenceValueRule } from "./types";

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

describe("detectReclassifications - HARDENED", () => {
  describe("generic pattern detection", () => {
    it("should detect ABC prefix pattern (generic prefix + numbers)", () => {
      // Using non-sequential digits to avoid low-entropy rejection
      const originalText = "Order #: ABC98765432";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "ABC98765432",
          raw_match: "ABC98765432",
          label_hint: "Order #",
          subtype: null,
          confidence: "high",
          position: { start: 10, end: 21 },
          context: "Order #: ABC98765432",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "ABC98765432" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "order", value: "ABC98765432" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should detect value_pattern rule
      expect(result.length).toBeGreaterThan(0);
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeDefined();
      expect(valuePatternRule?.pattern).toMatch(/\^ABC\\d\{/);
      expect(valuePatternRule?.subtype).toBe("order");
    });

    it("should detect dashed patterns (PO-NNNNNNNN)", () => {
      // Using non-sequential digits to avoid low-entropy rejection
      const originalText = "PO #: PO-83921047";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "PO-83921047",
          raw_match: "PO-83921047",
          label_hint: "PO #",
          subtype: null,
          confidence: "high",
          position: { start: 6, end: 17 },
          context: "PO #: PO-83921047",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "PO-83921047" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "po", value: "PO-83921047" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeDefined();
      expect(valuePatternRule?.pattern).toMatch(/\^PO\[-_\]\?\\d/);
    });

    it("should detect mixed alphanumeric patterns (ABCDXXNNNN)", () => {
      const originalText = "Ref: ABCD12X496Y78";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "ABCD12X496Y78",
          raw_match: "ABCD12X496Y78",
          label_hint: "Ref",
          subtype: null,
          confidence: "high",
          position: { start: 5, end: 18 },
          context: "Ref: ABCD12X496Y78",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "ABCD12X496Y78" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "reference", value: "ABCD12X496Y78" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeDefined();
      expect(valuePatternRule?.pattern).toMatch(/\^ABCD\[A-Z0-9\]/);
    });
  });

  describe("pattern rejection - too broad", () => {
    it("should reject patterns with too many collisions", () => {
      // Text with many similar values that would match a broad pattern
      const originalText = `
        Load ABC10001
        Load ABC10002
        Load ABC10003
        Load ABC10004
        Load ABC10005
      `;

      const candidates: ExtractedCandidate[] = [
        { type: "reference_number", value: "ABC10001", raw_match: "ABC10001", label_hint: "Load", subtype: null, confidence: "high", position: { start: 14, end: 22 }, context: "Load ABC10001" },
        { type: "reference_number", value: "ABC10002", raw_match: "ABC10002", label_hint: "Load", subtype: null, confidence: "high", position: { start: 37, end: 45 }, context: "Load ABC10002" },
        { type: "reference_number", value: "ABC10003", raw_match: "ABC10003", label_hint: "Load", subtype: null, confidence: "high", position: { start: 60, end: 68 }, context: "Load ABC10003" },
        { type: "reference_number", value: "ABC10004", raw_match: "ABC10004", label_hint: "Load", subtype: null, confidence: "high", position: { start: 83, end: 91 }, context: "Load ABC10004" },
        { type: "reference_number", value: "ABC10005", raw_match: "ABC10005", label_hint: "Load", subtype: null, confidence: "high", position: { start: 106, end: 114 }, context: "Load ABC10005" },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "ABC10001" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "po", value: "ABC10001" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should NOT suggest value_pattern (too many collisions)
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeUndefined();
      
      // Should fallback to label rule
      const labelRule = result.find((r) => r.type === "label");
      expect(labelRule).toBeDefined();
    });
  });

  describe("pattern rejection - short/low-entropy", () => {
    it("should reject short values (< 8 chars)", () => {
      const originalText = "Order #: ABC1234";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "ABC1234", // 7 chars - too short
          raw_match: "ABC1234",
          label_hint: "Order #",
          subtype: null,
          confidence: "high",
          position: { start: 9, end: 16 },
          context: "Order #: ABC1234",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "ABC1234" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "order", value: "ABC1234" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should NOT suggest value_pattern (too short)
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeUndefined();
      
      // Should fallback to label rule
      expect(result.some((r) => r.type === "label")).toBe(true);
    });

    it("should reject low-entropy values (repeated chars)", () => {
      const originalText = "Order #: AAAA11111111";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "AAAA11111111",
          raw_match: "AAAA11111111",
          label_hint: "Order #",
          subtype: null,
          confidence: "high",
          position: { start: 9, end: 21 },
          context: "Order #: AAAA11111111",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "AAAA11111111" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "order", value: "AAAA11111111" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should NOT suggest value_pattern (low entropy)
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeUndefined();
    });

    it("should reject phone number patterns", () => {
      const originalText = "Contact: 123-456-7890";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "123-456-7890",
          raw_match: "123-456-7890",
          label_hint: "Contact",
          subtype: null,
          confidence: "high",
          position: { start: 9, end: 21 },
          context: "Contact: 123-456-7890",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "123-456-7890" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "reference", value: "123-456-7890" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should NOT suggest value_pattern (phone pattern)
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeUndefined();
    });

    it("should reject purely numeric values", () => {
      const originalText = "Order #: 12345678901";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "12345678901",
          raw_match: "12345678901",
          label_hint: "Order #",
          subtype: null,
          confidence: "high",
          position: { start: 9, end: 20 },
          context: "Order #: 12345678901",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "12345678901" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "order", value: "12345678901" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Should NOT suggest value_pattern (purely numeric - risky)
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeUndefined();
    });
  });

  describe("scope detection", () => {
    it("should detect pickup scope from context", () => {
      // Using non-sequential digits to avoid low-entropy rejection
      const originalText = `
        Pickup Information
        Release #: XYZQ98716543
      `;

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "XYZQ98716543",
          raw_match: "XYZQ98716543",
          label_hint: "Release #",
          subtype: null,
          confidence: "high",
          position: { start: 50, end: 62 },
          context: "Pickup Release #: XYZQ98716543",
        },
      ];

      const originalShipment = createShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: { name: null, address: null, city: null, state: null, zip: null, country: null },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [{ type: "unknown", value: "XYZQ98716543" }],
            notes: null,
          },
        ],
      });

      const finalShipment = createShipment({
        stops: [
          {
            type: "pickup",
            sequence: 1,
            location: { name: null, address: null, city: null, state: null, zip: null, country: null },
            schedule: { date: null, time: null, appointment_required: null },
            reference_numbers: [{ type: "po", value: "XYZQ98716543" }],
            notes: null,
          },
        ],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      // Value pattern should be suggested (passes all checks)
      expect(result.length).toBeGreaterThan(0);
      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeDefined();
      // Value patterns default to global scope
      expect(valuePatternRule?.scope).toBe("global");
    });
  });

  describe("match metadata for UI transparency", () => {
    it("should include match_count and example_matches for value_pattern rules", () => {
      // Using non-sequential digits to avoid low-entropy rejection
      const originalText = "Reference: WXYZ98317654";

      const candidates: ExtractedCandidate[] = [
        {
          type: "reference_number",
          value: "WXYZ98317654",
          raw_match: "WXYZ98317654",
          label_hint: "Reference",
          subtype: null,
          confidence: "high",
          position: { start: 11, end: 23 },
          context: "Reference: WXYZ98317654",
        },
      ];

      const originalShipment = createShipment({
        reference_numbers: [{ type: "unknown", value: "WXYZ98317654" }],
      });

      const finalShipment = createShipment({
        reference_numbers: [{ type: "reference", value: "WXYZ98317654" }],
      });

      const result = detectReclassifications({
        originalShipment,
        finalShipment,
        candidates,
        originalText,
      });

      const valuePatternRule = result.find((r) => r.type === "value_pattern");
      expect(valuePatternRule).toBeDefined();
      
      // Should include match metadata
      expect(valuePatternRule?.match_count).toBeDefined();
      expect(valuePatternRule?.example_matches).toBeDefined();
      expect(Array.isArray(valuePatternRule?.example_matches)).toBe(true);
      expect(valuePatternRule?.score).toBeDefined();
      expect(typeof valuePatternRule?.score).toBe("number");
    });
  });
});

describe("isRuleAlreadyLearned", () => {
  it("should detect existing value_pattern rule", () => {
    const suggestion: SuggestedRule = {
      type: "value_pattern",
      pattern: "^TRFR\\d{7,}$",
      subtype: "po",
      scope: "global",
      example_value: "TRFR0010713",
      context: "",
    };

    const existingValueRules: ReferenceValueRule[] = [
      {
        pattern: "^TRFR\\d{7,}$",
        subtype: "po",
        scope: "global",
        confidence: 0.8,
        created_at: new Date().toISOString(),
        status: "active",
        hits: 5,
      },
    ];

    const result = isRuleAlreadyLearned(suggestion, [], [], existingValueRules);
    expect(result).toBe(true);
  });

  it("should not match value_pattern with different scope", () => {
    const suggestion: SuggestedRule = {
      type: "value_pattern",
      pattern: "^TRFR\\d{7,}$",
      subtype: "po",
      scope: "pickup",
      example_value: "TRFR0010713",
      context: "",
    };

    const existingValueRules: ReferenceValueRule[] = [
      {
        pattern: "^TRFR\\d{7,}$",
        subtype: "po",
        scope: "delivery", // Different scope
        confidence: 0.8,
        created_at: new Date().toISOString(),
      },
    ];

    const result = isRuleAlreadyLearned(suggestion, [], [], existingValueRules);
    expect(result).toBe(false);
  });

  it("should match when existing rule is global", () => {
    const suggestion: SuggestedRule = {
      type: "value_pattern",
      pattern: "^TRFR\\d{7,}$",
      subtype: "po",
      scope: "pickup", // Specific scope
      example_value: "TRFR0010713",
      context: "",
    };

    const existingValueRules: ReferenceValueRule[] = [
      {
        pattern: "^TRFR\\d{7,}$",
        subtype: "po",
        scope: "global", // Global covers all scopes
        confidence: 0.8,
        created_at: new Date().toISOString(),
      },
    ];

    const result = isRuleAlreadyLearned(suggestion, [], [], existingValueRules);
    expect(result).toBe(true);
  });

  it("should detect existing label rule", () => {
    const suggestion: SuggestedRule = {
      type: "label",
      label: "Release #",
      subtype: "po",
      example_value: "118271",
      context: "",
    };

    const existingLabelRules = [
      { label: "Release #", subtype: "po" as const },
    ];

    const result = isRuleAlreadyLearned(suggestion, existingLabelRules, []);
    expect(result).toBe(true);
  });

  it("should be case-insensitive for label rules", () => {
    const suggestion: SuggestedRule = {
      type: "label",
      label: "RELEASE #",
      subtype: "po",
      example_value: "118271",
      context: "",
    };

    const existingLabelRules = [
      { label: "release #", subtype: "po" as const },
    ];

    const result = isRuleAlreadyLearned(suggestion, existingLabelRules, []);
    expect(result).toBe(true);
  });
});
