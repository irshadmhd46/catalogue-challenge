## ADDED Requirements

### Requirement: The enquiry request is validated strictly

The shared contract SHALL define the enquiry request as a strict object with `productId` (a positive
whole number of at most 9 digits), `name` (trimmed, 1 to 100 characters, no control characters),
`email` (trimmed, at most 254 characters, a plain address), optional `phone` (trimmed, 5 to 30
characters of digits, spaces and `+ ( ) - .`) and `message` (trimmed, 10 to 2000 characters, newlines
and tabs allowed, other control characters rejected). Unknown properties SHALL be rejected, and
validation messages SHALL NOT contain the submitted values.

#### Scenario: A valid enquiry parses

- **WHEN** a body with all required fields in range is parsed
- **THEN** parsing succeeds and the text fields are trimmed

#### Scenario: Optional phone

- **WHEN** the body has no `phone`, or a valid one such as `+44 (0)20 7946 0958`
- **THEN** parsing succeeds
- **AND** an empty-string `phone` is rejected

#### Scenario: Field boundaries

- **WHEN** `name` has 100 characters, `email` 254, `message` 2000 and `message` 10
- **THEN** each parses
- **AND** a 101-character name, a 255-character email, a 2001-character message and a 9-character
  message each fail

#### Scenario: Email forms that are not plain addresses

- **WHEN** `email` is `a@b`, `a@b.co, c@d.co`, `"x" <a@b.co>`, `<a@b.co>`, `a b@c.co`,
  `a@b.co\r\nBcc: x@y.z`, `a@b.co\r\n x@y.z` or `@b.co`
- **THEN** every one is rejected

#### Scenario: Surrounding whitespace is trimmed, inner line breaks are not allowed

- **WHEN** `email` is `  ann@example.test\n`
- **THEN** it parses as `ann@example.test`
- **AND** an address with a line break inside it is rejected

#### Scenario: Control characters

- **WHEN** `name` contains a newline, or `message` contains a NUL or an escape character
- **THEN** each is rejected
- **AND** a `message` containing newlines and tabs is accepted

#### Scenario: Wrong types and unknown fields

- **WHEN** `productId` is `"7"`, `1.5`, `0` or a 10-digit number, a field is missing, or the body has
  an extra property such as `to` or `cc`
- **THEN** every case is rejected

#### Scenario: Messages never echo input

- **WHEN** an invalid email `hunter2@` and an over-long message fail validation
- **THEN** no issue message contains `hunter2` or any part of the message

### Requirement: Submitting an enquiry sends it and answers 202

`POST /api/v1/enquiries` SHALL validate the body, confirm the product exists, send the enquiry
through the notifier and respond `202` with `{ "enquiryId": <uuid>, "status": "accepted" }`.

#### Scenario: Accepted

- **WHEN** a valid enquiry for an existing product is posted
- **THEN** the status is 202 and the body has a UUID `enquiryId` and `status` `accepted`
- **AND** the notifier was called exactly once with the visitor's name, email, phone and message and
  the product's id and title taken from the catalogue

#### Scenario: Response carries the request id and no personal data

- **WHEN** an enquiry is accepted
- **THEN** the `x-request-id` header is present
- **AND** the body contains none of the submitted email, phone, name or message

### Requirement: Invalid requests are rejected before any side effect

An invalid body SHALL be answered `400 VALIDATION_ERROR` with `{ field, message }` details naming
each invalid field once, and SHALL NOT reach the catalogue, the notifier or the network.

#### Scenario: Field errors

- **WHEN** a body with an invalid email and a too-short message is posted
- **THEN** the status is 400 and `details` names `email` and `message`
- **AND** the notifier and the product source were not called

#### Scenario: Missing, empty or non-object body

- **WHEN** the body is absent, `null`, an array or a string
- **THEN** the response is a 400 envelope and nothing was sent

#### Scenario: Unknown property

- **WHEN** the body has an extra property `bcc`
- **THEN** the status is 400 with the fixed "parameters that are not allowed" message and the
  property name is not echoed

### Requirement: Unknown products are not found

An enquiry for a product that does not exist SHALL be answered `404 NOT_FOUND` "Product not found"
and SHALL NOT send an email.

#### Scenario: Missing product

- **WHEN** a valid enquiry names product 9999 and the catalogue reports it missing
- **THEN** the status is 404 with message `Product not found` and the notifier was not called

### Requirement: Request framing is constrained

The endpoint SHALL accept only `application/json`, SHALL reject bodies larger than the configured
body limit with `413`, and SHALL answer malformed JSON with `400`, all in the shared envelope.

#### Scenario: Wrong content type

- **WHEN** an enquiry is posted as `text/plain` or `application/x-www-form-urlencoded`
- **THEN** the status is 415 in the envelope and nothing was sent

#### Scenario: Oversized body

- **WHEN** the body is larger than `BODY_LIMIT_BYTES`
- **THEN** the status is 413 `PAYLOAD_TOO_LARGE`

#### Scenario: Malformed JSON

- **WHEN** the body is `{not json`
- **THEN** the status is 400 `BAD_REQUEST` and the parser message is not returned

### Requirement: Notification failures are reported without detail

When sending fails the endpoint SHALL answer `502 NOTIFICATION_FAILED` with the generic public
message, and the failure SHALL be logged once with the enquiry id and no personal data.

#### Scenario: Send fails

- **WHEN** the notifier rejects with a `NotificationError`
- **THEN** the status is 502 with code `NOTIFICATION_FAILED`
- **AND** exactly one `error` line is written and it carries the `enquiryId`

#### Scenario: Send times out

- **WHEN** the notifier rejects because the SMTP deadline passed
- **THEN** the response is the same 502 envelope

### Requirement: Personal data never appears in logs

No log line SHALL contain the submitted email address, phone number, name or message, across success, validation failure, unknown product, rate limiting and notification failure. Enquiry log lines SHALL carry only `enquiryId`, `productId` and the outcome.

#### Scenario: Whole flow through the real logger

- **WHEN** one accepted enquiry, one rejected for validation, one for an unknown product, one that
  hits the rate limit and one with a failing notifier are processed with the pino adapter capturing
  output
- **THEN** none of the captured text contains the submitted email, phone, name or message

#### Scenario: Success line content

- **WHEN** an enquiry is accepted
- **THEN** one `info` line contains `enquiryId`, `productId` and `outcome` `sent` and no other
  enquiry fields

### Requirement: Only POST is served on the enquiry route

The enquiry route SHALL accept POST only; every other method SHALL be answered with the 404 envelope.

#### Scenario: Other methods

- **WHEN** `GET`, `PUT`, `DELETE` or `PATCH` is sent to `/api/v1/enquiries`
- **THEN** the response is the 404 envelope
