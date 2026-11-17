import { Chess } from 'chess.js';
import { LlmChainError } from '@marionette/llm';
import type { LlmChain } from '@marionette/llm';
import { UciEngine, configureStrength, pickEmulatedMove, mulberry32 } from '@marionette/uci';
import { buildContext, evalPredicate } from '../dsl/index.js';
import type { GameContext, Side } from '../dsl/types.js';
import { compileDirectivePlan } from '../compiler/compile.js';
import type { CompiledPlan } from '../plan/schema.js';
import { PlanTracker, terminalMet, type ConstraintViolation } from './tracker.js';
import { deterministicReplan } from './deterministic.js';
import { steerMove } from '../steering/steer.js';

/**
 * Headless directive game: Marionette (steered Stockfish) vs a strength-capped
 * opponent Stockfish. Every ply is predicate-checked; replanning happens on
 * infeasible/stalled/budget-blown milestones; the report is honest about what
 * was and wasn't achieved.
 */

export interface RunnerOptions {
  directive: string;
  selfColor: 'w' | 'b';
  startFen?: string;
  stockfishPath: string;
  opponentElo: number;
  /** Opponent search depth cap; default 16 (native Elo) / auto (emulated). */
  opponentDepth?: number;
  steerDepth?: number;
  steerMultiPV?: number;
  motivatedDepth?: number;
  maxPlies?: number;
  maxReplans?: number;
  /** Plies without partial-credit progress before a stall replan. */
  stallWindow?: number;
  /** LLM chain for live compiles/replans; may be null in offline mode. */
  llm?: LlmChain | null;
  /** 'llm' (default) tries the provider chain first, deterministic as fallback; 'deterministic' never calls an LLM. */
  replanMode?: 'llm' | 'deterministic';
  /** Offline mode: initial plan must come from the cache (PlanCacheMissError otherwise). */
  planFromCacheOnly?: boolean;
  noCache?: boolean;
  /** Deterministic seed for emulated opponents / natural fallbacks. */
  seed?: number;
  onEvent?: (e: GameEvent) => void;
  pgnPath?: string;
  reportPath?: string;
}

export type GameEvent =
  | { kind: 'info'; message: string }
  | { kind: 'move'; ply: number; san: string; side: Side; source: string; evalWhiteCp?: number | null; lambda?: number }
  | { kind: 'milestone'; id: string; description: string; atPly: number }
  | { kind: 'violation'; id: string; description: string; atPly: number }
  | { kind: 'infeasible'; id: string; reason: string; atPly: number }
  | { kind: 'replan'; atPly: number; reason: string; provider: string; model: string }
  | { kind: 'fallback'; action: string; atPly: number }
  | { kind: 'end'; result: string; reason: string };

