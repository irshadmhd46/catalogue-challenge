import { z } from 'zod';
import { ConfigError, type FieldIssue } from '../domain/errors.js';
import { LOG_LEVELS, type LogLevelName } from '../domain/logger.js';

const positiveInt = (defaultValue: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1024).max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  REQUEST_TIMEOUT_MS: positiveInt(10_000, 120_000),
  BODY_LIMIT_BYTES: positiveInt(10_240, 1_048_576),
  SHUTDOWN_TIMEOUT_MS: positiveInt(10_000, 120_000),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevelName;
  readonly requestTimeoutMs: number;
  readonly bodyLimitBytes: number;
  readonly shutdownTimeoutMs: number;
}

/** The only function in the codebase that reads `process.env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(present);

  if (!parsed.success) {
    const issues: FieldIssue[] = parsed.error.issues.map((issue) => ({
      field: String(issue.path[0] ?? 'environment'),
      message: issue.message,
    }));
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
  });
}

/** Allowlist, so a secret added to the config later is not logged by default. */
export function describeConfig(config: AppConfig): Readonly<Record<string, unknown>> {
  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    logLevel: config.logLevel,
  };
}
