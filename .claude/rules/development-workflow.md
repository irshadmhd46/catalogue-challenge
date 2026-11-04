# Development Workflow

Double loop: **OpenSpec** defines *what* to build (outer loop), **TDD** defines *how* for each
task (inner loop).

```
[Outer loop: OpenSpec]  /opsx:new -> /opsx:ff (or /opsx:continue) -> review artifacts
                              |
                  [Inner loop: TDD per task]  RED -> GREEN -> REFACTOR
                              |
        /opsx:apply -> review gate -> /opsx:archive
```

## Steps

1. **Plan first.** Start a change with `/opsx:new <name>`, generate artifacts with `/opsx:ff`.
   Read the artifacts and fix them before coding. `design.md` records the key decisions.
2. **Implement task by task** from `tasks.md` (`/opsx:apply`). Tick tasks as they complete.
   Task order within a change: service tests before service implementation; for every other layer,
   implementation first and its test immediately after.
3. **Design principles check** before marking a task done (see `design-principles.md`).
4. **Review gate** after each change is applied:
   - run the `code-reviewer` agent, then the `security-reviewer` agent;
   - fix CRITICAL and HIGH findings, fix MEDIUM where cheap;
   - save the report to `.claude/reviews/<change>.md`;
   - add anything the review caught that the building pass got wrong to `AI_USAGE.md`.
5. **Verify**: `npm run typecheck && npm run lint && npm test` all green.
6. **Commit** in logical units (see `git-workflow.md`), then `/opsx:archive`.

## OpenSpec rules

- Read `tasks.md` as the implementation checklist.
- Read `design.md` once at the start of a session; do not re-read it every turn.
- Do not re-derive decisions already captured in `design.md`.

## Bug investigation protocol

Before proposing a fix, find the layer where the bug originates. A fix that only changes the
client when the server returned the wrong response is incomplete.

| # | Question                                                          |
| - | ----------------------------------------------------------------- |
| 1 | What does the server actually return? (status + body)             |
| 2 | What should it return? (status + body shape)                      |
| 3 | Which layer is responsible? (web/api client, route, service, adapter) |
| 4 | Does it behave differently in the normal and the failure scenario?|

Write the failing test at the origin layer first, then fix.
