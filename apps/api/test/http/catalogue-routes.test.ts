import {
  categoriesResponseSchema,
  categoryPageResponseSchema,
  featuredResponseSchema,
  productResponseSchema,
  productSchema,
  searchResponseSchema,
} from '@catalogue/contracts';
import { describe, expect, it } from 'vitest';
import { UpstreamError, UpstreamTimeoutError } from '../../src/domain/errors.js';
import { buildAppWithFakeLogger, buildAppWithPinoLogger } from '../support/build-test-app.js';
import { FakeProductSource } from '../support/fake-product-source.js';

async function setup(featuredProductIds?: number[]) {
  const source = new FakeProductSource();
  const built = await buildAppWithFakeLogger(
    {},
    featuredProductIds ? { source, featuredProductIds } : { source },
  );
  return { ...built, source };
}

const get = (app: Awaited<ReturnType<typeof setup>>['app'], url: string) =>
  app.inject({ method: 'GET', url, headers: { 'x-request-id': 'req-1' } });

const errorOf = (body: string) => (JSON.parse(body) as { error: Record<string, unknown> }).error;

describe('GET /api/v1/featured', () => {
  it('returns exactly 5 products: 12, 11, 3, 18, 5', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/featured');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = featuredResponseSchema.parse(res.json());
    expect(body.products.map((p) => p.id)).toEqual([12, 11, 3, 18, 5]);
  });

  it('exposes none of the upstream field names', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/featured');

    expect(res.body).not.toContain('"image"');
    expect(res.body).not.toContain('"rate"');
    for (const product of res.json<{ products: unknown[] }>().products) {
      expect(productSchema.safeParse(product).success).toBe(true);
    }
  });

  it('honours the configured featured ids', async () => {
    const { app } = await setup([7, 2]);

    const res = await get(app, '/api/v1/featured');

    expect(res.json<{ products: { id: number }[] }>().products.map((p) => p.id)).toEqual([7, 2]);
  });

  it('answers HEAD without a body', async () => {
    const { app } = await setup();

    const res = await app.inject({ method: 'HEAD', url: '/api/v1/featured' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });
});

describe('GET /api/v1/categories', () => {
  it('returns the four categories sorted by name', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/categories');

    expect(res.statusCode).toBe(200);
    const body = categoriesResponseSchema.parse(res.json());
    expect(body.categories.map((c) => c.slug)).toEqual([
      'electronics',
      'jewelery',
      'mens-clothing',
      'womens-clothing',
    ]);
  });
});

describe('GET /api/v1/categories/:slug', () => {
  it('returns 3 top rated and 3 more for electronics', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/categories/electronics');

    expect(res.statusCode).toBe(200);
    const body = categoryPageResponseSchema.parse(res.json());
    expect(body.category).toEqual({ slug: 'electronics', name: 'Electronics' });
    expect(body.topRated.map((p) => p.id)).toEqual([12, 11, 9]);
    expect(body.more).toHaveLength(3);
  });

  it('returns 404 NOT_FOUND "Category not found" for a valid but unknown slug', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/categories/nope');

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.body)).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Category not found',
      requestId: 'req-1',
    });
  });

  it.each(['Men%27s', 'A', 'a--b', '-x', 'x'.repeat(65)])(
    'returns 400 naming "slug" for the malformed slug %s, without calling the source',
    async (slug) => {
      const { app, source } = await setup();

      const res = await get(app, `/api/v1/categories/${slug}`);

      expect(res.statusCode).toBe(400);
      const error = errorOf(res.body);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect((error.details as { field: string }[]).map((d) => d.field)).toEqual(['slug']);
      expect(source.listCalls).toBe(0);
    },
  );
});

