/**
 * Rate Limiter
 * 
 * Postgres-backed rate limiting for API routes.
 * Uses database functions for atomic operations.
 */

import { createServiceClient } from "./supabase/service";

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until the rate limit resets (0 if allowed) */
  retryAfter: number;
  /** Current count of requests in the window */
  currentCount?: number;
}

export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number,
    public readonly route: string
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

// Default rate limits from environment (with fallbacks)
export const RateLimits = {
  /** Extraction routes (paste + upload): requests per minute */
  extraction: {
    maxRequests: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || "10", 10),
    windowSeconds: 60,
  },
  /** Reprocess route: requests per hour per tender */
  reprocess: {
    maxRequests: parseInt(process.env.MAX_REPROCESS_PER_HOUR || "5", 10),
    windowSeconds: 3600,
  },
} as const;

/**
 * Check and record a rate limit attempt.
 * 
 * @param userId - User ID to rate limit
 * @param route - Route identifier (e.g., "/api/tenders/upload")
 * @param config - Rate limit configuration
 * @param resourceId - Optional resource ID for per-resource limits (e.g., tender_id)
 * @returns Rate limit result
 */
export async function checkRateLimit(
  userId: string,
  route: string,
  config: RateLimitConfig,
  resourceId?: string
): Promise<RateLimitResult> {
  const supabase = createServiceClient();

  try {
    // Use the database function for atomic check-and-record
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_route: route,
      p_max_requests: config.maxRequests,
      p_window_seconds: config.windowSeconds,
      p_resource_id: resourceId || null,
    });

    if (error) {
      console.error("[RateLimit] Database error:", error);
      // On error, allow the request (fail open)
      return { allowed: true, retryAfter: 0 };
    }

    if (data === true) {
      return { allowed: true, retryAfter: 0 };
    }

    // Rate limited - get retry-after seconds
    const { data: retryAfter } = await supabase.rpc("get_rate_limit_reset_seconds", {
      p_user_id: userId,
      p_route: route,
      p_window_seconds: config.windowSeconds,
      p_resource_id: resourceId || null,
    });

    return {
      allowed: false,
      retryAfter: retryAfter || config.windowSeconds,
    };
  } catch (err) {
    console.error("[RateLimit] Error:", err);
    // Fail open on error
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * Enforce rate limit, throwing RateLimitExceededError if exceeded.
 * Use this at the start of API routes.
 * 
 * @example
 * ```ts
 * await enforceRateLimit(userId, "/api/tenders/upload", RateLimits.extraction);
 * ```
 */
export async function enforceRateLimit(
  userId: string,
  route: string,
  config: RateLimitConfig,
  resourceId?: string
): Promise<void> {
  const result = await checkRateLimit(userId, route, config, resourceId);

  if (!result.allowed) {
    throw new RateLimitExceededError(
      `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      result.retryAfter,
      route
    );
  }
}

/**
 * Get current rate limit status without recording an attempt.
 */
export async function getRateLimitStatus(
  userId: string,
  route: string,
  config: RateLimitConfig,
  resourceId?: string
): Promise<{ count: number; remaining: number; resetIn: number }> {
  const supabase = createServiceClient();

  try {
    const cutoff = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

    let query = supabase
      .from("rate_limit_entries")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("route", route)
      .gt("created_at", cutoff);

    if (resourceId) {
      query = query.eq("resource_id", resourceId);
    }

    const { count, error } = await query;

    if (error) {
      console.error("[RateLimit] Status query error:", error);
      return { count: 0, remaining: config.maxRequests, resetIn: 0 };
    }

    const currentCount = count || 0;
    const remaining = Math.max(0, config.maxRequests - currentCount);

    // Get reset time if at limit
    let resetIn = 0;
    if (remaining === 0) {
      const { data } = await supabase.rpc("get_rate_limit_reset_seconds", {
        p_user_id: userId,
        p_route: route,
        p_window_seconds: config.windowSeconds,
        p_resource_id: resourceId || null,
      });
      resetIn = data || config.windowSeconds;
    }

    return { count: currentCount, remaining, resetIn };
  } catch (err) {
    console.error("[RateLimit] Error getting status:", err);
    return { count: 0, remaining: config.maxRequests, resetIn: 0 };
  }
}
