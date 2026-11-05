## Context

The repo has the root toolchain only (npm workspaces, TypeScript, ESLint with the error-safety rules,
Prettier, Vitest). There is no `apps/api` yet. This change creates it with the cross-cutting pieces
that every later route and adapter relies on. The rules in `.claude/rules/` (architecture,
logging-and-errors, security, testing) are the constraints; this document records the choices that
those rules leave open.

Dependencies are limited to what this change needs: `fastify`, `@fastify/helmet`, `zod`, `pino`;
dev: `pino-pretty`, `tsx`. Later changes add `nodemailer`, `ioredis`, `@fastify/rate-limit`.

## Goals / Non-Goals

**Goals:**

- A tested app factory, config loader, logger, error model and lifecycle that later changes extend
  without modifying.
- Every failure path in this change is typed, logged once at the right level, and returns the
  shared envelope.
- Services and adapters written later can log with the request id without being passed a request.

**Non-Goals:**

- Domain ports other than `Logger`, any product or enquiry route, rate limiting, Redis, SMTP.
- Readiness probes, metrics, tracing.
- Container images and compose (`web-storefront`).

## Decisions

### 1. App factory with injected dependencies

`buildApp({ config, logger })` returns a Fastify instance and does not listen. `main.ts` is the only
place that reads the environment, builds the pino logger, calls `buildApp`, and listens. Later
changes add ports to the argument object (`catalogService`, `enquiryService`) rather than importing
singletons.

- Alternative: module-level `app` singleton. Rejected: tests would share state and adapters would be
  constructed at import time, breaking the composition-root rule.
- Trade-off: the argument object grows as changes land. Accepted; it is the explicit wiring list.

### 2. Fastify's own logger is off; we log through the `Logger` port

`Fastify({ logger: false })`. Hooks in `http/` write the access line
(`request completed`: method, route, status, `durationMs`) through the injected `Logger`.

- Alternative: pass pino as `loggerInstance` and use `request.log`. Rejected: it makes Fastify's
  logger the real logging API, so services would be tempted to take `FastifyBaseLogger` and the
  "domain and application never import Fastify or pino" rule would erode.
- Trade-off: Fastify's internal diagnostics (for example a plugin boot failure) are not logged by
  Fastify. Boot failures surface as a rejected `ready()`/`listen()` that `main.ts` catches and logs
  at `fatal`.

### 3. Request id and context: AsyncLocalStorage plus a pino `mixin`

- `genReqId` validates a supplied `x-request-id` against `^[A-Za-z0-9._:-]{1,64}$`; otherwise it
  returns `crypto.randomUUID()`. `requestIdHeader` is disabled so Fastify does not trust the raw
  header. An invalid header is replaced silently (the log line carries the new id).
- An `onRequest` hook sets the `x-request-id` response header (so errors and 404s carry it too) and
  runs the rest of the request inside `als.run({ reqId, method, route }, done)`.
  `http/request-context.ts` owns the store and exports `getRequestContext()`.
- `main.ts` builds the pino logger with `mixin: () => getRequestContext() ?? {}`, passing the getter
  in, so `infrastructure/` does not import from `http/`. Every line from any layer, written through
  the port, carries `reqId`, method and route with no logger-passing.
- Alternatives: (a) pass a request-scoped child `Logger` into each service call. Rejected: pollutes
  every service signature. (b) `fastify-request-context` plugin. Rejected: an extra dependency for
  ten lines.
- Risk: async context can be lost across some callback-style libraries. Mitigation: a test asserts a
  line logged from inside a fake service, after an `await`, carries the request's `reqId`.

### 4. Logger port shape

```ts
interface Logger {
  debug(obj: object, msg?: string): void; // plus (msg: string) overload
  info(...), warn(...), error(...), fatal(...)
  child(bindings: object): Logger;
}
```

pino-compatible argument order so the adapter is a thin delegate, but typed independently so pino
types never reach `domain/`. `fatal` is included because process-level handlers need it.

### 5. Redaction: explicit paths, no wildcards on `message` or `name`

The source plan listed `*.message` / `*.name`. A wildcard on `message` also matches the serialized
error (`err.message`), which would blind the error logs. Instead the redact list is one constant
(`REDACTED_PATHS`) of explicit paths: `req.headers.authorization`, `req.headers.cookie`,
`res.headers["set-cookie"]`, and `body.email|phone|message|name`, `enquiry.email|phone|message|name`.
Layers also never log request bodies; redaction is defence in depth, and a test pins both
behaviours (PII path censored, `err.message` still visible).

