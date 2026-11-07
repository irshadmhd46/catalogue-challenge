import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Enquiry } from '../../src/domain/enquiry.js';
import { NotificationError } from '../../src/domain/errors.js';
import type { EnquiryEmail } from '../../src/infrastructure/mail/enquiry-email.js';
import {
  SmtpEnquiryNotifier,
  describeSmtpFailure,
  type MailTransport,
} from '../../src/infrastructure/mail/smtp-enquiry-notifier.js';

const ENQUIRY: Enquiry = {
  id: 'enq-1',
  receivedAt: new Date('2026-11-06T10:00:00Z'),
  product: { id: 7, title: 'Gold Ring' },
  name: 'Ann Lee',
  email: 'ann@example.test',
  phone: '+44 20 7946 0958',
  message: 'Is this ring available in size 7?',
};
const OPTIONS = {
  from: 'no-reply@shop.example.test',
  to: 'sales@shop.example.test',
  timeoutMs: 8000,
};

class StubTransport implements MailTransport {
  readonly sent: EnquiryEmail[] = [];
  closed = 0;
  behaviour: (message: EnquiryEmail) => Promise<unknown> = () => Promise.resolve({ accepted: [] });

  sendMail(message: EnquiryEmail): Promise<unknown> {
    this.sent.push(message);
    return this.behaviour(message);
  }

  close(): void {
    this.closed += 1;
  }
}

function setup() {
  const transport = new StubTransport();
  return { transport, notifier: new SmtpEnquiryNotifier(transport, OPTIONS) };
}

const caught = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

/** Everything a logger could print about an error, including its cause chain. */
const everything = (error: unknown) => inspect(error, { depth: 10, showHidden: true });

describe('SmtpEnquiryNotifier: success', () => {
  it('resolves with no value after exactly one send', async () => {
    const { notifier, transport } = setup();

    await expect(notifier.send(ENQUIRY)).resolves.toBeUndefined();
    expect(transport.sent).toHaveLength(1);
  });

  it('sends the built message from the configured sender to the sales inbox', async () => {
    const { notifier, transport } = setup();

    await notifier.send(ENQUIRY);

    expect(transport.sent[0]).toMatchObject({
      from: 'no-reply@shop.example.test',
      to: 'sales@shop.example.test',
      replyTo: { name: 'Ann Lee', address: 'ann@example.test' },
      subject: 'Enquiry about product 7: Gold Ring',
    });
  });

  it('ignores whatever the transport resolves with', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.resolve({ response: '250 queued for ann@example.test' });

    await expect(notifier.send(ENQUIRY)).resolves.toBeUndefined();
  });
});

describe('SmtpEnquiryNotifier: failures carry no personal data', () => {
  const smtpError = Object.assign(new Error('Invalid login: 535 5.7.8 for ann@example.test'), {
    code: 'EAUTH',
    command: 'AUTH PLAIN',
    response: '535 5.7.8 Authentication failed for ann@example.test (Ann Lee)',
    responseCode: 535,
  });

  it('turns a rejection into a NotificationError', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(smtpError);

    expect(await caught(notifier.send(ENQUIRY))).toBeInstanceOf(NotificationError);
  });

  it('builds the cause from code, command and status only', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(smtpError);

    const failure = (await caught(notifier.send(ENQUIRY))) as NotificationError;

    expect((failure.cause as Error).message).toBe('smtp send failed: EAUTH 535');
  });

  it('never keeps the address, name or server response anywhere in the error', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(smtpError);

    const failure = await caught(notifier.send(ENQUIRY));

    const text = everything(failure);
    for (const secret of [
      'ann@example.test',
      'Ann Lee',
      'Authentication failed',
      'Invalid login',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('does not keep the original error object as the cause', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(smtpError);

    const failure = (await caught(notifier.send(ENQUIRY))) as NotificationError;

    expect(failure.cause).not.toBe(smtpError);
  });

  it.each([
    ['a connection refusal', { code: 'ECONNREFUSED' }, 'smtp send failed: ECONNREFUSED'],
    ['a timeout code', { code: 'ETIMEDOUT', command: 'CONN' }, 'smtp send failed: ETIMEDOUT CONN'],
    ['only a response status', { responseCode: 550 }, 'smtp send failed: 550'],
    ['no useful fields', { message: 'secret ann@example.test' }, 'smtp send failed'],
    ['a plain Error', new Error('boom ann@example.test'), 'smtp send failed'],
    ['a string', 'ann@example.test exploded', 'smtp send failed'],
    ['null', null, 'smtp send failed'],
    ['undefined', undefined, 'smtp send failed'],
  ])('describes %s without leaking', async (_label, rejection, expected) => {
    const { notifier, transport } = setup();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- non-Error rejections on purpose
    transport.behaviour = () => Promise.reject(rejection);

    const failure = (await caught(notifier.send(ENQUIRY))) as NotificationError;

    expect(failure).toBeInstanceOf(NotificationError);
    expect((failure.cause as Error).message).toBe(expected);
    expect(everything(failure)).not.toContain('ann@example.test');
  });

  it.each([
    [
      'a code with a line break',
      { code: 'EAUTH\r\nBcc: x', command: 'AUTH' },
      'smtp send failed: AUTH',
    ],
    ['a code that is too long', { code: 'E'.repeat(41) }, 'smtp send failed'],
    ['a code with spaces', { code: 'not a code' }, 'smtp send failed'],
    ['a status of 99', { responseCode: 99 }, 'smtp send failed'],
    ['a status of 0', { responseCode: 0 }, 'smtp send failed'],
    ['a negative status', { responseCode: -250 }, 'smtp send failed'],
    ['a status of 600', { responseCode: 600 }, 'smtp send failed'],
    ['a huge status', { responseCode: 99_999 }, 'smtp send failed'],
    ['a fractional status', { responseCode: 535.5 }, 'smtp send failed'],
    ['a string status', { responseCode: '535' }, 'smtp send failed'],
    ['the status bounds 100 and 599', { responseCode: 100 }, 'smtp send failed: 100'],
    ['the upper status bound', { responseCode: 599 }, 'smtp send failed: 599'],
  ])('drops or keeps %s exactly as expected', (_label, rejection, expected) => {
    expect(describeSmtpFailure(rejection).message).toBe(expected);
  });

  it('survives a transport that throws synchronously', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => {
      throw Object.assign(new Error('sync'), { code: 'EENVELOPE' });
    };

    const failure = (await caught(notifier.send(ENQUIRY))) as NotificationError;

    expect(failure).toBeInstanceOf(NotificationError);
    expect((failure.cause as Error).message).toBe('smtp send failed: EENVELOPE');
  });

  it('has a generic public message and no details', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(smtpError);

    const failure = (await caught(notifier.send(ENQUIRY))) as NotificationError;

    expect(failure.publicMessage).toBe('Could not send the message');
    expect(failure.details).toBeUndefined();
    expect(failure.httpStatus).toBe(502);
  });
});

