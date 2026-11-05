## ADDED Requirements

### Requirement: Redis is verified before the API starts listening

When `CACHE_DRIVER=redis`, startup SHALL connect to Redis and answer a `PING` before the server
listens. If Redis cannot be reached within the connect timeout, startup SHALL fail with a
`ConfigError` naming `REDIS_URL`, log `fatal`, and exit with code 1 without listening.

#### Scenario: Redis reachable

- **WHEN** the driver is `redis` and the connection check succeeds
- **THEN** the server listens and the summary shows `cacheDriver` `redis`

#### Scenario: Redis unreachable at startup

- **WHEN** the driver is `redis` and the connection check fails
- **THEN** one `fatal` line names `REDIS_URL`, the exit code is 1 and the server never listens

#### Scenario: Memory driver needs no check

- **WHEN** the driver is `memory`
- **THEN** no Redis connection is attempted

### Requirement: Shutdown closes the cache connection after the server

On shutdown the API SHALL close the HTTP server first and then run registered closers, including the
Redis connection when it is in use, in reverse registration order.

#### Scenario: Redis closed after the server

- **WHEN** shutdown runs with a Redis closer registered
- **THEN** the HTTP server is closed first and the Redis closer runs afterwards

#### Scenario: Redis close failure

- **WHEN** the Redis closer rejects
- **THEN** an `error` line names the closer and the process exits 1, as for any failing closer