export interface GameReport {
  directive: string;
  selfColor: 'w' | 'b';
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  endReason: string;
  terminalMet: boolean;
  plies: number;
  moveNumber: number;
  milestones: {
    id: string;
    description: string;
    completion: string;
    tolerance: string;
    weight: number;
    completed: boolean;
    completedAtPly?: number;
    bestPartial: number;
  }[];
  violations: ConstraintViolation[];
  replans: { atPly: number; reason: string; provider: string; model: string }[];
  fallbackEngaged: string | null;
  acplSelf: number | null;
  /** Moves scored through the steering path (ACPL denominator). */
  steeredMoves: number;
  marionetteMoves: number;
  /** Self-perspective eval (cp) after each Marionette move (judge input). */
  evalTrail: (number | null)[];
  /** Material + checks snapshot after each Marionette move (judge input). */
  snapshots: { matSelf: number; matOpp: number; checksSelf: number }[];
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

interface FallbackMode {
  action: string;
  /** 'steer' keeps normal steering; others replace move selection. */
  mode: 'steer' | 'best' | 'natural' | 'lose';
}

export async function runDirectiveGame(opts: RunnerOptions): Promise<GameReport> {
  const t0 = Date.now();
  const notes: string[] = [];
  const maxPlies = opts.maxPlies ?? 300;
  const maxReplans = opts.maxReplans ?? 2;
  const stallWindow = opts.stallWindow ?? 16;
  const replanMode = opts.replanMode ?? 'llm';
  const steerDepth = opts.steerDepth ?? 14;
  const steerMultiPV = Math.min(opts.steerMultiPV ?? 5, 5);
  const motivatedDepth = opts.motivatedDepth ?? 12;
  const rng = mulberry32(opts.seed ?? 0x4d617269);
  const emit = (e: GameEvent) => opts.onEvent?.(e);

  const startFen = opts.startFen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const game = new Chess(startFen);
  const self: Side = opts.selfColor;

  // Mutable game state — declared at body scope so the helper closures below
  // can read/write them. Holder objects defeat TS's `let` narrowing across
  // closure calls.
  const state: {
    compiled: CompiledPlan | null;
    tracker: PlanTracker | null;
    fallback: FallbackMode | null;
    replans: GameReport['replans'];
    checkFlags: boolean[];
    lastEvalWhite: number | null;
    lastMateWhite: number | null;
    acplSum: number;
    acplN: number;
    marionetteMoves: number;
    evalTrail: (number | null)[];
    snapshots: { matSelf: number; matOpp: number; checksSelf: number }[];
    compileFromCache: boolean;
    compileProvider: string;
    compileModel: string;
  } = {
    compiled: null,
    tracker: null,
    fallback: null,
    replans: [],
    checkFlags: [],
    lastEvalWhite: null,
    lastMateWhite: null,
    acplSum: 0,
    acplN: 0,
    marionetteMoves: 0,
    evalTrail: [],
    snapshots: [],
    compileFromCache: false,
    compileProvider: '',
    compileModel: '',
  };

  const marionetteEng = await UciEngine.spawn(opts.stockfishPath);
  const opponentEng = await UciEngine.spawn(opts.stockfishPath);
  try {
    await marionetteEng.newGame();
    const oppSetup = await configureStrength(opponentEng, { elo: opts.opponentElo });
    await opponentEng.newGame();
    if (oppSetup.emulated) {
      notes.push(
        `opponent Elo ${opts.opponentElo} is below the native UCI_Elo floor (1320): emulated with Skill Level ${oppSetup.skillLevel}, depth cap ${oppSetup.depthCap}, eval-weighted move choice`,
      );
    }
    emit({
      kind: 'info',
      message: `engines ready (marionette depth ${steerDepth}, opponent ${oppSetup.emulated ? 'emulated' : 'native'} Elo ${opts.opponentElo})`,
    });

    // --- Plan ---------------------------------------------------------------
    if (!opts.llm && !opts.planFromCacheOnly) {
      throw new Error('runDirectiveGame: no LLM chain and planFromCacheOnly not set — nothing to compile with');
    }
    const compileResult = await compileDirectivePlan({
      directive: opts.directive,
      selfColor: self,
      fen: startFen,
      llm: opts.llm ?? null,
      noCache: opts.noCache,
      fromCacheOnly: opts.planFromCacheOnly,
    });
    state.compiled = compileResult.compiled;
    state.compileFromCache = compileResult.fromCache;
    state.compileProvider = compileResult.provider;
    state.compileModel = compileResult.model;
    state.tracker = new PlanTracker(compileResult.compiled, self, 0);
    emit({
      kind: 'info',
      message: `plan compiled (${compileResult.fromCache ? 'cached' : compileResult.provider}): ${compileResult.compiled.plan.summary}`,
    });

    const ctxOf = (): GameContext =>
      buildContext(
        game,
        self,
        { evalWhiteCp: state.lastEvalWhite, mateWhite: state.lastMateWhite },
        state.checkFlags,
      );

    // --- Game loop ----------------------------------------------------------
    while (!game.isGameOver()) {
      const ply = game.history().length;
      if (ply >= maxPlies) break;
      const tracker = state.tracker!;
      const compiled = state.compiled!;

      // Replan triggers (infeasibility is handled right after the post-ply pass).
      if (tracker.activeIndex() != null && state.replans.length < maxReplans && state.fallback == null) {
        const ctx = ctxOf();
        const trigger = replanTrigger(tracker, ply, stallWindow, ctx);
        if (trigger != null) {
          const ok = await doReplan(trigger, ply);
          if (ok) continue;
        }
      }

      const turn = game.turn() as Side;
      if (turn === self) {
        // --- Marionette's move --------------------------------------------
        let uci: string;
        let san: string;
        let source = 'steer';
        let evalWhiteCp: number | null = null;
        let lambda: number | undefined;

        const fb = state.fallback;
        if (fb != null && fb.mode !== 'steer') {
          const picked = await pickFallbackMove(fb.mode, game, marionetteEng, steerDepth, motivatedDepth, rng);
          uci = picked.uci;
          san = picked.san;
          source = `fallback:${fb.action}`;
          evalWhiteCp = picked.evalWhiteCp;
        } else {
          const decision = await steerMove({
            engine: marionetteEng,
            game,
            self,
            compiled,
            tracker,
            evalDepth: steerDepth,
            multiPV: steerMultiPV,
            motivatedDepth,
            checkFlags: state.checkFlags,
            rng,
          });
          uci = decision.uci;
          san = decision.san;
          lambda = decision.lambda;
          evalWhiteCp = decision.evalWhiteCp;
          const chosen = decision.candidates.find((c) => c.uci === uci);
          if (chosen?.parts) {
            const bestSelf = decision.candidates
              .filter((c) => !c.excluded)
              .reduce((m, c) => Math.max(m, c.evalSelfCp), -Infinity);
            if (Number.isFinite(bestSelf)) {
              state.acplSum += Math.max(0, bestSelf - chosen.evalSelfCp) / 100;
              state.acplN++;
            }
          }
        }

        const verbose = (
          game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[]
        ).find((m) => m.from + m.to + (m.promotion ?? '') === uci);
        if (!verbose) {
          notes.push(`engine move ${uci} illegal at ply ${ply}; played first legal move instead`);
          const any = (
            game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[]
          )[0]!;
          game.move({ from: any.from, to: any.to, promotion: any.promotion });
          san = any.san;
        } else {
          game.move({ from: verbose.from, to: verbose.to, promotion: verbose.promotion });
        }
        state.marionetteMoves++;
        state.lastEvalWhite = evalWhiteCp ?? state.lastEvalWhite;
        state.evalTrail.push(
          evalWhiteCp == null ? null : self === 'w' ? evalWhiteCp : -evalWhiteCp,
        );
        state.checkFlags.push(game.isCheck());
        emit({ kind: 'move', ply, san, side: self, source, evalWhiteCp, lambda });
      } else {
        // --- Opponent's move ------------------------------------------------
        const uci = await opponentMove(opponentEng, game, oppSetup, opts.opponentElo, opts.opponentDepth, rng);
        const verbose = (
          game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[]
        ).find((m) => m.from + m.to + (m.promotion ?? '') === uci);
        if (!verbose) {
          notes.push(`opponent move ${uci} illegal at ply ${ply}; played first legal move instead`);
          const any = (
            game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[]
          )[0]!;
          game.move({ from: any.from, to: any.to, promotion: any.promotion });
        } else {
          game.move({ from: verbose.from, to: verbose.to, promotion: verbose.promotion });
        }
        state.checkFlags.push(game.isCheck());
        emit({ kind: 'move', ply, san: verbose?.san ?? '?', side: turn, source: `opponent(elo ${opts.opponentElo})` });
      }

      // --- Post-ply predicate pass -----------------------------------------
      const after = ctxOf();
      if (turn === self) {
        state.snapshots.push({
          matSelf: after.material[self],
          matOpp: after.material[self === 'w' ? 'b' : 'w'],
          checksSelf: after.checksCount[self],
        });
      }
      const upd = tracker.update(after, game.history().length);
      for (const m of upd.newlyCompleted) {
        emit({ kind: 'milestone', id: m.id, description: m.description, atPly: m.atPly });
      }
      if (upd.violated) {
        emit({
          kind: 'violation',
          id: upd.violated.id,
          description: upd.violated.description,
          atPly: upd.violated.atPly,
        });
        notes.push(`hard constraint '${upd.violated.id}' violated at ply ${upd.violated.atPly}`);
      }
      if (upd.infeasible) {
        emit({
          kind: 'infeasible',
          id: upd.infeasible.id,
          reason: upd.infeasible.reason,
          atPly: game.history().length,
        });
        if (state.replans.length < maxReplans) {
          await doReplan(`milestone ${upd.infeasible.id} infeasible: ${upd.infeasible.reason}`, game.history().length);
        } else {
          engageFallback(`all replans spent, milestone ${upd.infeasible.id} infeasible`, game.history().length);
        }
      }
    }

    // --- End of game --------------------------------------------------------
    const tracker = state.tracker!;
    const compiled = state.compiled!;
    const finalPly = game.history().length;
    tracker.update(ctxOf(), finalPly); // final predicate pass
    const finalCtx = ctxOf();
    const terminal = terminalMet(compiled, finalCtx);
    const endReason = detectEnd(game, maxPlies);
    const result = resultOf(game, endReason);
    if (!terminal && tracker.activeIndex() != null) {
      const incomplete = compiled.milestones.length - tracker.activeIndex()!;
      notes.push(`${incomplete} milestone(s) incomplete at game end`);
    }
    // Un-gated constraints are enforced from the first move (and on this final
    // pass) by the tracker; nothing extra to check here.
    emit({ kind: 'end', result, reason: endReason });

    const pgn = writePgn(game, opts, result, compiled);
    if (opts.pgnPath) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(opts.pgnPath), { recursive: true });
      writeFileSync(opts.pgnPath, pgn + '\n');
    }

