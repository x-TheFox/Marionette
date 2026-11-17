import { z } from 'zod';
import { compilePredicate, type CompiledPredicate } from '../dsl/index.js';

export const STYLE_PROFILES = ['none', 'looks_strong', 'aggressive', 'humiliating', 'natural'] as const;
export const TOLERANCES = ['loose', 'medium', 'tight'] as const;
export const TERMINAL_KINDS = ['win', 'lose', 'draw', 'pattern'] as const;
export const TERMINAL_PRIORITIES = ['milestones_first', 'terminal_first'] as const;
export const FALLBACK_ACTIONS = [
  'complete_remaining_milestones',
  'secure_terminal',
  'play_best',
  'play_natural',
] as const;

export const MilestoneSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_]+$/, 'milestone id must be snake_case'),
  description: z.string().min(1),
  completion: z.string().min(1),
  infeasible: z.string().optional(),
  tolerance: z.enum(TOLERANCES).default('medium'),
  weight: z.number().int().min(1).max(5).default(1),
  moveBudget: z.number().int().min(2).max(300).optional(),
});

export const HardConstraintSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_]+$/, 'constraint id must be snake_case'),
  description: z.string().min(1),
  /** Violation condition: must stay FALSE while enforced. */
  predicate: z.string().min(1),
  /** Constraint is enforced once this milestone completes (and at game end). */
  afterMilestone: z.string().optional(),
});

export const TerminalSchema = z.object({
  kind: z.enum(TERMINAL_KINDS),
  pattern: z.string().optional(),
  priority: z.enum(TERMINAL_PRIORITIES).default('milestones_first'),
});

export const PlanSchema = z.object({
  summary: z.string().min(1),
  style: z.enum(STYLE_PROFILES).default('none'),
  terminal: TerminalSchema,
  hardConstraints: z.array(HardConstraintSchema).default([]),
  milestones: z.array(MilestoneSchema).min(1),
  fallback: z.array(z.enum(FALLBACK_ACTIONS)).default(['complete_remaining_milestones', 'play_best']),
});

export type Milestone = z.infer<typeof MilestoneSchema>;
export type HardConstraint = z.infer<typeof HardConstraintSchema>;
export type Terminal = z.infer<typeof TerminalSchema>;
export type Plan = z.infer<typeof PlanSchema>;

/** A plan with all predicates parsed + statically validated. */
export interface CompiledPlan {
  plan: Plan;
  milestones: { spec: Milestone; completion: CompiledPredicate; infeasible?: CompiledPredicate }[];
  constraints: { spec: HardConstraint; violation: CompiledPredicate }[];
  terminalPattern?: CompiledPredicate;
  schemaVersion: string;
}

export const PLAN_SCHEMA_VERSION = '1';

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

/**
 * Validate a raw plan object: zod shape, predicate syntax/types, referential
 * integrity, and a dry-run evaluation against `ctx` (catches unknown
 * functions and type errors at compile time). Returns a CompiledPlan.
 */
export function compilePlan(raw: unknown): CompiledPlan {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new PlanValidationError(`plan shape invalid: ${issues}`);
  }
  const plan = parsed.data;

  const ids = new Set(plan.milestones.map((m) => m.id));
  if (ids.size !== plan.milestones.length) {
    throw new PlanValidationError('milestone ids are not unique');
  }

  const milestones = plan.milestones.map((m) => {
    let completion: CompiledPredicate;
    let infeasible: CompiledPredicate | undefined;
    try {
      completion = compilePredicate(m.completion);
      if (m.infeasible) infeasible = compilePredicate(m.infeasible);
    } catch (e) {
      throw new PlanValidationError(`milestone '${m.id}': ${e instanceof Error ? e.message : String(e)}`);
    }
    return { spec: m, completion, infeasible };
  });

  for (const c of plan.hardConstraints) {
    if (c.afterMilestone && !ids.has(c.afterMilestone)) {
      throw new PlanValidationError(`constraint '${c.id}' references unknown afterMilestone '${c.afterMilestone}'`);
    }
  }
  const constraints = plan.hardConstraints.map((c) => {
    try {
      return { spec: c, violation: compilePredicate(c.predicate) };
    } catch (e) {
      throw new PlanValidationError(`constraint '${c.id}': ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  let terminalPattern: CompiledPredicate | undefined;
  if (plan.terminal.kind === 'pattern') {
    if (!plan.terminal.pattern) {
      throw new PlanValidationError("terminal kind 'pattern' requires a pattern predicate");
    }
    try {
      terminalPattern = compilePredicate(plan.terminal.pattern);
    } catch (e) {
      throw new PlanValidationError(`terminal pattern: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { plan, milestones, constraints, terminalPattern, schemaVersion: PLAN_SCHEMA_VERSION };
}
