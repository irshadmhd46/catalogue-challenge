## 1. Workspace setup

- [x] 1.1 Create `apps/api` with `package.json` (name `@catalogue/api`, `type: module`, scripts `dev`, `build`, `typecheck`, `test`, `test:coverage`), `tsconfig.json` (NodeNext, includes `src` and `test`), `tsconfig.build.json` (`src` only, `dist/`), and `vitest.config.ts` (node environment, coverage on `src` excluding `main.ts`)
- [x] 1.2 Install `fastify`, `@fastify/helmet`, `zod`, `pino`; dev `pino-pretty`, `tsx`; commit the lockfile
- [x] 1.3 Add `.env.example` with placeholder values for every variable in the config schema
- [x] 1.4 Verify `npm run typecheck`, `npm run lint` and `npm test` run for the new workspace (empty suite passes, `--passWithNoTests` if needed)

## 2. Error model (domain)

- [x] 2.1 Write `test/domain/errors.test.ts` (RED): table-driven code/status per subclass, `isOperational`, `cause` preserved, safe `publicMessage`, `NotFoundError` message and no `details`
- [x] 2.2 Implement `src/domain/errors.ts` (GREEN): `AppError`, `ValidationError`, `NotFoundError`, `RateLimitedError` (`retryAfterSeconds`), `UpstreamError`, `UpstreamTimeoutError`, `NotificationError`, `ConfigError`; codes and public messages defined once

## 3. Logger port and pino adapter

- [x] 3.1 Implement `src/domain/logger.ts`: `Logger` port (`debug`, `info`, `warn`, `error`, `fatal`, `child`)
- [x] 3.2 Implement `src/infrastructure/logging/pino-logger.ts`: factory taking `level`, `pretty`, `destination`, `getContext`; `REDACTED_PATHS` constant; `mixin` from `getContext`; pretty transport only when `pretty` is true
- [x] 3.3 Add `test/support/fake-logger.ts` recording level, object, message and bindings
- [x] 3.4 Write `test/infrastructure/pino-logger.test.ts`: JSON line shape, child bindings, level threshold, no pretty transport in production, context mixin appears and is absent outside a request
- [x] 3.5 Add redaction tests: authorization header, cookie, `set-cookie`, enquiry fields censored; `err.message` and stack still visible

## 4. Configuration

- [x] 4.1 Write `test/config/config.test.ts` (RED): defaults, explicit overrides, `PORT` non-numeric / below 1024 / above 65535, unknown `LOG_LEVEL`, several errors reported together, offending value never in message or details, frozen result
- [x] 4.2 Implement `src/config/index.ts` (GREEN): zod schema, `loadConfig(env = process.env)`, `readonly` result type, `ConfigError` with variable names and rules only
- [x] 4.3 Implement `describeConfig()` allowlist summary and test that a non-allowlisted field is omitted

## 5. HTTP layer

