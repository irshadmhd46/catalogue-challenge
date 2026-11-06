import { enquiryResponseSchema } from '@catalogue/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationError, UpstreamError, UpstreamTimeoutError } from '../../src/domain/errors.js';
import { SmtpEnquiryNotifier } from '../../src/infrastructure/mail/smtp-enquiry-notifier.js';
import { createSmtpTransport } from '../../src/infrastructure/mail/smtp-transport.js';
import { MemoryRateLimiter } from '../../src/infrastructure/rate-limit/memory-rate-limiter.js';
import { buildAppWithFakeLogger, buildAppWithPinoLogger } from '../support/build-test-app.js';
import { FakeProductSource } from '../support/fake-product-source.js';
import { FakeSmtpServer } from '../support/fake-smtp-server.js';
import { productWith } from '../support/catalog-fixture.js';

const URL_PATH = '/api/v1/enquiries';
const VISITOR = {
  productId: 1,
  name: 'Zed Unique Name',
  email: 'zed.unique@example.test',
  phone: '+99 555 0100',
  message: 'zed-unique-message: is this backpack available in blue?',
};
const PII = [VISITOR.name, VISITOR.email, VISITOR.phone, 'zed-unique-message'];

async function setup(env: Record<string, string> = {}) {
  const source = new FakeProductSource();
  const built = await buildAppWithFakeLogger(env, { source });
  const post = (payload: unknown, remoteAddress = '203.0.113.9') =>
    built.app.inject({
      method: 'POST',
      url: URL_PATH,
      remoteAddress,
      headers: { 'x-request-id': 'enq-1' },
      payload: payload as object,
    });
  return { ...built, source, post };
}

const errorOf = (body: string) => (JSON.parse(body) as { error: Record<string, unknown> }).error;

describe('POST /api/v1/enquiries: the happy path', () => {
  it('answers 202 with an enquiry id and sends one email-ready enquiry to the notifier', async () => {
    const { post, notifier } = await setup();

    const res = await post(VISITOR);

    expect(res.statusCode).toBe(202);
    expect(enquiryResponseSchema.safeParse(res.json()).success).toBe(true);
    expect(res.headers['x-request-id']).toBe('enq-1');
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      id: res.json<{ enquiryId: string }>().enquiryId,
      name: VISITOR.name,
      email: VISITOR.email,
      phone: VISITOR.phone,
      message: VISITOR.message,
      product: { id: 1, title: 'Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops' },
    });
  });

  it('does not repeat any visitor data in the response', async () => {
    const { post } = await setup();

    const res = await post(VISITOR);

    for (const secret of PII) expect(res.body).not.toContain(secret);
  });

  it('accepts an enquiry without a phone', async () => {
    const { post, notifier } = await setup();
    const withoutPhone = {
      productId: VISITOR.productId,
      name: VISITOR.name,
      email: VISITOR.email,
      message: VISITOR.message,
    };

    expect((await post(withoutPhone)).statusCode).toBe(202);
    expect(notifier.sent[0]).not.toHaveProperty('phone');
  });
});

describe('POST /api/v1/enquiries: invalid requests are rejected before any side effect', () => {
  it('names each invalid field once and touches neither the catalogue nor the notifier', async () => {
    const { post, notifier, source } = await setup();

    const res = await post({ ...VISITOR, email: 'not-an-email', message: 'short' });

    expect(res.statusCode).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect((error.details as { field: string }[]).map((d) => d.field).sort()).toEqual([
      'email',
      'message',
    ]);
    expect(notifier.sent).toEqual([]);
    expect(source.findCalls).toEqual([]);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"hello"'],
    ['a number', '42'],
  ])('rejects %s as the body', async (_label, raw) => {
    const { app, notifier } = await setup();

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });

    expect(res.statusCode).toBe(400);
    expect(notifier.sent).toEqual([]);
  });

  it('rejects an unknown property with a fixed message that does not echo its name', async () => {
    const { post, notifier } = await setup();

    const res = await post({ ...VISITOR, bcc: 'x@evil.test' });

    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('bcc');
    expect(res.body).not.toContain('evil');
    expect(notifier.sent).toEqual([]);
  });

  it('answers 404 for an unknown product and sends nothing', async () => {
    const { post, notifier } = await setup();

    const res = await post({ ...VISITOR, productId: 9999 });

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.body)).toMatchObject({ code: 'NOT_FOUND', message: 'Product not found' });
    expect(notifier.sent).toEqual([]);
  });
});

