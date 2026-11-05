# Review gate: catalogue-api

Both reviews ran against the committed change, code-reviewer first, security-reviewer second.
Before each review: typecheck, lint, tests and `npm run build` green on Node 22. The service had
been run end to end against a local stand-in for the upstream (Node on the build machine cannot
reach the real Fake Store; `curl` can).

## 1. code-reviewer: verdict APPROVE (0 CRITICAL, 0 HIGH, 3 MEDIUM, 6 LOW)

| Severity | Finding | Disposition |
| --- | --- | --- |
| MEDIUM | Stale-if-error made every request wait out the full upstream deadline (about 10 s) before the stale copy was served; single flight only collapses concurrent callers. | Fixed: a 15 s per-key retry cooldown after a failed refresh serves the stale entry at once. Tests for cooldown, boundary, per-key, restart and the configured value. Cold-cache requests still pay for an attempt; recorded in DECISIONS.md (circuit breaker is a next step). |
| MEDIUM | `main.ts` wiring untested (driver choice, Redis fail-fast mapping, config reaching adapters, closer registration). | Fixed: wiring moved to an importable `src/compose.ts` (`main.ts` is a thin entry) with 15 tests using a fake Redis and a stub `fetch`; mutation-checked. Wording deviation from "only in main.ts" recorded in DECISIONS.md. |
| MEDIUM | Redis reconnect strategy: post-`ready` branch untested. | Fixed: `reconnectDelayMs` extracted as a pure function and table-tested. |
| LOW | A synchronous throw from the wrapped source could poison a key permanently. | Fixed (refresh starts from a resolved promise); test fails against the old implementation. |
| LOW | Backoff sleep could overrun `UPSTREAM_DEADLINE_MS` by up to 1.5 s. | Fixed: a delay that does not fit in the time left is not slept; 3 tests including the boundary. |
| LOW | Duplicate `FEATURED_PRODUCT_IDS` returned the product twice. | Fixed: de-duplicated in config, first occurrence kept. |
| LOW | Cached values trusted without validation. | Fixed: entries are validated against the contract schemas; invalid entries are a miss with a warning, also as a stale fallback. |
| LOW | One unmappable upstream product fails the whole list. | Accepted and recorded in DECISIONS.md (follows "wrong shape is an UpstreamError"). |
| LOW | Design text and tests drifted from the contracts consumption (`exports` -> dist, `paths` -> source). | Fixed: design.md decision 2 rewritten; `npm run smoke:build` builds and imports the built package. |

Checked and found clean by the reviewer: retry and timeout arithmetic, response and status handling,
that the body cap really bounds memory, time arithmetic and aliasing in the decorator, Redis event
handling and credential scrubbing, shutdown order, config rules, route validation, layering.

## 2. security-reviewer: verdict APPROVE (0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW)

Probed with the running service and hostile local servers: encoded slashes, `%00`, double encoding,
unicode digits, `__proto__` and array-style query keys (all 400 or 404 in the envelope, no value
echoed); a 302 (not followed), an infinite chunked body and a 300 MiB gzip bomb (both stopped by the
1 MiB cap with a few MB of memory), a slow-drip body (ended by the 10 s deadline); Redis passwords
across four failure modes (0 occurrences in any log); lockfile (npmjs only, ioredis 6.0.0 integrity
matches, no install scripts); no work-related names, hosts or paths.

| # | LOW finding | Disposition |
| - | --- | --- |
| L1 | A cached `product:7` holding a valid product with another id would be served. | Fixed: the cache validator is key-aware; 2 tests (miss, and not served as stale). |
| L2 | "Upstream text is untrusted, render as text" not written down; `imageUrl` unbounded. | Fixed: DECISIONS.md section; `imageUrl` capped at 2048 characters (contracts test). |
| L3 | DECISIONS.md implied the 9-digit id bound limits upstream load. | Fixed: wording corrected (the bound is for numeric precision; rate limiting must also cover `/products/:id`). |
| L4 | Pre-existing: `process.env` is passed from `main.ts`; header-size errors (431) bypass the envelope. | Accepted (both recorded earlier). |

## 3. Dependency advisories

`npm audit` itself cannot reach its endpoint from the build machine (Node TLS reset; `curl` works), so
the lockfile's 271 package/version pairs were POSTed to the registry's bulk advisories endpoint.
Result unchanged from `api-foundations`: one moderate, dev-only (`minimatch` via `typescript-eslint`);
nothing for `ioredis` or its dependencies. The reviewer re-ran the same query independently.
