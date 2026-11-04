# CLAUDE.md

## Mission

Product catalogue proof of concept that is built as a foundation, not a throwaway: home (featured
products), category pages, search, product detail, and an enquiry form that emails a sales inbox.
The product data source, look and feel, and email provider are all expected to change, so they sit
behind clear boundaries.

## Stack

- API: Node.js 20, TypeScript, Fastify, zod, pino, nodemailer, Vitest (`apps/api`)
- Web: React, TypeScript, Vite, TanStack Query, React Router, Vitest + Testing Library (`apps/web`)
- Shared API contract: zod schemas and types (`packages/contracts`)
- Runtime: Podman (or Docker) with `compose.yaml`; AWS-compatible images
- Optional Redis (cache + rate-limit store) behind the compose profile `redis`

## Architecture rules (do not break)

1. The web app only talks to our API. It never calls the Fake Store API.
2. The upstream (Fake Store) shape stops at its adapter. The API returns our own `/api/v1` contract.
3. Ports in `domain/` (`ProductSource`, `EnquiryNotifier`, `Cache`, `Logger`); adapters in
   `infrastructure/`; services in `application/` receive ports by constructor. Adapters are created
   only in `main.ts` (composition root).
4. Only `http/error-handler.ts` turns errors into HTTP responses. Typed `AppError`s everywhere else.
5. Environment is read only in `config/`, validated by zod, fail fast.
6. No secrets in the repo. Only `.env.example` is committed.
7. No work-related or employer-related names, hosts, paths or ticket keys anywhere in this repo.

## Workflow

OpenSpec for planning, TDD for implementation. Details: `.claude/rules/development-workflow.md`.

```
/opsx:new <name>      start a change
/opsx:ff              generate proposal, specs, design, tasks
/opsx:apply           implement tasks (tests first for services)
/opsx:archive         archive when done
```

Changes in order: `api-foundations`, `catalogue-api`, `product-enquiry`, `web-storefront`.
Read `tasks.md` as the checklist; read `design.md` once per session.

After each change: run the `code-reviewer` then `security-reviewer` agents, save the reports in
`.claude/reviews/`, and note anything the AI got wrong in `AI_USAGE.md`.

## Rules (loaded at session start by `.claude/settings.json`)

- `.claude/rules/development-workflow.md`
- `.claude/rules/git-workflow.md`
- `.claude/rules/design-principles.md`
- `.claude/rules/security.md`
- `.claude/rules/logging-and-errors.md`
- `.claude/rules/testing.md`

## Commands

```bash
npm run typecheck && npm run lint && npm test     # must be green before any commit
npm run test:coverage
podman compose up --build                          # full stack (docker compose also works)
podman compose --profile redis up --build          # with Redis
```

## Git policy

Never add a remote and never push from this machine. Commit locally in small conventional commits
(see `git-workflow.md`). The owner pushes from another machine.
