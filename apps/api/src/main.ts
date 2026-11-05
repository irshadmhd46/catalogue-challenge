import { buildApp } from './app.js';
import { CatalogService } from './application/catalog-service.js';
import { bootstrap, type Composition } from './bootstrap.js';
import type { AppConfig } from './config/index.js';
import type { Cache } from './domain/cache.js';
import type { Logger } from './domain/logger.js';
import type { ProductSource } from './domain/product-source.js';
import { getRequestContext } from './http/request-context.js';
import { FakeStoreProductSource } from './infrastructure/catalog/fakestore-product-source.js';
import { CachedProductSource } from './infrastructure/cache/cached-product-source.js';
import { MemoryCache } from './infrastructure/cache/memory-cache.js';
import { createPinoLogger } from './infrastructure/logging/pino-logger.js';

// Composition root: the only place adapters are constructed.
function createCache(config: AppConfig): Cache {
  switch (config.cacheDriver) {
    case 'memory':
      return new MemoryCache();
    case 'redis':
      throw new Error('redis cache is wired in a later task');
  }
}

function createProductSource(config: AppConfig, logger: Logger, cache: Cache): ProductSource {
  switch (config.catalogDriver) {
    case 'fakestore':
      return new CachedProductSource({
        inner: new FakeStoreProductSource({
          baseUrl: config.fakestoreBaseUrl,
          timeoutMs: config.upstreamTimeoutMs,
          deadlineMs: config.upstreamDeadlineMs,
          maxRetries: config.upstreamMaxRetries,
          logger,
        }),
        cache,
        logger,
        freshSeconds: config.cacheFreshTtlSeconds,
        staleSeconds: config.cacheStaleTtlSeconds,
      });
  }
}

function compose(config: AppConfig, logger: Logger): Promise<Composition> {
  const source = createProductSource(config, logger, createCache(config));
  const catalogService = new CatalogService(source, logger, config.featuredProductIds);
  return Promise.resolve({ services: { catalogService }, closers: [] });
}

await bootstrap({
  env: process.env,
  proc: process,
  exit: (code) => process.exit(code),
  bootstrapLogger: createPinoLogger({ level: 'info', pretty: false }),
  createLogger: (config) =>
    createPinoLogger({
      level: config.logLevel,
      pretty: config.nodeEnv === 'development',
      getContext: getRequestContext,
    }),
  compose,
  buildApp,
});
