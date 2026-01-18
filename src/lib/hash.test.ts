import { hashBuffer, hashText, normalizeTextForHash, shortHash } from "./hash";

describe("hash utilities", () => {
  describe("hashBuffer", () => {
    it("should return a 64-character hex string", () => {
      const buffer = Buffer.from("test content");
      const hash = hashBuffer(buffer);
      
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should return same hash for same content", () => {
      const buffer1 = Buffer.from("identical content");
      const buffer2 = Buffer.from("identical content");
      
      expect(hashBuffer(buffer1)).toBe(hashBuffer(buffer2));
    });

    it("should return different hash for different content", () => {
      const buffer1 = Buffer.from("content A");
      const buffer2 = Buffer.from("content B");
      
      expect(hashBuffer(buffer1)).not.toBe(hashBuffer(buffer2));
    });
  });

  describe("normalizeTextForHash", () => {
    it("should trim whitespace", () => {
      expect(normalizeTextForHash("  hello  ")).toBe("hello");
    });

    it("should normalize line endings", () => {
      const text1 = normalizeTextForHash("line1\r\nline2");
      const text2 = normalizeTextForHash("line1\nline2");
      const text3 = normalizeTextForHash("line1\rline2");
      
      expect(text1).toBe(text2);
      expect(text2).toBe(text3);
    });

    it("should collapse multiple spaces", () => {
      expect(normalizeTextForHash("hello    world")).toBe("hello world");
    });

    it("should lowercase text", () => {
      expect(normalizeTextForHash("HELLO World")).toBe("hello world");
    });

    it("should collapse multiple newlines", () => {
      expect(normalizeTextForHash("line1\n\n\n\nline2")).toBe("line1\nline2");
    });
  });

  describe("hashText", () => {
    it("should return same hash for semantically equivalent text", () => {
      const text1 = "Hello  World";
      const text2 = "hello world";
      const text3 = "  HELLO   WORLD  ";
      
      expect(hashText(text1)).toBe(hashText(text2));
      expect(hashText(text2)).toBe(hashText(text3));
    });

    it("should return different hash for different content", () => {
      expect(hashText("content A")).not.toBe(hashText("content B"));
    });
  });

  describe("shortHash", () => {
    it("should return first 8 characters", () => {
      const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      expect(shortHash(hash)).toBe("abcdef12");
    });
  });
});
