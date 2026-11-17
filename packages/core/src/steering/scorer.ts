import type { GameContext } from '../dsl/types.js';
import type { CompiledPlan, Milestone } from '../plan/schema.js';

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
  milestone: Milestone | null;
  plan: CompiledPlan;
  /** GameContext after the candidate move (for style bonuses). */
  ctxAfter: GameContext;
  /** Current GameContext (before the move). */
  ctxNow: GameContext;
  /** Deterministic RNG for style jitter (use a seeded PRNG for reproducible games). */
  rng?: () => number;
}

/**
 * λ for the current steering state. Adapts beyond the static tolerance map:
 *   - terminal_first plans raise λ once the terminal is in reach (protect the
 *     result), unless the terminal itself wants a loss/draw (λ drops instead);
 *   - when the plan is behind its terminal target (must win but eval < 0), λ
 *     rises so the engine stops volunteering material for failed milestones.
 */
export function lambdaFor(sc: Pick<ScoreContext, 'milestone' | 'plan'>, ctxNow: GameContext): number {
  const tol = sc.milestone?.tolerance ?? 'tight';
  let λ: number = LAMBDA_BY_TOLERANCE[tol];
  const t = sc.plan.plan.terminal;
  const winningTarget = t.kind === 'win' || (t.kind === 'pattern' && t.priority === 'terminal_first');
  const selfEval = ctxNow.evalWhiteCp == null ? 0 : (ctxNow.self === 'w' ? ctxNow.evalWhiteCp : -ctxNow.evalWhiteCp);
  if (winningTarget && selfEval < -150) λ = Math.max(λ, 1.2); // behind: stop the bleeding
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
  const w = sc.milestone ? progressWeight(sc.milestone) : 0;
  const progress = w * clamp1(input.deltaProgress) + (input.completes && sc.milestone ? completionBonus(sc.milestone) : 0);
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
