## Context

`api-foundations` provides the app factory, config, `Logger` port, request context, `AppError`
hierarchy and central error handler. This change adds the product catalogue on top. The only
upstream is the Fake Store demo API, checked live while writing this design:

- `GET /products` returns 20 products with `id`, `title`, `price`, `description`, `category`,
  `image` and `rating: { rate, count }`; four categories (`electronics`, `jewelery` [sic],
  `men's clothing`, `women's clothing`); ratings have ties (two products at 4.8, two at 4.7).
- A missing id (`/products/9999`) and a non-numeric id (`/products/abc`) both return **HTTP 200 with
  an empty body**, not 404. An unknown category returns 200 with `[]`.
- Responses take roughly 300 ms to 1.5 s and the service is a free demo, so slowness and outages are
  expected.

Constraints from the rules: the web app only talks to our API; the upstream shape stops at its
adapter; ports in `domain/`, adapters in `infrastructure/`, adapters built only in `main.ts`;
every external call has a timeout and a recorded failure policy; a cache is an optimisation, never
a dependency.

## Goals / Non-Goals

**Goals:**

- A stable `/api/v1` catalogue contract that does not change when the data source does.
- The source, the cache and the email-free read path are swappable by adding a class and changing
  an environment variable.
- A visitor still gets pages when the upstream is slow or down (stale-if-error), and the process
  survives a Redis outage.
- Every error path is typed, logged once, and returns the shared envelope.

**Non-Goals:**

- Enquiries, rate limiting, `trustProxy`, containers, the web app.
- Pagination, write paths, negative caching, HTTP caching headers.

## Decisions

### 1. One list call feeds everything; the port stays small

`ProductSource` has two methods: `listProducts()` and `findProduct(id)` (returns `undefined` when
the product does not exist). Featured, categories, category pages and search are all computed in
`CatalogService` from the one cached list, so none of them costs an extra upstream request and the
fresh/stale logic has two cache keys to reason about (`products:all`, `product:<id>`).

- Alternative: mirror the upstream endpoints (`byCategory`, `categories`). Rejected: it couples our
  port to Fake Store's API, adds upstream calls, and the upstream's category endpoint returns `[]`
  for typos, which would hide a validation problem.
- Trade-off: the whole catalogue is loaded to serve one page. Right for 20 products. A real source
  with a large catalogue would implement richer port methods (search, category filter) and the
  service would delegate; the port is the place that change lands.

### 2. `packages/contracts` is the single definition of the public shapes

Zod schemas for `Product`, `Category`, the five response bodies, and request params/query live
there, with inferred types. The API uses them to validate requests and type responses; the web app
will import the same module. `domain/` re-uses the inferred `Product` and `Category` types instead
of redeclaring them.

- Alternative: a separate domain model plus mappers to the contract. Rejected for now: the two
  would be identical, and keeping them in sync is exactly the duplication `design-principles.md`
  forbids. If the internal model ever diverges, the mapper is added at `http/`, and compile errors
  show where.
- Consumption: the package's `exports` declare a `types` condition pointing at `src/index.ts` and a
  `default` pointing at `dist/index.js`. `tsc` and the IDE read the source; Vitest aliases the
  package to the source; the production build compiles the package first (root `build` script runs
  `-w @catalogue/contracts` before the rest) and Node loads `dist`.
- Risk: three resolution paths (types, tests, runtime) can drift. Mitigation: a test imports the
  package through the same specifier the app uses, and `npm run build` is part of verification.

### 3. Fake Store adapter: anti-corruption, validation, resilience

`FakeStoreProductSource` is the only code that knows the upstream:

- **Mapping**: a private upstream zod schema (unknown keys stripped, `rating` required, finite
  non-negative price, `image` must parse as an absolute http(s) URL). `rate`/`count` map to
  `rating.average`/`rating.count`; `category` maps to `{ slug, name }` through one `slugify`
  function in `domain/` (lowercase, apostrophes removed, other non-alphanumerics to hyphens;
  `men's clothing` -> `mens-clothing`). The upstream's `jewelery` spelling is kept.
- **Not found**: `findProduct` returns `undefined` for an empty 200 body or a 404. An empty body on
  `listProducts` is a wrong shape (`UpstreamError`), because there is no valid empty list from a
  catalogue endpoint.
- **Request**: GET only, URL built with `new URL` from the configured base URL and a validated
  integer id (path segment encoded), `redirect: 'manual'` so a redirect to an internal host cannot
  be followed (3xx is a non-retryable `UpstreamError`), `accept: application/json`, body size cap
  (1 MiB) before parsing.
- **Timeout and budget**: each attempt uses `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` (default
  4 s). A per-call deadline (`UPSTREAM_DEADLINE_MS`, default 10 s) bounds all attempts and backoff
  together: each attempt's timeout is `min(timeout, remaining budget)`, and no retry starts once the
  budget is spent. Without the deadline, 3 attempts of 4 s plus backoff would exceed any sensible
  client timeout.
