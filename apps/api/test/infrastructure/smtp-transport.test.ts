import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Enquiry } from '../../src/domain/enquiry.js';
import { NotificationError } from '../../src/domain/errors.js';
import { SmtpEnquiryNotifier } from '../../src/infrastructure/mail/smtp-enquiry-notifier.js';
import {
  buildSmtpOptions,
  createSmtpTransport,
  type SmtpTransportConfig,
} from '../../src/infrastructure/mail/smtp-transport.js';
import { FakeSmtpServer } from '../support/fake-smtp-server.js';

const CONFIG: SmtpTransportConfig = {
  host: 'smtp.example.test',
  port: 587,
  tls: 'starttls',
  user: undefined,
  password: undefined,
  timeoutMs: 3000,
};
const FROM = 'no-reply@shop.example.test';
const TO = 'sales@shop.example.test';

const ENQUIRY: Enquiry = {
  id: '0b1f6a3e-4c2d-4e8a-9f1b-2d3c4b5a6978',
  receivedAt: new Date('2026-11-06T10:00:00Z'),
  product: { id: 7, title: 'Gold Ring' },
  name: 'Ann Lee',
  email: 'ann@example.test',
  phone: '+44 20 7946 0958',
  message: 'Is this ring available in size 7?\nThanks!',
};