- Alternative: a custom serializer that strips known PII keys at any depth. Rejected for now: more
  code, harder to reason about; revisit if a new PII-bearing shape appears.

### 6. Error model and handler

- `AppError` (abstract-style base): `code`, `httpStatus`, `publicMessage`, `cause`, `details?`,
  `isOperational = true`. Subclasses carry fixed codes and statuses: `ValidationError` 400,
  `NotFoundError` 404, `RateLimitedError` 429 (with `retryAfterSeconds`), `UpstreamError` 502,
  `UpstreamTimeoutError` 504, `NotificationError` 502, `ConfigError` (startup only). All are defined
  now even though later changes raise most of them, so the handler's table test covers the full
  hierarchy once.
- Codes and public messages live in `domain/errors.ts` only (DRY).
- `http/error-handler.ts` is the single translation point. Order of mapping:
  1. `AppError` -> its own status, code, `publicMessage`, `details`; `RateLimitedError` also sets
     `Retry-After`.
  2. Fastify-originated client errors (`statusCode` 400-499, e.g. invalid JSON, body too large,
     unsupported media type) -> that status; code `PAYLOAD_TOO_LARGE` for 413, `BAD_REQUEST`
     otherwise; fixed generic message. Fastify's own message text is never returned. Only errors
     whose `code` starts with `FST_ERR_` qualify: a library error that merely carries a 4xx
     `statusCode` (e.g. an HTTP client response) is our failure and falls through to 3.
  3. Anything else -> 500, code `INTERNAL_ERROR`, message `Something went wrong`.
- The same handler is passed to Fastify's `frameworkErrors` option. Without it, errors raised
  before routing (a malformed URL such as `/%zz`) bypass the handler and return Fastify's raw body
  (which echoes the path) with no request id and no log line. The handler therefore also sets
  `x-request-id` itself.
- Logging in the handler (the only place an error is logged): status 4xx -> `warn` with `code`,
  status and no stack; 5xx -> `error` with the error object (stack and `cause` chain via pino's
  error serializer).
- `setNotFoundHandler` throws a `NotFoundError`, so unknown routes go through the same handler and
  produce the same envelope and `warn` log.
- Envelope: `{ error: { code, message, requestId, details? } }`. It is defined in the API for now;
  `catalogue-api` creates `packages/contracts` and moves the envelope schema and codes there so the
  web client parses the same definition.
- Alternative: Fastify JSON-schema validation with its `FST_ERR_VALIDATION`. Rejected: the project
  standard is zod schemas from `packages/contracts`; routes will parse with zod and throw
  `ValidationError` with field `details`.

### 7. Configuration

- `loadConfig(env = process.env)` in `config/` parses with a zod schema and returns a deeply
  `readonly` object. This is the only module that touches `process.env`.
- Variables in this change: `NODE_ENV` (`development|test|production`, default `development`),
  `HOST` (default `0.0.0.0`), `PORT` (default `3000`, 1024-65535, rootless-safe), `LOG_LEVEL`
  (default `info`), `REQUEST_TIMEOUT_MS` (default 10000), `BODY_LIMIT_BYTES` (default 10240),
  `SHUTDOWN_TIMEOUT_MS` (default 10000). Later changes extend the schema, they do not fork it.
- Failure: `ConfigError` whose `details` list each offending variable name and the rule it broke,
  never the offending value (a mistyped secret must not be echoed).
- `main.ts` catches `ConfigError`, logs `fatal` through a bootstrap logger (level `info`, no
  request context, built before config exists) and exits 1.
- The startup `info` summary is produced by a `describeConfig()` allowlist, so adding a secret field
  later does not leak it by default.
- `pino-pretty` is enabled only when `NODE_ENV=development`; containers run `production` and emit
  JSON.

### 8. HTTP hardening baseline

- `@fastify/helmet` registered with defaults.
- `bodyLimit` and `requestTimeout` from config.
- `keepAliveTimeout` 65 s (above the 60 s default idle timeout of AWS load balancers, to avoid
  intermittent 502s). `connectionTimeout` is not set: it closes idle keep-alive sockets and would
  work against that.
- CORS: no CORS plugin is registered; a test asserts that no `access-control-allow-origin` header
  is returned, so "closed" is verified rather than assumed.
- `trustProxy` is left at the default (off) here. It is decided together with the rate limiter in
  `product-enquiry`, where the client IP first matters.

### 9. Health endpoint

