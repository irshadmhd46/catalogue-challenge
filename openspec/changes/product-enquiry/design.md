## Context

`api-foundations` and `catalogue-api` provide the app factory, config, logging with redaction, the
error envelope (`ValidationError`, `NotFoundError`, `RateLimitedError`, `NotificationError`), the
catalogue service, an in-memory cache, and a composition root in `compose.ts`.
This change adds the one write path: an enquiry emailed to a sales inbox. Everything it touches is
untrusted or personal: the request body (name, email, phone, message), the product title (from the
upstream), and the client IP (for rate limiting).

Constraints from the rules: the visitor's address goes only into a validated `Reply-To`; `From` is
always the configured sender; the recipient never comes from the request; CR/LF stripped from
anything that reaches a header; every external call has a timeout; SMTP is never retried; no PII in
logs (enquiry logs carry `enquiryId`, `productId` and outcome only); the new public endpoint has a
rate limit and a body size limit; `trustProxy` is decided deliberately and verified by a test.

## Goals / Non-Goals

**Goals:**

- An enquiry that passes validation reliably reaches the sales inbox, or the visitor is told it did
  not (no silent loss, no duplicate sends).
- A bot cannot use the endpoint to inject headers, relay mail, flood the inbox, or learn anything
  about the system from the response.
- Rate limiting covers all public API routes and degrades without taking the API down.
- No personal data in logs or error responses.

**Non-Goals:** persistence or queued delivery, bot challenges, HTML mail, confirmation mail to the
visitor, the web form, container images.

## Decisions

### 1. The enquiry rules live in `packages/contracts`

`enquiryRequestSchema` (strict) and `enquiryResponseSchema` are defined once and used by the route
now and the web form later, so client and server cannot disagree.

| Field | Rule |
| --- | --- |
| `productId` | positive whole number, at most 9 digits (the same pattern as the product route) |
| `name` | trimmed, 1 to 100 characters, no control characters (single line) |
| `email` | trimmed, at most 254 characters, a plain address (zod `email`: no display name, no list, no CR/LF) |
| `phone` | optional; trimmed, 5 to 30 characters of digits, spaces and `+ ( ) - .`; absent or valid, never an empty string |
| `message` | trimmed, 10 to 2000 characters; newlines and tabs allowed, every other control character rejected |

Unknown properties are rejected. Messages never echo the submitted value. Checked against zod 4:
`a@b.co, c@d.co`, `"x" <a@b.co>` and `a@b.co\r\nBcc: x@y.z` are rejected; surrounding whitespace is trimmed first, so a pasted trailing newline is harmless while a line break inside the address is not.
Internationalised addresses (`ünï@example.com`) are also rejected: a known limitation, accepted.

- Alternative: write the rules in the API only. Rejected: the web form would duplicate them and drift.

### 2. Synchronous send, answer 202, no persistence

The route validates, checks the product exists, sends the email, and answers `202` with
`{ enquiryId, status: 'accepted' }` once the SMTP server has accepted the message. If the send fails
the visitor gets `502 NOTIFICATION_FAILED` and the UI offers a retry. Nothing is stored.

- Alternatives: (a) accept immediately and send in the background (loses the enquiry silently if the
  send fails or the process restarts); (b) persist first, deliver from a queue (correct, but needs a
  store and a worker, out of scope).
- Trade-off: the request holds a connection while SMTP is slow (bounded by the timeout), and a
  failure after a partly-delivered message could in theory cause a duplicate on retry. Accepted;
  recorded in DECISIONS.md with the queue as the next step.

### 3. `EnquiryService`

Receives `CatalogService`, `EnquiryNotifier`, `Logger`, an id generator and a clock by constructor.
It looks the product up through the catalogue service (so an unknown product is a `404` before any
email, and the title comes from our own cache, not the request), builds the `Enquiry`, calls the
notifier, and on success logs one `info` line with `enquiryId`, `productId`, `outcome: 'sent'`.
On notifier failure it rethrows a `NotificationError` carrying the `enquiryId` as a log-only
property (never in the response) so the central handler's single log line can be matched to the
visitor's retry. It never logs a failure itself (log once).

### 4. The SMTP adapter and email construction

- **`buildEnquiryEmail`** is a pure function (tested without nodemailer): `from` is the configured
  sender; `to` is the sales inbox; `replyTo` is `{ name, address }` for the visitor; the subject is
  `Enquiry about product <id>: <title>`; the body is plain text with the product, enquiry id, name,
  email, phone and message; a custom `X-Enquiry-Id` header carries the id. There is no `cc`, `bcc`,
  `html` or attachment, and no field of the request chooses a recipient.
