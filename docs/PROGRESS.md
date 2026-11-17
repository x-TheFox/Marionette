# Progress log

## Phase 0 — bootstrap — COMPLETE (2026-11-17)

Goal: repo is the source of truth; survives sandbox resets; secrets hygiene before any code.

- **Secrets hygiene (before first commit):** `.gitignore` (env, node_modules, caches, extracted engine binary, agent symlink dirs), `.env.example` (names only), `scripts/secret-scan.sh` installed as pre-commit hook. Tested: a staged fake `ghp_…` token was refused (exit 1); `git check-ignore .env` confirms `.env` is ignored. `scripts/git-cred.sh` serves `GITHUB_TOKEN` from env/`.env` at push time only — nothing persisted in `.git/config` or the remote URL.
- **Engine vendored:** official Stockfish 19 (`sf_19`, universal x86-64, sha256 `9defc0d4…3611f`) committed as tarball + GPL-3.0 text + provenance README. `uci` handshake and search verified on this box. `UCI_Elo` floor is **1320** → sub-floor opponents (800/1200) will be emulated (documented in PLAN).
- **Skills vendored:** 8 design/animation skills installed via the `skills` CLI into `.agents/skills/` (copied, not symlinked), pinned by `skills-lock.json`, documented in `skills/MANIFEST.md`. Sources: Anthropic (`frontend-design`), Vercel Labs (`web-design-guidelines`), Emil Kowalski (`emil-design-eng`, `animate`, `animate-expo`, `find-animation-opportunities`), Paul Bakaus (`impeccable`), leonxlnx (`design-taste-frontend`). `.zcode/` duplicate dir gitignored.
- **Providers verified live** (see `docs/PROVIDERS.md`): Kilo gateway anonymous free tier works (`kilo-auto/free` → routed to `nvidia/nemotron-3.5-super-vl:free`; reasoning-model caveat: budget tokens, parse `content`); LLM7.io keyless works but its per-IP daily quota was exhausted at probe time (self-recovers); NVIDIA NIM `/models` works with the key but chat completions time out from this sandbox (kept last in chain with short timeout + circuit breaker).
- **Docs:** README, AGENTS.md (agent orientation + ground rules), PLAN (phases + test spec v1 with pre-declared success bars), ARCHITECTURE (components, plan schema, predicate DSL sketch, steering formula), PROVIDERS.
- **Git:** work on `dev`; bootstrap commit also seeded `main`; subsequent phases land via PR after results are shown.

## Phase 1 — core engine + CLI — NEXT

Scope in `docs/PLAN.md`: `packages/uci` (UCI client), `packages/core` (plan schema, predicate DSL + evaluator, steering, replanning), `apps/cli` (headless directive game + milestone report + PGN). Done when two showcase directives run end-to-end vs ELO-capped Stockfish with honest milestone reports.
