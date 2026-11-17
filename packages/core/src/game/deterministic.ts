import type { CompiledPlan } from '../plan/schema.js';
import { compilePlan } from '../plan/schema.js';
import type { ProgressReport } from '../compiler/prompt.js';
import type { GameContext } from '../dsl/types.js';
import { isSheddingMilestone } from '../steering/scorer.js';

/**
 * Deterministic (no-LLM) replan: a rule-based plan revision used when the
 * provider chain is unavailable (offline replay mode) or when an LLM replan
 * fails. It never invents new goals — it can only RELAX the current plan and
 * must say exactly what it relaxed, so reports stay honest.
 *
 * Rules:
 *  1. Give up on the failing/active milestone: drop it from the plan.
 *  2. Constraints gated on a dropped milestone are dropped with it (their
 *     trigger can never fire; enforcing them from now could be instantly
 *     violated — e.g. "no extra pieces" while we still hold six).
 *  3. Everything else is kept verbatim: style, terminal, remaining milestones,
 *     un-gated constraints, fallback ladder.
 *  4. The result re-validates through compilePlan (same invariants as an LLM
 *     plan).
 *
 * Stall guard: a milestone that is already >= 50% complete is NOT dropped for
 * a mere progress stall — dropping nearly-finished work made early sweeps
 * abandon 78%-done shedding phases. Stalls on such milestones return null and
 * the caller falls back to the plan's ladder (usually: keep steering). The
 * same protection applies at ANY partial credit to shedding milestones when
 * the caller supplies the game context: offers wait for the opponent to bite,
 * and a quiet stretch is normal chess, not failure (D1/D6 lesson — the 16-ply
 * stall window dropped reduce_to_pawns before the opponent ever captured).
 * Hard triggers (infeasibility, exceeded move budget) always drop.
 */
export interface DeterministicReplanResult {
  compiled: CompiledPlan;
  /** Human-readable, honest change list (also used as report notes). */
  changes: string[];
}

export const STALL_DROP_MAX_PARTIAL = 0.5;

export function deterministicReplan(
  compiled: CompiledPlan,
  progress: ProgressReport,
  reason: string,
  ctx?: GameContext,
): DeterministicReplanResult | null {
  const milestoneIds = new Set(compiled.plan.milestones.map((m) => m.id));
  // Prefer the failing milestone; fall back to the active one. A constraint id
  // in `failing` that is not a milestone id is not something we can drop here.
  const failId = progress.failing?.id && milestoneIds.has(progress.failing.id)
    ? progress.failing.id
    : undefined;
  const dropId = failId ?? progress.active?.id ?? null;
  if (dropId == null) return null;

  // Stall guard: nearly-done milestones survive stalls; the caller's fallback
  // ladder keeps steering them. Shedding milestones survive stalls at any
  // partial credit (context-dependent check).
  const isStall = /stalled/i.test(reason);
  if (isStall && failId == null) {
    if ((progress.active?.partialCredit ?? 0) >= STALL_DROP_MAX_PARTIAL) return null;
    const activeMs = compiled.milestones.find((m) => m.spec.id === progress.active?.id);
    if (activeMs && ctx && isSheddingMilestone(activeMs, ctx)) return null;
  }

  const keptMilestones = compiled.plan.milestones.filter((m) => m.id !== dropId);
  if (keptMilestones.length === 0) {
    // Dropping the only milestone leaves nothing to steer; the caller falls
    // back to the plan's fallback ladder instead.
    return null;
  }

  const changes: string[] = [`dropped milestone '${dropId}' (${reason})`];
  const droppedSet = new Set<string>([dropId]);
  const keptConstraints = [];
  for (const c of compiled.plan.hardConstraints) {
    if (c.afterMilestone != null && droppedSet.has(c.afterMilestone)) {
      changes.push(`dropped constraint '${c.id}' (was gated on dropped milestone '${dropId}')`);
      continue;
    }
    keptConstraints.push(c);
  }

  const revised = compilePlan({
    ...compiled.plan,
    hardConstraints: keptConstraints,
    milestones: keptMilestones,
  });

  return { compiled: revised, changes };
}
