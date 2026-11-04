## ADDED Requirements

### Requirement: Expected failures are typed AppErrors

The domain SHALL define an `AppError` base with `code`, `httpStatus`, `publicMessage`, `cause`,
optional `details` and `isOperational`, and these subclasses with fixed codes and statuses.

| Class                  | Code                | Status |
| ---------------------- | ------------------- | ------ |
| `ValidationError`      | `VALIDATION_ERROR`  | 400    |
| `NotFoundError`        | `NOT_FOUND`         | 404    |
| `RateLimitedError`     | `RATE_LIMITED`      | 429    |
| `UpstreamError`        | `UPSTREAM_ERROR`    | 502    |
| `UpstreamTimeoutError` | `UPSTREAM_TIMEOUT`  | 504    |
| `NotificationError`    | `NOTIFICATION_FAILED` | 502  |
| `ConfigError`          | `CONFIG_INVALID`    | 500 (never sent; startup only) |

#### Scenario: Each class exposes its code and status

- **WHEN** an instance of each subclass is created
- **THEN** its `code` and `httpStatus` match the table above and `isOperational` is true

#### Scenario: Cause is preserved

- **WHEN** an error is created with an original error as `cause`
- **THEN** `error.cause` is that original error

#### Scenario: Public message is safe by default

- **WHEN** an `UpstreamError` is created with a `cause` whose message contains an internal hostname
- **THEN** `publicMessage` does not contain that hostname

#### Scenario: Not found names the resource without leaking input

- **WHEN** `new NotFoundError('product', '42')` is created
- **THEN** `publicMessage` is `Product not found` and `details` is not set

### Requirement: One error handler produces one envelope

Only `http/error-handler.ts` SHALL convert errors into HTTP responses. Every error response SHALL
have the body `{ "error": { "code", "message", "requestId", "details"? } }` and content type
`application/json`.

#### Scenario: AppError mapped to its status and code

- **WHEN** a route throws each `AppError` subclass in turn (table-driven)
- **THEN** the response status equals the class's `httpStatus`
- **AND** `error.code` equals its code, `error.message` equals its `publicMessage`
- **AND** `error.requestId` equals the `x-request-id` response header

#### Scenario: Validation details are included

- **WHEN** a route throws a `ValidationError` with details `[{ field: 'email', message: 'Invalid email' }]`
- **THEN** the response status is 400 and `error.details` equals that array

#### Scenario: Details omitted when absent

- **WHEN** a route throws a `NotFoundError`
- **THEN** the response body's `error` object has no `details` key

#### Scenario: Rate limited response tells the client when to retry

- **WHEN** a route throws a `RateLimitedError` with `retryAfterSeconds` 30
- **THEN** the response status is 429 and header `Retry-After` is `30`

#### Scenario: Unknown error becomes a generic 500

- **WHEN** a route throws `new Error('db password is hunter2')`
- **THEN** the response status is 500, `error.code` is `INTERNAL_ERROR` and `error.message` is
  `Something went wrong`
- **AND** the response body does not contain `hunter2` or any stack text

#### Scenario: Non-Error throw is handled

- **WHEN** a route rejects with a plain string
- **THEN** the response is the same generic 500 envelope

### Requirement: Fastify-originated client errors use the envelope

Errors raised by the framework with a 4xx status SHALL be returned in the envelope with that
status, a generic message, and no framework message text.

#### Scenario: Malformed JSON body

- **WHEN** a request is sent with `content-type: application/json` and body `{not json`
- **THEN** the response status is 400 and `error.code` is `BAD_REQUEST`
- **AND** the body does not contain the parser's message text

#### Scenario: Body over the limit

- **WHEN** a request body is larger than `bodyLimitBytes`
- **THEN** the response status is 413 and `error.code` is `PAYLOAD_TOO_LARGE`

#### Scenario: Unsupported media type

- **WHEN** a request is sent with a content type the app has no parser for
- **THEN** the response status is 415 and `error.code` is `BAD_REQUEST`

### Requirement: Unknown routes return the same envelope

The API SHALL answer requests that match no route or method with the 404 error envelope, produced
by the same error handler as every other error.

#### Scenario: Unknown path

- **WHEN** `GET /nope` is requested
- **THEN** the response status is 404, `error.code` is `NOT_FOUND`, `error.message` is
  `Route not found`, and `error.requestId` is set

#### Scenario: Unsupported method on a known path

- **WHEN** `DELETE /healthz` is requested
- **THEN** the response is the 404 envelope

### Requirement: Errors are logged once, at a level matching the outcome

The error handler SHALL log each handled error exactly once. 4xx outcomes SHALL log at `warn`
without a stack. 5xx outcomes SHALL log at `error` with the error, its stack and its `cause` chain.
Request context fields SHALL be present on the line.

#### Scenario: 4xx logs a warning without stack

- **WHEN** a route throws a `ValidationError`
- **THEN** exactly one `warn` line is written by the handler, containing `code` `VALIDATION_ERROR`
  and `statusCode` 400, and no stack
- **AND** no line at level `error` is written

#### Scenario: 5xx logs an error with the cause chain

- **WHEN** a route throws an `UpstreamError` whose `cause` is an `Error('socket hang up')`
- **THEN** exactly one `error` line is written containing the stack and `socket hang up`

#### Scenario: Unknown error logs an error with its detail

- **WHEN** a route throws `new Error('db password is hunter2')`
- **THEN** one `error` line is written containing the original message and stack
- **AND** the HTTP response does not contain that message

#### Scenario: Unknown route logs a warning

- **WHEN** `GET /nope` is requested
- **THEN** exactly one `warn` line is written with `statusCode` 404

#### Scenario: Not logged twice

- **WHEN** a route throws any error
- **THEN** across the whole request exactly one line has level `warn` or `error` about that error
