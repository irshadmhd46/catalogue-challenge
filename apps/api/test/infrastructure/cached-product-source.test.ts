import { describe, expect, it } from 'vitest';
import type { Cache } from '../../src/domain/cache.js';
import type { Product } from '../../src/domain/catalog.js';
import { CacheError, UpstreamError, UpstreamTimeoutError } from '../../src/domain/errors.js';
import { CachedProductSource } from '../../src/infrastructure/cache/cached-product-source.js';
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js';
import { productWith } from '../support/catalog-fixture.js';
import { FakeLogger } from '../support/fake-logger.js';
import { FakeProductSource } from '../support/fake-product-source.js';

const FRESH = 60;
const STALE = 3600;

/** A MemoryCache that can be told to fail, and that records what was written. */
class FlakyCache implements Cache {
  failGet: Error | undefined;
  failSet: Error | undefined;
  readonly sets: { key: string; ttlSeconds: number }[] = [];

  constructor(private readonly inner: MemoryCache) {}

  get(key: string): Promise<unknown> {
    return this.failGet ? Promise.reject(this.failGet) : this.inner.get(key);
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.sets.push({ key, ttlSeconds });
    return this.failSet ? Promise.reject(this.failSet) : this.inner.set(key, value, ttlSeconds);
  }
}

function setup(products: Product[] = [productWith({ id: 7 }), productWith({ id: 8 })]) {
  const clock = { ms: 1_000_000 };
  const inner = new FakeProductSource(products);
  const memory = new MemoryCache(() => clock.ms);
  const cache = new FlakyCache(memory);
  const logger = new FakeLogger();
  const source = new CachedProductSource({
    inner,
    cache,
    logger,
    freshSeconds: FRESH,
    staleSeconds: STALE,
    now: () => clock.ms,
  });
  return {
    clock,
    inner,
    cache,
    memory,
    logger,
    source,
    advance: (seconds: number) => {
      clock.ms += seconds * 1000;
    },
  };
}

const ids = (list: readonly { id: number }[]) => list.map((p) => p.id);

describe('CachedProductSource: fresh data', () => {
  it('fills the cache on a miss under products:all', async () => {
    const { source, inner, memory, clock } = setup();

    const products = await source.listProducts();

    expect(ids(products)).toEqual([7, 8]);
    expect(inner.listCalls).toBe(1);
    const stored = (await memory.get('products:all')) as { storedAt: number; value: Product[] };
    expect(stored.storedAt).toBe(clock.ms);
    expect(ids(stored.value)).toEqual([7, 8]);
  });

  it('stores entries for the fresh plus stale window', async () => {
    const { source, cache } = setup();

    await source.listProducts();

    expect(cache.sets).toEqual([{ key: 'products:all', ttlSeconds: FRESH + STALE }]);
  });

  it('serves a fresh entry without calling the source again', async () => {
    const { source, inner, advance } = setup();

    const first = await source.listProducts();
    advance(10);
    const second = await source.listProducts();

    expect(inner.listCalls).toBe(1);
    expect(second).toEqual(first);
  });

  it('logs a debug line on a hit', async () => {
    const { source, logger, advance } = setup();
    await source.listProducts();
    advance(1);

    await source.listProducts();

    expect(logger.at('debug').map((r) => r.message)).toEqual(['cache hit']);
    expect(logger.at('debug')[0]?.fields).toMatchObject({ key: 'products:all' });
  });

  it('refreshes an entry older than the fresh TTL and returns the new data', async () => {
    const { source, inner, advance, memory, clock } = setup();
    await source.listProducts();
    inner.products.push(productWith({ id: 9 }));
    advance(FRESH + 1);

    const products = await source.listProducts();

    expect(inner.listCalls).toBe(2);
    expect(ids(products)).toEqual([7, 8, 9]);
    const stored = (await memory.get('products:all')) as { storedAt: number };
    expect(stored.storedAt).toBe(clock.ms);
  });

  it('treats an entry exactly at the fresh TTL as stale', async () => {
    const { source, inner, advance } = setup();
    await source.listProducts();
    advance(FRESH);

    await source.listProducts();

    expect(inner.listCalls).toBe(2);
  });

  it('keys products individually: product:7 and product:8', async () => {
    const { source, inner, memory } = setup();

    await source.findProduct(7);
    await source.findProduct(8);

    expect(inner.findCalls).toEqual([7, 8]);
    expect(await memory.get('product:7')).toBeDefined();
    expect(await memory.get('product:8')).toBeDefined();
  });

  it('serves a repeated product lookup from the cache', async () => {
    const { source, inner } = setup();

    const first = await source.findProduct(7);
    const second = await source.findProduct(7);

    expect(inner.findCalls).toEqual([7]);
    expect(second).toEqual(first);
  });

  it('does not cache absence: a missing product reaches the source every time', async () => {
    const { source, inner, memory, cache } = setup();

    expect(await source.findProduct(9999)).toBeUndefined();
    expect(await source.findProduct(9999)).toBeUndefined();

    expect(inner.findCalls).toEqual([9999, 9999]);
    expect(await memory.get('product:9999')).toBeUndefined();
    expect(cache.sets).toEqual([]);
  });
});

