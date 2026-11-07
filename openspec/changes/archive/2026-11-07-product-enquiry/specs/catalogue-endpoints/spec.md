## ADDED Requirements

### Requirement: Catalogue reads are rate limited

Every catalogue route SHALL declare the `read` rate scope, be counted per client address against
`RATE_LIMIT_READ_PER_MINUTE`, report `X-RateLimit-Limit` and `X-RateLimit-Remaining`, and answer
`429` in the shared envelope once the limit is exceeded.

#### Scenario: Headers on a read

- **WHEN** `GET /api/v1/featured` is requested with a limit of 120
- **THEN** `X-RateLimit-Limit` is 120 and `X-RateLimit-Remaining` is 119

#### Scenario: All catalogue routes share one read bucket

- **WHEN** a client reads `featured`, `categories`, a category page, a search and a product
- **THEN** each counts against the same bucket

#### Scenario: Over the limit

- **WHEN** the read limit is exceeded
- **THEN** the response is 429 `RATE_LIMITED` with `Retry-After` and the service is not called

#### Scenario: Unknown ids cannot reach the upstream past the limit

- **WHEN** a client requests `/api/v1/products/<id>` for many distinct unknown ids
- **THEN** after the limit is reached the upstream is no longer called for that client
