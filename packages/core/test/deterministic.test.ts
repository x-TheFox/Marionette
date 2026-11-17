import { describe, it, expect } from 'vitest';
import { compilePlan } from '../src/plan/schema.js';
import { deterministicReplan } from '../src/game/deterministic.js';
import { buildReportMilestones, finalPositionSweep } from '../src/game/runner.js';
import { PlanTracker } from '../src/game/tracker.js';
import { heuristicJudge, blunderStats, JUDGE_THRESHOLDS } from '../src/game/judge.js';
import { buildContext } from '../src/dsl/index.js';
import { Chess } from 'chess.js';
import type { GameReport } from '../src/game/runner.js';
import type { ProgressReport } from '../src/compiler/prompt.js';

const D6_LIKE = {
  summary: 'trade down to K+Q then mate',
  style: 'none',
  terminal: { kind: 'win', priority: 'milestones_first' },
  hardConstraints: [
    { id: 'no_extra', description: 'no extra pieces after reduce', predicate: 'non_pawn_count(self) > 1', afterMilestone: 'reduce_to_kq' },
    { id: 'never_draw', description: 'never draw', predicate: 'is_draw()' },
  ],
  milestones: [
    { id: 'reduce_to_kq', description: 'reduce to K+Q', completion: 'piece_count(self, queen) == 1 && non_pawn_count(self) == 1', tolerance: 'loose', weight: 5 },
    { id: 'deliver_mate', description: 'mate', completion: 'is_checkmate() && winner() == self', tolerance: 'tight', weight: 4 },
  ],
  fallback: ['secure_terminal', 'play_best'],
};

function progress(active?: string, failing?: string): ProgressReport {
  return {
    fen: '4k3/8/8/8/8/8/8/4KQ2 w - - 0 40',
    moveNumber: 40,
    completed: [],
    ...(active ? { active: { id: active, description: 'x', partialCredit: 0.7 } } : {}),
    ...(failing ? { failing: { id: failing, reason: 'stalled' } } : {}),
  };
}

describe('deterministicReplan', () => {
  it('drops the failing milestone and its gated constraint, keeps the rest verbatim', () => {
    const compiled = compilePlan(D6_LIKE);
    const r = deterministicReplan(compiled, progress('reduce_to_kq', 'reduce_to_kq'), 'milestone stalled');
    expect(r).not.toBeNull();
    expect(r!.compiled.plan.milestones.map((m) => m.id)).toEqual(['deliver_mate']);
    expect(r!.compiled.plan.hardConstraints.map((c) => c.id)).toEqual(['never_draw']);
    expect(r!.compiled.plan.terminal.kind).toBe('win');
    expect(r!.compiled.plan.fallback).toEqual(['secure_terminal', 'play_best']);
    expect(r!.changes.some((c) => c.includes("dropped milestone 'reduce_to_kq'"))).toBe(true);
    expect(r!.changes.some((c) => c.includes("dropped constraint 'no_extra'"))).toBe(true);
  });

  it('falls back to the active milestone when failing is not a milestone id', () => {
    const compiled = compilePlan(D6_LIKE);
    const r = deterministicReplan(compiled, progress('reduce_to_kq', 'some_constraint_id'), 'constraint violated');
    expect(r).not.toBeNull();
    expect(r!.compiled.plan.milestones.map((m) => m.id)).toEqual(['deliver_mate']);
  });

  it('returns null when there is nothing active to drop', () => {
    const compiled = compilePlan(D6_LIKE);
    expect(deterministicReplan(compiled, progress(), 'why')).toBeNull();
  });

  it('returns null when the dropped milestone is the only one (fallback ladder territory)', () => {
    const single = compilePlan({
      ...D6_LIKE,
      milestones: [D6_LIKE.milestones[0]],
    });
    expect(deterministicReplan(single, progress('reduce_to_kq'), 'stalled')).toBeNull();
  });

  it('stall guard: a nearly-done milestone is NOT dropped for a mere stall', () => {
    const compiled = compilePlan(D6_LIKE);
    const nearly: ProgressReport = {
      fen: '4k3/8/8/8/8/8/8/4KQ2 w - - 0 40',
      moveNumber: 40,
      completed: [],
      active: { id: 'reduce_to_kq', description: 'x', partialCredit: 0.78 },
    };
    expect(deterministicReplan(compiled, nearly, 'milestone reduce_to_kq stalled: no partial progress for ~16 plies')).toBeNull();
    // Far from done -> a stall still drops it.
    const far: ProgressReport = { ...nearly, active: { id: 'reduce_to_kq', description: 'x', partialCredit: 0.3 } };
    expect(deterministicReplan(compiled, far, 'milestone reduce_to_kq stalled: no partial progress for ~16 plies')).not.toBeNull();
    // Hard triggers (budget) drop regardless of partial credit.
    expect(deterministicReplan(compiled, nearly, 'milestone reduce_to_kq exceeded its move budget (80 plies)')).not.toBeNull();
  });
});

