import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { CatalogService } from '../../src/application/catalog-service.js';
import { EnquiryService } from '../../src/application/enquiry-service.js';
import { loadConfig, type AppConfig } from '../../src/config/index.js';
import type { Logger } from '../../src/domain/logger.js';
import type { EnquiryNotifier } from '../../src/domain/enquiry-notifier.js';
import type { ProductSource } from '../../src/domain/product-source.js';
import type { RateLimiter } from '../../src/domain/rate-limiter.js';
import { getRequestContext } from '../../src/http/request-context.js';
import { createPinoLogger } from '../../src/infrastructure/logging/pino-logger.js';
import { MemoryRateLimiter } from '../../src/infrastructure/rate-limit/memory-rate-limiter.js';
import { FakeEnquiryNotifier } from './fake-enquiry-notifier.js';
import { FakeLogger } from './fake-logger.js';
import { FakeProductSource } from './fake-product-source.js';
import { captureLogs, type LogCapture } from './log-capture.js';

type ConfigOverrides = Partial<Record<string, string>>;

export interface CatalogueOptions {
  /** Defaults to a fake source holding the 20 recorded products. */
  readonly source?: ProductSource;
  readonly featuredProductIds?: readonly number[];
  /** Defaults to a memory limiter with the real clock. */
  readonly rateLimiter?: RateLimiter;
  /** Defaults to the fake returned as `notifier`. */
  readonly notifier?: EnquiryNotifier;
}

/** Valid version 4 UUIDs in a predictable order: ...0001, ...0002 */
function sequentialUuids(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`;
}

function enquiryServiceFor(
  catalogService: CatalogService,
  logger: Logger,
  notifier: EnquiryNotifier,
): EnquiryService {
  return new EnquiryService(
    catalogService,
    notifier,
    logger,
    sequentialUuids(),
    () => new Date('2026-11-06T10:00:00Z'),
  );
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
  /** What the enquiry service sends to, unless `options.notifier` replaced it. */
  readonly notifier: FakeEnquiryNotifier;
}

/** App wired to a recording fake logger: use for level and call assertions. */
export async function buildAppWithFakeLogger(
  overrides: ConfigOverrides = {},
  catalogue: CatalogueOptions = {},
): Promise<FakeLoggerApp> {
  const logger = new FakeLogger();
  const catalogService = catalogServiceFor(logger, catalogue);
  const notifier = new FakeEnquiryNotifier();
  const app = await buildApp({
    config: testConfig(overrides),
    logger,
    catalogService,
    enquiryService: enquiryServiceFor(catalogService, logger, catalogue.notifier ?? notifier),
    rateLimiter: catalogue.rateLimiter ?? new MemoryRateLimiter(),
  });
  return { app, logger, notifier };
}

export interface PinoLoggerApp {
  readonly app: FastifyInstance;
  readonly logger: Logger;
  readonly capture: LogCapture;
  readonly notifier: FakeEnquiryNotifier;
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
  const notifier = new FakeEnquiryNotifier();
  const app = await buildApp({
    config,
    logger,
    catalogService,
    enquiryService: enquiryServiceFor(catalogService, logger, catalogue.notifier ?? notifier),
    rateLimiter: catalogue.rateLimiter ?? new MemoryRateLimiter(),
  });
  return { app, logger, capture, notifier };
}
