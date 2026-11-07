import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../src/api/errors';
import {
  getCategoryPage,
  getFeatured,
  getProduct,
  searchProducts,
  sendEnquiry,
} from '../src/api/client';
import { shouldRetry } from '../src/api/queries';
import { errorBody, json, product, stubApi } from './support/api-stub';

afterEach(() => {
  vi.unstubAllGlobals();
});

const caught = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

describe('api client: requests', () => {
  it('asks for JSON on the versioned path and parses the body', async () => {
    const api = stubApi({ 'GET /api/v1/featured': () => json({ products: [product(1)] }) });

    const result = await getFeatured();

    expect(result.products).toHaveLength(1);
    const init = api.calls[0]?.init;
    expect(init?.headers).toEqual({ accept: 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('encodes the category slug, the product id and the search term', async () => {
    const api = stubApi({
      "GET /api/v1/categories/men's%20clothing%2F1": () =>
        json({ category: { slug: 'x', name: 'Men' }, topRated: [], more: [] }),
      'GET /api/v1/products/7': () => json({ product: product(7) }),
      'GET /api/v1/products?q=a%20b%26c%3Dd': () => json({ query: 'a b&c=d', products: [] }),
    });

    await getCategoryPage("men's clothing/1");
    await getProduct('7');
    await searchProducts('a b&c=d');

    expect(api.calls.map((c) => c.key)).toEqual([
      "GET /api/v1/categories/men's%20clothing%2F1",
      'GET /api/v1/products/7',
      'GET /api/v1/products?q=a%20b%26c%3Dd',
    ]);
  });

  it('posts an enquiry as JSON', async () => {
    const api = stubApi({
      'POST /api/v1/enquiries': () =>
        json({ enquiryId: '00000000-0000-4000-8000-000000000001', status: 'accepted' }, 202),
    });
    const enquiry = {
      productId: 7,
      name: 'Ann',
      email: 'ann@example.test',
      message: 'Is it in stock?',
    };

    const result = await sendEnquiry(enquiry);

    expect(result.status).toBe('accepted');
    const init = api.calls[0]?.init;
    expect(init?.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(init?.body).toBe(JSON.stringify(enquiry));
  });
});

describe('api client: failures never leave as raw fetch errors', () => {
  it('turns the error envelope into an ApiError with the request id and field details', async () => {
    stubApi({
      'GET /api/v1/products/9999': () =>
        json(
          errorBody('NOT_FOUND', 'Product not found', 'req-77', [{ field: 'id', message: 'bad' }]),
          404,
        ),
    });

    const error = (await caught(getProduct('9999'))) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Product not found',
      requestId: 'req-77',
      details: [{ field: 'id', message: 'bad' }],
    });
  });

  it('reads Retry-After on a 429', async () => {
    stubApi({
      'GET /api/v1/featured': () =>
        json(errorBody('RATE_LIMITED', 'Too many requests'), 429, { 'retry-after': '30' }),
    });

    const error = (await caught(getFeatured())) as ApiError;

    expect(error.retryAfterSeconds).toBe(30);
    expect(error.status).toBe(429);
  });

  it('does not invent a retry time when the header is missing or not a number', async () => {
    stubApi({
      'GET /api/v1/featured': () =>
        json(errorBody('RATE_LIMITED', 'Too many'), 429, { 'retry-after': 'tomorrow' }),
    });

    expect(((await caught(getFeatured())) as ApiError).retryAfterSeconds).toBeUndefined();
  });

  it('turns an HTML error page into INVALID_RESPONSE, keeping the request id header', async () => {
    stubApi({
      'GET /api/v1/featured': () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'x-request-id': 'req-5' },
        }),
    });

    const error = (await caught(getFeatured())) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'INVALID_RESPONSE', requestId: 'req-5' });
    expect(error.message).not.toContain('Bad Gateway');
  });

  it('turns a 200 with the wrong shape into INVALID_RESPONSE', async () => {
    stubApi({ 'GET /api/v1/featured': () => json({ products: [{ id: 'not-a-product' }] }) });

    expect(await caught(getFeatured())).toMatchObject({ status: 200, code: 'INVALID_RESPONSE' });
  });

  it('turns a 200 that is not JSON into INVALID_RESPONSE', async () => {
    stubApi({ 'GET /api/v1/featured': () => new Response('hello') });

    expect(await caught(getFeatured())).toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('turns a failed fetch into a NetworkError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const error = await caught(getFeatured());

    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  it('turns a timeout into a NetworkError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('timed out', 'TimeoutError')));

    expect(await caught(getFeatured())).toBeInstanceOf(NetworkError);
  });

  it('turns a body that fails to arrive into a NetworkError', async () => {
    const broken = new Response('x');
    vi.spyOn(broken, 'text').mockRejectedValue(new TypeError('network error'));
    vi.stubGlobal('fetch', () => Promise.resolve(broken));

    expect(await caught(getFeatured())).toBeInstanceOf(NetworkError);
  });
});

describe('read retry policy', () => {
  it.each([
    ['a network error', new NetworkError(), 0, true],
    ['a 500', new ApiError(500, 'X', 'x', undefined), 1, true],
    ['a 502', new ApiError(502, 'X', 'x', undefined), 0, true],
    ['a 503', new ApiError(503, 'X', 'x', undefined), 1, true],
    ['a 404', new ApiError(404, 'NOT_FOUND', 'x', undefined), 0, false],
    ['a 400', new ApiError(400, 'VALIDATION_ERROR', 'x', undefined), 0, false],
    ['a 429', new ApiError(429, 'RATE_LIMITED', 'x', undefined), 0, false],
    ['a 5xx after two failures', new ApiError(500, 'X', 'x', undefined), 2, false],
    ['a network error after two failures', new NetworkError(), 2, false],
    ['an unknown error', new Error('bug'), 0, false],
  ])('%s (failure %i) -> retry %s', (_label, error, failureCount, expected) => {
    expect(shouldRetry(failureCount, error)).toBe(expected);
  });
});
