## Why

Every later change (catalogue, enquiry, storefront) depends on the same cross-cutting behaviour:
validated configuration, structured logging with correlation, one error model, and a safe process
lifecycle. Retrofitting these after feature code exists means touching every route and adapter, and
failure paths end up inconsistent. Building and testing them first gives later changes a stable
base to plug ports and routes into.

## What Changes

- Create the `apps/api` workspace: Fastify + TypeScript skeleton with an app factory that takes its
  dependencies as arguments (so tests use `inject()` and fakes, and only `main.ts` builds adapters).
- Add zod-validated environment configuration in `config/` that fails fast with a `ConfigError`.
- Add the `Logger` port in `domain/` and a pino adapter in `infrastructure/logging/`, with
  redaction of secrets and PII fields.
- Add request correlation: accept a valid `x-request-id` or generate one, return it on every
  response, and give each request a child logger carrying `reqId`, method and route.
- Add the typed `AppError` hierarchy in `domain/errors.ts` and the single central error handler plus
  not-found handler in `http/error-handler.ts`, producing one JSON error envelope.
- Add `GET /healthz` (liveness) and an `http/` hardening baseline: `@fastify/helmet`, `bodyLimit`,
  `requestTimeout`, `keepAliveTimeout` (above typical load balancer idle timeouts), closed CORS.
- Add process-level handling in `main.ts`: `unhandledRejection` / `uncaughtException` log `fatal`
  and exit non-zero; `SIGTERM` / `SIGINT` trigger graceful shutdown with a hard timeout.
- Wire the API workspace into the existing root scripts (`typecheck`, `lint`, `test`,
  `test:coverage`) and confirm the root ESLint error-safety rules apply to `apps/api`.

No breaking changes: nothing exists yet that this alters.

## Capabilities

### New Capabilities

- `api-config`: environment parsing and validation, fail-fast startup, non-secret config summary.
- `api-logging`: `Logger` port, pino adapter, redaction, request id propagation, request-scoped
  logger, log level by outcome.
- `api-error-handling`: `AppError` hierarchy, error envelope, central error handler, not-found
  handler, validation failure mapping, generic 500 for unexpected errors.
- `api-lifecycle`: health endpoint, HTTP hardening baseline, process-level crash handling, graceful
  shutdown.

### Modified Capabilities

None. `openspec/specs/` is empty.

## Impact

- **New code**: `apps/api/` (`src/config`, `src/domain`, `src/http`, `src/infrastructure/logging`,
  `src/main.ts`, `src/app.ts`, tests), `apps/api/package.json`, `apps/api/tsconfig.json`,
  `apps/api/vitest.config.ts`.
- **Dependencies (api)**: `fastify`, `@fastify/helmet`, `zod`, `pino`; dev: `pino-pretty`,
  `vitest` (already at root), `@types/node` (already at root).
- **Existing files touched**: root `package-lock.json`; `.env.example` (new, placeholders only).
- **Not touched**: `packages/contracts` and `apps/web` (later changes).
- **Public surface**: only `GET /healthz` and the error envelope shape, which every later endpoint
  inherits.

## Assumptions

- Node 20, ESM (`"type": "module"`), consistent with the root `package.json` and `.nvmrc`.
- `/healthz` is liveness only: it reports that the process is up and does not check the upstream,
  cache or SMTP. A dependency-aware readiness probe is not needed until there is a dependency worth
  gating traffic on.
- The error envelope is `{ error: { code, message, requestId, details? } }`, as in
  `.claude/rules/logging-and-errors.md`. It is a contract for the web app, so it is fixed here.
- Rate limiting is not part of this change. It is added with `POST /enquiries` in
  `product-enquiry`, where the limit, store and fail-open decision belong together.

## Out of Scope

- Catalogue ports, the Fake Store adapter, `Cache` port and adapters: `catalogue-api`.
- `EnquiryNotifier`, SMTP, rate limiting, `trustProxy` decision: `product-enquiry`.
- Redis connectivity and its fail-fast check: `catalogue-api` introduces Redis; the check lands
  with it.
- Dockerfiles and `compose.yaml`: `web-storefront` wraps api and web together once both exist.
- Metrics, tracing and readiness probes: no consumer in a proof of concept; noted as a next step.
