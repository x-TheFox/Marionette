import type { CompiledPlan } from '../plan/schema.js';
import { constraintsInForce } from '../plan/schema.js';
import { evalPredicate, predicatePartial, conjunctPartials } from '../dsl/index.js';
import type { GameContext, Side } from '../dsl/types.js';
import type { ProgressReport } from '../compiler/prompt.js';

/**
 * Tracks plan progress during a game: ordered milestone completion, partial
 * credit, infeasibility, move budgets, and constraint violations. Pure
 * functions of the current GameContext — no engine access, fully testable.
 */

export interface MilestoneState {
  completed: boolean;
  completedAtPly?: number;
  /** Ply when this milestone became the active one. */
  startedAtPly: number;
  bestPartial: number;
  bestPartialAtPly: number;
  /** Best MEAN of top-level conjunct partials (stall detection only). */
  bestMean: number;
  bestMeanAtPly: number;
}

export interface ConstraintViolation {
  id: string;
  description: string;
  atPly: number;
}

export interface TrackerUpdate {
  /** Milestone ids that completed on this update. */
  newlyCompleted: { id: string; description: string; atPly: number }[];
  /** The active milestone reported infeasible by its infeasible predicate. */
  infeasible?: { id: string; reason: string };
  /** A hard constraint went violated this update. */
  violated?: ConstraintViolation;
}

export class PlanTracker {
  readonly plan: CompiledPlan;
  readonly self: Side;
  readonly states: MilestoneState[];
  private _violations: ConstraintViolation[] = [];

  constructor(compiled: CompiledPlan, self: Side, startPly = 0) {
    this.plan = compiled;
    this.self = self;
    this.states = compiled.milestones.map(() => ({
      completed: false,
      startedAtPly: startPly,
      bestPartial: 0,
      bestPartialAtPly: startPly,
      bestMean: 0,
      bestMeanAtPly: startPly,
    }));
    // First milestone is active from the start; the rest activate in order.
    for (let i = 1; i < this.states.length; i++) this.states[i]!.startedAtPly = -1;
  }

  /** Index of the first incomplete milestone, or null when all are complete. */
  activeIndex(): number | null {
    const i = this.states.findIndex((s) => !s.completed);
    return i === -1 ? null : i;
  }

  activeSpec() {
    const i = this.activeIndex();
    return i == null ? null : this.plan.milestones[i]!;
  }

  violations(): ConstraintViolation[] {
    return [...this._violations];
  }

  /**
   * Re-mark completions from scratch against the current position (used after
   * a replan: milestones whose predicates already hold become completed in
   * order until the first that does not).
   */
  rederive(ctx: GameContext, ply: number): void {
    for (let i = 0; i < this.plan.milestones.length; i++) {
      const ms = this.plan.milestones[i]!;
      if (evalPredicate(ms.completion, ctx)) {
        this.states[i]!.completed = true;
        this.states[i]!.completedAtPly = ply;
        this.states[i]!.startedAtPly = ply;
        this.states[i]!.bestPartial = 1;
        this.states[i]!.bestMean = 1;
        this.states[i]!.bestMeanAtPly = ply;
      } else {
        this.states[i]!.startedAtPly = ply;
        this.states[i]!.bestPartial = predicatePartial(ms.completion, ctx);
        this.states[i]!.bestPartialAtPly = ply;
        const parts = conjunctPartials(ms.completion.ast, ctx);
        this.states[i]!.bestMean = parts.length === 0 ? 0 : parts.reduce((a, b) => a + b, 0) / parts.length;
        this.states[i]!.bestMeanAtPly = ply;
        break;
      }
    }
  }

