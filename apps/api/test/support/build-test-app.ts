import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { CatalogService } from '../../src/application/catalog-service.js';
import { loadConfig, type AppConfig } from '../../src/config/index.js';
import type { Logger } from '../../src/domain/logger.js';
import type { ProductSource } from '../../src/domain/product-source.js';
import { getRequestContext } from '../../src/http/request-context.js';
import { createPinoLogger } from '../../src/infrastructure/logging/pino-logger.js';
import { FakeLogger } from './fake-logger.js';
import { FakeProductSource } from './fake-product-source.js';
import { captureLogs, type LogCapture } from './log-capture.js';

type ConfigOverrides = Partial<Record<string, string>>;

export interface CatalogueOptions {
  /** Defaults to a fake source holding the 20 recorded products. */
  readonly source?: ProductSource;
  readonly featuredProductIds?: readonly number[];
}

function catalogServiceFor(logger: Logger, options: CatalogueOptions): CatalogService {
  return new CatalogService(
    options.source ?? new FakeProductSource(),
    logger,
    options.featuredProductIds ?? [],
  );
}

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
  catalogue: CatalogueOptions = {},
): Promise<FakeLoggerApp> {
  const logger = new FakeLogger();
  const catalogService = catalogServiceFor(logger, catalogue);
  const app = await buildApp({ config: testConfig(overrides), logger, catalogService });
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
  catalogue: CatalogueOptions = {},
): Promise<PinoLoggerApp> {
  const capture = captureLogs();
  const config = testConfig(overrides);
  const logger = createPinoLogger({
    level: config.logLevel,
    pretty: false,
    destination: capture.stream,
    getContext: getRequestContext,
  });
  const catalogService = catalogServiceFor(logger, catalogue);
  const app = await buildApp({ config, logger, catalogService });
  return { app, logger, capture };
}