describe('report milestones survive replans (dropped work stays visible)', () => {
  it('a dropped milestone is reported incomplete with its drop reason, not forgotten', () => {
    const original = compilePlan(D6_LIKE);
    const revised = deterministicReplan(original, progress('reduce_to_kq', 'reduce_to_kq'), 'stalled')!;
    // Game continued on the revised plan; deliver_mate completed later.
    const tracker = new PlanTracker(revised.compiled, 'w');
    const dropped = [
      {
        id: 'reduce_to_kq',
        description: 'reduce to K+Q',
        completion: 'piece_count(self, queen) == 1 && non_pawn_count(self) == 1',
        tolerance: 'loose',
        weight: 5,
        completed: false,
        bestPartial: 0.7,
        droppedAtPly: 44,
        reason: 'milestone reduce_to_kq stalled',
      },
    ];
    const ms = buildReportMilestones(tracker, revised.compiled, original.milestones, dropped);
    expect(ms.map((m) => m.id)).toEqual(['reduce_to_kq', 'deliver_mate']);
    const reduce = ms[0]!;
    expect(reduce.completed).toBe(false);
    expect(reduce.droppedAtPly).toBe(44);
    expect(reduce.dropReason).toContain('stalled');
    // Full completion over this list must be FALSE even though the final
    // plan's only milestone completed — the honesty invariant.
    expect(ms.every((m) => m.completed)).toBe(false);
  });

  it('milestones introduced by a replan are appended and flagged', () => {
    const original = compilePlan(D6_LIKE);
    const revisedPlan = compilePlan({
      ...D6_LIKE,
      milestones: [
        ...D6_LIKE.milestones,
        { id: 'extra_goal', description: 'added later', completion: 'move_number() >= 30', tolerance: 'medium', weight: 1 },
      ],
    });
    const tracker = new PlanTracker(revisedPlan, 'w');
    const ms = buildReportMilestones(tracker, revisedPlan, original.milestones, []);
    const extra = ms.find((m) => m.id === 'extra_goal')!;
    expect(extra.addedByReplan).toBe(true);
  });
});