    const report: GameReport = {
      directive: opts.directive,
      selfColor: self,
      result,
      endReason,
      terminalMet: terminal,
      plies: finalPly,
      moveNumber: finalCtx.moveNumber,
      milestones: compiled.milestones.map((ms, i) => ({
        id: ms.spec.id,
        description: ms.spec.description,
        completion: ms.spec.completion,
        tolerance: ms.spec.tolerance,
        weight: ms.spec.weight,
        completed: tracker.states[i]!.completed,
        completedAtPly: tracker.states[i]!.completedAtPly,
        bestPartial: tracker.states[i]!.bestPartial,
      })),
      violations: tracker.violations(),
      replans: [...state.replans],
      fallbackEngaged: state.fallback?.action ?? null,
      acplSelf: state.acplN > 0 ? state.acplSum / state.acplN : null,
      steeredMoves: state.acplN,
      marionetteMoves: state.marionetteMoves,
      evalTrail: [...state.evalTrail],
      snapshots: [...state.snapshots],
      planFromCache: state.compileFromCache,
      planProvider: state.compileProvider,
      planModel: state.compileModel,
      opponentElo: opts.opponentElo,
      opponentEmulated: oppSetup.emulated,
      steerDepth,
      steerMultiPV,
      elapsedMs: Date.now() - t0,
      pgn,
      notes,
    };
    if (opts.reportPath) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(opts.reportPath), { recursive: true });
      writeFileSync(opts.reportPath, renderReport(report) + '\n');
    }
    return report;
  } finally {
    await marionetteEng.quit().catch(() => undefined);
    await opponentEng.quit().catch(() => undefined);
  }

  // --- closures over the mutable state (declared after try; hoisted) --------

  async function doReplan(reason: string, ply: number): Promise<boolean> {
    const ctx = buildContext(
      game,
      self,
      { evalWhiteCp: state.lastEvalWhite, mateWhite: state.lastMateWhite },
      state.checkFlags,
    );
    const progress = state.tracker!.progressReport(ctx);

    const tryDeterministic = (why: string): boolean => {
      const r = deterministicReplan(state.compiled!, progress, reason);
      if (!r) return false;
      state.compiled = r.compiled;
      state.tracker = new PlanTracker(r.compiled, self, ply);
      state.tracker.rederive(ctx, ply);
      state.replans.push({ atPly: ply, reason, provider: 'deterministic', model: 'rule-based' });
      emit({ kind: 'replan', atPly: ply, reason, provider: 'deterministic', model: 'rule-based' });
      emit({ kind: 'info', message: `deterministic replan: ${r.changes.join('; ')}` });
      notes.push(`replan at ply ${ply} was deterministic (${why}): ${r.changes.join('; ')}`);
      return true;
    };

    if (replanMode === 'deterministic' || !opts.llm) {
      if (tryDeterministic('offline mode')) return true;
      engageFallback(`deterministic replan impossible: ${reason}`, ply);
      return false;
    }

    try {
      const r = await compileDirectivePlan({
        directive: opts.directive,
        selfColor: self,
        fen: ctx.fen,
        llm: opts.llm,
        progress,
        replanReason: reason,
        noCache: true,
      });
      state.compiled = r.compiled;
      state.tracker = new PlanTracker(r.compiled, self, ply);
      state.tracker.rederive(ctx, ply);
      state.replans.push({ atPly: ply, reason, provider: r.provider, model: r.model });
      emit({ kind: 'replan', atPly: ply, reason, provider: r.provider, model: r.model });
      emit({ kind: 'info', message: `new plan: ${r.compiled.plan.summary}` });
      return true;
    } catch (e) {
      const detail =
        e instanceof LlmChainError
          ? e.attempts
              .map((a) => `${a.provider}: ${(a.error ?? a.skipped ?? 'unknown').slice(0, 140)}`)
              .join(' | ')
          : e instanceof Error
            ? e.message
            : String(e);
      notes.push(`LLM replan failed at ply ${ply} [${detail}]`);
      if (tryDeterministic('llm replan failed')) return true;
      engageFallback(`replan failed: ${reason}`, ply);
      return false;
    }
  }

  function engageFallback(reason: string, ply: number): void {
    if (state.fallback != null) return;
    const list = state.compiled!.plan.fallback;
    const allDone = state.tracker!.activeIndex() == null;
    for (const a of list) {
      if (a === 'complete_remaining_milestones' && !allDone) {
        state.fallback = { action: a, mode: 'steer' };
        emit({ kind: 'fallback', action: a, atPly: ply });
        notes.push(`fallback engaged at ply ${ply} (${reason}): keep steering remaining milestones`);
        return;
      }
      if (a === 'secure_terminal') {
        const t = state.compiled!.plan.terminal;
        const mode: FallbackMode['mode'] = t.kind === 'lose' ? 'lose' : 'best';
        state.fallback = { action: a, mode };
        emit({ kind: 'fallback', action: a, atPly: ply });
        notes.push(`fallback engaged at ply ${ply} (${reason}): ${mode} toward terminal ${t.kind}`);
        return;
      }
      if (a === 'play_best') {
        state.fallback = { action: a, mode: 'best' };
        emit({ kind: 'fallback', action: a, atPly: ply });
        notes.push(`fallback engaged at ply ${ply} (${reason}): play best`);
        return;
      }
      if (a === 'play_natural') {
        state.fallback = { action: a, mode: 'natural' };
        emit({ kind: 'fallback', action: a, atPly: ply });
        notes.push(`fallback engaged at ply ${ply} (${reason}): play natural`);
        return;
      }
    }
    state.fallback = { action: list[list.length - 1] ?? 'play_best', mode: 'best' };
  }
}