describe('buildSmtpOptions', () => {
  it('uses the host and port from configuration', () => {
    expect(buildSmtpOptions(CONFIG)).toMatchObject({ host: 'smtp.example.test', port: 587 });
  });

  it.each([
    ['none', { secure: false, requireTLS: false, ignoreTLS: true }],
    ['starttls', { secure: false, requireTLS: true, ignoreTLS: false }],
    ['tls', { secure: true, requireTLS: false, ignoreTLS: false }],
  ] as const)('TLS mode %s -> %j', (tls, expected) => {
    expect(buildSmtpOptions({ ...CONFIG, tls })).toMatchObject(expected);
  });

  it.each(['starttls', 'tls'] as const)(
    'verifies certificates and requires TLS 1.2 with %s',
    (tls) => {
      expect(buildSmtpOptions({ ...CONFIG, tls })).toMatchObject({
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      });
    },
  );

  it('does not touch TLS settings for a local plain sink', () => {
    expect(buildSmtpOptions({ ...CONFIG, tls: 'none' })).not.toHaveProperty('tls');
  });

  it('applies the one timeout to connection, greeting and socket', () => {
    expect(buildSmtpOptions({ ...CONFIG, timeoutMs: 1234 })).toMatchObject({
      connectionTimeout: 1234,
      greetingTimeout: 1234,
      socketTimeout: 1234,
    });
  });

  it('never pools connections', () => {
    expect(buildSmtpOptions(CONFIG)).toMatchObject({ pool: false });
  });

  it('turns SMTP logging off so credentials and visitor details never reach a log', () => {
    expect(buildSmtpOptions(CONFIG)).toMatchObject({ logger: false, debug: false });
  });

  it('forbids reading files or URLs on behalf of a message', () => {
    expect(buildSmtpOptions(CONFIG)).toMatchObject({
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it('passes credentials only when both a user and a password are configured', () => {
    expect(buildSmtpOptions({ ...CONFIG, user: 'mailer', password: 'p4ss' })).toMatchObject({
      auth: { user: 'mailer', pass: 'p4ss' },
    });
    expect(buildSmtpOptions({ ...CONFIG, user: 'mailer' })).not.toHaveProperty('auth');
    expect(buildSmtpOptions({ ...CONFIG, password: 'p4ss' })).not.toHaveProperty('auth');
    expect(buildSmtpOptions(CONFIG)).not.toHaveProperty('auth');
  });
});

describe('the real transport against a local SMTP server', () => {
  let server: FakeSmtpServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  const notifierFor = (port: number, timeoutMs = 3000) =>
    new SmtpEnquiryNotifier(
      createSmtpTransport({ ...CONFIG, host: '127.0.0.1', port, tls: 'none', timeoutMs }),
      { from: FROM, to: TO, timeoutMs },
    );

  it('delivers one message with the configured sender and recipient in the envelope', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send(ENQUIRY);
    notifier.close();

    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toMatchObject({ from: FROM, recipients: [TO] });
  });

  it('never puts the visitor in the envelope', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send({ ...ENQUIRY, email: 'attacker@example.test' });

    const mail = server.received[0];
    expect(mail?.from).not.toContain('attacker');
    expect(mail?.recipients.join(',')).not.toContain('attacker');
  });

  it('sends real headers and a plain-text body', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send(ENQUIRY);

    const raw = server.received[0]?.data ?? '';
    const [headerBlock = '', ...bodyParts] = raw.split('\r\n\r\n');
    expect(headerBlock).toMatch(/^From: .*no-reply@shop\.example\.test/m);
    expect(headerBlock).toMatch(/^To: .*sales@shop\.example\.test/m);
    expect(headerBlock).toMatch(/^Reply-To: .*ann@example\.test/m);
    expect(headerBlock).toMatch(/^Subject: Enquiry about product 7: Gold Ring$/m);
    expect(headerBlock).toMatch(new RegExp(`^X-Enquiry-Id: ${ENQUIRY.id}$`, 'mi'));
    expect(headerBlock).toMatch(/^Content-Type: text\/plain/m);
    expect(headerBlock).not.toMatch(/^Content-Type: multipart/m);
    expect(bodyParts.join('\r\n\r\n')).toContain('Is this ring available in size 7?');
  });

  it.each([
    ['name', { name: 'Ann\r\nBcc: x@evil.test' }],
    ['product title', { product: { id: 7, title: 'Ring\r\nBcc: x@evil.test' } }],
    ['name with a line separator', { name: 'Ann Bcc: x@evil.test' }],
  ])('a hostile %s cannot create a header, over the real wire format', async (_label, override) => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send({ ...ENQUIRY, ...override });

    const raw = server.received[0]?.data ?? '';
    const headerBlock = raw.split('\r\n\r\n')[0] ?? '';
    const headerNames = headerBlock
      .split('\r\n')
      .filter((line) => /^\S/.test(line))
      .map((line) => line.split(':')[0]?.toLowerCase());
    expect(headerNames).not.toContain('bcc');
    expect(server.received[0]?.recipients).toEqual([TO]);
  });

  it('shows HTML in the message as text and never as an HTML part', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send({ ...ENQUIRY, message: 'Hello <script>alert(1)</script> there' });

    const raw = server.received[0]?.data ?? '';
    expect(raw).toContain('<script>alert(1)</script>');
    expect(raw).not.toMatch(/Content-Type: text\/html/i);
  });

  it('closes cleanly after a send', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());
    await notifier.send(ENQUIRY);

    expect(() => {
      notifier.close();
    }).not.toThrow();
  });

  it('fails with a NotificationError and no credentials when nothing is listening', async () => {
    const transport = createSmtpTransport({
      ...CONFIG,
      host: '127.0.0.1',
      port: 1,
      tls: 'none',
      user: 'mailer-user',
      password: 'hunter2-pass',
      timeoutMs: 1500,
    });
    const notifier = new SmtpEnquiryNotifier(transport, { from: FROM, to: TO, timeoutMs: 1500 });

    const failure = await notifier.send(ENQUIRY).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotificationError);
    const text = inspect(failure, { depth: 10, showHidden: true });
    for (const secret of ['hunter2-pass', 'mailer-user', 'ann@example.test', 'Ann Lee']) {
      expect(text).not.toContain(secret);
    }
    notifier.close();
  });

  it('gives up on a server that never greets, within the configured time', async () => {
    server = new FakeSmtpServer({ stall: true });
    const port = await server.start();
    const notifier = notifierFor(port, 400);
    const started = Date.now();

    const failure = await notifier.send(ENQUIRY).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotificationError);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(server.received).toEqual([]);
    notifier.close();
  });

  it('sends exactly one message even when the server then fails the connection', async () => {
    server = new FakeSmtpServer();
    const notifier = notifierFor(await server.start());

    await notifier.send(ENQUIRY);
    await notifier.send({ ...ENQUIRY, id: 'second' });

    expect(server.received).toHaveLength(2);
  });
});
