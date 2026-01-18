/**
 * Tender Processing Lock
 * 
 * Prevents concurrent processing of the same tender.
 * Uses database-level locking with timestamps.
 */

import { createServiceClient } from "./supabase/service";

export class TenderLockError extends Error {
  constructor(
    message: string,
    public readonly tenderId: string,
    public readonly lockedBy: string | null,
    public readonly lockReason: string | null
  ) {
    super(message);
    this.name = "TenderLockError";
  }
}

export interface LockInfo {
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  lock_reason: string | null;
}

/** Lock timeout in milliseconds (5 minutes) */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Check if a tender is currently locked.
 */
export async function isLocked(tenderId: string): Promise<LockInfo> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("tenders")
    .select("locked_at, locked_by, lock_reason")
    .eq("id", tenderId)
    .single();

  if (error || !data) {
    return { locked: false, locked_at: null, locked_by: null, lock_reason: null };
  }

  // Check if lock is still valid (not expired)
  if (data.locked_at) {
    const lockTime = new Date(data.locked_at).getTime();
    const now = Date.now();
    
    if (now - lockTime < LOCK_TIMEOUT_MS) {
      return {
        locked: true,
        locked_at: data.locked_at,
        locked_by: data.locked_by,
        lock_reason: data.lock_reason,
      };
    }
    
    // Lock has expired, treat as unlocked
    return { locked: false, locked_at: null, locked_by: null, lock_reason: null };
  }

  return { locked: false, locked_at: null, locked_by: null, lock_reason: null };
}

/**
 * Acquire a lock on a tender.
 * Throws TenderLockError if already locked.
 */
export async function acquireLock(
  tenderId: string,
  userId: string,
  reason: string
): Promise<void> {
  const supabase = createServiceClient();

  // First check if already locked
  const lockInfo = await isLocked(tenderId);
  
  if (lockInfo.locked) {
    throw new TenderLockError(
      "Tender is currently being processed",
      tenderId,
      lockInfo.locked_by,
      lockInfo.lock_reason
    );
  }

  // Try to acquire lock with atomic update
  // Only update if not already locked (or lock expired)
  const { error } = await supabase
    .from("tenders")
    .update({
      locked_at: new Date().toISOString(),
      locked_by: userId,
      lock_reason: reason,
    })
    .eq("id", tenderId)
    .or(`locked_at.is.null,locked_at.lt.${new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()}`);

  if (error) {
    throw new TenderLockError(
      "Failed to acquire lock",
      tenderId,
      null,
      null
    );
  }

  // Verify we got the lock
  const verifyLock = await isLocked(tenderId);
  if (verifyLock.locked && verifyLock.locked_by !== userId) {
    throw new TenderLockError(
      "Lock acquired by another process",
      tenderId,
      verifyLock.locked_by,
      verifyLock.lock_reason
    );
  }
}

/**
 * Release a lock on a tender.
 */
export async function releaseLock(tenderId: string, userId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("tenders")
    .update({
      locked_at: null,
      locked_by: null,
      lock_reason: null,
    })
    .eq("id", tenderId)
    .eq("locked_by", userId); // Only release if we own the lock

  if (error) {
    console.error("[Lock] Error releasing lock:", error);
  }
}

/**
 * Force release a lock (admin only, for stuck locks).
 */
export async function forceReleaseLock(tenderId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("tenders")
    .update({
      locked_at: null,
      locked_by: null,
      lock_reason: null,
    })
    .eq("id", tenderId);

  if (error) {
    console.error("[Lock] Error force releasing lock:", error);
  }
}

/**
 * Execute a function while holding a lock on a tender.
 * Automatically acquires and releases the lock.
 * 
 * @example
 * ```ts
 * await withLock(tenderId, userId, "reprocessing", async () => {
 *   // Do your processing here
 * });
 * ```
 */
export async function withLock<T>(
  tenderId: string,
  userId: string,
  reason: string,
  fn: () => Promise<T>
): Promise<T> {
  await acquireLock(tenderId, userId, reason);
  
  try {
    return await fn();
  } finally {
    await releaseLock(tenderId, userId);
  }
}
