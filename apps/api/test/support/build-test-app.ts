import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config/index.js';
import type { Logger } from '../../src/domain/logger.js';
import { getRequestContext } from '../../src/http/request-context.js';
import { createPinoLogger } from '../../src/infrastructure/logging/pino-logger.js';
import { FakeLogger } from './fake-logger.js';
import { captureLogs, type LogCapture } from './log-capture.js';

type ConfigOverrides = Partial<Record<string, string>>;

function testConfig(overrides: ConfigOverrides = {}): AppConfig {
  return loadConfig({ NODE_ENV: 'test', ...overrides });
}

export interface FakeLoggerApp {
  readonly app: FastifyInstance;
  readonly logger: FakeLogger;
}

/** App wired to a recording fake logger: use for level and call assertions. */
export async function buildAppWithFakeLogger(
  overrides: ConfigOverrides = {},
): Promise<FakeLoggerApp> {
  const logger = new FakeLogger();
  const app = await buildApp({ config: testConfig(overrides), logger });
  return { app, logger };
}

export interface PinoLoggerApp {
  readonly app: FastifyInstance;
  readonly logger: Logger;
  readonly capture: LogCapture;
}

/** App wired to the real pino adapter writing to memory: use for request-context assertions. */
export async function buildAppWithPinoLogger(
  overrides: ConfigOverrides = {},
): Promise<PinoLoggerApp> {
  const capture = captureLogs();
  const config = testConfig(overrides);
  const logger = createPinoLogger({
    level: config.logLevel,
    pretty: false,
    destination: capture.stream,
    getContext: getRequestContext,
  });
  const app = await buildApp({ config, logger });
  return { app, logger, capture };
}
