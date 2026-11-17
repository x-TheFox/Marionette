/**
 * Human challenge mode (F7): a lightweight game loop where the HUMAN plays
 * Marionette's side and must fulfil the directive.
 *
 * This deliberately does NOT use runDirectiveGame (no steering, no replans):
 * the human's moves are validated with chess.js, the PlanTracker + DSL score
 * the human's milestone progress after every ply (the honest F7 scoring
 * engine), and the opponent replies through a strength-capped UciEngine that
 * mirrors apps/harness opponent handling (native UCI_Elo >= 1320,
 * Skill-Level/depth/softmax emulation below).
 */
import { Chess } from 'chess.js';
import { core, uci, STOCKFISH_PATH, PLAN_CACHE_DIR, type GameReport, type JudgeVerdict, type ReportMilestone, type CompiledMilestoneSpec } from './engine.js';

export type Side = 'w' | 'b';

export interface HumanMilestoneSnapshot {
  id: string;
  description: string;
  completion: string;
  weight: number;
  status: 'completed' | 'active' | 'pending';
  /** Current partial credit of the ACTIVE milestone (1 for completed). */
  partial: number;
  bestPartial: number;
  completedAtPly: number | null;
}

/** Top-level conjunct of a completion predicate + its partial credit (coach input). */
export interface ConjunctCredit {
  src: string;
  partial: number;
}

export interface HumanPlyEvent {
  ply: number;
  san: string;
  side: Side;
  fenAfter: string;
  moveNumber: number;
  inCheck: boolean;
  captured?: string;
  promotion?: string;
  milestones: HumanMilestoneSnapshot[];
  activeMilestoneId: string | null;
  gameOver: boolean;
  endReason?: string;
  result?: string;
}

export interface HumanRecord {
  id: string;
  mode: 'human';
  directiveId: string;
  directive: string;
  elo: number;
  /** The HUMAN's side (Marionette's side in the plan's eyes). */
  side: Side;
  status: 'active' | 'finished' | 'error';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  report?: HumanReport;
  fen: string;
  yourTurn: boolean;
  plies: number;
  events: HumanPlyEvent[];
  planSummary: string;
  planMilestones: CompiledMilestoneSpec[];
  opponentEmulated: boolean;
}

export interface HumanReport {
  mode: 'human';
  directiveId: string;
  directive: string;
  selfColor: Side;
  opponentElo: number;
  opponentEmulated: boolean;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  endReason: string;
  terminalMet: boolean;
  plies: number;
  moveNumber: number;
  milestones: (ReportMilestone & { endPartial: number; conjuncts: ConjunctCredit[] })[];
  finalPositionTrue: string[];
  violations: { id: string; description: string; atPly: number }[];
  replans: [];
  planSummary: string;
  planFromCache: boolean;
  judge: JudgeVerdict | null;
  pgn: string;
  startedAt: string;
  finishedAt: string;
  notes: string[];
}

interface HumanGame {
  id: string;
  directiveId: string;
  directive: string;
  elo: number;
  side: Side;
  status: 'active' | 'finished';
  startedAt: string;
  finishedAt?: string;
  game: Chess;
  tracker: InstanceType<typeof core.PlanTracker>;
  compiled: unknown;
  compiledPlan: { summary: string; milestones: CompiledMilestoneSpec[] };
  oppEng: InstanceType<typeof uci.UciEngine>;
  oppSetup: { emulated: boolean; skillLevel?: number; depthCap: number };
  rng: () => number;
  checkFlags: boolean[];
  maxPlies: number;
  events: HumanPlyEvent[];
  report?: HumanReport;
  notes: string[];
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

/** Split a predicate string into top-level '&&' conjuncts (paren-aware). */
function splitTopLevelAnd(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && ch === '&' && src[i + 1] === '&') {
      parts.push(cur.trim());
      cur = '';
      i++; // skip the second '&'
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) parts.push(cur.trim());
  return parts.length > 0 ? parts : [src.trim()];
}

function conjunctCredits(src: string, ctx: unknown, compiledCompletion: unknown): ConjunctCredit[] {
  // conjunctPartials(ast, ctx) aligns with the top-level '&&' conjuncts.
  const parts = (core as unknown as { conjunctPartials?: (ast: unknown, ctx: unknown) => number[] }).conjunctPartials?.(
    (compiledCompletion as { ast?: unknown })?.ast ?? null,
    ctx,
  );
  const srcs = splitTopLevelAnd(src);
  if (!parts || parts.length === 0) {
    return [{ src, partial: 0 }];
  }
  return srcs.map((s, i) => ({ src: s, partial: parts[i] ?? 0 }));
}

