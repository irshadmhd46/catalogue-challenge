# catalogue-endpoints Specification

## Purpose

The /api/v1 catalogue routes, their request validation and response shapes.

## Requirements

### Requirement: Featured products endpoint

`GET /api/v1/featured` SHALL respond 200 with `{ "products": [...] }` containing the featured
products from the catalogue service, each conforming to the contract product schema.

#### Scenario: Default featured response

- **WHEN** `GET /api/v1/featured` is requested against the fixture catalogue
- **THEN** the status is 200 and `products` has exactly 5 items with ids 12, 11, 3, 18, 5
- **AND** every item parses with the contract product schema

#### Scenario: Response has no upstream fields

- **WHEN** the featured response body is inspected
- **THEN** no product has an `image` or `rating.rate` property

### Requirement: Categories endpoint

`GET /api/v1/categories` SHALL respond 200 with `{ "categories": [...] }` of `{ slug, name }` sorted
by name.

#### Scenario: Four categories

- **WHEN** `GET /api/v1/categories` is requested against the fixture catalogue
- **THEN** `categories` has four entries with slugs `electronics`, `jewelery`, `mens-clothing`,
  `womens-clothing`

### Requirement: Category page endpoint

`GET /api/v1/categories/:slug` SHALL respond 200 with `{ category, topRated, more }` and SHALL
respond 404 `NOT_FOUND` for a slug that is valid but unknown, and 400 `VALIDATION_ERROR` for a slug
that is malformed.

#### Scenario: Known category

- **WHEN** `GET /api/v1/categories/electronics` is requested
- **THEN** the status is 200, `category.slug` is `electronics`, `topRated` has 3 items and `more` has
  3

#### Scenario: Unknown category

- **WHEN** `GET /api/v1/categories/nope` is requested
- **THEN** the status is 404 with code `NOT_FOUND` and message `Category not found`

#### Scenario: Malformed slug

- **WHEN** `GET /api/v1/categories/Men%27s` is requested
- **THEN** the status is 400 with code `VALIDATION_ERROR` and `details` naming `slug`

### Requirement: Search endpoint

`GET /api/v1/products?q=<text>` SHALL respond 200 with `{ query, products }` where `query` is the
trimmed query. A missing, blank, over-long or control-character query, a repeated `q`, or any other
query parameter SHALL be rejected with 400 `VALIDATION_ERROR` before any service call.

#### Scenario: Search hit

- **WHEN** `GET /api/v1/products?q=backpack` is requested
- **THEN** the status is 200, `query` is `backpack` and `products` includes id 1

#### Scenario: Search with no match

- **WHEN** `GET /api/v1/products?q=zzzzzz` is requested
- **THEN** the status is 200 and `products` is an empty array

#### Scenario: Query is trimmed

- **WHEN** `GET /api/v1/products?q=%20backpack%20` is requested
- **THEN** `query` is `backpack`

#### Scenario: Missing query

- **WHEN** `GET /api/v1/products` is requested
- **THEN** the status is 400, `details` names `q`, and the service was not called

#### Scenario: Blank query

- **WHEN** `GET /api/v1/products?q=%20%20` is requested
- **THEN** the status is 400 and the whole catalogue is not returned

#### Scenario: Over-long query

- **WHEN** a 101-character query is sent
- **THEN** the status is 400

#### Scenario: Control character in query

- **WHEN** `GET /api/v1/products?q=a%0Ab` is requested
- **THEN** the status is 400

#### Scenario: Repeated or unknown parameters

- **WHEN** `?q=a&q=b` and `?q=a&sort=price` are requested
- **THEN** both return 400

### Requirement: Product detail endpoint

`GET /api/v1/products/:id` SHALL respond 200 with `{ product }`, 404 `NOT_FOUND` when no such product
exists, and 400 `VALIDATION_ERROR` when the id is not a valid id. An invalid id SHALL NOT reach the
service, the cache or the upstream.

#### Scenario: Existing product

- **WHEN** `GET /api/v1/products/1` is requested
- **THEN** the status is 200 and `product.id` is 1 with a `category.slug` of `mens-clothing`

#### Scenario: Unknown product

- **WHEN** `GET /api/v1/products/9999` is requested and the source reports it missing
- **THEN** the status is 404 with code `NOT_FOUND` and message `Product not found`

#### Scenario: Invalid ids

- **WHEN** each of `abc`, `0`, `-1`, `1e3`, `007` and `99999999999999999999` is requested as the id
- **THEN** every response is 400 `VALIDATION_ERROR` and the source was never called

### Requirement: Failures use the shared envelope

Failures from the catalogue SHALL be returned through the central error handler: an `UpstreamError`
as 502 `UPSTREAM_ERROR`, an `UpstreamTimeoutError` as 504 `UPSTREAM_TIMEOUT`. The body SHALL carry
the request id and SHALL NOT contain upstream URLs, hostnames or messages.

#### Scenario: Upstream down with a cold cache

- **WHEN** the source rejects with an `UpstreamError` caused by `connect ECONNREFUSED fakestore.test`
- **THEN** the response is 502 `UPSTREAM_ERROR` with a `requestId`
- **AND** the body does not contain `fakestore.test`
- **AND** exactly one `error` line is logged

#### Scenario: Upstream timeout

- **WHEN** the source rejects with an `UpstreamTimeoutError`
- **THEN** the response is 504 `UPSTREAM_TIMEOUT`

#### Scenario: Upstream down with a warm cache

- **WHEN** the upstream fails but a stale entry exists in the cache
- **THEN** the endpoint answers 200 with the stale data and one `warn` line is logged

### Requirement: Unsupported methods and unknown versions are not served

Only GET (and the HEAD that Fastify derives from it) SHALL be accepted on the catalogue routes.

#### Scenario: POST to a catalogue route

- **WHEN** `POST /api/v1/featured` is requested
- **THEN** the response is the 404 envelope

#### Scenario: Other API version

- **WHEN** `GET /api/v2/featured` is requested
- **THEN** the response is the 404 envelope

### Requirement: Whole-stack behaviour with the real adapters

The endpoints SHALL behave as specified when wired to the real adapters.
With `FakeStoreProductSource` over a stubbed `fetch`, `CachedProductSource` over `MemoryCache` and
the real service and routes, the upstream SHALL be called at most once per refresh window.

#### Scenario: Cache absorbs repeat requests

- **WHEN** `featured`, `categories` and `categories/electronics` are requested in turn
- **THEN** the stubbed upstream list endpoint was called exactly once

#### Scenario: Stale served through the whole stack

- **WHEN** the clock passes the fresh TTL and the stubbed upstream then answers 500 on every attempt
- **THEN** `GET /api/v1/featured` still answers 200 with the previously fetched products
