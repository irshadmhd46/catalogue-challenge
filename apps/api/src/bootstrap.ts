import type { AppDependencies } from './app.js';
import { describeConfig, loadConfig, type AppConfig } from './config/index.js';
import { ConfigError } from './domain/errors.js';
import type { Logger } from './domain/logger.js';
import { createShutdown, installProcessHandlers, type ProcessLike } from './lifecycle.js';

export interface RunningApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface BootstrapDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly proc: ProcessLike;
  readonly exit: (code: number) => void;
  /** Used until configuration has been parsed, so a bad config can still be reported. */
  readonly bootstrapLogger: Logger;
  readonly createLogger: (config: AppConfig) => Logger;
  readonly buildApp: (deps: AppDependencies) => Promise<RunningApp>;
}

/** Starts the service. Any failure is logged at fatal and ends the process with exit code 1. */
export async function bootstrap(deps: BootstrapDeps): Promise<void> {
  let logger = deps.bootstrapLogger;

  try {
    const config = loadConfig(deps.env);
    logger = deps.createLogger(config);

    const app = await deps.buildApp({ config, logger });
    const shutdown = createShutdown({
      app,
      logger,
      exit: deps.exit,
      timeoutMs: config.shutdownTimeoutMs,
    });
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
