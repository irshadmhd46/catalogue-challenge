import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { CatalogService } from '../../src/application/catalog-service.js';
import { loadConfig } from '../../src/config/index.js';
import { CachedProductSource } from '../../src/infrastructure/cache/cached-product-source.js';
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js';
import { FakeStoreProductSource } from '../../src/infrastructure/catalog/fakestore-product-source.js';
import { FakeLogger } from '../support/fake-logger.js';
import { upstreamProducts } from '../support/fixtures.js';

const FRESH = 60;
const STALE = 3600;

type Upstream = (url: URL, signal: AbortSignal) => Response | Promise<Response>;

/** Real service, routes, decorator, cache and Fake Store adapter; only the network is stubbed. */
async function stack(upstream: Upstream, options: { timeoutsFire?: boolean } = {}) {
  const clock = { ms: 5_000_000 };
  const logger = new FakeLogger();
  const calls: string[] = [];

  const stubFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(url.pathname);
    return Promise.resolve(upstream(url, init?.signal as AbortSignal));
  };

  const inner = new FakeStoreProductSource({
    baseUrl: 'https://upstream.test',
    timeoutMs: 4000,
    deadlineMs: 10_000,
    maxRetries: 0,
    logger,
    fetch: stubFetch,
    sleep: () => Promise.resolve(),
    random: () => 0,
    now: () => clock.ms,
    timeoutSignal: () => {
      const controller = new AbortController();
      if (options.timeoutsFire) {
        controller.abort(new DOMException('timed out', 'TimeoutError'));
      }
      return controller.signal;
    },
  });
  const source = new CachedProductSource({
    inner,
    cache: new MemoryCache(() => clock.ms),
    logger,
    freshSeconds: FRESH,
    staleSeconds: STALE,
    now: () => clock.ms,
  });
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test' }),
    logger,
    catalogService: new CatalogService(source, logger),
  });

  return {
    app,
    logger,
    calls,
    advance: (seconds: number) => {
      clock.ms += seconds * 1000;
    },
    get: (url: string) =>
      app.inject({ method: 'GET', url, headers: { 'x-request-id': 'stack-1' } }),
  };
}

const listing = () => new Response(JSON.stringify(upstreamProducts()));
const healthyUpstream: Upstream = (url) => {
  if (url.pathname === '/products') return listing();
  const id = Number(url.pathname.split('/').pop());
  const found = upstreamProducts().find((p) => p.id === id);
  // The real Fake Store answers 200 with an empty body for ids it does not have.
  return found ? new Response(JSON.stringify(found)) : new Response('', { status: 200 });
};

describe('catalogue over the real adapters', () => {
  it('serves featured, categories and a category page from one upstream list call', async () => {
    const { get, calls } = await stack(healthyUpstream);

    const featured = await get('/api/v1/featured');
    const categories = await get('/api/v1/categories');
    const page = await get('/api/v1/categories/electronics');

    expect([featured.statusCode, categories.statusCode, page.statusCode]).toEqual([200, 200, 200]);
    expect(calls).toEqual(['/products']);
    expect(featured.json<{ products: { id: number }[] }>().products.map((p) => p.id)).toEqual([
      12, 11, 3, 18, 5,
    ]);
  });

  it('searches the cached list without another upstream call', async () => {
    const { get, calls } = await stack(healthyUpstream);

    await get('/api/v1/featured');
    const res = await get('/api/v1/products?q=backpack');

    expect(res.json<{ products: { id: number }[] }>().products.map((p) => p.id)).toContain(1);
    expect(calls).toEqual(['/products']);
  });

  it('looks a product up upstream once, then serves it from the cache', async () => {
    const { get, calls } = await stack(healthyUpstream);

    const first = await get('/api/v1/products/7');
    const second = await get('/api/v1/products/7');

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(calls).toEqual(['/products/7']);
  });

  it('turns the upstream empty-200 for a missing id into a 404 envelope', async () => {
    const { get } = await stack(healthyUpstream);

    const res = await get('/api/v1/products/9999');

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: Record<string, unknown> }>().error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Product not found',
      requestId: 'stack-1',
    });
  });

  it('asks the upstream again for a missing id every time (absence is not cached)', async () => {
    const { get, calls } = await stack(healthyUpstream);

    await get('/api/v1/products/9999');
    await get('/api/v1/products/9999');

    expect(calls).toEqual(['/products/9999', '/products/9999']);
  });

  it('never calls the upstream for an invalid id or query', async () => {
    const { get, calls } = await stack(healthyUpstream);

    await get('/api/v1/products/abc');
    await get('/api/v1/products?q=');
    await get('/api/v1/categories/Not%20A%20Slug');

    expect(calls).toEqual([]);
  });

  it('exposes none of the upstream shape to the client', async () => {
    const { get } = await stack(healthyUpstream);

    const res = await get('/api/v1/featured');

    expect(res.body).not.toContain('"image"');
    expect(res.body).not.toContain('"rate"');
    expect(res.body).not.toContain('upstream.test');
  });
});

describe('catalogue when the upstream fails', () => {
  const failing: Upstream = () => new Response('boom', { status: 500 });

  it('serves the earlier data, with one warn, once the fresh TTL has passed', async () => {
    let healthy = true;
    const { get, advance, logger, calls } = await stack((url, signal) =>
      healthy ? healthyUpstream(url, signal) : failing(url, signal),
    );
    const before = await get('/api/v1/featured');
    healthy = false;
    advance(FRESH + 1);

    const after = await get('/api/v1/featured');

    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(before.json());
    expect(calls).toEqual(['/products', '/products']);
    const stale = logger
      .at('warn')
      .filter((r) => r.message === 'upstream failed, serving stale cache entry');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.fields).toMatchObject({ key: 'products:all' });
  });

  it('answers 502 with a request id and one error line when the cache is cold', async () => {
    const { get, logger } = await stack(failing);

    const res = await get('/api/v1/featured');

    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: Record<string, unknown> }>().error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      requestId: 'stack-1',
    });
    expect(res.body).not.toContain('upstream.test');
    expect(logger.at('error')).toHaveLength(1);
  });

  it('stops serving stale data once the stale window has passed', async () => {
    let healthy = true;
    const { get, advance } = await stack((url, signal) =>
      healthy ? healthyUpstream(url, signal) : failing(url, signal),
    );
    await get('/api/v1/featured');
    healthy = false;
    advance(FRESH + STALE + 1);

    const res = await get('/api/v1/featured');

    expect(res.statusCode).toBe(502);
  });

  it('answers 504 when the upstream times out', async () => {
    const hang: Upstream = (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
        if (signal.aborted) reject(signal.reason as Error);
      });
    const { get } = await stack(hang, { timeoutsFire: true });

    const res = await get('/api/v1/featured');

    expect(res.statusCode).toBe(504);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('answers 502, not a crash, when the upstream returns garbage', async () => {
    const { get, logger } = await stack(() => new Response('<html>maintenance</html>'));

    const res = await get('/api/v1/featured');

    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('maintenance');
    expect(logger.at('error')).toHaveLength(1);
  });
});
