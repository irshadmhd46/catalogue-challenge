#!/usr/bin/env bash
# Stop: remind to run the review gate when source files changed in this session.
if { git diff --name-only; git diff --cached --name-only; } | grep -qE '\.(ts|tsx)$'; then
  echo '{"systemMessage":"TypeScript files changed. Run the code-reviewer and security-reviewer agents (review gate) and save the report to .claude/reviews/ before finishing."}'
fi
