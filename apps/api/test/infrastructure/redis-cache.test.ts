import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { CacheError } from '../../src/domain/errors.js';
import {
  REDIS_KEY_PREFIX,
  RedisCache,
  createRedisClient,
  describeRedisUrl,
  reconnectDelayMs,
} from '../../src/infrastructure/cache/redis-cache.js';
import { FakeLogger } from '../support/fake-logger.js';
import { FakeRedis } from '../support/fake-redis.js';
import { describeCacheContract } from './cache-contract.js';

function setup() {
  const client = new FakeRedis();
  const logger = new FakeLogger();
  return { client, logger, cache: new RedisCache(client, logger) };
}

describe('RedisCache', () => {
  it('prefixes every key with catalogue:v1:', async () => {
    const { cache, client } = setup();

    await cache.set('products:all', { a: 1 }, 60);
    await cache.get('products:all');

    expect(REDIS_KEY_PREFIX).toBe('catalogue:v1:');
    expect(client.calls).toEqual([
      'set catalogue:v1:products:all',
      'get catalogue:v1:products:all',
    ]);
  });

  it('stores JSON with EX and the TTL in whole seconds', async () => {
    const { cache, client } = setup();

    await cache.set('k', { a: [1, 2] }, 3660);

    expect(client.sets).toEqual([
      { key: 'catalogue:v1:k', value: '{"a":[1,2]}', mode: 'EX', seconds: 3660 },
    ]);
  });

  it.each([
    [0.2, 1],
    [1.2, 2],
    [0, 1],
    [59, 59],
  ])('turns a TTL of %f s into %i whole seconds (Redis rejects 0)', async (ttl, expected) => {
    const { cache, client } = setup();

    await cache.set('k', 1, ttl);

    expect(client.sets[0]?.seconds).toBe(expected);
  });

  it('parses the stored JSON on a hit and resolves undefined on a miss', async () => {
    const { cache, client } = setup();
    client.store.set('catalogue:v1:hit', '{"id":7}');

    expect(await cache.get('hit')).toEqual({ id: 7 });
    expect(await cache.get('miss')).toBeUndefined();
  });

  it('keeps a stored JSON null distinct from a miss', async () => {
    const { cache, client } = setup();
    client.store.set('catalogue:v1:nothing', 'null');

    expect(await cache.get('nothing')).toBeNull();
  });
});

describe('RedisCache failures', () => {
  it('turns a failing get into a CacheError whose cause is the original error', async () => {
    const { cache, client } = setup();
    client.failWith = new Error('ECONNRESET');

    const failure = await cache.get('k').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBe(client.failWith);
  });

  it('turns a failing set into a CacheError whose cause is the original error', async () => {
    const { cache, client } = setup();
    client.failWith = new Error('Command timed out');

    const failure = await cache.set('k', 1, 10).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBe(client.failWith);
  });

  it('turns a corrupt stored value into a CacheError with the parse error as cause', async () => {
    const { cache, client } = setup();
    client.store.set('catalogue:v1:bad', '{not json');

    const failure = await cache.get('bad').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
  ])('refuses to store %s and never calls Redis', async (_label, value) => {
    const { cache, client } = setup();

    await expect(cache.set('k', value, 10)).rejects.toBeInstanceOf(CacheError);
    expect(client.calls).toEqual([]);
  });

  it('refuses to store a circular structure and a bigint', async () => {
    const { cache, client } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(cache.set('k', circular, 10)).rejects.toBeInstanceOf(CacheError);
    await expect(cache.set('k', 10n, 10)).rejects.toBeInstanceOf(CacheError);
    expect(client.calls).toEqual([]);
  });
});

describe('RedisCache connection events', () => {
  it('logs an error event at warn and does not throw', () => {
    const { client, logger } = setup();
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), {
      code: 'ECONNREFUSED',
    });

    expect(() => client.emit('error', error)).not.toThrow();

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.message).toBe('redis connection error');
    expect(logger.at('warn')[0]?.fields).toEqual({
      code: 'ECONNREFUSED',
      reason: 'connect ECONNREFUSED 10.0.0.5:6379',
    });
  });

  it('never writes credentials from an error message to the log', () => {
    const { client, logger } = setup();

    client.emit('error', new Error('Invalid URL redis://user:s3cret@cache.test:6379/0'));

    expect(JSON.stringify(logger.records)).not.toContain('s3cret');
    expect(JSON.stringify(logger.records)).toContain('cache.test');
  });

  it('logs a warn per error event without any other level', () => {
    const { client, logger } = setup();

    client.emit('error', new Error('one'));
    client.emit('error', new Error('two'));

    expect(logger.at('warn')).toHaveLength(2);
    expect(logger.records).toHaveLength(2);
  });
});

describe('RedisCache lifecycle', () => {
  it('connect() connects and then pings', async () => {
    const { cache, client } = setup();

    await cache.connect();

    expect(client.calls).toEqual(['connect', 'ping']);
  });

  it('connect() failure becomes a CacheError and drops the socket', async () => {
    const { cache, client } = setup();
    client.failWith = new Error('Connection is closed.');

    const failure = await cache.connect().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBe(client.failWith);
    expect(client.disconnected).toBe(true);
  });

  it('close() quits gracefully', async () => {
    const { cache, client } = setup();

    await cache.close();

    expect(client.calls).toEqual(['quit']);
    expect(client.disconnected).toBe(false);
  });

  it('close() falls back to disconnect and reports a CacheError when quit fails', async () => {
    const { cache, client } = setup();
    client.failWith = new Error('socket closed');

    const failure = await cache.close().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect(client.disconnected).toBe(true);
  });
});

describe('reconnectDelayMs', () => {
  it.each([1, 2, 5, 100])(
    'gives up (null) before the first successful connection, attempt %i',
    (attempt) => {
      expect(reconnectDelayMs(false, attempt)).toBeNull();
    },
  );

  it.each([
    [1, 200],
    [2, 400],
    [3, 600],
    [9, 1800],
    [10, 2000],
    [11, 2000],
    [1000, 2000],
  ])('after the first connection, attempt %i waits %i ms (capped at 2000)', (attempt, expected) => {
    expect(reconnectDelayMs(true, attempt)).toBe(expected);
  });
});

describe('describeRedisUrl', () => {
  it.each([
    ['redis://cache.test:6379', 'cache.test:6379'],
    ['rediss://user:s3cret@cache.test:6380/2', 'cache.test:6380'],
    ['redis://:onlypass@10.0.0.9', '10.0.0.9'],
  ])('%s -> host only (%s)', (url, expected) => {
    const described = describeRedisUrl(url);

    expect(described).toBe(expected);
    expect(described).not.toContain('s3cret');
    expect(described).not.toContain('onlypass');
  });
});

describe('createRedisClient', () => {
  it('does not connect until asked (lazyConnect) and fails fast on a dead address', async () => {
    const client = createRedisClient('redis://127.0.0.1:1');
    client.on('error', () => undefined);

    const cache = new RedisCache(client, new FakeLogger());
    const failure = await cache.connect().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
  });
});

// Needs a running Redis: `REDIS_URL=redis://127.0.0.1:6379 npm test -w @catalogue/api`.
const redisUrl = process.env.REDIS_URL;
describeCacheContract(
  'RedisCache',
  async () => {
    const client = createRedisClient(redisUrl ?? '');
    const cache = new RedisCache(client, new FakeLogger());
    await cache.connect();
    return {
      cache,
      advanceSeconds: (seconds) => sleep(seconds * 1000),
      cleanup: () => cache.close(),
    };
  },
  { skip: redisUrl === undefined },
);
