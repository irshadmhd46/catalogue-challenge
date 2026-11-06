import type { EnquiryRequest } from '@catalogue/contracts';
import { describe, expect, it } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service.js';
import { EnquiryService } from '../../src/application/enquiry-service.js';
import {
  NotFoundError,
  NotificationError,
  UpstreamError,
  UpstreamTimeoutError,
} from '../../src/domain/errors.js';
import { FakeEnquiryNotifier } from '../support/fake-enquiry-notifier.js';
import { FakeLogger } from '../support/fake-logger.js';
import { FakeProductSource } from '../support/fake-product-source.js';

const REQUEST: EnquiryRequest = {
  productId: 1,
  name: 'Ann Lee',
  email: 'ann@example.test',
  phone: '+44 20 7946 0958',
  message: 'Is this backpack available in blue?',
};
const NOW = new Date('2026-11-06T10:00:00Z');

function setup() {
  const source = new FakeProductSource();
  const logger = new FakeLogger();
  const notifier = new FakeEnquiryNotifier();
  let counter = 0;
  const newId = () => `enquiry-${String((counter += 1))}`;
  const service = new EnquiryService(
    new CatalogService(source, logger),
    notifier,
    logger,
    newId,
    () => NOW,
  );
  return { source, logger, notifier, service };
}

const caught = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

describe('EnquiryService.submit: the product', () => {
  it('looks the product up once, by the requested id, and takes the title from the catalogue', async () => {
    const { service, source, notifier } = setup();

    await service.submit(REQUEST);

    expect(source.findCalls).toEqual([1]);
    expect(notifier.sent[0]?.product).toEqual({
      id: 1,
      title: 'Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops',
    });
  });

  it('rethrows the NotFoundError for a missing product and sends nothing', async () => {
    const { service, notifier } = setup();

    const failure = await caught(service.submit({ ...REQUEST, productId: 9999 }));

    expect(failure).toBeInstanceOf(NotFoundError);
    expect(failure).toMatchObject({ resource: 'product', resourceId: '9999' });
    expect(notifier.sent).toEqual([]);
  });

  it.each([new UpstreamError(), new UpstreamTimeoutError()])(
    'rethrows %s from the catalogue unchanged and sends nothing',
    async (error) => {
      const { service, source, notifier } = setup();
      source.failure = error;

      await expect(service.submit(REQUEST)).rejects.toBe(error);
      expect(notifier.sent).toEqual([]);
    },
  );
});

describe('EnquiryService.submit: the enquiry handed to the notifier', () => {
  it('contains the visitor fields unchanged, a generated id and the clock time', async () => {
    const { service, notifier } = setup();

    await service.submit(REQUEST);

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      id: 'enquiry-1',
      receivedAt: NOW,
      name: 'Ann Lee',
      email: 'ann@example.test',
      phone: '+44 20 7946 0958',
      message: 'Is this backpack available in blue?',
    });
  });

  it('leaves the phone out when none was given', async () => {
    const { service, notifier } = setup();
    const withoutPhone: EnquiryRequest = {
      productId: REQUEST.productId,
      name: REQUEST.name,
      email: REQUEST.email,
      message: REQUEST.message,
    };

    await service.submit(withoutPhone);

    expect(notifier.sent[0]).not.toHaveProperty('phone');
  });

  it('resolves to the enquiry id', async () => {
    const { service } = setup();

    expect(await service.submit(REQUEST)).toBe('enquiry-1');
  });

  it('gives every enquiry its own id', async () => {
    const { service, notifier } = setup();

    const first = await service.submit(REQUEST);
    const second = await service.submit(REQUEST);

    expect(first).not.toBe(second);
    expect(notifier.sent.map((e) => e.id)).toEqual([first, second]);
  });

  it('does not let the request choose the product title', async () => {
    const { service, notifier } = setup();
    const hostile = { ...REQUEST, title: 'Injected title' } as EnquiryRequest;

    await service.submit(hostile);

    expect(notifier.sent[0]?.product.title).not.toBe('Injected title');
    expect(notifier.sent[0]).not.toHaveProperty('title');
  });
});

describe('EnquiryService.submit: notifier failures', () => {
  it('wraps a failure in a NotificationError that keeps the cause and the enquiry id', async () => {
    const { service, notifier } = setup();
    notifier.failure = new Error('smtp exploded');

    const failure = await caught(service.submit(REQUEST));

    expect(failure).toBeInstanceOf(NotificationError);
    expect((failure as NotificationError).cause).toBe(notifier.failure);
    expect((failure as NotificationError).enquiryId).toBe('enquiry-1');
  });

  it('keeps the chain when the notifier already threw a NotificationError', async () => {
    const { service, notifier } = setup();
    const inner = new NotificationError({ cause: new Error('EAUTH') });
    notifier.failure = inner;

    const failure = (await caught(service.submit(REQUEST))) as NotificationError;

    expect(failure).toBeInstanceOf(NotificationError);
    expect(failure.cause).toBe(inner);
    expect(failure.enquiryId).toBe('enquiry-1');
  });

  it('wraps a non-Error rejection too', async () => {
    const { service, notifier } = setup();
    notifier.failure = 'plain string';

    const failure = await caught(service.submit(REQUEST));

    expect(failure).toBeInstanceOf(NotificationError);
    expect((failure as NotificationError).cause).toBe('plain string');
  });

  it('calls the notifier exactly once and never retries', async () => {
    const { service, notifier } = setup();
    let calls = 0;
    notifier.send = () => {
      calls += 1;
      return Promise.reject(new Error('down'));
    };

    await caught(service.submit(REQUEST));

    expect(calls).toBe(1);
  });

  it('keeps visitor data and the id out of the public message, message and details', async () => {
    const { service, notifier } = setup();
    notifier.failure = new Error('smtp exploded');

    const failure = (await caught(service.submit(REQUEST))) as NotificationError;

    const exposed = JSON.stringify([failure.publicMessage, failure.message, failure.details]);
    for (const secret of ['ann@example.test', 'Ann Lee', 'backpack', '+44', 'enquiry-1']) {
      expect(exposed).not.toContain(secret);
    }
  });
});

describe('EnquiryService.submit: logging', () => {
  it('writes one info line with the ids and the outcome, and no visitor field', async () => {
    const { service, logger } = setup();

    await service.submit(REQUEST);

    expect(logger.records).toHaveLength(1);
    expect(logger.at('info')[0]?.message).toBe('enquiry sent');
    expect(logger.at('info')[0]?.fields).toEqual({
      enquiryId: 'enquiry-1',
      productId: 1,
      outcome: 'sent',
    });
  });

  it('writes no line when the product is missing', async () => {
    const { service, logger } = setup();

    await caught(service.submit({ ...REQUEST, productId: 9999 }));

    expect(logger.records).toEqual([]);
  });

  it('writes no line when the notifier fails (the central handler logs it once)', async () => {
    const { service, logger, notifier } = setup();
    notifier.failure = new Error('down');

    await caught(service.submit(REQUEST));

    expect(logger.records).toEqual([]);
  });
});
