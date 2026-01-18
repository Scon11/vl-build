import { TenderLockError } from "./tender-lock";

// Note: Full integration tests would require a test database.
// These tests verify the error class.

describe("tender-lock", () => {
  describe("TenderLockError", () => {
    it("should create error with all properties", () => {
      const error = new TenderLockError(
        "Tender is locked",
        "tender-123",
        "user-456",
        "reprocessing"
      );

      expect(error.name).toBe("TenderLockError");
      expect(error.message).toBe("Tender is locked");
      expect(error.tenderId).toBe("tender-123");
      expect(error.lockedBy).toBe("user-456");
      expect(error.lockReason).toBe("reprocessing");
    });

    it("should handle null locked_by and lock_reason", () => {
      const error = new TenderLockError(
        "Failed to acquire lock",
        "tender-789",
        null,
        null
      );

      expect(error.lockedBy).toBeNull();
      expect(error.lockReason).toBeNull();
    });

    it("should be instanceof Error", () => {
      const error = new TenderLockError("test", "t1", null, null);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TenderLockError);
    });
  });
});
