import { CatalogService } from './application/catalog-service.js';
import type { Closer, Composition } from './bootstrap.js';
import type { AppConfig } from './config/index.js';
import type { Cache } from './domain/cache.js';
import { ConfigError } from './domain/errors.js';
import type { Logger } from './domain/logger.js';
import type { ProductSource } from './domain/product-source.js';
import { CachedProductSource } from './infrastructure/cache/cached-product-source.js';
import { MemoryCache } from './infrastructure/cache/memory-cache.js';
import {
  RedisCache,
  createRedisClient,
  describeRedisUrl,
  type RedisLike,
} from './infrastructure/cache/redis-cache.js';
import { FakeStoreProductSource } from './infrastructure/catalog/fakestore-product-source.js';

/** The only parts of the outside world the wiring touches, replaceable in tests. */
export interface ComposeDeps {
  readonly createRedis: (url: string) => RedisLike;
  readonly fetch?: typeof fetch;
}

const realDeps: ComposeDeps = { createRedis: createRedisClient };

async function createCache(
  config: AppConfig,
  logger: Logger,
  deps: ComposeDeps,
): Promise<{ cache: Cache; closers: Closer[] }> {
  switch (config.cacheDriver) {
    case 'memory':
      return { cache: new MemoryCache(), closers: [] };
    case 'redis': {
      // Config validation guarantees a URL for this driver.
      const url = config.redisUrl ?? '';
      const cache = new RedisCache(deps.createRedis(url), logger);
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

function createProductSource(
  config: AppConfig,
  logger: Logger,
  cache: Cache,
  deps: ComposeDeps,
): ProductSource {
  switch (config.catalogDriver) {
    case 'fakestore':
      return new CachedProductSource({
        inner: new FakeStoreProductSource({
          baseUrl: config.fakestoreBaseUrl,
          timeoutMs: config.upstreamTimeoutMs,
          deadlineMs: config.upstreamDeadlineMs,
          maxRetries: config.upstreamMaxRetries,
          logger,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
        cache,
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
export async function compose(
  config: AppConfig,
  logger: Logger,
  deps: ComposeDeps = realDeps,
): Promise<Composition> {
  const { cache, closers } = await createCache(config, logger, deps);
  const source = createProductSource(config, logger, cache, deps);
  const catalogService = new CatalogService(source, logger, config.featuredProductIds);
  return { services: { catalogService }, closers };
}
