import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { buildAppWithFakeLogger, buildAppWithPinoLogger } from '../support/build-test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('GET /healthz', () => {
  it('returns 200 with exactly {"status":"ok"}', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
  });

  it('logs its access line at debug, not info', async () => {
    const { app, logger } = await buildAppWithFakeLogger();

    await app.inject({ method: 'GET', url: '/healthz' });

    expect(logger.at('debug').map((r) => r.message)).toEqual(['request completed']);
    expect(logger.at('info')).toHaveLength(0);
  });

  it('writes no access line at the info threshold', async () => {
    const { app, capture } = await buildAppWithPinoLogger({ LOG_LEVEL: 'info' });

    await app.inject({ method: 'GET', url: '/healthz' });

    expect(capture.lines()).toHaveLength(0);
  });
});

describe('access log', () => {
  it('logs other routes at info with status and duration', async () => {
    const { app, logger } = await buildAppWithFakeLogger();

    await app.inject({ method: 'GET', url: '/nope' });

    const completed = logger.at('info').filter((r) => r.message === 'request completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.fields).toMatchObject({ statusCode: 404 });
    expect(typeof completed[0]?.fields.durationMs).toBe('number');
  });

  it('carries reqId, method, route, statusCode and durationMs for a matched route', async () => {
    const { app, capture } = await buildAppWithPinoLogger({ LOG_LEVEL: 'debug' });
    app.get('/things/:id', () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/things/7', headers: { 'x-request-id': 'req-77' } });

    const line = capture.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({
      reqId: 'req-77',
      method: 'GET',
      route: '/things/:id',
      statusCode: 200,
    });
    expect(typeof line?.durationMs).toBe('number');
  });
});

describe('request id on responses', () => {
  it('echoes a valid supplied id', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'abc-123' },
    });

    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('generates a UUID when none is supplied', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it.each([
    ['contains a space', 'abc 123'],
    ['is longer than 64 characters', 'a'.repeat(65)],
  ])('replaces a supplied id that %s', async (_label, value) => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': value },
    });

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-request-id']).not.toBe(value);
  });

  it('is present on a 404 response and matches the envelope', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'abc-123' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.json<{ error: { requestId: string } }>().error.requestId).toBe('abc-123');
  });
});

describe('request context across layers', () => {
  it('puts the request id on a line logged after an await in a deeper layer', async () => {
    const { app, logger, capture } = await buildAppWithPinoLogger();
    const fakeService = {
      async work(): Promise<void> {
        await sleep(5);
        logger.info({ step: 'service' }, 'service finished');
      },
    };
    app.get('/work', async () => {
      await fakeService.work();
      return { done: true };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/work',
      headers: { 'x-request-id': 'r-1' },
    });

    const line = capture.lines().find((l) => l.step === 'service');
    expect(line).toMatchObject({ reqId: 'r-1', method: 'GET', route: '/work' });
    expect(line?.reqId).toBe(res.headers['x-request-id']);
  });

  it('keeps concurrent requests apart', async () => {
    const { app, logger, capture } = await buildAppWithPinoLogger();
    app.get('/slow/:ms', async (request) => {
      const { ms } = request.params as { ms: string };
      await sleep(Number(ms));
      logger.info({ who: ms }, 'finished');
      return {};
    });

    await Promise.all([
      app.inject({ method: 'GET', url: '/slow/30', headers: { 'x-request-id': 'req-slow' } }),
      app.inject({ method: 'GET', url: '/slow/5', headers: { 'x-request-id': 'req-fast' } }),
    ]);

    const pairs = capture
      .lines()
      .filter((l) => l.msg === 'finished')
      .map((l) => `${String(l.who)}=${String(l.reqId)}`)
      .sort();
    expect(pairs).toEqual(['30=req-slow', '5=req-fast']);
  });

  it('adds no request fields to lines logged outside a request', async () => {
    const { logger, capture } = await buildAppWithPinoLogger();

    logger.info('startup');

    expect(capture.lines()[0]).not.toHaveProperty('reqId');
  });
});

describe('HTTP hardening', () => {
  it.each([
    ['a 200 response', '/healthz', 200],
    ['a 404 response', '/nope', 404],
  ])('sends security headers on %s', async (_label, url, status) => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(status);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('does not enable CORS', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://example.test' },
    });

    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('answers a CORS preflight without allowing the origin', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: { origin: 'https://example.test', 'access-control-request-method': 'GET' },
    });

    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('applies bodyLimitBytes from configuration at the boundary', async () => {
    const { app } = await buildAppWithFakeLogger({ BODY_LIMIT_BYTES: '100' });
    app.post('/echo', (request) => ({ length: JSON.stringify(request.body).length }));
    const exactly = (bytes: number) => JSON.stringify({ a: 'x'.repeat(bytes - 8) });
    const post = (payload: string) =>
      app.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/json' },
        payload,
      });

    expect(Buffer.byteLength(exactly(100))).toBe(100);
    expect((await post(exactly(100))).statusCode).toBe(200);
    expect((await post(exactly(101))).statusCode).toBe(413);
  });
});
