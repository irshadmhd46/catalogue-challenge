## ADDED Requirements

### Requirement: Health endpoint reports liveness

The API SHALL expose `GET /healthz` returning `200` with body `{ "status": "ok" }` and SHALL NOT
call any external dependency to answer it.

#### Scenario: Healthy

- **WHEN** `GET /healthz` is requested
- **THEN** the status is 200 and the body is exactly `{"status":"ok"}`

### Requirement: HTTP hardening baseline

The API SHALL send standard security headers, enforce a request body size limit and a request
timeout from configuration, and SHALL NOT enable CORS.

#### Scenario: Security headers present

- **WHEN** any response is returned
- **THEN** it includes `x-content-type-options: nosniff` and a `content-security-policy` header
- **AND** it does not include an `x-powered-by` header

#### Scenario: Security headers on error responses

- **WHEN** an unknown route returns 404
- **THEN** the same security headers are present

#### Scenario: CORS closed

- **WHEN** a request is sent with `Origin: https://example.test`
- **THEN** the response has no `access-control-allow-origin` header

#### Scenario: Limits come from configuration

- **WHEN** the app is built with `bodyLimitBytes` 100
- **THEN** a body of 101 bytes is rejected with 413 and a body of 100 bytes is accepted by the
  body parser

### Requirement: Graceful shutdown

On `SIGTERM` or `SIGINT` the API SHALL stop accepting connections, let in-flight requests finish,
run registered closers in reverse registration order, log the progress, and exit `0`. It SHALL
exit `1` if shutdown does not finish within `shutdownTimeoutMs` or if any step fails.

#### Scenario: Clean shutdown

- **WHEN** `SIGTERM` is received with no in-flight requests and two registered closers
- **THEN** `info` lines state shutdown started and completed
- **AND** the server is closed first, then the closers run in reverse registration order
- **AND** exit is called once with code 0

#### Scenario: In-flight request completes

- **WHEN** `SIGTERM` is received while a request is being handled
- **THEN** that request receives its response before exit is called

#### Scenario: Idle keep-alive connection does not stall shutdown

- **WHEN** a client holds an idle keep-alive connection and another request is in flight at
  `SIGTERM`
- **THEN** the in-flight request completes and shutdown finishes without waiting for the
  keep-alive timeout

#### Scenario: Second signal while shutting down

- **WHEN** `SIGINT` arrives while shutdown is already running
- **THEN** a `warn` line states shutdown is already in progress
- **AND** exit is still called only once

#### Scenario: A closer fails

- **WHEN** a closer throws during shutdown
- **THEN** an `error` line names the closer and carries the error
- **AND** the remaining closers still run
- **AND** exit is called with code 1

#### Scenario: Shutdown stalls

- **WHEN** a closer does not finish within `shutdownTimeoutMs`
- **THEN** an `error` line states the shutdown timed out, even if the event loop would otherwise be empty
- **AND** exit is called with code 1

### Requirement: Process-level failures exit non-zero

On `unhandledRejection` or `uncaughtException` the API SHALL log at `fatal` with the error and
exit with code `1` without attempting graceful shutdown.

#### Scenario: Unhandled rejection

- **WHEN** an `unhandledRejection` event is emitted with an `Error`
- **THEN** one `fatal` line carries that error and exit is called with code 1

#### Scenario: Uncaught exception

- **WHEN** an `uncaughtException` event is emitted
- **THEN** one `fatal` line carries that error and exit is called with code 1

#### Scenario: Rejection with a non-Error value

- **WHEN** an `unhandledRejection` event is emitted with a string
- **THEN** one `fatal` line is written and exit is called with code 1

### Requirement: Startup failure is fatal and logged

If the server fails to start (for example the port is in use), the API SHALL log at `fatal` and
exit with code `1`.

#### Scenario: Listen fails

- **WHEN** `listen` rejects with an `EADDRINUSE` error
- **THEN** one `fatal` line carries the error and exit is called with code 1

### Requirement: Error-safety lint rules apply to the API

The repository lint configuration SHALL treat `no-floating-promises`, `no-misused-promises`,
`only-throw-error`, `no-console` and empty `catch` blocks as errors for files under `apps/api`.

#### Scenario: Floating promise rejected by lint

- **WHEN** a source file under `apps/api/src` contains an un-awaited promise statement
- **THEN** `npm run lint` fails

#### Scenario: Console use rejected by lint

- **WHEN** a source file under `apps/api/src` calls `console.log`
- **THEN** `npm run lint` fails
