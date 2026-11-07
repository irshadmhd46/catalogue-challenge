import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../api/errors';
import { ErrorMessage } from './ErrorMessage';

interface Props<T> {
  readonly query: UseQueryResult<T>;
  /** Shown instead of an error when the server answers 404. */
  readonly notFound?: ReactNode;
  readonly isEmpty?: (data: T) => boolean;
  readonly emptyMessage?: string;
  readonly children: (data: T) => ReactNode;
}

/** A 4xx other than 429 will answer the same way again, so offering "Try again" would mislead. */
function isRetryable(error: unknown): boolean {
  return !(
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/** Every data view goes through here, so loading, error and empty states are never forgotten. */
export function QueryState<T>({ query, notFound, isEmpty, emptyMessage, children }: Props<T>) {
  if (query.isPending) {
    return <p role="status">Loading…</p>;
  }
  if (query.isError) {
    if (notFound !== undefined && query.error instanceof ApiError && query.error.status === 404) {
      return <>{notFound}</>;
    }
    return (
      <ErrorMessage
        error={query.error}
        onRetry={isRetryable(query.error) ? () => void query.refetch() : undefined}
      />
    );
  }
  if (isEmpty?.(query.data) === true) {
    return <p>{emptyMessage ?? 'Nothing to show.'}</p>;
  }
  return <>{children(query.data)}</>;
}
