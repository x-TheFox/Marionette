# @marionette/engine-service (Phase 3 backend app)

Bun service that wraps the offline Marionette runner (`packages/core`) for the
web puppeteer view. Two listeners, one process:

- **:3031** — socket.io realtime (path `/`): live game streams. The gateway
  routes `/?XTransformPort=3031` here. Events: `join`/`joined`, then per-game
  `game-event` (move / steer / milestone / violation / infeasible / replan /
  fallback / info / end), `game-over`, `game-error`, and for human games
  `human-event` / `human-over`.
- **:3032** — plain HTTP REST (the gateway routes `/api/*?XTransformPort=3032`):
  `GET /api/health`, `GET /api/directives`, `GET /api/sweep`,
  `POST /api/start`, `GET /api/game/:id`, `POST /api/human/:id/move`,
  `POST /api/human/:id/resign`.

Puppeteer games run the OFFLINE monorepo runner: committed plans only
(cache-only compile), deterministic replans, seeded RNG, zero LLM calls. Human
challenge games (F7) score every human ply with PlanTracker + the DSL.

## Run

```bash
bun install
bun --hot index.ts     # or: bun run dev
```

Layout probing (see `lib/engine.ts`):

- `MARIONETTE_REPO` env var wins if set;
- monorepo layout `apps/engine-service` → repo root two levels up (needs
  `packages/core/src/index.ts` there);
- sandbox layout → `marionette-fresh` sibling.

`MARIONETTE_STOCKFISH_PATH` overrides the Stockfish binary (default
`<repo>/vendor/stockfish/stockfish`).

## Data

- `data/plans/*.json` — the committed plan store (v3, 11 plans), copied from
  `plans/v3/` at the repo root so the service is self-contained. The loader
  prefers this local copy and falls back to `<repo>/plans/v3`.
- Bench/sweep summaries are **not** copied here: they live in the monorepo at
  **`bench/summary/`** (e.g. `2026-11-17T18-09-41-quick.json` D1/D6 x10,
  `2026-11-17T18-11-27-quick.json` rest x3 — newest two are loaded for the
  honesty panel and F1 calibration).
