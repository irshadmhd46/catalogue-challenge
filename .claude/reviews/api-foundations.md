# Review gate: api-foundations

Both reviews ran against the committed change (`f164b75..HEAD`, `apps/api`), code-reviewer first,
security-reviewer second. Tests at the time of each review: typecheck, lint and all tests green on
Node 22.

## 1. code-reviewer: verdict WARNING (1 HIGH, 3 MEDIUM, 4 LOW)

| Severity | Finding | Disposition |
| --- | --- | --- |
| HIGH | Malformed URL (`/%zz`) bypassed the error handler: Fastify's raw body echoed the path, no `x-request-id`, no log line. Reproduced. | Fixed: handler also passed to `frameworkErrors`; handler sets the request id itself. Tests in `error-handler-edge.test.ts`. |
| MEDIUM | Handler-written log lines never tested with request context (deleting `runWithRequestContext` failed nothing). | Fixed: tests through the real pino adapter for 4xx, 5xx (stack + cause) and bad URL. |
| MEDIUM | "In-flight request completes" only tested against a mocked `close()`. | Fixed: loopback-socket test. It exposed a real bug (see below). |
| MEDIUM | Any error with a 4xx `statusCode` treated as a client error (hides upstream failures from error alerting). | Fixed: only `FST_ERR_*` framework errors qualify; table test for 401/404/429 plain errors. |
| LOW | `pretty: true` branch untested; async transport can drop the last line before `process.exit`. | Accepted, recorded in design (dev only). |
| LOW | Shutdown hard timer was `unref`'d, so an empty event loop could exit 0 early. | Fixed: timer is ref'd. |
| LOW | `ConfigError.publicMessage` carried variable names. | Fixed: generic public message, names only in `message`/`details`. |
| LOW | Node-level rejections (raw 408, `clientError`) bypass the envelope. | Accepted, recorded in design; `clientErrorHandler` is a next step. |

Bug found by the new real-server test (not by any reviewer reading): a request in flight when
`SIGTERM` arrives left its keep-alive socket open, because Fastify's `forceCloseConnections:
'idle'` only reaps sockets that are idle at the moment `close()` starts. `close()` then waited for
`keepAliveTimeout` and hit the hard timeout (exit 1). Fixed with a `preClose` flag and an `onSend`
hook that sends `Connection: close` while closing.

## 2. security-reviewer: verdict APPROVE (0 CRITICAL, 0 HIGH, 0 MEDIUM, 6 LOW)

Verified clean: helmet registered and present on live responses; CORS absent (preflight returns no
`access-control-*`); body limit, request timeout and keep-alive timeout really configured; no
information leakage in responses (path, stack, library messages, config values); request id
charset/length safe against log and header injection; `process.env` read only in `config/` and the
composition root; no secrets; lockfile resolves only to the public registry; no work-related names,
hosts or paths (rule 7).

| # | LOW finding | Disposition |
| - | --- | --- |
| 1 | Lockfile still records `engines.node >=20` for the workspace; `vitest` 4.x at the root and 5.x nested under `apps/api` (via `@vitest/coverage-v8`). | Open: needs `npm install` with network access. Owner to align the vitest majors and regenerate the lock. |
| 2 | Redaction paths protect shapes nothing logs yet; the real PII risk is `err` content (e.g. SMTP rejection embedding the recipient). | Deferred to `product-enquiry`: add `err.response` / `err.command` / cause paths and the "submitted email never appears in any log line" test. |
| 3 | Fatal exit on `unhandledRejection` is a remote kill switch once routes can leak a floating promise. | Accepted by design; mitigated by the lint rules, which stay errors. |
| 4 | No explicit connection caps (`maxRequestsPerSocket`, `connectionTimeout`). | Revisit with the edge setup in `web-storefront`. |
| 5 | Numeric config values had no upper bound. | Fixed: `REQUEST_TIMEOUT_MS` and `SHUTDOWN_TIMEOUT_MS` max 120000, `BODY_LIMIT_BYTES` max 1 MiB, tested at the boundary. |
| 6 | Caller-supplied request ids can collide with other ids. | Accepted: `reqId` is for log correlation only, never authorisation. |

## 3. Dependency audit: NOT VERIFIED

`npm audit --audit-level=high` could not run from the build machine: Node's TLS connection to the
npm audit endpoint is reset (`ECONNRESET`), although `curl` reaches the registry. The owner must
run `npm audit --audit-level=high` from a network where it works before hand-off and record any
exception in `DECISIONS.md` (not created yet).
