# Product catalogue proof of concept

## What this is

A catalogue with featured products, category pages, search, a product page and an enquiry form that
emails a sales inbox. Fastify API, React web app, one shared zod contract. `podman compose up --build`
runs the whole thing, with Mailpit as the inbox.

## How it is put together

- The web app only talks to our `/api/v1`. The Fake Store shape stops at one adapter
  (`apps/api/src/infrastructure/catalog`), so the data source can be replaced by writing one class.
- The email provider is behind an `EnquiryNotifier` port with an SMTP adapter. Mailpit locally, any
  SMTP provider (for example SES) in production, by configuration.
- Look and feel is CSS variables in `apps/web/src/theme`, so the creative work replaces tokens, not logic.
- Every failure is a typed error, turned into one response envelope in one place, logged once with a
  request id that the UI shows as a reference.
- The enquiry endpoint is rate limited, body-size limited, strictly validated, injection-safe, and its
  logs never contain what the visitor typed.

## Decisions worth a look

See [DECISIONS.md](DECISIONS.md). In short: the featured list is a configurable selection (default top
5 rated), search is done in the API, enquiries are sent synchronously and not stored, and the cache and
rate limiter are in memory behind ports. The first build was larger (Redis, retry cooldowns); I cut it
back to the brief and listed the cuts.

## How it was built

OpenSpec changes (`openspec/changes/archive`) for the plan, TDD for services, and a code review plus
security review after each change (`.claude/reviews/`). AI use, its mistakes and the time spent are in
[AI_USAGE.md](AI_USAGE.md).

## Testing

`npm run typecheck && npm run lint && npm test`: API, web and contracts suites, with no real network,
SMTP or clock. Every typed error has a test for status, code, envelope and log level. Tests were
mutation-checked by hand (delete the production line, the test must fail).

The full stack was also run in containers: the enquiry arrived in Mailpit with the visitor as
`Reply-To`, and a spoofed `X-Forwarded-For` did not get around the rate limit.

## Known limits and next steps

- Enquiries are not stored or queued; a failed send is shown to the visitor, who can retry.
- Per-process rate limit and cache; behind several instances each keeps its own.
- `npm audit` could not reach its endpoint from either machine used (advisories were checked another way, see DECISIONS.md); run `npm audit --audit-level=high` from a normal network first.
- The UI was exercised through component tests, not a browser session.
- More in the "next with another day" list in DECISIONS.md.
