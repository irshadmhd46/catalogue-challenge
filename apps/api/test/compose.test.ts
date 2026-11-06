import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compose, type ComposeDeps } from '../src/compose.js';
import { loadConfig } from '../src/config/index.js';
import type { EnquiryEmail } from '../src/infrastructure/mail/enquiry-email.js';
import type { MailTransport } from '../src/infrastructure/mail/smtp-enquiry-notifier.js';
import type { SmtpTransportConfig } from '../src/infrastructure/mail/smtp-transport.js';
import { FakeLogger } from './support/fake-logger.js';
import { upstreamProducts } from './support/fixtures.js';

const VISITOR = {
  productId: 1,
  name: 'Ann Lee',
  email: 'ann@example.test',
  message: 'Is this backpack available in blue?',
};

function setup(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    FAKESTORE_BASE_URL: 'http://upstream.test',
    ...env,
  });
  const logger = new FakeLogger();
  const fetched: string[] = [];
  let respond: (url: string) => Response = (url) =>
    url.endsWith('/products')
      ? new Response(JSON.stringify(upstreamProducts()))
      : new Response(
          JSON.stringify(upstreamProducts().find((p) => url.endsWith(`/${String(p.id)}`))),
        );
  const mail = { sent: [] as EnquiryEmail[], closed: 0, failWith: undefined as Error | undefined };
  const transport: MailTransport = {
    sendMail: (message) => {
      mail.sent.push(message);
      return mail.failWith ? Promise.reject(mail.failWith) : Promise.resolve({ accepted: [] });
    },
    close: () => {
      mail.closed += 1;
    },
  };
  const createTransport = vi.fn<(config: SmtpTransportConfig) => MailTransport>(() => transport);
  const deps: ComposeDeps = {
    createTransport,
    newId: () => '00000000-0000-4000-8000-000000000001',
    now: () => new Date('2026-11-06T10:00:00Z'),
    fetch: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetched.push(url);
      return Promise.resolve(respond(url));
    },
  };
  return {
    config,
    logger,
    fetched,
    mail,
    createTransport,
    run: () => compose(config, logger, deps),
    respondWith: (make: (url: string) => Response) => {
      respond = make;
    },
  };
}

const featuredIds = async (service: { featured(): Promise<{ id: number }[]> }) =>
  (await service.featured()).map((p) => p.id);

