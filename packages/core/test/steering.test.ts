import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { compilePlan } from '../src/plan/schema.js';
import { lambdaFor, scoreCandidate, progressWeight, completionBonus, guardedValue } from '../src/steering/scorer.js';
import { motivatedCandidates } from '../src/steering/candidates.js';
import { buildContext, predicatePartial, compilePredicate, conjunctPartials } from '../src/dsl/index.js';
import type { GameContext } from '../src/dsl/types.js';

function plan(raw: unknown) {
  return compilePlan(raw);
}

function ctx(moves: string[], self: 'w' | 'b', evalWhiteCp = 100): GameContext {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return buildContext(g, self, { evalWhiteCp, mateWhite: null });
}

function fenCtx(fen: string, self: 'w' | 'b', evalWhiteCp = 0): GameContext {
  return buildContext(new Chess(fen), self, { evalWhiteCp, mateWhite: null });
}

const WIN_PLAN = {
  summary: 'just win',
  style: 'none',
  terminal: { kind: 'win', priority: 'milestones_first' },
  hardConstraints: [],
  milestones: [
    { id: 'trade', description: 'trade pieces', completion: 'captured_value(opp) >= 500', tolerance: 'medium', weight: 3 },
    { id: 'mate', description: 'mate', completion: 'is_checkmate() && winner() == self', tolerance: 'tight', weight: 5 },
  ],
  fallback: ['play_best'],
};

describe('lambda mapping', () => {
  it('tolerance drives base lambda', () => {
    const compiled = plan(WIN_PLAN);
    const ctxNow = ctx(['e4', 'e5'], 'w');
    const loose = lambdaFor({ milestone: { ...compiled.milestones[0]!.spec, tolerance: 'loose' }, plan: compiled }, ctxNow);
    const tight = lambdaFor({ milestone: { ...compiled.milestones[0]!.spec, tolerance: 'tight' }, plan: compiled }, ctxNow);
    expect(loose).toBeLessThan(tight);
  });

  it('a losing terminal caps lambda low', () => {
    const compiled = plan({ ...WIN_PLAN, terminal: { kind: 'lose', priority: 'milestones_first' } });
    const ctxNow = ctx(['e4', 'e5'], 'w');
    const λ = lambdaFor({ milestone: { ...compiled.milestones[0]!.spec, tolerance: 'tight' }, plan: compiled }, ctxNow);
    expect(λ).toBeLessThanOrEqual(0.6);
  });

  it('losing position with a win target raises lambda', () => {
    const compiled = plan(WIN_PLAN);
    const behind = ctx(['e4', 'e5'], 'w', -600);
    const ahead = ctx(['e4', 'e5'], 'w', 600);
    const λBehind = lambdaFor({ milestone: { ...compiled.milestones[0]!.spec, tolerance: 'loose' }, plan: compiled }, behind);
    const λAhead = lambdaFor({ milestone: { ...compiled.milestones[0]!.spec, tolerance: 'loose' }, plan: compiled }, ahead);
    expect(λBehind).toBeGreaterThan(λAhead);
  });
});

