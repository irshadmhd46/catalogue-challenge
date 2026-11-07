import { ApiError, NetworkError } from '../api/errors';

export function describeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (error.status >= 500) {
      return 'Something went wrong on our side. Please try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export function referenceOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

interface Props {
  readonly error: unknown;
  readonly onRetry?: () => void;
}

export function ErrorMessage({ error, onRetry }: Props) {
  const reference = referenceOf(error);
  return (
    <div className="notice notice--error" role="alert">
      <p>{describeError(error)}</p>
      {reference !== undefined && <p className="notice__reference">Reference: {reference}</p>}
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
