import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig, type AppConfig } from '../../src/config/index.js';
import { ConfigError } from '../../src/domain/errors.js';

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('loadConfig', () => {
  it('applies the documented defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      requestTimeoutMs: 10_000,
      bodyLimitBytes: 10_240,
      shutdownTimeoutMs: 10_000,
      catalogDriver: 'fakestore',
      fakestoreBaseUrl: 'https://fakestoreapi.com',
      upstreamTimeoutMs: 4000,
      upstreamDeadlineMs: 10_000,
      upstreamMaxRetries: 2,
      cacheDriver: 'memory',
      redisUrl: undefined,
      cacheFreshTtlSeconds: 60,
      cacheStaleTtlSeconds: 3600,
      featuredProductIds: [],
    });
  });

  it('lets explicit values override defaults and converts numbers', () => {
    const config = loadConfig({ PORT: '8080', LOG_LEVEL: 'debug', NODE_ENV: 'production' });

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
    expect(config.nodeEnv).toBe('production');
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ PORT: '', LOG_LEVEL: '' })).toMatchObject({ port: 3000, logLevel: 'info' });
  });

  it('returns an immutable object', () => {
    const config = loadConfig({});

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      // @ts-expect-error configuration properties are readonly
      config.port = 1;
    }).toThrow(TypeError);
    expect(config.port).toBe(3000);
  });

  it('reads process.env only through its default argument', () => {
    const original = process.env.PORT;
    process.env.PORT = '4321';
    try {
      expect(loadConfig().port).toBe(4321);
    } finally {
      if (original === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = original;
      }
    }
  });
});

describe('loadConfig failures', () => {
  it.each([
    ['non-numeric', 'abc'],
    ['below 1024', '80'],
    ['above 65535', '70000'],
    ['fractional', '3000.5'],
  ])('PORT %s -> ConfigError naming PORT', (_label, value) => {
    const error = configError({ PORT: value });

    expect(error.details?.map((issue) => issue.field)).toEqual(['PORT']);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(configError({ LOG_LEVEL: 'verbose' }).details?.map((issue) => issue.field)).toEqual([
      'LOG_LEVEL',
    ]);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(configError({ NODE_ENV: 'staging' }).details?.map((issue) => issue.field)).toEqual([
      'NODE_ENV',
    ]);
  });

  it.each(['REQUEST_TIMEOUT_MS', 'BODY_LIMIT_BYTES', 'SHUTDOWN_TIMEOUT_MS'])(
    '%s of zero -> ConfigError naming it',
    (name) => {
      expect(configError({ [name]: '0' }).details?.map((issue) => issue.field)).toEqual([name]);
    },
  );

  it.each([
    ['REQUEST_TIMEOUT_MS', '120000', '120001'],
    ['BODY_LIMIT_BYTES', '1048576', '1048577'],
    ['SHUTDOWN_TIMEOUT_MS', '120000', '120001'],
  ])('%s accepts its maximum %s and rejects %s', (name, atMax, overMax) => {
    expect(() => loadConfig({ [name]: atMax })).not.toThrow();
    expect(configError({ [name]: overMax }).details?.map((issue) => issue.field)).toEqual([name]);
  });

  it('reports each variable once even when a value breaks several rules', () => {
    expect(fieldsOf({ UPSTREAM_DEADLINE_MS: '0' })).toEqual(['UPSTREAM_DEADLINE_MS']);
  });

  it('reports several problems in one ConfigError', () => {
    const error = configError({ PORT: 'abc', LOG_LEVEL: 'verbose' });

    expect(error.details?.map((issue) => issue.field).sort()).toEqual(['LOG_LEVEL', 'PORT']);
  });

  it('gives every issue a rule description', () => {
    const error = configError({ PORT: 'abc' });

    expect(error.details?.[0]?.message.length).toBeGreaterThan(0);
  });

  it('never echoes the offending value', () => {
    const error = configError({ PORT: 'hunter2-secret', LOG_LEVEL: 'sup3r-secret' });

    const serialised = JSON.stringify({ message: error.message, details: error.details });
    expect(serialised).not.toContain('hunter2-secret');
    expect(serialised).not.toContain('sup3r-secret');
  });
});