`GET /healthz` returns `200 { "status": "ok" }`, no dependency checks (liveness). Its completed
line logs at `debug` so probes do not dominate the logs. Fail-open or fail-closed is not applicable
here; there is no dependency to degrade.

### 10. Process lifecycle in a testable module

`src/lifecycle.ts` exports `createShutdown(...)` and `installProcessHandlers(...)`, each taking the
logger, an `exit` function and (for the handlers) a `process`-like event emitter as arguments.
`main.ts` passes the real ones. This is how "test its failure behaviour" is met without killing
the test runner.

- Shutdown: idempotent (a second signal while shutting down is logged and ignored). Steps: log
  `info`, stop accepting and drain with `app.close()` (`forceCloseConnections: 'idle'`), then run
  registered closers in reverse registration order (later changes register Redis and SMTP
  transport), log `info`, exit 0. A hard timer (`SHUTDOWN_TIMEOUT_MS`, deliberately not `unref`'d, so
  an empty event loop cannot exit 0 early) logs `error` and exits 1 if shutdown stalls. A closer that throws is logged at `error`, the remaining closers
  still run, and the exit code is 1.
- `unhandledRejection` and `uncaughtException`: log `fatal` with the error and exit 1 without
  attempting graceful shutdown (the process state is unknown; the orchestrator restarts it).
- Alternative: try a graceful close inside `uncaughtException`. Rejected: continuing to run user
  code after an uncaught exception is unsafe, and the 10 s window can mask a crash loop.

- Keep-alive sockets: Fastify's `forceCloseConnections: 'idle'` only reaps sockets that are idle at
  the moment `close()` starts. A request in flight at that moment would leave its keep-alive socket
  open and `close()` would wait for `keepAliveTimeout` (65 s), hitting the hard timeout. A
  `preClose` flag plus an `onSend` hook therefore sends `Connection: close` on every response
  finished while closing. Found by a loopback-socket test, not by the mocked unit tests.

### 11. Build and TypeScript setup

- ESM with `module`/`moduleResolution` `NodeNext` set in `apps/api/tsconfig.json` (the base config
  stays module-agnostic so `apps/web` can use `Bundler`). Relative imports carry `.js` extensions.
- `tsconfig.json` covers `src` and `test` for typecheck and for ESLint's `projectService`;
  `tsconfig.build.json` covers `src` only for `tsc` output to `dist/`.
- `tsx` for local `dev`; production runs compiled `dist/main.js` on Node 22.

### 12. Test support

`test/support/fake-logger.ts` records calls (level, object, message, bindings) for assertions.
Pino adapter and redaction tests write to an in-memory stream and parse the JSON lines. Tests use
`app.inject()` and never open a port. No real network, clock or process exit.

## Risks / Trade-offs

- [Async context lost, so lines miss `reqId`] -> Test through an awaited fake service; the failure
  is visible in CI, not in production.
- [Redaction list drifts from the fields that actually carry PII] -> One `REDACTED_PATHS` constant;
  the enquiry change adds its own logging test asserting the submitted values never appear.
- [Fastify internal errors are no longer logged by Fastify] -> `listen()`/`ready()` failures are
  caught in `main.ts`; request-time errors go through the error handler.
- [Node-level rejections are outside the envelope: `requestTimeout` expiry (raw 408) and
  `clientError` responses are written by Node before Fastify runs, with no envelope, request id or
  log line] -> Accepted for a proof of concept; a `clientErrorHandler` is the next step.
- [Framework errors raised before the hooks run (malformed URL) carry no helmet security headers]
  -> Accepted: the body is the generic envelope and holds no content that headers protect.
- [With `pretty` on, `process.exit(1)` right after a `fatal` line can drop it, because the
  pino-pretty transport is asynchronous] -> Dev only; containers run JSON to stdout synchronously.
- [A new Fastify 4xx type has an awkward code] -> It still gets a generic `BAD_REQUEST` envelope and
  a `warn` line; add a specific code when a client needs to branch on it.
- [Hard exit on `uncaughtException` drops in-flight requests] -> Accepted; correctness over
  availability for an unknown state, and the orchestrator restarts the task.
- [`NodeNext` `.js` import suffixes are easy to forget] -> `tsc` fails on them; the typecheck gate
  catches it.

## Open Questions

- Whether `catalogue-api` should create `packages/contracts` early enough to host the error
  envelope schema, or whether the envelope stays in the API until the web app needs it. Default:
  move it in `catalogue-api`.