describe('GET /api/v1/products?q=', () => {
  it('finds a product by title and echoes the query', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products?q=backpack');

    expect(res.statusCode).toBe(200);
    const body = searchResponseSchema.parse(res.json());
    expect(body.query).toBe('backpack');
    expect(body.products.map((p) => p.id)).toContain(1);
  });

  it('returns an empty list with 200 when nothing matches', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products?q=zzzzzz');

    expect(res.statusCode).toBe(200);
    expect(res.json<{ products: unknown[] }>().products).toEqual([]);
  });

  it('trims the query it echoes back', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products?q=%20backpack%20');

    expect(res.json<{ query: string }>().query).toBe('backpack');
  });

  it.each([
    ['missing', '/api/v1/products', 'q'],
    ['blank', '/api/v1/products?q=', 'q'],
    ['whitespace only', '/api/v1/products?q=%20%20', 'q'],
    ['101 characters', `/api/v1/products?q=${'a'.repeat(101)}`, 'q'],
    ['containing a newline', '/api/v1/products?q=a%0Ab', 'q'],
    ['repeated', '/api/v1/products?q=a&q=b', 'q'],
    ['with an unknown parameter', '/api/v1/products?q=a&sort=price', 'request'],
  ])('rejects a %s query with 400 and never calls the source', async (_label, url, field) => {
    const { app, source } = await setup();

    const res = await get(app, url);

    expect(res.statusCode).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect((error.details as { field: string }[]).map((d) => d.field)).toEqual([field]);
    expect(source.listCalls).toBe(0);
  });

  it('does not echo an unknown parameter name in the error', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products?q=a&evil_param=1');

    expect(res.body).not.toContain('evil_param');
  });
});

describe('GET /api/v1/products/:id', () => {
  it('returns product 1 in the contract shape', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products/1');

    expect(res.statusCode).toBe(200);
    const { product } = productResponseSchema.parse(res.json());
    expect(product.id).toBe(1);
    expect(product.category.slug).toBe('mens-clothing');
  });

  it('returns 404 NOT_FOUND "Product not found" for an unknown id', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v1/products/9999');

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.body)).toMatchObject({ code: 'NOT_FOUND', message: 'Product not found' });
  });

  it.each(['abc', '0', '-1', '1e3', '007', '99999999999999999999', '1.5', '%20'])(
    'returns 400 naming "id" for the invalid id %s and never calls the source',
    async (id) => {
      const { app, source } = await setup();

      const res = await get(app, `/api/v1/products/${id}`);

      expect(res.statusCode).toBe(400);
      const error = errorOf(res.body);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect((error.details as { field: string }[]).map((d) => d.field)).toEqual(['id']);
      expect(source.findCalls).toEqual([]);
      expect(source.listCalls).toBe(0);
    },
  );
});

describe('catalogue failures use the shared envelope', () => {
  it('maps an UpstreamError to 502 without leaking the cause, logging one error line', async () => {
    const { app, source, logger } = await setup();
    source.failure = new UpstreamError({
      cause: new Error('connect ECONNREFUSED fakestore.test:443'),
    });

    const res = await get(app, '/api/v1/featured');

    expect(res.statusCode).toBe(502);
    expect(errorOf(res.body)).toMatchObject({ code: 'UPSTREAM_ERROR', requestId: 'req-1' });
    expect(res.body).not.toContain('fakestore.test');
    expect(logger.at('error')).toHaveLength(1);
  });

  it('maps an UpstreamTimeoutError to 504', async () => {
    const { app, source } = await setup();
    source.failure = new UpstreamTimeoutError();

    const res = await get(app, '/api/v1/products/1');

    expect(res.statusCode).toBe(504);
    expect(errorOf(res.body).code).toBe('UPSTREAM_TIMEOUT');
  });

  it.each(['/api/v1/categories', '/api/v1/categories/electronics', '/api/v1/products?q=a'])(
    'maps a source failure on %s to 502',
    async (url) => {
      const { app, source } = await setup();
      source.failure = new UpstreamError();

      expect((await get(app, url)).statusCode).toBe(502);
    },
  );
});

describe('routing boundaries', () => {
  it('answers POST to a catalogue route with the 404 envelope', async () => {
    const { app } = await setup();

    const res = await app.inject({ method: 'POST', url: '/api/v1/featured', payload: {} });

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });

  it('answers another API version with the 404 envelope', async () => {
    const { app } = await setup();

    const res = await get(app, '/api/v2/featured');

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
  });
});

describe('catalogue request logging', () => {
  it('logs the route pattern, not the raw path or query', async () => {
    const { app, capture } = await buildAppWithPinoLogger({}, { source: new FakeProductSource() });

    await app.inject({
      method: 'GET',
      url: '/api/v1/categories/electronics?token=secret',
      headers: { 'x-request-id': 'r-log' },
    });

    const line = capture.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({
      reqId: 'r-log',
      route: '/api/v1/categories/:slug',
      statusCode: 200,
    });
    expect(capture.text()).not.toContain('secret');
  });
});
