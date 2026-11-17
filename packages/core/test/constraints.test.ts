import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { compilePlan, constraintsInForce } from '../src/plan/schema.js';
import { PlanTracker } from '../src/game/tracker.js';
import { buildContext, evalPredicate } from '../src/dsl/index.js';
import type { GameContext } from '../src/dsl/types.js';

/**
 * Hard-constraint enforcement semantics (schema v2):
 *  - un-gated constraints are in force from the FIRST move (steering filters
 *    on them, tracker records violations);
 *  - gated constraints are in force once their afterMilestone completed;
 *  - constraints whose violation already holds cannot be filtered on.
 */

function plan(raw: unknown) {
  return compilePlan(raw);
}

function ctxAfter(moves: string[], self: 'w' | 'b', evalWhiteCp: number | null = 0): GameContext {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return buildContext(g, self, { evalWhiteCp, mateWhite: null });
}

const NO_CAPTURE_PLAN = {
  summary: 'never capture',
  style: 'none',
  terminal: { kind: 'lose', priority: 'milestones_first' },
  hardConstraints: [
    { id: 'no_captures', description: 'never capture anything', predicate: 'captures_count(self) > 0' },
  ],
  milestones: [
    { id: 'shed', description: 'shed material', completion: 'captured_value(self) >= 300', tolerance: 'loose', weight: 3 },
  ],
  fallback: ['play_best'],
};

const GATED_PLAN = {
  summary: 'gated constraint',
  style: 'none',
  terminal: { kind: 'win', priority: 'milestones_first' },
  hardConstraints: [
    {
      id: 'no_extra_pieces',
      description: 'no extra pieces after reduce',
      predicate: 'non_pawn_count(self) > 1',
      afterMilestone: 'reduce',
    },
  ],
  milestones: [
    { id: 'reduce', description: 'reduce to bare king', completion: 'material(self) == 0', tolerance: 'loose', weight: 5 },
    { id: 'mate', description: 'mate', completion: 'is_checkmate() && winner() == self', tolerance: 'tight', weight: 5 },
  ],
  fallback: ['play_best'],
};

describe('constraintsInForce', () => {
  it('un-gated constraints are in force from the start', () => {
    const compiled = plan(NO_CAPTURE_PLAN);
    const inForce = constraintsInForce(compiled, new Set<string>());
    expect(inForce.map((c) => c.spec.id)).toEqual(['no_captures']);
  });

  it('gated constraints are not in force before their milestone completes', () => {
    const compiled = plan(GATED_PLAN);
    const inForce = constraintsInForce(compiled, new Set<string>());
    expect(inForce).toHaveLength(0);
    const afterReduce = constraintsInForce(compiled, new Set(['reduce']));
    expect(afterReduce.map((c) => c.spec.id)).toEqual(['no_extra_pieces']);
  });
});

describe('tracker: un-gated constraints', () => {
  it('records the violation on the ply where the violation condition first holds', () => {
    const compiled = plan(NO_CAPTURE_PLAN);
    const t = new PlanTracker(compiled, 'w');
    // e4 e5 Qh5 Nc6 Bc4 — no captures by white yet.
    const before = ctxAfter(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4'], 'w');
    expect(t.update(before, 5).violated).toBeUndefined();
    expect(t.violations()).toHaveLength(0);
    // Qxf7 — white captures: captures_count(self) > 0 becomes true.
    const after = ctxAfter(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7'], 'w');
    const u = t.update(after, 7);
    expect(u.violated?.id).toBe('no_captures');
    expect(t.violations()[0]!.atPly).toBe(7);
    // Recorded exactly once even if it keeps holding.
    expect(t.update(after, 9).violated).toBeUndefined();
    expect(t.violations()).toHaveLength(1);
  });

  it('records a start-position violation honestly (foolish plan, not hidden)', () => {
    const compiled = plan({
      ...NO_CAPTURE_PLAN,
      hardConstraints: [
        // Violated in the initial position: non_pawn_count(self) == 7.
        { id: 'already_broken', description: 'never have pieces', predicate: 'non_pawn_count(self) > 1' },
      ],
    });
    const t = new PlanTracker(compiled, 'w');
    const u = t.update(ctxAfter([], 'w'), 0);
    expect(u.violated?.id).toBe('already_broken');
  });
});

describe('steering filter interplay', () => {
  it('an already-violated constraint is detectable so the filter can skip it', () => {
    // The steering layer skips constraints whose violation condition already
    // holds in the current position (filtering would exclude every candidate).
    // This test pins the mechanism: evalPredicate on the current context.
    const compiled = plan(NO_CAPTURE_PLAN);
    const constraint = constraintsInForce(compiled, new Set<string>())[0]!;
    const violatedNow = evalPredicate(constraint.violation, ctxAfter(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7'], 'w'));
    const cleanNow = evalPredicate(constraint.violation, ctxAfter(['e4', 'e5'], 'w'));
    expect(violatedNow).toBe(true); // filter must skip
    expect(cleanNow).toBe(false); // filter applies
  });

  it('gated constraint only filters once the gate milestone completed', () => {
    const compiled = plan(GATED_PLAN);
    const constraint = compiled.constraints[0]!;
    const start = ctxAfter([], 'w');
    // Not in force before 'reduce' completes.
    expect(constraintsInForce(compiled, new Set<string>())).not.toContain(constraint);
    // After 'reduce' completes the violation predicate is checkable and false
    // on a bare-king position (material(self) == 0 ⇒ non_pawn_count == 0).
    const bareKing = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const ctx = buildContext(bareKing, 'w', { evalWhiteCp: 0, mateWhite: null });
    expect(evalPredicate(constraint.violation, ctx)).toBe(false);
  });
});
