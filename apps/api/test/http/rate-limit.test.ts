import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheError } from '../../src/domain/errors.js';
import type { RateLimitResult, RateLimiter } from '../../src/domain/rate-limiter.js';
import { MemoryRateLimiter } from '../../src/infrastructure/rate-limit/memory-rate-limiter.js';
import { buildAppWithFakeLogger, buildAppWithPinoLogger } from '../support/build-test-app.js';

const CLIENT = '203.0.113.9';

/** Wraps a real limiter and records what the hook asked it. */
class SpyLimiter implements RateLimiter {
  readonly calls: { key: string; limit: number; windowSeconds: number }[] = [];
  failWith: Error | undefined;

  constructor(private readonly inner: RateLimiter) {}

  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    this.calls.push({ key, limit, windowSeconds });
    return this.failWith
      ? Promise.reject(this.failWith)
      : this.inner.consume(key, limit, windowSeconds);
  }
}

function setup(env: Record<string, string> = {}) {
  const clock = { ms: 10_000_000 };
  const limiter = new SpyLimiter(new MemoryRateLimiter(() => clock.ms));
  return { clock, limiter, env };
}

async function buildWithRoutes(env: Record<string, string> = {}) {
  const { clock, limiter } = setup();
  const built = await buildAppWithFakeLogger(env, { rateLimiter: limiter });
  const handled = { read: 0, enquiry: 0, open: 0 };
  built.app.get('/test/read', { config: { rateScope: 'read' } }, () => {
    handled.read += 1;
    return { ok: true };
  });
  built.app.post('/test/enquiry', { config: { rateScope: 'enquiry' } }, () => {
    handled.enquiry += 1;
    return { ok: true };
  });
  built.app.get('/test/open', () => {
    handled.open += 1;
    return { ok: true };
  });
  return { ...built, clock, limiter, handled };
}

type Built = Awaited<ReturnType<typeof buildWithRoutes>>;
const read = (app: Built['app'], remoteAddress = CLIENT, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/test/read', remoteAddress, headers });
const enquire = (app: Built['app'], remoteAddress = CLIENT, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: '/test/enquiry', remoteAddress, payload: payload as object });

describe('rate limit hook: what is counted', () => {
  it('counts a read route against read:<ip> with the read limit and a 60 s window', async () => {
    const { app, limiter } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '7' });

    await read(app);

    expect(limiter.calls).toEqual([{ key: `read:${CLIENT}`, limit: 7, windowSeconds: 60 }]);
  });

  it('counts an enquiry route against enquiry:<ip> with the enquiry limit', async () => {
    const { app, limiter } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '3' });

    await enquire(app);

    expect(limiter.calls).toEqual([{ key: `enquiry:${CLIENT}`, limit: 3, windowSeconds: 60 }]);
  });

  it('does not count a route without a scope', async () => {
    const { app, limiter, handled } = await buildWithRoutes();

    for (let i = 0; i < 20; i += 1) await app.inject({ method: 'GET', url: '/test/open' });

    expect(limiter.calls).toEqual([]);
    expect(handled.open).toBe(20);
  });

  it.each([
    ['/healthz', 200],
    ['/nope', 404],
    ['/api/v2/featured', 404],
    ['/%zz', 400],
  ])('never counts or limits %s even with a limit of 1', async (url, status) => {
    const { app, limiter } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '1' });

    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(status);
    }

    expect(limiter.calls).toEqual([]);
  });

  it('counts the catalogue routes in the read scope', async () => {
    const { app, limiter } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '9' });

    await app.inject({ method: 'GET', url: '/api/v1/featured', remoteAddress: CLIENT });
    await app.inject({ method: 'GET', url: '/api/v1/products/1', remoteAddress: CLIENT });

    expect(limiter.calls.map((c) => c.key)).toEqual([`read:${CLIENT}`, `read:${CLIENT}`]);
    expect(limiter.calls.every((c) => c.limit === 9)).toBe(true);
  });
});

