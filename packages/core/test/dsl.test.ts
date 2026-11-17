import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import {
  compilePredicate,
  evalPredicate,
  predicatePartial,
  buildContext,
  extractGradientAtoms,
  atomGradientValue,
  atomImprovement,
  PredicateError,
} from '../src/dsl/index.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function ctxFor(moves: string[], self: 'w' | 'b' = 'w', evalWhiteCp: number | null = 20) {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return buildContext(g, self, { evalWhiteCp, mateWhite: null });
}

describe('predicate parsing + validation', () => {
  it('parses and validates the documented vocabulary', () => {
    const cases = [
      'material(self) == 0',
      'piece_count(self, queen) == 1 && piece_count(self, pawn) == 0',
      'non_pawn_count(self) == 1 && non_pawn_count(opp) >= 2',
      'promoted_count(self, knight) >= 3',
      'winner() == opp',
      'is_checkmate() && mated_by(self, knight)',
      'self_eval_cp() <= -300 || self_eval_cp() >= 300',
      '!(last_move_was_capture()) && move_number() > 20',
      "phase() == 'endgame'",
      'mate_in() > 0 && mate_in() <= 5',
      'castled(self) && captures_count(opp) >= 3',
      'captured_value(opp) >= 1000 && checks_count(self) >= 5',
    ];
    for (const c of cases) {
      expect(() => compilePredicate(c), c).not.toThrow();
    }
  });

  it('rejects unknown functions, bad arity, bad enums, type errors', () => {
    const bad = [
      'foobar(self) == 1',                    // unknown fn
      'material(self, pawn) == 1',            // wrong arity
      'piece_count(self, dragon) == 1',       // bad piece
      'piece_count(green, pawn) == 1',        // bad side
      'material(self) == white',              // number vs string
      'material(self) && is_check()',         // && on number
      'is_check() > 3',                       // comparison on boolean with >
      'material(self)',                       // not boolean overall
      'material(self) == ',                   // syntax error
      'is_check(',                            // unbalanced
    ];
    for (const b of bad) {
      expect(() => compilePredicate(b), b).toThrow(PredicateError);
    }
  });
});

