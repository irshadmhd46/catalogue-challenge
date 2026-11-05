import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap, type RunningApp } from '../src/bootstrap.js';
import { FakeLogger } from './support/fake-logger.js';

function setup(env: NodeJS.ProcessEnv, listenImpl: RunningApp['listen'] = () => Promise.resolve()) {
  const bootstrapLogger = new FakeLogger();
  const appLogger = new FakeLogger();
  const exit = vi.fn<(code: number) => void>();
  const listen = vi.fn(listenImpl);
  const close = vi.fn(() => Promise.resolve());
  const app: RunningApp = { listen, close };
  const buildApp = vi.fn(() => Promise.resolve(app));
  const createLogger = vi.fn(() => appLogger);
  const proc = new EventEmitter();
  const run = () => bootstrap({ env, proc, exit, bootstrapLogger, createLogger, buildApp });
  return { bootstrapLogger, appLogger, exit, listen, close, buildApp, createLogger, proc, run };
}

describe('bootstrap: invalid configuration', () => {
  it('logs fatal naming the variables, exits 1 and never builds or listens', async () => {
    const t = setup({ PORT: 'abc', LOG_LEVEL: 'verbose' });

    await t.run();

    expect(t.bootstrapLogger.at('fatal')).toHaveLength(1);
    expect(t.bootstrapLogger.at('fatal')[0]?.message).toBe('invalid configuration');
    expect(t.bootstrapLogger.at('fatal')[0]?.fields.variables).toEqual(['PORT', 'LOG_LEVEL']);
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(t.buildApp).not.toHaveBeenCalled();
    expect(t.listen).not.toHaveBeenCalled();
  });

  it('never writes the offending value to the log, including the error and its cause', async () => {
    const t = setup({ PORT: 'hunter2-secret' });

    await t.run();

    const err = t.bootstrapLogger.at('fatal')[0]?.fields.err as Error & { details?: unknown };
    const everything = JSON.stringify([
      t.bootstrapLogger.records.map((r) => r.message),
      err.message,
      err.stack,
      (err.cause as Error).message,
      (err.cause as Error).stack,
      err.details,
    ]);
    expect(everything).not.toContain('hunter2-secret');
  });
});

describe('bootstrap: startup', () => {
  it('listens on the configured host and port and logs the config summary', async () => {
    const t = setup({ HOST: '127.0.0.1', PORT: '4321' });

    await t.run();

    expect(t.listen).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.1', port: 4321 });
    expect(t.appLogger.at('info')).toHaveLength(1);
    expect(t.appLogger.at('info')[0]?.message).toBe('api started');
    expect(t.appLogger.at('info')[0]?.fields).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 4321,
      logLevel: 'info',
      catalogDriver: 'fakestore',
      cacheDriver: 'memory',
      upstreamHost: 'fakestoreapi.com',
    });
    expect(t.exit).not.toHaveBeenCalled();
  });

  it('passes the parsed config and the created logger to buildApp', async () => {
    const t = setup({ PORT: '4321' });

    await t.run();

    expect(t.buildApp).toHaveBeenCalledOnce();
    expect(t.buildApp).toHaveBeenCalledWith({
      config: expect.objectContaining({ port: 4321 }) as unknown,
      logger: t.appLogger,
    });
  });

  it('installs handlers so SIGTERM triggers a graceful shutdown that exits 0', async () => {
    const t = setup({});
    await t.run();

    t.proc.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => {
      expect(t.exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    expect(t.close).toHaveBeenCalledOnce();
  });

  it('listen failure (EADDRINUSE) -> fatal line with the error, exit 1', async () => {
    const failure = Object.assign(new Error('listen EADDRINUSE: address already in use'), {
      code: 'EADDRINUSE',
    });
    const t = setup({}, () => Promise.reject(failure));

    await t.run();

    expect(t.appLogger.at('fatal')).toHaveLength(1);
    expect(t.appLogger.at('fatal')[0]?.message).toBe('startup failed');
    expect(t.appLogger.at('fatal')[0]?.fields).toMatchObject({ err: failure });
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(t.appLogger.at('info')).toHaveLength(0);
  });

  it('buildApp failure -> fatal line, exit 1, no listen', async () => {
    const t = setup({});
    const failure = new Error('plugin boot failed');
    t.buildApp.mockRejectedValue(failure);

    await t.run();

    expect(t.appLogger.at('fatal')[0]?.fields).toMatchObject({ err: failure });
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(t.listen).not.toHaveBeenCalled();
  });
});