describe('rate limit hook: headers and denial', () => {
  it('reports the limit and what remains on every counted response', async () => {
    const { app } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '5' });

    const first = await enquire(app);
    const second = await enquire(app);

    expect(first.statusCode).toBe(200);
    expect([first.headers['x-ratelimit-limit'], first.headers['x-ratelimit-remaining']]).toEqual([
      '5',
      '4',
    ]);
    expect(second.headers['x-ratelimit-remaining']).toBe('3');
  });

  it('answers the sixth enquiry in a window with a 429 in the shared envelope', async () => {
    const { app, handled } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '5' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await enquire(app)).statusCode);

    const denied = await app.inject({
      method: 'POST',
      url: '/test/enquiry',
      remoteAddress: CLIENT,
      headers: { 'x-request-id': 'rl-1' },
      payload: {},
    });

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(denied.statusCode).toBe(429);
    expect(denied.json<{ error: Record<string, unknown> }>().error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      requestId: 'rl-1',
    });
    expect(handled.enquiry).toBe(5);
  });

  it('tells the client when to retry and that nothing remains', async () => {
    const { app } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await enquire(app);

    const denied = await enquire(app);

    const retryAfter = Number(denied.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(denied.headers['x-ratelimit-remaining']).toBe('0');
    expect(denied.headers['x-ratelimit-limit']).toBe('1');
    expect(denied.headers['x-request-id']).toBeDefined();
  });

  it('counts down the retry time as the window passes', async () => {
    const { app, clock } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await enquire(app);
    clock.ms += 40_000;

    const denied = await enquire(app);

    expect(denied.headers['retry-after']).toBe('20');
  });

  it('accepts the same client again once the window has passed', async () => {
    const { app, clock } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await enquire(app);
    expect((await enquire(app)).statusCode).toBe(429);

    clock.ms += 60_001;

    expect((await enquire(app)).statusCode).toBe(200);
  });

  it('enforces the read limit on read routes', async () => {
    const { app, handled } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await read(app)).statusCode);

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(handled.read).toBe(3);
  });

  it('writes exactly one warn line per denial, with no client address', async () => {
    const { app, logger } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await enquire(app);

    await enquire(app);

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 });
    expect(JSON.stringify(logger.records)).not.toContain(CLIENT);
  });
});

describe('rate limit hook: who is counted together', () => {
  it('keeps the scopes apart: exhausting enquiries does not block reads, and the reverse', async () => {
    const { app } = await buildWithRoutes({
      RATE_LIMIT_ENQUIRY_PER_MINUTE: '1',
      RATE_LIMIT_READ_PER_MINUTE: '1',
    });
    await enquire(app);
    expect((await enquire(app)).statusCode).toBe(429);

    expect((await read(app)).statusCode).toBe(200);
    expect((await read(app)).statusCode).toBe(429);
    expect((await enquire(app)).statusCode).toBe(429);
  });

  it('keeps clients apart', async () => {
    const { app } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    await read(app, '203.0.113.9');
    expect((await read(app, '203.0.113.9')).statusCode).toBe(429);

    expect((await read(app, '198.51.100.7')).statusCode).toBe(200);
  });
});

describe('rate limit hook: rejected before the body is read', () => {
  it('answers 429 for an over-limit client posting broken JSON, never 400', async () => {
    const { app, handled } = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await enquire(app);

    const denied = await app.inject({
      method: 'POST',
      url: '/test/enquiry',
      remoteAddress: CLIENT,
      headers: { 'content-type': 'application/json' },
      payload: '{this is not json',
    });

    expect(denied.statusCode).toBe(429);
    expect(handled.enquiry).toBe(1);
  });

  it('answers 429 for an over-limit client posting an oversize body, never 413', async () => {
    const { app } = await buildWithRoutes({
      RATE_LIMIT_ENQUIRY_PER_MINUTE: '1',
      BODY_LIMIT_BYTES: '100',
    });
    await enquire(app);

    const denied = await app.inject({
      method: 'POST',
      url: '/test/enquiry',
      remoteAddress: CLIENT,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ filler: 'x'.repeat(500) }),
    });

    expect(denied.statusCode).toBe(429);
  });

  it('does not call the catalogue source for an over-limit client', async () => {
    const { app, handled } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    await read(app);

    await app.inject({ method: 'GET', url: '/api/v1/products/9999', remoteAddress: CLIENT });
    await app.inject({ method: 'GET', url: '/api/v1/products/9998', remoteAddress: CLIENT });

    expect(handled.read).toBe(1);
  });
});

