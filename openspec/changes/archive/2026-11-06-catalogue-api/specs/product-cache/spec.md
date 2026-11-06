## ADDED Requirements

### Requirement: Cache port with interchangeable adapters

The domain SHALL define a `Cache` port with `get(key)` resolving to the stored value or `undefined`,
and `set(key, value, ttlSeconds)`. Values SHALL be JSON-serialisable. `MemoryCache` and `RedisCache`
SHALL both satisfy one shared behavioural contract.

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

#### Scenario: Contract suite runs for each adapter

- **WHEN** the test suite runs without `REDIS_URL`
- **THEN** the contract runs against `MemoryCache` and the Redis run is reported as skipped
- **AND** when `REDIS_URL` is set the same contract runs against `RedisCache`

### Requirement: Memory cache is the default

`MemoryCache` SHALL expire entries using an injected clock and SHALL need no external service.

#### Scenario: Expiry uses the injected clock

- **WHEN** an entry has a 10 s TTL and the clock advances 9 s, then 2 s more
- **THEN** it is present after 9 s and absent after 11 s

### Requirement: Redis cache degrades fast and fails typed

`RedisCache` SHALL prefix keys with `catalogue:v1:`, fail commands immediately when disconnected
instead of queueing them, bound each command by a timeout, handle connection `error` events by
logging at `warn`, and translate every low-level error into a `CacheError` whose `cause` is the
original error. It SHALL never log the connection URL.

#### Scenario: Command failure is a CacheError

- **WHEN** the Redis client rejects a `get` with a connection error
- **THEN** `RedisCache.get` rejects with a `CacheError` whose `cause` is that error

#### Scenario: Corrupt stored value

- **WHEN** the stored string is not valid JSON
- **THEN** `get` rejects with a `CacheError`

#### Scenario: Error events do not crash the process

- **WHEN** the Redis client emits an `error` event
- **THEN** a `warn` line is written and no exception is thrown

#### Scenario: URL is not logged

- **WHEN** a `RedisCache` is created from `redis://user:secret@cache.test:6379` and logs a warning
- **THEN** no log line contains `secret`

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

### Requirement: Serving stale during an outage does not wait for the source

After a failed refresh that was answered with a stale entry, the decorator SHALL NOT call the wrapped
source again for that key for the retry cooldown (15 seconds by default), and SHALL serve the stale
entry immediately. After the cooldown the next request SHALL try the source again. Cooldowns are
per key. A key with no stale entry has no cooldown.

#### Scenario: Requests inside the cooldown do not reach the source

- **WHEN** a refresh failed and the stale entry was served, and two more requests arrive 5 s and 10 s
  later
- **THEN** the wrapped source was called once in total for the outage and both requests are
  answered with the stale entry
- **AND** only the failed refresh wrote a `warn` line

#### Scenario: Cooldown ends

- **WHEN** 15 s have passed since the failed refresh
- **THEN** the next request calls the wrapped source again

#### Scenario: A failing retry starts a new cooldown

- **WHEN** the retry after a cooldown fails too
- **THEN** a new cooldown starts and a second `warn` line is written

#### Scenario: Cooldowns are per key

- **WHEN** the list refresh failed and is cooling down
- **THEN** a refresh of a product entry is still attempted

#### Scenario: Cold cache has no cooldown

- **WHEN** nothing is cached and the source fails twice in a row
- **THEN** the source is called both times

### Requirement: Cached values are validated before use

A cached value SHALL be used only if it satisfies the contract schema (a list of products for
`products:all`, a product for `product:<id>`). Otherwise the entry SHALL be ignored as a miss with a
`warn` line, including as a stale fallback.

#### Scenario: Old-shaped list ignored

- **WHEN** the cache holds a list whose items do not satisfy the product schema
- **THEN** the wrapped source is called and one `warn` line says the entry has an unexpected shape

#### Scenario: Old-shaped entry is not served as stale

- **WHEN** the cache holds an invalid entry and the wrapped source fails
- **THEN** the call rejects with the source's error

#### Scenario: Valid empty list accepted

- **WHEN** the cache holds a fresh empty list
- **THEN** it is returned without calling the source

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