- **Sanitising**: anything that reaches a header (subject, reply-to name) has every control
  character (C0, DEL, C1, U+2028, U+2029) removed, whitespace collapsed, and the subject truncated to
  150 characters. The product title is untrusted upstream text and gets the same treatment. The
  message goes only in the body. This is repeated here even though the boundary validated the same
  fields: the adapter does not trust its caller.
- **Transport**: `MailTransport` is a two-method interface (`sendMail`, `close`) so tests use
  nodemailer's `jsonTransport` or a stub and never open a socket. `createSmtpTransport(config)`
  builds the real one: no pooling, `connectionTimeout`, `greetingTimeout` and `socketTimeout` from
  `SMTP_TIMEOUT_MS`, TLS mode from `SMTP_TLS` (`none` | `starttls` | `tls`; `starttls` sets
  `requireTLS`, `none` sets `ignoreTLS` so a local sink is used as-is), optional `SMTP_USER` and
  `SMTP_PASSWORD`.
- **Deadline**: nodemailer's timeouts are per socket event, so a slow-drip server could exceed them.
  The adapter also races each send against a total deadline of `SMTP_TIMEOUT_MS`; on expiry it
  rejects with a `NotificationError` (a late result is ignored).
- **No retry**: `sendMail` is called exactly once per enquiry, which is what prevents duplicate
  sales mail.
