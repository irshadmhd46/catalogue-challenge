## Context

The API serves five read endpoints and one enquiry endpoint under `/api/v1` with a typed error
envelope and `X-Request-Id`. `packages/contracts` holds the zod schemas for every body. The brief wants
clear boundaries between frontend, backend and product data source, a look and feel that can change,
a run time under 10 minutes by one or two commands, and tests on the critical path.

## Goals / Non-Goals

**Goals:** the five acceptance criteria working in a browser; failures that a visitor understands and
support can trace; a styling layer that can be replaced; one-command run.

**Non-Goals:** polish, server rendering, state management beyond server data, offline support.

## Decisions

### 1. Small, boring stack

React, React Router, TanStack Query, Vite. TanStack Query owns loading, error, caching and retry for
reads; there is no other global state. Forms use controlled inputs and the shared schema, not a form
library: the form has four fields.

### 2. One module talks to the network

`src/api/client.ts` is the only place that calls `fetch`. Components and hooks call typed functions
(`getFeatured`, `search`, `sendEnquiry`, ...). The module:

- builds URLs from `API_PREFIX` and `catalogPaths` (shared constants), never from component code;
- aborts after 10 s, throws `NetworkError` for network failures and timeouts;
- parses the error envelope with the shared schema and throws `ApiError { status, code, message,
  requestId, details }`; a non-JSON or unexpected body becomes `ApiError('INVALID_RESPONSE')`;
- validates successful bodies with the contract schemas, so a server change fails loudly in one place.

Alternative considered: calling `fetch` inside hooks. Rejected: error mapping and URLs would be repeated.

### 3. Failures are shown the same way everywhere

Every data view has loading, error and empty states. An error state shows a friendly message, a "Try
again" button and, when the server sent one, "Reference: <request id>" so a support request can be
matched to a log line. Reads retry only network errors and 5xx (twice); 4xx is never retried. A root
error boundary catches rendering bugs.

### 4. The enquiry form

Validation uses `enquiryRequestSchema` from the contracts package on blur and submit, so client and
server agree. On submit the button is disabled while the request is in flight (no double submit). On
`400` the API's `details` are mapped onto fields; on `429` it says how long to wait (from the response);
on `502`, `504` or a network failure it shows a banner with a retry and keeps what the visitor typed.
"Thank you" appears only after a `202`. Product title and the visitor's own text are rendered as text.

### 5. Look and feel is replaceable

All colours, spacing, radii and type sizes are CSS variables in `src/theme/tokens.css`; components use
the variables and semantic class names. Replacing the file replaces the look.

### 6. Running it

- Development: `npm run dev -w @catalogue/web` with a Vite proxy of `/api` to the API.
- Containers: the API image builds contracts then the API and runs `node dist/main.js` as a non-root
  user; the web image builds the SPA and serves it with nginx, which also proxies `/api` to the API
  service. `compose.yaml` adds Mailpit. Everything uses ports above 1024 and OCI images with no
  Docker-only features, so it runs with Podman and builds unchanged on AWS (ECS and ECR).
- Configuration comes from `.env.example` (copied to `.env`); no secrets are committed.

### 7. Tests

Vitest and Testing Library, querying by role, label and text. One test file per view plus the client
and the form, with `fetch` stubbed at the client boundary: featured products shown, category sections,
search results and the empty state, product details, form validation, success, `400`, `429`, `502` and
network failure with preserved input, no double submit, the error state with a reference id, and the
error boundary.

## Risks / Trade-offs

- [The browser bundle and the API drift apart] -> One contracts package; the client validates responses.
- [Compose startup order: the web proxy starts before the API is ready] -> nginx resolves the API at
  request time and the API has a health check that compose waits for.
- [Untrusted images and text] -> Text only, `img-src` limited in the nginx CSP to the image host.
