import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/lifecycle.js';
import { buildAppWithFakeLogger } from './support/build-test-app.js';

// Loopback only: this is the one test that needs a real socket, because the claim under test
// ("in-flight requests finish, idle keep-alive connections do not stall close") is about sockets.
describe('shutdown with a real server on loopback', () => {
  it('lets an in-flight request finish before exit, and is not stalled by an idle keep-alive socket', async () => {
    const { app, logger } = await buildAppWithFakeLogger();
    app.get('/slow', async () => {
      await sleep(150);
      return { done: true };
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;

    // Leaves an idle keep-alive connection in the client pool.
    expect((await fetch(`${base}/healthz`)).status).toBe(200);

    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({ app, logger, exit, timeoutMs: 5_000 });

    const inFlight = fetch(`${base}/slow`);
    await sleep(30);
    const running = shutdown.run('SIGTERM');

    expect(exit).not.toHaveBeenCalled();
    const res = await inFlight;
    await running;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
