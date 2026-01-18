/**
 * State Machine Tests
 */

import {
  isValidTransition,
  validateTransition,
  getAllowedTransitions,
  isTerminalState,
  TenderStateMachine,
  InvalidStateTransitionError,
} from "./state-machine";
import { TenderStatus } from "./types";

describe("State Machine", () => {
  describe("isValidTransition", () => {
    it("allows valid transitions from draft", () => {
      expect(isValidTransition("draft", "extracted")).toBe(true);
      expect(isValidTransition("draft", "reviewed")).toBe(false);
    });

    it("allows valid transitions from extracted", () => {
      expect(isValidTransition("extracted", "needs_review")).toBe(true);
      expect(isValidTransition("extracted", "reviewed")).toBe(true);
      expect(isValidTransition("extracted", "exported")).toBe(false);
    });

    it("allows valid transitions from needs_review", () => {
      expect(isValidTransition("needs_review", "reviewed")).toBe(true);
      expect(isValidTransition("needs_review", "extracted")).toBe(true); // Can reprocess
      expect(isValidTransition("needs_review", "exported")).toBe(false);
    });

    it("allows valid transitions from reviewed", () => {
      expect(isValidTransition("reviewed", "export_pending")).toBe(true);
      expect(isValidTransition("reviewed", "needs_review")).toBe(true); // Can go back
      expect(isValidTransition("reviewed", "exported")).toBe(false); // Must go through export_pending
    });

    it("allows valid transitions from export_pending", () => {
      expect(isValidTransition("export_pending", "exported")).toBe(true);
      expect(isValidTransition("export_pending", "export_failed")).toBe(true);
      expect(isValidTransition("export_pending", "reviewed")).toBe(false);
    });

    it("allows valid transitions from export_failed", () => {
      expect(isValidTransition("export_failed", "export_pending")).toBe(true); // Can retry
      expect(isValidTransition("export_failed", "reviewed")).toBe(true); // Can go back
    });

    it("blocks transitions from terminal state", () => {
      expect(isValidTransition("exported", "reviewed")).toBe(false);
      expect(isValidTransition("exported", "draft")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("returns target state on valid transition", () => {
      expect(validateTransition("draft", "extracted")).toBe("extracted");
    });

    it("throws InvalidStateTransitionError on invalid transition", () => {
      expect(() => validateTransition("draft", "exported")).toThrow(
        InvalidStateTransitionError
      );
    });

    it("error contains correct state info", () => {
      try {
        validateTransition("draft", "exported");
        fail("Expected error");
      } catch (e) {
        if (e instanceof InvalidStateTransitionError) {
          expect(e.currentState).toBe("draft");
          expect(e.targetState).toBe("exported");
        }
      }
    });
  });

  describe("getAllowedTransitions", () => {
    it("returns all valid next states", () => {
      const allowed = getAllowedTransitions("extracted");
      expect(allowed).toContain("needs_review");
      expect(allowed).toContain("reviewed");
      expect(allowed).not.toContain("exported");
    });

    it("returns empty array for terminal states", () => {
      expect(getAllowedTransitions("exported")).toEqual([]);
    });
  });

  describe("isTerminalState", () => {
    it("identifies terminal states", () => {
      expect(isTerminalState("exported")).toBe(true);
    });

    it("identifies non-terminal states", () => {
      expect(isTerminalState("draft")).toBe(false);
      expect(isTerminalState("reviewed")).toBe(false);
    });
  });

  describe("TenderStateMachine", () => {
    it("tracks current state", () => {
      const machine = new TenderStateMachine("draft");
      expect(machine.state).toBe("draft");
    });

    it("can check if transition is allowed", () => {
      const machine = new TenderStateMachine("reviewed");
      expect(machine.canTransitionTo("export_pending")).toBe(true);
      expect(machine.canTransitionTo("exported")).toBe(false);
    });

    it("transitions to valid state", () => {
      const machine = new TenderStateMachine("draft");
      const newState = machine.transitionTo("extracted");
      expect(newState).toBe("extracted");
      expect(machine.state).toBe("extracted");
    });

    it("throws on invalid transition", () => {
      const machine = new TenderStateMachine("draft");
      expect(() => machine.transitionTo("exported")).toThrow();
    });

    it("reports terminal state", () => {
      const machine = new TenderStateMachine("exported");
      expect(machine.isTerminal()).toBe(true);
    });
  });
});