function resultOf(game: Chess, endReason: string): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (endReason === 'checkmate') return game.turn() === 'w' ? '0-1' : '1-0';
  if (['stalemate', 'insufficient_material', 'threefold_repetition', 'draw'].includes(endReason)) return '1/2-1/2';
  if (endReason === 'resignation') return game.turn() === 'w' ? '0-1' : '1-0';
  return '*';
}

function snapshotOf(g: HumanGame): HumanMilestoneSnapshot[] {
  const ctx = core.buildContext(g.game, g.side, { evalWhiteCp: null, mateWhite: null }, g.checkFlags);
  const activeIdx = g.tracker.activeIndex();
  return g.compiledPlan.milestones.map((m, i) => {
    const st = g.tracker.states[i]!;
    const compiled = (g.tracker.plan as { milestones: { spec: CompiledMilestoneSpec; completion: unknown }[] }).milestones[i]!;
    return {
      id: m.id,
      description: m.description,
      completion: m.completion,
      weight: m.weight,
      status: st.completed ? 'completed' : i === activeIdx ? 'active' : 'pending',
      partial: st.completed ? 1 : i === activeIdx ? core.predicatePartial(compiled.completion, ctx) : st.bestPartial,
      bestPartial: st.bestPartial,
      completedAtPly: st.completedAtPly ?? null,
    };
  });
}

function pushPlyEvent(g: HumanGame, san: string, side: Side, verbose?: { captured?: string; promotion?: string }): HumanPlyEvent {
  const ply = g.game.history().length;
  g.checkFlags.push(g.game.isCheck());
  const ctx = core.buildContext(g.game, g.side, { evalWhiteCp: null, mateWhite: null }, g.checkFlags);
  const upd = g.tracker.update(ctx, ply);
  void upd;
  const milestones = snapshotOf(g);
  const gameOver = g.game.isGameOver() || ply >= g.maxPlies;
  const endReason = gameOver ? detectEnd(g.game, g.maxPlies) : undefined;
  const ev: HumanPlyEvent = {
    ply,
    san,
    side,
    fenAfter: g.game.fen(),
    moveNumber: Math.floor((ply + 1) / 2),
    inCheck: g.game.isCheck(),
    captured: verbose?.captured,
    promotion: verbose?.promotion,
    milestones,
    activeMilestoneId: ((): string | null => {
      const ai = g.tracker.activeIndex();
      return ai == null ? null : g.compiledPlan.milestones[ai]!.id;
    })(),
    gameOver,
    endReason,
    result: endReason ? resultOf(g.game, endReason) : undefined,
  };
  g.events.push(ev);
  return ev;
}

async function opponentReply(g: HumanGame): Promise<HumanPlyEvent | null> {
  if (g.game.isGameOver() || g.game.history().length >= g.maxPlies) return null;
  let uciMove: string;
  if (!g.oppSetup.emulated) {
    uciMove = await g.oppEng.bestMove(g.game.fen(), { depth: 16 });
  } else {
    const a = await g.oppEng.analyse(g.game.fen(), { depth: g.oppSetup.depthCap, multiPV: 4 });
    uciMove = uci.pickEmulatedMove(a, g.elo, g.rng);
  }
  const verbose = (g.game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; captured?: string; san: string }[]).find(
    (m) => m.from + m.to + (m.promotion ?? '') === uciMove,
  );
  let san: string;
  if (!verbose) {
    const any = (g.game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[])[0]!;
    g.game.move({ from: any.from, to: any.to, promotion: any.promotion });
    san = any.san;
    g.notes.push(`opponent move ${uciMove} illegal at ply ${g.game.history().length}; played first legal move instead`);
  } else {
    g.game.move({ from: verbose.from, to: verbose.to, promotion: verbose.promotion });
    san = verbose.san;
  }
  return pushPlyEvent(g, san, (g.game.turn() === 'w' ? 'b' : 'w') as Side, verbose);
}

