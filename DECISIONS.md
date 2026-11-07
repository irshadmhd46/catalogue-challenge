# Decisions

Short records of choices that are not obvious from the code. Per-change design notes live in
`openspec/changes/*/design.md` and `openspec/changes/archive/`.

## Stack

Node.js 22 + TypeScript + Fastify for the API, React + TypeScript + Vite for the client, a shared
`packages/contracts` (zod) for the public API shapes. One language end to end, so the request and
response types are written once and used by both sides. Runs with `docker compose up` (Podman works too);
images are plain OCI so they build unchanged on AWS.

## Assumptions (where the acceptance criteria were unclear)

- **"I have chosen 5 products to be top rated"** means the featured list is a *selection*. It is
  configured with `FEATURED_PRODUCT_IDS` (a stand-in for a future admin screen). When it is not set, the
  default is the 5 highest rated products. Unknown ids in the setting are skipped with a warning.
- **"Top rated"** is `rating.average` descending, then `rating.count` descending, then `id` ascending,
  so every list is deterministic (the real data has ties). It lives in one function.
- **Category page**: the 3 top rated products of the category, then the rest, in the same order.
- **Search** is a case-insensitive substring match over title, description and category name, done in
  the API because the upstream has no search. A blank query is a 400, never "everything".
- **Enquiry**: name, email, optional phone, message. The product must exist. One email goes to one
  configured sales inbox; the visitor's address is only the `Reply-To`. The visitor gets the "Thank you"
  message in the UI after the API answers `202`; no email is sent to the visitor.
- **No pagination, accounts or currency**: the catalogue is 20 products and the upstream gives no
  currency, so `price` is a plain number and formatting is the client's job.
- **Categories** are derived from the product data. The upstream spells one `jewelery`; the spelling is
  kept rather than patched in code.

## Upstream quirks the adapter absorbs

- The Fake Store answers **HTTP 200 with an empty body** for a product id it does not have (and for a
  non-numeric id), and 200 with `[]` for an unknown category. The adapter treats the empty body as "no
  such product" and the service raises our own 404. Category existence is decided from our own category
  list, never from the upstream's reply.
- One list call feeds featured, categories, category pages and search, so those never cost an extra
  upstream request.

## Requirements dropped or simplified, and why

The brief says a small, well-reasoned solution beats a large, unexplained one. Part of this project was
first built larger, then cut back to the brief after reading it again against the work. The cuts are
listed so the reasoning is visible, not hidden.

| Cut or simplified | Why |
| --- | --- |
| **Redis** (shared cache, shared rate limiter, reconnect strategy, compose profile) was built and tested, then removed | Not needed to meet any acceptance criterion; adds a service to run and ~190 lines plus a dependency. The `Cache` and `RateLimiter` ports remain, so a shared store is one adapter away. |
| Cache retry cooldown and validation of cached values (built, then removed) | Only matter with a shared cache that outlives a deploy, which no longer exists. |
| Upstream retry strategy: jitter, `Retry-After`, total deadline (built, then removed) | A timeout plus one retry with a fixed 200 ms pause is enough "sensible error handling" for a demo upstream. |
| Enquiries are not persisted or queued | A synchronous send is the simplest thing that satisfies "the sales inbox receives an email". If it fails the visitor sees an error and can retry; nothing is lost silently. |
| Rate limit is per process, fixed window | Stops casual abuse of the one write endpoint. With several instances each enforces its own limit. |
| No auth, pagination, CAPTCHA or HTML email | Out of scope for the acceptance criteria. |
| `npm audit` could not be run (see below) | Network restriction on both machines used, not a project choice. |

What was deliberately **kept** because the brief assesses it: a `ProductSource` port with the Fake Store
behind an adapter (the data source will change), an `EnquiryNotifier` port with SMTP behind an adapter
(the email provider will change), an in-memory cache with stale-if-error and single flight (the upstream
is slow and unreliable), input validation at every boundary, header-injection-safe email, an explicit
`trustProxy` setting, and logs that never contain the visitor's data.

## How the design grows beyond the PoC

- **Swap the data source**: add a class implementing `ProductSource`, change `CATALOG_DRIVER`. Services,
  routes and the contract do not change. The Fake Store shape never leaves `infrastructure/catalog`.
- **Swap the email provider**: add a class implementing `EnquiryNotifier` (SES, a queue, Slack). The SMTP
  adapter is configuration only (Mailpit locally, SES SMTP on AWS).
- **Change the look and feel**: the web app only talks to our `/api/v1`; styling is CSS variables in one
  theme file, so the creative work replaces tokens, not logic.
- **Share the cache and rate limit across instances**: implement `Cache` and `RateLimiter` over Redis.
- **The contract** (`packages/contracts`) is the one definition of the request and response shapes, used
  by the API and the web app, so they cannot drift.
- `src/compose.ts` is the one place that decides which adapter implements which port.

## Web storefront

