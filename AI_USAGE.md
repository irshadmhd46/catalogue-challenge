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
