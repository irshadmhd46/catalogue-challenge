import type { Product } from '@catalogue/contracts';
import { vi } from 'vitest';

export type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const errorBody = (
  code: string,
  message: string,
  requestId = 'req-1',
  details?: { field: string; message: string }[],
) => ({ error: { code, message, requestId, ...(details ? { details } : {}) } });

export function product(id: number, overrides: Partial<Product> = {}): Product {
  return {
    id,
    title: `Product ${String(id)}`,
    description: `Description of product ${String(id)}`,
    price: 10 + id,
    category: { slug: 'electronics', name: 'Electronics' },
    imageUrl: `https://img.test/${String(id)}.png`,
    rating: { average: 4.2, count: 100 + id },
    ...overrides,
  };
}

/**
 * Replaces `fetch` with a router keyed by "METHOD /path?query". An unknown request fails the test
 * loudly instead of hanging, so a view calling an unexpected endpoint is caught.
 */
export function stubApi(handlers: Record<string, Handler>) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push({ key, init });
    const handler = handlers[key];
    if (handler === undefined) {
      return Promise.reject(new Error(`unexpected request: ${key}`));
    }
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, count: (key: string) => calls.filter((c) => c.key === key).length };
}
