# AI usage log

Running list, kept per change. The "where the AI got something wrong" section is the honest part:
each entry says what went wrong and what caught it.

## api-foundations

### Where the AI got something wrong, and how it was caught

1. **Redaction wildcards would have blinded the error logs.** The plan listed `*.message` and
   `*.name` as redacted paths. That also matches `err.message`. Caught while writing `design.md`;
   replaced with explicit paths and a test that the error message stays visible.
2. **`connectionTimeout` would break keep-alive behind a load balancer.** The plan called for it;
   a short value closes idle sockets the load balancer still expects to reuse. Caught while writing
   the design; replaced with `keepAliveTimeout` 65 s.
3. **Runtime version chosen without checking dependency requirements.** The stack said Node 20.
   Current Fastify (via `light-my-request` -> `cookie` 2, which requires Node 22) and Vitest 5 do
   not run on 20.17. Caught only when the first tests ran; moved the repo to Node 22.
4. **Mocked shutdown test passed while real shutdown stalled.** The first lifecycle test only
   awaited a fake `close()`. The code-reviewer flagged that nothing exercised a real socket; the
   loopback test then showed a request in flight at SIGTERM left a keep-alive socket open and
   `close()` hung until the hard timeout. Fixed with `Connection: close` while closing.
5. **Malformed URLs bypassed the error handler** (code-reviewer HIGH). Fastify answered with its
   own body, echoing the path, with no request id or log line. Both mock-based tests and my own
   review of the handler missed it; fixed through `frameworkErrors`.
6. **4xx duck-typing and a leaky `ConfigError` public message** (code-reviewer MEDIUM/LOW). Any
   error carrying `statusCode: 404` was treated as the caller's fault; the config error's public
   message named variables. Both fixed with tests.
7. **A vacuous test assertion.** A generic "no `details` key" check in a table-driven test failed
   for the one case that legitimately has details. Caught on the first green run.

### Process slips

- Reported an install as running when its first command had actually failed silently behind a
  `| tail` pipe; and `npm audit` printed "exit 0" because of the pipe, not the audit. The audit is
  recorded as unverified instead.
- Ran `git checkout -- package-lock.json` once without checking `git status` first. Nothing was
  lost (the edits were from failed installs), but the check should come first.

### What the AI did well enough to keep

- Spec-first planning with scenarios that map one-to-one to tests.
- Table-driven tests for the error hierarchy and the handler.

## catalogue-api

### Where the AI got something wrong, and how it was caught

1. **Assumed a missing product is a 404.** The plan and the first draft of the adapter treated a
   missing id as an HTTP error. Probing the live API while writing the design showed the Fake Store
   answers 200 with an empty body for missing and non-numeric ids (and 200 `[]` for an unknown
   category). Caught before any code: the spec, the adapter and a stand-in test server all encode it.
2. **Wrong expected values written from memory.** The first service test expected the top three
   electronics to be 12, 11, 13. Checking the hand-written expectation against the raw data (before
   implementing) showed 9, not 13, ranks third. The expectations are now derived from the data.
3. **Vacuous tests that mutation checking exposed.**
   - The oversize-body test passed even with the size cap deleted, because the oversized body (an
     array of `1`s) failed schema validation anyway. Rewritten with a valid body padded past 1 MiB.
   - The cache contract suite built keys with `Date.now()`, so a key could change between `set` and
     `get`; for Redis after a real wait the expiry test would have passed by reading a different key.
     Fixed with one fixed prefix per suite.
   - Several boundary and cooldown-per-key tests only passed because other state hid the case.
4. **Shared mutable object returned from the logger's context mixin.** pino merges each log object
   *into* what the mixin returns, so returning the shared request-context object made every line
   inherit fields from earlier lines (`reason`, `delayMs`, `statusCode`). Latent since
   `api-foundations`; none of its tests or two reviews saw it. A live run of the new retry logging
   showed `delayMs` on an unrelated line. Fixed with a copy and a regression test written first.
5. **Stale-if-error was not actually fast.** The design promised "visitors still get pages" but the
   decorator retried the upstream on every request after expiry, so each request waited out the full
   10 s deadline before the stale copy was served. Found by the code review, fixed with a per-key
   retry cooldown.
6. **Untestable composition root.** The wiring was put in `main.ts`, which awaits `bootstrap` at import
   time, so driver choice, the Redis fail-fast mapping and config-to-adapter mapping had no tests.
   Found by the code review; moved to `compose.ts` and tested.
7. **Smaller gaps caught by reviews**: cached values trusted without validation; a cached product not
   checked against its key; a synchronous throw from the source could poison a key permanently; a
   backoff sleep could overrun the deadline; duplicate featured ids; an id regex written twice (caught
   by my own design-principles pass); a misleading sentence in DECISIONS.md.
8. **Environment assumptions.** Assumed `npm install` and Node networking would work from the build
   machine; Node's TLS is reset there while `curl` works. The live check was therefore run against a
   local stand-in serving the recorded payload, the lockfile advisories were queried with `curl`,
   and the real-upstream and real-Redis checks are explicit owner tasks rather than claimed done.

### Process slips

- Committed a change in the same command as a test run without reading the result, so one commit had
  a failing test (the bootstrap summary test); fixed in the next commit, and every later commit is
  chained so it only happens after typecheck, lint and tests pass.
- A test file was first written into a directory that did not exist, so it silently was not created;
  the next command's RED run revealed it.

### What worked

- Probing the real upstream before specifying (found item 1), writing expectations from data, and
  mutation-checking each layer right after writing it: roughly a dozen test gaps were closed this way
  before any reviewer saw the code.
- Running the built service and breaking the dependencies on purpose (stale drill, unreachable Redis)
  found item 4, which unit tests had not.

