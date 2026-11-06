## ADDED Requirements

### Requirement: The SMTP transport is closed on shutdown

On shutdown, after the HTTP server closes, the API SHALL close the SMTP transport.

#### Scenario: Close order

- **WHEN** shutdown runs
- **THEN** the HTTP server closes first and the SMTP transport closes afterwards

#### Scenario: Only the SMTP closer is registered

- **WHEN** the composition is built
- **THEN** the only closer registered is `smtp`

#### Scenario: SMTP close failure

- **WHEN** closing the SMTP transport fails
- **THEN** an `error` line names the closer and the process exits 1
