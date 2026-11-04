import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';

export interface RequestContext {
  readonly reqId: string;
  readonly method: string;
  readonly route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function contextOf(request: FastifyRequest): RequestContext {
  const route = request.routeOptions.url;
  return {
    reqId: request.id,
    method: request.method,
    ...(route === undefined ? {} : { route }),
  };
}
