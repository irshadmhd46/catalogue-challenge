import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/domain/errors.js';
import { buildAppWithFakeLogger, buildAppWithPinoLogger } from '../support/build-test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('framework errors raised before routing (malformed URL)', () => {
  it('returns the envelope with a request id and does not echo the path', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/%zz',
      headers: { 'x-request-id': 'r-bad' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: Record<string, unknown> }>().error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Bad request',
      requestId: 'r-bad',
    });
    expect(res.headers['x-request-id']).toBe('r-bad');
    expect(res.body).not.toContain('%zz');
    expect(res.body).not.toContain('FST_ERR');
  });

  it('generates a request id when none was supplied', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({ method: 'GET', url: '/%zz' });

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.json<{ error: { requestId: string } }>().error.requestId).toBe(
      res.headers['x-request-id'],
    );
  });

  it('logs exactly one warn line', async () => {
    const { app, logger } = await buildAppWithFakeLogger();

    await app.inject({ method: 'GET', url: '/%zz' });

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
    expect(logger.at('error')).toHaveLength(0);
  });
});

describe('error handler: log lines carry the request context', () => {
  it('a 4xx warn line has reqId, method and route', async () => {
    const { app, capture } = await buildAppWithPinoLogger();
    app.post('/echo', () => ({}));

    await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json', 'x-request-id': 'r-4xx' },
      payload: '{bad',
    });

    const line = capture.lines().find((l) => l.msg === 'request rejected');
    expect(line).toMatchObject({
      level: 40,
      reqId: 'r-4xx',
      method: 'POST',
      route: '/echo',
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
    expect(line).not.toHaveProperty('err');
  });

  it('a 5xx error line has the request context, the stack and the cause message', async () => {
    const { app, capture } = await buildAppWithPinoLogger();
    app.get('/boom', () => {
      throw new UpstreamError({ cause: new Error('socket hang up') });
    });

    await app.inject({ method: 'GET', url: '/boom', headers: { 'x-request-id': 'r-5xx' } });

    const line = capture.lines().find((l) => l.msg === 'request failed');
    expect(line).toMatchObject({
      level: 50,
      reqId: 'r-5xx',
      method: 'GET',
      route: '/boom',
      statusCode: 502,
      code: 'UPSTREAM_ERROR',
    });
    const err = line?.err as { stack: string; cause: { message: string } };
    expect(err.stack).toContain('UpstreamError');
    expect(err.cause.message).toBe('socket hang up');
  });

  it('a malformed URL warn line has the request id', async () => {
    const { app, capture } = await buildAppWithPinoLogger();

    await app.inject({ method: 'GET', url: '/%zz', headers: { 'x-request-id': 'r-url' } });

    const line = capture.lines().find((l) => l.msg === 'request rejected');
    expect(line).toMatchObject({ reqId: 'r-url', method: 'GET', statusCode: 400 });
  });
});

describe('error handler: only framework errors are client errors', () => {
  it.each([401, 404, 429])(
    'a plain error with statusCode %i is our failure -> 500 and an error log',
    async (statusCode) => {
      const { app, logger } = await buildAppWithFakeLogger();
      app.get('/boom', () => {
        throw Object.assign(new Error('upstream said no'), { statusCode });
      });

      const res = await app.inject({ method: 'GET', url: '/boom' });

      expect(res.statusCode).toBe(500);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
      expect(res.body).not.toContain('upstream said no');
      expect(logger.at('error')).toHaveLength(1);
      expect(logger.at('warn')).toHaveLength(0);
    },
  );
});