describe('evaluation on fixed positions', () => {
  it('start position basics', () => {
    const ctx = ctxFor([]);
    expect(evalPredicate(compilePredicate('material(white) == 4000'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('piece_count(white, knight) == 2'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('non_pawn_count(black) == 7'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('move_number() == 1'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('ply() == 0'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('last_move_was_capture()'), ctx)).toBe(false);
    expect(evalPredicate(compilePredicate('phase() == \'opening\''), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('eval_cp() == 20'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('self_eval_cp() == 20'), ctx)).toBe(true);
  });

  it('self vs opp resolution flips with color', () => {
    const asWhite = ctxFor([]);
    const asBlack = buildContext(new Chess(), 'b', { evalWhiteCp: 20, mateWhite: null });
    expect(evalPredicate(compilePredicate('self_eval_cp() == 20'), asWhite)).toBe(true);
    expect(evalPredicate(compilePredicate('self_eval_cp() == -20'), asBlack)).toBe(true);
    expect(evalPredicate(compilePredicate('turn() == self'), asWhite)).toBe(true);
  });

  it('captures, checks, material after a short sequence', () => {
    // 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6
    const ctx = ctxFor(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6']);
    expect(evalPredicate(compilePredicate('captures_count(white) == 1'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('captures_count(black) == 1'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('material(white) == 3670'), ctx)).toBe(true); // bishop gone
    expect(evalPredicate(compilePredicate('material(black) == 3680'), ctx)).toBe(true); // knight gone
    expect(evalPredicate(compilePredicate('captured_value(white) == 330'), ctx)).toBe(true); // white lost a bishop
    expect(evalPredicate(compilePredicate('last_move_was_capture()'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('last_move_piece() == pawn'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('piece_count(black, bishop) == 2'), ctx)).toBe(true);
  });

  it('promotion counting', () => {
    const g = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    g.move('a8=N');
    const ctx = buildContext(g, 'w', { evalWhiteCp: 100, mateWhite: null });
    expect(evalPredicate(compilePredicate('promoted_count(white, knight) == 1'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('piece_count(white, knight) == 1'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('last_move_was_promotion()'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('last_move_piece() == knight'), ctx)).toBe(true);
  });

  it('checkmate detection and mated_by', () => {
    const g = new Chess('k7/8/1K6/8/8/8/8/7R w - - 0 1');
    g.move('Rh8#');
    const ctx = buildContext(g, 'w', { evalWhiteCp: null, mateWhite: 1 });
    expect(evalPredicate(compilePredicate('is_checkmate()'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('winner() == white'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('mated_by(white, rook)'), ctx)).toBe(true);
    expect(evalPredicate(compilePredicate('mate_in() == 1'), ctx)).toBe(true);
  });

  it('check detection mid-game', () => {
    // Scholar's mate setup: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7# — use move 3...Nf6?? then check after Qxf7
    const ctx = ctxFor(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);
    expect(evalPredicate(compilePredicate('is_check()'), ctx)).toBe(false);
    const g = new Chess();
    for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']) g.move(m);
    g.move('Qxf7#');
    const mateCtx = buildContext(g, 'w', { evalWhiteCp: null, mateWhite: 1 });
    expect(evalPredicate(compilePredicate('is_checkmate()'), mateCtx)).toBe(true);
    expect(evalPredicate(compilePredicate('checks_count(white) == 1'), mateCtx)).toBe(true);
    expect(evalPredicate(compilePredicate('mated_by(white, queen)'), mateCtx)).toBe(true);
  });
});

describe('partial credit and gradient atoms', () => {
  it('material sacrifice credit is monotone', () => {
    const full = ctxFor([]); // 4000 material
    const after = ctxFor(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6']); // 3670
    const p = compilePredicate('material(self) == 0');
    const cFull = predicatePartial(p, full);
    const cAfter = predicatePartial(p, after);
    expect(cAfter).toBeGreaterThan(cFull);
    expect(cAfter).toBeGreaterThan(0);
  });

  it('promotion gradient rewards pawn advancement', () => {
    const early = ctxFor([]); // pawns on rank 2
    const g2 = new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    g2.move('e4');
    const pushed = buildContext(g2, 'w', { evalWhiteCp: 0, mateWhite: null });
    const p = compilePredicate('promoted_count(self, knight) >= 1');
    expect(predicatePartial(p, pushed)).toBeGreaterThan(predicatePartial(p, early));
    expect(predicatePartial(p, pushed)).toBeGreaterThan(0);
  });

  it('gradient atoms + improvement direct sacrifice detection', () => {
    // White can give a knight away: from start, moves that lose material
    // improve material(self) == 0.
    const ctx = ctxFor([]);
    const atoms = extractGradientAtoms(compilePredicate('material(self) == 0').ast);
    expect(atoms.length).toBe(1);
    expect(atoms[0]!.fn).toBe('material');
    const gBefore = atomGradientValue(atoms[0]!, ctx);
    // simulate 1. Nf3 (no material change) vs a blunder that drops a knight
    const g2 = new Chess();
    g2.move('e4');
    g2.move('e5');
    g2.move('Nf3');
    const afterNf3 = buildContext(g2, 'w', { evalWhiteCp: 20, mateWhite: null });
    const gNoChange = atomGradientValue(atoms[0]!, afterNf3);
    expect(atomImprovement(atoms[0]!, gBefore, gNoChange)).toBe(0);
  });

  it('boolean atoms: knight-check gradient for mated_by', () => {
    const atoms = extractGradientAtoms(compilePredicate('is_checkmate() && mated_by(self, knight)').ast);
    expect(atoms.length).toBe(2);
    // position after white plays a knight check (Nd6+ hits the e8 king)
    const g = new Chess('4k3/8/8/8/4N3/8/8/4K3 w - - 0 1');
    g.move('Nd6+');
    const ctx = buildContext(g, 'w', { evalWhiteCp: 50, mateWhite: null });
    const mateAtom = atoms.find((a) => a.fn === 'is_checkmate')!;
    expect(atomGradientValue(mateAtom, ctx)).toBe(0.5);
    const matedAtom = atoms.find((a) => a.fn === 'mated_by')!;
    expect(atomGradientValue(matedAtom, ctx)).toBe(0.5);
  });
});
