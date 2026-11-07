## ADDED Requirements

### Requirement: The home page shows the featured products

The home page SHALL show the featured products returned by the API, a category navigation and a search
box.

#### Scenario: Five featured products

- **WHEN** the visitor opens the home page and the API returns five featured products
- **THEN** exactly those five products are shown, each as a tile with image, title and price

#### Scenario: Category links

- **WHEN** the home page has loaded
- **THEN** a link to each category is shown

### Requirement: A category page shows top rated products and more

The category page SHALL show the category's top rated products in one section and the additional
products in another.

#### Scenario: Both sections

- **WHEN** the visitor opens a category with three top rated and three more products
- **THEN** a "Top rated" section shows the three and a "More in <category>" section shows the other three

#### Scenario: Unknown category

- **WHEN** the API answers 404 for the category
- **THEN** a not-found message is shown with a link home

### Requirement: Search shows only matching products

Submitting a search term SHALL show the products the API returns for it, and a message when there are
none.

#### Scenario: Matches

- **WHEN** the visitor types `backpack` and presses the search button
- **THEN** the results page shows the matching products and the term

#### Scenario: No matches

- **WHEN** the API returns no products
- **THEN** a "no products match" message is shown

#### Scenario: Blank term

- **WHEN** the visitor submits an empty or whitespace-only term
- **THEN** no request is made and the search box is marked invalid

### Requirement: A product tile opens the product page

Clicking a product tile SHALL open the product details page with title, image, price, rating,
description and an Enquire button.

#### Scenario: Open a product

- **WHEN** the visitor clicks a product tile
- **THEN** the product page shows that product's details and an "Enquire" button

#### Scenario: Unknown product

- **WHEN** the API answers 404 for the product
- **THEN** a not-found message is shown

### Requirement: The enquiry form sends the enquiry and thanks the visitor

The Enquire button SHALL open a form for name, email, optional phone and message. Submitting valid data
SHALL send it to the API, and a "Thank you" message SHALL be shown only after the API confirms.

#### Scenario: Success

- **WHEN** the visitor submits valid details and the API answers 202
- **THEN** a "Thank you" message replaces the form

#### Scenario: Client-side validation

- **WHEN** the visitor submits an invalid email or a too-short message
- **THEN** each invalid field shows its message and no request is made

#### Scenario: Server-side field errors

- **WHEN** the API answers 400 with field details
- **THEN** each detail is shown on its field and the typed input is kept

#### Scenario: Rate limited

- **WHEN** the API answers 429
- **THEN** a message says to try again later, the typed input is kept and no "Thank you" is shown

#### Scenario: Send failure

- **WHEN** the API answers 502, 504 or the network fails
- **THEN** a banner offers a retry, shows the reference id when there is one, and the typed input is kept

#### Scenario: No double submit

- **WHEN** a submission is in flight
- **THEN** the submit button is disabled

### Requirement: Failures are shown with a reference

Every data view SHALL show loading, error and empty states, and an error state SHALL offer a retry and
show the server's request id when it has one.

#### Scenario: Server error

- **WHEN** a read fails with a 5xx and a request id
- **THEN** the view shows an error message, a "Try again" button and "Reference: <request id>"

#### Scenario: Client errors are not retried

- **WHEN** a read fails with a 4xx
- **THEN** it is not retried automatically

### Requirement: The browser only talks to the API

The web app SHALL call only its own origin under `/api/v1`, through one client module, and SHALL render
product text as text.

#### Scenario: One network module

- **WHEN** the web source is searched for `fetch(`
- **THEN** it appears only in the API client module

#### Scenario: Hostile product text

- **WHEN** a product title contains `<img src=x onerror=alert(1)>`
- **THEN** it is shown as literal text and no element is created from it

### Requirement: The solution runs with one command

`docker compose up` SHALL start the API, the web app and Mailpit, and the web app SHALL be reachable on
a documented port.

#### Scenario: Whole flow

- **WHEN** the stack is up and a visitor submits an enquiry
- **THEN** the message appears in the Mailpit inbox
