# Security (Node.js / TypeScript / React)

## Pre-commit checklist

Before ANY commit:

- [ ] No hardcoded secrets (API keys, passwords, tokens, SMTP credentials)
- [ ] Every request input is validated at the boundary (see "Input validation")
- [ ] Error responses do not leak stack traces, internal paths or upstream messages
- [ ] No PII (email, phone, message body, name) in logs
- [ ] New public endpoints have a rate limit and a body size limit
- [ ] `npm audit --audit-level=high` is clean (or the exception is recorded in DECISIONS.md)

If a security issue is found: STOP, run the **security-reviewer** agent, fix CRITICAL issues first.

## Security claims must be verified in code

A comment, README line or DECISIONS entry that says "protected by X" is not protection. Before
merging anything that claims a mechanism, grep for the real configuration:

```bash
grep -rn "rateLimit\|helmet\|bodyLimit" apps/api/src   # must show actual registration, not comments
```

## Secrets

- Configuration comes from environment variables only, parsed once by a zod schema at startup
  (`config/`). Missing or malformed values stop the process with a `ConfigError` (fail fast).
- Only `.env.example` is committed, with placeholder values. `.env*` is gitignored.
- Never log secrets or full connection strings. Log the host, not the URL with credentials.

## Input validation

Validate on four dimensions BEFORE the value reaches a service, adapter or cache key:

| Check    | Question                       | Example failure if skipped                        |
| -------- | ------------------------------ | ------------------------------------------------- |
| Type     | Right data type?               | `id=abc` reaches the upstream URL                 |
| Range    | Fits the target type / bounds? | `id=99999999999999999999` loses precision         |
| Domain   | A permitted value?             | unknown category slug used as a cache key         |
| Presence | What if absent?                | blank `q` silently returns the whole catalogue    |

- Define schemas once in `packages/contracts` (zod) and reuse them on server and client.
- Every string has a `max` length. Reject unknown properties (`.strict()`).
- Trim before use. Reject control characters in single-line fields (name, subject-like text).
- An invalid request must never reach an adapter, the cache or the network.

## Output and errors

- Responses use the shared error envelope. Never return `error.message` of an unknown error.
- Log the detail server-side with the request id; return a generic message to the client.
- Product text from the upstream catalogue is untrusted. In React render it as text; never use
  `dangerouslySetInnerHTML`.

## Rate limiting and abuse

- `POST /enquiries` is rate limited per client IP and has a small `bodyLimit`.
- Behind a proxy/load balancer configure `trustProxy` deliberately; otherwise every client shares
  one IP. Verify it in a test, do not assume.
- If the limiter store (Redis) fails, the decision (fail open or closed) is explicit and recorded.

## Email

- Header injection: strip CR/LF from every value that can reach a header (subject, display name).
- The visitor's address goes only into a validated `Reply-To`; `From` is always the configured sender.
- Never build the recipient from request data. The sales inbox comes from config.

## Outbound requests (SSRF)

- Upstream base URLs come from config, never from request data.
- Every outbound call has a timeout (`AbortSignal.timeout`). Validate the response shape with zod.
- Path segments built from request data (product id) are validated first and URL-encoded.

## HTTP hardening

- Register `@fastify/helmet` (security headers) and verify with a test.
- CORS stays closed: the web app is served same-origin through the proxy. If CORS is ever
  needed, use an explicit allow-list, never `*` with credentials.
- No cookies or sessions in this app, so no CSRF surface. If auth is added later, revisit this
  section before merging it.

## Dependencies

- Commit the lockfile. Prefer few, well-maintained dependencies.
- Run `npm audit --audit-level=high` in CI and before release.