- **Price format**: the upstream gives no currency; the client prints `$` with two decimals. Assumption.
- **Images** come straight from the host in `imageUrl`, so the CSP allows `img-src https:` and nothing
  else outside `'self'`. Every other request goes to our `/api/v1` through one module (a test fails if
  `fetch(` appears anywhere else).
- **Reads retry** twice on network errors and 5xx only; a 4xx never retries and shows no "Try again".
  The enquiry is never retried automatically.
- **Enquiry timeout**: the client gives up after 10 s while the API's SMTP deadline is 8 s plus
  overhead. A slow mail server can therefore show "couldn't reach the server" for an email that was
  sent, and a retry would send a second one. Accepted for the PoC; the fix is an idempotency key.
- **Behind a load balancer**: the nginx proxy sets `X-Forwarded-For` to `$remote_addr` (replace, not
  append), which is right when it faces visitors directly. With an AWS load balancer in front, add the
  `real_ip` module (`set_real_ip_from <balancer CIDR>`, `real_ip_header X-Forwarded-For`) or terminate
  the balancer straight onto the API with `TRUST_PROXY_HOPS=1`.
- **Compose is a local demo**: `NODE_ENV=development` allows plain-text SMTP to Mailpit; the production
  rules (TLS, explicit mail settings) are enforced when `NODE_ENV=production`.

## Failure policy

- **Upstream**: every call has a timeout (4 s) and one retry on network errors, timeouts, 5xx and 429.
  Failures are typed (`UpstreamError` 502, `UpstreamTimeoutError` 504) and shown to the visitor with a
  request id that matches a log line.
- **Cache**: entries are fresh for 60 s and usable as stale for an hour. If the upstream fails and a stale
  entry exists it is served with a warning; with nothing cached the typed error reaches the client. Known
  limit: while the upstream is down, each request after the fresh window waits for a refresh attempt
  (up to about 8 s) before the stale copy is served; a retry cooldown or circuit breaker is the fix.
- **Absence is not cached**: each distinct unknown product id costs one upstream call. The rate limit is
  what bounds this.
- **SMTP**: 8 s total deadline, never retried (a retry could send the same enquiry twice). Failure is a
  `502` and the visitor can retry. Error causes carry only a code, command and status, never the server's
  text, because that text can echo the visitor's address.
- **Rate limiter fails open** if its store ever throws (availability over strictness for a low-risk form),
  with an error log at most every 30 s.

## Security notes

- Every request input is validated with the shared schemas before it reaches a service, adapter or cache
  key; unknown properties are rejected; messages never echo the submitted value.
- Upstream product text and `imageUrl` are untrusted. The API returns them as JSON (safe); the web client
  renders them as text and never as HTML.
- `TRUST_PROXY_HOPS` is explicit (0 by default). Behind the compose proxy or an AWS load balancer set `1`.
  With 0 a spoofed `X-Forwarded-For` is ignored (tested). The client address is only a rate limit key and
  is never logged.
- `NotificationError` carries a log-only `enquiryId`, so a failed attempt can be matched to the visitor's
  retry without logging who they are.
- Internationalised email addresses (non-ASCII local parts) are rejected by the validator: a known
  limitation.

## Engineering notes

- **Composition root is `src/compose.ts`, started by `main.ts`.** The rule text says adapters are created
  "only in `main.ts`"; the intent (one place, never inside services) is unchanged. The wiring moved to an
  importable module so driver choice and config-to-adapter mapping can be tested.
- `packages/contracts` is read from source by typecheck, tests and `tsx` (via `paths` and a Vitest alias)
  and from `dist` at build and runtime (via `exports`); the root `build` script builds it first.
  `npm run smoke:build` checks the `dist` path.
- One unmappable upstream product fails the whole list (a wrong shape is an `UpstreamError`). Skipping
  bad items would be friendlier for a swappable source but hides data problems.

## Dependency audit

`npm audit` could not reach its endpoint, neither from the build machine nor from the owner's machine
(Node's TLS connection to the audit endpoint is reset, while `curl` to the registry works). Instead:

- `npm install` on the owner's machine reported **7 moderate and no high or critical** vulnerabilities.
- The final lockfile's package/version pairs (361 packages, including the web app) were POSTed with
  `curl` to the registry's bulk advisories endpoint. The only advisory returned is `minimatch`
  (moderate, via `typescript-eslint`), a dev dependency that is not in the runtime images.

Re-run `npm audit --audit-level=high` from a network where the endpoint is reachable before release.

## What I would do next with another day

1. Persist enquiries and deliver them from a queue, so a failed send is retried safely and nothing is lost.
2. Move the cache and rate limiter to Redis (ElastiCache on AWS) behind the existing ports.
3. A circuit breaker or retry cooldown for the upstream outage case above.
4. A real catalogue source with server-side search and paging; the `ProductSource` port is where that lands.
5. CAPTCHA or another bot check on the enquiry form, and an admin screen for the featured selection.
6. Sliding-window rate limiting and IPv6 /64 grouping.