describe('scoring', () => {
  const compiled = plan(WIN_PLAN);
  const milestone = compiled.milestones[0]!.spec;

  it('weights and bonuses scale with milestone weight', () => {
    expect(progressWeight({ ...milestone, weight: 5 })).toBeGreaterThan(progressWeight({ ...milestone, weight: 1 }));
    expect(completionBonus({ ...milestone, weight: 5 })).toBeGreaterThan(completionBonus({ ...milestone, weight: 1 }));
  });

  it('completion dominates eval loss', () => {
    const sc = {
      milestone,
      plan: compiled,
      ctxAfter: ctx(['e4', 'e5', 'Qh5'], 'w'),
      ctxNow: ctx(['e4', 'e5'], 'w'),
    };
    const completing = scoreCandidate(
      { deltaProgress: 0.1, completes: true, achievesTerminal: false, evalSelfCp: 0, bestEvalSelfCp: 300 },
      sc,
      2.4,
    );
    const losing = scoreCandidate(
      { deltaProgress: 0.1, completes: false, achievesTerminal: false, evalSelfCp: 0, bestEvalSelfCp: 300 },
      sc,
      2.4,
    );
    expect(completing.total).toBeGreaterThan(losing.total);
    expect(completing.total - losing.total).toBeGreaterThan(400);
  });

  it('eval loss penalizes worse candidates proportionally', () => {
    const sc = {
      milestone,
      plan: compiled,
      ctxAfter: ctx(['e4', 'e5', 'Qh5'], 'w'),
      ctxNow: ctx(['e4', 'e5'], 'w'),
    };
    const best = scoreCandidate(
      { deltaProgress: 0, completes: false, achievesTerminal: false, evalSelfCp: 100, bestEvalSelfCp: 100 },
      sc,
      2.4,
    );
    const worse = scoreCandidate(
      { deltaProgress: 0, completes: false, achievesTerminal: false, evalSelfCp: -100, bestEvalSelfCp: 100 },
      sc,
      2.4,
    );
    expect(best.total - worse.total).toBeCloseTo(2.4 * 2, 5);
  });

  it('terminal achievement is overwhelming', () => {
    const sc = {
      milestone,
      plan: compiled,
      ctxAfter: ctx(['f3', 'e5', 'g4'], 'w'),
      ctxNow: ctx(['f3', 'e5', 'g4'], 'w'),
    };
    const mates = scoreCandidate(
      { deltaProgress: 0, completes: false, achievesTerminal: true, evalSelfCp: 9000, bestEvalSelfCp: 9000 },
      sc,
      0.6,
    );
    expect(mates.total).toBeGreaterThan(11_000);
  });
});

describe('partial credit semantics (D6 regression)', () => {
  const KQ_PREDICATE = 'piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1';

  it('AND predicates use min semantics: one satisfied atom cannot fake full credit', () => {
    const p = compilePredicate(KQ_PREDICATE);
    // Queen on board, but 8 pawns and 6 other pieces: old max-semantics gave 1.0.
    const startCtx = ctx(['e4', 'e5', 'Qh5', 'b6'], 'w');
    const credit = predicatePartial(p, startCtx);
    expect(credit).toBeLessThan(0.5);
    expect(credit).toBeGreaterThan(0);
  });

  it('partial credit rises as the position approaches the target state', () => {
    const p = compilePredicate(KQ_PREDICATE);
    // Heavy: queen + 6 pieces + 8 pawns; light: exactly K+Q. Min-driven credit rises.
    const heavy = fenCtx('rnbqkbnr/pppppppp/8/8/8/5Q2/PPPPPPPP/RNB1KB1R w KQkq - 0 1', 'w');
    const light = fenCtx('4k3/8/8/8/8/5Q2/8/4K3 w - - 0 1', 'w');
    const cHeavy = predicatePartial(p, heavy);
    const cLight = predicatePartial(p, light);
    expect(cHeavy).toBeLessThan(cLight);
    expect(cLight).toBe(1); // state fully satisfies the predicate
  });

  it('pawns-shed credit grows as pawn count drops', () => {
    const p = compilePredicate('piece_count(self, pawn) == 0');
    const eight = fenCtx('rnbqkbnr/pppppppp/8/8/8/5Q2/PPPPPPPP/RNB1KB1R w KQkq - 0 1', 'w');
    const four = fenCtx('rnbqkbnr/pppppppp/8/8/8/5Q2/PP3PP1/RNB1KB1R w KQkq - 0 1', 'w');
    const none = fenCtx('rnbqkbnr/pppppppp/8/8/8/5Q2/8/RNB1KB1R w KQkq - 0 1', 'w');
    const c8 = predicatePartial(p, eight);
    const c4 = predicatePartial(p, four);
    const c0 = predicatePartial(p, none);
    expect(c4).toBeGreaterThan(c8);
    expect(c0).toBeGreaterThan(c4);
  });
});

