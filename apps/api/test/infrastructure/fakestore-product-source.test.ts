import { describe, expect, it } from 'vitest';
import { UpstreamError, UpstreamTimeoutError } from '../../src/domain/errors.js';
import { FakeStoreProductSource } from '../../src/infrastructure/catalog/fakestore-product-source.js';
import { FakeLogger } from '../support/fake-logger.js';
import { upstreamProducts } from '../support/fixtures.js';

type Step = (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

/** Never answers; rejects with the signal's reason once it fires, like a real fetch. */
const hang: Step = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init.signal as AbortSignal;
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });

interface Options {
  steps: (Step | Response)[];
  maxRetries?: number;
  timeoutMs?: number;
  deadlineMs?: number;
  random?: number;
  baseUrl?: string;
  /** When true, every per-attempt signal is already aborted and the clock jumps by its timeout. */
  timeoutsFire?: boolean;
}

function setup(options: Options) {
  const logger = new FakeLogger();
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const timeoutRequests: number[] = [];
  let clock = 1000;
  const queue = [...options.steps];

  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const step = queue.shift();
    if (step === undefined) {
      throw new Error(`unexpected extra fetch call #${String(calls.length)} to ${url}`);
    }
    if (step instanceof Response) {
      return Promise.resolve(step);
    }
    try {
      return Promise.resolve(step(url, init ?? {}));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const source = new FakeStoreProductSource({
    baseUrl: options.baseUrl ?? 'https://upstream.test',
    timeoutMs: options.timeoutMs ?? 4000,
    deadlineMs: options.deadlineMs ?? 10_000,
    maxRetries: options.maxRetries ?? 2,
    logger,
    fetch: fakeFetch,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    random: () => options.random ?? 0.5,
    now: () => clock,
    timeoutSignal: (ms) => {
      timeoutRequests.push(ms);
      const controller = new AbortController();
      if (options.timeoutsFire) {
        clock += ms;
        controller.abort(new DOMException('The operation timed out', 'TimeoutError'));
      }
      return controller.signal;
    },
  });

  return { source, logger, calls, sleeps, timeoutRequests, remaining: () => queue.length };
}

const fixture = () => upstreamProducts();

describe('FakeStoreProductSource: success', () => {
  it('lists and maps the products', async () => {
    const { source } = setup({ steps: [json(fixture())] });

    const products = await source.listProducts();

    expect(products).toHaveLength(20);
    expect(products[0]).toMatchObject({ id: 1, category: { slug: 'mens-clothing' } });
    expect(products[0]).not.toHaveProperty('image');
  });

  it('finds one product by id', async () => {
    const product7 = fixture().find((p) => p.id === 7);
    const { source } = setup({ steps: [json(product7)] });

    const found = await source.findProduct(7);

    expect(found).toMatchObject({ id: 7, category: { slug: 'jewelery' } });
  });

  it('sends a GET to the product path with the safe request options', async () => {
    const { source, calls } = setup({ steps: [json(fixture().find((p) => p.id === 7))] });

    await source.findProduct(7);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://upstream.test/products/7');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.headers).toEqual({ accept: 'application/json' });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('requests the list path without an id', async () => {
    const { source, calls } = setup({ steps: [json(fixture())] });

    await source.listProducts();

    expect(calls[0]?.url).toBe('https://upstream.test/products');
  });

  it.each([
    ['https://upstream.test/api', 'https://upstream.test/api/products'],
    ['https://upstream.test/api/', 'https://upstream.test/api/products'],
    ['https://upstream.test/', 'https://upstream.test/products'],
  ])('keeps the base path of %s', async (baseUrl, expected) => {
    const { source, calls } = setup({ baseUrl, steps: [json(fixture())] });

    await source.listProducts();

    expect(calls[0]?.url).toBe(expected);
  });

  it('asks for a per-attempt timeout equal to the configured timeout', async () => {
    const { source, timeoutRequests } = setup({ timeoutMs: 2500, steps: [json(fixture())] });

    await source.listProducts();

    expect(timeoutRequests).toEqual([2500]);
  });

  it('rejects an id that is not a positive integer without calling fetch', async () => {
    const { source, calls } = setup({ steps: [] });

    for (const id of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
      await expect(source.findProduct(id)).rejects.toBeInstanceOf(RangeError);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('FakeStoreProductSource: not found', () => {
  it('treats an empty 200 body as no such product', async () => {
    const { source, calls } = setup({ steps: [text('', 200)] });

    expect(await source.findProduct(9999)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('treats a whitespace-only 200 body as no such product', async () => {
    const { source } = setup({ steps: [text('  \n', 200)] });

    expect(await source.findProduct(9999)).toBeUndefined();
  });

  it('treats a 404 as no such product, with a single call', async () => {
    const { source, calls } = setup({ steps: [json({ error: 'nope' }, 404)] });

    expect(await source.findProduct(9999)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('rejects an empty body for the list as an UpstreamError', async () => {
    const { source } = setup({ steps: [text('', 200)] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
  });

  it('rejects a 404 on the list as a non-retried UpstreamError', async () => {
    const { source, calls } = setup({ steps: [json({}, 404)] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
  });

  it('rejects a response for a different product id (cache poisoning guard)', async () => {
    const other = fixture().find((p) => p.id === 8);
    const { source } = setup({ steps: [json(other)] });

    await expect(source.findProduct(7)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('FakeStoreProductSource: retries', () => {
  it('retries a 503 and returns the next success', async () => {
    const { source, calls, sleeps } = setup({ steps: [json({}, 503), json(fixture())] });

    const products = await source.listProducts();

    expect(products).toHaveLength(20);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it('gives up after exactly maxRetries + 1 attempts with an UpstreamError', async () => {
    const { source, calls, sleeps } = setup({
      maxRetries: 2,
      steps: [json({}, 500), json({}, 500), json({}, 500)],
    });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamError);
    expect(failure).not.toBeInstanceOf(UpstreamTimeoutError);
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry at all when maxRetries is 0', async () => {
    const { source, calls, sleeps } = setup({ maxRetries: 0, steps: [json({}, 500)] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('keeps the last failure as the cause', async () => {
    const { source } = setup({ maxRetries: 0, steps: [json({}, 502)] });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect((failure as Error).cause).toBeInstanceOf(Error);
    expect(((failure as Error).cause as Error).message).toContain('502');
  });

  it('backs off with jitter: 100 ms then 200 ms at random 0.5', async () => {
    const { source, sleeps } = setup({
      random: 0.5,
      steps: [json({}, 500), json({}, 500), json(fixture())],
    });

    await source.listProducts();

    expect(sleeps).toEqual([100, 200]);
  });

  it('applies full jitter: random 0 gives no delay', async () => {
    const { source, sleeps } = setup({ random: 0, steps: [json({}, 500), json(fixture())] });

    await source.listProducts();

    expect(sleeps).toEqual([0]);
  });

  it('caps the backoff at 1500 ms', async () => {
    const { source, sleeps } = setup({
      maxRetries: 5,
      random: 1,
      deadlineMs: 60_000,
      steps: [
        json({}, 500),
        json({}, 500),
        json({}, 500),
        json({}, 500),
        json({}, 500),
        json(fixture()),
      ],
    });

    await source.listProducts();

    expect(sleeps).toEqual([200, 400, 800, 1500, 1500]);
  });

  it('honours Retry-After in seconds on a 429', async () => {
    const { source, sleeps } = setup({
      steps: [json({}, 429, { 'retry-after': '1' }), json(fixture())],
    });

    await source.listProducts();

    expect(sleeps).toEqual([1000]);
  });

  it('caps a long Retry-After at 1500 ms', async () => {
    const { source, sleeps } = setup({
      steps: [json({}, 503, { 'retry-after': '120' }), json(fixture())],
    });

    await source.listProducts();

    expect(sleeps).toEqual([1500]);
  });

  it('ignores a Retry-After it cannot parse and falls back to jittered backoff', async () => {
    const { source, sleeps } = setup({
      random: 0.5,
      steps: [json({}, 429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), json(fixture())],
    });

    await source.listProducts();

    expect(sleeps).toEqual([100]);
  });

  it('retries a network error', async () => {
    const { source, calls } = setup({
      steps: [
        () => {
          throw new TypeError('fetch failed');
        },
        json(fixture()),
      ],
    });

    expect(await source.listProducts()).toHaveLength(20);
    expect(calls).toHaveLength(2);
  });

  it('turns exhausted network errors into an UpstreamError with the cause', async () => {
    const boom = new TypeError('fetch failed');
    const { source } = setup({
      maxRetries: 1,
      steps: [
        () => {
          throw boom;
        },
        () => {
          throw boom;
        },
      ],
    });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamError);
    expect(failure).not.toBeInstanceOf(UpstreamTimeoutError);
    expect((failure as Error).cause).toBe(boom);
  });
});

describe('FakeStoreProductSource: failures that are not retried', () => {
  it.each([400, 401, 403, 301, 302])(
    'status %i -> UpstreamError after one call',
    async (status) => {
      const { source, calls, sleeps } = setup({ steps: [json({}, status)] });

      await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    },
  );

  it('invalid JSON -> UpstreamError after one call', async () => {
    const { source, calls } = setup({ steps: [text('not json')] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
  });

  it('a JSON object instead of an array -> UpstreamError', async () => {
    const { source } = setup({ steps: [json({ products: [] })] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
  });

  it('one product missing rating -> UpstreamError and no partial list', async () => {
    const list: Record<string, unknown>[] = fixture().map((p) => ({ ...p }));
    delete list[3]?.rating;
    const { source, calls } = setup({ steps: [json(list)] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
  });

  it('a single product with the wrong shape -> UpstreamError', async () => {
    const { source } = setup({ steps: [json({ id: 7, title: 'x' })] });

    await expect(source.findProduct(7)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('a valid body larger than 1 MiB is rejected (only the size cap can reject it)', async () => {
    const padded = `${JSON.stringify(fixture())}${' '.repeat(1024 * 1024)}`;
    const { source, calls } = setup({ steps: [text(padded)] });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
  });

  it('a valid body just under 1 MiB is accepted', async () => {
    const padded = `${JSON.stringify(fixture())}${' '.repeat(1024 * 1024 - 20_000)}`;
    const { source } = setup({ steps: [text(padded)] });

    expect(await source.listProducts()).toHaveLength(20);
  });

  it('a declared content-length over 1 MiB is rejected', async () => {
    const { source } = setup({
      steps: [text(JSON.stringify(fixture()), 200, { 'content-length': String(2 * 1024 * 1024) })],
    });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('FakeStoreProductSource: timeouts and the total deadline', () => {
  it('maps timeouts on every attempt to an UpstreamTimeoutError', async () => {
    const { source, calls } = setup({
      timeoutsFire: true,
      deadlineMs: 60_000,
      steps: [hang, hang, hang],
    });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamTimeoutError);
    expect(calls).toHaveLength(3);
  });

  it('retries a timeout and succeeds on the next attempt', async () => {
    let first = true;
    const { source, calls } = setup({
      steps: [
        (url, init) => {
          if (first) {
            first = false;
            const controller = new AbortController();
            controller.abort(new DOMException('timed out', 'TimeoutError'));
            return hang(url, { ...init, signal: controller.signal });
          }
          return json(fixture());
        },
        json(fixture()),
      ],
    });

    expect(await source.listProducts()).toHaveLength(20);
    expect(calls).toHaveLength(2);
  });

  it('shrinks each attempt timeout to the remaining deadline and stops starting attempts', async () => {
    const { source, calls, timeoutRequests } = setup({
      timeoutsFire: true,
      timeoutMs: 4000,
      deadlineMs: 6000,
      maxRetries: 2,
      random: 0,
      steps: [hang, hang, hang],
    });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamTimeoutError);
    expect(calls.length).toBeLessThan(3);
    expect(timeoutRequests).toEqual([4000, 2000]);
  });

  it('does not start a retry when the deadline is already spent', async () => {
    const { source, calls } = setup({
      timeoutsFire: true,
      timeoutMs: 5000,
      deadlineMs: 5000,
      random: 0,
      steps: [hang, hang],
    });

    await expect(source.listProducts()).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(calls).toHaveLength(1);
  });

  it('an error after a timeout reports the last failure kind', async () => {
    const { source } = setup({
      maxRetries: 1,
      steps: [
        (url, init) => {
          const controller = new AbortController();
          controller.abort(new DOMException('timed out', 'TimeoutError'));
          return hang(url, { ...init, signal: controller.signal });
        },
        json({}, 500),
      ],
    });

    const failure = await source.listProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamError);
    expect(failure).not.toBeInstanceOf(UpstreamTimeoutError);
  });
});

describe('FakeStoreProductSource: logging', () => {
  it('logs one debug line per successful attempt with host, status, attempt and duration', async () => {
    const { source, logger } = setup({ steps: [json(fixture())] });

    await source.listProducts();

    expect(logger.records).toHaveLength(1);
    expect(logger.at('debug')).toHaveLength(1);
    expect(logger.at('debug')[0]?.fields).toMatchObject({
      target: 'upstream.test',
      status: 200,
      attempt: 1,
    });
    expect(typeof logger.at('debug')[0]?.fields.durationMs).toBe('number');
  });

  it('logs one warn per retry with attempt, reason and delay', async () => {
    const { source, logger } = setup({
      random: 0.5,
      steps: [json({}, 503), json(fixture())],
    });

    await source.listProducts();

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({
      target: 'upstream.test',
      attempt: 1,
      reason: 'http_503',
      delayMs: 100,
    });
    expect(logger.at('debug').map((r) => r.fields.attempt)).toEqual([1, 2]);
  });

  it('labels network errors and timeouts distinctly', async () => {
    const { source, logger } = setup({
      steps: [
        () => {
          throw new TypeError('fetch failed');
        },
        json(fixture()),
      ],
    });

    await source.listProducts();

    expect(logger.at('warn')[0]?.fields).toMatchObject({ reason: 'network_error' });
  });

  it('does not log an error when every attempt fails (the central handler logs it)', async () => {
    const { source, logger } = setup({
      maxRetries: 1,
      steps: [json({}, 500), json({}, 500)],
    });

    await source.listProducts().catch(() => undefined);

    expect(logger.at('error')).toHaveLength(0);
    expect(logger.at('fatal')).toHaveLength(0);
  });

  it('never logs the full URL, the body or credentials', async () => {
    const { source, logger } = setup({
      baseUrl: 'https://upstream.test/secret-prefix',
      steps: [json({}, 500), json(fixture())],
    });

    await source.listProducts();

    const everything = JSON.stringify(logger.records);
    expect(everything).not.toContain('secret-prefix');
    expect(everything).not.toContain('https://');
    expect(everything).not.toContain('Fjallraven');
  });
});