  /** Evaluate one ply of progress. Call after EVERY move (both sides). */
  update(ctx: GameContext, ply: number): TrackerUpdate {
    const update: TrackerUpdate = { newlyCompleted: [] };

    const ai = this.activeIndex();
    if (ai != null) {
      const ms = this.plan.milestones[ai]!;
      const st = this.states[ai]!;
      if (st.startedAtPly < 0) st.startedAtPly = ply;
      if (evalPredicate(ms.completion, ctx)) {
        st.completed = true;
        st.completedAtPly = ply;
        st.bestPartial = 1;
        update.newlyCompleted.push({ id: ms.spec.id, description: ms.spec.description, atPly: ply });
        // Next milestone becomes active now.
        const next = this.states[ai + 1];
        if (next && !next.completed) next.startedAtPly = ply;
      } else {
        const partial = predicatePartial(ms.completion, ctx);
        if (partial > st.bestPartial) {
          st.bestPartial = partial;
          st.bestPartialAtPly = ply;
        }
        // Mean of conjunct partials: real work on a NON-binding conjunct
        // (e.g. shedding pieces while the pawn conjunct binds the min) must
        // not read as a stall — the D6 lesson. Stall needs BOTH frozen.
        const parts = conjunctPartials(ms.completion.ast, ctx);
        const mean = parts.length === 0 ? 0 : parts.reduce((a, b) => a + b, 0) / parts.length;
        if (mean > st.bestMean) {
          st.bestMean = mean;
          st.bestMeanAtPly = ply;
        }
        if (ms.infeasible && evalPredicate(ms.infeasible, ctx)) {
          update.infeasible = {
            id: ms.spec.id,
            reason: ms.spec.infeasible ?? 'infeasible predicate true',
          };
        }
      }
    }

    // Constraints in force: un-gated from the first move, gated ones once
    // their afterMilestone completed. Recorded once, on the first ply where
    // the violation condition holds.
    const completedIds = new Set(
      this.plan.milestones.filter((_, i) => this.states[i]!.completed).map((m) => m.spec.id),
    );
    for (const c of constraintsInForce(this.plan, completedIds)) {
      if (this._violations.some((v) => v.id === c.spec.id)) continue;
      if (evalPredicate(c.violation, ctx)) {
        const v: ConstraintViolation = {
          id: c.spec.id,
          description: c.spec.description,
          atPly: ply,
        };
        this._violations.push(v);
        update.violated = v;
      }
    }

    return update;
  }

  /** Plies spent on the active milestone so far. */
  activePlyCount(ply: number): number {
    const ai = this.activeIndex();
    if (ai == null) return 0;
    const started = this.states[ai]!.startedAtPly;
    return started < 0 ? 0 : ply - started;
  }

  /**
   * True when the active milestone has made no partial progress for `window`
   * plies. Progress means EITHER the min-based partial OR the conjunct mean
   * moved — a milestone whose binding conjunct is frozen while another makes
   * real progress is not stalled (it is mid-shed, not stuck). The clock is
   * anchored to the ACTIVATION ply: a milestone that just became active has a
   * stale constructor-era bestPartialAtPly of 0 and must not read as "no
   * progress for the whole game so far" on its first ply (D1: promote was
   * dropped one ply after reduce_to_pawns completed).
   */
  stalled(ply: number, window = 16): boolean {
    const ai = this.activeIndex();
    if (ai == null) return false;
    const st = this.states[ai]!;
    const anchor = Math.max(st.startedAtPly, 0);
    const minFrozen = ply - Math.max(st.bestPartialAtPly, anchor) >= window;
    const meanFrozen = ply - Math.max(st.bestMeanAtPly, anchor) >= window;
    return minFrozen && meanFrozen && st.bestPartial < 1;
  }

  /** Move budget of the active milestone exceeded? */
  budgetExceeded(ply: number): boolean {
    const spec = this.activeSpec()?.spec;
    if (!spec?.moveBudget) return false;
    return this.activePlyCount(ply) >= spec.moveBudget;
  }

  /** Progress report for the replanner. */
  progressReport(ctx: GameContext): ProgressReport {
    const report: ProgressReport = {
      fen: ctx.fen,
      moveNumber: ctx.moveNumber,
      completed: [],
    };
    this.plan.milestones.forEach((ms, i) => {
      const st = this.states[i]!;
      if (st.completed) {
        report.completed.push({
          id: ms.spec.id,
          description: ms.spec.description,
          atPly: st.completedAtPly ?? 0,
        });
      }
    });
    const ai = this.activeIndex();
    if (ai != null) {
      const ms = this.plan.milestones[ai]!;
      report.active = {
        id: ms.spec.id,
        description: ms.spec.description,
        partialCredit: this.states[ai]!.bestPartial,
      };
      if (ms.infeasible && evalPredicate(ms.infeasible, ctx)) {
        report.failing = { id: ms.spec.id, reason: ms.spec.infeasible ?? 'infeasible' };
      }
    }
    if (this._violations.length > 0) {
      const v = this._violations[this._violations.length - 1]!;
      report.failing = report.failing ?? { id: v.id, reason: `constraint violated: ${v.description}` };
    }
    return report;
  }
}

/** Evaluate the plan's terminal condition on a final GameContext. */
export function terminalMet(compiled: CompiledPlan, ctx: GameContext): boolean {
  const t = compiled.plan.terminal;
  switch (t.kind) {
    case 'win':
      return ctx.checkmate && ctx.winner === ctx.self;
    case 'lose':
      return ctx.checkmate && ctx.winner !== ctx.self;
    case 'draw':
      return ctx.draw || ctx.stalemate || ctx.insufficient;
    case 'pattern':
      return compiled.terminalPattern ? evalPredicate(compiled.terminalPattern, ctx) : false;
  }
}