// ---------------------------------------------------------------------------
// pure helpers

async function opponentMove(
  eng: UciEngine,
  game: Chess,
  setup: { emulated: boolean; depthCap: number },
  elo: number,
  explicitDepth: number | undefined,
  rng: () => number,
): Promise<string> {
  if (!setup.emulated) {
    return eng.bestMove(game.fen(), { depth: Math.min(explicitDepth ?? 16, 30) });
  }
  const a = await eng.analyse(game.fen(), { depth: setup.depthCap, multiPV: 4 });
  return pickEmulatedMove(a, elo, rng);
}

async function pickFallbackMove(
  mode: 'best' | 'natural' | 'lose',
  game: Chess,
  marionetteEng: UciEngine,
  steerDepth: number,
  motivatedDepth: number,
  rng: () => number,
): Promise<{ uci: string; san: string; evalWhiteCp: number | null }> {
  const fen = game.fen();
  const verbose = game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[];
  const toUci = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

  if (mode === 'best') {
    const a = await marionetteEng.analyse(fen, { depth: steerDepth, multiPV: 1 });
    const mv = verbose.find((m) => toUci(m) === a.bestMove) ?? verbose[0]!;
    return { uci: toUci(mv), san: mv.san, evalWhiteCp: null };
  }
  if (mode === 'natural') {
    const a = await marionetteEng.analyse(fen, { depth: Math.max(10, steerDepth - 4), multiPV: 3 });
    const uci = pickEmulatedMove(a, 1350, rng);
    const mv = verbose.find((m) => toUci(m) === uci) ?? verbose[0]!;
    return { uci: toUci(mv), san: mv.san, evalWhiteCp: null };
  }
  // 'lose': pick the worst-scoring line that does not immediately draw/stalemate.
  const a = await marionetteEng.analyse(fen, { depth: motivatedDepth, multiPV: 4 });
  const stmIsWhite = fen.split(' ')[1] === 'w';
  const scored = a.lines
    .map((l) => ({
      uci: l.move,
      cp:
        l.mateSTM != null
          ? l.mateSTM > 0
            ? 10_000 - l.mateSTM * 50
            : -(10_000 - Math.abs(l.mateSTM) * 50)
          : (l.cpSTM ?? 0),
    }))
    .sort((x, y) => x.cp - y.cp);
  for (const s of scored) {
    const mv = verbose.find((m) => toUci(m) === s.uci);
    if (!mv) continue;
    const probe = new Chess(fen);
    try {
      probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      continue;
    }
    if (!probe.isDraw() && !probe.isStalemate()) {
      return { uci: toUci(mv), san: mv.san, evalWhiteCp: stmIsWhite ? s.cp : -s.cp };
    }
  }
  const mv = verbose[0]!;
  return { uci: toUci(mv), san: mv.san, evalWhiteCp: null };
}

