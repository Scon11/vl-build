/**
 * Tender State Machine
 * 
 * Enforces valid state transitions for tenders.
 * This is the single source of truth for state transition logic.
 */

import { TenderStatus, TENDER_STATUS_TRANSITIONS } from "./types";

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly currentState: TenderStatus,
    public readonly targetState: TenderStatus
  ) {
    super(`Invalid state transition: ${currentState} -> ${targetState}`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(
  currentState: TenderStatus,
  targetState: TenderStatus
): boolean {
  const allowedTransitions = TENDER_STATUS_TRANSITIONS[currentState];
  return allowedTransitions.includes(targetState);
}

/**
 * Validate and return the target state if transition is valid.
 * Throws InvalidStateTransitionError if not.
 */
export function validateTransition(
  currentState: TenderStatus,
  targetState: TenderStatus
): TenderStatus {
  if (!isValidTransition(currentState, targetState)) {
    throw new InvalidStateTransitionError(currentState, targetState);
  }
  return targetState;
}

/**
 * Get all allowed transitions from a given state.
 */
export function getAllowedTransitions(currentState: TenderStatus): TenderStatus[] {
  return TENDER_STATUS_TRANSITIONS[currentState] || [];
}

/**
 * Check if a state is terminal (no further transitions possible).
 */
export function isTerminalState(state: TenderStatus): boolean {
  return TENDER_STATUS_TRANSITIONS[state]?.length === 0;
}

/**
 * State machine for managing tender state transitions.
 * Use this class for complex state operations.
 */
export class TenderStateMachine {
  constructor(private currentState: TenderStatus) {}

  get state(): TenderStatus {
    return this.currentState;
  }

  /**
   * Attempt to transition to a new state.
   * Returns true if successful, false if invalid.
   */
  canTransitionTo(targetState: TenderStatus): boolean {
    return isValidTransition(this.currentState, targetState);
  }

  /**
   * Transition to a new state.
   * Throws InvalidStateTransitionError if not valid.
   */
  transitionTo(targetState: TenderStatus): TenderStatus {
    validateTransition(this.currentState, targetState);
    this.currentState = targetState;
    return this.currentState;
  }

  /**
   * Get allowed next states.
   */
  getAllowedTransitions(): TenderStatus[] {
    return getAllowedTransitions(this.currentState);
  }

  /**
   * Check if current state is terminal.
   */
  isTerminal(): boolean {
    return isTerminalState(this.currentState);
  }
}

/**
 * Determine the appropriate status after extraction.
 * If there are hallucination warnings, go to needs_review.
 * Otherwise, can go directly to reviewed (or needs_review for safety).
 */
export function getPostExtractionStatus(hasWarnings: boolean): TenderStatus {
  return hasWarnings ? "needs_review" : "needs_review"; // Always require review for safety
}

/**
 * State descriptions for UI display.
 */
export const TENDER_STATUS_DESCRIPTIONS: Record<TenderStatus, string> = {
  draft: "Tender uploaded, awaiting extraction",
  extracted: "Extraction complete, awaiting review",
  needs_review: "Requires human review",
  reviewed: "Approved, ready for export",
  export_pending: "Export in progress",
  exported: "Successfully exported",
  export_failed: "Export failed",
};

/**
 * State colors for UI display.
 */
export const TENDER_STATUS_COLORS: Record<TenderStatus, string> = {
  draft: "gray",
  extracted: "blue",
  needs_review: "yellow",
  reviewed: "green",
  export_pending: "blue",
  exported: "green",
  export_failed: "red",
};
