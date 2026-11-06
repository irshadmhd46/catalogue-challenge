import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { RateLimitedError } from '../domain/errors.js';
import type { Logger } from '../domain/logger.js';
import type { RateLimiter } from '../domain/rate-limiter.js';

export type RateScope = 'read' | 'enquiry';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Routes opt in to a limit; a route without a scope is never counted. */
    rateScope?: RateScope;
  }
}

export const RATE_LIMIT_WINDOW_SECONDS = 60;
const STORE_FAILURE_LOG_INTERVAL_MS = 30_000;

export interface RateLimitOptions {
  readonly limiter: RateLimiter;
  readonly config: Pick<AppConfig, 'rateLimitEnquiryPerMinute' | 'rateLimitReadPerMinute'>;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * Counts each request on an opted-in route against `<scope>:<client ip>` before its body is read.
 * If the store fails the request is allowed (availability over strictness for a low-risk form) and
 * the failure is logged, at most once every 30 s so an outage cannot flood the log. The client
 * address is a key only: it is never logged.
 */
export function registerRateLimiting(app: FastifyInstance, options: RateLimitOptions): void {
  const { limiter, config, logger } = options;
  const now = options.now ?? Date.now;
  const limits: Record<RateScope, number> = {
    read: config.rateLimitReadPerMinute,
    enquiry: config.rateLimitEnquiryPerMinute,
  };
  let lastFailureLoggedAt: number | undefined;

  app.addHook('onRequest', async (request, reply) => {
    const scope = request.routeOptions.config?.rateScope;
    if (scope === undefined) {
      return;
    }

    let result;
    try {
      result = await limiter.consume(
        `${scope}:${request.ip}`,
        limits[scope],
        RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (err) {
      const current = now();
      if (
        lastFailureLoggedAt === undefined ||
        current - lastFailureLoggedAt >= STORE_FAILURE_LOG_INTERVAL_MS
      ) {
        lastFailureLoggedAt = current;
        logger.error({ err, scope }, 'rate limiter store failed, allowing the request');
      }
      return;
    }

    void reply.header('x-ratelimit-limit', String(result.limit));
    void reply.header('x-ratelimit-remaining', String(result.remaining));
    if (!result.allowed) {
      throw new RateLimitedError(result.retryAfterSeconds);
    }
  });
}
