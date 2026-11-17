/** Board context every predicate evaluates against. Built from a chess.js game. */
export type Side = 'w' | 'b';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type Phase = 'opening' | 'middlegame' | 'endgame';

export interface LastMoveInfo {
  color: Side;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  san: string;
  wasCheck: boolean;
}

export interface GameContext {
  fen: string;
  turn: Side;
  /** Marionette's color. */
  self: Side;
  moveNumber: number;
  ply: number;
  lastMove: LastMoveInfo | null;
  /** Non-king material value in centipawns. */
  material: Record<Side, number>;
  pieces: Record<Side, Record<PieceType, number>>;
  /** Pawns promoted to each piece type so far. */
  promoted: Record<Side, Record<PieceType, number>>;
  /** Number of captures each side performed. */
  capturesCount: Record<Side, number>;
  /** Number of checks each side gave. */
  checksCount: Record<Side, number>;
  /** Total value of each side's pieces that were captured. */
  capturedValue: Record<Side, number>;
  castled: Record<Side, boolean>;
  phase: Phase;
  /** Engine eval of the current position, white-centric centipawns (null = unknown). */
  evalWhiteCp: number | null;
  /** White-centric mate distance (positive: white mates in N; null = unknown). */
  mateWhite: number | null;
  over: boolean;
  checkmate: boolean;
  stalemate: boolean;
  draw: boolean;
  insufficient: boolean;
  winner: Side | null;
  /** Piece that delivered checkmate (approximated by the mating move's piece). */
  matedBy: PieceType | null;
}

export const MATERIAL_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 0,
};
