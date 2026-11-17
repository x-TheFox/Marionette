# Marionette — architecture

## Components

```
                       ┌─────────────────────────────────────────────────────────┐
                       │                    apps/cli / apps/harness               │
                       │        (headless runs, benchmarks, reports, PGN)         │
                       └───────────────┬─────────────────────────────────────────┘
                                       │
 natural-language directive ──▶ ┌──────▼───────────────────────────┐
                               │        Goal Compiler (LLM)        │  provider service:
                               │  directive + board context        │  kilo → llm7 → nim,
                               │  → PLAN (JSON, Zod-validated,     │  failover + circuit
                               │     retries on malformed output)  │  breaker + cache
                               └──────┬───────────────────────────┘
                                      │ PLAN
 ┌──────────────┐   moves    ┌────────▼────────────────────────────┐
 │  opponent SF │◀──────────▶│          Steering layer              │
 │ (ELO-capped, │            │  per Marionette move:                │
 │  UCI local)  │            │   1. MultiPV top-N from full-        │
 └──────────────┘            │      strength SF (packages/uci)      │
                             │   2. score each candidate:           │
                             │      progress(current milestone)     │
                             │        − λ·(eval loss vs best)       │
                             │        + style_bonus                 │
                             │   3. λ adapts per milestone (tight   │
                             │      when a win must survive, loose  │
                             │      when sacrifice IS the goal)     │
                             │   4. bounded lookahead over the      │
                             │      candidate tree for multi-move   │
                             │      chains (sacrifices, promotions) │
                             └────────┬────────────────────────────┘
                                      │ after each move
                             ┌────────▼────────────────────────────┐
                             │   Predicate engine (packages/core)   │
                             │   fixed DSL over chess.js states;    │
                             │   milestone completion, replanning   │
                             │   triggers, degradation reports      │
                             └────────────────────────────────────┘
```

`apps/server` + `apps/web` wrap the same core for human/spectate modes (Phase 3): WebSocket game rooms, live puppeteer view (current plan, milestone progress, candidate scores, chosen-move rationale, provider that served each call).

## Plan schema (JSON, Zod-validated)

```
Plan
├─ hardConstraints[]        violation predicates; HARD FILTERS while in force
│    ├─ afterMilestone       optional gate: enforced once it completes
│    └─ (omit)               enforced from the FIRST move (schema v2)
├─ milestones[]             ordered; each has:
│    ├─ id, description
│    ├─ completionPredicate (DSL expression)
│    ├─ infeasibilityPredicate (optional; triggers replan)
│    └─ moveBudget (optional soft deadline in plies)
├─ terminalCondition        win | lose | draw | pattern (e.g. mate-by-knight)
├─ styleProfile             looks_strong | aggressive | humiliating | natural | none
├─ fallbackPriority         what to preserve when the plan breaks
└─ replanPolicy             when to re-invoke the LLM with board + progress
```

Hard constraints are candidate filters, never score terms: while a constraint
is in force, any candidate move whose resulting position satisfies its
violation predicate is excluded before scoring. Constraints whose violation
already holds in the current position cannot be un-violated by move choice
and are left to honest tracker reporting instead of filtering (which would
exclude every legal move). The tracker records the first ply where each
in-force violation condition holds.

## Predicate DSL (fixed grammar — the LLM emits expressions, never code)

Operators: `==, !=, <=, >=, &&, ||, !`. Terms (evaluated against a chess.js board + engine analysis):

- `material(side)` / `piece_count(side, type)` / `piece_remaining(side, type)` — e.g. D1's `material(self) == pawns_only`
- `promoted_count(side, type)` — knights promoted so far
- `last_move(type | was_capture | was_check | was_promotion_to(t))`
- `eval_cp` / `eval_mate_in` — engine's view
- `opp_material_deficit`, `mobility_ratio(side)`, `checks_given_total`
- `move_number`, `phase` (opening/middlegame/endgame by piece count)

Every predicate is validated (Zod grammar) AND unit-tested with fixed board fixtures before the game starts; an invalid predicate fails plan compilation → retry → next provider.

## Steering

- Candidates: MultiPV=5 at depth budget (configurable; ~14 default on the 2-core box).
- `score(c) = w_prog · Δprogress(c, milestone) − λ(milestone) · (evalBest − eval(c))/100 + styleBonus(c)`
- `λ` per milestone: derived from whether the terminal condition requires winning (small λ = tolerance for eval loss, e.g. sacrifice phases) or requires parity/losing (large λ caps damage when damage itself is not the goal).
- Lookahead: depth 2–3 plies over top-k candidate sequences (bounded node budget) — needed for knight-promotion chains and multi-move sacrifices; opponent replies sampled from the ELO-capped engine profile.
- Soft constraints: illegal-to-plan sequences (e.g. promoting a pawn that is already blocked forever) surface as infeasibility → replan.

## Replanning and degradation

Triggers: milestone infeasible (predicate or lookahead proof), eval collapse beyond plan tolerance, opponent deviation measure above threshold, move budget exhausted. The final report states per milestone: achieved / failed / skipped + reason.

Two replan backends:

- **LLM replan** (default online): the Goal Compiler revises the plan with full position context (board FEN, progress log, failing predicate); it may rephase, drop milestones (recording why), or declare partial-completion goals.
- **Deterministic replan** (offline / LLM failure): rule-based — drops the failing milestone and constraints gated on it, keeps everything else verbatim, and lists every relaxation in the report. Never invents new goals.

## Offline replay mode

Games can run with zero LLM calls: the initial plan must come from the plan
cache (keyed by directive + schema version), replans are deterministic, and
judging uses the heuristic judge. This is the default for benchmark sweeps so
results never depend on provider quotas. `apps/harness --prepare` populates
the cache (the only LLM-touching step of a sweep).

## Judge (v1, heuristic)

`packages/core/src/game/judge.ts` scores finished games on four axes —
looksTrying, natural, plausibleLoss, bully — from the eval trail
(self-perspective eval after each Marionette move), material/checks snapshots,
ACPL and blunder counts (drops ≥ 300cp). Declared thresholds live in
`JUDGE_THRESHOLDS` and are referenced by the frozen regression bars. An LLM
judge (rubric + PGN) is a planned opt-in refinement for interactive use,
never a sweep dependency.

## Play modes

- **Benchmark**: Marionette vs ELO-capped SF (UCI_Elo for ≥1320; emulated below via Skill Level 0 + depth caps + eval-weighted randomization), N games, metrics + reports.
- **Human**: browser vs server-driven Marionette; directive set pre-game; plan never sent to the client of the opponent.
- **Spectate**: Marionette vs SF with the live puppeteer view.
