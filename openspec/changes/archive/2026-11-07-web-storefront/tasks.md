## 1. Setup

- [x] 1.1 Add `errorEnvelopeSchema` to `packages/contracts`, test it, and parse real API error bodies with it in the enquiry route tests
- [x] 1.2 Scaffold `apps/web` (package, tsconfig, Vite config with `/api` proxy and contracts alias, Vitest with jsdom) and declare dependencies
- [x] 1.3 **Owner action**: `npm install` (also removes the unused `ioredis` entries from the lockfile)

## 2. API client and shared pieces

- [x] 2.1 `src/api/client.ts` with `ApiError`, `NetworkError`, timeout, schema-validated responses; tests for every error mapping
- [x] 2.2 Query hooks, retry policy (network and 5xx only), error boundary, loading/error/empty components with the reference id; tests
- [x] 2.3 Theme tokens, layout, header with search box and category links

## 3. Views

- [x] 3.1 Home with featured products; test
- [x] 3.2 Category page (top rated and more); test
- [x] 3.3 Search results with empty state and blank term handling; test
- [x] 3.4 Product page with Enquire; test
- [x] 3.5 Enquiry form (shared validation, 400 mapping, 429, 502/network banner, preserved input, no double submit, Thank you); tests
- [x] 3.6 One test that product text is rendered as text, and a check that `fetch(` appears only in the client module

## 4. Run and document

- [x] 4.1 `Dockerfile` for the API and for the web app (nginx), `nginx.conf` with the `/api` proxy and a CSP, `compose.yaml` with Mailpit, `.env.example`
- [x] 4.2 Build and run the stack; walk home, category, search, product, enquiry; confirm the email in Mailpit
- [x] 4.3 README (stack choice and why, run in under 10 minutes, tests, configuration, ports), `PR_DESCRIPTION.md`, time spent in `AI_USAGE.md`

## 5. Gates

- [x] 5.1 `npm run typecheck && npm run lint && npm test`, `npm run build`, advisory check
- [x] 5.2 Review gate (code-reviewer, then security-reviewer), report in `.claude/reviews/web-storefront.md`, AI_USAGE updated, commits
