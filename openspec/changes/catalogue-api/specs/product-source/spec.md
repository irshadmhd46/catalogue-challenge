## ADDED Requirements

### Requirement: ProductSource port hides the data source

The domain SHALL define a `ProductSource` port with `listProducts()` returning all products and
`findProduct(id)` returning a product or `undefined` when it does not exist. Implementations SHALL
signal failure by throwing typed errors, never by returning `undefined` or an empty list.

#### Scenario: Missing product is undefined, not an error

- **WHEN** `findProduct` is called for an id the source does not have
- **THEN** it resolves to `undefined`

#### Scenario: Failure is an error, not an empty result

- **WHEN** the underlying source cannot be reached
- **THEN** `listProducts` and `findProduct` reject with an `UpstreamError` or `UpstreamTimeoutError`

### Requirement: Upstream products are mapped to the contract shape

`FakeStoreProductSource` SHALL map each upstream product to a contract `Product`: `rating.rate` to
`rating.average`, `rating.count` to `rating.count`, `image` to `imageUrl`, and `category` to
`{ slug, name }` where `slug` lowercases the value, removes apostrophes and replaces other runs of
non-alphanumerics with a hyphen, and `name` capitalises each word. No upstream-only field SHALL
appear in the result.

#### Scenario: Real product mapped

- **WHEN** the upstream product `id 1` (category `men's clothing`, rate 3.9, count 120) is mapped
- **THEN** the result has `category` `{ slug: 'mens-clothing', name: "Men's Clothing" }`,
  `rating` `{ average: 3.9, count: 120 }`, and an `imageUrl` equal to the upstream `image`
- **AND** the result has no `image` or `rate` property

#### Scenario: Category slug derivation

- **WHEN** the categories `jewelery`, `women's clothing`, `electronics` and `Home & Garden` are
  mapped
- **THEN** their slugs are `jewelery`, `womens-clothing`, `electronics` and `home-garden`

#### Scenario: All fixture products map

- **WHEN** the 20 recorded upstream products are mapped
- **THEN** all 20 results satisfy the contract product schema

### Requirement: Upstream payloads are validated

The adapter SHALL validate every upstream payload against a schema before mapping. A payload that is
not valid JSON, has the wrong top-level type, or contains a product missing a required field, a
non-finite price, or an `image` that is not an http(s) URL SHALL cause an `UpstreamError` and SHALL
NOT be retried.

#### Scenario: Invalid JSON

- **WHEN** the upstream list responds 200 with the body `not json`
- **THEN** `listProducts` rejects with an `UpstreamError` and the fetch was called once

#### Scenario: Wrong top-level type

- **WHEN** the upstream list responds 200 with a JSON object instead of an array
- **THEN** `listProducts` rejects with an `UpstreamError`

#### Scenario: Missing field

- **WHEN** one product in the list lacks `rating`
- **THEN** `listProducts` rejects with an `UpstreamError` and no partial list is returned

#### Scenario: Empty list body

- **WHEN** the upstream list responds 200 with an empty body
- **THEN** `listProducts` rejects with an `UpstreamError`

#### Scenario: Oversized body

- **WHEN** the upstream responds with a body larger than 1 MiB
- **THEN** the call rejects with an `UpstreamError` without parsing it

### Requirement: Absent products are not found, not failures

`findProduct` SHALL resolve to `undefined` when the upstream answers 404 or answers 200 with an empty
body, because the Fake Store returns an empty 200 for ids it does not have.

#### Scenario: Empty 200 body

- **WHEN** the upstream answers 200 with an empty body for `/products/9999`
- **THEN** `findProduct(9999)` resolves to `undefined`

#### Scenario: 404

- **WHEN** the upstream answers 404 for a product
- **THEN** `findProduct` resolves to `undefined` and the fetch was called once

### Requirement: Every upstream call has a timeout and a total deadline

Each attempt SHALL be aborted after `UPSTREAM_TIMEOUT_MS`. All attempts and backoff delays of one
call together SHALL NOT exceed `UPSTREAM_DEADLINE_MS`: an attempt's timeout is the smaller of the
per-attempt timeout and the remaining budget, and no retry SHALL start once the budget is spent.

