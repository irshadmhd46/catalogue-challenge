import type { FastifyInstance } from 'fastify';
import {
  AppError,
  ERROR_CODES,
  NotFoundError,
  PUBLIC_MESSAGES,
  RateLimitedError,
  type ErrorCode,
  type ErrorDetails,
} from '../domain/errors.js';
import type { Logger } from '../domain/logger.js';
import { contextOf, runWithRequestContext } from './request-context.js';

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: ErrorDetails;
  };
}

interface ErrorResponse {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: ErrorDetails;
  readonly retryAfterSeconds?: number;
}

const HTTP_PAYLOAD_TOO_LARGE = 413;

function clientStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined;
  }
  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.publicMessage,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error instanceof RateLimitedError ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    };
  }

  const clientStatus = clientStatusOf(error);
  if (clientStatus !== undefined) {
    const code =
      clientStatus === HTTP_PAYLOAD_TOO_LARGE
        ? ERROR_CODES.PAYLOAD_TOO_LARGE
        : ERROR_CODES.BAD_REQUEST;
    return { status: clientStatus, code, message: PUBLIC_MESSAGES[code] };
  }

  return {
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: PUBLIC_MESSAGES.INTERNAL_ERROR,
  };
}

/** The only place errors become HTTP responses, and the only place they are logged. */
export function registerErrorHandling(app: FastifyInstance, logger: Logger): void {
  app.setNotFoundHandler(() => {
    throw new NotFoundError('route');
  });

  app.setErrorHandler((error, request, reply) => {
    const response = toErrorResponse(error);

    runWithRequestContext(contextOf(request), () => {
      if (response.status >= 500) {
        logger.error(
          { err: error, code: response.code, statusCode: response.status },
          'request failed',
        );
      } else {
        logger.warn({ code: response.code, statusCode: response.status }, 'request rejected');
      }
    });

    if (response.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(response.retryAfterSeconds));
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: response.code,
        message: response.message,
        requestId: request.id,
        ...(response.details === undefined ? {} : { details: response.details }),
      },
    };
    void reply.status(response.status).send(envelope);
  });
}
