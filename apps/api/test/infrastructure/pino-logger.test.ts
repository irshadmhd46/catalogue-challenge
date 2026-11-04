import { describe, expect, it } from 'vitest';
import type { LogLevelName } from '../../src/domain/logger.js';
import { createPinoLogger } from '../../src/infrastructure/logging/pino-logger.js';
import { captureLogs } from '../support/log-capture.js';

function build(
  overrides: { level?: LogLevelName; getContext?: () => Record<string, unknown> | undefined } = {},
) {
  const capture = captureLogs();
  const logger = createPinoLogger({
    level: overrides.level ?? 'debug',
    pretty: false,
    destination: capture.stream,
    ...(overrides.getContext ? { getContext: overrides.getContext } : {}),
  });
  return { capture, logger };
}

describe('createPinoLogger', () => {
  it('writes one structured JSON line with level, fields and message', () => {
    const { capture, logger } = build();

    logger.info({ enquiryId: 'e1' }, 'enquiry sent');

    const [line] = capture.lines();
    expect(capture.lines()).toHaveLength(1);
    expect(line).toMatchObject({ level: 30, enquiryId: 'e1', msg: 'enquiry sent' });
  });

  it('accepts a bare message', () => {
    const { capture, logger } = build();

    logger.warn('cache degraded');

    expect(capture.lines()[0]).toMatchObject({ level: 40, msg: 'cache degraded' });
  });

  it.each([
    ['debug', 20],
    ['info', 30],
    ['warn', 40],
    ['error', 50],
    ['fatal', 60],
  ] as const)('%s -> numeric level %i', (method, numeric) => {
    const { capture, logger } = build();

    logger[method]({ probe: true }, 'x');

    expect(capture.lines()[0]).toMatchObject({ level: numeric });
  });

  it('carries child bindings on every line', () => {
    const { capture, logger } = build();

    logger.child({ component: 'cache' }).info('hit');

    expect(capture.lines()[0]).toMatchObject({ component: 'cache', msg: 'hit' });
  });

  it('writes nothing below the configured level', () => {
    const { capture, logger } = build({ level: 'warn' });

    logger.info('quiet');
    logger.debug('quieter');

    expect(capture.text()).toBe('');
  });

  it('writes lines at or above the configured level', () => {
    const { capture, logger } = build({ level: 'warn' });

    logger.warn('loud');
    logger.error('louder');

    expect(capture.lines().map((line) => line.msg)).toEqual(['loud', 'louder']);
  });

  it('writes plain JSON, not pretty text, when pretty is off', () => {
    const { capture, logger } = build();

    logger.info('plain');

    expect(() => {
      JSON.parse(capture.text());
    }).not.toThrow();
  });

  it('merges the request context into every line', () => {
    const { capture, logger } = build({
      getContext: () => ({ reqId: 'abc-123', method: 'GET', route: '/healthz' }),
    });

    logger.info('inside');

    expect(capture.lines()[0]).toMatchObject({
      reqId: 'abc-123',
      method: 'GET',
      route: '/healthz',
    });
  });

  it('leaves lines without request fields when there is no context', () => {
    const { capture, logger } = build({ getContext: () => undefined });

    logger.info('startup');

    const [line] = capture.lines();
    expect(line).not.toHaveProperty('reqId');
    expect(line).not.toHaveProperty('route');
  });
});

describe('createPinoLogger redaction', () => {
  it('censors the authorization header', () => {
    const { capture, logger } = build();

    logger.info({ req: { headers: { authorization: 'Bearer secret-token' } } }, 'incoming');

    expect(capture.text()).not.toContain('secret-token');
    expect(capture.text()).toContain('[Redacted]');
  });

  it('censors cookie and set-cookie headers', () => {
    const { capture, logger } = build();

    logger.info({ req: { headers: { cookie: 'sid=cookie-secret' } } }, 'in');
    logger.info({ res: { headers: { 'set-cookie': 'sid=set-cookie-secret' } } }, 'out');

    expect(capture.text()).not.toContain('cookie-secret');
    expect(capture.text()).not.toContain('set-cookie-secret');
  });

  it.each(['body', 'enquiry'])('censors email, phone, message and name under %s', (key) => {
    const { capture, logger } = build();

    logger.info(
      {
        [key]: {
          email: 'ann@example.test',
          phone: '0123456789',
          message: 'private note',
          name: 'Ann Lee',
        },
      },
      'submitted',
    );

    const text = capture.text();
    for (const value of ['ann@example.test', '0123456789', 'private note', 'Ann Lee']) {
      expect(text).not.toContain(value);
    }
  });

  it('keeps non-PII fields next to censored ones', () => {
    const { capture, logger } = build();

    logger.info({ enquiry: { email: 'ann@example.test', productId: 7 } }, 'submitted');

    expect(capture.lines()[0]).toMatchObject({ enquiry: { productId: 7 } });
  });

  it('keeps the error message, stack and cause visible', () => {
    const { capture, logger } = build();
    const error = new Error('upstream exploded', { cause: new Error('socket hang up') });

    logger.error({ err: error }, 'failed');

    const text = capture.text();
    expect(text).toContain('upstream exploded');
    expect(text).toContain('socket hang up');
    const [line] = capture.lines();
    expect((line?.err as { stack?: string }).stack).toContain('Error: upstream exploded');
  });
});
