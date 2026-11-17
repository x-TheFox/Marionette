# Phase 3/4 feature-ideation proposal

Beyond the original Phase 4 list (directive history/presets/share links,
subtlety slider, post-game analysis with plan-overlaid eval graph, annotated
PGN export, feasibility checker, multi-directive chaining, opponent
personalities). Ranked by impact ÷ effort; the build order is a proposal —
nothing here is committed until you pick.

Impact = how much it advances the product's core promise ("watch a chess
engine obey you") or its reach. Effort includes backend + UI + test burden in
this codebase. Ratings are honest estimates, not promises.

## Tier 1 — high value, low effort (build first)

### F1. Feasibility-aware opponent matching ("just hard enough")
- **What:** pick the opponent ELO automatically so any directive completes at
  a target rate (~60%). Per-directive calibration curves come straight from
  sweep data we already generate; interpolation + a "why this level" tooltip.
- **Impact: high** — makes every directive playable without trial and error;
  turns the benchmark infrastructure into a user-facing feature.
- **Effort: low** — a lookup/interpolation over `bench/summary` data + a
  selector in the new-game form. No engine changes.
- **Note:** this is the feasibility checker (original list) inverted into a
  matchmaking knob; building it makes the original item obsolete.

### F2. Seeded replay share links
- **What:** every game gets a deterministic seed + directive id; a share URL
  (`/replay?d=...&seed=...&elo=...`) reproduces the exact game client-side,
  with the plan panel and sounds, without a backend game store.
- **Impact: medium-high** — zero-friction sharing is the cheapest virality
  this project can get; demos become links, not videos.
- **Effort: low** — the runner is already seeded and deterministic offline;
  needs a route + serialized plan + move list (all already in reports).

## Tier 2 — high value, medium effort

### F3. Director's commentary replay
- **What:** after a game, a narrated timeline: each significant move gets one
  sentence tying it to the plan ("Nxf7: begins shedding the last non-pawn
  material — milestone 1 at 62%"), generated from milestone events, replan
  reasons, λ trail and eval deltas already recorded in every report.
- **Impact: high** — the "why is it doing that" moment is the product's magic;
  this makes it legible to non-engine people. Rule-based v1 (zero LLM) is
  possible from existing trails; an LLM polish pass can come later.
- **Effort: medium** — commentary generator over report data + replay UI
  surface. The chess-analysis skill (vendored) has directly reusable
  annotated-PGN patterns.

### F4. Time-travel scrubber with milestone timeline
- **What:** a scrubber under the board; dragging shows the position, eval
  graph position, active milestone and completion percentages at that ply.
  Milestone completions render as markers on the eval graph.
- **Impact: medium-high** — turns a finished game into an explorable artifact;
  the data (snapshots, evalTrail, milestone plies) already exists per game.
- **Effort: medium** — pure UI: board time-travel + a synced chart; no
  backend work.

### F5. "Explain this move" deep compare (puppeteer view, level 2)
- **What:** the Phase 3 puppeteer view shows the chosen move's score; this
  adds "compare with the engine's natural move": what the engine would have
  played, what it cost in eval, what it bought in milestone progress — the
  actual steering tradeoff as a two-card diff.
- **Impact: medium-high** — the single best answer to "is it really trying to
  obey, or just winning?".
- **Effort: medium** — needs the steering layer to emit the rejected best
  candidate alongside the chosen one (small runner change) + a diff card UI.

## Tier 3 — flagship features, bigger builds

### F6. Directive Duel ("guess my directive")
- **What:** social/party mode: Marionette plays a hidden directive; one or
  more humans watch and guess; scoring by how early the guess lands
  (confidence per move). Works hotseat or share-link.
- **Impact: high** — the most shareable expression of the product; every game
  becomes a puzzle about reading intent.
- **Effort: high** — lobby/guess UI, a fairness review of what's revealed
  (plan must stay hidden), scoring model. No engine changes.

### F7. Human directive challenge ("you make it happen")
- **What:** flip the roles — the human plays the side and must fulfil the
  directive; Marionette scores your milestone progress vs its own steering
  and coaches after the game ("you kept the rook — the plan needed it gone").
- **Impact: high** — turns Marionette into a trainer with a completely unique
  exercise type; deep engagement.
- **Effort: high** — human mode (Phase 3 scope) + progress scoring UI + the
  post-game coach narrative; the predicate engine is already reusable.

### F8. Mid-game directive amendment with plan diff
- **What:** during a live game, change or extend the directive ("okay, now
  win with only knights"); Marionette replans and the UI shows a plan diff
  (dropped/added milestones, constraint changes) before applying.
- **Impact: medium-high** — drama and the strongest demonstration of the
  replan machinery; also the natural evolution of the original chaining item.
- **Effort: high** — live replan UX, plan-diff rendering, replan confirmation
  flow; the replan engine itself already exists.

## Not proposed (and why)

- **Voice directive input** — thin wrapper over Web Speech API; nice demo,
  low substance. Reconsider post-launch.
- **Weekly challenge ladder / accounts** — needs a persistence layer and
  curation; premature before there are users.
- **More LLM in the judge** — the heuristic judge is quota-independent; an
  LLM judge is already an opt-in refinement in the plan, not a new feature.

## Recommended build order (if you take my ranking)

1. **F1** (matchmaking) and **F2** (share links) — cheap, compound with
   everything else.
2. **F4** (scrubber) then **F3** (commentary) — they share the replay
   surface; build the scrubber first, commentary drops onto it.
3. **F5** — completes the puppeteer view story.
4. Then pick ONE flagship: **F6** for reach, **F7** for depth, **F8** for
   drama.
