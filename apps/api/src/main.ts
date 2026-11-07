import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { compose } from './compose.js';
import { createSmtpTransport } from './infrastructure/mail/smtp-transport.js';
import { getRequestContext } from './http/request-context.js';
import { createPinoLogger } from './infrastructure/logging/pino-logger.js';

await bootstrap({
  env: process.env,
  proc: process,
  exit: (code) => process.exit(code),
  bootstrapLogger: createPinoLogger({ level: 'info', pretty: false }),
  createLogger: (config) =>
    createPinoLogger({
      level: config.logLevel,
      // pino-pretty is a dev dependency: containers (no TTY) always log JSON.
      pretty: config.nodeEnv === 'development' && process.stdout.isTTY,
      getContext: getRequestContext,
    }),
  compose: (config, logger) => compose(config, logger, { createTransport: createSmtpTransport }),
  buildApp,
});
