## Why

The challenge's acceptance criteria are all things a visitor does in a browser: see the featured
products, browse a category, search, open a product, and send an enquiry. The API exists; there is no
client, and no way to run the whole thing with one command. Without both, nothing can be demonstrated.

## What Changes

- Add `apps/web`: a React + TypeScript + Vite single-page app with five views: home, category, search
  results, product detail with the enquiry form, and a not-found page.
- Add one API client module that is the only code in the web app that calls `fetch`. It turns every
  failure into an `ApiError` (with the server's request id) or a `NetworkError`.
- Add the enquiry form: client-side validation with the same schema the server uses, field errors from
  the API, a "Thank you" message only after the server confirms, and input preserved on failure.
- Add loading, error and empty states on every data view, an error boundary, and design tokens in one
  CSS file so a new look replaces tokens, not logic.
- Add `Dockerfile`s for the API and the web app, and a `compose.yaml` that runs the API, the web app
  (nginx serving the build and proxying `/api`) and Mailpit (the local sales inbox). `docker compose up`
  (or `podman compose up`) is the whole setup.
- Move the shared error envelope schema into `packages/contracts` so the client parses what the server
  sends from one definition.
- Write the README (stack choice and why, run instructions, tests, configuration).

## Capabilities

### New Capabilities

- `storefront-ui`: what a visitor sees and can do in each view, how failures are shown, and how the
  app is run.

### Modified Capabilities

None.

## Impact

- New: `apps/web`, `compose.yaml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`,
  README, `packages/contracts/src/errors.ts`.
- Dependencies (web): react, react-dom, react-router-dom, @tanstack/react-query, vite,
  @vitejs/plugin-react, and for tests @testing-library/react, user-event, jest-dom and jsdom. `npm install`
  is required.
- The API's `ErrorEnvelope` type is replaced by the contract's.

## Assumptions

- A single-page app with client-side routing is enough; there is no server rendering or SEO need.
- The browser only ever calls its own origin (`/api`), proxied to the API by Vite in development and by
  nginx in the container, so no CORS is needed.
- The enquiry form shows the same validation messages as the server for the same input, because the
  rules come from one schema.
- Product text and image URLs come from an untrusted source, so text is rendered as text only.
- Behind the compose nginx there is one proxy hop, so the compose API runs with `TRUST_PROXY_HOPS=1`.

## Out of Scope

- Authentication, accounts, a cart, checkout, internationalisation and analytics.
- Pagination (the catalogue is 20 products) and sorting or filtering beyond search and categories.
- Visual polish: the entrepreneur's creative work replaces the tokens later.
- A mobile app. Web was chosen and the reason is in the README.
