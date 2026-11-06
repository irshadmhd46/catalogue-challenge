export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Whole seconds until the window ends; at least 1. */
  readonly retryAfterSeconds: number;
}

/**
 * Counts hits per key in a fixed window that starts at the first hit. Adapters throw `CacheError`
 * when their store fails; the HTTP layer decides to fail open.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
