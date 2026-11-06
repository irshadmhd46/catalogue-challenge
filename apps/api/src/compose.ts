import { randomUUID } from 'node:crypto';
import { CatalogService } from './application/catalog-service.js';
import { EnquiryService } from './application/enquiry-service.js';
import type { Composition } from './bootstrap.js';
import type { AppConfig } from './config/index.js';
import type { Logger } from './domain/logger.js';
import type { ProductSource } from './domain/product-source.js';
import { CachedProductSource } from './infrastructure/cache/cached-product-source.js';
import { MemoryCache } from './infrastructure/cache/memory-cache.js';
import { FakeStoreProductSource } from './infrastructure/catalog/fakestore-product-source.js';
import {
  SmtpEnquiryNotifier,
  type MailTransport,
} from './infrastructure/mail/smtp-enquiry-notifier.js';
import type { SmtpTransportConfig } from './infrastructure/mail/smtp-transport.js';
import { MemoryRateLimiter } from './infrastructure/rate-limit/memory-rate-limiter.js';

/** The only parts of the outside world the wiring touches, replaceable in tests. */
export interface ComposeDeps {
  readonly createTransport: (config: SmtpTransportConfig) => MailTransport;
  readonly fetch?: typeof fetch;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

function createNotifier(config: AppConfig, deps: ComposeDeps): SmtpEnquiryNotifier {
  switch (config.notifierDriver) {
    case 'smtp':
      return new SmtpEnquiryNotifier(
        deps.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          tls: config.smtpTls,
          user: config.smtpUser,
          password: config.smtpPassword,
          timeoutMs: config.smtpTimeoutMs,
        }),
        { from: config.mailFrom, to: config.salesInbox, timeoutMs: config.smtpTimeoutMs },
      );
  }
}

function createProductSource(config: AppConfig, logger: Logger, deps: ComposeDeps): ProductSource {
  switch (config.catalogDriver) {
    case 'fakestore':
      return new CachedProductSource({
        inner: new FakeStoreProductSource({
          baseUrl: config.fakestoreBaseUrl,
          timeoutMs: config.upstreamTimeoutMs,
          maxRetries: config.upstreamMaxRetries,
          logger,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
        cache: new MemoryCache(),
        logger,
        freshSeconds: config.cacheFreshTtlSeconds,
        staleSeconds: config.cacheStaleTtlSeconds,
      });
  }
}

/**
 * The composition root: the one place that decides which adapters implement which ports.
 * `main.ts` only starts it, which keeps this file importable and testable.
 */
export function compose(
  config: AppConfig,
  logger: Logger,
  deps: ComposeDeps,
): Promise<Composition> {
  const catalogService = new CatalogService(
    createProductSource(config, logger, deps),
    logger,
    config.featuredProductIds,
  );

  const notifier = createNotifier(config, deps);
  const enquiryService = new EnquiryService(
    catalogService,
    notifier,
    logger,
    deps.newId ?? randomUUID,
    deps.now ?? (() => new Date()),
  );

  return Promise.resolve({
    services: { catalogService, enquiryService, rateLimiter: new MemoryRateLimiter() },
    closers: [{ name: 'smtp', close: () => Promise.resolve(notifier.close()) }],
  });
}
