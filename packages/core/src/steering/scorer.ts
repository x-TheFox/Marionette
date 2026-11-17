import type { GameContext } from '../dsl/types.js';
import type { CompiledPlan, CompiledMilestone, Milestone } from '../plan/schema.js';
import { extractGradientAtoms, atomGradientValue } from '../dsl/index.js';

/**
 * Steering score for one candidate move:
 *
 *   score(c) = wProg · Δprogress(c) − λ(milestone) · evalLoss(c) + bonus(c)
 *
 * All quantities are self-perspective centipawn-ish units. Δprogress is the
 * change in the active milestone's partial credit (plus a completion bonus when
 * a milestone finishes). evalLoss compares the candidate's position eval with
 * the best available one. λ adapts to the milestone's tolerance: "loose"
 * milestones (sacrifices are the point) get a small λ, "tight" ones a large λ.
 */

export const LAMBDA_BY_TOLERANCE = { loose: 0.12, medium: 0.6, tight: 2.4 } as const;

/**
 * Steering progress semantics for multi-conjunct milestones (D1/D6 lesson):
 *
 * `partialCredit` (AND = min) is the FACT the tracker reports, but steering on
 * the min alone is blind in two ways:
 *  1. When one conjunct binds (e.g. piece_count(self,pawn)==0 at 0.2), work on
 *     the others never moves the min — real shedding looks like a stall.
 *  2. A conjunct that is exactly satisfied (piece_count(self,queen)==1 at 1.0)
 *     costs only its tiny symmetric falloff when broken — the engine happily
 *     trades the queen away (D6) or lets pawns fall (D1).
 *
 * So the steering value of a milestone in a position is the MEAN of its
 * top-level conjunct credits, minus a large guard penalty for every conjunct
 * that was satisfied before the move and is broken in that position:
 *
 *   V(ctx) = mean(conjunct partials) − γ · #{i: before[i] ≥ 1−ε ∧ ctx[i] < 1−ε}
 *
 * γ=0.5 makes breaking a satisfied exact-count conjunct cost like losing half
 * the milestone — it dominates any eval saving the trade could buy.
 */
export const GUARD_GAMMA = 0.5;
export const SATISFIED_EPS = 1e-3;

/** Blend weights for the two reply models used in the lookahead. */
export const PV_REPLY_BLEND = 0.55;
/** Weight of the "greedy capture" reply model (see steer.ts). */
export const GREEDY_REPLY_BLEND = 0.35;

/** Steering value of a milestone's conjunct partials relative to `before`. */
export function guardedValue(partials: number[], before: number[]): number {
  if (partials.length === 0) return 0;
  let sum = 0;
  let drops = 0;
  for (let i = 0; i < partials.length; i++) {
    sum += partials[i]!;
    if (before[i] != null && before[i]! >= 1 - SATISFIED_EPS && partials[i]! < 1 - SATISFIED_EPS) {
      drops++;
    }
  }
  return sum / partials.length - GUARD_GAMMA * drops;
}

/** Progress weight scaled by the milestone's importance (weight 1..5). */
export function progressWeight(m: Milestone): number {
  return 40 + m.weight * 8;
}

/** Bonus granted the moment a milestone completes (dominates eval loss). */
export function completionBonus(m: Milestone): number {
  return 300 + m.weight * 40;
}

export interface ScoreParts {
  /** Δ progress contribution (already weighted + completion bonus). */
  progress: number;
  /** Negative λ·evalLoss contribution (≤ 0). */
  evalCost: number;
  /** Style + terminal bonuses. */
  bonus: number;
  total: number;
}

/** Self-perspective eval of an analysis line, mate scores folded into cp. */
export function lineSelfCp(
  mateSTM: number | null,
  cpSTM: number | null,
  fenTurn: 'w' | 'b',
  self: 'w' | 'b',
): number {
  const white = mateSTM != null
    ? mateSTM > 0
      ? 10_000 - mateSTM * 50
      : -(10_000 - Math.abs(mateSTM) * 50)
    : cpSTM ?? 0;
  // STM-centric → white-centric → self-centric.
  const stmIsWhite = fenTurn === 'w';
  const whiteCp = stmIsWhite ? white : -white;
  return self === 'w' ? whiteCp : -whiteCp;
}

export interface ScoreInput {
  /** Δ partial credit of the active milestone (after − before), clamped [-1, 1]. */
  deltaProgress: number;
  /** true when this candidate completes the active milestone. */
  completes: boolean;
  /** true when this candidate immediately achieves the terminal condition. */
  achievesTerminal: boolean;
  /** Game would end while milestones remain incomplete (directive failure). */
  prematureEnd?: boolean;
  /** Candidate's self-perspective eval, in cp. */
  evalSelfCp: number;
  /** Best eval among all candidates (self-perspective), in cp. */
  bestEvalSelfCp: number;
  /** Opponent's best eval among all candidates (their perspective), for "force me into winning" style goals. */
  oppBestEvalSelfCp?: number;
  /** Candidate's opponent-perspective eval (their view), if computed. */
  oppEvalSelfCp?: number;
}

export interface ScoreContext {
  milestone: CompiledMilestone | null;
  plan: CompiledPlan;
  /** GameContext after the candidate move (for style bonuses). */
  ctxAfter: GameContext;
  /** Current GameContext (before the move). */
  ctxNow: GameContext;
  /** Deterministic RNG for style jitter (use a seeded PRNG for reproducible games). */
  rng?: () => number;
}