describe('rate limit hook: when the store fails it fails open, loudly', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function failing() {
    const built = await buildWithRoutes({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    built.limiter.failWith = new CacheError({ cause: new Error('Command timed out') });
    return built;
  }

  it('handles the request normally', async () => {
    const { app, handled } = await failing();

    const res = await enquire(app);

    expect(res.statusCode).toBe(200);
    expect(handled.enquiry).toBe(1);
  });

  it('writes one error line naming the failure and the scope, with no client address', async () => {
    const { app, logger, limiter } = await failing();

    await enquire(app);

    expect(logger.at('error')).toHaveLength(1);
    expect(logger.at('error')[0]?.message).toBe('rate limiter store failed, allowing the request');
    expect(logger.at('error')[0]?.fields).toMatchObject({
      scope: 'enquiry',
      err: limiter.failWith,
    });
    expect(JSON.stringify(logger.records)).not.toContain(CLIENT);
  });

  it('adds no rate limit headers when the count is unknown', async () => {
    const { app } = await failing();

    const res = await enquire(app);

    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
    expect(res.headers).not.toHaveProperty('x-ratelimit-remaining');
  });

  it('logs 100 failures inside 30 s once, and again after 30 s', async () => {
    const { app, logger } = await failing();
    for (let i = 0; i < 100; i += 1) await enquire(app);
    expect(logger.at('error')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:29.999Z'));
    await enquire(app);
    expect(logger.at('error')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    await enquire(app);
    expect(logger.at('error')).toHaveLength(2);
  });

  it('recovers by itself when the store comes back', async () => {
    const { app, limiter } = await failing();
    await enquire(app);
    limiter.failWith = undefined;

    const first = await enquire(app);
    const second = await enquire(app);

    expect(first.headers['x-ratelimit-remaining']).toBe('0');
    expect(second.statusCode).toBe(429);
  });

  it('treats a non-CacheError failure the same way', async () => {
    const { app, limiter } = await failing();
    limiter.failWith = new TypeError('boom');

    expect((await enquire(app)).statusCode).toBe(200);
  });
});

describe('trustProxy: the client address', () => {
  const keyOf = async (
    env: Record<string, string>,
    remoteAddress: string,
    headers: Record<string, string>,
  ) => {
    const { app, limiter } = await buildWithRoutes(env);
    await read(app, remoteAddress, headers);
    return limiter.calls[0]?.key;
  };

  it('ignores X-Forwarded-For when no hops are trusted (the default)', async () => {
    expect(await keyOf({}, CLIENT, { 'x-forwarded-for': '1.2.3.4' })).toBe(`read:${CLIENT}`);
  });

  it('counts a spoofer rotating forwarded values as one client when no hops are trusted', async () => {
    const { app, handled } = await buildWithRoutes({ RATE_LIMIT_READ_PER_MINUTE: '2' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await read(app, CLIENT, { 'x-forwarded-for': `9.9.9.${String(i)}` })).statusCode,
      );
    }

    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(handled.read).toBe(2);
  });

  it('uses the forwarded address when one hop is trusted', async () => {
    expect(
      await keyOf({ TRUST_PROXY_HOPS: '1' }, '10.0.0.1', { 'x-forwarded-for': '198.51.100.7' }),
    ).toBe('read:198.51.100.7');
  });

  it('keeps forwarded clients behind one proxy in separate buckets', async () => {
    const { app } = await buildWithRoutes({
      TRUST_PROXY_HOPS: '1',
      RATE_LIMIT_READ_PER_MINUTE: '1',
    });
    await read(app, '10.0.0.1', { 'x-forwarded-for': '198.51.100.7' });

    expect((await read(app, '10.0.0.1', { 'x-forwarded-for': '198.51.100.7' })).statusCode).toBe(
      429,
    );
    expect((await read(app, '10.0.0.1', { 'x-forwarded-for': '198.51.100.8' })).statusCode).toBe(
      200,
    );
  });

  it('with one trusted hop a longer chain cannot choose the address: the nearest entry wins', async () => {
    expect(
      await keyOf({ TRUST_PROXY_HOPS: '1' }, '10.0.0.1', {
        'x-forwarded-for': '1.1.1.1, 203.0.113.9',
      }),
    ).toBe('read:203.0.113.9');
  });

  it('with two trusted hops the address two hops away is used', async () => {
    expect(
      await keyOf({ TRUST_PROXY_HOPS: '2' }, '10.0.0.1', {
        'x-forwarded-for': '9.9.9.9, 198.51.100.7',
      }),
    ).toBe('read:9.9.9.9');
  });

  it('falls back to the socket address when a trusted proxy sends no header', async () => {
    expect(await keyOf({ TRUST_PROXY_HOPS: '1' }, '10.0.0.1', {})).toBe('read:10.0.0.1');
  });

  it('never writes the client address to any log line, even when denying it', async () => {
    const { app, capture } = await buildAppWithPinoLogger({
      RATE_LIMIT_READ_PER_MINUTE: '1',
      LOG_LEVEL: 'debug',
    });
    app.get('/test/read', { config: { rateScope: 'read' } }, () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/test/read', remoteAddress: CLIENT });
    await app.inject({ method: 'GET', url: '/test/read', remoteAddress: CLIENT });
    await app.inject({ method: 'GET', url: '/nope', remoteAddress: CLIENT });

    expect(capture.text()).toContain('RATE_LIMITED');
    expect(capture.text()).not.toContain(CLIENT);
  });
});
