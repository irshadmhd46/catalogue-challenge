import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { CacheError } from '../../src/domain/errors.js';
import { createRedisClient, RedisCache } from '../../src/infrastructure/cache/redis-cache.js';
import {
  CONSUME_SCRIPT,
  RATE_LIMIT_KEY_PREFIX,
  RedisRateLimiter,
} from '../../src/infrastructure/rate-limit/redis-rate-limiter.js';
import { FakeLogger } from '../support/fake-logger.js';
import { FakeRedis } from '../support/fake-redis.js';
import { describeRateLimiterContract } from './rate-limiter-contract.js';

function setup(reply: unknown = [1, 60_000]) {
  const client = new FakeRedis();
  client.evalReply = reply;
  return { client, limiter: new RedisRateLimiter(client) };
}

describe('RedisRateLimiter', () => {
  it('makes exactly one script evaluation per consume, with the namespaced key and the window', async () => {
    const { client, limiter } = setup();

    await limiter.consume('enquiry:203.0.113.9', 5, 60);

    expect(client.evals).toEqual([
      {
        script: CONSUME_SCRIPT,
        numberOfKeys: 1,
        args: ['catalogue:v1:rl:enquiry:203.0.113.9', 60],
      },
    ]);
    expect(RATE_LIMIT_KEY_PREFIX).toBe('catalogue:v1:rl:');
  });

  it.each([1, 30, 3600])('passes the window of %i seconds to the script', async (window) => {
    const { client, limiter } = setup();

    await limiter.consume('k', 5, window);

    expect(client.evals[0]?.args[1]).toBe(window);
  });

  it.each([
    [[1, 60_000], 5, { allowed: true, remaining: 4, retryAfterSeconds: 60 }],
    [[5, 12_345], 5, { allowed: true, remaining: 0, retryAfterSeconds: 13 }],
    [[6, 1], 5, { allowed: false, remaining: 0, retryAfterSeconds: 1 }],
    [[500, 0], 5, { allowed: false, remaining: 0, retryAfterSeconds: 1 }],
  ])('maps the reply %j with limit %i to %j', async (reply, limit, expected) => {
    const { limiter } = setup(reply);

    const result = await limiter.consume('k', limit, 60);

    expect(result).toEqual({ ...expected, limit });
  });

  it('turns a failing store into a CacheError whose cause is the original error', async () => {
    const { client, limiter } = setup();
    client.failWith = new Error('Command timed out');

    const failure = await limiter.consume('k', 5, 60).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBe(client.failWith);
  });

  it.each([
    ['null', null],
    ['a number', 3],
    ['a string', 'OK'],
    ['an empty array', []],
    ['one element', [1]],
    ['three elements', [1, 60_000, 0]],
    ['a string count', ['1', 60_000]],
    ['a fractional count', [1.5, 60_000]],
    ['a zero count', [0, 60_000]],
    ['a negative ttl', [1, -1]],
    ['a NaN ttl', [1, Number.NaN]],
    ['an object', { count: 1, ttl: 60_000 }],
  ])('rejects a malformed reply (%s) with a CacheError', async (_label, reply) => {
    const { limiter } = setup(reply);

    await expect(limiter.consume('k', 5, 60)).rejects.toBeInstanceOf(CacheError);
  });

  it('uses a script that sets the expiry on the first hit and repairs a counter with no expiry', () => {
    expect(CONSUME_SCRIPT).toContain("redis.call('INCR', KEYS[1])");
    expect(CONSUME_SCRIPT).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
    expect(CONSUME_SCRIPT).toContain("redis.call('PTTL', KEYS[1])");
    expect(CONSUME_SCRIPT).toMatch(/count == 1 or ttl < 0/);
  });

  it('shares one client with the cache without interfering with it', async () => {
    const client = new FakeRedis();
    const cache = new RedisCache(client, new FakeLogger());
    const limiter = new RedisRateLimiter(client);

    await cache.set('products:all', { a: 1 }, 60);
    await limiter.consume('read:1.2.3.4', 120, 60);

    expect(client.sets.map((s) => s.key)).toEqual(['catalogue:v1:products:all']);
    expect(client.evals.map((e) => e.args[0])).toEqual(['catalogue:v1:rl:read:1.2.3.4']);
  });
});

// Needs a running Redis: `REDIS_URL=redis://127.0.0.1:6379 npm test -w @catalogue/api`.
const redisUrl = process.env.REDIS_URL;
describeRateLimiterContract(
  'RedisRateLimiter',
  async () => {
    const client = createRedisClient(redisUrl ?? '');
    const cache = new RedisCache(client, new FakeLogger());
    await cache.connect();
    return {
      limiter: new RedisRateLimiter(client),
      advanceSeconds: (seconds) => sleep(seconds * 1000),
      cleanup: () => cache.close(),
    };
  },
  { skip: redisUrl === undefined },
);
