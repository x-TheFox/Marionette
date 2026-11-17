/**
 * Typed access to the Marionette monorepo engine packages.
 *
 * The service imports the engine directly from the repo sources (bun runs TS
 * natively). The repo root is resolved from MARIONETTE_REPO when set, else by
 * probing the two known layouts:
 *   - sandbox:  <root>/mini-services/marionette-engine  (repo sibling: marionette-fresh)
 *   - monorepo: <root>/apps/engine-service              (repo root two levels up)
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function findMarionetteRoot(): string {
  const candidates: string[] = [];
  if (process.env.MARIONETTE_REPO) candidates.push(resolve(process.env.MARIONETTE_REPO));
  candidates.push(
    resolve(import.meta.dir, '..', '..', '..', 'marionette-fresh'),
    resolve(import.meta.dir, '..', '..', '..'),
    resolve(import.meta.dir, '..', '..'),
  );
  for (const c of candidates) {
    if (existsSync(join(c, 'packages', 'core', 'src', 'index.ts'))) return c;
  }
  throw new Error(
    'Marionette repo not found — set MARIONETTE_REPO to the monorepo root (packages/core/src/index.ts must exist there)',
  );
}

export const MARIONETTE_ROOT = findMarionetteRoot();
export const STOCKFISH_PATH =
  process.env.MARIONETTE_STOCKFISH_PATH ?? join(MARIONETTE_ROOT, 'vendor', 'stockfish', 'stockfish');
/** Committed plan store: prefer the local copy, fall back to the repo store. */
const localPlans = join(import.meta.dir, '..', 'data', 'plans');
export const PLAN_CACHE_DIR = existsSync(localPlans)
  ? localPlans
  : join(MARIONETTE_ROOT, 'plans', 'v3');
export const BENCH_DIR = existsSync(join(import.meta.dir, '..', 'data', 'bench'))
  ? join(import.meta.dir, '..', 'data', 'bench')
  : join(MARIONETTE_ROOT, 'bench', 'summary');

// Offline mode: the Goal Compiler must NEVER be called from this service.
// Set before any compile happens (compile.ts reads this env var).
process.env.MARIONETTE_PLAN_CACHE = process.env.MARIONETTE_PLAN_CACHE ?? PLAN_CACHE_DIR;

// --- structural types for the pieces of the engine this service consumes ----

export interface ReportMilestone {
  id: string;
  description: string;
  completion: string;
  tolerance: string;
  weight: number;
  completed: boolean;
  completedAtPly?: number;
  bestPartial: number;
  droppedAtPly?: number;
  dropReason?: string;
  addedByReplan?: boolean;
  trueAtEnd?: boolean;
}

export interface SteeringTrailEntry {
  ply: number;
  san: string;
  chosenUci: string;
  chosenEvalSelfCp: number;
  chosenScore: number | null;
  chosenProgress: number;
  bestUci: string | null;
  bestSan: string | null;
  bestEvalSelfCp: number | null;
  evalLossCp: number | null;
  lambda: number | null;
  activeMilestoneId: string | null;
  activeMilestoneProgress: number | null;
}

export interface GameReport {
  directive: string;
  selfColor: 'w' | 'b';
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  endReason: string;
  terminalMet: boolean;
  plies: number;
  moveNumber: number;
  milestones: ReportMilestone[];
  finalPositionTrue: string[];
  violations: { id: string; description: string; atPly: number }[];
  replans: { atPly: number; reason: string; provider: string; model: string }[];
  fallbackEngaged: string | null;
  acplSelf: number | null;
  steeredMoves: number;
  marionetteMoves: number;
  evalTrail: (number | null)[];
  snapshots: { matSelf: number; matOpp: number; checksSelf: number }[];
  steeringTrail?: SteeringTrailEntry[];
  planFromCache: boolean;
  planProvider: string;
  planModel: string;
  opponentElo: number;
  opponentEmulated: boolean;
  steerDepth: number;
  steerMultiPV: number;
  elapsedMs: number;
  pgn: string;
  notes: string[];
}

export interface JudgeVerdict {
  looksTrying: number;
  natural: number;
  plausibleLoss: number;
  bully: number;
  looksTryingReasons: string[];
  naturalReasons: string[];
  plausibleLossReasons: string[];
  bullyReasons: string[];
}