/**
 * True when the milestone's own gradient says "get rid of own material": a
 * self-side atom whose target is BELOW the current value (material(self),
 * non_pawn_count(self), piece_count(self, pawn), ...) or whose own pieces
 * must be captured (captured_value(self) >= n). For such milestones losing
 * eval is the POINT, so the behind-guard must not price it out.
 */
export function isSheddingMilestone(m: CompiledMilestone | null, ctx: GameContext): boolean {
  if (!m) return false;
  const atoms = extractGradientAtoms(m.completion.ast);
  return atoms.some((a) => {
    if (a.sides[0] == null) return false;
    const side =
      a.sides[0] === 'self' ? ctx.self : a.sides[0] === 'opp' ? (ctx.self === 'w' ? 'b' : 'w') : a.sides[0] as 'w' | 'b';
    if (side !== ctx.self) return false;
    if (a.fn === 'captured_value') return a.op != null && ['>=', '>', '=='].includes(a.op) && (a.target ?? 0) > 0;
    if (a.op == null || a.target == null) return false;
    if (!['material', 'non_pawn_count', 'piece_count'].includes(a.fn)) return false;
    if (!['<', '<=', '=='].includes(a.op)) return false;
    const g = atomGradientValue(a, ctx);
    return a.target < g;
  });
}

/**
 * λ for the current steering state. Adapts beyond the static tolerance map:
 *   - terminal_first plans raise λ once the terminal is in reach (protect the
 *     result), unless the terminal itself wants a loss/draw (λ drops instead);
 *   - when the plan is behind its terminal target (must win but eval < 0), λ
 *     rises so the engine stops volunteering material for failed milestones —
 *     EXCEPT when the active milestone is itself a shedding milestone: being
 *     "behind" is intrinsic to shedding (D6: K+Q vs a full army is always
 *     material-down), and raising λ there makes the directive unexecutable.
 */
export function lambdaFor(sc: Pick<ScoreContext, 'milestone' | 'plan'>, ctxNow: GameContext): number {
  const tol = sc.milestone?.spec.tolerance ?? 'tight';
  let λ: number = LAMBDA_BY_TOLERANCE[tol];
  const t = sc.plan.plan.terminal;
  const winningTarget = t.kind === 'win' || (t.kind === 'pattern' && t.priority === 'terminal_first');
  const selfEval = ctxNow.evalWhiteCp == null ? 0 : (ctxNow.self === 'w' ? ctxNow.evalWhiteCp : -ctxNow.evalWhiteCp);
  const shedding = isSheddingMilestone(sc.milestone ?? null, ctxNow);
  // A shedding milestone's eval damage IS its progress: cap its lambda at the
  // loose level no matter what tolerance the plan declared (the D6 plan left
  // reduce_to_kq at the 'medium' default and every offer priced out at
  // lambda 0.6 - shedding crawled and blew the 80-ply move budget one capture
  // short of K+Q).
  if (shedding) λ = Math.min(λ, LAMBDA_BY_TOLERANCE.loose);
  if (winningTarget && selfEval < -150 && !shedding) λ = Math.max(λ, 1.2); // behind: stop the bleeding
  if (t.kind === 'lose' || t.kind === 'draw') λ = Math.min(λ, 0.6); // losing/drawing terminal: eval damage is not the enemy
  if (t.priority === 'terminal_first') λ *= 1.6;
  return λ;
}

/** Style bonus for a candidate — small, bounded, documented. */
export function styleBonus(sc: Pick<ScoreContext, 'plan' | 'ctxAfter' | 'ctxNow'>): number {
  const style = sc.plan.plan.style;
  if (style === 'none') return 0;
  const after = sc.ctxAfter;
  let b = 0;
  if (style === 'aggressive' || style === 'humiliating') {
    if (after.lastMove?.wasCheck) b += 0.8;
    if (after.lastMove?.captured != null) b += 0.6;
    if (style === 'humiliating' && after.material[after.self] > after.material[after.self === 'w' ? 'b' : 'w'] + 400) b += 0.5;
  }
  if (style === 'looks_strong' || style === 'natural') {
    // Reward "normal" development/castling moves so the engine looks alive.
    if (after.castled[after.self] && !sc.ctxNow.castled[after.self]) b += 0.6;
  }
  return b;
}

/** Full score of one candidate. Returns parts + total (−Infinity = excluded). */
export function scoreCandidate(input: ScoreInput, sc: ScoreContext, λ: number): ScoreParts {
  const w = sc.milestone ? progressWeight(sc.milestone.spec) : 0;
  const progress = w * clamp1(input.deltaProgress) + (input.completes && sc.milestone ? completionBonus(sc.milestone.spec) : 0);
  const evalLoss = Math.max(0, input.bestEvalSelfCp - input.evalSelfCp) / 100;
  const evalCost = -λ * evalLoss;
  let bonus = styleBonus(sc);
  if (input.achievesTerminal) bonus += 12_000;
  if (input.prematureEnd) bonus -= 2_000;
  // Aggressive defense of the terminal: a forced mate against us when we must
  // win is catastrophic — engine evals already encode it, add a soft guard.
  if (sc.plan.plan.terminal.kind === 'win' && input.evalSelfCp <= -(10_000 - 200)) bonus -= 3_000;
  const total = progress + evalCost + bonus;
  return { progress, evalCost, bonus, total };
}

function clamp1(x: number): number {
  return Math.max(-1, Math.min(1, x));
}
