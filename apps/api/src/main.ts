import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { getRequestContext } from './http/request-context.js';
import { createPinoLogger } from './infrastructure/logging/pino-logger.js';

// Composition root: the only place adapters are constructed.
await bootstrap({
  env: process.env,
  proc: process,
  exit: (code) => process.exit(code),
  bootstrapLogger: createPinoLogger({ level: 'info', pretty: false }),
  createLogger: (config) =>
    createPinoLogger({
      level: config.logLevel,
      pretty: config.nodeEnv === 'development',
      getContext: getRequestContext,
    }),
  buildApp,
});
