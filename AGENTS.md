# AGENTS.md — orientation for coding agents

Marionette steers Stockfish towards arbitrary natural-language game directives (see README). This file orients any agent (or human) picking the repo up cold, and is kept deliberately short — details live in `docs/`.

## Ground rules (hard)

1. **Secrets:** only in `.env`. Never commit them; the pre-commit hook (`scripts/secret-scan.sh`) refuses token patterns — do not bypass it. Never put keys in source, logs, test fixtures, or commit messages.
2. **Git:** work on `dev`. Conventional Commits (`feat(steering): ...`), many small commits, body explains what/why/how-tested. Never force-push `main`. Phases merge to `main` via PR only after results are shown.
3. **Engine:** Stockfish runs locally via UCI (`vendor/stockfish/stockfish`, spawned by `packages/uci`). Never shell out to cloud engines. Never hardcode per-directive move scripts — directives are data.
4. **LLM output:** always schema-validated (Zod) with retries; provider failover is central, never assume one provider works.
5. **This sandbox has 2 cores / 4 GB RAM:** one engine = 1 thread; harness concurrency ≤ 2; keep test depth budgets modest (`quick` vs `full` sweep modes).

## Environment quirks (verified 2026-11-17)

- `api.github.com` is rate-limited/403 anonymously from the sandbox — always pass `GITHUB_TOKEN` (from `.env`) as a Bearer header.
- Stockfish's GitHub home is `official-stockfish/Stockfish` (renamed; the old `officialstockfish/stockfish` path 404s).
- NVIDIA NIM chat completions time out from this sandbox (>120 s) although `/models` works — keep it last in the provider chain with a short timeout and let the circuit breaker handle it.
- LLM7.io free tier has a per-IP daily quota that can be exhausted; it recovers on its own.

## Restoring state after an environment reset

The repo is the source of truth. After a fresh clone:

```bash
cp .env.example .env   # re-add keys (they are the ONLY thing not in git)
./scripts/bootstrap.sh
```

Bootstrap re-extracts the Stockfish binary from the committed tarball (downloads only if the tarball is missing), installs npm deps, restores vendored skills from `skills-lock.json`, and installs the pre-commit hook.

## Vendored skills (for UI work)

`.agents/skills/` holds the design/animation skills (manifest: `skills/MANIFEST.md`). When building UI (Phase 3+), read `emil-design-eng`, `animate`, and `frontend-design` SKILL.md first, and `design-taste-frontend` for the overall aesthetic bar. Restore with `npx -y skills experimental_install` if the directory is ever missing.

## Phase status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | bootstrap: hygiene, vendoring, docs, provider verification | done |
| 1 | UCI wrapper, predicate DSL + evaluator, plan schema + compiler, steering, CLI | next |
| 2 | benchmark harness + iteration to thresholds | planned |
| 3 | web UI, human + spectate modes, sound | planned |
| 4 | extras: presets/share links, subtlety slider, feasibility checker, chaining | planned |

Update this table and `docs/PROGRESS.md` at the end of every phase.
