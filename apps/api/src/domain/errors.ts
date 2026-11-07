export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  NOTIFICATION_FAILED: 'NOTIFICATION_FAILED',
  CONFIG_INVALID: 'CONFIG_INVALID',
  BAD_REQUEST: 'BAD_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const PUBLIC_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Invalid request',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  UPSTREAM_ERROR: 'Upstream service unavailable',
  UPSTREAM_TIMEOUT: 'Upstream service timed out',
  NOTIFICATION_FAILED: 'Could not send the message',
  CONFIG_INVALID: 'Invalid configuration',
  BAD_REQUEST: 'Bad request',
  PAYLOAD_TOO_LARGE: 'Request body too large',
  INTERNAL_ERROR: 'Something went wrong',
};

export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

export type ErrorDetails = readonly FieldIssue[];

export interface AppErrorOptions {
  readonly cause?: unknown;
  readonly details?: ErrorDetails;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  readonly publicMessage: string;
  readonly details?: ErrorDetails;
  readonly isOperational = true;

  protected constructor(publicMessage: string, options: AppErrorOptions = {}) {
    super(publicMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.publicMessage = publicMessage;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export class ValidationError extends AppError {
  readonly code = ERROR_CODES.VALIDATION_ERROR;
  readonly httpStatus = 400;

  constructor(options: AppErrorOptions = {}) {
    super(PUBLIC_MESSAGES.VALIDATION_ERROR, options);
  }
}

export class NotFoundError extends AppError {
  readonly code = ERROR_CODES.NOT_FOUND;
  readonly httpStatus = 404;

  constructor(
    readonly resource: string,
    readonly resourceId?: string,
    options: AppErrorOptions = {},
  ) {
    super(`${resource.charAt(0).toUpperCase()}${resource.slice(1)} not found`, options);
  }
}

export class RateLimitedError extends AppError {
  readonly code = ERROR_CODES.RATE_LIMITED;
  readonly httpStatus = 429;

  constructor(
    readonly retryAfterSeconds: number,
    options: AppErrorOptions = {},
  ) {
    super(PUBLIC_MESSAGES.RATE_LIMITED, options);
  }
}

export class UpstreamError extends AppError {
  readonly code = ERROR_CODES.UPSTREAM_ERROR;
  readonly httpStatus = 502;

  constructor(options: AppErrorOptions = {}) {
    super(PUBLIC_MESSAGES.UPSTREAM_ERROR, options);
  }
}

export class UpstreamTimeoutError extends AppError {
  readonly code = ERROR_CODES.UPSTREAM_TIMEOUT;
  readonly httpStatus = 504;

  constructor(options: AppErrorOptions = {}) {
    super(PUBLIC_MESSAGES.UPSTREAM_TIMEOUT, options);
  }
}

export class NotificationError extends AppError {
  readonly code = ERROR_CODES.NOTIFICATION_FAILED;
  readonly httpStatus = 502;
  /** For the log line only: lets support match a visitor's retry to the failed attempt. */
  declare readonly enquiryId?: string;

  constructor(options: AppErrorOptions & { readonly enquiryId?: string } = {}) {
    super(PUBLIC_MESSAGES.NOTIFICATION_FAILED, options);
    if (options.enquiryId !== undefined) {
      this.enquiryId = options.enquiryId;
    }
  }
}

/** Startup only: never sent over HTTP. Details name variables and rules, never values. */
export class ConfigError extends AppError {
  readonly code = ERROR_CODES.CONFIG_INVALID;
  readonly httpStatus = 500;

  constructor(issues: ErrorDetails, options: Omit<AppErrorOptions, 'details'> = {}) {
    super(PUBLIC_MESSAGES.CONFIG_INVALID, { ...options, details: issues });
    this.message = `${PUBLIC_MESSAGES.CONFIG_INVALID}: ${issues.map((issue) => issue.field).join(', ')}`;
  }
}

/** Cache adapter failure. Callers degrade to a miss; if it ever escapes it is a generic 500. */
export class CacheError extends AppError {
  readonly code = ERROR_CODES.INTERNAL_ERROR;
  readonly httpStatus = 500;

  constructor(options: AppErrorOptions = {}) {
    super(PUBLIC_MESSAGES.INTERNAL_ERROR, options);
  }
}
