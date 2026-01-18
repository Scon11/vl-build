/**
 * Retry Utility with Exponential Backoff
 * 
 * Provides configurable retry logic for unreliable operations
 * like API calls, database writes, and file uploads.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  retries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitter?: number;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback for logging retry attempts */
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown
  ) {
    super(message);
    this.name = "RetryError";
  }
}

/**
 * Default function to determine if an error is retryable.
 * Retries on network errors, rate limits, and server errors.
 */
function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Network errors
    if (message.includes("network") || message.includes("timeout") || message.includes("econnreset")) {
      return true;
    }
    
    // Rate limiting
    if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
      return true;
    }
    
    // Server errors (5xx)
    if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
      return true;
    }
    
    // Supabase-specific
    if (message.includes("connection") || message.includes("pool")) {
      return true;
    }
  }
  
  // Check for fetch Response with retryable status
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 429 || status >= 500;
  }
  
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number
): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter: delay * (1 - jitter/2 + random * jitter)
  const jitterFactor = 1 - jitter / 2 + Math.random() * jitter;
  
  return Math.floor(cappedDelay * jitterFactor);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retries and exponential backoff.
 * 
 * @example
 * ```ts
 * const result = await retry(
 *   () => fetch("https://api.example.com/data"),
 *   { retries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = 0.1,
    isRetryable = defaultIsRetryable,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt >= retries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        throw error; // Non-retryable error, throw immediately
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);

      // Log retry attempt
      if (onRetry) {
        onRetry(attempt + 1, error, delay);
      } else {
        console.log(
          `[Retry] Attempt ${attempt + 1}/${retries} failed, retrying in ${delay}ms:`,
          error instanceof Error ? error.message : error
        );
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw new RetryError(
    `Operation failed after ${retries + 1} attempts`,
    retries + 1,
    lastError
  );
}

/**
 * Wrap an async function with retry logic.
 * Returns a new function that automatically retries on failure.
 */
export function withRetry<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
): (...args: T) => Promise<R> {
  return (...args: T) => retry(() => fn(...args), options);
}

/**
 * Retry presets for common use cases.
 */
export const RetryPresets = {
  /** For OpenAI API calls */
  openai: {
    retries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: 0.2,
    isRetryable: (error: unknown) => {
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return msg.includes("rate limit") || 
               msg.includes("timeout") || 
               msg.includes("429") ||
               msg.includes("500") ||
               msg.includes("503");
      }
      return defaultIsRetryable(error);
    },
  } as RetryOptions,

  /** For Supabase storage operations */
  storage: {
    retries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    jitter: 0.1,
  } as RetryOptions,

  /** For Supabase database operations */
  database: {
    retries: 2,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    jitter: 0.1,
  } as RetryOptions,

  /** Quick retry for fast operations */
  quick: {
    retries: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    jitter: 0.1,
  } as RetryOptions,
};
