# Catalogue Challenge

A product catalogue proof of concept: a home page with featured products, category pages, search, a
product page, and an enquiry form that emails a sales inbox.

- **API**: Node.js 22, TypeScript, Fastify (`apps/api`)
- **Web**: React, TypeScript, Vite, TanStack Query (`apps/web`)
- **Shared contract**: zod schemas used by both sides (`packages/contracts`)
- **Product data**: the [Fake Store API](https://fakestoreapi.com), reached **only** through the API

## Why this stack

One language end to end, so the request and response shapes are written once (`packages/contracts`)
and checked on both sides. Fastify gives schema-friendly routing, fast startup and a small image.
React with TanStack Query covers loading, error and retry states with little code. The product data
source, the email provider and the look and feel are all expected to change, so each sits behind a
boundary (see [DECISIONS.md](DECISIONS.md)). Web was chosen over mobile because the brief is a
catalogue with a form, and a browser needs nothing installed.

## Run it (about 5 minutes)

You need [Podman](https://podman.io) (or Docker). On macOS, once:

```bash
podman machine init && podman machine start
```

Then, from the repository root:

```bash
podman compose up --build        # `docker compose up --build` works too
```

| What           | Where                   |
| -------------- | ----------------------- |
| Storefront     | http://localhost:8080   |
| Mail inbox UI  | http://localhost:8025   |

Both ports are bound to `127.0.0.1`: the inbox shows every submitted enquiry, so it is not exposed to
your network.

Open the storefront, pick a product, press **Enquire**, send the form, and the email appears in the
inbox UI. No `.env` file is needed for this; the compose file carries the settings. Only the web
(8080) and inbox (8025) ports are published. The API port is **not** published, on purpose: the API
trusts one proxy hop for the client address (`TRUST_PROXY_HOPS=1`), so it must only be reachable
through the web container.

Stop with `podman compose down`.

## Run it without containers

```bash
nvm use                 # Node 22
npm install
npm run dev -w @catalogue/api      # API on :3000; defaults expect an SMTP sink on :1025 (e.g. Mailpit)
npm run dev -w @catalogue/web      # web on :5173, proxies /api to :3000
```

## Tests and checks

```bash
npm run typecheck && npm run lint && npm test
npm run test:coverage
npm run build
```

No test needs the network, an SMTP server or a clock: `fetch`, the mail transport and time are
replaced in tests. One test sends mail to a throwaway SMTP server on loopback.

## API

All routes are under `/api/v1`. Errors always look like
`{ "error": { "code", "message", "requestId", "details"? } }`, and the same `requestId` appears in the
server log line.

| Method and path                  | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `GET /featured`                  | the featured products (5)                       |
| `GET /categories`                | category list                                   |
| `GET /categories/:slug`          | top 3 rated, then the rest                      |
| `GET /products?q=`               | search (blank `q` is a 400)                     |
| `GET /products/:id`              | one product                                     |
| `POST /enquiries`                | validates, emails the sales inbox, answers 202  |

## Configuration

Everything comes from environment variables, validated at startup; a bad value stops the process
with a readable message. [.env.example](.env.example) lists every setting with its default. The
ones you will touch:

| Variable                 | Meaning                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `FEATURED_PRODUCT_IDS`   | comma-separated ids to feature (default: the 5 highest rated)           |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_TLS` | mail server; `starttls` or `tls` is required in production |
| `SMTP_USER` / `SMTP_PASSWORD` | set together; refused without TLS                                 |
| `MAIL_FROM` / `SALES_INBOX` | sender and recipient of the enquiry email                            |
| `TRUST_PROXY_HOPS`       | proxies in front of the API (`1` behind compose or a load balancer)     |
| `RATE_LIMIT_ENQUIRY_PER_MINUTE` | per client address, default 5                                    |

## Look at the failure behaviour

```bash
podman compose stop mailpit        # send an enquiry: the form shows a retry banner with a reference id
podman compose logs api            # the matching `error` line carries the same request id, no personal data
podman compose start mailpit
```

Send six enquiries in a minute and the sixth is refused with a `429` and a wait time. Set
`FAKESTORE_BASE_URL` to an unreachable host and every catalogue page shows an error with a reference
id (the cache is in memory, so a restarted API has nothing stale to fall back on; with the API left
running, data fetched within the last hour keeps being served while the upstream is down).

With rootless Podman or Docker Desktop the visitor address the proxy sees can be the VM gateway, so
locally all requests may share one rate-limit bucket. That is a property of the local network, not
of the code; behind a real load balancer see DECISIONS.md.

## More

- [DECISIONS.md](DECISIONS.md): assumptions, what was cut and why, failure policy, next steps
- [AI_USAGE.md](AI_USAGE.md): how AI was used, where it was wrong, time spent
- [openspec/](openspec): the specs and change records the code was built from
- [PR_DESCRIPTION.md](PR_DESCRIPTION.md)
