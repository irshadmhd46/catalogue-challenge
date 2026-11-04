import type { Logger } from './domain/logger.js';

type Close = () => Promise<unknown>;

export interface Shutdown {
  registerCloser(name: string, close: Close): void;
  run(signal: string): Promise<void>;
}

export interface ShutdownOptions {
  readonly app: { close: Close };
  readonly logger: Logger;
  readonly exit: (code: number) => void;
  readonly timeoutMs: number;
}

const SERVER_STEP = 'http server';

export function createShutdown({ app, logger, exit, timeoutMs }: ShutdownOptions): Shutdown {
  const closers: { readonly name: string; readonly close: Close }[] = [];
  let started = false;
  let exited = false;

  const exitOnce = (code: number): void => {
    if (!exited) {
      exited = true;
      exit(code);
    }
  };

  return {
    registerCloser(name, close) {
      closers.push({ name, close });
    },

    async run(signal) {
      if (started) {
        logger.warn({ signal }, 'shutdown already in progress');
        return;
      }
      started = true;
      logger.info({ signal }, 'shutdown started');

      const hardStop = setTimeout(() => {
        logger.error({ timeoutMs }, 'shutdown timed out');
        exitOnce(1);
      }, timeoutMs);
      hardStop.unref();

      let failed = false;
      const steps = [{ name: SERVER_STEP, close: () => app.close() }, ...[...closers].reverse()];
      for (const step of steps) {
        try {
          await step.close();
        } catch (err) {
          failed = true;
          logger.error({ closer: step.name, err }, 'shutdown step failed');
        }
      }

      clearTimeout(hardStop);
      if (!exited) {
        logger.info({ failed }, 'shutdown completed');
      }
      exitOnce(failed ? 1 : 0);
    },
  };
}

export interface ProcessLike {
  on(event: 'SIGTERM' | 'SIGINT', listener: (signal: NodeJS.Signals) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
}

export interface ProcessHandlerOptions {
  readonly proc: ProcessLike;
  readonly logger: Logger;
  readonly shutdown: Pick<Shutdown, 'run'>;
  readonly exit: (code: number) => void;
}

/** After a crash the process state is unknown: log fatal and exit, do not drain. */
export function installProcessHandlers({
  proc,
  logger,
  shutdown,
  exit,
}: ProcessHandlerOptions): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown.run(signal);
  };
  proc.on('SIGTERM', onSignal);
  proc.on('SIGINT', onSignal);

  proc.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    exit(1);
  });

  proc.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    exit(1);
  });
}
