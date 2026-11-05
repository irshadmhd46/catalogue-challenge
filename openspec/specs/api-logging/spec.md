# api-logging Specification

## Purpose

Structured logging behind a Logger port, with request correlation and redaction of secrets and personal data.

## Requirements

### Requirement: Logging goes through a Logger port

Application and domain code SHALL log only through a `Logger` port with `debug`, `info`, `warn`,
`error`, `fatal` and `child`. They SHALL NOT import pino or Fastify. The pino adapter SHALL
implement the port and write one JSON object per line to stdout.

#### Scenario: Adapter writes structured JSON

- **WHEN** the adapter logs `info({ enquiryId: 'e1' }, 'enquiry sent')`
- **THEN** one line of valid JSON is written containing `level` `30`, `enquiryId` `e1` and `msg`
  `enquiry sent`

#### Scenario: Child logger carries its bindings

- **WHEN** a child logger is created with `{ component: 'cache' }` and logs a message
- **THEN** the line contains `component` `cache`

#### Scenario: Log level threshold is honoured

- **WHEN** the adapter is configured with level `warn` and `info` is logged
- **THEN** no line is written

#### Scenario: Pretty output only in development

- **WHEN** the logger is built with `nodeEnv` `production`
- **THEN** output is plain JSON lines and no pretty-printing transport is loaded

### Requirement: Every response carries a request id

The API SHALL accept a supplied `x-request-id` header only when it matches `^[A-Za-z0-9._:-]{1,64}$`;
otherwise it SHALL generate a UUID. The id SHALL be returned in the `x-request-id` response header
on every response, including errors and unknown routes.

#### Scenario: Valid supplied id is echoed

- **WHEN** a request is sent with `x-request-id: abc-123`
- **THEN** the response header `x-request-id` is `abc-123`

#### Scenario: No id supplied

- **WHEN** a request is sent without `x-request-id`
- **THEN** the response header `x-request-id` is a UUID

#### Scenario: Invalid id replaced

- **WHEN** a request is sent with an `x-request-id` containing a space, a newline character or more
  than 64 characters
- **THEN** the response header `x-request-id` is a generated UUID, not the supplied value

#### Scenario: Error responses carry the id

- **WHEN** a request to an unknown route is sent with `x-request-id: abc-123`
- **THEN** the 404 response has header `x-request-id` `abc-123`

### Requirement: Log lines carry request context from any layer

Every log line written while a request is being handled SHALL include `reqId`, `method` and
`route`, including lines written by services and adapters through the `Logger` port, without the
request being passed to them.

#### Scenario: Access line

- **WHEN** a request to `GET /healthz` completes
- **THEN** one line with message `request completed` is written containing `reqId`, `method` `GET`,
  `route` `/healthz`, `statusCode` 200 and a numeric `durationMs`

#### Scenario: Line from deeper layers after an await

- **WHEN** a route handler calls a fake service that awaits and then logs through the injected
  `Logger`
- **THEN** that line contains the same `reqId` as the request's response header

#### Scenario: Concurrent requests do not mix context

- **WHEN** two requests with different ids are in flight at the same time and each logs from the
  fake service
- **THEN** each line carries the id of its own request

#### Scenario: Lines outside a request have no request context

- **WHEN** the logger is used at startup, before any request
- **THEN** the line contains no `reqId`

### Requirement: Access log level is quiet for probes

The access line for `GET /healthz` SHALL be logged at `debug`; access lines for all other routes
SHALL be logged at `info`.

#### Scenario: Health probe at info threshold

- **WHEN** the log level is `info` and `GET /healthz` completes
- **THEN** no `request completed` line is written

#### Scenario: Other route at info threshold

- **WHEN** the log level is `info` and a request to an unknown route completes
- **THEN** a `request completed` line is written at `info`

### Requirement: Secrets and personal data are redacted

The logger SHALL censor values at the configured redaction paths: `req.headers.authorization`,
`req.headers.cookie`, `res.headers["set-cookie"]`, and `email`, `phone`, `message` and `name` under
`body` and `enquiry`. Error messages SHALL remain visible.

#### Scenario: Authorization header censored

- **WHEN** a log call includes `{ req: { headers: { authorization: 'Bearer secret-token' } } }`
- **THEN** the written line does not contain `secret-token`

#### Scenario: Enquiry fields censored

- **WHEN** a log call includes `{ enquiry: { email: 'a@b.co', phone: '0123', message: 'hi', name: 'Ann' } }`
- **THEN** the written line contains none of `a@b.co`, `0123`, `hi` as a field value or `Ann`

#### Scenario: Error message still visible

- **WHEN** a log call includes an `Error` with message `upstream exploded`
- **THEN** the written line contains `upstream exploded` and a stack for the error
