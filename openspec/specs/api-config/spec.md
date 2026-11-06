# api-config Specification

## Purpose

Environment-driven configuration that is validated once at startup and fails fast.

## Requirements

### Requirement: Configuration is read only from validated environment variables

The API SHALL read configuration from environment variables in the `config/` module only, validate
them with a schema, apply documented defaults, and expose the result as an immutable object.

#### Scenario: Defaults applied for an empty environment

- **WHEN** configuration is loaded from an environment with no variables set
- **THEN** the result has `nodeEnv` `development`, `host` `0.0.0.0`, `port` 3000, `logLevel` `info`,
  `requestTimeoutMs` 10000, `bodyLimitBytes` 10240 and `shutdownTimeoutMs` 10000

#### Scenario: Explicit values override defaults

- **WHEN** configuration is loaded with `PORT=8080`, `LOG_LEVEL=debug` and `NODE_ENV=production`
- **THEN** `port` is the number 8080, `logLevel` is `debug` and `nodeEnv` is `production`

#### Scenario: Configuration object cannot be mutated

- **WHEN** code attempts to assign to a property of the loaded configuration
- **THEN** the assignment is rejected at compile time and has no effect at runtime

### Requirement: Invalid configuration stops startup with a ConfigError

The API SHALL throw a `ConfigError` when any variable is malformed or out of range. The error
SHALL name each offending variable and the rule it broke, and SHALL NOT include the offending
value.

#### Scenario: Non-numeric port

- **WHEN** configuration is loaded with `PORT=abc`
- **THEN** a `ConfigError` is thrown whose details name `PORT`
- **AND** the error message and details do not contain `abc`

#### Scenario: Port outside the permitted range

- **WHEN** configuration is loaded with `PORT=80`
- **THEN** a `ConfigError` is thrown whose details name `PORT`, because ports below 1024 are not
  permitted

#### Scenario: Unknown log level

- **WHEN** configuration is loaded with `LOG_LEVEL=verbose`
- **THEN** a `ConfigError` is thrown whose details name `LOG_LEVEL`

#### Scenario: Several problems reported together

- **WHEN** configuration is loaded with `PORT=abc` and `LOG_LEVEL=verbose`
- **THEN** one `ConfigError` is thrown whose details name both variables

#### Scenario: Process exits non-zero on invalid configuration

- **WHEN** the process starts with an invalid environment
- **THEN** a `fatal` log line states the configuration is invalid and names the variables
- **AND** the process exits with a non-zero code before listening on any port

### Requirement: Startup logs a non-secret configuration summary

The API SHALL log one `info` line at startup summarising the effective configuration, built from an
explicit allowlist of non-secret fields.

#### Scenario: Summary contains the allowlisted fields

- **WHEN** the API starts with default configuration
- **THEN** one `info` line contains `nodeEnv`, `host`, `port` and `logLevel`

#### Scenario: A field outside the allowlist is not logged

- **WHEN** the configuration object holds an extra field that is not on the allowlist
- **THEN** the summary does not contain that field or its value

### Requirement: Catalogue, upstream and cache settings are configured and validated

Configuration SHALL include these settings, validated at startup with the defaults shown.

| Variable                  | Default                      | Rule                                           |
| ------------------------- | ---------------------------- | ---------------------------------------------- |
| `CATALOG_DRIVER`          | `fakestore`                  | one of `fakestore`                             |
| `FAKESTORE_BASE_URL`      | `https://fakestoreapi.com`   | absolute http(s) URL; https when production    |
| `UPSTREAM_TIMEOUT_MS`     | 4000                         | integer 1 to 30000                             |
| `UPSTREAM_MAX_RETRIES`    | 1                            | integer 0 to 3                                 |
| `CACHE_FRESH_TTL_SECONDS` | 60                           | integer 1 to 86400                             |
| `CACHE_STALE_TTL_SECONDS` | 3600                         | integer 0 to 604800                            |
| `FEATURED_PRODUCT_IDS`    | unset                        | comma-separated positive integers, at most 10  |

#### Scenario: Defaults

- **WHEN** configuration is loaded from an empty environment
- **THEN** the catalogue settings equal the defaults in the table and
  `featuredProductIds` is an empty list




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

#### Scenario: Repeated featured ids

- **WHEN** `FEATURED_PRODUCT_IDS=7,2,7,15,2`
- **THEN** `featuredProductIds` is `[7, 2, 15]`

#### Scenario: Featured override rejected

- **WHEN** `FEATURED_PRODUCT_IDS` is `7,x`, `0`, `7,,2`, or eleven ids
- **THEN** a `ConfigError` names `FEATURED_PRODUCT_IDS`

#### Scenario: Bounds

- **WHEN** `UPSTREAM_MAX_RETRIES=4` or `UPSTREAM_TIMEOUT_MS=0` is set
- **THEN** a `ConfigError` names that variable

#### Scenario: Credentials are not echoed

- **WHEN** `FAKESTORE_BASE_URL=https://user:basicpw@upstream.test` fails validation
- **THEN** the error message and details do not contain `basicpw`

### Requirement: Startup summary includes only non-secret catalogue fields

The startup `info` summary SHALL add `catalogDriver` and `upstreamHost` (the host only, not the full
URL) and SHALL NOT include any credential-bearing value.

#### Scenario: Summary fields

- **WHEN** the summary is built with the base URL `https://upstream.test/secret-path`
- **THEN** it contains `catalogDriver` `fakestore` and `upstreamHost` `upstream.test`
- **AND** its serialised form does not contain `secret-path`