#### Scenario: Attempt times out

- **WHEN** the fetch never responds and the per-attempt timeout elapses on every attempt
- **THEN** the call rejects with an `UpstreamTimeoutError`

#### Scenario: Budget bounds the retries

- **WHEN** the per-attempt timeout is 4 s, retries are 2 and the deadline is 6 s, and every attempt
  times out
- **THEN** fewer than 3 attempts are started and the call rejects with an `UpstreamTimeoutError`
  no later than the deadline

#### Scenario: Each attempt carries an abort signal

- **WHEN** the adapter calls fetch
- **THEN** every call receives an `AbortSignal`

### Requirement: Only idempotent calls are retried, with backoff and jitter

The adapter SHALL retry a call after a network error, a timeout, a 5xx status or a 429 status, up to
`UPSTREAM_MAX_RETRIES` retries. The delay before retry `n` SHALL be `random() * min(1500 ms,
200 ms * 2^(n-1))`. A `Retry-After` header in seconds on a 429 or 503 SHALL be honoured, capped at
1500 ms. Other 4xx statuses, 3xx statuses and validation failures SHALL NOT be retried.

#### Scenario: 5xx then success

- **WHEN** the first attempt answers 503 and the second answers 200 with valid products
- **THEN** `listProducts` resolves with the products
- **AND** the fetch was called twice and one sleep occurred

#### Scenario: Retries exhausted

- **WHEN** every attempt answers 500 and `UPSTREAM_MAX_RETRIES` is 2
- **THEN** the fetch was called exactly 3 times and the call rejects with an `UpstreamError`

#### Scenario: Backoff grows with jitter

- **WHEN** two retries happen with `random()` returning 0.5
- **THEN** the sleeps are 100 ms and 200 ms

#### Scenario: Backoff is capped

- **WHEN** the retry number is large enough that `200 ms * 2^(n-1)` exceeds 1500 ms and `random()`
  returns 1
- **THEN** the sleep is 1500 ms

#### Scenario: Retry-After honoured and capped

- **WHEN** the first attempt answers 429 with `Retry-After: 1` and then 200
- **THEN** the sleep is 1000 ms
- **AND** with `Retry-After: 120` the sleep is 1500 ms

#### Scenario: Network error retried

- **WHEN** the first attempt rejects with a `TypeError: fetch failed` and the second succeeds
- **THEN** the call resolves and the fetch was called twice

#### Scenario: Non-retryable statuses

- **WHEN** the upstream answers 400, 401, 403 or 302
- **THEN** the call rejects with an `UpstreamError` and the fetch was called once

### Requirement: Outbound requests are constrained

The adapter SHALL build request URLs from the configured base URL and a validated integer product
id, SHALL use the GET method only, SHALL NOT follow redirects, and SHALL log only the target host.

#### Scenario: URL construction

- **WHEN** `findProduct(7)` is called with base URL `https://upstream.test`
- **THEN** the fetch URL is `https://upstream.test/products/7` and the method is GET

#### Scenario: Redirects are not followed

- **WHEN** the adapter calls fetch
- **THEN** the request option `redirect` is `manual`

### Requirement: Outbound calls are logged without leaking detail

The adapter SHALL log each attempt at `debug` with `target` (host), `durationMs`, `status` and
`attempt`, and each retry at `warn` with the reason, attempt and delay. It SHALL NOT log the full URL
or the response body, and SHALL NOT log when the final attempt fails.

#### Scenario: Successful call logging

- **WHEN** a call succeeds on the first attempt
- **THEN** one `debug` line has `target` `upstream.test`, `status` 200, `attempt` 1 and a numeric
  `durationMs`, and no `warn` or `error` line is written

#### Scenario: Retry logging

- **WHEN** a call is retried once
- **THEN** one `warn` line carries `attempt` 1, a `reason` and `delayMs`

#### Scenario: Exhaustion is not logged by the adapter

- **WHEN** every attempt fails
- **THEN** the adapter writes no `error` line (the central error handler logs the final failure)
