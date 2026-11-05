# Decisions

Short records of choices that are not obvious from the code. Per-change design decisions live in
`openspec/changes/*/design.md` (and `openspec/changes/archive/`); this file holds the cross-cutting
ones.

## Dependency audit (2026-11-05)

- `npm audit` cannot reach its endpoint from the development machine (Node's TLS connection to
  `/-/npm/v1/security/audits/quick` is reset, although `curl` works). The same advisory data was
  queried directly: the lockfile's 266 package/version pairs were POSTed to
  `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`.
- Result at `api-foundations`: no high or critical advisories. One **moderate** advisory,
  `minimatch` 10.2.6 (GHSA-g3hv-75wg-m249, denial of service through glob amplification), reached
  only through `typescript-eslint` (a dev dependency). It is not part of the runtime image and
  needs untrusted glob patterns to be exploitable, which the lint toolchain never receives.
  Accepted; picked up by the next `typescript-eslint` update.
- Re-run `npm audit --audit-level=high` from a network where it works before hand-off, and repeat
  this check after each change that adds dependencies.

## Catalogue (catalogue-api)

### Upstream quirks the adapter absorbs

- The Fake Store answers **HTTP 200 with an empty body** for a product id it does not have (and for
  a non-numeric id), and 200 with `[]` for an unknown category. The adapter treats the empty body as
  "no such product" (`undefined`) and the service raises our 404. Category existence is therefore
  decided from our own category list, never from the upstream's reply.
- The upstream spells a category `jewelery`. Slugs and names are derived from the data
  (`categoryFromName`), so the spelling is kept rather than patched in code.
- The upstream gives no currency, so `price` is a plain number and formatting is the client's job.

### Ranking and featured

- "Top rated" is `rating.average` descending, then `rating.count` descending, then `id` ascending.
  The id tie-break makes every list deterministic; the real data has two products at 4.8 and two at
  4.7. This is a stand-in for whatever rule the product team really wants, kept in one function.
- Featured is the top 5. `FEATURED_PRODUCT_IDS` overrides it (a stand-in for curation); unknown ids
  are skipped with a warning and an override with no valid id falls back to the ranking.
- A category page shows the top 3 by the same rule, then the rest. Search is a case-insensitive
  substring match over title, description and category name, because the upstream has no search.

### Caching and failure policy

- **Fail-open cache**: if the cache (memory or Redis) fails, the request goes to the upstream.
  Availability over cost. Cache read and write errors are logged at `warn` and never fail a request.
- **Stale-if-error**: entries are fresh for 60 s and usable as stale for another hour. When the
  upstream fails and a stale entry exists, it is served with a `warn`; with nothing cached the typed
  `UpstreamError` / `UpstreamTimeoutError` (502/504) reaches the client with its request id.
- **Total upstream deadline** (10 s default): three attempts of 4 s plus backoff would otherwise run
  past any sensible client timeout. Each attempt's timeout shrinks to the remaining budget.
- **Absence is not cached**: a lookup of a product that does not exist always reaches the upstream.
  Cached products are bounded by the catalogue size; unknown ids are not cached, which is why ids are
  bounded to 9 digits and why rate limiting (below) matters.
- One list call feeds featured, categories, category pages and search, so those never cost an extra
  upstream request.

### Known gaps, tracked

- **Public read endpoints are not rate limited yet.** Repeated lookups of non-existent ids reach the
  upstream every time. Rate limiting and the `trustProxy` decision land together in `product-enquiry`.
- `packages/contracts` is consumed from source by typecheck, tests and `tsx` (via `paths` and a Vitest
  alias) and from `dist` at build and runtime (via `exports`); the root `build` script builds it first.
  Three resolution paths can drift, so `npm run build` stays part of verification.
- The error envelope still lives in the API; it moves into `packages/contracts` with the web client in
  `web-storefront`.
