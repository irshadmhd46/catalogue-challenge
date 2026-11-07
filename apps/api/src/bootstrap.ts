import type { AppDependencies } from './app.js';
import { describeConfig, loadConfig, type AppConfig } from './config/index.js';
import { ConfigError } from './domain/errors.js';
import type { Logger } from './domain/logger.js';
import { createShutdown, installProcessHandlers, type ProcessLike } from './lifecycle.js';

export interface RunningApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface Closer {
  readonly name: string;
  readonly close: () => Promise<unknown>;
}

/** What the composition root builds from the config: the services the app needs plus cleanup. */
export interface Composition {
  readonly services: Omit<AppDependencies, 'config' | 'logger'>;
  /** Closed after the HTTP server, in reverse order. */
  readonly closers: readonly Closer[];
}

export interface BootstrapDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly proc: ProcessLike;
  readonly exit: (code: number) => void;
  /** Used until configuration has been parsed, so a bad config can still be reported. */
  readonly bootstrapLogger: Logger;
  readonly createLogger: (config: AppConfig) => Logger;
  /** Builds adapters and services. Throw a ConfigError when a dependency is unusable. */
  readonly compose: (config: AppConfig, logger: Logger) => Promise<Composition>;
  readonly buildApp: (deps: AppDependencies) => Promise<RunningApp>;
}

/** Starts the service. Any failure is logged at fatal and ends the process with exit code 1. */
export async function bootstrap(deps: BootstrapDeps): Promise<void> {
  let logger = deps.bootstrapLogger;

  try {
    const config = loadConfig(deps.env);
    logger = deps.createLogger(config);

    const composition = await deps.compose(config, logger);
    const app = await deps.buildApp({ config, logger, ...composition.services });
    const shutdown = createShutdown({
      app,
      logger,
      exit: deps.exit,
      timeoutMs: config.shutdownTimeoutMs,
    });
    for (const closer of composition.closers) {
      shutdown.registerCloser(closer.name, closer.close);
    }
    installProcessHandlers({ proc: deps.proc, logger, shutdown, exit: deps.exit });

    await app.listen({ host: config.host, port: config.port });
    logger.info(describeConfig(config), 'api started');
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(
        { err, variables: err.details?.map((issue) => issue.field) },
        'invalid configuration',
      );
    } else {
      logger.fatal({ err }, 'startup failed');
    }
    deps.exit(1);
  }
}
