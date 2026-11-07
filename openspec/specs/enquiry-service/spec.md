# enquiry-service Specification

## Purpose

The enquiry use case: product must exist, enquiry id, single send, outcome logging.

## Requirements

### Requirement: An enquiry requires an existing product

`EnquiryService` SHALL look the product up through the catalogue service before sending, and SHALL
use the product's id and title from the catalogue, never from the request.

#### Scenario: Product exists

- **WHEN** an enquiry for product 7 is submitted
- **THEN** the catalogue is asked for product 7 once
- **AND** the notifier receives that product's id and title

#### Scenario: Product missing

- **WHEN** the catalogue throws `NotFoundError` for the product
- **THEN** the service rethrows that error and the notifier is not called

#### Scenario: Catalogue failure

- **WHEN** the catalogue throws an `UpstreamError`
- **THEN** the service rethrows it unchanged and the notifier is not called

### Requirement: Each enquiry is identified and sent exactly once

The service SHALL give every enquiry a new id from an injected generator and a timestamp from an
injected clock, SHALL call the notifier exactly once, and SHALL NOT retry.

#### Scenario: Enquiry handed to the notifier

- **WHEN** an enquiry is submitted
- **THEN** the notifier receives one `Enquiry` containing the generated id, the clock time, the
  product, and the visitor's name, email, phone and message unchanged

#### Scenario: The result is the id

- **WHEN** the notifier succeeds
- **THEN** the service resolves to the same enquiry id

#### Scenario: No retry on failure

- **WHEN** the notifier rejects
- **THEN** it was called once and the service rejects

#### Scenario: Ids are unique

- **WHEN** two enquiries are submitted
- **THEN** they receive different ids

### Requirement: Failures keep the enquiry id for the log

When the notifier fails, the service SHALL throw a `NotificationError` that keeps the original error
as `cause` and carries the enquiry id as a property for logging only.

#### Scenario: Wrapped failure

- **WHEN** the notifier rejects with any error
- **THEN** the service rejects with a `NotificationError` whose `cause` is that error and whose
  `enquiryId` is the generated id
- **AND** the error's public message and details do not contain the enquiry id or visitor data

#### Scenario: A typed failure is not double wrapped

- **WHEN** the notifier rejects with a `NotificationError`
- **THEN** the service rejects with a `NotificationError` that still has that error as its `cause`
  chain and the enquiry id

### Requirement: Logging carries identifiers and the outcome only

The service SHALL log one `info` line on success with `enquiryId`, `productId` and `outcome`, and
SHALL NOT log on failure (the central handler logs it once).

#### Scenario: Success log

- **WHEN** an enquiry is sent
- **THEN** exactly one log line is written, at `info`, with those three fields only (besides request
  context) and no visitor field

#### Scenario: No log on failure

- **WHEN** the notifier rejects
- **THEN** the service writes no log line