describe('POST /api/v1/enquiries: request framing', () => {
  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'refuses %s with 415',
    async (type) => {
      const { app, notifier } = await setup();

      const res = await app.inject({
        method: 'POST',
        url: URL_PATH,
        headers: { 'content-type': type },
        payload: 'name=Zed&email=zed@example.test',
      });

      expect(res.statusCode).toBe(415);
      expect(notifier.sent).toEqual([]);
    },
  );

  it('refuses malformed JSON with 400 and no parser text', async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(res.statusCode).toBe(400);
    expect(errorOf(res.body).code).toBe('BAD_REQUEST');
    expect(res.body).not.toMatch(/JSON|token|position/i);
  });

  it('refuses a body over the limit with 413', async () => {
    const { post } = await setup({ BODY_LIMIT_BYTES: '200' });

    const res = await post({ ...VISITOR, message: 'm'.repeat(500) });

    expect(res.statusCode).toBe(413);
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'] as const)(
    'answers %s with the 404 envelope',
    async (method) => {
      const { app } = await setup();

      const res = await app.inject({ method, url: URL_PATH });

      expect(res.statusCode).toBe(404);
      expect(errorOf(res.body).code).toBe('NOT_FOUND');
    },
  );
});

describe('POST /api/v1/enquiries: failures', () => {
  it('answers 502 NOTIFICATION_FAILED when the send fails, logging one error with the enquiry id', async () => {
    const { post, notifier, logger } = await setup();
    notifier.failure = new Error('smtp down');

    const res = await post(VISITOR);

    expect(res.statusCode).toBe(502);
    expect(errorOf(res.body)).toMatchObject({ code: 'NOTIFICATION_FAILED', requestId: 'enq-1' });
    expect(logger.at('error')).toHaveLength(1);
    const err = logger.at('error')[0]?.fields.err as NotificationError;
    expect(err.enquiryId).toMatch(/^[0-9a-f-]{36}$/);
    for (const secret of PII) expect(res.body).not.toContain(secret);
  });

  it('answers 502 or 504 without sending when the product lookup fails upstream', async () => {
    const { post, notifier, source } = await setup();
    source.failure = new UpstreamError();
    expect((await post(VISITOR)).statusCode).toBe(502);

    source.failure = new UpstreamTimeoutError();
    expect((await post(VISITOR)).statusCode).toBe(504);
    expect(notifier.sent).toEqual([]);
  });
});

describe('POST /api/v1/enquiries: rate limiting', () => {
  it('accepts five enquiries a minute, answers the sixth with 429, and recovers after the window', async () => {
    const clock = { ms: 1_000_000 };
    const source = new FakeProductSource();
    const built = await buildAppWithFakeLogger(
      {},
      { source, rateLimiter: new MemoryRateLimiter(() => clock.ms) },
    );
    const post = () =>
      built.app.inject({
        method: 'POST',
        url: URL_PATH,
        remoteAddress: '203.0.113.9',
        payload: VISITOR,
      });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await post()).statusCode);

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(built.notifier.sent).toHaveLength(5);
    clock.ms += 61_000;
    expect((await post()).statusCode).toBe(202);
  });

  it('limits each address on its own', async () => {
    const { post } = await setup({ RATE_LIMIT_ENQUIRY_PER_MINUTE: '1' });
    await post(VISITOR, '203.0.113.9');

    expect((await post(VISITOR, '203.0.113.9')).statusCode).toBe(429);
    expect((await post(VISITOR, '198.51.100.7')).statusCode).toBe(202);
  });
});

