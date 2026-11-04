import type { FastifyInstance } from 'fastify';

export const HEALTH_PATH = '/healthz';

/** Liveness only: answers without touching any dependency. */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get(HEALTH_PATH, () => ({ status: 'ok' }));
}