describe('motivated candidates', () => {
  it('finds captures for captured_value(opp) atoms', () => {
    const compiled = plan(WIN_PLAN);
    const g = new Chess('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    expect(
      cands.some((c) => c.san === 'Bxf7+' || c.san === 'Bxg8' || c.motive.includes('captured_value(opp)')),
    ).toBe(true);
    expect(cands.every((c) => c.source === 'motivated')).toBe(true);
  });

  it('finds hanging offers for captured_value(self) atoms', () => {
    const compiled = plan({
      summary: 'lose material',
      style: 'none',
      terminal: { kind: 'lose', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'shed', description: 'shed', completion: 'captured_value(self) >= 500', tolerance: 'loose', weight: 3 },
      ],
      fallback: ['play_best'],
    });
    const g = new Chess('rnbqkbnr/pppppppp/8/8/4R3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.motive.includes('captured_value(self)'))).toBe(true);
  });

  it('generates shed trades for piece_count(self, X) == smaller target (D6)', () => {
    const compiled = plan({
      summary: 'reduce to kq',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        {
          id: 'reduce',
          description: 'reduce',
          completion: 'piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1',
          tolerance: 'loose',
          weight: 5,
        },
      ],
      fallback: ['play_best'],
    });
    const g = new Chess('4k3/8/8/r7/8/8/8/R3K3 w - - 0 1'); // white Ra1, black Ra5 → Rxa5 trade
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    // The non_pawn_count(self)==1 atom (2 > 1) generates the rook trade.
    expect(cands.some((c) => c.motive.includes('trade') && c.uci === 'a1a5')).toBe(true);
  });

  it('deduplicates against engine lines and caps at 4', () => {
    const compiled = plan(WIN_PLAN);
    const g = new Chess('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const engine = new Set(['e1g1']);
    const cands = motivatedCandidates(compiled, ctxNow, 0, engine);
    expect(cands.length).toBeLessThanOrEqual(4);
    expect(cands.every((c) => c.uci !== 'e1g1')).toBe(true);
  });

  it('returns [] when not our turn', () => {
    const compiled = plan(WIN_PLAN);
    const g = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    expect(motivatedCandidates(compiled, ctxNow, 0, new Set())).toEqual([]);
  });

  it('finds mate-in-1 for mated_by atoms', () => {
    const compiled = plan({
      summary: 'back rank mate',
      style: 'none',
      terminal: { kind: 'pattern', pattern: 'is_checkmate() && mated_by(self, rook)', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'mate', description: 'rook mate', completion: 'mated_by(self, rook)', tolerance: 'tight', weight: 5 },
      ],
      fallback: ['play_best'],
    });
    // Black Kh8 with g7/h7 pawns; white Rf1 → Rf8# is a back-rank mate by a rook.
    const g = new Chess('7k/6pp/8/8/8/8/6PP/5RK1 w - - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    expect(cands.some((c) => c.uci === 'f1f8')).toBe(true);
  });
});

