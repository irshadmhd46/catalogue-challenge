import { CacheError } from '../../domain/errors.js';
import type { RateLimitResult, RateLimiter } from '../../domain/rate-limiter.js';
import { REDIS_KEY_PREFIX, type RedisLike } from '../cache/redis-cache.js';

/** The only Redis capability the limiter needs. */
export type RedisCounterLike = Pick<RedisLike, 'eval'>;

// One atomic step: count the hit, start the window on the first hit, report the time left. A
// counter without an expiry (should never happen) gets one instead of blocking a client forever.
export const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1]) * 1000
end
return {count, ttl}
`;

export const RATE_LIMIT_KEY_PREFIX = `${REDIS_KEY_PREFIX}rl:`;

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly client: RedisCounterLike) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    let reply: unknown;
    try {
      reply = await this.client.eval(CONSUME_SCRIPT, 1, RATE_LIMIT_KEY_PREFIX + key, windowSeconds);
    } catch (cause) {
      throw new CacheError({ cause });
    }

    const [count, ttlMs] = Array.isArray(reply) && reply.length === 2 ? (reply as unknown[]) : [];
    if (
      typeof count !== 'number' ||
      typeof ttlMs !== 'number' ||
      !Number.isInteger(count) ||
      !Number.isFinite(ttlMs) ||
      count < 1 ||
      ttlMs < 0
    ) {
      throw new CacheError({ cause: new TypeError('unexpected rate limiter reply') });
    }

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }
}
