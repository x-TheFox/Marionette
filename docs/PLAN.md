# Marionette — plan and test spec

## Phases

### Phase 0 — bootstrap (done, 2026-11-17)
- Secrets hygiene before any code: `.gitignore` + `.env.example` + pre-commit secret scan (tested: refuses staged fake tokens).
- Vendored official Stockfish `sf_19` (universal build) into `vendor/stockfish/` with license + provenance.
- Vendored 8 design/animation skills into `.agents/skills/` with manifest + lockfile.
- Verified the LLM provider chain live (see PROVIDERS.md).
- Docs skeleton, bootstrap script, agent guide.

### Phase 1 — core engine + CLI
Deliverables:
- `packages/uci`: UCI client — spawn engine, `uci/ucinewgame/isready/position/go`, MultiPV, `UCI_LimitStrength`/`UCI_Elo`/`Skill Level`, ponder off, deterministic hash/threads.
- `packages/core`:
  - Plan JSON schema (Zod): hard constraints, ordered milestones with completion predicates, terminal condition, style profile, fallback priority.
  - Predicate DSL (fixed grammar, no arbitrary code) + evaluator over chess.js board states.
  - Steering: per move, take top-N MultiPV candidates, score `progress(current milestone) − λ·(eval loss vs best) + style_bonus`; λ adaptive per milestone (tight when a win must be preserved, loose when sacrifice is the goal); bounded lookahead over the candidate tree for multi-move sacrifice/promotion chains.
  - Replanning triggers (infeasible milestone, eval collapse, position drift, phase timeout) and honest partial-completion reporting.
- `apps/cli`: `marionette play --directive "..." --opponent-elo 1600 --games 1` → move log, milestone report, PGN.
Done when: two showcase directives run end-to-end headless against ELO-capped Stockfish and produce honest milestone reports.

### Phase 2 — benchmark harness + iteration
- `apps/harness`: directives × opponent ELO {800, 1200, 1600, 2000} × N games; per-run metrics: milestone completion %, terminal condition Y/N, moves taken, ACPL, subjective judge score (LLM judge with rubric + heuristic fallback).
- Results table (per directive × ELO) + per-game report; regression spec for every example directive.
- Iterate on steering until thresholds (below) are met at reasonable rates.
- Note: Stockfish `UCI_Elo` range is 1320–3190 (verified against the vendored sf_19). Sub-floor opponents (800, 1200) are emulated: `Skill Level 0` + depth caps + eval-weighted move randomization. The harness labels emulated levels honestly in reports.

### Phase 3 — web UI + human mode
- `apps/web` + `apps/server`: animated board (move/capture/promotion/check), plan + milestone progress panel ("puppeteer view": current plan, candidate scores, why this move), eval bar, move list, mobile-responsive.
- Human mode (directive set pre-game, opponent never sees the plan), spectate mode.
- Sound design (mutable, volume control) with per-file licenses in `assets/ASSETS.md`.

### Phase 4 — extras (propose → build the best)
Directive history + presets + shareable links; subtlety slider; post-game analysis with plan overlaid on eval graph; annotated PGN export; feasibility checker ("likely impossible vs 2000+"); multi-directive chaining + mid-game changes; opponent personalities (toggleable).

## Test spec (v1 — thresholds finalized/validated in Phase 2)

Success is defined **before** runs:

| # | Directive | Terminal target | Key milestones | Initial success bar (to validate in P2) |
| --- | --- | --- | --- | --- |
| D1 | pawns-only + knight promotions + mate with knight | win | material == pawns; all pawns → knights; mate by knight | ≥ 30% full completion vs ≤1600; ≥ 80% "pawns+promotions" partial |
| D2 | give up everything and lose | loss | all non-king pieces gone; terminal loss | ≥ 70% losses vs all ELOs; game looks plausible (judge) |
| D3 | look like trying hard | any (prefer win/draw) | eval-defensible moves, low blunder count | judge "looks like trying" ≥ 75%; ACPL within band of honest engine at same ELO |
| D4 | force opponent to win naturally | opponent wins | opponent advantage grows by Marionette's "soft" moves only | opponent wins ≥ 70%; judge "natural" ≥ 70% |
| D5 | bully | win | material won early; opponent harassed (tempo/captures); toying phase | ≥ 60% wins vs ≤1600; bully-style heuristic score ≥ threshold |
| D6 | win with only Q+K left | win | material == {Q, K}; mate with Q | ≥ 40% vs ≤1600 |

Metrics per game: milestone completion %, terminal condition Y/N, moves, ACPL, judge/heuristic style score. Quick sweep = 1 game/directive/ELO (dev iteration); full sweep = 5 (regression gate).

## Budget notes (2-core sandbox)

- 1 engine thread per instance; ≤ 2 concurrent games; steering analysis at MultiPV ≤ 5, depth budget ~12–18; opponent depth capped by emulated level.
- LLM calls: plan cache keyed (directive hash, model, schema version) — benchmarks re-run without compiler calls; replans budgeted (≤ 2/game default); judge 1 call/game.