- **Errors carry no personal data**: a failed send is rethrown as `NotificationError` whose `cause`
  is a fresh `Error` built only from nodemailer's `code`, `command` and `responseCode`
  (for example `smtp send failed: EAUTH AUTH 535`). The raw `response` string and the library message
  can echo addresses or message fragments, so they are dropped. This also closes the gap noted in the
  `api-foundations` security review ("redaction paths cover shapes nothing logs yet; the real risk
  is `err`").

### 5. Rate limiting: a small port with an in-memory adapter, not a plugin

`RateLimiter.consume(key, limit, windowSeconds)` returns `{ allowed, limit, remaining,
retryAfterSeconds }`. `MemoryRateLimiter` is the only adapter: it is per process, so with several API
instances each enforces its own limit (a shared Redis limiter was designed, built, then cut as beyond
the brief; see DECISIONS.md). It uses a fixed window: the first hit starts the window and it ends
`windowSeconds` after the first hit.

- **Memory adapter**: a `Map` with an injected clock, expired entries purged on access and when the
  map passes 10 000 keys, then the oldest evicted, so a flood of source addresses cannot grow memory
  without bound.
- **HTTP hook** (`http/rate-limit.ts`, an `onRequest` hook, so a limited request is rejected before
  its body is read): routes opt in with `config: { rateScope: 'read' | 'enquiry' }`. Key =
  `<scope>:<client ip>`. Every response on a limited route carries `X-RateLimit-Limit` and
  `X-RateLimit-Remaining`; a denied request is rejected by throwing `RateLimitedError`, so it uses
  the shared envelope with `Retry-After`. `/healthz`, unknown routes and framework-level errors are
  not limited.
- **Fail open, loudly**: if the store throws, the request is allowed (availability over strictness
  for a low-risk form) and an `error` line is written, at most once every 30 s so an outage does not
  flood the log. The decision is recorded in DECISIONS.md.
- **Alternative: `@fastify/rate-limit`.** It is well maintained, but: its store failures are
  silent under `skipOnError` (our rules require a log), it would put its response shape and error handling
  next to ours, and it ties the limiter to Fastify, while a port keeps the algorithm testable with a
  fake clock and swappable. The cost is about 100 lines of security-relevant code of our own, which is
  why it has a contract suite and mutation-checked tests.
- **Known limits**: a fixed window allows up to twice the limit across a boundary; IPv6 clients are
  keyed by full address (a `/64` grouping is a next step); a client behind shared NAT shares a
  bucket.

### 6. `trustProxy` is explicit and tested

`TRUST_PROXY_HOPS` (integer 0 to 5, default 0) is passed to Fastify as the number of trusted hops.
With 0, `request.ip` is the socket address and `X-Forwarded-For` is ignored. With `n`, it is the
address `n` hops from the server. Deployments behind the local proxy or an AWS load balancer set 1.
Tests drive `inject({ remoteAddress, headers })` and prove: a spoofed header does not change the key
with 0 hops, does with 1 hop, and a chain longer than the trusted hops cannot choose the address.
The client IP is used only as a rate limit key and is never logged.

### 7. Configuration

New variables, all validated in `loadConfig`: `NOTIFIER_DRIVER` (`smtp`), `SMTP_HOST`, `SMTP_PORT`,
`SMTP_TLS`, `SMTP_USER`, `SMTP_PASSWORD` (set together or not at all), `SMTP_TIMEOUT_MS`
(default 8000, 1 to 60000), `MAIL_FROM`, `SALES_INBOX` (plain addresses), `RATE_LIMIT_ENQUIRY_PER_MINUTE`
(default 5), `RATE_LIMIT_READ_PER_MINUTE` (default 120), `TRUST_PROXY_HOPS`. Outside production the
mail settings default to a local Mailpit (`localhost:1025`, no TLS, `no-reply@catalogue.local`,
`sales@catalogue.local`). In production `SMTP_HOST`, `MAIL_FROM` and `SALES_INBOX` must be set
explicitly and `SMTP_TLS` must not be `none`. `SMTP_PASSWORD` is a secret: never in the summary,
never in an error, never in a log. The startup summary gains `notifierDriver` and `smtpHost` only.

### 8. Composition

`compose.ts` builds the SMTP transport and notifier from config, the `EnquiryService` and the memory
limiter. The SMTP closer runs after the HTTP server. `ComposeDeps` has a `createTransport` factory so
tests inject a stub (and the real transport is also tested against a loopback SMTP server).

### 9. Local environment

`compose.yaml` runs Mailpit (SMTP on 1025, web UI on 8025, both above 1024 so rootless Podman works)
together with the API and web services, which are added in `web-storefront`. Mailpit is the manual
check for "the sales inbox receives the email".

### 10. Failure policy per external dependency

| Dependency | Timeout | Retry | On failure | Logging |
| --- | --- | --- | --- | --- |
| SMTP server | 8 s total (connection, greeting and socket timeouts the same) | none, ever | `NotificationError` 502; visitor can retry | one `error` from the central handler with `enquiryId`; cause is code/command/responseCode only |
| Rate limiter store (in-memory) | n/a | n/a | fail open if it ever throws: request allowed | `error`, at most once per 30 s |
| Upstream catalogue (product lookup) | as in `catalogue-api` | as in `catalogue-api` | `UpstreamError` 502/504, no email sent | central handler |

### 11. Test strategy

- Service tests first (RED then GREEN) with a fake catalogue source and a fake notifier.
- `buildEnquiryEmail` as a table: header injection attempts in name, subject and product title,
  sender and recipient fixed, no extra headers, plain text only.
- Adapter tests with stub transports for each failure and timeout, and the real transport against a
  loopback SMTP server for the wire format.
- A shared `RateLimiter` contract suite for the memory adapter, reusable by a future adapter.
- Hook tests with a fake limiter and a fake clock: scopes, headers, 429 envelope and `Retry-After`,
  fail-open with a single throttled `error`, `/healthz` and 404 not limited.
- A logging test across the whole flow (success, notifier failure, validation failure, 404, 429) that
  captures every log line through the real pino adapter and asserts none contains the submitted
  email, phone, name or message.
- End-to-end tests through `inject` with the real service, route, hook, memory limiter and the real
  SMTP transport against an in-process loopback SMTP server.

## Risks / Trade-offs

- [An enquiry can be lost: it is not persisted, and a crash between SMTP accept and the 202 is not
  visible] -> The visitor sees an error on any failure we know about; queued delivery is the
  recorded next step.
- [Our limiter has a bug that blocks everyone or nobody] -> Contract suite, mutation checks on every
  boundary, and the `trustProxy` tests.
- [Per-process limits are not shared across API instances] -> Accepted for a proof of concept; a shared
  store (Redis) behind the same port is the recorded next step.
- [A shared NAT or office blocks real visitors at 5 per minute] -> The limits are configuration.
- [Product titles with exotic Unicode in the subject] -> Control characters are removed and the
  subject truncated; mail clients encode the rest (RFC 2047) through nodemailer.
- [nodemailer 10 API differs from what the design assumes] -> The adapter depends on a two-method
  interface and is exercised through `jsonTransport`, so a mismatch shows up in the first test run;
  the real SMTP path is checked against Mailpit by hand.
- [Spam through a correct, validated form] -> Rate limit plus the fixed recipient limits the harm to
  one inbox at 5 messages per minute per address; CAPTCHA is out of scope and recorded.

## Open Questions

- Whether the sales team wants the visitor's phone required. Left optional.
- Whether a `/64` IPv6 grouping is needed before production. Left as a next step.
