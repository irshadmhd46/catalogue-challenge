## 1. Workspace, dependencies and fixture

- [x] 1.1 Scaffold `packages/contracts` (`package.json` name `@catalogue/contracts`, `type: module`, `exports` with a `types` condition to `src/index.ts` and `default` to `dist/index.js`, `tsconfig.json`, `tsconfig.build.json`, `build`/`typecheck`/`test` scripts); make the root `build` script build contracts before the other workspaces
- [x] 1.2 Add `@catalogue/contracts` (workspace) and `ioredis` to `apps/api/package.json`; add a Vitest alias from `@catalogue/contracts` to the package source in `apps/api/vitest.config.ts`
- [ ] 1.3 **Owner action**: run `npm install` on a network where it works so the workspace link and `ioredis` are installed and the lockfile updates (the build machine's Node cannot reach the registry); then verify `ls node_modules/@catalogue` shows `api` and `contracts`
- [x] 1.4 Save the 20 live Fake Store products as `apps/api/test/fixtures/fakestore-products.json` plus a small loader in `test/support/`; confirm ids 1 to 20 and four categories
- [ ] 1.5 Verify `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass with the empty contracts package

## 2. Contracts package

- [x] 2.1 Implement `packages/contracts/src`: `productSchema`, `categorySchema` (both `.strict()`), the five response schemas, `productIdParamSchema`, `categorySlugParamSchema`, `searchQuerySchema` (strict), inferred types, one `index.ts`
- [x] 2.2 Test the product and category schemas: valid parse, rating over 5, negative price, id 0, non-URL image, extra `image` property rejected
- [x] 2.3 Test response schemas: each of the five bodies parses; a bare array fails the featured response
- [x] 2.4 Test request schemas as tables: valid id/slug/query, every invalid id, slug and query from the spec, unknown query parameter rejected, repeated `q` rejected, and issue messages never contain the submitted value

## 3. Domain: catalogue rules, ports and CacheError

- [x] 3.1 Write `test/domain/catalog.test.ts` (RED): `slugify` table (`men's clothing`, `women's clothing`, `jewelery`, `Home & Garden`, leading/trailing/repeated separators), category display name capitalisation, `byRating` on real ties (12, 11, 3, 18), equal rating and count falls back to id, input array not mutated
- [x] 3.2 Implement `src/domain/catalog.ts` (GREEN): `FEATURED_COUNT`, `CATEGORY_TOP_COUNT`, `slugify`, `categoryOf`, `byRating`; re-export `Product` and `Category` types from the contracts package
- [x] 3.3 Add the `ProductSource` and `Cache` ports in `src/domain/ports` files (one interface per file or one `ports.ts`), with doc comments stating the failure contract
- [x] 3.4 Add `CacheError` to `src/domain/errors.ts` (code `INTERNAL_ERROR`, status 500, generic public message) and extend `errors.test.ts`: code/status, cause preserved, public message hides the cause

## 4. CatalogService (service layer: tests first)

- [x] 4.1 Add test support: `FakeProductSource` (records calls, can be told to reject, returns fixture copies) and use `FakeLogger`
- [x] 4.2 Write `test/application/catalog-service.test.ts` (RED) for ranking: first four ids on the fixture, input not mutated and not returned
- [x] 4.3 RED for `featured()`: default exactly 5 with ids 12, 11, 3, 18, 5; override order kept; unknown override ids skipped with one `warn` naming them; override entirely unknown falls back with `warn`; source failure propagates the same error instance
- [x] 4.4 RED for `categories()`: four slugs in order; slug collision keeps the first and warns once
- [x] 4.5 RED for `categoryPage()`: electronics gives 3 and 3 with no overlap and correct rank order; 2-product category gives 2 and 0; unknown slug throws `NotFoundError` (resource `category`) after exactly one `listProducts` call and no `findProduct`
- [x] 4.6 RED for `search()`: title, description and category-name matches, case-insensitive, ranking order, no match gives `[]`, `.*` and `(` are literal
- [x] 4.7 RED for `find()`: found calls `findProduct` once with the id; `undefined` throws `NotFoundError` (resource `product`); source failure propagates
- [x] 4.8 Implement `src/application/catalog-service.ts` (GREEN) taking `ProductSource`, `Logger` and `featuredProductIds` by constructor; no HTTP, no framework imports, no sorting in place
- [x] 4.9 REFACTOR and run the mutation check on each test (delete the production line, does the test fail?); confirm every stub in the fake source is used

## 5. Configuration

- [x] 5.1 Extend `src/config/index.ts` with the ten new variables, the cross-field rules (`REDIS_URL` required for redis and `redis:`/`rediss:` only, https in production, deadline not below the attempt timeout), `featuredProductIds` parsing, and the allowlisted summary additions (`catalogDriver`, `cacheDriver`, `upstreamHost`)
- [x] 5.2 Test configuration: defaults, redis without URL, wrong scheme, memory driver ignoring a URL, http base URL in production vs development, malformed and non-http base URL, featured override valid and every rejected form, bounds on retries and timeouts, deadline below timeout, credentials never echoed, summary fields and absence of the Redis URL
- [x] 5.3 Update `.env.example` with placeholders for every new variable (no credentials)

## 6. Fake Store product source

- [x] 6.1 Implement the upstream schema and mapper in `src/infrastructure/catalog/fakestore-mapper.ts` (upstream types stay private to this folder)
- [x] 6.2 Test the mapper: product 1 mapped field by field with no `image`/`rate` left, slug derivation table, all 20 fixture products satisfy the contract schema, missing `rating`, non-finite price, non-URL image, extra upstream fields stripped
- [x] 6.3 Implement `src/infrastructure/catalog/fakestore-product-source.ts`: GET only, URL from base URL and validated id, `redirect: 'manual'`, per-attempt `AbortSignal.timeout`, total deadline, retry on network/timeout/5xx/429 with jittered backoff and capped `Retry-After`, 1 MiB body cap, empty-200 and 404 as not found for `findProduct`, typed error mapping with `cause`, debug/warn logging with host only
- [x] 6.4 Test success paths: list returns mapped products, find returns one, URL and method and `accept` header and `redirect: 'manual'` and abort signal asserted on the fetch call
- [x] 6.5 Test not-found: empty 200 body and 404 give `undefined` with a single fetch call; empty list body is an `UpstreamError`
- [x] 6.6 Test retries with fake `sleep` and `random`: 503 then 200 (2 fetches, 1 sleep), retries exhausted (exactly 3 fetches, `UpstreamError`), backoff values 100 and 200 at random 0.5, cap at 1500, `Retry-After: 1` gives 1000 and `Retry-After: 120` gives 1500, network `TypeError` retried
- [x] 6.7 Test non-retryable and invalid payload paths: 400, 401, 403, 302 give one fetch and `UpstreamError`; invalid JSON, wrong top-level type, product missing a field, oversized body, each give `UpstreamError` with one fetch
- [x] 6.8 Test timeout and deadline: attempt timeouts give `UpstreamTimeoutError`; a deadline shorter than three attempts stops starting new ones; timeout then success retries and succeeds
- [x] 6.9 Test logging: first-attempt success writes one `debug` with `target` host, `status`, `attempt`, numeric `durationMs`; a retry writes one `warn` with `attempt`, `reason`, `delayMs`; exhaustion writes no `error`; no log line contains the full URL

## 7. Cache adapters

- [x] 7.1 Implement `src/infrastructure/cache/memory-cache.ts` with an injected clock and JSON round-trip copies
- [x] 7.2 Write the shared contract suite `test/infrastructure/cache-contract.ts` (miss, round trip, overwrite, expiry, isolation from mutation, independent keys) and run it against `MemoryCache`; add the clock-based expiry test (present at 9 s, absent at 11 s for a 10 s TTL)
- [ ] 7.3 Implement `src/infrastructure/cache/redis-cache.ts` over ioredis: key prefix `catalogue:v1:`, `lazyConnect`, `connectTimeout`, `commandTimeout`, `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, bounded reconnect backoff, `error` event listener logging `warn`, JSON values, `CacheError` with `cause`, `connect()`/`ping()`/`close()` helpers, host-only logging
- [ ] 7.4 Test `RedisCache` against a fake client: command failure becomes `CacheError` with the original `cause`, corrupt stored value becomes `CacheError`, `error` event logs `warn` without throwing, a URL with a password never appears in any log line, keys carry the prefix, `set` passes the TTL in seconds
- [ ] 7.5 Run the contract suite against `RedisCache` only when `REDIS_URL` is set (`describe.skipIf`); confirm `npm test` without it reports the Redis run as skipped
- [ ] 7.6 **Owner action (optional but recommended)**: start Redis with `podman run --rm -p 6379:6379 docker.io/library/redis:7-alpine`, run `REDIS_URL=redis://127.0.0.1:6379 npm test -w @catalogue/api`, and confirm the Redis contract run passes

## 8. Caching decorator

- [x] 8.1 Implement `src/infrastructure/cache/cached-product-source.ts`: `{ storedAt, value }` entries with TTL fresh plus stale, fresh hit, refresh, stale-if-error with `warn` and `ageSeconds`, single flight per key cleared after settle, cache read/write errors as miss and skipped write, absence not cached, injected clock
- [x] 8.2 Test the decorator with a fake source, fake cache and fake clock: miss then fill under `products:all`; fresh hit calls the source once; `product:7`/`product:8` keys; absence not cached and source called twice; refresh after 61 s
- [x] 8.3 Test the failure paths: stale served on `UpstreamError` with exactly one `warn` carrying `ageSeconds` 300 and the key; stale window expired rethrows the same error; empty cache rethrows the same `UpstreamTimeoutError` instance; stale entry plus `undefined` from the source returns `undefined`
- [x] 8.4 Test concurrency and degradation: five concurrent calls make one source call; in-flight entry cleared after a failure; `get` rejecting still returns the source value with one `warn`; `set` rejecting still returns the value with one `warn`; both failing still returns the source value
- [x] 8.5 Test that mutating a returned list does not change the next result

## 9. HTTP routes

- [x] 9.1 Implement `src/http/validation.ts`: `parseRequest(schema, input)` throwing `ValidationError` with `{ field, message }` details and never the submitted value
- [x] 9.2 Implement `src/http/catalogue-routes.ts` for the five endpoints under `/api/v1`; thin handlers that validate, call `CatalogService` and return the contract body; extend `AppDependencies`/`buildApp` with `catalogService`
- [x] 9.3 Test validation helper: field names from nested and root issues, no value echo, strict unknown keys
- [x] 9.4 Test endpoints against the real service over a fake source (fixture): featured exactly 5 with ids 12, 11, 3, 18, 5; no `image`/`rate` in any body; categories; category page 3 and 3; unknown category 404 `Category not found`; malformed slug 400 naming `slug`
- [x] 9.5 Test search endpoint: hit, no match gives `[]`, trimmed query echoed, missing/blank/101 characters/control character/repeated `q`/unknown parameter each 400 with the source never called
- [x] 9.6 Test product endpoint: found, unknown 404 `Product not found`, each invalid id (`abc`, `0`, `-1`, `1e3`, `007`, 20 digits) 400 with the source never called
- [x] 9.7 Test failure mapping: `UpstreamError` gives 502 with `requestId`, no upstream hostname in the body, exactly one `error` line; `UpstreamTimeoutError` gives 504; POST to a catalogue route and `/api/v2/featured` give the 404 envelope
- [x] 9.8 Whole-stack tests with the real adapters (stubbed fetch, `FakeStoreProductSource`, `CachedProductSource`, `MemoryCache`, fake clock): featured plus categories plus category page make exactly one upstream list call; after the fresh TTL with the upstream answering 500 the featured endpoint still returns 200 with the earlier data and one `warn`

## 10. Composition root and lifecycle

- [x] 10.1 Refactor `bootstrap.ts` to take `compose(config, logger)` returning the app dependencies plus named closers; register the closers with the shutdown after the server; update the existing bootstrap tests
- [ ] 10.2 Implement the wiring in `main.ts`: select source and cache with a `switch` on the config drivers, build `fetch`-backed `FakeStoreProductSource` -> `CachedProductSource`, create `CatalogService`; for `redis` connect and `PING` first and throw a `ConfigError` naming `REDIS_URL` on failure; register the Redis `close` as a closer
- [ ] 10.3 Test bootstrap: closers registered and run in reverse order after the server on SIGTERM; a `compose` failure with `ConfigError` for `REDIS_URL` logs `fatal` naming it, exits 1 and never listens; a Redis closer failure exits 1; memory driver makes no Redis call
- [x] 10.4 Extend the config summary test and `bootstrap` startup log test for the new allowlisted fields

## 11. Verification against the real upstream

- [ ] 11.1 Build and run the service locally against the live Fake Store; `curl` all five endpoints and confirm shapes, the featured ids, a category page, a search, a product, a 404 category, a 404 product (`/products/9999`, which the upstream answers 200 with an empty body) and a 400 for `/products/abc`
- [ ] 11.2 Stale drill: warm the cache, set the fresh TTL low, break the upstream (`FAKESTORE_BASE_URL` pointing at a closed local port), and confirm 200 with the earlier data and a `warn` line; with a cold cache confirm a 502 with a `requestId` and one `error` line
- [ ] 11.3 Redis drill (owner, with podman): `CACHE_DRIVER=redis REDIS_URL=redis://127.0.0.1:6379`, confirm keys appear under `catalogue:v1:` and that stopping Redis leaves the endpoints answering (warn lines, no crash); starting with Redis stopped exits 1 naming `REDIS_URL`
- [ ] 11.4 Run the claim checks from `security.md`: `grep` that routes call `parseRequest` before the service, that `fetch` and the upstream field names (`image`, `rating.rate`) appear only under `infrastructure/catalog`, that `process.env` is still read only in `config/`, and that no `new` of an adapter exists outside `main.ts`

## 12. Quality gates and review

- [ ] 12.1 Design principles check: SRP, DRY (limits, TTLs, counts and keys defined once), DIP, no presentation leak, immutability of cached values
- [ ] 12.2 Run `npm run typecheck && npm run lint && npm test`, `npm run build`, `npm run test:coverage` (80%+ on `application/`, `domain/`, `infrastructure/`); run the dependency advisory check (`npm audit`, or the direct advisory query recorded in `DECISIONS.md` if the audit endpoint is unreachable)
- [ ] 12.3 Record in `DECISIONS.md`: the Fake Store quirks (200 for missing ids, `jewelery`), top-rated and featured assumptions, fail-open cache, stale window, the unrated public read endpoints until `product-enquiry`, and the contracts resolution strategy
- [ ] 12.4 Review gate: run the `code-reviewer` agent, then the `security-reviewer` agent; fix CRITICAL and HIGH findings, MEDIUM where cheap; save the report to `.claude/reviews/catalogue-api.md`
- [ ] 12.5 Add anything the reviews caught that the building pass got wrong to `AI_USAGE.md`
- [ ] 12.6 Commit in logical units (contracts, domain, service, config, fake store, caches, decorator, routes, composition, docs) using conventional commits; review `git status` and the diff before each; no remote, no push