export interface CandidateScore {
  uci: string;
  san: string;
  source: 'engine' | 'motivated';
  motive: string;
  evalSelfCp: number;
  deltaProgress: number;
  completes: boolean;
  excluded?: string;
  parts?: { progress: number; evalCost: number; bonus: number; total: number };
}

export interface CompiledMilestoneSpec {
  id: string;
  description: string;
  completion: string;
  infeasible?: string;
  tolerance: string;
  weight: number;
  moveBudget?: number;
}

export interface StoredPlan {
  directive: string;
  schemaVersion: string;
  model: string;
  provider: string;
  compiledAt: string;
  plan: {
    summary: string;
    style: string;
    terminal: { kind: string; pattern?: string; priority: string };
    hardConstraints: { id: string; description: string; predicate: string; afterMilestone?: string }[];
    milestones: CompiledMilestoneSpec[];
    fallback: string[];
  };
}

export interface Bar {
  id: string;
  description: string;
  metric: string;
  elos?: number[];
  threshold: number;
  milestoneIds?: string[];
  expectedFail?: boolean;
  note?: string;
}

export interface DirectiveSpec {
  id: string;
  directive: string;
  bars: Bar[];
}

// --- dynamic imports of the monorepo sources (bun executes TS directly) -----

interface CoreExports {
  runDirectiveGame: (opts: Record<string, unknown>) => Promise<GameReport>;
  heuristicJudge: (report: GameReport) => JudgeVerdict;
  JUDGE_THRESHOLDS: Record<string, number>;
  compileDirectivePlan: (opts: Record<string, unknown>) => Promise<{ compiled: { plan: StoredPlan['plan'] }; fromCache: boolean; provider: string; model: string }>;
  PlanTracker: new (compiled: unknown, self: 'w' | 'b', startPly?: number) => {
    plan: { milestones: { spec: CompiledMilestoneSpec; completion: unknown }[] };
    states: { completed: boolean; completedAtPly?: number; bestPartial: number; startedAtPly: number }[];
    activeIndex: () => number | null;
    update: (ctx: unknown, ply: number) => {
      newlyCompleted: { id: string; description: string; atPly: number }[];
      infeasible?: { id: string; reason: string };
      violated?: { id: string; description: string; atPly: number };
    };
    violations: () => { id: string; description: string; atPly: number }[];
  };
  terminalMet: (compiled: unknown, ctx: unknown) => boolean;
  buildContext: (game: unknown, self: 'w' | 'b', evalInfo: { evalWhiteCp: number | null; mateWhite: number | null }, checkFlags?: boolean[]) => unknown;
  predicatePartial: (p: unknown, ctx: unknown) => number;
  evalPredicate: (p: unknown, ctx: unknown) => boolean;
}

interface UciExports {
  UciEngine: {
    spawn: (path: string, opts?: { debug?: boolean }) => Promise<{
      newGame: () => Promise<void>;
      bestMove: (fen: string, opts?: { depth?: number; movetime?: number }) => Promise<string>;
      analyse: (fen: string, opts?: { depth?: number; movetime?: number; multiPV?: number }) => Promise<{
        bestMove: string;
        lines: { move: string; multipv: number; cpSTM: number | null; mateSTM: number | null; pv: string[] }[];
      }>;
      setOption: (name: string, value: string | number) => Promise<void>;
      quit: () => Promise<void>;
    }>;
  };
  configureStrength: (eng: unknown, cfg: { elo: number; emulatedDepth?: number }) => Promise<{ emulated: boolean; skillLevel?: number; depthCap: number }>;
  pickEmulatedMove: (analysis: { bestMove: string; lines: { move: string; cpSTM: number | null; mateSTM: number | null }[] }, elo: number, rng: () => number) => string;
  mulberry32: (seed: number) => () => number;
}

interface SpecExports {
  DIRECTIVES: DirectiveSpec[];
}

const coreMod = (await import(join(MARIONETTE_ROOT, 'packages', 'core', 'src', 'index.ts'))) as unknown as CoreExports;
const uciMod = (await import(join(MARIONETTE_ROOT, 'packages', 'uci', 'src', 'index.ts'))) as unknown as UciExports;
const specMod = (await import(join(MARIONETTE_ROOT, 'apps', 'harness', 'src', 'spec.ts'))) as unknown as SpecExports;

export const core = coreMod;
export const uci = uciMod;
export const harness = specMod;