describe('SmtpEnquiryNotifier: never retries', () => {
  it('calls the transport once when it fails', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(new Error('down'));

    await caught(notifier.send(ENQUIRY));

    expect(transport.sent).toHaveLength(1);
  });

  it('calls the transport once when it times out', async () => {
    vi.useFakeTimers();
    try {
      const { notifier, transport } = setup();
      transport.behaviour = () => new Promise(() => undefined);

      const pending = caught(notifier.send(ENQUIRY));
      await vi.advanceTimersByTimeAsync(OPTIONS.timeoutMs);
      await pending;

      expect(transport.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SmtpEnquiryNotifier: the total deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a NotificationError exactly when the deadline passes, not before', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => new Promise(() => undefined);
    let outcome: unknown = 'pending';
    void notifier.send(ENQUIRY).catch((error: unknown) => {
      outcome = error;
    });

    await vi.advanceTimersByTimeAsync(OPTIONS.timeoutMs - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome).toBeInstanceOf(NotificationError);
    expect(((outcome as NotificationError).cause as Error).message).toBe(
      'smtp send timed out after 8000 ms',
    );
  });

  it('ignores a success that arrives after the deadline', async () => {
    const { notifier, transport } = setup();
    let finish: (value: unknown) => void = () => undefined;
    transport.behaviour = () => new Promise((resolve) => (finish = resolve));
    const outcome = caught(notifier.send(ENQUIRY));

    await vi.advanceTimersByTimeAsync(OPTIONS.timeoutMs);
    finish({ accepted: ['sales@shop.example.test'] });

    expect(await outcome).toBeInstanceOf(NotificationError);
  });

  it('does not raise an unhandled rejection when the transport fails after the deadline', async () => {
    const { notifier, transport } = setup();
    let fail: (reason: Error) => void = () => undefined;
    transport.behaviour = () => new Promise((_resolve, reject) => (fail = reject));
    const outcome = caught(notifier.send(ENQUIRY));

    await vi.advanceTimersByTimeAsync(OPTIONS.timeoutMs);
    await outcome;
    fail(new Error('too late'));
    await vi.advanceTimersByTimeAsync(10);

    // Vitest fails the run on an unhandled rejection; reaching here means there was none.
    expect(transport.sent).toHaveLength(1);
  });

  it('clears its timer after a quick success', async () => {
    const { notifier } = setup();

    await notifier.send(ENQUIRY);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer after a failure', async () => {
    const { notifier, transport } = setup();
    transport.behaviour = () => Promise.reject(new Error('down'));

    await caught(notifier.send(ENQUIRY));

    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the configured timeout', async () => {
    const transport = new StubTransport();
    transport.behaviour = () => new Promise(() => undefined);
    const notifier = new SmtpEnquiryNotifier(transport, { ...OPTIONS, timeoutMs: 250 });
    let outcome: unknown = 'pending';
    void notifier.send(ENQUIRY).catch((error: unknown) => {
      outcome = error;
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome).toBeInstanceOf(NotificationError);
  });
});

describe('SmtpEnquiryNotifier.close', () => {
  it('closes the transport once', () => {
    const { notifier, transport } = setup();

    notifier.close();

    expect(transport.closed).toBe(1);
  });

  it('does not send anything', () => {
    const { notifier, transport } = setup();

    notifier.close();

    expect(transport.sent).toEqual([]);
  });
});
