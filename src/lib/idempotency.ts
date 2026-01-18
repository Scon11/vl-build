/**
 * Idempotency Key Handler
 * 
 * Ensures API operations can be safely retried without duplicate effects.
 * Uses a database-backed store for idempotency keys.
 */

import { createHash } from "crypto";
import { createServiceClient } from "./supabase/service";

export interface IdempotencyRecord {
  key: string;
  user_id: string | null;
  route: string;
  request_hash: string;
  response_json: Record<string, unknown> | null;
  status: "pending" | "completed" | "failed";
  created_at: string;
}

export interface IdempotencyResult {
  /** Whether this is a new request or a replay */
  isNew: boolean;
  /** The idempotency record */
  record: IdempotencyRecord | null;
  /** If replay with different payload, this is true */
  isConflict: boolean;
}

/**
 * Generate a hash of the request payload for comparison.
 */
export function hashRequestPayload(payload: unknown): string {
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/**
 * Check for an existing idempotency record.
 * Returns the record if found, null otherwise.
 */
export async function checkIdempotencyKey(
  key: string,
  userId: string | null,
  route: string,
  requestHash: string
): Promise<IdempotencyResult> {
  const supabase = createServiceClient();

  const { data: existing, error } = await supabase
    .from("idempotency_keys")
    .select("*")
    .eq("key", key)
    .eq("route", route)
    .maybeSingle();

  if (error) {
    console.error("[Idempotency] Error checking key:", error);
    // On error, treat as new request
    return { isNew: true, record: null, isConflict: false };
  }

  if (!existing) {
    return { isNew: true, record: null, isConflict: false };
  }

  // Check if this is a replay with different payload
  if (existing.request_hash !== requestHash) {
    return { 
      isNew: false, 
      record: existing, 
      isConflict: true 
    };
  }

  return { 
    isNew: false, 
    record: existing, 
    isConflict: false 
  };
}

/**
 * Create a new idempotency record (mark as pending).
 */
export async function createIdempotencyRecord(
  key: string,
  userId: string | null,
  route: string,
  requestHash: string
): Promise<IdempotencyRecord | null> {
  const supabase = createServiceClient();

  const record: Partial<IdempotencyRecord> = {
    key,
    user_id: userId,
    route,
    request_hash: requestHash,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("idempotency_keys")
    .insert(record)
    .select()
    .single();

  if (error) {
    // Unique constraint violation means another request beat us
    if (error.code === "23505") {
      return null;
    }
    console.error("[Idempotency] Error creating record:", error);
    return null;
  }

  return data;
}

/**
 * Update idempotency record with the response.
 */
export async function completeIdempotencyRecord(
  key: string,
  route: string,
  response: Record<string, unknown>,
  status: "completed" | "failed" = "completed"
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("idempotency_keys")
    .update({
      response_json: response,
      status,
    })
    .eq("key", key)
    .eq("route", route);

  if (error) {
    console.error("[Idempotency] Error updating record:", error);
  }
}

/**
 * Higher-order function to wrap an API handler with idempotency support.
 * 
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   return withIdempotency(request, "/api/tenders", async (body) => {
 *     // Your handler logic
 *     return NextResponse.json({ id: "123" });
 *   });
 * }
 * ```
 */
export async function withIdempotency<T>(
  idempotencyKey: string | null,
  userId: string | null,
  route: string,
  requestPayload: unknown,
  handler: () => Promise<T>
): Promise<{ response: T; fromCache: boolean } | { conflict: true; message: string }> {
  // If no idempotency key provided, just run the handler
  if (!idempotencyKey) {
    const response = await handler();
    return { response, fromCache: false };
  }

  const requestHash = hashRequestPayload(requestPayload);

  // Check for existing record
  const result = await checkIdempotencyKey(idempotencyKey, userId, route, requestHash);

  if (result.isConflict) {
    return {
      conflict: true,
      message: "Idempotency key already used with different request payload",
    };
  }

  if (!result.isNew && result.record) {
    // Return cached response if completed
    if (result.record.status === "completed" && result.record.response_json) {
      return {
        response: result.record.response_json as T,
        fromCache: true,
      };
    }
    // If still pending or failed, let it retry
  }

  // Create new record
  if (result.isNew) {
    await createIdempotencyRecord(idempotencyKey, userId, route, requestHash);
  }

  try {
    const response = await handler();
    
    // Store successful response
    await completeIdempotencyRecord(
      idempotencyKey,
      route,
      response as Record<string, unknown>,
      "completed"
    );

    return { response, fromCache: false };
  } catch (error) {
    // Store failure
    await completeIdempotencyRecord(
      idempotencyKey,
      route,
      { error: error instanceof Error ? error.message : "Unknown error" },
      "failed"
    );
    throw error;
  }
}
