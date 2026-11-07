# Review: web-storefront

Code reviewer: APPROVE (0 CRITICAL, 0 HIGH, 4 MEDIUM, 8 LOW). Security reviewer: WARNING (0 CRITICAL,
0 HIGH, 4 MEDIUM) until two items were fixed. The security reviewer ran the stack in containers.

## Code review

| Severity | Finding | Outcome |
| --- | --- | --- |
| MEDIUM | Retry wiring untested: deleting `retry: shouldRetry` left every test green | Fixed: tests use the real `createQueryClient()` with fake timers (502 -> 3 attempts; 400/404/429 -> 1) |
| MEDIUM | README claimed stale cache survives an upstream URL change (cache is per process) | Fixed: reworded to the real behaviour |
| MEDIUM | Only a root error boundary; a render bug removed the header too | Fixed: boundary around the routed page, keyed on the path; test checks header stays and navigation recovers |
| MEDIUM | No focus management in the enquiry form | Fixed: focus the first invalid field; focus the confirmation; tests |
| LOW | `/assets/` dropped CSP and other headers | Fixed (shared include in every location) |
| LOW | "Try again" shown for a 400 | Fixed: only for retryable errors; test |
| LOW | `EnquiryForm` not keyed by product | Fixed |
| LOW | Images/base images unpinned, no web healthcheck | Images pinned; healthcheck left (the API has one, compose waits for it) |
| LOW | Client 10 s timeout vs 8 s SMTP deadline can duplicate an enquiry | Recorded in DECISIONS.md |
| LOW | 400 with field details shows no reference id; test does not assert absence of banner | Left: field errors are not send failures |

## Security review

| Severity | Finding | Outcome |
| --- | --- | --- |
| MEDIUM | `/assets/` lost security headers (confirmed with curl) | Fixed; verified on `/`, `/assets/*`, `/products/3` |
| MEDIUM | Mailpit UI on 0.0.0.0 shows every enquiry (PII) | Fixed: both ports bound to 127.0.0.1 |
| MEDIUM | Unpinned images | Fixed: Mailpit v1.33.0, nginx 1.30, Node 22.23 |
| MEDIUM | `NODE_ENV=development` in compose skips production guards | Recorded in compose.yaml and DECISIONS.md: local demo only |
| LOW | `$remote_addr` is the balancer behind an AWS load balancer | Recorded in DECISIONS.md (`real_ip` module) |
| LOW | CSP `data:` in `img-src`, no `object-src` | Fixed |

Verified: no `dangerouslySetInnerHTML`/`innerHTML`/`console` in `src`; `imageUrl` restricted to http(s) by
the contract and used only as `<img src>`; spoofed `X-Forwarded-For`/`X-Real-IP`/`Forwarded` did not move
the rate-limit key (7 attempts: 5 accepted, 2 refused); request ids validated; non-root containers;
`.env*` excluded from the build context; API port not published; advisories (bulk endpoint): only the
known moderate dev-only `minimatch`.
