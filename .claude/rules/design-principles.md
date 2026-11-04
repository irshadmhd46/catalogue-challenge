# Design Principles

Quick check before marking any task done. If an answer is "yes", refactor first.

- [ ] **SRP**: does this function/class do more than one thing?
- [ ] **DRY**: is this string/constant/logic defined somewhere else too?
- [ ] **DIP**: am I calling `new SomeAdapter()` inside a service instead of receiving it?
- [ ] **Presentation leak**: is a service doing HTTP or UI work (status codes, page numbers, URLs)?
- [ ] **Tell, don't ask**: am I fetching state just to make a decision the object should make?

## 1. Single Responsibility

One module, one reason to change.

```ts
// BAD: service decides HTTP status
if (!product) return { status: 404, body: { error: 'missing' } };

// GOOD: service throws a domain error; the error handler maps it to HTTP
if (!product) throw new NotFoundError('product', id);
```

Red flags: a name containing "and"/"or"; a function that fetches AND formats a response.

## 2. Dependency Inversion

Depend on ports (interfaces), receive them through the constructor.

```ts
// BAD
class CatalogService { private source = new FakeStoreProductSource(); }

// GOOD
class CatalogService { constructor(private readonly source: ProductSource, private readonly log: Logger) {} }
```

Adapters are created in exactly one place: the composition root (`main.ts`).

## 3. DRY

One authoritative place per piece of knowledge: error codes, user-facing messages, cache TTLs,
route paths, validation schemas (`packages/contracts`), limits (body size, rate).

## 4. Separation of concerns

| Layer            | Owns                                         | Must NOT contain                         |
| ---------------- | -------------------------------------------- | ---------------------------------------- |
| `http/`          | routing, request parsing, response shaping   | business rules, direct adapter calls     |
| `application/`   | business rules, orchestration                | HTTP status codes, framework imports     |
| `domain/`        | types, ports, typed errors                   | I/O, framework imports                   |
| `infrastructure/`| talking to Fake Store, SMTP, Redis, pino     | business rules                           |
| `web/api`        | the only code that calls `fetch`             | UI state, rendering                      |
| `web/features`   | UI and interaction                           | URLs, raw `fetch`, upstream shapes       |

The upstream (Fake Store) shape never leaves its adapter. The web app never knows the upstream exists.

## 5. Immutability

Prefer `readonly` types, `as const`, and returning new values (`map`, spread) over mutating inputs.
Never mutate objects returned from a cache or a port.

## 6. Composition over inheritance

Decorate, don't extend: `CachedProductSource` wraps any `ProductSource`. Avoid base classes for reuse.

## 7. Fail fast

Validate assumptions at startup (env schema, Redis reachable when enabled), not on the first user
request. Never `catch { return null }` around configuration-dependent logic.

## Summary

| Principle      | One-line rule                          | Common violation                      |
| -------------- | -------------------------------------- | ------------------------------------- |
| SRP            | One reason to change                   | Service returning HTTP status         |
| DIP            | Receive ports, don't construct adapters| `new Adapter()` inside a service      |
| DRY            | One source of truth                    | Same message/constant in two files    |
| Separation     | Each layer owns one concern            | `fetch` called from a React component |
| Immutability   | New values, not mutation               | Sorting a cached array in place       |
| Composition    | Wrap, don't extend                     | `extends BaseService` for reuse       |
| Fail fast      | Crash at boot, not at first request    | Silent fallback on bad config         |