describe('CachedProductSource: stale data on failure', () => {
  it('serves the stale list when the source fails, with exactly one warn', async () => {
    const { source, inner, logger, advance } = setup();
    const first = await source.listProducts();
    advance(300);
    inner.failure = new UpstreamError();

    const second = await source.listProducts();

    expect(second).toEqual(first);
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.message).toBe('upstream failed, serving stale cache entry');
    expect(logger.at('warn')[0]?.fields).toMatchObject({ key: 'products:all', ageSeconds: 300 });
  });

  it.each([FRESH + STALE, FRESH + STALE + 1])(
    'does not serve an entry %i s old, even if the cache still returns it',
    async (ageSeconds) => {
      const { inner, logger, clock } = setup();
      const ancient = {
        storedAt: clock.ms - ageSeconds * 1000,
        value: [productWith({ id: 1 })],
      };
      const cacheThatNeverExpires: Cache = {
        get: () => Promise.resolve(ancient),
        set: () => Promise.resolve(),
      };
      const source = new CachedProductSource({
        inner,
        cache: cacheThatNeverExpires,
        logger,
        freshSeconds: FRESH,
        staleSeconds: STALE,
        now: () => clock.ms,
      });
      inner.failure = new UpstreamError();

      await expect(source.listProducts()).rejects.toBe(inner.failure);
    },
  );

  it('still serves an entry one second inside the stale window', async () => {
    const { inner, logger, clock } = setup();
    const value = [productWith({ id: 1 })];
    const source = new CachedProductSource({
      inner,
      cache: {
        get: () => Promise.resolve({ storedAt: clock.ms - (FRESH + STALE - 1) * 1000, value }),
        set: () => Promise.resolve(),
      },
      logger,
      freshSeconds: FRESH,
      staleSeconds: STALE,
      now: () => clock.ms,
    });
    inner.failure = new UpstreamError();

    expect(await source.listProducts()).toEqual(value);
  });

  it('serves a stale product when the source times out', async () => {
    const { source, inner, advance } = setup();
    const first = await source.findProduct(7);
    advance(FRESH + 5);
    inner.failure = new UpstreamTimeoutError();

    expect(await source.findProduct(7)).toEqual(first);
  });

  it('rethrows the same error once the stale window has passed', async () => {
    const { source, inner, advance } = setup();
    await source.listProducts();
    advance(FRESH + STALE + 1);
    inner.failure = new UpstreamError();

    await expect(source.listProducts()).rejects.toBe(inner.failure);
  });

  it('rethrows the same error instance when nothing is cached', async () => {
    const { source, inner } = setup();
    inner.failure = new UpstreamTimeoutError();

    await expect(source.listProducts()).rejects.toBe(inner.failure);
  });

  it('does not write a warning when there is no stale entry to serve', async () => {
    const { source, inner, logger } = setup();
    inner.failure = new UpstreamError();

    await source.listProducts().catch(() => undefined);

    expect(logger.at('warn')).toHaveLength(0);
  });

  it('returns undefined, not the stale product, when the source says it is gone', async () => {
    const { source, inner, advance } = setup();
    await source.findProduct(7);
    inner.products.splice(0, inner.products.length);
    advance(FRESH + 1);

    expect(await source.findProduct(7)).toBeUndefined();
  });

  it('refreshes a stale entry again once the source recovers and the cooldown has passed', async () => {
    const { source, inner, advance } = setup();
    await source.listProducts();
    advance(FRESH + 1);
    inner.failure = new UpstreamError();
    await source.listProducts();
    inner.failure = undefined;
    advance(16);

    await source.listProducts();

    expect(inner.listCalls).toBe(3);
  });
});

