# @marionette/web — the puppeteer view (Phase 3 frontend)

Dark "puppeteer theater" UI for the Marionette directive-following chess engine:
lobby with honest benchmark chips and F1 opponent-strength calibration, live
puppeteer view (board + milestone panel + "why this move" + eval bar) streamed
over socket.io, human challenge mode (F7) with a rule-based coach card, replay
with scrubber + director's commentary (F2/F3/F4), and the frozen-bar benchmark
honesty panel. Zero LLM calls end to end.

## Run (dev)

1. **Start the engine service first** (see `apps/engine-service/README.md`):
   it listens on :3031 (socket.io realtime) and :3032 (REST) and must be able
   to find the monorepo checkout via `MARIONETTE_ROOT` (auto-probed when the
   service lives in `apps/engine-service`, so no env var is needed in this
   layout).

   ```bash
   cd apps/engine-service
   bun install
   bun --hot index.ts
   ```

2. **Then the Next.js dev server** (port 3000):

   ```bash
   cd apps/web
   bun install
   bun run dev
   ```

3. Open the app **through the gateway** (the UI addresses the engine with
   relative paths + the `XTransformPort` query param, which only the gateway
   understands): `http://localhost:81/`. Opening `:3000` directly works for the
   lobby shell but every engine call 404s by design.

## Views (all client-side states on `/` — there are no other routes)

- `/` — lobby: 11 directive cards (D1..D6 benchmark, H1..H5 held-out) with
  honest sweep verdict chips, opponent ELO selector (800/1200/1600/2000) with
  the F1 "just hard enough" suggestion tooltip, side picker, mode toggle.
- `/?view=game&id=<gameId>` — live game (puppeteer or human challenge).
- `/?replay=<gameId>` — deterministic replay of a finished game: scrubber,
  synced eval graph with milestone/drop/replan markers, rule-generated
  director's commentary (F3).
- `/?replaySeed=<directiveId>&elo=<n>&seed=<n>` — server-side re-run link
  (same directive/seed/settings; note the steered Stockfish search can still
  deviate between runs — the scrubber replay is the exact reproduction).

## Notes

- Plans are served from the **committed plans store** (`plans/v3` at the repo
  root; the engine service prefers its local `data/plans/` copy). Compile is
  always cache-only in this service — a missing plan is an honest error, never
  an LLM call.
- Sound cues are Kenney (CC0) at `public/sounds/`; the piece set is cburnett
  (BSD-3-Clause), bundled with react-chessboard.
- `src/lib/db.ts` (Prisma) from the sandbox scaffold was intentionally dropped
  from this mirror: the UI has no database.
- Sounds, milestone states, drop reasons and benchmark verdicts are displayed
  exactly as the engine reports them — failures stay visible on purpose.