describe('D1/D6 steering iteration: guarded conjunct value', () => {
  const D6_PRED = 'piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1';
  const D1_PRED = 'non_pawn_count(self) == 0 && piece_count(self, pawn) == 8';

  it('conjunctPartials splits top-level && and returns per-conjunct credit', () => {
    const p = compilePredicate(D6_PRED);
    const parts = conjunctPartials(p.ast, ctx(['e4', 'e5'], 'w'));
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeCloseTo(1.0, 3); // queen == 1 satisfied
    expect(parts[1]).toBeCloseTo(0.2, 3); // 8 pawns vs target 0
    expect(parts[2]).toBeCloseTo(0.25, 3); // 7 non-pawns vs target 1
  });

  it('breaking a satisfied exact-count conjunct (queen trade) nets negative even with piece-shed progress', () => {
    // Both queens traded away: piece_count(self,queen) 1 → 0.
    const noQueens = fenCtx('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w kq - 0 1', 'w');
    const start = ctx(['e4', 'e5'], 'w');
    const p = compilePredicate(D6_PRED);
    const before = conjunctPartials(p.ast, start);
    const after = conjunctPartials(p.ast, noQueens);
    const vBefore = guardedValue(before, before);
    const vAfter = guardedValue(after, before);
    // Mean rises slightly (0.483 → 0.492) but the guard must dominate.
    expect(vAfter).toBeLessThan(vBefore - 0.3);
  });

  it('shedding a piece without breaking a satisfied conjunct stays positive (D6 piece offer)', () => {
    const start = ctx(['e4', 'e5'], 'w');
    const bishopGone = fenCtx('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQK1NR w KQkq - 0 1', 'w');
    const p = compilePredicate(D6_PRED);
    const before = conjunctPartials(p.ast, start);
    expect(guardedValue(conjunctPartials(p.ast, bishopGone), before)).toBeGreaterThan(
      guardedValue(before, before),
    );
  });

  it('losing a protected pawn (D1) is heavily negative even while non-pawn progress is unchanged', () => {
    const start = ctx(['e4', 'e5'], 'w');
    const pawnGone = fenCtx('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1', 'w');
    const p = compilePredicate(D1_PRED);
    const before = conjunctPartials(p.ast, start);
    const vBefore = guardedValue(before, before);
    const vAfter = guardedValue(conjunctPartials(p.ast, pawnGone), before);
    expect(vAfter).toBeLessThan(vBefore - 0.3);
  });

  it('single-conjunct milestones keep plain partial semantics (no guard, mean = partial)', () => {
    const p = compilePredicate('promoted_count(self, knight) == 8');
    const parts = conjunctPartials(p.ast, ctx(['e4', 'e5'], 'w'));
    expect(parts).toHaveLength(1);
    expect(guardedValue(parts, parts)).toBeCloseTo(parts[0]!, 6);
  });
});

describe('D1/D6 steering iteration: motivated candidates', () => {
  it('generates pawn-march candidates for promoted_count targets (promotion chains)', () => {
    const compiled = plan({
      summary: 'all knights',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'promote', description: 'promote all pawns to knights', completion: 'promoted_count(self, knight) == 8', tolerance: 'loose', weight: 5 },
      ],
      fallback: ['play_best'],
    });
    const ctxNow = ctx(['e4', 'e5', 'Nf3', 'Nc6'], 'w');
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    // Pawn pushes must be among the generated candidates (the engine rarely
    // offers them and promotions are not legal yet).
    expect(cands.some((c) => c.motive.includes('march'))).toBe(true);
    expect(cands.every((c) => c.uci.length >= 4)).toBe(true);
  });

  it('generates hanging-piece sacrifices for non_pawn_count targets (D6 shedding)', () => {
    const compiled = plan({
      summary: 'reduce to K+Q',
      style: 'none',
      terminal: { kind: 'win', priority: 'milestones_first' },
      hardConstraints: [],
      milestones: [
        { id: 'reduce', description: 'K+Q only', completion: 'piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1', tolerance: 'medium', weight: 5 },
      ],
      fallback: ['secure_terminal', 'play_best'],
    });
    // White knight on d4, attacked by nothing but capturable by the e5 pawn
    // after Nd4 is reachable... use a position where a piece can hang:
    // White Ng5 offers itself to h7-g6 forks; simpler: Bc4 can be taken by d5?
    // Use the classic: white queen takes nothing, but a knight on e5 attacked
    // by pawns is a real offer. Position: after 1.e4 e5 2.Nf3 Nc6 3.Nxe5?:
    // the knight on e5 is attacked by Nc6? No—Nc6 attacks e5? No. Use d6 pawn.
    const g = new Chess('rnbqkbnr/ppp1pppp/8/3pN3/8/8/PPPP1PPP/RNBQKB1R w KQkq - 0 1');
    const ctxNow = buildContext(g, 'w', { evalWhiteCp: 0, mateWhite: null });
    const cands = motivatedCandidates(compiled, ctxNow, 0, new Set());
    // Trade-down captures AND hanging offers should both appear.
    expect(cands.some((c) => c.motive.includes('non_pawn_count(self)'))).toBe(true);
  });
});
