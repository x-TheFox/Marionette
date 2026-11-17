import { Chess, type Move, type PieceSymbol } from 'chess.js';
import { MATERIAL_VALUES, type GameContext, type LastMoveInfo, type PieceType, type Phase, type Side } from './types.js';

const PIECE_SYMBOL_TO_TYPE: Record<PieceSymbol, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export interface ContextEvalInfo {
  evalWhiteCp: number | null;
  mateWhite: number | null;
}

/**
 * Build a GameContext from a chess.js game.
 *
 * `checkFlags` (one boolean per history move: did that move give check?) can be
 * supplied by the runner, which tracks it incrementally. When omitted it is
 * recomputed by replaying history — correct but O(ply) board loads, so hot
 * paths (candidate scoring) should pass it.
 */
export function buildContext(
  game: Chess,
  self: Side,
  evalInfo: ContextEvalInfo,
  checkFlags?: boolean[],
): GameContext {
  const history = game.history({ verbose: true }) as Move[];
  const flags = checkFlags ?? computeCheckFlags(history);

  const pieces: Record<Side, Record<PieceType, number>> = {
    w: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 },
    b: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 },
  };
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq) pieces[sq.color as Side][PIECE_SYMBOL_TO_TYPE[sq.type]]++;
    }
  }
  const material: Record<Side, number> = { w: 0, b: 0 };
  for (const side of ['w', 'b'] as const) {
    for (const pt of ['pawn', 'knight', 'bishop', 'rook', 'queen'] as const) {
      material[side] += pieces[side][pt] * MATERIAL_VALUES[pt];
    }
  }

  const promoted: Record<Side, Record<PieceType, number>> = {
    w: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 },
    b: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 },
  };
  const capturesCount: Record<Side, number> = { w: 0, b: 0 };
  const checksCount: Record<Side, number> = { w: 0, b: 0 };
  const capturedValue: Record<Side, number> = { w: 0, b: 0 };
  const castled: Record<Side, boolean> = { w: false, b: false };

  history.forEach((m, i) => {
    const mover = m.color as Side;
    const victim = m.captured ? PIECE_SYMBOL_TO_TYPE[m.captured as PieceSymbol] : undefined;
    const promo = m.promotion ? PIECE_SYMBOL_TO_TYPE[m.promotion as PieceSymbol] : undefined;
    const movedPiece = PIECE_SYMBOL_TO_TYPE[m.piece as PieceSymbol];
    if (promo) promoted[mover][promo]++;
    if (victim) {
      capturesCount[mover]++;
      capturedValue[mover === 'w' ? 'b' : 'w'] += MATERIAL_VALUES[victim];
    }
    if (m.flags.includes('k') || m.flags.includes('q')) castled[mover] = true;
    if (flags[i]) checksCount[mover]++;
    void movedPiece;
  });

  const lastHist = history[history.length - 1];
  const lastMove: LastMoveInfo | null = lastHist
    ? {
        color: lastHist.color as Side,
        // After a promotion the piece "as it stands" is the promoted type
        // (so mated_by(self, knight) works for promotion-mates).
        piece: lastHist.promotion
          ? PIECE_SYMBOL_TO_TYPE[lastHist.promotion as PieceSymbol]
          : PIECE_SYMBOL_TO_TYPE[lastHist.piece as PieceSymbol],
        captured: lastHist.captured ? PIECE_SYMBOL_TO_TYPE[lastHist.captured as PieceSymbol] : undefined,
        promotion: lastHist.promotion ? PIECE_SYMBOL_TO_TYPE[lastHist.promotion as PieceSymbol] : undefined,
        san: lastHist.san,
        wasCheck: flags[flags.length - 1] ?? false,
      }
    : null;

  const checkmate = game.isCheckmate();
  const stalemate = game.isStalemate();
  const draw = game.isDraw();
  const insufficient = game.isInsufficientMaterial();
  const over = checkmate || stalemate || draw || insufficient;
  const turn = game.turn() as Side;
  const winner: Side | null = checkmate ? (turn === 'w' ? 'b' : 'w') : null;

  const totalNonKing =
    pieces.w.pawn + pieces.w.knight + pieces.w.bishop + pieces.w.rook + pieces.w.queen +
    pieces.b.pawn + pieces.b.knight + pieces.b.bishop + pieces.b.rook + pieces.b.queen;
  const moveNumber = parseInt(game.fen().split(' ')[5] ?? '1', 10) || 1;
  let phase: Phase = 'middlegame';
  if ((moveNumber <= 10 && totalNonKing >= 28) || totalNonKing >= 30) phase = 'opening';
  else if (totalNonKing <= 10) phase = 'endgame';

  return {
    fen: game.fen(),
    turn,
    self,
    moveNumber,
    ply: history.length,
    lastMove,
    material,
    pieces,
    promoted,
    capturesCount,
    checksCount,
    capturedValue,
    castled,
    phase,
    evalWhiteCp: evalInfo.evalWhiteCp,
    mateWhite: evalInfo.mateWhite,
    over,
    checkmate,
    stalemate,
    draw,
    insufficient,
    winner,
    matedBy: checkmate && lastMove?.wasCheck ? lastMove.piece : null,
  };
}

function computeCheckFlags(history: Move[]): boolean[] {
  const flags: boolean[] = [];
  // Replay from the position the history started from (history[0].before),
  // which may be a custom FEN — not necessarily the start position.
  let scratch = history.length > 0 ? new Chess(history[0].before) : new Chess();
  for (const m of history) {
    scratch.move(m.san);
    flags.push(scratch.inCheck());
  }
  return flags;
}

/** Check flags for the current position's history, computed from scratch. */
export function currentCheckFlags(game: Chess): boolean[] {
  return computeCheckFlags(game.history({ verbose: true }) as Move[]);
}
