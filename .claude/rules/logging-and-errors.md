# Logging and Error Handling

Every failure path is **typed, caught at the right layer, logged once at the right level, and
turned into a safe response**. No empty catches, no swallowed errors, no `console.log`, no string
throws.

## Logging (pino, structured JSON)

| Level   | Use for                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| `debug` | cache hit/miss, upstream timings, mapper details                                         |
| `info`  | startup + non-secret config summary, request completed, enquiry sent, shutdown           |
| `warn`  | 4xx, validation failure, rate limited, upstream retry, stale cache served, degraded cache|
| `error` | 5xx, upstream exhausted, SMTP failure, unexpected exception                              |
| `fatal` | process-level crash (then exit)                                                          |

- `x-request-id` is accepted when valid (length/charset checked), else generated, and returned on
  every response. A request-scoped child logger puts `reqId`, method and route on every line,
  including lines written from services and adapters through the `Logger` port.
- **Log once.** The central error handler logs the error. Layers that translate and rethrow add
  context through `cause` and do not log again.
- 4xx logs at `warn` without a stack. 5xx logs at `error` with stack and full `cause` chain.
- **Never log PII.** Redact authorization/cookie headers and `email`, `phone`, `message`, `name`.
  Enquiry logs carry `enquiryId`, `productId` and outcome only.
- Outbound call logs: target host, `durationMs`, `status`, `attempt`.
- JSON to stdout in containers. `pino-pretty` only in local dev.
- Domain and application code receive a `Logger` port; they never import pino or Fastify.

## Error model

All expected failures extend `AppError` (`code`, `httpStatus`, `publicMessage`, `cause`,
`details?`): `ValidationError` 400, `NotFoundError` 404, `RateLimitedError` 429, `UpstreamError` 502,
`UpstreamTimeoutError` 504, `NotificationError` 502, `ConfigError` (startup only).
Anything else is a programmer error: respond 500 `Something went wrong`; detail only in logs.

## Where to catch

- **Adapters** catch low-level errors (fetch/abort, nodemailer, ioredis, JSON, ZodError) and
  rethrow a typed error with `cause`. They never return `null` to hide a failure.
- **Services** throw domain errors. No try/catch unless it adds behaviour (fallback, translation).
- **One central `setErrorHandler`** converts errors to the response envelope
  `{ error: { code, message, requestId, details? } }`. `setNotFoundHandler` uses the same envelope.
- **Process level**: `unhandledRejection` / `uncaughtException` log `fatal` and exit non-zero.
  `SIGTERM`/`SIGINT` perform a graceful shutdown with a hard timeout.

## Resilience rules

- Every external call has a timeout. Retry only idempotent GETs, on network error/5xx/429, a
  bounded number of times with backoff and jitter. Never retry non-idempotent calls (SMTP send).
- A cache is an optimisation, never a dependency: cache read/write failures log `warn` and are
  treated as a miss.
- Serve stale data (clearly logged) rather than fail when the upstream is down and a last-good
  copy exists.
- Validate upstream responses with a schema; a wrong shape is an `UpstreamError`, not a crash later.
- Decide fail-open vs fail-closed explicitly for every degraded dependency and record it.

## Client (React)

- The API module throws `ApiError` (status, code, message, requestId) or `NetworkError`. Components
  never see raw `fetch` errors.
- Retry only network errors and 5xx. Never retry 4xx.
- Root and route-level error boundaries. Every data view has loading, error and empty states.
- Error UI shows a reference id (the server `requestId`) so support can find the log line.
- Forms: map 400 `details` to field errors, preserve user input on failure, disable submit while in
  flight, show success only after the server confirms.

## Lint enforcement

`no-floating-promises`, `no-misused-promises`, `only-throw-error`, `no-console`, `no-empty`
(no empty catch) are errors in `eslint.config.js`.
