# catalogue-contracts Specification

## Purpose

The public catalogue shapes and request rules, defined once as schemas shared by the API and the web app.

## Requirements

### Requirement: Public catalogue shapes are defined once as schemas

The `@catalogue/contracts` package SHALL export zod schemas and inferred types for `Product`,
`Category` and every `/api/v1` catalogue response body. A `Product` SHALL have a positive integer
`id`, `title`, `description`, a non-negative finite `price`, a `category` of `{ slug, name }`, an
absolute http(s) `imageUrl`, and `rating` of `{ average, count }` with `average` between 0 and 5
and a non-negative integer `count`. The shapes SHALL NOT contain any upstream field names.

#### Scenario: A well-formed product parses

- **WHEN** a product object with all fields in range is parsed with the product schema
- **THEN** parsing succeeds and the result equals the input

#### Scenario: Out-of-range values are rejected

- **WHEN** a product with `rating.average` 5.1, or `price` -1, or `id` 0, or a non-URL `imageUrl` is
  parsed
- **THEN** parsing fails for each of them

#### Scenario: Unknown fields are rejected

- **WHEN** a product object with an extra property `image` is parsed
- **THEN** parsing fails, so an upstream-shaped object cannot pass as a contract product

### Requirement: Response bodies are wrapped objects

The package SHALL define these response schemas: `{ products }` for featured, `{ categories }`,
`{ category, topRated, more }` for a category page, `{ query, products }` for search, and
`{ product }` for a single product.

#### Scenario: Each response schema accepts its body

- **WHEN** a representative body for each of the five endpoints is parsed with its schema
- **THEN** every parse succeeds

#### Scenario: A bare array is not a valid response

- **WHEN** a bare array of products is parsed with the featured response schema
- **THEN** parsing fails

### Requirement: Request parameters have strict schemas

The package SHALL define request schemas for a product id, a category slug and a search query.

- Product id: a string of 1 to 9 digits with no leading zero, converted to a number.
- Category slug: lowercase letters and digits in hyphen-separated groups, 1 to 64 characters.
- Search query: trimmed, 1 to 100 characters, no control characters; the query object rejects
  unknown parameters.

#### Scenario: Valid inputs parse

- **WHEN** `'42'` is parsed as an id, `'mens-clothing'` as a slug and `'  backpack '` as a query
- **THEN** the results are `42`, `'mens-clothing'` and `'backpack'`

#### Scenario: Invalid ids are rejected

- **WHEN** each of `'0'`, `'-1'`, `'1e3'`, `' 5'`, `'abc'`, `''`, `'007'` and `'1234567890'` is parsed
  as an id
- **THEN** every parse fails

#### Scenario: Invalid slugs are rejected

- **WHEN** each of `'Men'`, `'a b'`, `'-x'`, `'x-'`, `'a--b'`, `'../x'` and a 65-character slug is
  parsed
- **THEN** every parse fails

#### Scenario: Invalid queries are rejected

- **WHEN** a blank query, a whitespace-only query, a 101-character query and a query containing a
  newline are parsed
- **THEN** every parse fails

#### Scenario: Unknown query parameters are rejected

- **WHEN** the query object `{ q: 'bag', sort: 'price' }` is parsed
- **THEN** parsing fails

### Requirement: Validation messages never echo the input

Failures from the request schemas SHALL be reportable as `{ field, message }` pairs whose messages do
not contain the submitted value.

#### Scenario: Message omits the value

- **WHEN** the id `'hunter2'` fails validation and its issue messages are collected
- **THEN** none of them contains `hunter2`