describe('describeConfig', () => {
  it('summarises the allowlisted fields', () => {
    expect(describeConfig(loadConfig({ PORT: '8080' }))).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'info',
      catalogDriver: 'fakestore',
      cacheDriver: 'memory',
      upstreamHost: 'fakestoreapi.com',
    });
  });

  it('omits a field that is not on the allowlist', () => {
    const config = { ...loadConfig({}), smtpPassword: 'p4ss-word' } as AppConfig;

    const summary = describeConfig(config);

    expect(summary).not.toHaveProperty('smtpPassword');
    expect(JSON.stringify(summary)).not.toContain('p4ss-word');
  });
});

const REDIS = 'redis://cache.test:6379';
const fieldsOf = (env: Record<string, string>) => configError(env).details?.map((i) => i.field);

describe('loadConfig: catalogue, upstream and cache settings', () => {
  it('reads explicit values for every new setting', () => {
    const config = loadConfig({
      CATALOG_DRIVER: 'fakestore',
      FAKESTORE_BASE_URL: 'https://upstream.test/api',
      UPSTREAM_TIMEOUT_MS: '2500',
      UPSTREAM_DEADLINE_MS: '8000',
      UPSTREAM_MAX_RETRIES: '0',
      CACHE_DRIVER: 'redis',
      REDIS_URL: REDIS,
      CACHE_FRESH_TTL_SECONDS: '30',
      CACHE_STALE_TTL_SECONDS: '0',
    });

    expect(config).toMatchObject({
      fakestoreBaseUrl: 'https://upstream.test/api',
      upstreamTimeoutMs: 2500,
      upstreamDeadlineMs: 8000,
      upstreamMaxRetries: 0,
      cacheDriver: 'redis',
      redisUrl: REDIS,
      cacheFreshTtlSeconds: 30,
      cacheStaleTtlSeconds: 0,
    });
  });

  it('requires REDIS_URL when the cache driver is redis', () => {
    expect(fieldsOf({ CACHE_DRIVER: 'redis' })).toEqual(['REDIS_URL']);
  });

  it.each(['http://cache.test', 'cache.test:6379', 'not a url'])(
    'rejects REDIS_URL %j even with the memory driver',
    (url) => {
      expect(fieldsOf({ REDIS_URL: url })).toEqual(['REDIS_URL']);
    },
  );

  it('accepts rediss: URLs', () => {
    expect(loadConfig({ CACHE_DRIVER: 'redis', REDIS_URL: 'rediss://cache.test' }).redisUrl).toBe(
      'rediss://cache.test',
    );
  });

  it('ignores a valid REDIS_URL when the driver is memory', () => {
    const config = loadConfig({ CACHE_DRIVER: 'memory', REDIS_URL: REDIS });

    expect(config.cacheDriver).toBe('memory');
  });

  it('rejects an unknown cache or catalog driver', () => {
    expect(fieldsOf({ CACHE_DRIVER: 'memcached' })).toEqual(['CACHE_DRIVER']);
    expect(fieldsOf({ CATALOG_DRIVER: 'shopify' })).toEqual(['CATALOG_DRIVER']);
  });

  it('requires https for the upstream in production only', () => {
    const url = 'http://upstream.test';

    expect(fieldsOf({ NODE_ENV: 'production', FAKESTORE_BASE_URL: url })).toEqual([
      'FAKESTORE_BASE_URL',
    ]);
    expect(loadConfig({ NODE_ENV: 'development', FAKESTORE_BASE_URL: url }).fakestoreBaseUrl).toBe(
      url,
    );
    expect(
      loadConfig({ NODE_ENV: 'production', FAKESTORE_BASE_URL: 'https://upstream.test' })
        .fakestoreBaseUrl,
    ).toBe('https://upstream.test');
  });

  it.each([
    'not a url',
    'ftp://upstream.test',
    'https://user:pw@upstream.test',
    'https://upstream.test?x=1',
    'https://upstream.test#frag',
    'javascript:alert(1)',
  ])('rejects FAKESTORE_BASE_URL %j', (url) => {
    expect(fieldsOf({ FAKESTORE_BASE_URL: url })).toEqual(['FAKESTORE_BASE_URL']);
  });

  it('parses FEATURED_PRODUCT_IDS and trims spaces', () => {
    expect(loadConfig({ FEATURED_PRODUCT_IDS: '7, 2,15' }).featuredProductIds).toEqual([7, 2, 15]);
  });

  it('keeps the first occurrence when an id is repeated', () => {
    expect(loadConfig({ FEATURED_PRODUCT_IDS: '7,2,7,15,2' }).featuredProductIds).toEqual([
      7, 2, 15,
    ]);
  });

  it('accepts exactly ten featured ids', () => {
    const ten = Array.from({ length: 10 }, (_, i) => String(i + 1)).join(',');

    expect(loadConfig({ FEATURED_PRODUCT_IDS: ten }).featuredProductIds).toHaveLength(10);
  });

  it.each(['7,x', '0', '7,,2', '1,2,3,4,5,6,7,8,9,10,11', '-1', '1.5', '1e3', '1234567890'])(
    'rejects FEATURED_PRODUCT_IDS %j',
    (ids) => {
      expect(fieldsOf({ FEATURED_PRODUCT_IDS: ids })).toEqual(['FEATURED_PRODUCT_IDS']);
    },
  );

  it('freezes the featured list', () => {
    expect(Object.isFrozen(loadConfig({ FEATURED_PRODUCT_IDS: '1,2' }).featuredProductIds)).toBe(
      true,
    );
  });

  it.each([
    ['UPSTREAM_MAX_RETRIES', '5', '6', {}],
    ['UPSTREAM_TIMEOUT_MS', '30000', '30001', { UPSTREAM_DEADLINE_MS: '60000' }],
    ['UPSTREAM_DEADLINE_MS', '60000', '60001', {}],
    ['CACHE_FRESH_TTL_SECONDS', '86400', '86401', {}],
    ['CACHE_STALE_TTL_SECONDS', '604800', '604801', {}],
  ])('%s accepts its maximum %s and rejects %s', (name, atMax, overMax, companions) => {
    expect(() => loadConfig({ ...companions, [name]: atMax })).not.toThrow();
    expect(fieldsOf({ ...companions, [name]: overMax })).toEqual([name]);
  });

  it.each([
    ['UPSTREAM_TIMEOUT_MS', '0'],
    ['UPSTREAM_DEADLINE_MS', '0'],
    ['UPSTREAM_MAX_RETRIES', '-1'],
    ['CACHE_FRESH_TTL_SECONDS', '0'],
    ['CACHE_STALE_TTL_SECONDS', '-1'],
    ['UPSTREAM_MAX_RETRIES', '1.5'],
  ])('%s rejects %s', (name, value) => {
    expect(fieldsOf({ [name]: value })).toEqual([name]);
  });

  it('allows zero retries and a zero stale window', () => {
    const config = loadConfig({ UPSTREAM_MAX_RETRIES: '0', CACHE_STALE_TTL_SECONDS: '0' });

    expect(config.upstreamMaxRetries).toBe(0);
    expect(config.cacheStaleTtlSeconds).toBe(0);
  });

  it('rejects a deadline shorter than one attempt', () => {
    expect(fieldsOf({ UPSTREAM_TIMEOUT_MS: '5000', UPSTREAM_DEADLINE_MS: '1000' })).toEqual([
      'UPSTREAM_DEADLINE_MS',
    ]);
  });

  it('accepts a deadline equal to the attempt timeout', () => {
    expect(() =>
      loadConfig({ UPSTREAM_TIMEOUT_MS: '5000', UPSTREAM_DEADLINE_MS: '5000' }),
    ).not.toThrow();
  });

  it('never echoes credentials or values from the new settings', () => {
    const error = configError({
      REDIS_URL: 'http://user:topsecret@cache.test',
      FAKESTORE_BASE_URL: 'https://user:basicpw@upstream.test',
      FEATURED_PRODUCT_IDS: 'leakyvalue',
    });

    const serialised = JSON.stringify({ message: error.message, details: error.details });
    for (const secret of ['topsecret', 'basicpw', 'leakyvalue']) {
      expect(serialised).not.toContain(secret);
    }
  });
});

describe('describeConfig: catalogue fields', () => {
  it('shows the cache driver and upstream host but never the Redis URL', () => {
    const config = loadConfig({
      CACHE_DRIVER: 'redis',
      REDIS_URL: 'redis://user:topsecret@cache.test:6379',
      FAKESTORE_BASE_URL: 'https://upstream.test/api',
    });

    const summary = describeConfig(config);

    expect(summary).toMatchObject({ cacheDriver: 'redis', upstreamHost: 'upstream.test' });
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('topsecret');
    expect(serialised).not.toContain('cache.test');
  });
});
