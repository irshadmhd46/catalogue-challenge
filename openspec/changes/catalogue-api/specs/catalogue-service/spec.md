## ADDED Requirements

### Requirement: One ranking rule orders every list

`CatalogService` SHALL order products by `rating.average` descending, then `rating.count`
descending, then `id` ascending. It SHALL return new arrays and SHALL NOT mutate what its source
returns.

#### Scenario: Ties are broken deterministically

- **WHEN** the real fixture is ranked
- **THEN** the first four ids are 12 (4.8, 400), 11 (4.8, 319), 3 (4.7, 500) and 18 (4.7, 130)

#### Scenario: Equal rating and count fall back to id

- **WHEN** two products have identical average and count
- **THEN** the lower id comes first

#### Scenario: Input is not mutated

- **WHEN** a list is ranked
- **THEN** the array returned by the source is unchanged and is not the returned array

### Requirement: Featured products

`featured()` SHALL return the top 5 products by the ranking rule. When a featured override of ids is
configured it SHALL return those products in the configured order instead, skip ids that do not
exist with one `warn` line naming the ids, and fall back to the ranking rule with a `warn` when none
of the ids exist.

#### Scenario: Default featured

- **WHEN** `featured()` is called on the fixture without an override
- **THEN** it returns exactly 5 products with ids 12, 11, 3, 18, 5 in that order

#### Scenario: Override order is kept

- **WHEN** the override is `[7, 2, 15]`
- **THEN** `featured()` returns products 7, 2, 15 in that order

#### Scenario: Unknown override ids skipped

- **WHEN** the override is `[7, 9999, 2]`
- **THEN** `featured()` returns 7 and 2, and one `warn` line names 9999

#### Scenario: Override entirely unknown

- **WHEN** the override is `[9998, 9999]`
- **THEN** `featured()` returns the default top 5 and one `warn` line is written

#### Scenario: Source failure propagates

- **WHEN** the source rejects with an `UpstreamError`
- **THEN** `featured()` rejects with that same error

### Requirement: Categories derived from the products

`categories()` SHALL return the unique categories of the products sorted by name. If two distinct
upstream names produce the same slug it SHALL keep the first and write one `warn` line.

#### Scenario: Fixture categories

- **WHEN** `categories()` is called on the fixture
- **THEN** it returns four categories with slugs `electronics`, `jewelery`, `mens-clothing`,
  `womens-clothing` in that order

#### Scenario: Slug collision

- **WHEN** two products have categories `Kids` and `kids` that slugify to the same value
- **THEN** one category is returned and one `warn` line is written

### Requirement: Category page splits top rated from the rest

`categoryPage(slug)` SHALL return the category, `topRated` as the first 3 of its products by the
ranking rule, and `more` as the remaining products by the same rule. An unknown slug SHALL throw
`NotFoundError` for resource `category`.

#### Scenario: Electronics page

- **WHEN** `categoryPage('electronics')` is called on the fixture
- **THEN** `topRated` has 3 products and `more` has 3, no id appears in both, and every `topRated`
  product ranks above every `more` product

#### Scenario: Small category

- **WHEN** a category has 2 products
- **THEN** `topRated` has 2 and `more` is empty

#### Scenario: Unknown slug

- **WHEN** `categoryPage('nope')` is called
- **THEN** it rejects with a `NotFoundError` whose resource is `category`

#### Scenario: Unknown slug does not depend on the upstream

- **WHEN** `categoryPage('nope')` is called
- **THEN** the source's `listProducts` is called once and `findProduct` is not called

### Requirement: Search matches title, description and category

`search(query)` SHALL return products whose title, description or category name contains the trimmed
query, compared case-insensitively, in ranking order. An empty result is a valid result.

#### Scenario: Title match

- **WHEN** `search('backpack')` is called on the fixture
- **THEN** the result includes product 1

#### Scenario: Case insensitive

- **WHEN** `search('BACKPACK')` and `search('backpack')` are called
- **THEN** both return the same ids

#### Scenario: Description match

- **WHEN** a query matches only a product's description
- **THEN** that product is returned

#### Scenario: Category name match

- **WHEN** `search('jewelery')` is called on the fixture
- **THEN** all four jewelery products are returned

#### Scenario: Result order

- **WHEN** a query matches several products
- **THEN** they are in ranking order

#### Scenario: No match

- **WHEN** `search('zzzzzz')` is called
- **THEN** it resolves to an empty array

#### Scenario: Special characters are literal

- **WHEN** `search('.*')` and `search('(')` are called
- **THEN** both resolve to empty arrays without throwing

### Requirement: Product lookup

`find(id)` SHALL return the product from the source, or throw `NotFoundError` for resource `product`
when the source reports it does not exist.

#### Scenario: Found

- **WHEN** `find(1)` is called and the source has product 1
- **THEN** the product is returned and `findProduct` was called once with 1

#### Scenario: Not found

- **WHEN** the source resolves `findProduct(9999)` to `undefined`
- **THEN** `find(9999)` rejects with a `NotFoundError` whose resource is `product`
