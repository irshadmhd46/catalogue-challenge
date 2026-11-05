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
