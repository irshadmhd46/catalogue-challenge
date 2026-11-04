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
    });
  });

  it('omits a field that is not on the allowlist', () => {
    const config = { ...loadConfig({}), smtpPassword: 'p4ss-word' } as AppConfig;

    const summary = describeConfig(config);

    expect(summary).not.toHaveProperty('smtpPassword');
    expect(JSON.stringify(summary)).not.toContain('p4ss-word');
  });
});