describe('CachedProductSource: serving stale during an outage is fast', () => {
  async function outage() {
    const t = setup();
    await t.source.listProducts();
    t.advance(FRESH + 1);
    t.inner.failure = new UpstreamError();
    await t.source.listProducts(); // first request after expiry pays for one refresh attempt
    return t;
  }

  it('does not call the source again while the retry cooldown is running', async () => {
    const t = await outage();
    expect(t.inner.listCalls).toBe(2);

    t.advance(5);
    const second = await t.source.listProducts();
    t.advance(5);
    const third = await t.source.listProducts();

    expect(t.inner.listCalls).toBe(2);
    expect(ids(second)).toEqual([7, 8]);
    expect(ids(third)).toEqual([7, 8]);
  });

  it('warns once per failed refresh, not once per request', async () => {
    const t = await outage();

    t.advance(5);
    await t.source.listProducts();
    await t.source.listProducts();

    expect(t.logger.at('warn')).toHaveLength(1);
    expect(t.logger.at('debug').map((r) => r.message)).toContain(
      'upstream recently failed, serving stale entry',
    );
  });

  it('tries the source again once the 15 s cooldown has passed', async () => {
    const t = await outage();

    t.advance(14);
    await t.source.listProducts();
    expect(t.inner.listCalls).toBe(2);
    t.advance(1);
    await t.source.listProducts();

    expect(t.inner.listCalls).toBe(3);
  });

  it('starts a new cooldown when the retry fails too', async () => {
    const t = await outage();
    t.advance(16);
    await t.source.listProducts();
    expect(t.inner.listCalls).toBe(3);

    t.advance(10);
    await t.source.listProducts();

    expect(t.inner.listCalls).toBe(3);
    expect(t.logger.at('warn')).toHaveLength(2);
  });

  it('keeps cooldowns per key: a failing list does not delay a product refresh', async () => {
    const clock = { ms: 1_000_000 };
    const inner = new FakeProductSource();
    const source = new CachedProductSource({
      inner,
      cache: new MemoryCache(() => clock.ms),
      logger: new FakeLogger(),
      freshSeconds: FRESH,
      staleSeconds: STALE,
      staleRetryAfterSeconds: 600,
      now: () => clock.ms,
    });
    await source.listProducts();
    await source.findProduct(7);
    clock.ms += (FRESH + 1) * 1000;
    inner.failure = new UpstreamError();
    await source.listProducts(); // starts a 600 s cooldown for products:all only

    await source.findProduct(7);

    expect(inner.findCalls).toEqual([7, 7]);
  });

  it('honours a configured cooldown', async () => {
    const clock = { ms: 1_000_000 };
    const inner = new FakeProductSource();
    const memory = new MemoryCache(() => clock.ms);
    const source = new CachedProductSource({
      inner,
      cache: memory,
      logger: new FakeLogger(),
      freshSeconds: FRESH,
      staleSeconds: STALE,
      staleRetryAfterSeconds: 3,
      now: () => clock.ms,
    });
    await source.listProducts();
    clock.ms += (FRESH + 1) * 1000;
    inner.failure = new UpstreamError();
    await source.listProducts();

    clock.ms += 2000;
    await source.listProducts();
    expect(inner.listCalls).toBe(2);
    clock.ms += 1000;
    await source.listProducts();

    expect(inner.listCalls).toBe(3);
  });

  it('a cold cache has no stale copy to fall back on, so every request still tries the source', async () => {
    const { source, inner } = setup();
    inner.failure = new UpstreamError();

    await source.listProducts().catch(() => undefined);
    await source.listProducts().catch(() => undefined);

    expect(inner.listCalls).toBe(2);
  });
});

