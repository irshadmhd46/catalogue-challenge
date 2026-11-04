import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShutdown, installProcessHandlers } from '../src/lifecycle.js';
import { FakeLogger } from './support/fake-logger.js';

const TIMEOUT_MS = 10_000;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const logger = new FakeLogger();
  const exit = vi.fn<(code: number) => void>();
  const calls: string[] = [];
  const app = {
    close: vi.fn(() => {
      calls.push('server');
      return Promise.resolve();
    }),
  };
  const shutdown = createShutdown({ app, logger, exit, timeoutMs: TIMEOUT_MS });
  return { logger, exit, calls, app, shutdown };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdown', () => {
  it('closes the server first, then closers in reverse registration order, then exits 0', async () => {
    const { shutdown, calls, exit, logger } = setup();
    shutdown.registerCloser('redis', () => {
      calls.push('redis');
      return Promise.resolve();
    });
    shutdown.registerCloser('smtp', () => {
      calls.push('smtp');
      return Promise.resolve();
    });

    await shutdown.run('SIGTERM');

    expect(calls).toEqual(['server', 'smtp', 'redis']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(logger.at('info').map((r) => r.message)).toEqual([
      'shutdown started',
      'shutdown completed',
    ]);
    expect(logger.at('info')[0]?.fields).toMatchObject({ signal: 'SIGTERM' });
  });

  it('clears the hard timeout after a clean shutdown', async () => {
    const { shutdown, exit } = setup();

    await shutdown.run('SIGTERM');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);

    expect(vi.getTimerCount()).toBe(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('waits for in-flight requests (server close) before exiting', async () => {
    const { shutdown, exit, app } = setup();
    const inFlight = deferred();
    app.close.mockImplementation(() => inFlight.promise);

    const running = shutdown.run('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).not.toHaveBeenCalled();

    inFlight.resolve();
    await running;

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('ignores a second signal while shutting down, with a warning', async () => {
    const { shutdown, exit, logger, app } = setup();
    const inFlight = deferred();
    app.close.mockImplementation(() => inFlight.promise);

    const first = shutdown.run('SIGTERM');
    await shutdown.run('SIGINT');
    inFlight.resolve();
    await first;

    expect(logger.at('warn').map((r) => r.message)).toEqual(['shutdown already in progress']);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ signal: 'SIGINT' });
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('keeps running the remaining closers when one fails, then exits 1', async () => {
    const { shutdown, calls, exit, logger } = setup();
    const failure = new Error('redis quit failed');
    shutdown.registerCloser('redis', () => {
      calls.push('redis');
      return Promise.resolve();
    });
    shutdown.registerCloser('smtp', () => Promise.reject(failure));

    await shutdown.run('SIGTERM');

    expect(calls).toEqual(['server', 'redis']);
    expect(logger.at('error')).toHaveLength(1);
    expect(logger.at('error')[0]?.fields).toMatchObject({ closer: 'smtp', err: failure });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('still runs the closers when closing the server fails, then exits 1', async () => {
    const { shutdown, calls, exit, logger, app } = setup();
    app.close.mockRejectedValue(new Error('server stuck'));
    shutdown.registerCloser('redis', () => {
      calls.push('redis');
      return Promise.resolve();
    });

    await shutdown.run('SIGTERM');

    expect(calls).toEqual(['redis']);
    expect(logger.at('error')[0]?.fields).toMatchObject({ closer: 'http server' });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits 1 with an error line when shutdown stalls past the timeout', async () => {
    const { shutdown, exit, logger } = setup();
    const never = deferred();
    shutdown.registerCloser('smtp', () => never.promise);

    const running = shutdown.run('SIGTERM');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.at('error').map((r) => r.message)).toEqual(['shutdown timed out']);
    expect(logger.at('error')[0]?.fields).toMatchObject({ timeoutMs: TIMEOUT_MS });

    never.resolve();
    await running;
    expect(exit).toHaveBeenCalledOnce();
  });
});

describe('installProcessHandlers', () => {
  function install() {
    const proc = new EventEmitter();
    const logger = new FakeLogger();
    const exit = vi.fn<(code: number) => void>();
    const shutdown = { registerCloser: vi.fn(), run: vi.fn(() => Promise.resolve()) };
    installProcessHandlers({ proc, logger, shutdown, exit });
    return { proc, logger, exit, shutdown };
  }

  it.each(['SIGTERM', 'SIGINT'] as const)('%s starts a graceful shutdown', (signal) => {
    const { proc, shutdown, exit } = install();

    proc.emit(signal, signal);

    expect(shutdown.run).toHaveBeenCalledExactlyOnceWith(signal);
    expect(exit).not.toHaveBeenCalled();
  });

  it('unhandledRejection with an Error -> fatal line with the error, exit 1, no graceful shutdown', () => {
    const { proc, logger, exit, shutdown } = install();
    const error = new Error('lost promise');

    proc.emit('unhandledRejection', error);

    expect(logger.at('fatal')).toHaveLength(1);
    expect(logger.at('fatal')[0]?.fields).toMatchObject({ err: error });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(shutdown.run).not.toHaveBeenCalled();
  });

  it('unhandledRejection with a string -> fatal line, exit 1', () => {
    const { proc, logger, exit } = install();

    proc.emit('unhandledRejection', 'plain string');

    expect(logger.at('fatal')).toHaveLength(1);
    expect(logger.at('fatal')[0]?.fields).toMatchObject({ err: 'plain string' });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('uncaughtException -> fatal line with the error, exit 1, no graceful shutdown', () => {
    const { proc, logger, exit, shutdown } = install();
    const error = new Error('boom');

    proc.emit('uncaughtException', error);

    expect(logger.at('fatal')[0]?.fields).toMatchObject({ err: error });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(shutdown.run).not.toHaveBeenCalled();
  });
});
