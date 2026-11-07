# Git Workflow

## Commit messages

```
<type>(<scope>): <description>

<optional body explaining why>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
Scopes: `api`, `web`, `contracts`, `infra`, `openspec`, `claude`, `docs`.

Examples:

```
feat(api): add Fake Store product source with timeout and retry
fix(api): strip CR/LF from enquiry subject to prevent header injection
test(web): cover enquiry form 429 and network-error states
```

## Rules

- One logical change per commit. Tests go with the code they cover or in the next commit.
- Run `git status` and review the diff before every commit. Never commit `.env*` (only
  `.env.example`), build output, or `node_modules`.
- Prefer new commits over amending. Never rewrite history that has been shared.
- Branches: work on `feature/catalogue-poc`; `main` holds the initial scaffold.

## Hosting policy for this repo

- **Never add a remote and never push from this machine.** Commits stay local.
- Hand-off is by `git bundle create ../catalogue-challenge.bundle --all` and is done by the owner.
- The PR text lives in `PR_DESCRIPTION.md` so it can be pasted from another machine.
