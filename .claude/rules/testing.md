# Testing

Framework: **Vitest** (api and web), **Testing Library** for React, `fastify.inject()` for HTTP.
Target: 80%+ line coverage on `application/`, `domain/` and `infrastructure/` mappers. Skip trivial
wiring (`main.ts`) in the coverage target, but test its failure behaviour.

## TDD layer strategy

| Layer                                  | Order                              |
| -------------------------------------- | ---------------------------------- |
| Services (`application/`)              | Test first: RED, GREEN, REFACTOR   |
| Adapters (Fake Store, SMTP, Redis)     | Implement, then test               |
| HTTP routes / error handler            | Implement, then test (`inject`)    |
| React components                       | Implement, then test behaviour     |

## No real I/O in tests

- No real network, SMTP, Redis or clock. Stub `fetch`, inject a fake `Logger`, fake notifier, fake
  timers.
- Redis contract tests run only when `REDIS_URL` is set and are skipped otherwise, so `npm test`
  needs nothing running.

## Every error path is a test

For each typed error: a test proving status, code, envelope shape and log level. Upstream timeout,
retry then give up, non-retryable 4xx, wrong-shape payload, cache failure, SMTP failure,
rate-limit, validation failure. A happy-path-only suite is incomplete.

## The assertion must verify what the name claims

```ts
// BAD: name promises the default limit, assertion only checks status
it('returns 5 featured products by default', async () => {
  expect((await app.inject({ url: '/api/v1/featured' })).statusCode).toBe(200);
});

// GOOD
it('returns exactly 5 featured products by default', async () => {
  const res = await app.inject({ url: '/api/v1/featured' });
  expect(res.json().products).toHaveLength(5);
});
```

Two tests with identical bodies mean one of them tests nothing.

## Mutation check

After writing a test, mentally delete the production line it is meant to cover. If the test would
still pass (an unstubbed fake returns `undefined`, a default value looks plausible), it does not
cover that line. Fix by asserting the collaborator call: `expect(source.getAll).toHaveBeenCalledOnce()`.

## Keep tests in sync with refactors

When a method's internals change, update the stubs and `expect(...).toHaveBeenCalledWith(...)`
for the new code path. Check that every stub is still used.

## Logging tests

Capture log output with a fake `Logger` or an in-memory pino stream. Assert level, `reqId`, and that
submitted PII (email, phone, message) never appears in any line.

## Naming

`describe('<unit>')` then `it('<scenario> -> <expected>')`. Use table-driven `it.each` for
mappings such as error type to status code.

## Web

- Query by role/label/text, not by implementation details. Add `data-testid` only where no
  accessible selector exists.
- Assert user-visible outcomes: validation messages, "Thank you", retry banner, preserved input.
