import { describe, expect, it } from 'vitest';
import {
  AppError,
  CacheError,
  ConfigError,
  ERROR_CODES,
  NotFoundError,
  NotificationError,
  RateLimitedError,
  UpstreamError,
  UpstreamTimeoutError,
  ValidationError,
} from '../../src/domain/errors.js';

const cases: readonly {
  readonly name: string;
  readonly make: () => AppError;
  readonly code: string;
  readonly status: number;
}[] = [
  {
    name: 'ValidationError',
    make: () => new ValidationError(),
    code: 'VALIDATION_ERROR',
    status: 400,
  },
  {
    name: 'NotFoundError',
    make: () => new NotFoundError('product'),
    code: 'NOT_FOUND',
    status: 404,
  },
  {
    name: 'RateLimitedError',
    make: () => new RateLimitedError(30),
    code: 'RATE_LIMITED',
    status: 429,
  },
  { name: 'UpstreamError', make: () => new UpstreamError(), code: 'UPSTREAM_ERROR', status: 502 },
  {
    name: 'UpstreamTimeoutError',
    make: () => new UpstreamTimeoutError(),
    code: 'UPSTREAM_TIMEOUT',
    status: 504,
  },
  {
    name: 'NotificationError',
    make: () => new NotificationError(),
    code: 'NOTIFICATION_FAILED',
    status: 502,
  },
  {
    name: 'CacheError',
    make: () => new CacheError(),
    code: 'INTERNAL_ERROR',
    status: 500,
  },
  { name: 'ConfigError', make: () => new ConfigError([]), code: 'CONFIG_INVALID', status: 500 },
];

describe('AppError subclasses', () => {
  it.each(cases)(
    '$name -> code $code and status $status, operational',
    ({ make, code, status }) => {
      const error = make();

      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(status);
      expect(error.isOperational).toBe(true);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    },
  );

  it.each(cases)('$name -> name matches the class name', ({ make, name }) => {
    expect(make().name).toBe(name);
  });

  it('exposes every code once in ERROR_CODES', () => {
    const values = Object.values(ERROR_CODES);

    expect(new Set(values).size).toBe(values.length);
    for (const { code } of cases) {
      expect(values).toContain(code);
    }
  });

  it('preserves the original error as cause', () => {
    const original = new Error('socket hang up');

    const error = new UpstreamError({ cause: original });

    expect(error.cause).toBe(original);
  });

  it('keeps internal detail out of the public message', () => {
    const error = new UpstreamError({ cause: new Error('connect ECONNREFUSED db.internal:5432') });

    expect(error.publicMessage).not.toContain('db.internal');
    expect(error.message).not.toContain('db.internal');
  });

  it('carries field details on a ValidationError', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];

    const error = new ValidationError({ details });

    expect(error.httpStatus).toBe(400);
    expect(error.details).toEqual(details);
  });

  it('names the resource in a NotFoundError without details or the id', () => {
    const error = new NotFoundError('product', '42');

    expect(error.publicMessage).toBe('Product not found');
    expect(error.details).toBeUndefined();
    expect(error.publicMessage).not.toContain('42');
    expect(error.resource).toBe('product');
    expect(error.resourceId).toBe('42');
  });

  it('exposes retryAfterSeconds on a RateLimitedError', () => {
    expect(new RateLimitedError(30).retryAfterSeconds).toBe(30);
  });

  it('lists the offending variables on a ConfigError and nothing else', () => {
    const issues = [{ field: 'PORT', message: 'must be an integer between 1024 and 65535' }];

    const error = new ConfigError(issues);

    expect(error.details).toEqual(issues);
    expect(error.message).toContain('PORT');
  });

  it('hides the cause of a CacheError from the public message and keeps it as cause', () => {
    const cause = new Error('ECONNREFUSED redis.internal:6379');

    const error = new CacheError({ cause });

    expect(error.cause).toBe(cause);
    expect(error.publicMessage).toBe('Something went wrong');
    expect(error.message).not.toContain('redis.internal');
  });
});
