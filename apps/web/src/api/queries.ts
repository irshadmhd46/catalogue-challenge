import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './errors';

const MAX_READ_RETRIES = 2;

/** Retry network failures and server errors; a 4xx will answer the same way again. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_READ_RETRIES) {
    return false;
  }
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
