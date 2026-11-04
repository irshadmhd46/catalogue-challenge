import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConfigError,
  NotFoundError,
  NotificationError,
  RateLimitedError,
  UpstreamError,
  UpstreamTimeoutError,
  ValidationError,
} from '../../src/domain/errors.js';
import { buildAppWithFakeLogger } from '../support/build-test-app.js';

const appErrors: readonly {
  readonly name: string;
  readonly make: () => AppError;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly { readonly field: string; readonly message: string }[];
}[] = [
  {
    name: 'ValidationError',
    make: () => new ValidationError(),
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Invalid request',
  },
  {
    name: 'NotFoundError',
    make: () => new NotFoundError('product', '42'),
    status: 404,
    code: 'NOT_FOUND',
    message: 'Product not found',
  },
  {
    name: 'RateLimitedError',
    make: () => new RateLimitedError(30),
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many requests',
  },
  {
    name: 'UpstreamError',
    make: () => new UpstreamError({ cause: new Error('connect ECONNREFUSED 10.0.0.9:443') }),
    status: 502,
    code: 'UPSTREAM_ERROR',
    message: 'Upstream service unavailable',
  },
  {
    name: 'UpstreamTimeoutError',
    make: () => new UpstreamTimeoutError(),
    status: 504,
    code: 'UPSTREAM_TIMEOUT',
    message: 'Upstream service timed out',
  },
  {
    name: 'NotificationError',
    make: () => new NotificationError(),
    status: 502,
    code: 'NOTIFICATION_FAILED',
    message: 'Could not send the message',
  },
  {
    name: 'ConfigError',
    make: () => new ConfigError([{ field: 'PORT', message: 'invalid' }]),
    status: 500,
    code: 'CONFIG_INVALID',
    message: 'Invalid configuration: PORT',
    details: [{ field: 'PORT', message: 'invalid' }],
  },
];

async function appThrowing(thrown: () => unknown, overrides: Record<string, string> = {}) {
  const built = await buildAppWithFakeLogger(overrides);
  built.app.get('/boom', () => {
    throw thrown();
  });
  return built;
}

async function bodyOf(app: FastifyInstance, url = '/boom') {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-request-id': 'req-1' } });
  return { res, body: res.json<{ error: Record<string, unknown> }>() };
}

describe('error handler: AppError mapping', () => {
  it.each(appErrors)('$name -> $status $code in the envelope', async (c) => {
    const { app } = await appThrowing(c.make);

    const { res, body } = await bodyOf(app);

    expect(res.statusCode).toBe(c.status);
    expect(res.headers['content-type']).toContain('application/json');
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toMatchObject({ code: c.code, message: c.message, requestId: 'req-1' });
    expect(res.headers['x-request-id']).toBe(body.error.requestId);
    if (c.details) {
      expect(body.error.details).toEqual(c.details);
    } else {
      expect(body.error).not.toHaveProperty('details');
    }
  });

  it('includes validation details', async () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    const { app } = await appThrowing(() => new ValidationError({ details }));

    const { res, body } = await bodyOf(app);

    expect(res.statusCode).toBe(400);
    expect(body.error.details).toEqual(details);
  });

  it('sets Retry-After on a RateLimitedError', async () => {
    const { app } = await appThrowing(() => new RateLimitedError(30));

    const { res } = await bodyOf(app);

    expect(res.headers['retry-after']).toBe('30');
  });

  it('does not set Retry-After for other errors', async () => {
    const { app } = await appThrowing(() => new UpstreamError());

    const { res } = await bodyOf(app);

    expect(res.headers).not.toHaveProperty('retry-after');
  });

  it('never leaks the cause into the response', async () => {
    const { app } = await appThrowing(
      () => new UpstreamError({ cause: new Error('connect ECONNREFUSED 10.0.0.9:443') }),
    );

    const { res } = await bodyOf(app);

    expect(res.body).not.toContain('10.0.0.9');
  });
});

