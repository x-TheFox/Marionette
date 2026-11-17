import type { CompiledPlan } from '../plan/schema.js';
import { compilePlan } from '../plan/schema.js';
import type { ProgressReport } from '../compiler/prompt.js';

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
 */

export interface DeterministicReplanResult {
  compiled: CompiledPlan;
  /** Human-readable, honest change list (also used as report notes). */
  changes: string[];
}

export function deterministicReplan(
  compiled: CompiledPlan,
  progress: ProgressReport,
  reason: string,
): DeterministicReplanResult | null {
  const milestoneIds = new Set(compiled.plan.milestones.map((m) => m.id));
  // Prefer the failing milestone; fall back to the active one. A constraint id
  // in `failing` that is not a milestone id is not something we can drop here.
  const failId = progress.failing?.id && milestoneIds.has(progress.failing.id)
    ? progress.failing.id
    : undefined;
  const dropId = failId ?? progress.active?.id ?? null;
  if (dropId == null) return null;

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