- **Retry**: only idempotent GETs, on network error, timeout, 5xx and 429, at most
  `UPSTREAM_MAX_RETRIES` (default 2) retries. Delay is full jitter over an exponential cap
  (`random() * min(1500 ms, 200 ms * 2^(attempt-1))`); a `Retry-After` header is honoured but
  capped at the same maximum. Other 4xx, 3xx and schema failures are not retried.
- **Failure mapping**: retries exhausted after a timeout -> `UpstreamTimeoutError` (504); any other
  exhaustion, non-retryable status or wrong shape -> `UpstreamError` (502). The original error is
  the `cause`.
- **Logging**: `debug` per attempt with `target` (host only), `durationMs`, `status`, `attempt`;
  `warn` per retry with the reason and delay. The adapter does not log the final failure; the error
  handler does (log once).
- `fetch`, `sleep` and `random` are constructor options so tests are deterministic and fast.

### 4. Cache: port, two adapters, one decorator

- **Port** `Cache`: `get(key): Promise<unknown | undefined>` and `set(key, value, ttlSeconds)`.
  Values must be JSON-serialisable. The port has no `close`; adapters that hold a resource expose
  it and the composition root registers it as a shutdown closer.
- **`MemoryCache`** (default): a `Map` with expiry from an injected clock. It stores a JSON
  round-trip copy so behaviour matches Redis (no shared references, `undefined` dropped) and cached
  objects can never be mutated by a caller. Only found products are cached, so the key count is
  bounded by the catalogue size.
- **`RedisCache`** (ioredis): `lazyConnect`, `connectTimeout` 2 s, `commandTimeout` 1 s,
  `maxRetriesPerRequest` 1, `enableOfflineQueue: false` (commands fail at once while disconnected
  instead of queueing and hanging the request), bounded reconnect backoff, and an `error` event
  listener that logs at `warn` (an unhandled `error` event would crash the process). Keys are
  prefixed `catalogue:v1:`. Low-level errors become `CacheError` with `cause`. The URL (which may
  hold credentials) is never logged; only the host is.
- **Startup**: with `CACHE_DRIVER=redis`, the composition root connects and `PING`s before listening;
  failure is a `ConfigError` naming `REDIS_URL`, so the process exits 1 with a readable message
  (fail fast) instead of silently running without the shared cache.
- **`CachedProductSource`** (decorator over any `ProductSource`): stores `{ storedAt, value }` under
  a TTL of `fresh + stale`. Per call: fresh entry -> return it; otherwise refresh from the inner
  source; on success write and return; on failure, if a stale entry exists return it with a `warn`
  (`ageSeconds`), else rethrow the typed error. Concurrent refreshes for the same key share one
  in-flight promise (single flight), so a cache expiry under load makes one upstream call, not N.
  Cache `get`/`set` errors are caught, logged at `warn`, and treated as a miss / skipped write.
  Defaults: fresh 60 s, stale window 3600 s.
- **Fail-open**: if the cache is down the request goes straight to the upstream (availability over
  cost). This is recorded here as the explicit decision for the cache dependency.
- Alternatives considered: caching inside the Fake Store adapter (mixes concerns and is not
  reusable for a second source); a cache library (extra dependency for ~80 lines).

### 5. `CatalogService`: the ranking and search rules live in one place

- **Order** (`byRating` in `domain/catalog.ts`): `rating.average` desc, `rating.count` desc, `id`
  asc. Every list the API returns uses it, so output is deterministic and ties never flip.
- **Featured**: `FEATURED_COUNT` (5) products by `byRating`. If `FEATURED_PRODUCT_IDS` is set, those
  products in that order instead; ids that do not exist are skipped with a `warn`; if none exist it
  falls back to the rating rule, also with a `warn`.
- **Categories**: unique `{ slug, name }` pairs derived from the product list, sorted by name. The
  name is the upstream value with each word capitalised.