describe('error handler: unexpected errors', () => {
  it('turns an unknown Error into a generic 500 without leaking it', async () => {
    const { app } = await appThrowing(() => new Error('db password is hunter2'));

    const { res, body } = await bodyOf(app);

    expect(res.statusCode).toBe(500);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(res.body).not.toContain('hunter2');
    expect(res.body).not.toContain('at ');
    expect(res.body).not.toContain('stack');
  });

  it('turns a thrown string into the same generic 500', async () => {
    const { app } = await appThrowing(() => 'plain string failure');

    const { res, body } = await bodyOf(app);

    expect(res.statusCode).toBe(500);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(res.body).not.toContain('plain string failure');
  });

  it('turns a rejected promise into the generic 500', async () => {
    const built = await buildAppWithFakeLogger();
    built.app.get('/boom', () => Promise.reject(new Error('async hunter2')));

    const { res, body } = await bodyOf(built.app);

    expect(res.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('hunter2');
  });
});

describe('error handler: framework client errors', () => {
  async function postApp(overrides: Record<string, string> = {}) {
    const built = await buildAppWithFakeLogger(overrides);
    built.app.post('/echo', (request) => ({ received: request.body }));
    return built;
  }

  it('malformed JSON -> 400 BAD_REQUEST without parser text', async () => {
    const { app } = await postApp();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: Record<string, unknown> }>().error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Bad request',
    });
    expect(res.body).not.toMatch(/JSON|token|position/i);
  });

  it('body over the limit -> 413 PAYLOAD_TOO_LARGE', async () => {
    const { app } = await postApp({ BODY_LIMIT_BYTES: '100' });

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ filler: 'x'.repeat(200) }),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: Record<string, unknown> }>().error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body too large',
    });
  });

  it('unsupported media type -> 415 BAD_REQUEST', async () => {
    const { app } = await postApp();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'data',
    });

    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: Record<string, unknown> }>().error.code).toBe('BAD_REQUEST');
  });
});

describe('error handler: unknown routes', () => {
  it('unknown path -> 404 NOT_FOUND envelope with request id', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'r-9' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: Record<string, unknown> }>().error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: 'r-9',
    });
  });

  it('unsupported method on a known path -> the 404 envelope', async () => {
    const { app } = await buildAppWithFakeLogger();

    const res = await app.inject({ method: 'DELETE', url: '/healthz' });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: Record<string, unknown> }>().error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route not found',
    });
  });
});

describe('error handler: logging', () => {
  it('logs a 4xx once at warn, without a stack or error object', async () => {
    const { app, logger } = await appThrowing(() => new ValidationError());

    await bodyOf(app);

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(logger.at('warn')[0]?.fields).not.toHaveProperty('err');
    expect(JSON.stringify(logger.at('warn')[0]?.fields)).not.toContain('stack');
    expect(logger.at('error')).toHaveLength(0);
  });

  it('logs a 5xx once at error with the error object and its cause chain', async () => {
    const cause = new Error('socket hang up');
    const { app, logger } = await appThrowing(() => new UpstreamError({ cause }));

    await bodyOf(app);

    expect(logger.at('error')).toHaveLength(1);
    const { err, code, statusCode } = logger.at('error')[0]?.fields as {
      err: Error;
      code: string;
      statusCode: number;
    };
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.cause).toBe(cause);
    expect({ code, statusCode }).toEqual({ code: 'UPSTREAM_ERROR', statusCode: 502 });
    expect(logger.at('warn')).toHaveLength(0);
  });

  it('logs an unknown error at error with the original error, not in the response', async () => {
    const original = new Error('db password is hunter2');
    const { app, logger } = await appThrowing(() => original);

    const { res } = await bodyOf(app);

    expect(logger.at('error')).toHaveLength(1);
    expect(logger.at('error')[0]?.fields).toMatchObject({ err: original, statusCode: 500 });
    expect(res.body).not.toContain('hunter2');
  });

  it('logs an unknown route once at warn with 404', async () => {
    const { app, logger } = await buildAppWithFakeLogger();

    await app.inject({ method: 'GET', url: '/nope' });

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(logger.at('error')).toHaveLength(0);
  });

  it('logs a framework 4xx once at warn', async () => {
    const built = await buildAppWithFakeLogger();
    built.app.post('/echo', () => ({}));

    await built.app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });

    expect(built.logger.at('warn')).toHaveLength(1);
    expect(built.logger.at('warn')[0]?.fields).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  });
});
