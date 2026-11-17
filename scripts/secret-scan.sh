#!/bin/sh
# Marionette pre-commit secret scan.
# Blocks any commit that stages .env or whose staged diff contains secret-like patterns.
# Installed as .git/hooks/pre-commit by scripts/bootstrap.sh (and manually at repo init).

if git diff --cached --name-only | grep -qx '.env'; then
  echo "REFUSED: .env is staged. Unstage it: git restore --staged .env" >&2
  exit 1
fi

PATTERN='nvapi-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}'

if git diff --cached | grep -nE "$PATTERN"; then
  echo "REFUSED: secret-like string detected in staged changes. Remove it and retry." >&2
  exit 1
fi

exit 0
