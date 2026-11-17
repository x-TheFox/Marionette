import { Chess } from 'chess.js';
import type { UciEngine, Analysis, PvLine } from '@marionette/uci';
import { buildContext, evalPredicate, conjunctPartials } from '../dsl/index.js';
import type { GameContext, PieceType, Side } from '../dsl/types.js';
import { constraintsInForce, type CompiledPlan } from '../plan/schema.js';
import { scoreCandidate, lambdaFor, guardedValue, PV_REPLY_BLEND, GREEDY_REPLY_BLEND } from './scorer.js';
import { motivatedCandidates, PIECE_VAL, type Candidate } from './candidates.js';
import type { PlanTracker } from '../game/tracker.js';

/**
 * One steering decision: pick Marionette's move for the current position.
 *
 * Candidates = engine MultiPV top-N + motivated extras for the active
 * milestone. Each candidate is scored with
 *   wProg·Δprogress − λ·evalLoss + style/terminal bonuses
 * after a shallow PV lookahead (progress must survive the engine's expected
 * reply). Enforced hard constraints are a hard filter, not a penalty.
 */

export interface SteerOptions {
  engine: UciEngine;
  game: Chess;
  self: Side;
  compiled: CompiledPlan;
  tracker: PlanTracker;
  /** Root search depth for candidate evals (default 14). */
  evalDepth?: number;
  /** MultiPV width for the root search (default 5, max 5). */
  multiPV?: number;
  /** Depth for individually-evaluated motivated candidates (default 12). */
  motivatedDepth?: number;
  /** Eval of the current position, white-centric (e.g. from the previous search). */
  currentEvalWhiteCp?: number | null;
  /** Check flags for the current history (one per ply). */
  checkFlags?: boolean[];
  rng?: () => number;
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

export interface SteerDecision {
  uci: string;
  san: string;
  activeMilestoneId: string | null;
  lambda: number;
  evalWhiteCp: number;
  mateWhite: number | null;
  candidates: CandidateScore[];
  /** true when fallback mode (all milestones complete / no active milestone). */
  fallback: boolean;
}

interface EvaluatedCandidate {
  cand: Candidate;
  fenAfter: string;
  gameAfter: Chess;
  ctxAfter: GameContext;
  pvUci: string[];
  evalSelfCp: number;
  evalWhiteCp: number;
  mateWhite: number | null;
  givesCheck: boolean;
}

export async function steerMove(opts: SteerOptions): Promise<SteerDecision> {
  const {
    engine, game, self, compiled, tracker,
    evalDepth = 14,
    multiPV = 5,
    motivatedDepth = 12,
    checkFlags = [],
    rng = Math.random,
  } = opts;

  const fen = game.fen();
  const activeIdx = tracker.activeIndex();
  const fallback = activeIdx == null;
  const active = activeIdx != null ? compiled.milestones[activeIdx]! : null;

  // 1. Root search: engine's own candidate list + their evals.
  const analysis: Analysis = await engine.analyse(fen, { depth: evalDepth, multiPV: Math.min(multiPV, 5) });
  const topLine: PvLine | undefined = analysis.lines[0];
  const currentEvalWhite = topLine
    ? (fen.split(' ')[1] === 'b' ? -(topLine.cpSTM ?? 0) : topLine.cpSTM ?? 0)
    : (opts.currentEvalWhiteCp ?? 0);
  const currentMateWhite = topLine?.mateSTM != null
    ? (fen.split(' ')[1] === 'b' ? -topLine.mateSTM : topLine.mateSTM)
    : null;

  const ctxNow = buildContext(game, self, { evalWhiteCp: currentEvalWhite, mateWhite: currentMateWhite }, checkFlags);
  const lambda = lambdaFor({ milestone: active?.spec ?? null, plan: compiled }, ctxNow);

  // 2. Candidate list: engine lines + motivated extras.
  const verboseMoves = new Map<string, { from: string; to: string; promotion?: string; san: string }>(
    (game.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[]).map((m) => [
      m.from + m.to + (m.promotion ?? ''), m,
    ]),
  );

  const candidates: Candidate[] = analysis.lines.map((l) => ({
    uci: l.move,
    san: verboseMoves.get(l.move)?.san ?? l.move,
    source: 'engine' as const,
    motive: `engine top-${l.multipv}`,
  }));
  const engineUcis = new Set(candidates.map((c) => c.uci));
  const motivated = fallback
    ? []
    : motivatedCandidates(compiled, ctxNow, activeIdx!, engineUcis);
  candidates.push(...motivated);

  // 3. Evaluate each candidate position.
  const evaluated: EvaluatedCandidate[] = [];
  for (const cand of candidates) {
    const mv = verboseMoves.get(cand.uci);
    if (!mv) continue; // engine line without a legal match (should not happen)
    const probe = new Chess(fen);
    try {
      probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      continue;
    }
    const fenAfter = probe.fen();

    let evalWhiteCp: number;
    let mateWhite: number | null = null;
    let pvUci: string[] = [];
    if (cand.source === 'engine') {
      const line = analysis.lines.find((l) => l.move === cand.uci)!;
      evalWhiteCp = whiteFromStm(line.cpSTM, line.mateSTM, fen);
      mateWhite = line.mateSTM != null ? (fen.split(' ')[1] === 'b' ? -line.mateSTM : line.mateSTM) : null;
      pvUci = line.pv;
    } else {
      const sub = await engine.analyse(fenAfter, { depth: motivatedDepth, multiPV: 1 });
      const l = sub.lines[0];
      evalWhiteCp = whiteFromStm(l?.cpSTM ?? null, l?.mateSTM ?? null, fenAfter);
      mateWhite = l?.mateSTM != null ? (fenAfter.split(' ')[1] === 'b' ? -l.mateSTM : l.mateSTM) : null;
      pvUci = l?.pv ?? [];
    }

    const givesCheck = probe.inCheck();
    const ctxAfter = buildContext(
      probe,
      self,
      { evalWhiteCp, mateWhite },
      [...checkFlags, givesCheck],
    );
    evaluated.push({
      cand,
      fenAfter,
      gameAfter: probe,
      ctxAfter,
      pvUci,
      evalSelfCp: self === 'w' ? evalWhiteCp : -evalWhiteCp,
      evalWhiteCp,
      mateWhite,
      givesCheck,
    });
  }

  if (evaluated.length === 0) {
    // No legal candidate parse (degenerate): hand the engine's raw best move.
    return {
      uci: analysis.bestMove,
      san: verboseMoves.get(analysis.bestMove)?.san ?? analysis.bestMove,
      activeMilestoneId: active?.spec.id ?? null,
      lambda,
      evalWhiteCp: currentEvalWhite,
      mateWhite: currentMateWhite,
      candidates: [],
      fallback,
    };
  }

  const bestEvalSelf = Math.max(...evaluated.map((e) => e.evalSelfCp));

  // 4. Enforced constraints (hard filter, never a score term). Un-gated
  // constraints are in force from the first move; gated ones once their
  // afterMilestone completed. Constraints whose violation condition ALREADY
  // holds in the current position are skipped for filtering — they cannot be
  // un-violated by move choice and the tracker has recorded them; filtering
  // would exclude every candidate and stall the game.
  const completedIds = new Set(
    compiled.milestones.filter((_, i) => tracker.states[i]!.completed).map((m) => m.spec.id),
  );
  const enforced = constraintsInForce(compiled, completedIds).filter(
    (c) => !evalPredicate(c.violation, ctxNow),
  );

  // 5. Score with PV lookahead.
  const scored: CandidateScore[] = evaluated.map((e) => {
    const sc: CandidateScore = {
      uci: e.cand.uci,
      san: e.cand.san,
      source: e.cand.source,
      motive: e.cand.motive,
      evalSelfCp: e.evalSelfCp,
      deltaProgress: 0,
      completes: false,
    };
    for (const c of enforced) {
      if (evalPredicate(c.violation, e.ctxAfter)) {
        sc.excluded = `constraint ${c.spec.id}`;
        break;
      }
    }
    if (sc.excluded) return sc;

    let delta = 0;
    let completes = false;
    if (active) {
      completes = evalPredicate(active.completion, e.ctxAfter);
      // D1/D6 semantics: progress = guarded MEAN conjunct movement, blended
      // over two reply models — the engine's expected (best-defense) reply and
      // a greedy-capture reply. A single best-defense reply undervalues offers
      // whenever the engine prefers defending over grabbing (D6: we were
      // attacking so hard the opponent would not take our hanging pieces);
      // the greedy model mirrors the weak opponents we actually face and the
      // isHangingOffer generator that produced the candidate.
      const ast = active.completion.ast;
      const before = conjunctPartials(ast, ctxNow);
      const vNow = guardedValue(before, before);
      const vAfter = guardedValue(conjunctPartials(ast, e.ctxAfter), before);
      delta = vAfter - vNow;
      const ctx2 = lookaheadContext(e, fen, checkFlags, self);
      if (ctx2) {
        const vPv = guardedValue(conjunctPartials(ast, ctx2), before);
        delta += PV_REPLY_BLEND * (vPv - vAfter);
      }
      const ctxG = greedyCaptureContext(e, checkFlags, self);
      if (ctxG) {
        const vG = guardedValue(conjunctPartials(ast, ctxG), before);
        delta += GREEDY_REPLY_BLEND * (vG - vAfter);
      }
    }

    // Terminal: does this candidate end the game the directive wants?
    // The big terminal bonus is only granted when the plan says terminal-first
    // or no milestones remain — otherwise a normal win would dwarf directive
    // progress (D6 lesson). Conversely, ANY candidate that ends the game
    // without a legitimate ending (terminal achieved while eligible, or the
    // active milestone completing — e.g. the final mate milestone) is a
    // directive FAILURE: draws, stalemates and wrong-color mates close the
    // game while the directive is still open.
    const terminal = compiled.plan.terminal;
    const terminalEligible = terminal.priority === 'terminal_first' || activeIdx == null;
    const terminalNow =
      (terminal.kind === 'win' && e.ctxAfter.checkmate && e.ctxAfter.winner === self) ||
      (terminal.kind === 'pattern' && compiled.terminalPattern != null && evalPredicate(compiled.terminalPattern, e.ctxAfter)) ||
      (terminal.kind === 'draw' && e.ctxAfter.draw);
    const achievesTerminal = terminalEligible && terminalNow;
    const legitEnd = achievesTerminal || (activeIdx != null && completes);
    const prematureEnd = e.ctxAfter.over && !legitEnd;

    const parts = scoreCandidate(
      {
        deltaProgress: delta,
        completes,
        achievesTerminal,
        prematureEnd,
        evalSelfCp: e.evalSelfCp,
        bestEvalSelfCp: bestEvalSelf,
      },
      {
        milestone: active?.spec ?? null,
        plan: compiled,
        ctxAfter: e.ctxAfter,
        ctxNow,
        rng,
      },
      lambda,
    );
    sc.deltaProgress = delta;
    sc.completes = completes;
    sc.parts = parts;
    return sc;
  });

  // 6. Pick.
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    if (s.excluded || !s.parts) continue;
    if (s.parts.total > bestScore) {
      bestScore = s.parts.total;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    // Everything excluded: hard constraints must not be violated voluntarily.
    // Before falling back to the engine top line (which violates by
    // construction), search the FULL legal move list for the best move that
    // keeps every enforced constraint false and does not end the game.
    // (D4 lesson: a dominated position where all MultiPV lines mate.)
    const excludedUcis = new Set(scored.map((s) => s.uci));
    let rescue: { uci: string; san: string; evalSelfCp: number; evalWhiteCp: number; mateWhite: number | null } | null = null;
    for (const [uciStr, mv] of verboseMoves) {
      if (excludedUcis.has(uciStr)) continue;
      const probe = new Chess(fen);
      try {
        probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      } catch {
        continue;
      }
      if (probe.isGameOver()) continue; // do not volunteer ANY game end here
      const fenAfter = probe.fen();
      const sub = await engine.analyse(fenAfter, { depth: Math.min(motivatedDepth, 10), multiPV: 1 });
      const l = sub.lines[0];
      const evalWhiteCp = whiteFromStm(l?.cpSTM ?? null, l?.mateSTM ?? null, fenAfter);
      const mateWhite = l?.mateSTM != null ? (fenAfter.split(' ')[1] === 'b' ? -l.mateSTM : l.mateSTM) : null;
      const ctxAfter = buildContext(
        probe,
        self,
        { evalWhiteCp, mateWhite },
        [...checkFlags, probe.inCheck()],
      );
      if (enforced.some((c) => evalPredicate(c.violation, ctxAfter))) continue;
      const evalSelfCp = self === 'w' ? evalWhiteCp : -evalWhiteCp;
      if (rescue == null || evalSelfCp > rescue.evalSelfCp) {
        rescue = { uci: uciStr, san: mv.san, evalSelfCp, evalWhiteCp, mateWhite };
      }
    }
    if (rescue != null) {
      scored.push({
        uci: rescue.uci,
        san: rescue.san,
        source: 'engine',
        motive: 'constraint rescue (all candidates excluded)',
        evalSelfCp: rescue.evalSelfCp,
        deltaProgress: 0,
        completes: false,
        parts: { progress: 0, evalCost: 0, bonus: 0, total: rescue.evalSelfCp / 100 },
      });
      return {
        uci: rescue.uci,
        san: rescue.san,
        activeMilestoneId: active?.spec.id ?? null,
        lambda,
        evalWhiteCp: rescue.evalWhiteCp,
        mateWhite: rescue.mateWhite,
        candidates: scored,
        fallback,
      };
    }
    // No legal move preserves the constraints (truly forced): least-bad =
    // engine top line; the tracker records the violation honestly.
    const engIdx = scored.findIndex((s) => s.source === 'engine');
    bestIdx = engIdx >= 0 ? engIdx : 0;
  }

  const chosen = evaluated[bestIdx]!;
  return {
    uci: chosen.cand.uci,
    san: chosen.cand.san,
    activeMilestoneId: active?.spec.id ?? null,
    lambda,
    evalWhiteCp: chosen.evalWhiteCp,
    mateWhite: chosen.mateWhite,
    candidates: scored,
    fallback,
  };
}

function whiteFromStm(cpSTM: number | null, mateSTM: number | null, fen: string): number {
  if (mateSTM != null) {
    const cp = mateSTM > 0 ? 10_000 - mateSTM * 50 : -(10_000 - Math.abs(mateSTM) * 50);
    return fen.split(' ')[1] === 'b' ? -cp : cp;
  }
  const cp = cpSTM ?? 0;
  return fen.split(' ')[1] === 'b' ? -cp : cp;
}

/** Build the context after the candidate + first PV reply (lookahead). */
function lookaheadContext(
  e: EvaluatedCandidate,
  fenBefore: string,
  checkFlags: boolean[],
  self: Side,
): GameContext | null {
  const reply = e.pvUci[1]; // [0] = our move, [1] = opponent reply
  if (!reply) return null;
  const g = new Chess(e.fenAfter);
  const mv = { from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4) || undefined };
  try {
    g.move({ from: mv.from, to: mv.to, promotion: (mv.promotion || 'q') as never });
  } catch {
    return null;
  }
  const givesCheck = g.inCheck();
  return buildContext(g, self, { evalWhiteCp: e.evalWhiteCp, mateWhite: e.mateWhite }, [...checkFlags, e.givesCheck, givesCheck]);
}