- [x] 5.1 Implement `src/http/request-context.ts`: `AsyncLocalStorage` store, `runWithRequestContext`, `getRequestContext`
- [x] 5.2 Implement `src/http/request-id.ts`: pattern constant, `generateRequestId(rawHeader)` (valid echo, else UUID)
- [x] 5.3 Test request id: valid echoed, absent generates UUID, space / newline / 65 chars / empty replaced
- [x] 5.4 Implement `src/http/error-handler.ts`: `AppError` mapping, Fastify 4xx mapping (`BAD_REQUEST`, `PAYLOAD_TOO_LARGE`), generic 500, `Retry-After`, envelope, single log call with level by status; `NotFound` handler that throws `NotFoundError`
- [x] 5.5 Test error handler, table-driven over every `AppError` subclass: status, code, message, `requestId` equals header, envelope shape, `details` present only when set
- [x] 5.6 Test error handler: `RateLimitedError` sets `Retry-After`; unknown `Error` gives generic 500 without message or stack in the body; non-Error throw gives generic 500
- [x] 5.7 Test error handler: malformed JSON gives 400 `BAD_REQUEST` without parser text; oversize body gives 413 `PAYLOAD_TOO_LARGE`; unsupported media type gives 415; unknown path and `DELETE /healthz` give the 404 envelope
- [x] 5.8 Test error logging with the fake logger: 4xx is one `warn` without stack, 5xx is one `error` with stack and cause chain, unknown route is one `warn`, no second `warn`/`error` line per request
- [x] 5.9 Implement `src/http/health.ts` route and `src/app.ts` `buildApp({ config, logger })`: Fastify options (`logger: false`, `bodyLimit`, `requestTimeout`, `keepAliveTimeout` 65 s, `forceCloseConnections: 'idle'`, `genReqId`, `requestIdHeader: false`), helmet, `onRequest` hook (header + context), `onResponse` access line (`debug` for `/healthz`, `info` otherwise), error and not-found handlers
- [x] 5.10 Test health: 200 and exact body `{"status":"ok"}`; access line for `/healthz` is `debug` and absent at `info`; other routes log `info`
- [x] 5.11 Test request id on responses: echoed, generated, replaced when invalid, present on error and 404 responses
- [x] 5.12 Test request context: access line has `reqId`, `method`, `route`, `statusCode`, numeric `durationMs`; a line from a fake service after an `await` carries the same `reqId`; two concurrent requests keep their own ids
- [x] 5.13 Test hardening: `x-content-type-options` and `content-security-policy` present on 200 and 404, no `x-powered-by`, no `access-control-allow-origin` with an `Origin` header, body limit boundary (100 accepted by the parser, 101 gives 413)
- [x] 5.14 Run `grep -rn "helmet\|bodyLimit\|requestTimeout" apps/api/src` and confirm the real registrations exist (security rule: claims verified in code)

## 6. Lifecycle and composition root

- [x] 6.1 Write `test/lifecycle.test.ts` (RED) with fake logger, fake `exit`, fake timers and a fake process emitter: clean shutdown order, in-flight completion, second signal ignored with `warn`, failing closer continues and exits 1, stall exits 1 after `shutdownTimeoutMs`, `unhandledRejection` (Error and string) and `uncaughtException` log `fatal` and exit 1
- [x] 6.2 Implement `src/lifecycle.ts` (GREEN): `createShutdown({ app, closers, logger, exit, timeoutMs })` with `registerCloser`, idempotent run, unref'd hard timer; `installProcessHandlers({ proc, logger, shutdown, exit })`
- [x] 6.3 Implement `src/main.ts`: bootstrap logger, `loadConfig`, build logger with `getRequestContext`, `buildApp`, install handlers, `listen`, log `info` config summary; on `ConfigError` log `fatal` and exit 1; on `listen` failure log `fatal` and exit 1
- [x] 6.4 Test startup failure behaviour: extract `bootstrap(deps)` returning an exit code or throwing, so `ConfigError` (fatal line names variables, no value, exit 1, never listens) and `EADDRINUSE` (fatal, exit 1) are tested without starting a real process
- [x] 6.5 Run the built service locally (`npm run build -w @catalogue/api && node apps/api/dist/main.js`): `curl /healthz`, `curl /nope` (envelope + `x-request-id`), `kill -TERM` (graceful `info` lines, exit 0), `PORT=abc` (fatal line, non-zero exit)

## 7. Quality gates

- [x] 7.1 Add two throwaway files under `apps/api/src` (a floating promise and a `console.log`), confirm `npm run lint` fails on each, then delete them
- [x] 7.2 Design principles check: SRP, DRY (codes, messages and redaction paths defined once), DIP (`new` of adapters only in `main.ts`), no presentation leak into domain
- [ ] 7.3 Run `npm run typecheck && npm run lint && npm test` and `npm run test:coverage` (target 80%+ on `domain/`, `config/`, `http/`, `infrastructure/logging/`) and `npm audit --audit-level=high`
- [ ] 7.4 Review gate: run the `code-reviewer` agent, then the `security-reviewer` agent; fix CRITICAL and HIGH findings, MEDIUM where cheap; save the report to `.claude/reviews/api-foundations.md`
- [ ] 7.5 Add anything the reviews caught that the building pass got wrong to `AI_USAGE.md`
- [ ] 7.6 Commit in logical units (workspace, errors, logging, config, http, lifecycle) using conventional commits; review `git status` and the diff before each; no remote, no push
