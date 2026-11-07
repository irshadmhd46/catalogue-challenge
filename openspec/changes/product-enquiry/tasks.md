## 1. Dependencies and local environment

- [x] 1.1 Add `nodemailer` and `@types/nodemailer`
- [x] 1.2 Owner: `npm install` (done)
- [x] 1.3 Confirm the installed nodemailer API (CommonJS 10.3.1; `createTransport`, `close`, `requireTLS`, `ignoreTLS`, timeouts; connection failures report `code=ESOCKET command=CONN`; header names normalised, e.g. `X-Enquiry-ID`)
- [x] 1.4 `compose.yaml` with Mailpit: moved to `web-storefront`, where the api and web services join it so one command runs everything

## 2. Contracts: enquiry schemas

- [x] 2.1 Implement `enquiryRequestSchema` (strict), `enquiryResponseSchema` and `enquiryPaths`
- [x] 2.2 Test valid parsing, trimming, optional phone and every boundary
- [x] 2.3 Test rejected email forms, control characters, wrong types and extra properties (`to`, `cc`, `bcc`)
- [x] 2.4 Test that no issue message echoes the submitted value
- [x] 2.5 Test the response schema and the paths constant

## 3. Domain

- [x] 3.1 `Enquiry` type and the `EnquiryNotifier` port (failure causes must carry no personal data)
- [x] 3.2 `RateLimiter` port
- [x] 3.3 `NotificationError` carries a log-only `enquiryId`

## 4. EnquiryService (tests first)

- [x] 4.1 to 4.6 Product looked up through the catalogue, title taken from the catalogue not the request, one send and no retry, failures wrapped with cause and enquiry id, one success log line with identifiers only; mutation-checked

## 5. Configuration

- [x] 5.1 to 5.4 SMTP, sender, sales inbox, limits and `TRUST_PROXY_HOPS`, with production rules (explicit mail settings, TLS), credential pair rule, plain-address rule; summary shows only non-secret fields; `.env.example` updated

## 6. SMTP notifier

- [x] 6.1 and 6.2 `buildEnquiryEmail`: fixed sender and recipient, visitor only as Reply-To, header sanitising, plain text only
- [x] 6.3 `SmtpEnquiryNotifier` (one send, total deadline, errors rebuilt from code/command/status) and `createSmtpTransport` (timeouts, TLS mode, no pooling, SMTP logging off, no file or URL access)
- [x] 6.4 Transport tested against an in-process loopback SMTP server (real wire format, envelope, hostile name and title)
- [x] 6.5 to 6.8 Failure mapping without personal data, deadline with fake timers, transport options, `close()`

## 7. Rate limiting

- [x] 7.1 `MemoryRateLimiter`: fixed window, bounded memory (purge once a second, evict the oldest beyond 10 000 keys)
- [x] 7.2 and 7.3 Shared contract suite and memory bound tests
- [x] 7.4 to 7.6 Redis limiter and its contract run: cut, see `DECISIONS.md` (beyond the brief; per-process limit accepted)

## 8. HTTP

- [x] 8.1 to 8.3 Rate limit hook (`onRequest`, opt-in scopes, headers, 429 envelope, fail-open with a throttled error line) and its tests
- [x] 8.4 `trustProxy` from `TRUST_PROXY_HOPS`, tested: a spoofed `X-Forwarded-For` is ignored with 0 hops and the nearest hop wins otherwise
- [x] 8.5 to 8.8 `POST /api/v1/enquiries` and its tests: 202, validation, unknown product, framing (415, 400, 413), other methods, failures, rate limit
- [x] 8.9 Catalogue reads share a read scope and are limited
- [x] 8.10 Personal data never reaches a log line (real pino adapter across five outcomes)
- [x] 8.11 End to end over real SMTP on loopback: the acceptance criterion (an email reaches the sales inbox, the caller gets a 202)

## 9. Composition

- [x] 9.1 to 9.3 `compose.ts` builds the SMTP notifier, `EnquiryService` and limiter; SMTP closer after the server; tests for config reaching the transport and notifier

## 10. Verification

- [ ] 10.1 Run the full stack with Mailpit (`docker compose up`, with `web-storefront`) and confirm the enquiry arrives in the Mailpit UI with the right headers
- [x] 10.2 Claim checks by grep: see `.claude/reviews/product-enquiry.md`

## 11. Quality gates and review

- [x] 11.1 Design principles check and `npm run typecheck && npm run lint && npm test`, `npm run build`, coverage, advisory check
- [x] 11.2 Review gate: `code-reviewer`, then `security-reviewer`; report in `.claude/reviews/product-enquiry.md`
- [x] 11.3 `DECISIONS.md` and `AI_USAGE.md` updated; commit in logical units
