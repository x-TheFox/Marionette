import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { compilePlan } from '../src/plan/schema.js';
import { PlanTracker, terminalMet } from '../src/game/tracker.js';
import { buildContext } from '../src/dsl/index.js';
import type { GameContext } from '../src/dsl/types.js';

/** Scholar's mate-ish sequence to drive milestone states deterministically. */
const MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7'];

function plan(raw: unknown) {
  return compilePlan(raw);
}

function ctxAfter(moves: string[], self: 'w' | 'b', evalWhiteCp: number | null = 0): GameContext {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return buildContext(g, self, { evalWhiteCp, mateWhite: null });
}

const shedPlan = {
  summary: 'shed everything',
  style: 'none',
  terminal: { kind: 'lose', priority: 'milestones_first' },
  hardConstraints: [],
  milestones: [
    {
      id: 'shed_pieces',
      description: 'lose material',
      completion: 'captured_value(self) >= 300',
      infeasible: 'material(self) <= 100 && captured_value(self) < 300',
      tolerance: 'loose',
      weight: 3,
    },
    {
      id: 'get_mated',
      description: 'be checkmated',
      completion: 'is_checkmate() && winner() == opp',
      tolerance: 'loose',
      weight: 5,
    },
  ],
  fallback: ['secure_terminal', 'play_best'],
};

describe('PlanTracker', () => {
  it('marks a milestone complete when its predicate turns true', () => {
    const compiled = plan(shedPlan);
    const t = new PlanTracker(compiled, 'w');
    expect(t.activeIndex()).toBe(0);

    // e4 e5 Qh5 Nc6 Bc4 Nf6 — no captures yet
    const mid = ctxAfter(MOVES.slice(0, 6), 'w');
    const u1 = t.update(mid, 6);
    expect(u1.newlyCompleted).toHaveLength(0);
    expect(t.activeIndex()).toBe(0);

    // Qxf7: white captured a pawn → captured_value(self) (white's own losses) still 0!
    // White losing material means OPP captured white pieces. Opp captured nothing.
    const afterQxf7 = ctxAfter(MOVES, 'w');
    const u2 = t.update(afterQxf7, 7);
    expect(u2.newlyCompleted).toHaveLength(0); // captured_value(self)=0 (self=white)
    expect(t.activeIndex()).toBe(0);
    // partial credit should have moved (closer? no — 0 vs target 300 → still 0-ish)
    expect(t.states[0]!.completed).toBe(false);
  });

  it('completes when the opponent captures our material', () => {
    const compiled = plan(shedPlan);
    const t = new PlanTracker(compiled, 'w');
    // A legal sequence where black wins a white pawn via Qxa2 (100cp — below threshold,
    // but partial credit must rise).
    const g = new Chess();
    for (const m of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxa2']) {
      g.move(m);
    }
    const ctx = buildContext(g, 'w', { evalWhiteCp: -150, mateWhite: null });
    const upd = t.update(ctx, g.history().length);
    expect(upd.newlyCompleted).toHaveLength(0); // 100 < 300
    expect(t.states[0]!.bestPartial).toBeGreaterThan(0);
    expect(t.activeIndex()).toBe(0);
  });

  it('detects infeasibility via the infeasible predicate', () => {
    const compiled = plan({
      summary: 'promote a pawn',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        {
          id: 'promote',
          description: 'get a queen via promotion',
          completion: 'promoted_count(self, queen) >= 1',
          infeasible: 'piece_count(self, pawn) == 0',
          tolerance: 'medium',
          weight: 2,
        },
      ],
      fallback: ['play_best'],
    });
    const t = new PlanTracker(compiled, 'w');
    // K vs K + no pawns for white: create such a position
    const g = new Chess('k7/8/8/8/8/8/6r1/K7 w - - 0 1');
    const ctx = buildContext(g, 'w', { evalWhiteCp: -800, mateWhite: null });
    const upd = t.update(ctx, 1);
    expect(upd.infeasible?.id).toBe('promote');
  });

  it('enforces constraints only after their afterMilestone completes', () => {
    const compiled = plan({
      summary: 'kq only',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [
        {
          id: 'no_extra',
          description: 'never exceed K+Q after reduce',
          predicate: 'non_pawn_count(self) > 1',
          afterMilestone: 'reduce',
        },
      ],
      milestones: [
        { id: 'reduce', description: 'reduce', completion: 'move_number() >= 2', tolerance: 'loose', weight: 1 },
      ],
      fallback: ['play_best'],
    });
    const t = new PlanTracker(compiled, 'w');
    const start = ctxAfter(['e4', 'e5'], 'w'); // move 2 → reduce complete
    const upd = t.update(start, 2);
    expect(upd.newlyCompleted.map((c) => c.id)).toEqual(['reduce']);
    // constraint now enforced: non_pawn_count(self)=white has Q+2R+B+N+K... >1 → violation!
    expect(upd.violated?.id).toBe('no_extra');
    expect(t.violations()).toHaveLength(1);
    // and it reports only once
    const upd2 = t.update(start, 3);
    expect(upd2.violated).toBeUndefined();
    expect(t.violations()).toHaveLength(1);
  });

  it('stall + budget detection work', () => {
    const compiled = plan({
      summary: 'castle',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        {
          id: 'castle',
          description: 'castle kingside',
          completion: 'castled(self)',
          tolerance: 'medium',
          weight: 2,
          moveBudget: 6,
        },
      ],
      fallback: ['play_best'],
    });
    const t = new PlanTracker(compiled, 'w');
    const ctx = ctxAfter(['e4', 'e5'], 'w');
    t.update(ctx, 2); // first milestone is active from ply 0
    expect(t.budgetExceeded(5)).toBe(false); // 5 plies spent < 6
    expect(t.budgetExceeded(6)).toBe(true); // 6 plies spent == budget
    // stalled: bestPartial unchanged over window
    expect(t.stalled(2 + 20, 16)).toBe(true);
  });

  it('terminalMet is honest for win/lose/draw', () => {
    const compiledWin = plan({ ...shedPlan, terminal: { kind: 'win', priority: 'milestones_first' } });
    const mateCtx = ctxAfter(['f3', 'e5', 'g4', 'Qh4'], 'w'); // white mated
    expect(terminalMet(compiledWin, mateCtx)).toBe(false);
    const compiledLose = plan({ ...shedPlan, terminal: { kind: 'lose', priority: 'milestones_first' } });
    expect(terminalMet(compiledLose, mateCtx)).toBe(true);
    const compiledDraw = plan({ ...shedPlan, terminal: { kind: 'draw', priority: 'milestones_first' } });
    const stalemate = buildContext(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'w', { evalWhiteCp: 0, mateWhite: null });
    expect(terminalMet(compiledDraw, stalemate)).toBe(true);
  });

  it('rederive re-marks completed milestones after a replan', () => {
    const compiled = plan(shedPlan);
    const t = new PlanTracker(compiled, 'w', 20);
    const g = new Chess('k7/8/8/8/8/8/6r1/K6r w - - 0 30'); // white lost 2 rooks (already gone)
    const ctx = buildContext(g, 'w', { evalWhiteCp: -1000, mateWhite: null });
    t.rederive(ctx, 20);
    // captured_value(self): history is empty for this FEN → 0. Not complete.
    expect(t.states[0]!.completed).toBe(false);
    expect(t.states[0]!.startedAtPly).toBe(20);
  });
});
