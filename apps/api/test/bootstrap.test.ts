import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/application/catalog-service.js';
import { EnquiryService } from '../src/application/enquiry-service.js';
import { bootstrap, type Composition, type RunningApp } from '../src/bootstrap.js';
import { ConfigError } from '../src/domain/errors.js';
import { MemoryRateLimiter } from '../src/infrastructure/rate-limit/memory-rate-limiter.js';
import { FakeEnquiryNotifier } from './support/fake-enquiry-notifier.js';
import { FakeProductSource } from './support/fake-product-source.js';
import { FakeLogger } from './support/fake-logger.js';

function setup(
  env: NodeJS.ProcessEnv,
  listenImpl: RunningApp['listen'] = () => Promise.resolve(),
  composeImpl?: () => Promise<Composition>,
) {
  const bootstrapLogger = new FakeLogger();
  const appLogger = new FakeLogger();
  const exit = vi.fn<(code: number) => void>();
  const order: string[] = [];
  const listen = vi.fn(listenImpl);
  const close = vi.fn(() => {
    order.push('server');
    return Promise.resolve();
  });
  const app: RunningApp = { listen, close };
  const buildApp = vi.fn(() => Promise.resolve(app));
  const createLogger = vi.fn(() => appLogger);
  const catalogService = new CatalogService(new FakeProductSource(), appLogger);
  const rateLimiter = new MemoryRateLimiter();
  const enquiryService = new EnquiryService(
    catalogService,
    new FakeEnquiryNotifier(),
    appLogger,
    () => 'id',
    () => new Date(0),
  );
  const compose = vi.fn(
    composeImpl ??
      (() =>
        Promise.resolve<Composition>({
          services: { catalogService, enquiryService, rateLimiter },
          closers: [
            { name: 'first', close: () => (order.push('first'), Promise.resolve()) },
            { name: 'second', close: () => (order.push('second'), Promise.resolve()) },
          ],
        })),
  );
  const proc = new EventEmitter();
  const run = () =>
    bootstrap({ env, proc, exit, bootstrapLogger, createLogger, compose, buildApp });
  return {
    bootstrapLogger,
    appLogger,
    exit,
    listen,
    close,
    buildApp,
    createLogger,
    compose,
    catalogService,
    enquiryService,
    rateLimiter,
    order,
    proc,
    run,
  };
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
      upstreamHost: 'fakestoreapi.com',
      notifierDriver: 'smtp',
      smtpHost: 'localhost',
    });
    expect(t.exit).not.toHaveBeenCalled();
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

describe('bootstrap: composition', () => {
  it('composes from the parsed config and the created logger', async () => {
    const t = setup({ PORT: '4321' });

    await t.run();

    expect(t.compose).toHaveBeenCalledOnce();
    expect(t.compose).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4321 }) as unknown,
      t.appLogger,
    );
  });

  it('hands the composed services to buildApp next to config and logger', async () => {
    const t = setup({ PORT: '4321' });

    await t.run();

    expect(t.buildApp).toHaveBeenCalledWith({
      config: expect.objectContaining({ port: 4321 }) as unknown,
      logger: t.appLogger,
      catalogService: t.catalogService,
      enquiryService: t.enquiryService,
      rateLimiter: t.rateLimiter,
    });
  });

  it('closes the server first, then the composed closers in reverse order, then exits 0', async () => {
    const t = setup({});
    await t.run();

    t.proc.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => {
      expect(t.exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    expect(t.order).toEqual(['server', 'second', 'first']);
  });

  it('a failing closer is reported and exits 1', async () => {
    const failure = new Error('redis quit failed');
    const t = setup({}, undefined, () =>
      Promise.resolve({
        services: {
          catalogService: new CatalogService(new FakeProductSource(), new FakeLogger()),
          enquiryService: new EnquiryService(
            new CatalogService(new FakeProductSource(), new FakeLogger()),
            new FakeEnquiryNotifier(),
            new FakeLogger(),
            () => 'id',
            () => new Date(0),
          ),
          rateLimiter: new MemoryRateLimiter(),
        },
        closers: [{ name: 'redis', close: () => Promise.reject(failure) }],
      }),
    );
    await t.run();

    t.proc.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => {
      expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    expect(t.appLogger.at('error')[0]?.fields).toMatchObject({ closer: 'redis', err: failure });
  });

  it('a ConfigError from compose logs fatal naming the variable, exits 1 and never listens', async () => {
    const t = setup({}, undefined, () =>
      Promise.reject(new ConfigError([{ field: 'REDIS_URL', message: 'Redis is not reachable' }])),
    );

    await t.run();

    expect(t.appLogger.at('fatal')).toHaveLength(1);
    expect(t.appLogger.at('fatal')[0]?.message).toBe('invalid configuration');
    expect(t.appLogger.at('fatal')[0]?.fields.variables).toEqual(['REDIS_URL']);
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(t.buildApp).not.toHaveBeenCalled();
    expect(t.listen).not.toHaveBeenCalled();
  });

  it('any other compose failure is a fatal startup failure', async () => {
    const failure = new Error('constructor blew up');
    const t = setup({}, undefined, () => Promise.reject(failure));

    await t.run();

    expect(t.appLogger.at('fatal')[0]?.message).toBe('startup failed');
    expect(t.appLogger.at('fatal')[0]?.fields).toMatchObject({ err: failure });
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not compose when the configuration is invalid', async () => {
    const t = setup({ PORT: 'abc' });

    await t.run();

    expect(t.compose).not.toHaveBeenCalled();
  });
});