function replanTrigger(tracker: PlanTracker, ply: number, stallWindow: number, ctx: GameContext): string | null {
  const ai = tracker.activeIndex();
  if (ai == null) return null;
  const spec = tracker.plan.milestones[ai]!.spec;
  if (tracker.budgetExceeded(ply)) {
    return `milestone ${spec.id} exceeded its move budget (${spec.moveBudget} plies)`;
  }
  if (tracker.stalled(ply, stallWindow)) {
    return `milestone ${spec.id} stalled: no partial progress for ~${ply - tracker.states[ai]!.bestPartialAtPly} plies`;
  }
  // Implicit infeasibility: a win target while the position is dead-drawn.
  if (spec.completion.includes('winner() == self') && ctx.insufficient) {
    return `milestone ${spec.id}: position is heading to insufficient-material draw`;
  }
  return null;
}

function detectEnd(game: Chess, maxPlies: number): string {
  if (game.isCheckmate()) return 'checkmate';
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'insufficient_material';
  if (game.isThreefoldRepetition()) return 'threefold_repetition';
  if (game.isDraw()) return 'draw';
  if (game.history().length >= maxPlies) return 'move_limit';
  return 'unknown';
}

function resultOf(game: Chess, endReason: string): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (endReason === 'checkmate') return game.turn() === 'w' ? '0-1' : '1-0';
  if (['stalemate', 'insufficient_material', 'threefold_repetition', 'draw'].includes(endReason)) return '1/2-1/2';
  if (endReason === 'move_limit') return '*';
  return '*';
}