- **Category page**: unknown slug -> `NotFoundError('category', slug)` (derived from the real
  category list, so the upstream's `[]`-for-unknown behaviour is never relied on); `topRated` is the
  first `CATEGORY_TOP_COUNT` (3) by `byRating`, `more` the rest.
- **Search**: the trimmed query, lower-cased, as a substring of lower-cased `title`, `description`
  or category name; results in `byRating` order. No regular expressions are built from user input.
  Validation (blank, length, control characters) happens at the HTTP boundary.
- **Find**: `findProduct` -> `NotFoundError('product', id)` when `undefined`.
- Services receive `ProductSource`, `Logger` and the featured override by constructor, return new
  arrays (never sort in place) and know nothing about HTTP.

### 6. HTTP layer

- Routes are thin: parse -> call service -> return the typed body. `http/validation.ts` has one
  `parseRequest(schema, input)` that turns a zod failure into a `ValidationError` whose `details`
  are `{ field, message }` pairs and never contain the submitted value.
- **Params/query**: `id` is a digit string `^[1-9][0-9]{0,8}$` converted to a number (rejects
  `1e3`, ` 5`, `0`, `-1`, and values beyond safe precision); `slug` is
  `^[a-z0-9]+(-[a-z0-9]+)*$` max 64; `q` is trimmed, 1-100 characters, no control characters;
  query objects are `.strict()` so unknown parameters are a 400, and a repeated `q` is a 400.
- Validation runs before any service, cache or network call. A malformed request never reaches an
  adapter or forms a cache key.
- Bodies: `{ products }`, `{ categories }`, `{ category, topRated, more }`, `{ query, products }`,
  `{ product }`. Wrapper objects leave room to add fields (paging, totals) without breaking clients.
- `buildApp` gains a `catalogService` dependency. No rate limit is added here (see Risks).

### 7. Composition root and configuration

New variables (all through `loadConfig`, all validated): `CATALOG_DRIVER` (`fakestore`),
`FAKESTORE_BASE_URL` (http/https URL, default `https://fakestoreapi.com`, must be https when
`NODE_ENV=production`), `UPSTREAM_TIMEOUT_MS` (4000), `UPSTREAM_DEADLINE_MS` (10000),
`UPSTREAM_MAX_RETRIES` (2, max 5), `CACHE_DRIVER` (`memory`|`redis`, default `memory`), `REDIS_URL`
(required when `redis`, scheme `redis:` or `rediss:`), `CACHE_FRESH_TTL_SECONDS` (60),
`CACHE_STALE_TTL_SECONDS` (3600), `FEATURED_PRODUCT_IDS` (comma-separated positive integers, at
most 10). Secrets-bearing `REDIS_URL` is not in the startup summary; the allowlist gains only
non-secret fields (`catalogDriver`, `cacheDriver`, `upstreamHost`).

`bootstrap.ts` stops building the services itself: it takes a `compose(config, logger)` function
(defined in `main.ts`) that returns the app dependencies plus a list of named closers. `main.ts`
selects the source and cache with a plain `switch` on the driver and is the only place adapters are
constructed. `bootstrap` registers the closers with the shutdown so Redis is closed after the HTTP
server (the server stops first so no request is mid-flight against a closed cache).

### 8. Failure policy per external dependency

| Dependency | Timeout | Retry | On failure | Logging |
| --- | --- | --- | --- | --- |
| Fake Store (GET) | 4 s per attempt, 10 s total | 2 retries on network/5xx/429, jittered backoff | typed `UpstreamError`/`UpstreamTimeoutError`; stale cache served if present | debug per attempt, warn per retry, error by the central handler |
| Redis | 2 s connect, 1 s per command | reconnect with bounded backoff; no per-command retry | `CacheError` caught by the decorator: treated as a miss (fail open) | warn on error events and degraded reads/writes |
| Redis at startup | 2 s connect + ping | none | `ConfigError` naming `REDIS_URL`, exit 1 (fail fast) | fatal |

### 9. Test strategy

- Real upstream data is saved once as `test/fixtures/fakestore-products.json` (the 20 products) and
  used by the mapper, service and endpoint tests, so ranking assertions are made on real ties.
- Service tests are written first (RED then GREEN) against a fake `ProductSource`.
- The adapter is tested with a stub `fetch` for each path: success, empty body, 404, 5xx then
  success, retries exhausted, timeout, 429 with `Retry-After`, non-retryable 4xx, 3xx, wrong shape,
  oversized body, invalid JSON, deadline exhaustion; with fake `sleep`/`random`.
- A shared contract suite runs against `MemoryCache` always and `RedisCache` only when `REDIS_URL`
  is set (skipped otherwise, so `npm test` needs nothing running).
- The decorator is tested with a fake inner source, fake cache and fake clock: fresh hit, miss,
  refresh, stale-on-error, stale window expired, cache read/write failure, single flight, not
  found, no caching of absence.

## Risks / Trade-offs

- [Upstream shape drifts or the demo API disappears] -> Payload is validated with a schema, a wrong
  shape is a 502 with a log line rather than a crash later; swapping the source is one class.
- [The upstream is down longer than the stale window (1 h)] -> Requests fail with 502/504 and the
  web app shows a reference id; acceptable for a demo upstream. The window is configurable.
- [Public read endpoints are not rate limited in this change, so repeated lookups of non-existent
  ids reach the upstream every time] -> Ids are bounded to 9 digits, the call has a deadline and a
  retry cap, and rate limiting lands with `product-enquiry` together with the `trustProxy`
  decision, where it can be tested properly. Tracked here so it is not forgotten.
- [Per-process memory cache means instances can briefly disagree] -> Acceptable; `CACHE_DRIVER=redis`
  shares one cache across instances.
- [Redis outage makes every instance call the upstream directly] -> Single flight limits it to one
  call per key per instance per refresh window; fail-open is the recorded decision.
- [Three ways to resolve `@catalogue/contracts` (types, tests, runtime)] -> See decision 2.
- [`slugify` collisions between two upstream categories] -> Not possible with the current four; if
  it happens the service logs a `warn` and keeps the first, rather than failing the page.
- [Cached objects mutated by callers] -> JSON round-trip copies from both cache adapters, readonly
  types, and non-mutating array helpers.

## Open Questions

- Whether the product currency should be shown: the upstream gives none. Left to the web app.
- Whether `FEATURED_PRODUCT_IDS` should accept slugs as well as ids. Not needed for the challenge.
