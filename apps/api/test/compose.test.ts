import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compose, type ComposeDeps } from '../src/compose.js';
import { loadConfig } from '../src/config/index.js';
import { ConfigError } from '../src/domain/errors.js';
import { FakeLogger } from './support/fake-logger.js';
import { FakeRedis } from './support/fake-redis.js';
import { upstreamProducts } from './support/fixtures.js';

function setup(env: Record<string, string> = {}, redis = new FakeRedis()) {
  const config = loadConfig({
    NODE_ENV: 'test',
    FAKESTORE_BASE_URL: 'http://upstream.test',
    ...env,
  });
  const logger = new FakeLogger();
  const fetched: string[] = [];
  let respond: () => Response = () => new Response(JSON.stringify(upstreamProducts()));
  const createRedis = vi.fn<ComposeDeps['createRedis']>(() => redis);
  const deps: ComposeDeps = {
    createRedis,
    fetch: (input) => {
      fetched.push(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      return Promise.resolve(respond());
    },
  };
  return {
    config,
    logger,
    fetched,
    redis,
    createRedis,
    run: () => compose(config, logger, deps),
    respondWith: (make: () => Response) => {
      respond = make;
    },
  };
}

const featuredIds = async (service: { featured(): Promise<{ id: number }[]> }) =>
  (await service.featured()).map((p) => p.id);

describe('compose: memory cache (the default)', () => {
  it('builds a working catalogue service with no closers and never touches Redis', async () => {
    const t = setup();

    const { services, closers } = await t.run();

    expect(closers).toEqual([]);
    expect(t.createRedis).not.toHaveBeenCalled();
    expect(t.redis.calls).toEqual([]);
    expect(await featuredIds(services.catalogService)).toEqual([12, 11, 3, 18, 5]);
  });

  it('reads the catalogue from the configured upstream base URL', async () => {
    const t = setup({ FAKESTORE_BASE_URL: 'http://catalogue.test/api' });
    const { services } = await t.run();

    await services.catalogService.featured();

    expect(t.fetched).toEqual(['http://catalogue.test/api/products']);
  });

  it('passes the featured override to the service', async () => {
    const t = setup({ FEATURED_PRODUCT_IDS: '7,2,15' });
    const { services } = await t.run();

    expect(await featuredIds(services.catalogService)).toEqual([7, 2, 15]);
  });

  it('caches the list in memory: two calls make one upstream request', async () => {
    const t = setup();
    const { services } = await t.run();

    await services.catalogService.featured();
    await services.catalogService.categories();

    expect(t.fetched).toHaveLength(1);
  });

  it('passes UPSTREAM_MAX_RETRIES to the adapter: 0 means a single attempt', async () => {
    const t = setup({ UPSTREAM_MAX_RETRIES: '0' });
    t.respondWith(() => new Response('boom', { status: 500 }));
    const { services } = await t.run();

    await expect(services.catalogService.featured()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(t.fetched).toHaveLength(1);
  });
});

describe('compose: freshness and stale windows reach the caching decorator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches once the fresh TTL has passed (fresh 1 s, stale 3600 s)', async () => {
    const t = setup({ CACHE_FRESH_TTL_SECONDS: '1', CACHE_STALE_TTL_SECONDS: '3600' });
    const { services } = await t.run();
    await services.catalogService.featured();

    vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
    await services.catalogService.featured();
    expect(t.fetched).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await services.catalogService.featured();
    expect(t.fetched).toHaveLength(2);
  });

  it('serves stale data only inside the stale window (fresh 1 s, stale 5 s)', async () => {
    const t = setup({
      CACHE_FRESH_TTL_SECONDS: '1',
      CACHE_STALE_TTL_SECONDS: '5',
      UPSTREAM_MAX_RETRIES: '0',
    });
    const { services } = await t.run();
    await services.catalogService.featured();
    t.respondWith(() => new Response('boom', { status: 500 }));

    vi.setSystemTime(new Date('2026-01-01T00:00:04Z'));
    expect(await featuredIds(services.catalogService)).toEqual([12, 11, 3, 18, 5]);

    vi.setSystemTime(new Date('2026-01-01T00:00:07Z'));
    await expect(services.catalogService.featured()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
});

describe('compose: redis cache', () => {
  const env = {
    CACHE_DRIVER: 'redis',
    REDIS_URL: 'redis://user:topsecret@cache.test:6379',
    CACHE_FRESH_TTL_SECONDS: '100',
    CACHE_STALE_TTL_SECONDS: '500',
  };

  it('creates the client from REDIS_URL, connects, and registers a redis closer', async () => {
    const t = setup(env);

    const { closers } = await t.run();

    expect(t.createRedis).toHaveBeenCalledExactlyOnceWith(env.REDIS_URL);
    expect(t.redis.calls).toEqual(['connect', 'ping']);
    expect(closers.map((c) => c.name)).toEqual(['redis']);
  });

  it('the redis closer quits the connection', async () => {
    const t = setup(env);
    const { closers } = await t.run();

    await closers[0]?.close();

    expect(t.redis.calls).toContain('quit');
  });

  it('logs the host only, never the credentials', async () => {
    const t = setup(env);

    await t.run();

    expect(t.logger.at('info').map((r) => r.message)).toContain('redis cache connected');
    expect(JSON.stringify(t.logger.records)).toContain('cache.test:6379');
    expect(JSON.stringify(t.logger.records)).not.toContain('topsecret');
  });

  it('stores the catalogue in Redis under the versioned prefix for fresh plus stale seconds', async () => {
    const t = setup(env);
    const { services } = await t.run();

    await services.catalogService.featured();

    expect(t.redis.sets).toHaveLength(1);
    expect(t.redis.sets[0]).toMatchObject({ key: 'catalogue:v1:products:all', seconds: 600 });
  });

  it('serves the second request from Redis without another upstream call', async () => {
    const t = setup(env);
    const { services } = await t.run();

    await services.catalogService.featured();
    await services.catalogService.featured();

    expect(t.fetched).toHaveLength(1);
  });

  it('keeps answering from the upstream when Redis commands start failing', async () => {
    const t = setup(env);
    const { services } = await t.run();
    t.redis.failWith = new Error('Command timed out');

    expect(await featuredIds(services.catalogService)).toEqual([12, 11, 3, 18, 5]);
    expect(t.logger.at('warn').length).toBeGreaterThan(0);
  });

  it('fails fast with a ConfigError naming REDIS_URL, host only, when Redis is unreachable', async () => {
    const t = setup(env, Object.assign(new FakeRedis(), {}));
    t.redis.failWith = new Error('Connection is closed.');

    const failure = await t.run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConfigError);
    const error = failure as ConfigError;
    expect(error.details?.map((d) => d.field)).toEqual(['REDIS_URL']);
    expect(error.details?.[0]?.message).toBe('Redis is not reachable at cache.test:6379');
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      'topsecret',
    );
    expect((error.cause as Error).cause).toBe(t.redis.failWith);
  });

  it('drops the socket when the startup check fails', async () => {
    const t = setup(env);
    t.redis.failWith = new Error('Connection is closed.');

    await t.run().catch(() => undefined);

    expect(t.redis.disconnected).toBe(true);
  });
});
