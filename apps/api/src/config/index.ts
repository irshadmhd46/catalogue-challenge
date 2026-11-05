import { PRODUCT_ID_PATTERN } from '@catalogue/contracts';
import { z } from 'zod';
import { ConfigError, type FieldIssue } from '../domain/errors.js';
import { LOG_LEVELS, type LogLevelName } from '../domain/logger.js';

const MAX_FEATURED_IDS = 10;

const boundedInt = (defaultValue: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

const httpBaseUrl = z.string().refine((raw) => {
  const url = parseUrl(raw);
  return (
    url !== undefined &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}, 'must be an http(s) URL without credentials, query or fragment');

const redisUrl = z.string().refine((raw) => {
  const url = parseUrl(raw);
  return url !== undefined && (url.protocol === 'redis:' || url.protocol === 'rediss:');
}, 'must be a redis: or rediss: URL');

const featuredIds = z.string().transform((raw, ctx) => {
  const parts = raw.split(',').map((part) => part.trim());
  const valid =
    parts.length <= MAX_FEATURED_IDS && parts.every((part) => PRODUCT_ID_PATTERN.test(part));
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      message: `must be at most ${String(MAX_FEATURED_IDS)} comma-separated positive whole numbers`,
    });
    return z.NEVER;
  }
  return parts.map(Number);
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1024).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    REQUEST_TIMEOUT_MS: boundedInt(10_000, 1, 120_000),
    BODY_LIMIT_BYTES: boundedInt(10_240, 1, 1_048_576),
    SHUTDOWN_TIMEOUT_MS: boundedInt(10_000, 1, 120_000),
    CATALOG_DRIVER: z.enum(['fakestore']).default('fakestore'),
    FAKESTORE_BASE_URL: httpBaseUrl.default('https://fakestoreapi.com'),
    UPSTREAM_TIMEOUT_MS: boundedInt(4000, 1, 30_000),
    UPSTREAM_DEADLINE_MS: boundedInt(10_000, 1, 60_000),
    UPSTREAM_MAX_RETRIES: boundedInt(2, 0, 5),
    CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: redisUrl.optional(),
    CACHE_FRESH_TTL_SECONDS: boundedInt(60, 1, 86_400),
    CACHE_STALE_TTL_SECONDS: boundedInt(3600, 0, 604_800),
    FEATURED_PRODUCT_IDS: featuredIds.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.FAKESTORE_BASE_URL.startsWith('https:')) {
      ctx.addIssue({
        code: 'custom',
        path: ['FAKESTORE_BASE_URL'],
        message: 'must use https in production',
      });
    }
    if (env.CACHE_DRIVER === 'redis' && env.REDIS_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'is required when CACHE_DRIVER is redis',
      });
    }
    if (env.UPSTREAM_DEADLINE_MS < env.UPSTREAM_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['UPSTREAM_DEADLINE_MS'],
        message: 'must not be shorter than UPSTREAM_TIMEOUT_MS',
      });
    }
  });

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevelName;
  readonly requestTimeoutMs: number;
  readonly bodyLimitBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly catalogDriver: 'fakestore';
  readonly fakestoreBaseUrl: string;
  readonly upstreamTimeoutMs: number;
  readonly upstreamDeadlineMs: number;
  readonly upstreamMaxRetries: number;
  readonly cacheDriver: 'memory' | 'redis';
  /** May carry credentials: never log it. */
  readonly redisUrl: string | undefined;
  readonly cacheFreshTtlSeconds: number;
  readonly cacheStaleTtlSeconds: number;
  readonly featuredProductIds: readonly number[];
}

/** The only function in the codebase that reads `process.env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(present);

  if (!parsed.success) {
    // One entry per variable: a bad value can trip both its own bound and a cross-field rule.
    const firstIssueByField = new Map<string, FieldIssue>();
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'environment');
      if (!firstIssueByField.has(field)) {
        firstIssueByField.set(field, { field, message: issue.message });
      }
    }
    const issues = [...firstIssueByField.values()];
    throw new ConfigError(issues, { cause: parsed.error });
  }

  const values = parsed.data;
  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    requestTimeoutMs: values.REQUEST_TIMEOUT_MS,
    bodyLimitBytes: values.BODY_LIMIT_BYTES,
    shutdownTimeoutMs: values.SHUTDOWN_TIMEOUT_MS,
    catalogDriver: values.CATALOG_DRIVER,
    fakestoreBaseUrl: values.FAKESTORE_BASE_URL,
    upstreamTimeoutMs: values.UPSTREAM_TIMEOUT_MS,
    upstreamDeadlineMs: values.UPSTREAM_DEADLINE_MS,
    upstreamMaxRetries: values.UPSTREAM_MAX_RETRIES,
    cacheDriver: values.CACHE_DRIVER,
    redisUrl: values.REDIS_URL,
    cacheFreshTtlSeconds: values.CACHE_FRESH_TTL_SECONDS,
    cacheStaleTtlSeconds: values.CACHE_STALE_TTL_SECONDS,
    featuredProductIds: Object.freeze(values.FEATURED_PRODUCT_IDS ?? []),
  });
}

/** Allowlist, so a secret added to the config later is not logged by default. */
export function describeConfig(config: AppConfig): Readonly<Record<string, unknown>> {
  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    logLevel: config.logLevel,
    catalogDriver: config.catalogDriver,
    cacheDriver: config.cacheDriver,
    upstreamHost: new URL(config.fakestoreBaseUrl).host,
  };
}
