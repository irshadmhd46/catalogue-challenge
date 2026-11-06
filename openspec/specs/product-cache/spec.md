# product-cache Specification

## Purpose

The Cache port, its in-memory adapter, and the caching decorator with fresh and stale windows, single flight and a cache that never becomes a dependency.

## Requirements

### Requirement: Cache port with interchangeable adapters

The domain SHALL define a `Cache` port with `get(key)` resolving to the stored value or `undefined`,
and `set(key, value, ttlSeconds)`. Values SHALL be JSON-serialisable. `MemoryCache`
SHALL satisfy the shared behavioural contract that any future adapter must also pass.

#### Scenario: Miss

- **WHEN** `get` is called for a key that was never set
- **THEN** it resolves to `undefined`

#### Scenario: Round trip

- **WHEN** an object is stored with `set` and read back with `get`
- **THEN** the result deep-equals the stored object

#### Scenario: Overwrite

- **WHEN** the same key is set twice with different values
- **THEN** `get` returns the second value

#### Scenario: Expiry

- **WHEN** a key is set with a TTL and the TTL elapses
- **THEN** `get` resolves to `undefined`

#### Scenario: Stored values are isolated copies

- **WHEN** an object is stored and the caller then mutates the original, and separately mutates an
  object returned by `get`
- **THEN** a later `get` still returns the value as it was stored

#### Scenario: Keys are independent

- **WHEN** two different keys are set
- **THEN** each `get` returns its own value

### Requirement: Memory cache is the default

`MemoryCache` SHALL expire entries using an injected clock and SHALL need no external service.

#### Scenario: Expiry uses the injected clock

- **WHEN** an entry has a 10 s TTL and the clock advances 9 s, then 2 s more
- **THEN** it is present after 9 s and absent after 11 s

### Requirement: Cached source serves fresh data from the cache

`CachedProductSource` SHALL wrap any `ProductSource`. It SHALL return a cached entry younger than the
fresh TTL without calling the wrapped source, and SHALL store what it fetches with a total TTL of
fresh plus stale seconds.

#### Scenario: Miss then fill

- **WHEN** `listProducts` is called with an empty cache
- **THEN** the wrapped source is called once and the result is stored under `products:all`

#### Scenario: Fresh hit

- **WHEN** `listProducts` is called twice 10 s apart with a 60 s fresh TTL
- **THEN** the wrapped source was called once and both results are equal

#### Scenario: Product lookups use their own key

- **WHEN** `findProduct(7)` and `findProduct(8)` are called
- **THEN** the wrapped source is called once for each and the entries are stored under
  `product:7` and `product:8`

#### Scenario: Absence is not cached

- **WHEN** `findProduct` resolves to `undefined` twice
- **THEN** the wrapped source is called twice and nothing was stored

#### Scenario: Entry past the fresh TTL is refreshed

- **WHEN** `listProducts` is called 61 s after the entry was stored and the source succeeds
- **THEN** the wrapped source is called again and the new value is returned and stored

### Requirement: Stale data is served when the source fails

The decorator SHALL return a stale entry when the wrapped source fails.
When an entry older than the fresh TTL but within the stale window exists, it SHALL be returned with
a `warn` line carrying the entry age. When no usable entry exists the typed error SHALL be rethrown
unchanged.

#### Scenario: Stale served on upstream error

- **WHEN** an entry is 5 minutes old and the wrapped source rejects with an `UpstreamError`
- **THEN** the stale value is returned
- **AND** exactly one `warn` line includes `ageSeconds` 300 and the cache key

#### Scenario: Stale window expired

- **WHEN** the entry is older than fresh plus stale seconds and the source rejects
- **THEN** the call rejects with the same `UpstreamError`

#### Scenario: No entry

- **WHEN** the cache is empty and the source rejects with an `UpstreamTimeoutError`
- **THEN** the call rejects with that same error instance

#### Scenario: Not-found is not an error to mask

- **WHEN** an entry for a product is stale and the source resolves to `undefined`
- **THEN** the call resolves to `undefined`, not the stale value

### Requirement: Concurrent refreshes share one upstream call

Concurrent calls for the same key that need a refresh SHALL share one in-flight call to the wrapped
source.

#### Scenario: Stampede

- **WHEN** five concurrent `listProducts` calls arrive with an empty cache
- **THEN** the wrapped source is called once and all five calls resolve to the same products

#### Scenario: A source that throws synchronously does not poison the key

- **WHEN** the wrapped source throws synchronously on the first call and works on the second
- **THEN** the first call rejects with that error and the second call succeeds

#### Scenario: In-flight entry is cleared after failure

- **WHEN** a shared call fails and `listProducts` is called again afterwards
- **THEN** the wrapped source is called again

### Requirement: The cache is an optimisation, never a dependency

Cache read and write failures SHALL be logged at `warn`, treated as a miss or a skipped write, and
SHALL NOT fail the request.

#### Scenario: Read failure

- **WHEN** `cache.get` rejects with a `CacheError`
- **THEN** the wrapped source is called, its result is returned, and one `warn` line is written

#### Scenario: Write failure

- **WHEN** `cache.set` rejects after a successful fetch
- **THEN** the fetched value is still returned and one `warn` line is written

#### Scenario: Both failing

- **WHEN** reads and writes fail and the source succeeds
- **THEN** the call resolves with the source value

### Requirement: Cache adapters never share mutable state with callers

Values returned by the decorator SHALL be safe to read repeatedly without affecting later reads.

#### Scenario: Mutating a returned list

- **WHEN** a caller pushes onto the array returned by `listProducts` and calls it again
- **THEN** the second result has the original length
