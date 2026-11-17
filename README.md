# Marionette — goal-directed Stockfish

Marionette takes **any** natural-language directive for a chess game and steers Stockfish to fulfil it as fully as possible — while still playing to win unless the directive says otherwise.

Example directives (examples, not a closed list — there is **no** per-directive hardcoding anywhere):

- "Win by giving up every piece except pawns, promote all of them to knights, then checkmate with a knight."
- "Give up all your pieces and lose."
- "Make it look like you're trying hard."
- "Force me into winning."
- "Bully me."
- "Win with only a queen and king left."

**Status:** Phase 1 (core engine + CLI) complete, accepted with one caveat: D6 ("win with only a queen and king left") does not fully complete and is kept as a failing regression. Phase 2 (benchmark harness + steering iteration) in progress. See `docs/PROGRESS.md`.

## Quickstart

```bash
git clone https://github.com/x-TheFox/Marionette
cd Marionette
cp .env.example .env    # fill in keys if you have them (every provider degrades gracefully)
./scripts/bootstrap.sh  # engine + deps + skills + git hooks

# compile + cache plans once (the only LLM-touching step):
npm run harness -- --prepare

# play a directive game (offline: cached plan, deterministic replans, no LLM):
npm run cli -- "Win with only a queen and king left." --elo 1350

# benchmark sweep (offline by default — quota-independent):
npm run harness                # quick: 1 game / directive / ELO
npm run harness -- --sweep full   # 5 games per cell
```

Requires: Node.js >= 20, curl, tar, python3. Stockfish is vendored — no system install needed.

## What lives where

```
packages/uci/      UCI client for Stockfish (MultiPV, strength/ELO capping)
packages/core/     plan schema, predicate DSL + evaluator, steering scorer, replanner
apps/cli/          run a directive game headless, with milestone report
apps/harness/      benchmark suite: directives x ELO x N games, metrics, reports
apps/server/       game server (REST + WebSocket), provider service
apps/web/          board UI, puppeteer view, benchmark dashboard
skills/            vendored AI-agent design/animation skills + MANIFEST.md
.agents/skills/    the skill files themselves (committed; restored via skills-lock.json)
assets/            sounds etc., licenses in ASSETS.md
vendor/stockfish/  official Stockfish release tarball (committed) + license + provenance
scripts/           bootstrap, engine vendoring, secret scan, git credential helper
docs/              PLAN, ARCHITECTURE, PROVIDERS, PROGRESS
```

## The rules of this repo

- Secrets live only in `.env` (gitignored; a pre-commit hook scans every commit for token patterns). Keys are never in source, logs, fixtures, or commit messages.
- Stockfish runs **locally via UCI** from `vendor/stockfish/`.
- All LLM output is schema-validated with retries; providers fail over automatically (see `docs/PROVIDERS.md`).
- No hardcoded move scripts per directive. Every example directive above is a regression test.
- Work happens on `dev`; phases land on `main` via PR after results are shown.

## Vendored third-party artifacts

| Artifact | License | Where | Notes |
| --- | --- | --- | --- |
| Stockfish `sf_19` | GPL-3.0 | `vendor/stockfish/` | official release tarball, provenance + checksum in `vendor/stockfish/README.md` |
| Design/animation skills | MIT / Apache-2.0 | `.agents/skills/`, manifest in `skills/MANIFEST.md` | installed via the `skills` CLI, pinned by `skills-lock.json` |
| Sounds | per-file | `assets/` | added in Phase 3; licenses in `assets/ASSETS.md` |

## Docs

- `docs/ARCHITECTURE.md` — components and data flow
- `docs/PLAN.md` — phases, milestones, test spec
- `docs/PROVIDERS.md` — LLM provider chain (verified endpoints, failover, caching)
- `docs/PROGRESS.md` — phase-by-phase log
- `AGENTS.md` — orientation for coding agents working in this repo
