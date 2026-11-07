# enquiry-notifier-smtp Specification

## Purpose

The `EnquiryNotifier` port and its SMTP adapter: email construction, header safety, timeouts and error mapping.

## Requirements

### Requirement: EnquiryNotifier port hides the channel

The domain SHALL define an `EnquiryNotifier` port with `send(enquiry)`. Implementations SHALL signal
failure with a `NotificationError` and SHALL NOT retry a send.

#### Scenario: Success resolves

- **WHEN** the channel accepts the message
- **THEN** `send` resolves with no value

#### Scenario: Failure is typed

- **WHEN** the channel rejects the message or cannot be reached
- **THEN** `send` rejects with a `NotificationError`

### Requirement: The email has fixed sender and recipient

The SMTP notifier SHALL send from the configured sender address, to the configured sales inbox, with
the visitor as `Reply-To`. No field of the request SHALL choose the sender, a recipient, `cc` or
`bcc`.

#### Scenario: Addresses

- **WHEN** an enquiry from `ann@example.test` is sent
- **THEN** the message `from` is the configured `MAIL_FROM` and `to` is the configured `SALES_INBOX`
- **AND** `replyTo` is `ann@example.test` with the visitor's name
- **AND** the message has no `cc`, `bcc`, `html` or attachments

#### Scenario: Visitor address never becomes a sender or recipient

- **WHEN** the visitor's email is `attacker@example.test`
- **THEN** it appears only in `replyTo` and the body, not in `from`, `to` or the envelope

### Requirement: Header values are free of control characters

Every value that reaches a header (subject, reply-to name, enquiry id) SHALL have control characters
removed, whitespace collapsed, and the subject SHALL be at most 150 characters.

#### Scenario: Injection in the visitor's name

- **WHEN** the name is `Ann\r\nBcc: x@evil.test`
- **THEN** the serialised message has no `Bcc` header and the reply-to name contains no CR or LF

#### Scenario: Injection through the product title

- **WHEN** the product title is `Widget\r\nSubject: spam X`
- **THEN** the subject is one line with no CR, LF, U+2028 or U+2029

#### Scenario: Long subject

- **WHEN** the product title is 500 characters
- **THEN** the subject is at most 150 characters and ends with an ellipsis

#### Scenario: Subject content

- **WHEN** an enquiry about product 7 titled `Backpack` is sent
- **THEN** the subject is `Enquiry about product 7: Backpack`

### Requirement: The body is plain text with the enquiry details

The message body SHALL be plain text containing the enquiry id, the product id and title, the
visitor's name, email and phone (when given) and the message, and SHALL carry the enquiry id in an
`X-Enquiry-Id` header.

#### Scenario: Body content

- **WHEN** an enquiry with a phone and a three-line message is sent
- **THEN** the text body contains all fields and the three lines unchanged

#### Scenario: HTML in the message is not interpreted

- **WHEN** the message contains `<script>alert(1)</script>`
- **THEN** it appears verbatim in the text body and the message has no HTML part

#### Scenario: Missing phone

- **WHEN** no phone was given
- **THEN** the body contains no phone line

### Requirement: Sending is bounded and never retried

Each send SHALL use connection, greeting and socket timeouts of `SMTP_TIMEOUT_MS` and SHALL be
abandoned after `SMTP_TIMEOUT_MS` in total, rejecting with a `NotificationError`. The transport
SHALL be called once per enquiry.

#### Scenario: Slow server

- **WHEN** the transport does not answer within `SMTP_TIMEOUT_MS`
- **THEN** `send` rejects with a `NotificationError`
- **AND** the transport was called once

#### Scenario: Late success is ignored

- **WHEN** the transport resolves after the deadline
- **THEN** `send` has already rejected and the late result changes nothing

#### Scenario: Transport options

- **WHEN** the real transport is created from configuration
- **THEN** its timeouts equal `SMTP_TIMEOUT_MS`, pooling is off, `starttls` sets `requireTLS`, `tls`
  sets `secure`, and credentials are passed only when both user and password are configured

### Requirement: Failures carry no personal data

A failed send SHALL be reported as a `NotificationError` whose `cause` is built only from the
transport error's `code`, `command` and `responseCode`. The raw server response and library message
SHALL NOT be kept.

#### Scenario: Authentication failure

- **WHEN** the transport rejects with code `EAUTH`, command `AUTH`, responseCode 535 and a response
  text containing `ann@example.test`
- **THEN** the `NotificationError` cause message includes `EAUTH`, `AUTH` and `535`
- **AND** neither the error, its cause nor its serialised form contains `ann@example.test`

#### Scenario: Connection failure

- **WHEN** the transport rejects with `ECONNREFUSED`
- **THEN** the error is a `NotificationError` with a cause naming `ECONNREFUSED`

#### Scenario: Unknown failure shape

- **WHEN** the transport rejects with a value that is not an Error
- **THEN** the result is still a `NotificationError` with a generic cause

### Requirement: The transport is closed on shutdown

The notifier SHALL expose `close()` that closes the underlying transport.

#### Scenario: Close

- **WHEN** `close()` is called
- **THEN** the transport's `close` is called once