describe('CachedProductSource: cached values are validated', () => {
  const entryWith = (value: unknown, clock: { ms: number }) => ({ storedAt: clock.ms, value });

  it.each([
    ['a list of objects with the wrong shape', [{ id: 1, name: 'old shape' }]],
    ['something that is not a list', { products: [] }],
    ['a list containing an invalid product', [{ ...productWith({ id: 1 }), price: -5 }]],
  ])('ignores a cached list that is %s, with a warning, and refetches', async (_label, value) => {
    const { source, inner, memory, logger, clock } = setup();
    await memory.set('products:all', entryWith(value, clock), 600);

    expect(ids(await source.listProducts())).toEqual([7, 8]);

    expect(inner.listCalls).toBe(1);
    expect(logger.at('warn').map((r) => r.message)).toEqual([
      'ignoring cache entry with an unexpected shape',
    ]);
  });

  it('ignores a cached product with an old shape', async () => {
    const { source, inner, memory, clock } = setup();
    await memory.set('product:7', entryWith({ id: 7, title: 'old' }, clock), 600);

    expect((await source.findProduct(7))?.id).toBe(7);
    expect(inner.findCalls).toEqual([7]);
  });

  it('does not serve an invalid stale entry when the source also fails', async () => {
    const { source, inner, memory, clock } = setup();
    await memory.set('products:all', entryWith([{ id: 1 }], clock), 600);
    inner.failure = new UpstreamError();

    await expect(source.listProducts()).rejects.toBe(inner.failure);
  });

  it('still accepts a valid entry, including an empty list', async () => {
    const { source, inner, memory, clock } = setup();
    await memory.set('products:all', entryWith([], clock), 600);

    expect(await source.listProducts()).toEqual([]);
    expect(inner.listCalls).toBe(0);
  });
});

describe('CachedProductSource: a source that throws synchronously', () => {
  it('rejects the call, and does not poison the key for later calls', async () => {
    let calls = 0;
    const boom = new Error('sync throw');
    const inner = {
      listProducts: (): Promise<Product[]> => {
        calls += 1;
        if (calls === 1) {
          throw boom;
        }
        return Promise.resolve([productWith({ id: 7 })]);
      },
      findProduct: () => Promise.resolve(undefined),
    };
    const source = new CachedProductSource({
      inner,
      cache: new MemoryCache(),
      logger: new FakeLogger(),
      freshSeconds: FRESH,
      staleSeconds: STALE,
    });

    await expect(source.listProducts()).rejects.toBe(boom);
    const second = await source.listProducts();

    expect(ids(second)).toEqual([7]);
    expect(calls).toBe(2);
  });
});

