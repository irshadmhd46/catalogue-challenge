## Why

A visitor on a product page must be able to ask the sales team a question, and the team must receive
it by email. This is the only write path in the system and the only public endpoint that sends
mail, so it is the first thing a bot will find. It needs strict input validation, header-injection
safe email, a rate limit, and no personal data in logs. The catalogue change also left a tracked gap:
the public read endpoints are not rate limited, and `trustProxy` was deliberately deferred until a
client IP mattered. Both land here, together, because the limiter is where the client IP is used.

## What Changes

- Add `POST /api/v1/enquiries`: validates a strict body (product id, name, email, optional phone,
  message), checks the product exists, sends an email to the sales inbox, and answers `202` with an
  enquiry id.
- Add the shared request and response schemas for the enquiry to `packages/contracts`, so the web
  form and the server validate the same rules.
- Add the `EnquiryNotifier` port and a `SmtpEnquiryNotifier` adapter (nodemailer): `From` is always
  the configured sender, the visitor's address goes only into a validated `Reply-To`, the subject and
  display names are stripped of control characters, the body is plain text, every send has a timeout
  and is never retried, and failures become a typed `NotificationError` carrying no personal data.
- Add `EnquiryService` in `application/`: confirms the product exists, assigns an id, sends, and logs
  only the enquiry id, product id and outcome.
- Add a `RateLimiter` port with memory and Redis adapters (fixed window per client IP) and an HTTP
  hook that applies a strict limit to enquiries and a generous one to catalogue reads, answers `429`
  with `Retry-After` in the shared envelope, adds `X-RateLimit-*` headers, and fails open (with an
  error log) when the store fails.
- Add an explicit `trustProxy` setting (`TRUST_PROXY_HOPS`, default 0) with tests proving a spoofed
  `X-Forwarded-For` is ignored unless trusted hops are configured.
- Extend configuration with the SMTP, mail address, rate limit and proxy settings; require the mail
  settings to be explicit and TLS to be used in production.
- Add a minimal `compose.yaml` with Mailpit (local SMTP sink and web UI) and an optional `redis`
  profile, so the whole flow can be tried locally. The api and web services join it in
  `web-storefront`.
- Share the single Redis connection between the cache and the rate limiter and close the SMTP
  transport on shutdown.

No breaking changes to existing endpoints; catalogue reads gain rate limit headers and can now
answer 429.

## Capabilities

### New Capabilities

- `enquiry-endpoint`: the `POST /api/v1/enquiries` route, its schema, status codes, and the privacy
  rules for what is logged.
- `enquiry-service`: the use case: product must exist, enquiry id, send, outcome logging.
- `enquiry-notifier-smtp`: the `EnquiryNotifier` port and the SMTP adapter, including email
  construction, header-injection safety, timeouts and error mapping.
- `rate-limiting`: the `RateLimiter` port, the memory and Redis adapters, the HTTP hook, 429 and
  headers, fail-open behaviour, and `trustProxy`.

### Modified Capabilities

- `api-config`: SMTP, sender, sales inbox, rate limit and proxy settings, with production rules.
- `catalogue-endpoints`: catalogue reads are rate limited and report their limit in headers.
- `api-lifecycle`: shutdown also closes the SMTP transport; the Redis connection is shared and
  closed once.

## Impact

- **New code**: `packages/contracts/src/enquiry.ts`; in `apps/api/src`: `domain/` (`enquiry.ts`,
  `enquiry-notifier.ts`, `rate-limiter.ts`), `application/enquiry-service.ts`,
  `infrastructure/mail/`, `infrastructure/rate-limit/`, `http/enquiry-routes.ts`,
  `http/rate-limit.ts`; wiring in `compose.ts`, `app.ts` and config.
- **Dependencies**: `nodemailer` and `@types/nodemailer` (api). `npm install` is required, and the
  lockfile changes. No new rate-limit dependency (see design).
- **Existing files touched**: `app.ts` (trustProxy, rate limit hook, route), `config`, `.env.example`,
  `domain/errors.ts` (`NotificationError` gains a log-only `enquiryId`), `redis-cache.ts` (client
  interface shared with the limiter), the error-handler test table.
- **New files outside the api**: `compose.yaml`.
- **Public surface**: `POST /api/v1/enquiries`; `429` and `X-RateLimit-*` on API routes.

## Assumptions

- A synchronous send is acceptable: the request waits for the SMTP server to accept the message
  (bounded by a timeout) and answers `202`. The enquiry is not persisted, so if the send fails the
  visitor is told and can retry; nothing is queued. Persist-and-queue is the recorded next step.
- Exactly one sales inbox receives every enquiry. Routing by product or category is not needed.
- The visitor does not receive a confirmation email, so the service never sends mail to an address
  taken from the request. This removes a spam-relay and reflection risk by design.
- Product text from the upstream appears in the email subject and body. It is untrusted, so it is
  stripped of control characters and truncated before it reaches a header.
- Limits: 5 enquiries per minute and 120 catalogue reads per minute per client IP. These are
  starting points held in configuration, not tuned numbers.
- A fixed one-minute window is good enough for abuse protection: a client can briefly send up to
  twice the limit across a window boundary. A sliding window is a next step.
- Behind an AWS load balancer or the local proxy there is one trusted hop, so deployments set
  `TRUST_PROXY_HOPS=1`. The default is 0 so a direct connection cannot spoof its address.
- Internationalised email addresses (non-ASCII local parts) are rejected by the validator. This is a
  known limitation, not a goal.

## Out of Scope

- The React enquiry form and its error handling: `web-storefront`.
- `Dockerfile`s and the api and web services in `compose.yaml`: `web-storefront`.
- Persisting enquiries, queued or retried delivery, and delivery receipts.
- CAPTCHA or other bot challenges, and per-email or per-product limits.
- HTML email, attachments, and confirmation email to the visitor.
- Authentication; there are no accounts.