function finishHumanGame(g: HumanGame, forcedEndReason?: string): HumanReport {
  const endReason = forcedEndReason ?? detectEnd(g.game, g.maxPlies);
  const result = resultOf(g.game, endReason);
  // Final predicate pass (mirrors the runner's end-of-game honesty pass).
  const finalCtx = core.buildContext(g.game, g.side, { evalWhiteCp: null, mateWhite: null }, g.checkFlags);
  g.tracker.update(finalCtx, g.game.history().length);
  const terminal = core.terminalMet(g.compiled, finalCtx);
  const finalTrue: string[] = [];
  const compiledMsList = (g.tracker.plan as { milestones: { spec: CompiledMilestoneSpec; completion: unknown }[] }).milestones;
  const milestones: (ReportMilestone & { endPartial: number; conjuncts: ConjunctCredit[] })[] = g.compiledPlan.milestones.map((m, i) => {
    const st = g.tracker.states[i]!;
    const compiledMs = compiledMsList[i]!;
    const trueAtEnd = core.evalPredicate(compiledMs.completion, finalCtx);
    if (trueAtEnd) finalTrue.push(m.id);
    return {
      id: m.id,
      description: m.description,
      completion: m.completion,
      tolerance: m.tolerance,
      weight: m.weight,
      completed: st.completed,
      completedAtPly: st.completedAtPly,
      bestPartial: st.completed ? 1 : st.bestPartial,
      endPartial: core.predicatePartial(compiledMs.completion, finalCtx),
      conjuncts: conjunctCredits(m.completion, finalCtx, compiledMs.completion),
      trueAtEnd,
    };
  });
  const plies = g.game.history().length;
  const pgnGame = new Chess();
  pgnGame.header('Event', 'Marionette human challenge');
  pgnGame.header('Site', 'marionette-web');
  pgnGame.header('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  pgnGame.header('White', g.side === 'w' ? 'Human (Marionette)' : `Stockfish-19 (Elo ${g.elo})`);
  pgnGame.header('Black', g.side === 'b' ? 'Human (Marionette)' : `Stockfish-19 (Elo ${g.elo})`);
  pgnGame.header('Result', result);
  pgnGame.header('Annotator', `directive: ${g.directive}`);
  for (const san of g.game.history()) {
    try {
      pgnGame.move(san);
    } catch {
      break;
    }
  }
  const report: HumanReport = {
    mode: 'human',
    directiveId: g.directiveId,
    directive: g.directive,
    selfColor: g.side,
    opponentElo: g.elo,
    opponentEmulated: g.oppSetup.emulated,
    result,
    endReason,
    terminalMet: terminal,
    plies,
    moveNumber: Math.floor((plies + 1) / 2),
    milestones,
    finalPositionTrue: finalTrue,
    violations: g.tracker.violations(),
    replans: [],
    planSummary: g.compiledPlan.summary,
    planFromCache: true,
    judge: null,
    pgn: pgnGame.pgn(),
    startedAt: g.startedAt,
    finishedAt: new Date().toISOString(),
    notes: [...g.notes],
  };
  g.report = report;
  g.status = 'finished';
  g.finishedAt = report.finishedAt;
  return report;
}

export class HumanGameManager {
  private games = new Map<string, HumanGame>();

  get count(): number {
    return [...this.games.values()].filter((g) => g.status === 'active').length;
  }

  get(id: string): HumanRecord | null {
    const g = this.games.get(id);
    if (!g) return null;
    return {
      id: g.id,
      mode: 'human',
      directiveId: g.directiveId,
      directive: g.directive,
      elo: g.elo,
      side: g.side,
      status: g.status,
      startedAt: g.startedAt,
      finishedAt: g.finishedAt,
      error: undefined,
      report: g.report,
      fen: g.game.fen(),
      yourTurn: g.status === 'active' && g.game.turn() === g.side,
      plies: g.game.history().length,
      events: g.events,
      planSummary: g.compiledPlan.summary,
      planMilestones: g.compiledPlan.milestones,
      opponentEmulated: g.oppSetup.emulated,
    };
  }

  async start(opts: { gameId: string; directiveId: string; directive: string; elo: number; side: Side; seed: number }): Promise<HumanRecord> {
    const t0 = Date.now();
    // Offline compile from the committed plan store — a cache miss is an
    // honest error, never an LLM call.
    const compile = await core.compileDirectivePlan({
      directive: opts.directive,
      selfColor: opts.side,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      llm: null,
      fromCacheOnly: true,
      cacheDir: PLAN_CACHE_DIR,
    });
    const compiledPlan = {
      summary: compile.compiled.plan.summary,
      milestones: compile.compiled.plan.milestones,
    };
    const oppEng = await uci.UciEngine.spawn(STOCKFISH_PATH);
    const oppSetup = await uci.configureStrength(oppEng, { elo: opts.elo });
    await oppEng.newGame();
    const g: HumanGame = {
      id: opts.gameId,
      directiveId: opts.directiveId,
      directive: opts.directive,
      elo: opts.elo,
      side: opts.side,
      status: 'active',
      startedAt: new Date().toISOString(),
      game: new Chess(),
      tracker: new core.PlanTracker(compile.compiled, opts.side, 0),
      compiled: compile.compiled,
      compiledPlan,
      oppEng,
      oppSetup,
      rng: uci.mulberry32(opts.seed),
      checkFlags: [],
      maxPlies: 300,
      events: [],
      notes: [
        `human challenge started in ${Date.now() - t0}ms (plan ${compile.fromCache ? 'from cache' : compile.provider})`,
        oppSetup.emulated
          ? `opponent Elo ${opts.elo} is below the native UCI_Elo floor (1320): emulated with Skill Level ${oppSetup.skillLevel}, depth cap ${oppSetup.depthCap}, eval-weighted move choice`
          : `opponent Elo ${opts.elo} native UCI_Elo`,
      ],
    };
    this.games.set(g.id, g);
    return this.get(g.id)!;
  }

  /** Apply the human's move, score it, and let the opponent reply. */
  async move(id: string, from: string, to: string, promotion?: string): Promise<{ ok: true; events: HumanPlyEvent[]; record: HumanRecord } | { ok: false; error: string }> {
    const g = this.games.get(id);
    if (!g) return { ok: false, error: 'unknown game id' };
    if (g.status !== 'active') return { ok: false, error: 'game is not active' };
    if (g.game.turn() !== g.side) return { ok: false, error: 'not your turn' };
    let verbose: { from: string; to: string; promotion?: string; captured?: string; san: string } | undefined;
    try {
      verbose = (g.game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; captured?: string; san: string }[]).find(
        (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === (promotion ?? 'q')),
      );
      if (!verbose) {
        g.game.move({ from, to, promotion: promotion ?? undefined });
        // find the played move for metadata
        const hist = g.game.history({ verbose: true }) as { from: string; to: string; promotion?: string; captured?: string; san: string }[];
        verbose = hist[hist.length - 1];
      } else {
        g.game.move({ from: verbose.from, to: verbose.to, promotion: verbose.promotion });
      }
    } catch {
      return { ok: false, error: 'illegal move' };
    }
    if (!verbose) return { ok: false, error: 'illegal move' };

    const events: HumanPlyEvent[] = [];
    events.push(pushPlyEvent(g, verbose.san, g.side, verbose));
    const oppEv = await opponentReply(g);
    if (oppEv) events.push(oppEv);

    if (g.status === 'active' && (g.game.isGameOver() || g.game.history().length >= g.maxPlies)) {
      finishHumanGame(g);
    }
    return { ok: true, events, record: this.get(id)! };
  }

  resign(id: string): { ok: boolean; error?: string; record?: HumanRecord } {
    const g = this.games.get(id);
    if (!g) return { ok: false, error: 'unknown game id' };
    if (g.status !== 'active') return { ok: false, error: 'game is not active' };
    // Resignation: the side to move concedes. If it is not the human's turn,
    // flip the result honestly by using the standard mate-result mapping on
    // the human's color instead.
    const result: '1-0' | '0-1' = g.side === 'w' ? '0-1' : '1-0';
    const report = finishHumanGame(g, 'resignation');
    report.result = result;
    return { ok: true, record: this.get(id)! };
  }

  async shutdown(): Promise<void> {
    for (const g of this.games.values()) {
      if (g.status === 'active') {
        g.status = 'finished';
        g.finishedAt = new Date().toISOString();
        g.notes.push('service shutdown: game abandoned');
      }
      await g.oppEng.quit().catch(() => undefined);
    }
  }
}

export function toGameReportShape(r: HumanReport): GameReport & { mode: string; directiveId: string; endPartial?: Record<string, number> } {
  return {
    ...r,
    mode: 'human',
    directiveId: r.directiveId,
    notes: r.notes,
    acplSelf: null,
    steeredMoves: 0,
    marionetteMoves: r.plies,
    evalTrail: [],
    snapshots: [],
    steeringTrail: undefined,
    planProvider: 'cache',
    planModel: 'offline',
    steerDepth: 0,
    steerMultiPV: 0,
    elapsedMs: 0,
  } as GameReport & { mode: string; directiveId: string };
}
