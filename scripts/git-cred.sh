#!/bin/sh
# Git credential helper for Marionette.
# Serves GITHUB_TOKEN from the environment (or the repo's .env) for github.com.
# Persists nothing: the token never lands in .git/config, the remote URL, or any file.
#
# Install (once per clone):
#   git config credential.helper "$(pwd)/scripts/git-cred.sh"

op="${1:-get}"
[ "$op" = "get" ] || exit 0

proto=""
host=""
while IFS= read -r line; do
  [ -z "$line" ] && break
  case "$line" in
    protocol=*) proto="${line#protocol=}";;
    host=*) host="${line#host=}";;
  esac
done

[ "$host" = "github.com" ] || exit 0
[ -n "$proto" ] || proto=https

TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  ENVF="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/.env"
  if [ -f "$ENVF" ]; then
    TOKEN="$(sed -n 's/^GITHUB_TOKEN=//p' "$ENVF" | head -n1 | tr -d '\r' | tr -d '\"')"
  fi
fi
[ -n "$TOKEN" ] || exit 0

printf 'protocol=%s\nhost=github.com\nusername=marionette-bot\npassword=%s\n' "$proto" "$TOKEN"
exit 0
