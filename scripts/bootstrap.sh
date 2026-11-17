#!/usr/bin/env bash
# Marionette bootstrap — one command after a fresh clone.
# Restores everything that is not in git: the extracted engine binary, npm deps,
# vendored skills (if the .agents/ dir was excluded), and the git pre-commit hook.
# The only thing you must provide manually: keys in .env (if you have any).
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

echo "[bootstrap] 1/6 checking node"
command -v node >/dev/null 2>&1 || { echo "Node.js (>= 20) is required"; exit 1; }
node -v

echo "[bootstrap] 2/6 .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  created .env from template — add keys if you have them (all optional)"
else
  echo "  .env present"
fi

echo "[bootstrap] 3/6 engine"
if printf 'uci\nquit\n' | ./vendor/stockfish/stockfish 2>/dev/null | grep -q 'id name Stockfish'; then
  printf 'uci\nquit\n' | ./vendor/stockfish/stockfish | grep 'id name'
else
  ./scripts/vendor-stockfish.sh
fi

echo "[bootstrap] 4/6 npm dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "[bootstrap] 5/6 vendored skills"
if [ ! -f .agents/skills/animate/SKILL.md ]; then
  npx -y skills experimental_install || echo "  (skills restore failed — UI-phase skill guidance unavailable; code still runs)"
else
  echo "  .agents/skills present"
fi

echo "[bootstrap] 6/6 git hooks"
if [ -d .git ]; then
  cp scripts/secret-scan.sh .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  git config credential.helper "$(pwd)/scripts/git-cred.sh"
  echo "  pre-commit secret scan installed; credential helper reads GITHUB_TOKEN from env/.env"
fi

echo "[bootstrap] done."
