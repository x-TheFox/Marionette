# Progress log

## Phase 0 — bootstrap — COMPLETE (2026-11-17)

Goal: repo is the source of truth; survives sandbox resets; secrets hygiene before any code.

- **Secrets hygiene (before first commit):** `.gitignore` (env, node_modules, caches, extracted engine binary, agent symlink dirs), `.env.example` (names only), `scripts/secret-scan.sh` installed as pre-commit hook. Tested: a staged fake `ghp_…` token was refused (exit 1); `git check-ignore .env` confirms `.env` is ignored. `scripts/git-cred.sh` serves `GITHUB_TOKEN` from env/`.env` at push time only — nothing persisted in `.git/config` or the remote URL.
- **Engine vendored:** official Stockfish 19 (`sf_19`, universal x86-64, sha256 `9defc0d4…3611f`) committed as tarball + GPL-3.0 text + provenance README. `uci` handshake and search verified on this box. `UCI_Elo` floor is **1320** → sub-floor opponents (800/1200) will be emulated (documented in PLAN).
- **Skills vendored:** 8 design/animation skills installed via the `skills` CLI into `.agents/skills/` (copied, not symlinked), pinned by `skills-lock.json`, documented in `skills/MANIFEST.md`. Sources: Anthropic (`frontend-design`), Vercel Labs (`web-design-guidelines`), Emil Kowalski (`emil-design-eng`, `animate`, `animate-expo`, `find-animation-opportunities`), Paul Bakaus (`impeccable`), leonxlnx (`design-taste-frontend`). `.zcode/` duplicate dir gitignored.
- **Providers verified live** (see `docs/PROVIDERS.md`): Kilo gateway anonymous free tier works (`kilo-auto/free` → routed to `nvidia/nemotron-3.5-super-vl:free`; reasoning-model caveat: budget tokens, parse `content`); LLM7.io keyless works but its per-IP daily quota was exhausted at probe time (self-recovers); NVIDIA NIM `/models` works with the key but chat completions time out from this sandbox (kept last in chain with short timeout + circuit breaker).
- **Docs:** README, AGENTS.md (agent orientation + ground rules), PLAN (phases + test spec v1 with pre-declared success bars), ARCHITECTURE (components, plan schema, predicate DSL sketch, steering formula), PROVIDERS.
- **Git:** work on `dev`; bootstrap commit also seeded `main`; subsequent phases land via PR after results are shown.

## Phase 1 — core engine + CLI — COMPLETE (2026-11-17), ACCEPTED WITH ONE CAVEAT

Goal: `packages/uci` + `packages/core` + `apps/cli`; two showcase directives end-to-end vs ELO-capped Stockfish with honest milestone reports.

**Acceptance caveat (user review):** D6 ("win with only a queen and king left") does not fully complete — `reduce_to_kq` reaches only partial credit. D6 is kept as a **failing regression** (expected-fail in the Phase 2 spec, visible in every results table) and must not be marked passed until steering achieves it.

