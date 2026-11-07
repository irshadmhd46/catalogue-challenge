export interface FieldDetail {
  readonly field: string;
  readonly message: string;
}

/** The server answered, but with an error (or with something we cannot use). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The server's request id, shown to the visitor so support can find the log line. */
    readonly requestId: string | undefined,
    readonly details: readonly FieldDetail[] | undefined = undefined,
    readonly retryAfterSeconds: number | undefined = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The server could not be reached, or did not answer in time. */
export class NetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The server could not be reached', options);
    this.name = 'NetworkError';
  }
}
