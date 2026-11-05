import { buildApp } from './app.js';
import { CatalogService } from './application/catalog-service.js';
import { bootstrap, type Closer, type Composition } from './bootstrap.js';
import type { AppConfig } from './config/index.js';
import type { Cache } from './domain/cache.js';
import { ConfigError } from './domain/errors.js';
import type { Logger } from './domain/logger.js';
import type { ProductSource } from './domain/product-source.js';
import { getRequestContext } from './http/request-context.js';
import { FakeStoreProductSource } from './infrastructure/catalog/fakestore-product-source.js';
import { CachedProductSource } from './infrastructure/cache/cached-product-source.js';
import { MemoryCache } from './infrastructure/cache/memory-cache.js';
import {
  RedisCache,
  createRedisClient,
  describeRedisUrl,
} from './infrastructure/cache/redis-cache.js';
import { createPinoLogger } from './infrastructure/logging/pino-logger.js';

// Composition root: the only place adapters are constructed.
async function createCache(
  config: AppConfig,
  logger: Logger,
): Promise<{ cache: Cache; closers: Closer[] }> {
  switch (config.cacheDriver) {
    case 'memory':
      return { cache: new MemoryCache(), closers: [] };
    case 'redis': {
      // Config validation guarantees a URL for this driver.
      const url = config.redisUrl ?? '';
      const cache = new RedisCache(createRedisClient(url), logger);
      try {
        await cache.connect();
      } catch (cause) {
        // Fail fast: silently running without the shared cache would hide a deployment mistake.
        throw new ConfigError(
          [{ field: 'REDIS_URL', message: `Redis is not reachable at ${describeRedisUrl(url)}` }],
          { cause },
        );
      }
      logger.info({ host: describeRedisUrl(url) }, 'redis cache connected');
      return { cache, closers: [{ name: 'redis', close: () => cache.close() }] };
    }
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

async function compose(config: AppConfig, logger: Logger): Promise<Composition> {
  const { cache, closers } = await createCache(config, logger);
  const source = createProductSource(config, logger, cache);
  const catalogService = new CatalogService(source, logger, config.featuredProductIds);
  return { services: { catalogService }, closers };
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