interface VerboseMoveLite {
  from: string;
  to: string;
  promotion?: string;
  captured?: string;
  piece: string;
}

/**
 * Context after the opponent's most greedy material capture (deterministic,
 * chess.js-only, no engine cost). "Greedy" mirrors the isHangingOffer
 * generator: a capture that wins material (victim − capturer ≥ 100) or grabs
 * big loot (victim ≥ 500); among those, the highest net gain wins. Models the
 * weak opponents the directive games actually run against.
 */
function greedyCaptureContext(
  e: EvaluatedCandidate,
  checkFlags: boolean[],
  self: Side,
): GameContext | null {
  const g = new Chess(e.fenAfter);
  const replies = g.moves({ verbose: true }) as VerboseMoveLite[];
  let best: VerboseMoveLite | null = null;
  let bestNet = 0;
  for (const r of replies) {
    if (!r.captured) continue;
    const victim = PIECE_VAL[r.captured as PieceType] ?? 0;
    const capturer = PIECE_VAL[(r.promotion ?? r.piece) as PieceType] ?? 0;
    const net = victim - capturer;
    const takes = net >= 100 || victim >= 500;
    if (takes && net > bestNet) {
      bestNet = net;
      best = r;
    }
  }
  if (!best) return null;
  try {
    g.move({ from: best.from, to: best.to, promotion: best.promotion });
  } catch {
    return null;
  }
  return buildContext(
    g,
    self,
    { evalWhiteCp: e.evalWhiteCp, mateWhite: e.mateWhite },
    [...checkFlags, e.givesCheck, g.inCheck()],
  );
}