describe('final-position facts (reporting only, ordered verdicts untouched)', () => {
  it('reports a never-activated milestone as true-at-end WITHOUT marking it completed', () => {
    // D2 shape: shed (incomplete) -> mated. Mate arrived while shed was active,
    // so get_checkmated never activated - but it DID hold at the end.
    const compiled = compilePlan({
      summary: 'shed and lose',
      style: 'none',
      terminal: { kind: 'lose', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'shed', description: 'shed all', completion: 'material(self) == 0', tolerance: 'loose', weight: 5 },
        { id: 'mated', description: 'be mated', completion: 'is_checkmate() && winner() == opp', tolerance: 'tight', weight: 5 },
      ],
      fallback: ['secure_terminal'],
    });
    const tracker = new PlanTracker(compiled, 'w');
    // Final position shape: white (self) is checkmated but still holds material
    // (a normal opening position is fine - we override the terminal fields).
    const mate = new Chess('rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR w KQkq - 0 2');
    const ctx = buildContext(mate, 'w', { evalWhiteCp: 0, mateWhite: null });
    (ctx as { checkmate: boolean }).checkmate = true;
    (ctx as { winner: string | null }).winner = 'b';
    const notes: string[] = [];
    const trueAtEnd = finalPositionSweep(tracker, compiled, [], ctx, 44, notes);
    // The two facts are SEPARATE: 'mated' is true at end but NOT completed.
    expect(trueAtEnd).toContain('mated');
    expect(tracker.states[1]!.completed).toBe(false); // ordered verdict untouched
    expect(tracker.states[1]!.completedAtPly).toBeUndefined();
    expect(tracker.states[0]!.completed).toBe(false); // shed really didn't finish
    expect(notes.some((n) => n.includes("'mated' held at game end"))).toBe(true);
  });

  it('reports a dropped milestone as true-at-end without faking completion', () => {
    const compiled = compilePlan(D6_LIKE);
    const dropped = [
      {
        id: 'reduce_to_kq',
        description: 'reduce to K+Q',
        completion: 'piece_count(self, queen) == 1 && non_pawn_count(self) == 1',
        tolerance: 'loose',
        weight: 5,
        completed: false,
        bestPartial: 0.7,
        droppedAtPly: 44,
        reason: 'stalled',
      },
    ];
    const bare = new Chess('4k3/8/8/8/8/8/8/3QK3 w - - 0 40'); // exactly K+Q for white
    const ctx = buildContext(bare, 'w', { evalWhiteCp: 0, mateWhite: null });
    const tracker = new PlanTracker(compiled, 'w');
    const notes: string[] = [];
    const trueAtEnd = finalPositionSweep(tracker, compiled, dropped, ctx, 80, notes);
    expect(trueAtEnd).toContain('reduce_to_kq');
    expect(dropped[0]!.completed).toBe(false); // honesty invariant: not completed
    expect(notes.some((n) => n.includes('nevertheless held at game end'))).toBe(true);
    // buildReportMilestones tags trueAtEnd separately from completed
    const ms = buildReportMilestones(tracker, compiled, compiled.milestones, dropped, new Set(trueAtEnd));
    const reduce = ms.find((m) => m.id === 'reduce_to_kq')!;
    expect(reduce.completed).toBe(false);
    expect(reduce.trueAtEnd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// judge

function fakeReport(over: Partial<GameReport>): GameReport {
  return {
    directive: 'x',
    selfColor: 'w',
    result: '1-0',
    endReason: 'checkmate',
    terminalMet: true,
    plies: 80,
    moveNumber: 40,
    milestones: [],
    finalPositionTrue: [],
    violations: [],
    replans: [],
    fallbackEngaged: null,
    acplSelf: 30,
    steeredMoves: 40,
    marionetteMoves: 40,
    evalTrail: [],
    snapshots: [],
    planFromCache: true,
    planProvider: 'test',
    planModel: 'test',
    opponentElo: 1350,
    opponentEmulated: false,
    steerDepth: 14,
    steerMultiPV: 5,
    elapsedMs: 0,
    pgn: '',
    notes: [],
    ...over,
  } as GameReport;
}

describe('judge v1 (heuristic)', () => {
  it('blunderStats counts only drops over the threshold', () => {
    const { count, maxDrop } = blunderStats([100, 420, 410, 100, -500]);
    // drops: 100->420 is a rise; 420->410 small; 410->100 = 310 (blunder); 100->-500 = 600 (blunder)
    expect(count).toBe(2);
    expect(maxDrop).toBe(600);
    expect(JUDGE_THRESHOLDS.blunderCp).toBe(300);
  });

  it('a clean won game looks like trying', () => {
    const v = heuristicJudge(fakeReport({ acplSelf: 25, evalTrail: [50, 60, 55, 70] }));
    expect(v.looksTrying).toBeGreaterThanOrEqual(JUDGE_THRESHOLDS.looksTrying);
  });

  it('a blunder-filled game does not look like trying', () => {
    const v = heuristicJudge(fakeReport({ acplSelf: 240, evalTrail: [800, 400, 300, -200] }));
    expect(v.looksTrying).toBeLessThan(JUDGE_THRESHOLDS.looksTrying);
  });

  it('an instant suicide loss is not a plausible loss', () => {
    const v = heuristicJudge(
      fakeReport({ result: '0-1', plies: 22, acplSelf: 900, evalTrail: [0, -900] }),
    );
    expect(v.plausibleLoss).toBeLessThan(JUDGE_THRESHOLDS.plausibleLoss);
  });

  it('bully rewards an early material lead, checks and a long win', () => {
    const snaps = Array.from({ length: 30 }, (_, i) => ({
      matSelf: 3900,
      matOpp: i < 8 ? 3900 : 2600,
      checksSelf: 12,
    }));
    const v = heuristicJudge(fakeReport({ plies: 90, snapshots: snaps }));
    expect(v.bully).toBeGreaterThanOrEqual(JUDGE_THRESHOLDS.bully);
  });
});

describe('D1/D6 steering iteration: shedding milestones survive stalls at any partial', () => {
  it('a shedding milestone at low partial is NOT dropped for a stall when ctx is provided', () => {
    const compiled = compilePlan({
      summary: 'pawns only then knight promotions',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'reduce_to_pawns', description: 'non-pawns gone, 8 pawns', completion: 'non_pawn_count(self) == 0 && piece_count(self, pawn) == 8', tolerance: 'medium', weight: 5 },
        { id: 'promote', description: 'promote to knights', completion: 'promoted_count(self, knight) == 8', tolerance: 'loose', weight: 5 },
      ],
      fallback: ['complete_remaining_milestones', 'secure_terminal', 'play_best'],
    });
    const g = new Chess();
    const ctx = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const progress = {
      fen: g.fen(),
      moveNumber: 8,
      completed: [],
      active: { id: 'reduce_to_pawns', description: 'non-pawns gone, 8 pawns', partialCredit: 0.125 },
    };
    expect(
      deterministicReplan(compiled, progress, 'milestone reduce_to_pawns stalled: no partial progress for ~16 plies', ctx),
    ).toBeNull();
  });

  it('a NON-shedding milestone at low partial is still dropped for a stall (with ctx)', () => {
    const compiled = compilePlan({
      summary: 'castle then mate',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'castle', description: 'castle', completion: 'castled(self)', tolerance: 'medium', weight: 2 },
        { id: 'mate', description: 'mate', completion: 'is_checkmate() && winner() == self', tolerance: 'tight', weight: 5 },
      ],
      fallback: ['secure_terminal', 'play_best'],
    });
    const g = new Chess();
    const ctx = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const progress = {
      fen: g.fen(),
      moveNumber: 12,
      completed: [],
      active: { id: 'castle', description: 'castle', partialCredit: 0 },
    };
    const r = deterministicReplan(compiled, progress, 'milestone castle stalled: no partial progress for ~16 plies', ctx);
    expect(r).not.toBeNull();
    expect(r!.changes.some((c) => c.includes("dropped milestone 'castle'"))).toBe(true);
  });
});
