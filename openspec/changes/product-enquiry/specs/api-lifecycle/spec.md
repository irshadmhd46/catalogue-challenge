## ADDED Requirements

### Requirement: The SMTP transport and the shared Redis connection are closed once

On shutdown, after the HTTP server closes, the API SHALL close the SMTP transport and then the Redis
connection, in reverse order of registration. The Redis connection SHALL be created once and shared by
the cache and the rate limiter.

#### Scenario: Close order

- **WHEN** shutdown runs with the Redis driver
- **THEN** the HTTP server closes first, then the SMTP transport, then Redis

#### Scenario: One Redis connection

- **WHEN** the composition is built with the Redis driver
- **THEN** exactly one Redis client is created and it is used by both the cache and the limiter
- **AND** exactly one `redis` closer is registered

#### Scenario: Memory driver

- **WHEN** the cache driver is `memory`
- **THEN** no Redis client is created and the SMTP closer is the only closer

#### Scenario: SMTP close failure

- **WHEN** closing the SMTP transport fails
- **THEN** an `error` line names the closer, the remaining closers still run and the process exits 1
