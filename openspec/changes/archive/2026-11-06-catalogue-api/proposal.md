## Why

The storefront needs product data: featured products for the home page, category pages, search and
a product page. Today the API only has health and error plumbing. The product data comes from a
third-party demo API (Fake Store) that will be replaced, is slow and unreliable enough to need
protection, and has quirks the web app must never see. This change adds the catalogue behind our
own contract so the data source, cache and presentation can each change independently.

## What Changes

- Add `packages/contracts`: zod schemas and types for our `/api/v1` catalogue contract (product,
  category, response bodies, request params and query), used by the API now and the web app later.
- Add the `ProductSource` and `Cache` ports in `domain/`, with `Product` and `Category` as our model.
- Add `FakeStoreProductSource` in `infrastructure/`: maps the upstream shape to our model, validates
  upstream payloads, times out, retries idempotent GETs with backoff and jitter, and turns every
  failure into a typed error. The upstream shape never leaves this class.
- Add `MemoryCache` (default) and `RedisCache` (optional, ElastiCache-compatible) adapters, plus a
  `CachedProductSource` decorator with a fresh window, a longer stale window, serve-stale-on-error,
  de-duplication of concurrent refreshes, and cache failures treated as misses.
- Add `CatalogService` in `application/`: featured, categories, category page (top 3 plus the rest),
  search and product lookup, with the ranking rules in one place.
- Add the endpoints `GET /api/v1/featured`, `/categories`, `/categories/:slug`, `/products?q=` and
  `/products/:id`, validated at the boundary with the shared schemas.
- Extend configuration with the catalogue, upstream and cache settings; fail fast when Redis is
  selected but unreachable; close the Redis connection on shutdown.
- Add a `CacheError` to the error hierarchy for typed cache adapter failures.

No breaking changes: `/healthz` and the error envelope are untouched.

## Capabilities

### New Capabilities

- `catalogue-contracts`: the shared zod schemas and types that define the public catalogue contract.
- `product-source`: the `ProductSource` port and the Fake Store adapter (mapping, payload validation,
  timeout, retry, not-found handling).
- `product-cache`: the `Cache` port, memory and Redis adapters, and the caching decorator
  (fresh and stale windows, stale-if-error, single flight, degradation).
- `catalogue-service`: the catalogue use cases and their ranking and search rules.
- `catalogue-endpoints`: the HTTP routes, request validation and response shapes.

### Modified Capabilities

- `api-config`: new settings for the catalogue driver, upstream base URL, timeout and retries, cache
  driver and TTLs, Redis URL, and the optional featured override.
- `api-lifecycle`: startup verifies Redis when it is enabled, and shutdown closes the cache
  connection.

## Impact

- **New code**: `packages/contracts/`; in `apps/api/src`: `domain/` (`catalog.ts`, ports),
  `application/catalog-service.ts`, `infrastructure/catalog/`, `infrastructure/cache/`,
  `http/catalogue-routes.ts`, `http/validation.ts`; wiring in `main.ts` and `bootstrap.ts`.
- **Dependencies**: `ioredis` (api). The api gains a workspace dependency on `@catalogue/contracts`.
  `npm install` is required, and the lockfile changes.
- **Existing files touched**: `apps/api` config, `app.ts` (route registration, new dependency),
  `.env.example`, root `package.json` build script (build contracts before the api).
- **Public surface**: the five `/api/v1` read endpoints and their schemas.
- **Upstream**: one outbound GET per refresh to the Fake Store API (about one per minute per
  instance, plus one per distinct product id lookup).

## Assumptions

- "Top rated" means the highest `rating.rate`, ties broken by higher `rating.count`, then lower id,
  so the order is deterministic. This is a stand-in for the product team's real rule.
- The featured list is the top 5 by that rule. An optional `FEATURED_PRODUCT_IDS` setting overrides
  it, as a stand-in for future curation; unknown ids are skipped with a warning.
- A category page shows the top 3 products of the category by rating, then the rest.
- Search is a case-insensitive substring match over title, description and category name, done in
  the API because Fake Store has no search endpoint. A blank query is a 400, not "everything".
- Category slugs are derived from the upstream category names (lowercase, apostrophes removed,
  other characters to hyphens). The upstream spelling `jewelery` is kept rather than hand-corrected,
  because categories are data, not code.
- The upstream gives no currency, so `price` is a plain number and currency formatting is the
  client's concern.
- No pagination: the catalogue is 20 products. This is a recorded cut.
- The product list and categories are derived from one upstream list call, so a category or a search
  never costs an extra upstream request.

## Out of Scope

- The enquiry endpoint, SMTP, rate limiting and `trustProxy`: `product-enquiry`.
- The React app and the web-side `ApiError`: `web-storefront`.
- `compose.yaml` and the `redis` compose profile: `web-storefront`, which owns the container setup.
  Until then Redis is exercised through an environment variable pointing at a locally started Redis.
- Negative caching of unknown product ids: a lookup of an id that does not exist always reaches the
  upstream. Accepted for a catalogue of this size; a bounded negative cache is a next step.
- Cache invalidation hooks, ETags and HTTP caching headers: not needed while the data is read-only
  and refreshed on a short timer.
- Any write path to the catalogue.
