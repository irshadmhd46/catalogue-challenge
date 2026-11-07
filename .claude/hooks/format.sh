#!/usr/bin/env bash
# PostToolUse (Edit|Write): format the touched file with prettier when it is installed.
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.json|*.css) ;;
  *) exit 0 ;;
esac
[ -x node_modules/.bin/prettier ] || exit 0
node_modules/.bin/prettier --write --log-level warn "$file"
