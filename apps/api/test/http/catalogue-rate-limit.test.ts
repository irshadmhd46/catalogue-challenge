import { describe, expect, it } from 'vitest';
import { buildAppWithFakeLogger } from '../support/build-test-app.js';
import { FakeProductSource } from '../support/fake-product-source.js';

const CLIENT = '203.0.113.9';

async function setup(env: Record<string, string> = {}) {
  const source = new FakeProductSource();
  const built = await buildAppWithFakeLogger(env, { source });
  const get = (url: string, remoteAddress = CLIENT) =>
    built.app.inject({ method: 'GET', url, remoteAddress });
  return { ...built, source, get };
}

const ROUTES = [
  '/api/v1/featured',
  '/api/v1/categories',
  '/api/v1/categories/electronics',
  '/api/v1/products?q=backpack',
  '/api/v1/products/1',
];

describe('catalogue reads are rate limited', () => {
  it('reports the default read limit of 120 and what is left', async () => {
    const { get } = await setup();

    const res = await get('/api/v1/featured');

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('120');
    expect(res.headers['x-ratelimit-remaining']).toBe('119');
  });

  it('puts every catalogue route in one shared bucket', async () => {
    const { get } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '5' });
    const statuses: number[] = [];
    for (const url of ROUTES) statuses.push((await get(url)).statusCode);

    const sixth = await get('/api/v1/featured');

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(sixth.statusCode).toBe(429);
  });

  it('answers 121 reads in a window with 120 successes and a 429', async () => {
    const { get } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 121; i += 1) statuses.push((await get('/api/v1/categories')).statusCode);

    expect(statuses.filter((s) => s === 200)).toHaveLength(120);
    expect(statuses[120]).toBe(429);
  });

  it('answers over the limit with the shared envelope, and does not call the service', async () => {
    const { get, source } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    await get('/api/v1/featured');
    const callsBefore = source.listCalls;

    const denied = await get('/api/v1/featured');

    expect(denied.statusCode).toBe(429);
    expect(denied.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    });
    expect(Number(denied.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(source.listCalls).toBe(callsBefore);
  });

  it('stops requests for distinct unknown product ids reaching the source once the limit is hit', async () => {
    const { get, source } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '3' });

    const statuses: number[] = [];
    for (let id = 9000; id < 9010; id += 1) {
      statuses.push((await get(`/api/v1/products/${String(id)}`)).statusCode);
    }

    expect(statuses).toEqual([404, 404, 404, 429, 429, 429, 429, 429, 429, 429]);
    expect(source.findCalls).toEqual([9000, 9001, 9002]);
  });

  it('counts invalid requests too, so probing with bad ids is limited', async () => {
    const { get, source } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '2' });

    const statuses: number[] = [];
    for (const id of ['abc', '0', '-1', '1e3'])
      statuses.push((await get(`/api/v1/products/${id}`)).statusCode);

    expect(statuses).toEqual([400, 400, 429, 429]);
    expect(source.findCalls).toEqual([]);
  });

  it('limits each client separately', async () => {
    const { get } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    await get('/api/v1/featured', '203.0.113.9');

    expect((await get('/api/v1/featured', '203.0.113.9')).statusCode).toBe(429);
    expect((await get('/api/v1/featured', '198.51.100.7')).statusCode).toBe(200);
  });

  it('does not limit the health check', async () => {
    const { app } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push(
        (await app.inject({ method: 'GET', url: '/healthz', remoteAddress: CLIENT })).statusCode,
      );
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it('counts HEAD requests like reads', async () => {
    const { app } = await setup({ RATE_LIMIT_READ_PER_MINUTE: '1' });
    await app.inject({ method: 'HEAD', url: '/api/v1/featured', remoteAddress: CLIENT });

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/featured',
      remoteAddress: CLIENT,
    });

    expect(denied.statusCode).toBe(429);
  });
});
