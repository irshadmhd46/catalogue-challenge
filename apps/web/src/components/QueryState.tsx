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

/** Every data view goes through here, so loading, error and empty states are never forgotten. */
export function QueryState<T>({ query, notFound, isEmpty, emptyMessage, children }: Props<T>) {
  if (query.isPending) {
    return <p role="status">Loading…</p>;
  }
  if (query.isError) {
    if (notFound !== undefined && query.error instanceof ApiError && query.error.status === 404) {
      return <>{notFound}</>;
    }
    return <ErrorMessage error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data) === true) {
    return <p>{emptyMessage ?? 'Nothing to show.'}</p>;
  }
  return <>{children(query.data)}</>;
}