describe('POST /api/v1/enquiries: personal data never reaches a log', () => {
  it('stays out of every log line across success, validation, 404, 429 and a failed send', async () => {
    const { app, capture, notifier } = await buildAppWithPinoLogger(
      { RATE_LIMIT_ENQUIRY_PER_MINUTE: '4', LOG_LEVEL: 'debug' },
      { source: new FakeProductSource() },
    );
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: URL_PATH, remoteAddress: '203.0.113.9', payload });

    await post(VISITOR);
    await post({ ...VISITOR, email: 'zed.unique.bad' });
    await post({ ...VISITOR, productId: 9999 });
    // A conforming notifier rebuilds library errors without visitor data (see the SMTP notifier tests).
    notifier.failure = new NotificationError({ cause: new Error('smtp send failed: EAUTH 535') });
    await post(VISITOR);
    await post(VISITOR);

    const text = capture.text();
    expect(text).toContain('enquiry sent');
    expect(text).toContain('RATE_LIMITED');
    for (const secret of PII) expect(text).not.toContain(secret);
  });

  it('writes one success line with the ids and outcome only', async () => {
    const { app, capture } = await buildAppWithPinoLogger({}, { source: new FakeProductSource() });

    await app.inject({ method: 'POST', url: URL_PATH, payload: VISITOR });

    const line = capture.lines().find((l) => l.msg === 'enquiry sent');
    expect(line).toMatchObject({ productId: 1, outcome: 'sent' });
    expect(Object.keys(line ?? {})).not.toEqual(
      expect.arrayContaining(['email', 'name', 'message']),
    );
  });
});

describe('POST /api/v1/enquiries: end to end over real SMTP (loopback)', () => {
  let server: FakeSmtpServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function stack(product = productWith({ id: 1, title: 'Gold Ring' })) {
    server = new FakeSmtpServer();
    const port = await server.start();
    const notifier = new SmtpEnquiryNotifier(
      createSmtpTransport({
        host: '127.0.0.1',
        port,
        tls: 'none',
        user: undefined,
        password: undefined,
        timeoutMs: 3000,
      }),
      { from: 'no-reply@shop.example.test', to: 'sales@shop.example.test', timeoutMs: 3000 },
    );
    return buildAppWithFakeLogger({}, { source: new FakeProductSource([product]), notifier });
  }

  it('delivers one email to the sales inbox and answers 202 (the acceptance criterion)', async () => {
    const { app } = await stack();

    const res = await app.inject({ method: 'POST', url: URL_PATH, payload: { ...VISITOR } });

    expect(res.statusCode).toBe(202);
    expect(server?.received).toHaveLength(1);
    const mail = server?.received[0];
    expect(mail).toMatchObject({
      from: 'no-reply@shop.example.test',
      recipients: ['sales@shop.example.test'],
    });
    expect(mail?.data).toContain('Subject: Enquiry about product 1: Gold Ring');
    expect(mail?.data).toContain(VISITOR.message);
  });

  it('a hostile name and product title cannot add a header or recipient', async () => {
    const { app } = await stack(productWith({ id: 1, title: 'Ring\r\nBcc: x@evil.test' }));

    await app.inject({
      method: 'POST',
      url: URL_PATH,
      payload: { ...VISITOR, name: 'Zed Name' },
    });

    const mail = server?.received[0];
    const headerNames = (mail?.data.split('\r\n\r\n')[0] ?? '')
      .split('\r\n')
      .filter((line) => /^\S/.test(line))
      .map((line) => line.split(':')[0]?.toLowerCase());
    expect(headerNames).not.toContain('bcc');
    expect(mail?.recipients).toEqual(['sales@shop.example.test']);
  });

  it('answers 502 and sends nothing when the SMTP server is down', async () => {
    const { app } = await stack();
    await server?.stop();

    const res = await app.inject({ method: 'POST', url: URL_PATH, payload: VISITOR });

    expect(res.statusCode).toBe(502);
    expect(errorOf(res.body).code).toBe('NOTIFICATION_FAILED');
  });
});
