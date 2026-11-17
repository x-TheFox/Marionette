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
