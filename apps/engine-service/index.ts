/**
 * Marionette engine service (Phase 3 backend).
 *
 * Two listeners, one service (the sandbox gateway routes via XTransformPort):
 *   - :3031 socket.io realtime — live game streams. Frontend connects with
 *     io('/?XTransformPort=3031') ONLY (path '/' is used by the gateway; it
 *     intercepts plain HTTP, which is why REST has its own listener).
 *   - :3032 plain HTTP REST — /api/health, /api/start, /api/game/:id,
 *     /api/directives, /api/sweep, /api/human/:id/move, /api/human/:id/resign.
 *
 * Puppeteer mode runs the OFFLINE monorepo runner (cached plans, deterministic
 * replans, seeded RNG — zero LLM calls) and streams every game event, including
 * the per-move steering trail (chosen vs rejected best, F5).
 * Human mode (F7) scores the human's play with PlanTracker + DSL every ply.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { core, uci, harness, STOCKFISH_PATH, MARIONETTE_ROOT, type GameReport, type JudgeVerdict, type StoredPlan, type DirectiveSpec } from './lib/engine.js';
import { calibrationFor, expectedCompletionRate, honestPanelBars, SWEEPS } from './lib/calibration.js';
import { HumanGameManager } from './lib/human.js';

const REALTIME_PORT = 3031;
const API_PORT = 3032;
const MAX_CONCURRENT_GAMES = 2; // sandbox budget: 1 Stockfish thread, <= 2 games

// ---------------------------------------------------------------------------
// plan store (committed plans; compile is always offline here)

const planStoreDir = join(import.meta.dir, 'data', 'plans');
const planStore = new Map<string, StoredPlan>();
for (const f of readdirSync(planStoreDir).filter((x) => x.endsWith('.json'))) {
  try {
    const raw = JSON.parse(readFileSync(join(planStoreDir, f), 'utf8')) as StoredPlan;
    planStore.set(raw.directive, raw);
  } catch {
    // unreadable plan: skip
  }
}

// ---------------------------------------------------------------------------
// state

interface WrappedEvent {
  seq: number;
  at: number;
  event: Record<string, unknown> & { kind: string };
  fenAfter?: string;
}

interface PuppetGame {
  id: string;
  mode: 'puppeteer';
  directiveId: string;
  directive: string;
  elo: number;
  side: 'w' | 'b';
  seed: number;
  status: 'running' | 'finished' | 'error';
  startedAt: string;
  finishedAt?: string;
  report?: GameReport;
  judge?: JudgeVerdict;
  error?: string;
  events: WrappedEvent[];
  plan: {
    summary: string;
    style: string;
    terminal: StoredPlan['plan']['terminal'];
    milestones: StoredPlan['plan']['milestones'];
    hardConstraints: StoredPlan['plan']['hardConstraints'];
    fallback: string[];
    provider: string;
    model: string;
    fromCache: boolean;
  } | null;
}

const games = new Map<string, PuppetGame>();
const humanManager = new HumanGameManager();
const runningGames = new Set<string>();
let io: Server;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
}

/** FNV-1a — deterministic default seeds (mirrors the harness). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function specById(directiveId: string): DirectiveSpec | null {
  return harness.DIRECTIVES.find((d) => d.id === directiveId) ?? null;
}

// ---------------------------------------------------------------------------
// puppeteer games (offline runner + live streaming)

function startPuppeteerGame(opts: { directiveId: string; directive: string; elo: number; side: 'w' | 'b'; seed: number }): PuppetGame {
  const id = newId('pg');
  const planRaw = planStore.get(opts.directive) ?? null;
  const game: PuppetGame = {
    id,
    mode: 'puppeteer',
    directiveId: opts.directiveId,
    directive: opts.directive,
    elo: opts.elo,
    side: opts.side,
    seed: opts.seed,
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    plan: planRaw
      ? {
          summary: planRaw.plan.summary,
          style: planRaw.plan.style,
          terminal: planRaw.plan.terminal,
          milestones: planRaw.plan.milestones,
          hardConstraints: planRaw.plan.hardConstraints,
          fallback: planRaw.plan.fallback,
          provider: planRaw.provider,
          model: planRaw.model,
          fromCache: true,
        }
      : null,
  };
  games.set(id, game);
  runningGames.add(id);

  // Local replay board so every streamed move carries the FEN after it.
  const board = new Chess();
  let seq = 0;
  const onEvent = (e: Record<string, unknown> & { kind: string }) => {
    let fenAfter: string | undefined;
    if (e.kind === 'move' && typeof e.san === 'string') {
      try {
        board.move(e.san);
        fenAfter = board.fen();
      } catch {
        fenAfter = undefined;
      }
    }
    const wrapped: WrappedEvent = { seq: ++seq, at: Date.now(), event: e, fenAfter };
    game.events.push(wrapped);
    io.to(`game:${id}`).emit('game-event', { gameId: id, ...wrapped });
  };

  // Run OFFLINE: cached plan only (PlanCacheMissError is surfaced honestly),
  // deterministic replans, seeded RNG. No LlmChain is ever constructed.
  void (async () => {
    try {
      const report = await core.runDirectiveGame({
        directive: opts.directive,
        selfColor: opts.side,
        stockfishPath: STOCKFISH_PATH,
        opponentElo: opts.elo,
        steerDepth: 14,
        steerMultiPV: 5,
        motivatedDepth: 12,
        maxPlies: 300,
        maxReplans: 2,
        seed: opts.seed,
        llm: null,
        replanMode: 'deterministic',
        planFromCacheOnly: true,
        onEvent,
      });
      game.report = report;
      game.judge = core.heuristicJudge(report);
      game.status = 'finished';
      game.finishedAt = new Date().toISOString();
      io.to(`game:${id}`).emit('game-over', { gameId: id, report, judge: game.judge });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      game.status = 'error';
      game.error = message;
      game.finishedAt = new Date().toISOString();
      io.to(`game:${id}`).emit('game-error', { gameId: id, message });
    } finally {
      runningGames.delete(id);
    }
  })();

  return game;
}

// ---------------------------------------------------------------------------
// REST (port 3032)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    json(res, 404, { error: 'not found (this listener serves /api/* only)' });
    return;
  }
  try {
    if (path === '/api/health' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'marionette-engine',
        realtimePort: REALTIME_PORT,
        apiPort: API_PORT,
        runningGames: runningGames.size + humanManager.count,
        gamesTracked: games.size + humanManager.count,
        planStoreSize: planStore.size,
        sweepsLoaded: SWEEPS.length,
        stockfishPresent: existsSync(STOCKFISH_PATH),
        marionetteRoot: MARIONETTE_ROOT,
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    if (path === '/api/directives' && req.method === 'GET') {
      const directives = harness.DIRECTIVES.map((d) => {
        const plan = planStore.get(d.directive) ?? null;
        return {
          id: d.id,
          directive: d.directive,
          bars: d.bars,
          calibration: calibrationFor(d.id),
          plan: plan
            ? {
                summary: plan.plan.summary,
                style: plan.plan.style,
                terminal: plan.plan.terminal,
                milestones: plan.plan.milestones,
                hardConstraints: plan.plan.hardConstraints,
                fallback: plan.plan.fallback,
                provider: plan.provider,
                model: plan.model,
                compiledAt: plan.compiledAt,
              }
            : null,
        };
      });
      json(res, 200, { directives });
      return;
    }

    if (path === '/api/sweep' && req.method === 'GET') {
      const bars = honestPanelBars(harness.DIRECTIVES);
      json(res, 200, {
        bars,
        sweeps: SWEEPS.map((s) => ({ file: s.file, stamp: s.stamp, gamesPerCell: s.gamesPerCell, offline: s.offline, elos: s.elos, games: s.outcomes.length })),
      });
      return;
    }

    if (path === '/api/start' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        directiveId?: string;
        opponentElo?: number;
        side?: 'w' | 'b' | 'auto';
        mode?: 'puppeteer' | 'human';
        seed?: number;
      };
      const directiveId = String(body.directiveId ?? '');
      const spec = specById(directiveId);
      if (!spec) {
        json(res, 400, { error: `unknown directiveId '${directiveId}' (use D1..D6, H1..H5)` });
        return;
      }
      const elo = Math.round(Number(body.opponentElo ?? 800));
      if (![800, 1200, 1600, 2000].includes(elo)) {
        json(res, 400, { error: 'opponentElo must be one of 800/1200/1600/2000' });
        return;
      }
      const mode = body.mode === 'human' ? 'human' : 'puppeteer';
      if (runningGames.size + humanManager.count >= MAX_CONCURRENT_GAMES) {
        json(res, 429, { error: `engine busy: at most ${MAX_CONCURRENT_GAMES} concurrent games (1 engine thread)` });
        return;
      }
      const side: 'w' | 'b' = body.side === 'b' ? 'b' : 'w'; // 'auto' -> White (board unflipped)
      const seed = Number.isFinite(body.seed) ? (Number(body.seed) >>> 0) : (hash32(`${spec.id}:${elo}`) ^ 42) >>> 0;
      if (mode === 'puppeteer') {
        const game = startPuppeteerGame({ directiveId: spec.id, directive: spec.directive, elo, side, seed });
        json(res, 200, { gameId: game.id, mode, seed: game.seed, side: game.side, elo });
      } else {
        if (!planStore.has(spec.directive)) {
          json(res, 503, { error: `no committed plan for directive ${spec.id} — offline compile impossible (plan store has ${planStore.size} plans)` });
          return;
        }
        const gameId = newId('hg');
        try {
          const record = await humanManager.start({ gameId, directiveId: spec.id, directive: spec.directive, elo, side, seed });
          json(res, 200, { gameId: record.id, mode, seed, side: record.side, elo, record });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          json(res, 503, { error: `human game could not start: ${message}` });
        }
      }
      return;
    }

    const gameMatch = path.match(/^\/api\/game\/([\w-]+)$/);
    if (gameMatch && req.method === 'GET') {
      const id = gameMatch[1]!;
      const game = games.get(id);
      if (game) {
        json(res, 200, { ...game, runningNow: runningGames.has(id) });
        return;
      }
      const human = humanManager.get(id);
      if (human) {
        json(res, 200, { ...human, runningNow: human.status === 'active' });
        return;
      }
      json(res, 404, { error: `unknown game '${id}'` });
      return;
    }

    const humanMoveMatch = path.match(/^\/api\/human\/([\w-]+)\/move$/);
    if (humanMoveMatch && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { from?: string; to?: string; promotion?: string };
      if (!body.from || !body.to) {
        json(res, 400, { error: 'from and to are required' });
        return;
      }
      const out = await humanManager.move(humanMoveMatch[1]!, body.from, body.to, body.promotion);
      if (!out.ok) {
        json(res, 400, { error: out.error });
        return;
      }
      for (const ev of out.events) {
        io.to(`game:${humanMoveMatch[1]}`).emit('human-event', { gameId: humanMoveMatch[1], event: ev });
      }
      if (out.record.status === 'finished' && out.record.report) {
        io.to(`game:${humanMoveMatch[1]}`).emit('human-over', { gameId: humanMoveMatch[1], report: out.record.report });
      }
      json(res, 200, { events: out.events, record: out.record });
      return;
    }

    const humanResignMatch = path.match(/^\/api\/human\/([\w-]+)\/resign$/);
    if (humanResignMatch && req.method === 'POST') {
      const out = humanManager.resign(humanResignMatch[1]!);
      if (!out.ok || !out.record) {
        json(res, 400, { error: out.error ?? 'cannot resign' });
        return;
      }
      io.to(`game:${humanResignMatch[1]}`).emit('human-over', { gameId: humanResignMatch[1], report: out.record.report });
      json(res, 200, { record: out.record });
      return;
    }

    json(res, 404, { error: `no route for ${req.method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
}

// ---------------------------------------------------------------------------
// servers

const apiServer = createServer((req, res) => {
  void handleRequest(req, res);
});

const realtimeServer = createServer();
io = new Server(realtimeServer, {
  // DO NOT change the path: it is used by the gateway (Caddy) to forward.
  // Note: path '/' intercepts plain HTTP requests, hence the REST listener
  // lives on its own port (API_PORT).
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on('connection', (socket) => {
  socket.on('join', (data: { gameId?: string }) => {
    const gameId = String(data?.gameId ?? '');
    if (!gameId) return;
    void socket.join(`game:${gameId}`);
    socket.emit('joined', { gameId });
  });
  socket.on('ping', () => socket.emit('pong', { at: Date.now() }));
});

apiServer.listen(API_PORT, () => {
  console.log(`marionette-engine REST api listening on :${API_PORT}`);
});
realtimeServer.listen(REALTIME_PORT, () => {
  console.log(`marionette-engine socket.io realtime listening on :${REALTIME_PORT}`);
  console.log(`  marionette root: ${MARIONETTE_ROOT}`);
  console.log(`  stockfish: ${STOCKFISH_PATH} (${existsSync(STOCKFISH_PATH) ? 'present' : 'MISSING'})`);
  console.log(`  plan store: ${planStore.size} plans`);
  console.log(`  sweeps loaded: ${SWEEPS.length} (${SWEEPS.map((s) => s.file).join(', ')})`);
});

process.on('SIGTERM', () => {
  void humanManager.shutdown().then(() => {
    apiServer.close();
    realtimeServer.close(() => process.exit(0));
  });
});
process.on('SIGINT', () => {
  void humanManager.shutdown().then(() => {
    apiServer.close();
    realtimeServer.close(() => process.exit(0));
  });
});
