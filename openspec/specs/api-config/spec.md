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
