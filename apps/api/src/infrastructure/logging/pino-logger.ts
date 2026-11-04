import pino, { type DestinationStream } from 'pino';
import type { LogFields, Logger, LogLevelName } from '../../domain/logger.js';

const PII_FIELDS = ['email', 'phone', 'message', 'name'] as const;

/**
 * Explicit paths only. A `*.message` wildcard would also censor `err.message`.
 * Request bodies are never logged on purpose; this list is defence in depth.
 */
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...PII_FIELDS.map((field) => `body.${field}`),
  ...PII_FIELDS.map((field) => `enquiry.${field}`),
];

export interface PinoLoggerOptions {
  readonly level: LogLevelName;
  readonly pretty: boolean;
  /** Where JSON lines go when `pretty` is false. Defaults to stdout. */
  readonly destination?: DestinationStream;
  /** Extra fields merged into every line, e.g. the current request context. */
  readonly getContext?: () => object | undefined;
}

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

class PinoLogger implements Logger {
  readonly debug = this.write('debug');
  readonly info = this.write('info');
  readonly warn = this.write('warn');
  readonly error = this.write('error');
  readonly fatal = this.write('fatal');

  constructor(private readonly inner: pino.Logger) {}

  child(bindings: LogFields): Logger {
    return new PinoLogger(this.inner.child(bindings));
  }

  private write(level: Level) {
    return (first: LogFields | string, message?: string): void => {
      if (typeof first === 'string') {
        this.inner[level](first);
      } else {
        this.inner[level](first, message);
      }
    };
  }
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  const base: pino.LoggerOptions = {
    level: options.level,
    redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
    serializers: { err: pino.stdSerializers.errWithCause },
    mixin: () => options.getContext?.() ?? {},
  };

  const inner = options.pretty
    ? pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } })
    : pino(base, options.destination ?? pino.destination(1));

  return new PinoLogger(inner);
}