- **UCI client** (`packages/uci`): serialized-command engine wrapper, MultiPV analysis parsing (mate/cp, side-to-move perspective), and strength control: native `UCI_Elo` >= 1320; below the floor opponents are EMULATED (Skill Level map + depth cap + softmax-over-eval move choice, seeded mulberry32) and labeled as emulated in every report.
- **Predicate DSL** (`core/dsl`): lexer/parser/typed evaluator for the fixed 26-function vocabulary (material, piece counts, promotions, captured_value, checks, castling, terminal state, eval/mate, mated_by...); static validation rejects unknown functions/type mismatches; gradient values + partial credit drive steering. Partial credit uses fuzzy min/max semantics over AND/OR (D6 lesson: max-semantics let a satisfied sub-atom fake 100% progress).
- **Plan schema + Goal Compiler** (`core/plan`, `core/compiler`): Zod-validated plans (style, terminal, ordered milestones with tolerance/weight/moveBudget/infeasible, hard constraints with afterMilestone enforcement windows, fallback ladder); LLM compiles directives through the provider chain with validate-retry; plans cached by (directive hash, model, schema version); replans send an honest ProgressReport and are never cached.
- **Steering** (`core/steering`): candidates = engine MultiPV top-5 + motivated extras generated from the active milestone's gradient atoms (captures, checks, promotions incl. underpromotion, hanging offers via SEE-lite, mate-in-1 scans, castle moves); score = wProg*deltaProgress − λ*evalLoss + style/terminal bonus; λ from tolerance (loose 0.12 / medium 0.6 / tight 2.4), adapted by terminal kind and score; PV-reply lookahead blends expected-reply progress; enforced constraints are a hard filter; premature game-ends (early mates, stalemates, draws) while milestones remain are penalized; terminal bonus only when terminal-first or all milestones done.
- **Tracker + runner** (`core/game`): post-ply predicate pass on every move; ordered completion, partial credit, infeasibility, budgets, stall detection; replans on stall/budget/infeasible with fallback ladder if replanning fails; ACPL over steered moves; PGN + markdown + JSON reports with honest incomplete-milestone notes.
- **CLI** (`apps/cli`): `tsx apps/cli/src/main.ts "<directive>" [--elo --color --steer-depth --multipv --opp-depth --max-plies --max-replans --seed --no-cache --out --quiet]`, live event stream (λ per move), writes PGN/report under `games/`.
- **Showcase runs (all honest, PGNs in `games/`)**:
  - D2 "Give up all your pieces and lose." vs native 1350: **0-1 checkmate, terminal MET, both milestones completed** (material(self)==0 at ply 152, mated at ply 156). One replan attempt failed (provider outage) -> fallback `secure_terminal` honestly noted.
  - D6 "Win with only a queen and king left." vs native 1350/1600 and emulated 1100: wins (terminal MET) with reduce_to_kq reaching 40-70% partial; replan machinery exercised (stall -> infeasible -> revised plan) and incompleteness reported honestly. Exact-target completion rates are Phase 2 tuning scope (declared in PLAN).
- **Provider chain**: groq (first when GROQ_API_KEY set; edge-blocked 403 from this sandbox - documented in PROVIDERS.md), kilo anonymous (reasoning model: 16k token budget now default after `finish=length` truncations), llm7 (daily quota respected), nim (last). Replan failures surface the full attempt chain in report notes.
- **Tests**: 47 unit tests green (dsl 12, tracker 7, steering 16, llm chain 8, uci live 4) + live e2e games.

## Phase 2 — benchmark harness + steering iteration — IN PROGRESS (2026-11-17)

Review requirements from the user (all addressed):
1. Hard plan constraints enforced as candidate filters, not only score terms — done (schema v2: un-gated constraints filter from the first move; already-violated ones skip filtering and are reported by the tracker).
2. No-LLM replay mode — done (`--offline`: cached plans + deterministic rule-based replan + heuristic judge; sweeps default to it, `--prepare` is the only LLM step).
3. Pre-declared success thresholds stay fixed; actual rates reported — done (bars frozen as data in `apps/harness/src/spec.ts`; D6 marked expected-fail, rendered "FAIL (expected)", never passed).
4. All commits and docs in English — done.
5. Vendored Stockfish and skills untouched; raw benchmark output gitignored (`bench/raw/`), only `bench/summary/` tables and a few showcase games (`games/`) committed — done.

Work log:
- `feat(core)`: constraint filter semantics + schema v2; compiler prompt gains the pronoun rule (directives are spoken by the human: "me/my" = opp, "you/your" = self — D4/D5 compile correctly now).
- `feat(core,cli)`: offline mode — plan cache keyed by (directive, schemaVersion), `PlanCacheMissError`, deterministic replan (drop failing milestone + gated constraints, honest change notes), runner `replanMode`, eval/material trails in reports, judge v1 heuristics, CLI `--offline`.
- `feat(harness)`: sweep app (quick/full, resume support, deterministic seeds, per-game raw artifacts under `bench/raw/`, aggregated markdown+JSON summaries under `bench/summary/`, frozen bars with expected-fail for D6, `--check` gate).
- All 6 directives compiled and cached under schema v2 via kilo (D1 44s, D2 25s, D3 13s, D4 29s, D5 36s, D6 15s); plans reviewed in the prepare output.
- Test suite: 65 green (12 new for constraints, deterministic replan, judge, offline compile).

Next: quick sweep results (see `bench/summary/`), then steering iteration toward the frozen bars; D6 remains the known failing regression.


