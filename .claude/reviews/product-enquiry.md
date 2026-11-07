# Review: product-enquiry

Reviewed after the scope cut (Redis removed). Code reviewer and security reviewer both approved with
no CRITICAL or HIGH findings. The security reviewer ran the real service against a fake upstream and a
raw SMTP sink.

## Code review (APPROVE)

| Severity | Finding | Outcome |
| --- | --- | --- |
| MEDIUM | Rate-limit fail-open path and 30 s throttle guard a store that cannot fail (in-memory Map) | Kept as port-contract insurance; the stale port comment was corrected. DECISIONS.md records it. |
| MEDIUM | `TRUST_PROXY_HOPS=0` default would put every visitor in one bucket behind the compose proxy | Open until `compose.yaml`: the api service must set `TRUST_PROXY_HOPS=1`; tracked in `web-storefront` tasks |
| MEDIUM | Read-route rate limiting is beyond the brief | Kept: it bounds the one-upstream-call-per-unknown-id cost (DECISIONS.md) |
| MEDIUM | Error envelope defined twice (API type, contract schema) with no test tying them | Fixed: enquiry route tests parse real 400/404/429/502 bodies with `errorEnvelopeSchema` |
| LOW | Name and message accepted C1 controls, U+2028/2029 | Fixed in `packages/contracts` with tests |
| LOW | Phone message said "digits" but the rule allows `.....` | Fixed: message now says "characters: digits, spaces or + ( ) - ." |
| LOW | Subject truncation could split a surrogate pair | Fixed (`Array.from`) with a test |
| LOW | Two duplicate or over-claiming tests | Removed |
| LOW | Adapter and service both wrap in `NotificationError` | Left; harmless, tested |

## Security review (APPROVE)

| Severity | Finding | Outcome |
| --- | --- | --- |
| LOW L1 | SMTP credentials accepted with `SMTP_TLS=none` outside production | Fixed: config rejects a user/password pair without TLS in every environment, with tests |
| LOW L2 | Rate-limit key is the raw `request.ip`; IPv4-mapped IPv6 forms get separate buckets when hops=1 | Not fixed. Only reachable if the app port is directly exposed while `TRUST_PROXY_HOPS=1`. README states the app port must not be published when hops=1; IPv6 grouping is a recorded next step |

Probed and clean: header injection (CR/LF/NUL/C1 in name, phone, product title), Bcc/Cc smuggling,
SMTP dot-stuffing, recipient and sender always from config, strict body (extra/`__proto__`/array
bodies), email and phone edge cases, ReDoS inputs, body size and content type, spoofed forwarding
headers at hops=0, PII absent from every log line across success and failure paths, STARTTLS before
AUTH, TLS 1.2 minimum, stalled SMTP server ends at the deadline with 502, password never in logs,
lockfile sources.

`npm audit` could not reach its endpoint; the bulk advisories endpoint returned only the known
moderate dev-only `minimatch`. Re-run `npm audit --audit-level=high` on a normal network.

Accepted trade-off: after the SMTP deadline the send is not aborted, so a visitor retry after a 502 can
duplicate an enquiry (recorded in DECISIONS.md).
