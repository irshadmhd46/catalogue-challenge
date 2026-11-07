import type { LogFields, Logger } from '../../src/domain/logger.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogRecord {
  readonly level: LogLevel;
  readonly fields: LogFields;
  readonly message: string | undefined;
}

export class FakeLogger implements Logger {
  readonly records: LogRecord[];

  constructor(
    private readonly bindings: LogFields = {},
    records: LogRecord[] = [],
  ) {
    this.records = records;
  }

  readonly debug = this.write('debug');
  readonly info = this.write('info');
  readonly warn = this.write('warn');
  readonly error = this.write('error');
  readonly fatal = this.write('fatal');

  child(bindings: LogFields): Logger {
    return new FakeLogger({ ...this.bindings, ...bindings }, this.records);
  }

  at(level: LogLevel): LogRecord[] {
    return this.records.filter((record) => record.level === level);
  }

  private write(level: LogLevel) {
    return (first: LogFields | string, message?: string): void => {
      const fields = typeof first === 'string' ? {} : first;
      this.records.push({
        level,
        fields: { ...this.bindings, ...fields },
        message: typeof first === 'string' ? first : message,
      });
    };
  }
}