function writePgn(game: Chess, opts: RunnerOptions, result: string, compiled: CompiledPlan): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  game.header('Event', 'Marionette directive game');
  game.header('Site', 'marionette-cli');
  game.header('Date', d);
  game.header('White', opts.selfColor === 'w' ? 'Marionette' : `Stockfish-19 (Elo ${opts.opponentElo})`);
  game.header('Black', opts.selfColor === 'b' ? 'Marionette' : `Stockfish-19 (Elo ${opts.opponentElo})`);
  game.header('Result', result);
  game.header('Annotator', `plan: ${compiled.plan.summary.slice(0, 80)}`);
  return game.pgn();
}

/** Render a markdown milestone report. */
export function renderReport(r: GameReport): string {
  const lines: string[] = [];
  lines.push('# Marionette game report');
  lines.push('');
  lines.push(`- **Directive:** "${r.directive}"`);
  lines.push(
    `- **Setup:** Marionette as ${r.selfColor === 'w' ? 'White' : 'Black'} vs Stockfish 19 @ ${r.opponentElo} Elo (${r.opponentEmulated ? 'emulated below native floor' : 'native UCI_Elo'}), steering depth ${r.steerDepth}, MultiPV ${r.steerMultiPV}`,
  );
  lines.push(`- **Result:** ${r.result} after ${Math.ceil(r.plies / 2)} moves (${r.endReason})`);
  lines.push(`- **Terminal condition:** ${r.terminalMet ? 'MET' : 'NOT MET'}`);
  lines.push(
    `- **Plan:** ${r.planFromCache ? 'from cache' : `compiled by ${r.planProvider} (${r.planModel})`}${r.replans.length > 0 ? `, ${r.replans.length} replan(s)` : ''}`,
  );
  if (r.fallbackEngaged) lines.push(`- **Fallback engaged:** ${r.fallbackEngaged}`);
  if (r.acplSelf != null)
    lines.push(
      `- **Marionette ACPL:** ${r.acplSelf.toFixed(1)} cp over ${r.steeredMoves} steered moves (${r.marionetteMoves} total)`,
    );
  lines.push('');
  lines.push('## Milestones');
  for (const m of r.milestones) {
    const box = m.completed ? 'x' : ' ';
    const detail = m.completed
      ? `completed at ply ${m.completedAtPly}`
      : `incomplete, partial ${Math.round(m.bestPartial * 100)}%`;
    lines.push(`- [${box}] ${m.id} (w=${m.weight}, tol=${m.tolerance}) — ${detail}: ${m.description}`);
    lines.push(`  - predicate: \`${m.completion}\``);
  }
  if (r.replans.length > 0) {
    lines.push('');
    lines.push('## Replans');
    for (const rp of r.replans) {
      lines.push(`- ply ${rp.atPly}: ${rp.reason} (${rp.provider})`);
    }
  }
  if (r.violations.length > 0) {
    lines.push('');
    lines.push('## Constraint violations');
    for (const v of r.violations) lines.push(`- ply ${v.atPly}: ${v.id} — ${v.description}`);
  }
  if (r.notes.length > 0) {
    lines.push('');
    lines.push('## Notes');
    for (const n of r.notes) lines.push(`- ${n}`);
  }
  lines.push('');
  lines.push('## PGN');
  lines.push('```');
  lines.push(r.pgn);
  lines.push('```');
  return lines.join('\n');
}
