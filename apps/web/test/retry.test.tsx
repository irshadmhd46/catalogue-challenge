import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeatured } from '../src/api/hooks';
import { createQueryClient } from '../src/api/queries';
import { errorBody, json, stubApi } from './support/api-stub';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function run(status: number) {
  const api = stubApi({
    'GET /api/v1/featured': () => json(errorBody('X', 'x', 'req-1'), status),
  });
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useFeatured(), { wrapper });
  await vi.advanceTimersByTimeAsync(10_000);
  return { api, result };
}

describe('the application query client retries reads', () => {
  it('makes three attempts in total for a 502, then shows the error', async () => {
    const { api, result } = await run(502);

    expect(api.count('GET /api/v1/featured')).toBe(3);
    expect(result.current.isError).toBe(true);
  });

  it.each([400, 404, 429])('makes a single attempt for a %i', async (status) => {
    const { api, result } = await run(status);

    expect(api.count('GET /api/v1/featured')).toBe(1);
    expect(result.current.isError).toBe(true);
  });
});
