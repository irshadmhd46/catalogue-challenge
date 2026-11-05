## ADDED Requirements

### Requirement: Catalogue, upstream and cache settings are configured and validated

Configuration SHALL include these settings, validated at startup with the defaults shown.

| Variable                  | Default                      | Rule                                           |
| ------------------------- | ---------------------------- | ---------------------------------------------- |
| `CATALOG_DRIVER`          | `fakestore`                  | one of `fakestore`                             |
| `FAKESTORE_BASE_URL`      | `https://fakestoreapi.com`   | absolute http(s) URL; https when production    |
| `UPSTREAM_TIMEOUT_MS`     | 4000                         | integer 1 to 30000                             |
| `UPSTREAM_DEADLINE_MS`    | 10000                        | integer 1 to 60000                             |
| `UPSTREAM_MAX_RETRIES`    | 2                            | integer 0 to 5                                 |
| `CACHE_DRIVER`            | `memory`                     | `memory` or `redis`                            |
| `REDIS_URL`               | unset                        | `redis:` or `rediss:` URL, required for redis  |
| `CACHE_FRESH_TTL_SECONDS` | 60                           | integer 1 to 86400                             |
| `CACHE_STALE_TTL_SECONDS` | 3600                         | integer 0 to 604800                            |
| `FEATURED_PRODUCT_IDS`    | unset                        | comma-separated positive integers, at most 10  |

#### Scenario: Defaults

- **WHEN** configuration is loaded from an empty environment
- **THEN** the catalogue settings equal the defaults in the table, `redisUrl` is undefined and
  `featuredProductIds` is an empty list

#### Scenario: Redis selected without a URL

- **WHEN** `CACHE_DRIVER=redis` is set and `REDIS_URL` is not
- **THEN** a `ConfigError` is thrown whose details name `REDIS_URL`

#### Scenario: Redis URL with a wrong scheme

- **WHEN** `REDIS_URL=http://cache.test` is set
- **THEN** a `ConfigError` names `REDIS_URL`

#### Scenario: Redis URL set but memory driver

- **WHEN** `CACHE_DRIVER=memory` and a valid `REDIS_URL` are set
- **THEN** loading succeeds and the Redis URL is ignored

#### Scenario: Base URL must be https in production

- **WHEN** `NODE_ENV=production` and `FAKESTORE_BASE_URL=http://upstream.test`
- **THEN** a `ConfigError` names `FAKESTORE_BASE_URL`
- **AND** the same value is accepted when `NODE_ENV=development`

#### Scenario: Base URL must be a URL

- **WHEN** `FAKESTORE_BASE_URL=not a url` or `ftp://upstream.test` is set
- **THEN** a `ConfigError` names `FAKESTORE_BASE_URL`

#### Scenario: Featured override parsing

- **WHEN** `FEATURED_PRODUCT_IDS=7, 2,15`
- **THEN** `featuredProductIds` is `[7, 2, 15]`

#### Scenario: Featured override rejected

- **WHEN** `FEATURED_PRODUCT_IDS` is `7,x`, `0`, `7,,2`, or eleven ids
- **THEN** a `ConfigError` names `FEATURED_PRODUCT_IDS`

#### Scenario: Bounds

- **WHEN** `UPSTREAM_MAX_RETRIES=6` or `UPSTREAM_TIMEOUT_MS=0` is set
- **THEN** a `ConfigError` names that variable

#### Scenario: Deadline shorter than one attempt

- **WHEN** `UPSTREAM_TIMEOUT_MS=5000` and `UPSTREAM_DEADLINE_MS=1000`
- **THEN** a `ConfigError` names `UPSTREAM_DEADLINE_MS`

#### Scenario: Secrets are not echoed

- **WHEN** `REDIS_URL=http://user:topsecret@cache.test` fails validation
- **THEN** the error message and details do not contain `topsecret`

### Requirement: Startup summary includes only non-secret catalogue fields

The startup `info` summary SHALL add `catalogDriver`, `cacheDriver` and `upstreamHost` and SHALL NOT
include `redisUrl` or any credential-bearing value.

#### Scenario: Summary fields

- **WHEN** the summary is built with `CACHE_DRIVER=redis` and a Redis URL containing a password
- **THEN** it contains `cacheDriver` `redis` and `upstreamHost` `fakestoreapi.com`
- **AND** its serialised form contains neither the password nor the Redis URL
