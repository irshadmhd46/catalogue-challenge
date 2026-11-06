## ADDED Requirements

### Requirement: RateLimiter port with interchangeable adapters

The domain SHALL define a `RateLimiter` port with `consume(key, limit, windowSeconds)` resolving to
`{ allowed, limit, remaining, retryAfterSeconds }`. `MemoryRateLimiter` and `RedisRateLimiter` SHALL
satisfy one shared behavioural contract using a fixed window that starts at the first hit.

#### Scenario: Within the limit

- **WHEN** a key consumes 1 to `limit` times inside one window
- **THEN** every call is allowed and `remaining` counts down from `limit - 1` to 0

#### Scenario: Over the limit

- **WHEN** a key consumes `limit + 1` times inside one window
- **THEN** the extra call is not allowed, `remaining` is 0 and `retryAfterSeconds` is between 1 and
  `windowSeconds`

#### Scenario: Denied hits do not extend the window

- **WHEN** a key keeps being denied
- **THEN** it is allowed again `windowSeconds` after its first hit, not after its last denied hit

#### Scenario: Window expiry

- **WHEN** the window has elapsed
- **THEN** the next call is allowed with `remaining` of `limit - 1`

#### Scenario: Keys are independent

- **WHEN** one key is exhausted
- **THEN** another key is still allowed

#### Scenario: Limit of one

- **WHEN** the limit is 1
- **THEN** the second call in the window is denied

#### Scenario: Contract suite runs for each adapter

- **WHEN** the test suite runs without `REDIS_URL`
- **THEN** the contract runs against `MemoryRateLimiter` and the Redis run is reported as skipped
- **AND** when `REDIS_URL` is set the same contract runs against `RedisRateLimiter`

### Requirement: The memory limiter cannot grow without bound

`MemoryRateLimiter` SHALL purge expired entries and, when more than 10 000 keys are held, evict the
oldest, so memory stays bounded under a flood of distinct keys.

#### Scenario: Flood of keys

- **WHEN** 20 000 distinct keys consume once
- **THEN** no more than 10 000 entries are held and the newest keys are still limited correctly

#### Scenario: Expired entries are removed

- **WHEN** entries have expired and the limiter is used again
- **THEN** the expired entries no longer count toward the held keys

### Requirement: The Redis limiter is atomic and bounded

`RedisRateLimiter` SHALL increment the counter, set the expiry on the first hit and read the time
left in one atomic operation, using the shared Redis connection and a key prefix.

#### Scenario: One round trip

- **WHEN** a key consumes once
- **THEN** exactly one script evaluation is made on the Redis client, with the namespaced key and the
  window as arguments

#### Scenario: Store failure surfaces as a CacheError

- **WHEN** the Redis client rejects
- **THEN** `consume` rejects with a `CacheError` whose `cause` is the original error

#### Scenario: Unexpected reply

- **WHEN** the script returns something that is not a count and a time to live
- **THEN** `consume` rejects with a `CacheError`

### Requirement: Routes opt in to a limit scope

API routes SHALL declare a rate scope, `read` for catalogue reads and `enquiry` for the enquiry
route. A request SHALL be counted against `<scope>:<client ip>` before its body is read. `/healthz`,
unknown routes and framework-level errors SHALL NOT be counted.

#### Scenario: Scopes are separate

- **WHEN** a client exhausts the enquiry limit
- **THEN** its catalogue reads are still allowed
- **AND** exhausting the read limit does not block an enquiry

#### Scenario: Different clients

- **WHEN** one client address is limited
- **THEN** another address is not

#### Scenario: Not counted

- **WHEN** `/healthz`, an unknown path or a malformed URL is requested many times
- **THEN** none is rate limited

#### Scenario: Limited before the body is read

- **WHEN** a client over its limit posts a valid enquiry
- **THEN** the response is 429 and the notifier and the catalogue were not called

### Requirement: Limits are reported and enforced in the shared envelope

Every response on a limited route SHALL carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`. A
denied request SHALL be answered `429 RATE_LIMITED` in the shared envelope with a `Retry-After`
header in seconds, and logged once at `warn`.

#### Scenario: Headers on success

- **WHEN** the first enquiry of a window is accepted with a limit of 5
- **THEN** `X-RateLimit-Limit` is 5 and `X-RateLimit-Remaining` is 4

#### Scenario: The sixth enquiry in a minute

- **WHEN** a client posts six valid enquiries inside one window
- **THEN** the first five are 202 and the sixth is 429 with code `RATE_LIMITED` and message
  `Too many requests`
- **AND** `Retry-After` is between 1 and 60 and `X-RateLimit-Remaining` is 0
- **AND** the notifier was called five times

#### Scenario: Recovery

- **WHEN** the window has elapsed
- **THEN** the same client is accepted again

#### Scenario: Catalogue read limit

- **WHEN** a client makes 121 catalogue reads in a window with a limit of 120
- **THEN** the 121st is 429

#### Scenario: One log line per denial

- **WHEN** a request is denied
- **THEN** exactly one `warn` line is written with `code` `RATE_LIMITED` and no client address

### Requirement: The limiter fails open, loudly

When the limiter store fails, the request SHALL be allowed and an `error` line SHALL be written, at
most once every 30 seconds.

#### Scenario: Store down

- **WHEN** the limiter rejects with a `CacheError`
- **THEN** the request is handled normally
- **AND** one `error` line says the rate limiter store failed

#### Scenario: Throttled logging

- **WHEN** 100 requests fail inside 30 seconds
- **THEN** one `error` line is written, and another after 30 seconds have passed

#### Scenario: No headers when unknown

- **WHEN** the store failed for a request
- **THEN** that response has no `X-RateLimit-*` headers

### Requirement: The client address is trusted only from configured hops

`TRUST_PROXY_HOPS` SHALL set how many proxy hops Fastify trusts to supply the client address. With 0
the address SHALL be the socket address and `X-Forwarded-For` SHALL be ignored. The client address
SHALL NOT be logged.

#### Scenario: Spoofed header with no trusted proxy

- **WHEN** `TRUST_PROXY_HOPS` is 0 and requests from one socket address send different
  `X-Forwarded-For` values
- **THEN** they all count against the socket address and are limited together

#### Scenario: One trusted hop

- **WHEN** `TRUST_PROXY_HOPS` is 1 and a request arrives with `X-Forwarded-For: 203.0.113.9`
- **THEN** it counts against `203.0.113.9`
- **AND** a different forwarded address from the same socket counts separately

#### Scenario: A longer chain cannot pick the address

- **WHEN** `TRUST_PROXY_HOPS` is 1 and the header is `1.1.1.1, 203.0.113.9`
- **THEN** the counted address is `203.0.113.9`, not the left-most value

#### Scenario: The address is not logged

- **WHEN** requests are handled and limited
- **THEN** no captured log line contains the client address