describe('compose: the catalogue', () => {
  it('builds a working catalogue service', async () => {
    const { services } = await setup().run();

    expect(await featuredIds(services.catalogService)).toEqual([12, 11, 3, 18, 5]);
  });

  it('reads the catalogue from the configured upstream base URL', async () => {
    const t = setup({ FAKESTORE_BASE_URL: 'http://catalogue.test/api' });
    const { services } = await t.run();

    await services.catalogService.featured();

    expect(t.fetched).toEqual(['http://catalogue.test/api/products']);
  });

  it('passes the featured override to the service', async () => {
    const { services } = await setup({ FEATURED_PRODUCT_IDS: '7,2,15' }).run();

    expect(await featuredIds(services.catalogService)).toEqual([7, 2, 15]);
  });

  it('caches the list in memory: two calls make one upstream request', async () => {
    const t = setup();
    const { services } = await t.run();

    await services.catalogService.featured();
    await services.catalogService.categories();

    expect(t.fetched).toHaveLength(1);
  });

  it('passes UPSTREAM_MAX_RETRIES to the adapter: 0 means a single attempt', async () => {
    const t = setup({ UPSTREAM_MAX_RETRIES: '0' });
    t.respondWith(() => new Response('boom', { status: 500 }));
    const { services } = await t.run();

    await expect(services.catalogService.featured()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(t.fetched).toHaveLength(1);
  });
});

describe('compose: freshness and stale windows reach the caching decorator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches once the fresh TTL has passed (fresh 1 s, stale 3600 s)', async () => {
    const t = setup({ CACHE_FRESH_TTL_SECONDS: '1', CACHE_STALE_TTL_SECONDS: '3600' });
    const { services } = await t.run();
    await services.catalogService.featured();

    vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
    await services.catalogService.featured();
    expect(t.fetched).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await services.catalogService.featured();
    expect(t.fetched).toHaveLength(2);
  });

  it('serves stale data only inside the stale window (fresh 1 s, stale 5 s)', async () => {
    const t = setup({
      CACHE_FRESH_TTL_SECONDS: '1',
      CACHE_STALE_TTL_SECONDS: '5',
      UPSTREAM_MAX_RETRIES: '0',
    });
    const { services } = await t.run();
    await services.catalogService.featured();
    t.respondWith(() => new Response('boom', { status: 500 }));

    vi.setSystemTime(new Date('2026-01-01T00:00:04Z'));
    expect(await featuredIds(services.catalogService)).toEqual([12, 11, 3, 18, 5]);

    vi.setSystemTime(new Date('2026-01-01T00:00:07Z'));
    await expect(services.catalogService.featured()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
});

describe('compose: the rate limiter', () => {
  it('limits per key and follows the real clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { services } = await setup().run();

      expect((await services.rateLimiter.consume('k', 2, 60)).allowed).toBe(true);
      expect((await services.rateLimiter.consume('k', 2, 60)).allowed).toBe(true);
      expect((await services.rateLimiter.consume('k', 2, 60)).allowed).toBe(false);

      vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
      expect((await services.rateLimiter.consume('k', 2, 60)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('compose: enquiries and the SMTP notifier', () => {
  it('builds the transport from the SMTP settings', async () => {
    const t = setup({
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
      SMTP_TLS: 'starttls',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'p4ssw0rd',
      SMTP_TIMEOUT_MS: '3210',
    });

    await t.run();

    expect(t.createTransport).toHaveBeenCalledExactlyOnceWith({
      host: 'smtp.example.test',
      port: 2525,
      tls: 'starttls',
      user: 'mailer',
      password: 'p4ssw0rd',
      timeoutMs: 3210,
    });
  });

  it('sends enquiries from MAIL_FROM to SALES_INBOX with the visitor as reply-to', async () => {
    const t = setup({
      MAIL_FROM: 'no-reply@shop.example.test',
      SALES_INBOX: 'sales@shop.example.test',
    });
    const { services } = await t.run();

    const id = await services.enquiryService.submit(VISITOR);

    expect(id).toBe('00000000-0000-4000-8000-000000000001');
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]).toMatchObject({
      from: 'no-reply@shop.example.test',
      to: 'sales@shop.example.test',
      replyTo: { name: 'Ann Lee', address: 'ann@example.test' },
      subject: expect.stringContaining('product 1: Fjallraven') as unknown,
    });
  });

  it('takes the product from the composed catalogue, not from the request', async () => {
    const t = setup();
    const { services } = await t.run();

    await services.enquiryService.submit({ ...VISITOR, productId: 7 });

    expect(t.fetched).toContain('http://upstream.test/products/7');
  });

  it('applies SMTP_TIMEOUT_MS as the total send deadline', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ SMTP_TIMEOUT_MS: '250' });
      const { services } = await t.run();
      const transport = t.createTransport.mock.results[0]?.value as MailTransport;
      vi.spyOn(transport, 'sendMail').mockReturnValue(new Promise<never>(() => undefined));

      const pending = services.enquiryService.submit(VISITOR).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(250);

      expect(await pending).toMatchObject({ code: 'NOTIFICATION_FAILED' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers only the smtp closer, and it closes the transport once', async () => {
    const t = setup();
    const { closers } = await t.run();
    expect(closers.map((c) => c.name)).toEqual(['smtp']);
    expect(t.mail.closed).toBe(0);

    await closers[0]?.close();

    expect(t.mail.closed).toBe(1);
  });

  it('turns a failing notifier into a NotificationError for the caller', async () => {
    const t = setup();
    t.mail.failWith = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    const { services } = await t.run();

    await expect(services.enquiryService.submit(VISITOR)).rejects.toMatchObject({
      code: 'NOTIFICATION_FAILED',
    });
    expect(t.mail.sent).toHaveLength(1);
  });

  it('exposes exactly the services the app needs', async () => {
    const { services } = await setup().run();

    expect(Object.keys(services).sort()).toEqual([
      'catalogService',
      'enquiryService',
      'rateLimiter',
    ]);
  });
});