describe('CachedProductSource: single flight', () => {
  function deferredSource() {
    let release!: (products: Product[]) => void;
    let fail!: (error: Error) => void;
    let calls = 0;
    const pending = new Promise<Product[]>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const inner = {
      listProducts: () => {
        calls += 1;
        return pending;
      },
      findProduct: () => Promise.resolve(undefined),
    };
    return { inner, release, fail, calls: () => calls };
  }

  function build(inner: {
    listProducts: () => Promise<Product[]>;
    findProduct: () => Promise<undefined>;
  }) {
    const logger = new FakeLogger();
    const source = new CachedProductSource({
      inner,
      cache: new MemoryCache(),
      logger,
      freshSeconds: FRESH,
      staleSeconds: STALE,
    });
    return { source, logger };
  }

  it('makes one source call for five concurrent requests', async () => {
    const { inner, release, calls } = deferredSource();
    const { source } = build(inner);

    const requests = Array.from({ length: 5 }, () => source.listProducts());
    await Promise.resolve();
    release([productWith({ id: 7 })]);
    const results = await Promise.all(requests);

    expect(calls()).toBe(1);
    for (const result of results) {
      expect(ids(result)).toEqual([7]);
    }
  });

  it('gives each concurrent caller its own copy', async () => {
    const { inner, release } = deferredSource();
    const { source } = build(inner);

    const a = source.listProducts();
    const b = source.listProducts();
    release([productWith({ id: 7 })]);
    const [first, second] = await Promise.all([a, b]);

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('shares a failure between concurrent callers and clears the in-flight entry', async () => {
    const { inner, fail, calls } = deferredSource();
    const { source } = build(inner);
    const failure = new UpstreamError();

    const a = source.listProducts().catch((error: unknown) => error);
    const b = source.listProducts().catch((error: unknown) => error);
    fail(failure);
    expect(await a).toBe(failure);
    expect(await b).toBe(failure);
    expect(calls()).toBe(1);

    await source.listProducts().catch(() => undefined);
    expect(calls()).toBe(2);
  });

  it('keeps different keys independent', async () => {
    const { source, inner } = setup();

    await Promise.all([source.listProducts(), source.findProduct(7), source.findProduct(8)]);

    expect(inner.listCalls).toBe(1);
    expect(inner.findCalls.sort()).toEqual([7, 8]);
  });
});

describe('CachedProductSource: the cache is never a dependency', () => {
  it('goes to the source and warns once when a read fails', async () => {
    const { source, inner, cache, logger } = setup();
    cache.failGet = new CacheError({ cause: new Error('redis down') });

    const products = await source.listProducts();

    expect(ids(products)).toEqual([7, 8]);
    expect(inner.listCalls).toBe(1);
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ key: 'products:all', err: cache.failGet });
  });

  it('still returns the fetched value and warns once when a write fails', async () => {
    const { source, cache, logger } = setup();
    cache.failSet = new CacheError();

    const products = await source.listProducts();

    expect(ids(products)).toEqual([7, 8]);
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ err: cache.failSet });
  });

  it('works with reads and writes both failing, warning for each', async () => {
    const { source, cache, logger } = setup();
    cache.failGet = new CacheError();
    cache.failSet = new CacheError();

    expect(ids(await source.listProducts())).toEqual([7, 8]);
    expect(logger.at('warn')).toHaveLength(2);
  });

  it('still propagates a source failure when the cache is also down', async () => {
    const { source, inner, cache } = setup();
    cache.failGet = new CacheError();
    inner.failure = new UpstreamError();

    await expect(source.listProducts()).rejects.toBe(inner.failure);
  });

  it('treats a malformed cached entry as a miss and warns', async () => {
    const { source, inner, memory, logger } = setup();
    await memory.set('products:all', { not: 'an entry' }, 60);

    expect(ids(await source.listProducts())).toEqual([7, 8]);

    expect(inner.listCalls).toBe(1);
    expect(logger.at('warn').map((r) => r.message)).toEqual(['ignoring malformed cache entry']);
  });

  it('ignores an entry stamped in the future (clock skew) and refreshes', async () => {
    const { source, inner, memory, clock } = setup();
    await memory.set('products:all', { storedAt: clock.ms + 60_000, value: [] }, 600);

    expect(ids(await source.listProducts())).toEqual([7, 8]);
    expect(inner.listCalls).toBe(1);
  });
});

describe('CachedProductSource: callers cannot mutate cached data', () => {
  it('returns an independent copy on a miss and on a hit', async () => {
    const { source } = setup();

    const first = (await source.listProducts()) as Product[];
    first.push(productWith({ id: 99 }));
    const second = (await source.listProducts()) as Product[];
    second.length = 0;
    const third = await source.listProducts();

    expect(ids(third)).toEqual([7, 8]);
  });

  it('does not let a caller change the source data through the returned list', async () => {
    const { source, inner } = setup();

    const products = (await source.listProducts()) as Product[];
    products.pop();

    expect(inner.products).toHaveLength(2);
  });
});
