import type { RateLimitResult, RateLimiter } from '../../domain/rate-limiter.js';

interface Entry {
  count: number;
  readonly resetAt: number;
}

export const MAX_TRACKED_KEYS = 10_000;
const PURGE_INTERVAL_MS = 1000;

/**
 * Fixed window per key, starting at the first hit. Memory is bounded: expired entries are purged
 * (at most once a second, so a flood of keys cannot make every call scan the map) and the oldest
 * window is evicted beyond MAX_TRACKED_KEYS.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private lastPurgeAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = MAX_TRACKED_KEYS,
  ) {}

  /** Number of keys currently held. */
  get size(): number {
    return this.entries.size;
  }

  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.now();
    this.purgeExpired(nowMs);

    let entry = this.entries.get(key);
    if (entry === undefined || nowMs >= entry.resetAt) {
      // Delete first so a new window goes to the end of the map's insertion order.
      this.entries.delete(key);
      entry = { count: 0, resetAt: nowMs + windowSeconds * 1000 };
      this.entries.set(key, entry);
      this.evictOldest();
    }
    entry.count += 1;

    return Promise.resolve({
      allowed: entry.count <= limit,
      limit,
      remaining: Math.max(0, limit - entry.count),
      // A hit is only denied while time remains in the window, so this is at least 1.
      retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000),
    });
  }

  private purgeExpired(nowMs: number): void {
    if (nowMs - this.lastPurgeAt < PURGE_INTERVAL_MS) {
      return;
    }
    this.lastPurgeAt = nowMs;
    for (const [key, entry] of this.entries) {
      if (nowMs >= entry.resetAt) {
        this.entries.delete(key);
      }
    }
  }

  private evictOldest(): void {
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }
}
