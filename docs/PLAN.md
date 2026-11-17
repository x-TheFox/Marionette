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
- `apps/harness`: directives × opponent ELO {800, 1200, 1600, 2000} × N games (quick sweep = 3 games/cell so rates mean something; full sweep = 5 for the regression gate; `--games n` overrides). Per-run metrics: milestone completion %, terminal condition Y/N, moves taken, ACPL, judge score.
- **Ordered vs final-position truth (reported separately):** "Ordered" = milestones completed in plan order during play (tracker verdict). "FinalPos" = milestone predicates that hold in the final position (facts, including milestones a replan dropped and transient facts the ordered tracker legitimately recorded earlier). The frozen bars are evaluated on **Ordered** semantics only; final-position truth is shown next to it for honest context, never counted toward bars.
- Judge v1 is heuristic (looksTrying / natural / plausibleLoss / bully over eval+material trails, declared thresholds in `JUDGE_THRESHOLDS`) — zero LLM calls, so sweeps are quota-independent. An LLM judge with rubric remains an opt-in refinement.
- **Offline replay mode**: sweeps run with cached plans + deterministic (rule-based) replans + heuristic judge — no provider dependency. `--prepare` compiles and caches plans once. The plan store lives in `plans/v<schema>/` and is **committed to git** (human-readable slugs, one JSON per directive): a fresh clone can run offline sweeps without any LLM quota. Replans are never cached (position-dependent).
- Success thresholds are **frozen** (table below); the harness reports actual rates and never tunes bars. Results tables live in `bench/summary/` (committed); raw per-game artifacts in `bench/raw/` (gitignored). A few showcase games are committed under `games/`.
- **D6 status: known failing regression.** Phase 1 closed with D6 reaching only partial completion on `reduce_to_kq`; its bar stays in the spec as expected-fail and must never be reported as passed until steering achieves it.
- **Steering semantics (iteration #2, 2026-11-17):** progress is the guarded MEAN of the active milestone's top-level conjunct credits minus 0.5 per satisfied conjunct a candidate line would break (exact-count guards — e.g. `piece_count(self,queen) == 1`), blended over two reply models: the engine's expected best-defense reply (0.55) and a deterministic greedy-capture reply (0.35) mirroring weak opponents. λ comes from the milestone tolerance, capped at loose for shedding milestones, with the behind-raise reserved for terminal steering. Stall detection requires both the min and the conjunct mean frozen, anchored to the milestone's activation ply; the move budget forces a replan only when progress has also stopped. A stall-protected milestone keeps steering (tri-state replan; never falls to the fallback ladder for being protected). Would-be threefold repetitions are scored as premature ends via runner-provided repetition keys. The ordered tracker's reported fields (bestPartial etc.) remain min-based facts — only the steering gradient changed.
- **Ordered-column semantics by directive:** D1/D4/D6 milestones are meant to complete in order and their bars measure ordered completion; D3 is terminal-first (bars are style-only; Ordered is informational); D2/D5 are milestones-first but their bars are result/style-only (Ordered informational). D2 caveat on record: its bars can pass by losing without executing the shed — flagged, to be re-measured after the steering changes.
- **Goal Compiler prompt semantics (iteration #3, 2026-11-17):** the prompt was fixed at the RULE level (never per-plan): (a) quantifiers bind over SURVIVING pieces — "all of X" is expressed over current counts (`piece_count(self,pawn) == 0 && promoted_count(self,knight) >= 1`), never the fixed starting count, so opponent-forced losses cannot make a milestone un-completable; (b) `infeasible` predicates fire only on REAL impossibility (required material can no longer legally come into existence, or the game already ended contrary to the milestone) — setbacks like losing a kept piece must never be encoded as infeasible, and when no realistic dead end exists the clause is omitted; (c) budgets scale with the material to be shed (~12 plies per own unit for shedding with a floor of 80, ~10 plies per promoting pawn + 30, ~8 plies per demanded capture/check); (d) hard constraints must describe Marionette's own actions, not states the opponent can force (keep-my-material goals become milestone predicates over surviving counts instead). D1 and D6 were recompiled through the LLM chain only — no hand-edited plans.
- Iterate on steering until thresholds are met at reasonable rates.
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
| D6 | win with only Q+K left | win | material == {Q, K}; mate with Q | ≥ 40% vs ≤1600 — **KNOWN FAILING (expected-fail, kept visible)** |

These bars are frozen in `apps/harness/src/spec.ts` (with v1 operationalizations: D2 plausible = judge axis ≥ 0.6; D3 ACPL band = mean ≤ 100; D5 bully = judge axis ≥ 0.5). The harness reports actual rates against them; passing/failing is computed, never adjusted. `full_completion` = all milestones completed **in order** during play AND terminal met (final-position truth alone does not count).

Metrics per game: milestone completion % (ordered and final-position, reported separately), terminal condition Y/N, moves, ACPL, judge/heuristic style score. Quick sweep = 3 games/directive/ELO (dev iteration); full sweep = 5 (regression gate).

## Budget notes (2-core sandbox)

- 1 engine thread per instance; ≤ 2 concurrent games; steering analysis at MultiPV ≤ 5, depth budget ~12–18; opponent depth capped by emulated level.
- LLM calls: plan store committed under `plans/v<schema>/` (keyed by directive + schema version) — fresh clones and benchmark re-runs need zero compiler calls; replans budgeted (≤ 2/game default, deterministic in offline mode); judge is heuristic (0 LLM calls).
