import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CatalogService } from './application/catalog-service.js';
import type { AppConfig } from './config/index.js';
import type { Logger } from './domain/logger.js';
import { registerCatalogueRoutes } from './http/catalogue-routes.js';
import { createErrorHandler, registerErrorHandling } from './http/error-handler.js';
import { HEALTH_PATH, registerHealthRoute } from './http/health.js';
import { contextOf, runWithRequestContext } from './http/request-context.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './http/request-id.js';

// Above the 60 s idle timeout of common load balancers, so they never reuse a closed socket.
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly catalogService: CatalogService;
}

export async function buildApp({
  config,
  logger,
  catalogService,
}: AppDependencies): Promise<FastifyInstance> {
  const handleError = createErrorHandler(logger);
  const app = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    forceCloseConnections: 'idle',
    frameworkErrors: handleError,
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
  });

  await app.register(helmet);

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    runWithRequestContext(contextOf(request), done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    const level = request.routeOptions.url === HEALTH_PATH ? 'debug' : 'info';
    runWithRequestContext(contextOf(request), () => {
      logger[level](
        { statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) },
        'request completed',
      );
    });
    done();
  });

  // Responses finished while closing must end their keep-alive socket, otherwise close() waits
  // for keepAliveTimeout: Fastify only reaps sockets that are idle at the moment close() starts.
  let closing = false;
  app.addHook('preClose', (done) => {
    closing = true;
    done();
  });
  app.addHook('onSend', (_request, reply, payload, done) => {
    if (closing) {
      void reply.header('connection', 'close');
    }
    done(null, payload);
  });

  registerErrorHandling(app, handleError);
  registerHealthRoute(app);
  registerCatalogueRoutes(app, catalogService);

  return app;
}
