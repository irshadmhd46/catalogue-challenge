## 1. Dependencies and local environment

- [ ] 1.1 Add `nodemailer` to `apps/api` dependencies and `@types/nodemailer` to its devDependencies
- [ ] 1.2 **Owner action**: run `npm install` on a network where it works (the build machine's Node cannot reach the registry), then confirm `node_modules/nodemailer` exists and `package-lock.json` only lists registry.npmjs.org URLs
- [ ] 1.3 Read the installed `nodemailer` typings and confirm the API the design assumes (`createTransport`, `jsonTransport`, `sendMail` result, `close`, `requireTLS`, `ignoreTLS`, the error `code`/`command`/`responseCode` properties); note any difference in the design before coding
- [ ] 1.4 Add a minimal `compose.yaml`: `mailpit` (`docker.io/axllent/mailpit`, SMTP 1025 and UI 8025) and a `redis` service (`docker.io/library/redis:7-alpine`, port 6379) under the `redis` profile; no privileged ports, no secrets

## 2. Contracts: enquiry schemas

- [ ] 2.1 Implement `packages/contracts/src/enquiry.ts`: `enquiryRequestSchema` (strict; product id pattern reused from `requests.ts`, name, email, optional phone, message with the control-character rule that still allows newlines and tabs), `enquiryResponseSchema`, inferred types; add `enquiryPaths` to `paths.ts`; export from `index.ts`
- [ ] 2.2 Test valid parsing: trimming, optional phone, a multi-line message, every field boundary (100/254/2000/10, 5/30) accepted and one past it rejected
- [ ] 2.3 Test every rejected email form (`a@b`, list, display name, angle brackets, space, CRLF injection, trailing newline, leading `@`), control characters in name and message (NUL, escape, newline in name), empty-string phone, wrong types (`"7"`, 1.5, 0, 10 digits), missing fields, and extra properties (`to`, `cc`, `bcc`)
- [ ] 2.4 Test that no issue message contains the submitted value (email `hunter2@`, a long message, a bad phone)
- [ ] 2.5 Test the response schema and the paths constant

## 3. Domain: ports and the typed failure

- [ ] 3.1 Add `src/domain/enquiry.ts` (`Enquiry`: id, receivedAt, product `{ id, title }`, name, email, optional phone, message; all readonly) and `src/domain/enquiry-notifier.ts` (the `EnquiryNotifier` port with its failure contract)
- [ ] 3.2 Add `src/domain/rate-limiter.ts`: the `RateLimiter` port and the `RateLimitResult` type
- [ ] 3.3 Give `NotificationError` an optional log-only `enquiryId`; test that it is a property, not part of `publicMessage`, `message` or `details`, and that `cause` is kept (extend `errors.test.ts`)

## 4. EnquiryService (service layer: tests first)

- [ ] 4.1 Add test support: `FakeEnquiryNotifier` (records calls, can reject), a fixed id generator and clock, and reuse `FakeProductSource` and `FakeLogger`
- [ ] 4.2 Write `test/application/enquiry-service.test.ts` (RED): product looked up once with the request's id, notifier receives the catalogue's title and id (not any request value), the visitor's fields unchanged, generated id and clock time, result is the id, two enquiries get different ids
- [ ] 4.3 RED for failures: `NotFoundError` and `UpstreamError` from the catalogue are rethrown unchanged and the notifier is not called; a notifier failure becomes a `NotificationError` with `cause` and `enquiryId`; a `NotificationError` from the notifier keeps the chain and gains the id; the notifier is called exactly once (no retry); the public message and details hold no visitor data or id
- [ ] 4.4 RED for logging: success writes exactly one `info` line with `enquiryId`, `productId`, `outcome: 'sent'` and no visitor field; failure writes no line
- [ ] 4.5 Implement `src/application/enquiry-service.ts` (GREEN) with constructor injection of the catalogue service, notifier, logger, id generator and clock
- [ ] 4.6 REFACTOR, then run the mutation check on every test (delete the production line; does a test fail?) and confirm every stub is used

## 5. Configuration

- [ ] 5.1 Extend `src/config/index.ts` with the mail, rate limit and proxy settings, the production rules (explicit mail settings, TLS not `none`), the credential pair rule, the plain-address rule for `MAIL_FROM` and `SALES_INBOX`, and the allowlisted summary additions (`notifierDriver`, `smtpHost`)
- [ ] 5.2 Test configuration: defaults, explicit values, each production rule (missing each of the three, `SMTP_TLS` none or unset), credential pair (user only, password only), every rejected address form, every bound, and that neither the password nor an offending address is echoed
- [ ] 5.3 Test the summary: new fields present; user, password, sender and sales inbox absent from the serialised form
- [ ] 5.4 Update `.env.example` with placeholders for every new variable (no credentials) and update the bootstrap summary test

## 6. SMTP notifier

- [ ] 6.1 Implement `src/infrastructure/mail/enquiry-email.ts`: `buildEnquiryEmail(enquiry, { from, to })` as a pure function with `sanitiseHeader` (control characters including C1 and U+2028/2029 removed, whitespace collapsed, subject truncated to 150 with an ellipsis)
- [ ] 6.2 Test the builder as tables: fixed from and to, `replyTo` with sanitised name, no cc/bcc/html/attachments, subject format, injection in name and in product title (CR, LF, U+2028, U+2029, NUL), 500-character title, body content with and without phone, multi-line message unchanged, HTML in the message verbatim, `X-Enquiry-Id` header, visitor address only in `replyTo` and body
- [ ] 6.3 Implement `src/infrastructure/mail/smtp-enquiry-notifier.ts`: `MailTransport` interface, `SmtpEnquiryNotifier` (one `sendMail` per enquiry, total deadline race, errors rebuilt from `code`/`command`/`responseCode`, `close()`), and `createSmtpTransport(config)` with the timeouts, TLS mode and optional auth
- [ ] 6.4 Test through nodemailer's `jsonTransport`: the serialised message has the right headers and body, no Bcc after a hostile name, and one transport call per send
- [ ] 6.5 Test failure mapping with stub transports: `EAUTH` with a response containing the visitor's address (neither error, cause nor serialised form contains it), `ECONNREFUSED`, a non-Error rejection, the message text of the cause, `cause` never holding the raw response
- [ ] 6.6 Test the deadline with fake timers: a slow transport rejects with `NotificationError` at the deadline, a late success changes nothing and is not an unhandled rejection, and the transport was called once
- [ ] 6.7 Test `createSmtpTransport` options: timeouts equal `SMTP_TIMEOUT_MS`, pooling off, `starttls` sets `requireTLS`, `tls` sets `secure`, `none` sets `ignoreTLS`, credentials passed only as a pair, the password never appears in a thrown error or the transport's logged options
- [ ] 6.8 Test `close()` calls the transport's close once

## 7. Rate limiting adapters

- [ ] 7.1 Implement `src/infrastructure/rate-limit/memory-rate-limiter.ts` with an injected clock, fixed window from the first hit, purge of expired entries, and eviction of the oldest beyond 10 000 keys
- [ ] 7.2 Write the shared contract suite `test/infrastructure/rate-limiter-contract.ts` (within limit and remaining countdown, over limit with `retryAfterSeconds` in range, denied hits do not extend the window, expiry, independent keys, limit of one) and run it against the memory limiter
- [ ] 7.3 Test the memory limiter bounds: 20 000 distinct keys hold at most 10 000 entries and newest keys are still limited; expired entries are purged; a boundary test at exactly the window end
- [ ] 7.4 Extend the shared Redis client interface with `eval` and implement `src/infrastructure/rate-limit/redis-rate-limiter.ts` (one Lua script: increment, expire on first hit, return count and time left; namespaced key; reply validation; `CacheError` on failure)
- [ ] 7.5 Test the Redis limiter against the fake client: exactly one `eval` per consume with the key and window, mapping of the reply to the result, store failure becomes `CacheError` with the cause, malformed replies (wrong type, missing ttl, negative count) become `CacheError`
- [ ] 7.6 Run the shared contract suite against the Redis limiter only when `REDIS_URL` is set (skipped otherwise) and confirm `npm test` reports it as skipped

## 8. HTTP

- [ ] 8.1 Implement `src/http/rate-limit.ts`: the `onRequest` hook using route `config.rateScope`, the key `<scope>:<ip>`, `X-RateLimit-*` headers, `RateLimitedError` with `retryAfterSeconds` on denial, fail-open with an `error` line throttled to once per 30 s, nothing counted for routes without a scope
- [ ] 8.2 Test the hook with a fake limiter and fake clock: scope separation, per-address separation, headers on success, 429 envelope with `Retry-After`, exactly one `warn` per denial with no address in the line, `/healthz`, unknown routes and a malformed URL not counted, no body read or service call once limited
- [ ] 8.3 Test fail-open: the request is handled, one `error` line, no headers, 100 failures in 30 s write one line and a second line after 30 s
- [ ] 8.4 Set `trustProxy` from `TRUST_PROXY_HOPS` in `app.ts` and register the hook; test with `inject({ remoteAddress, headers })`: spoofed `X-Forwarded-For` ignored with 0 hops, honoured with 1, a longer chain cannot pick the left-most value, and the address never appears in any log line
- [ ] 8.5 Implement `src/http/enquiry-routes.ts` for `POST /api/v1/enquiries` (rate scope `enquiry`, `parseRequest`, service call, `202` body) and add `enquiryService` to `AppDependencies`
- [ ] 8.6 Test the route: accepted (202, UUID, status, notifier called once with the catalogue's title, no visitor data in the body, request id header), each invalid field named once, missing/null/array/string body, unknown property with the fixed message, unknown product 404 without a send, product source and notifier untouched on validation failure
- [ ] 8.7 Test request framing: `text/plain` and form content types give 415, an oversize body gives 413, malformed JSON gives 400 without parser text, and `GET`, `PUT`, `DELETE`, `PATCH` give the 404 envelope
- [ ] 8.8 Test failures: a failing notifier gives 502 `NOTIFICATION_FAILED` with exactly one `error` line carrying the `enquiryId`, a timing-out notifier gives the same envelope, an upstream failure on the product lookup gives 502/504 and no send, the sixth enquiry in a window gives 429 with the notifier called five times, and recovery after the window
- [ ] 8.9 Add `config: { rateScope: 'read' }` to the five catalogue routes; test the headers (`120` / `119`), that all five share one bucket, 429 at the limit with the service not called, and that unknown product ids stop reaching the source for a limited client
- [ ] 8.10 Write the privacy test: drive one accepted enquiry, one validation failure, one unknown product, one rate-limited request and one failing notifier through the real pino adapter capturing output, and assert no captured text contains the submitted email, phone, name or message
- [ ] 8.11 Whole-stack tests through `inject` with the real service, routes, hook, memory limiter and a `jsonTransport`: an enquiry produces one message with the right headers and body; five accepted then a 429; a hostile name and title produce no extra header

## 9. Composition and lifecycle

- [ ] 9.1 Extend `compose.ts`: create one Redis client for the Redis driver and share it between `RedisCache` and `RedisRateLimiter`, choose the limiter by the cache driver, build the SMTP transport and notifier, the `EnquiryService`, register closers (SMTP then Redis, one `redis` closer), and add `createTransport` to `ComposeDeps`
- [ ] 9.2 Test composition: one Redis client with the Redis driver used by both cache and limiter, none with memory, closers in the right order and counts, an SMTP close failure is reported and the rest still close, config values reach the transport (host, port, TLS, timeout), the sender and inbox reach the notifier, the limits reach the app dependencies
- [ ] 9.3 Pass the limits, `limiter` and `enquiryService` from composition into `buildApp`; update `bootstrap`, `main` and the test helpers (`build-test-app.ts`, bootstrap tests) for the new dependencies

## 10. Verification against real services

- [ ] 10.1 Run the service locally against Mailpit (`podman compose up mailpit`, or `podman run -p 1025:1025 -p 8025:8025 docker.io/axllent/mailpit`): post a valid enquiry, confirm 202 and that the message arrives in the Mailpit UI (`http://localhost:8025`) with `From`, `To`, `Reply-To`, the subject and a plain-text body
- [ ] 10.2 Post a hostile enquiry (name `Ann\r\nBcc: x@evil.test`, message with HTML) and confirm the delivered message has no extra header and the HTML is shown as text
- [ ] 10.3 Stop Mailpit and post again: 502 `NOTIFICATION_FAILED` with a request id, one `error` log line with the `enquiryId`, no address in any log line; restart Mailpit and confirm it works again
- [ ] 10.4 Send six enquiries in a minute: the sixth is 429 with `Retry-After`; wait for the window and confirm acceptance again; hit a catalogue route and confirm the `X-RateLimit-*` headers
- [ ] 10.5 Check `trustProxy` for real: with `TRUST_PROXY_HOPS=0` a spoofed `X-Forwarded-For` does not reset the limit; with `TRUST_PROXY_HOPS=1` it does select the bucket
- [ ] 10.6 **Owner action**: with `CACHE_DRIVER=redis` and Redis running, confirm the limit is shared by two API instances on different ports (the sixth enquiry across both is 429), that `rl` keys appear under `catalogue:v1:`, that stopping Redis lets enquiries through with a throttled `error` line, and run `REDIS_URL=redis://127.0.0.1:6379 npm test -w @catalogue/api` to confirm the Redis limiter contract passes
- [ ] 10.7 Run the claim checks from `security.md` by grep: the rate limit hook is registered and every route has a scope, `bodyLimit` and `trustProxy` are set, no request field reaches `from`, `to`, `cc` or `bcc`, the notifier is called from one place, no log call passes the visitor's fields, `process.env` is still read only in `config/`

## 11. Quality gates and review

- [ ] 11.1 Design principles check: SRP, DRY (limits, windows, key formats, sanitising and address rules defined once), DIP (no `new` of an adapter outside `compose.ts`), no presentation leak into the service, immutability
- [ ] 11.2 Run `npm run typecheck && npm run lint && npm test`, `npm run build`, `npm run smoke:build` and `npm run test:coverage` (80%+ on `application/`, `domain/`, `infrastructure/`); run the dependency advisory check against the new lockfile (the direct advisory query, since `npm audit` cannot reach its endpoint)
- [ ] 11.3 Record in `DECISIONS.md`: synchronous send and no persistence (queue as next step), the own-limiter choice and its limits (fixed window, IPv6, shared NAT), fail-open with a throttled error, `trustProxy` guidance per deployment, 202 semantics, internationalised addresses, nothing is sent to the visitor
- [ ] 11.4 Review gate: run the `code-reviewer` agent, then the `security-reviewer` agent; fix CRITICAL and HIGH findings and MEDIUM where cheap; save the report to `.claude/reviews/product-enquiry.md`
- [ ] 11.5 Add anything the reviews caught that the building pass got wrong to `AI_USAGE.md`
- [ ] 11.6 Commit in logical units (contracts, domain, service, config, mail, rate limiting, http, composition, docs) with conventional commits; chain each commit on a green typecheck, lint and test run; review `git status` and the diff first; no remote, no push
