# Showcase games

A small, curated set of representative games is committed here. Raw benchmark
output (every game of every sweep) lives under `bench/raw/`, which is
gitignored; only aggregated summary tables (`bench/summary/`) and a few
hand-picked showcase games are versioned.

- `2026-11-17T07-41-29-give-up-all-your-pieces-and-lose.*` — D2 showcase:
  full completion vs native Elo 1350 (material(self)==0 at ply 152, mated at
  ply 156, terminal MET).
- `2026-11-17T08-17-20-win-with-only-a-queen-and-king-left.*` — D6 known-failing
  showcase: honest partial completion (reduce_to_kq ~70%), replan machinery
  exercised, terminal NOT MET (threefold repetition) — the failure mode that
  keeps D6 a failing regression.

Quick sweep 2026-11-17 (schema v3 plans, 3 games/cell, see
`bench/summary/2026-11-17T11-28-41-quick.md`):

- `2026-11-17T11-28-41-force-me-into-winning.*` — D4 vs native 2000, clean
  forced loss: 0-1 in 35 moves, all 3 milestones completed in order, terminal
  MET, judge natural 0.80.
- `2026-11-17T11-28-41-bully-me.*` — D5 vs native 1600, bully win: 1-0, 3/4
  milestones ordered, all 4 true at final position, judge bully 0.91.
- `2026-11-17T11-28-41-win-with-only-a-queen-and-king-left.*` — D6 vs native
  2000, the expected-fail state made precise: Marionette WINS (terminal MET,
  deliver_mate completed) but reduce_to_kq never completes (1/2 ordered, 1/2
  final — queen mate delivered from a position with extra material).
