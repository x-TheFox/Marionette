import { Chess } from 'chess.js';
import type { CompiledPlan } from '../plan/schema.js';
import { extractGradientAtoms } from '../dsl/index.js';
import type { GameContext, PieceType, Side } from '../dsl/types.js';

/**
 * Motivated candidate generation.
 *
 * The engine's top-N MultiPV moves rarely include the moves a directive needs
 * (a queen offer, an underpromotion, a checking sequence). For the ACTIVE
 * milestone we look at its gradient atoms and generate extra legal moves that
 * can improve them. Each extra candidate is later scored like any other (with
 * an individual eval), so this list only widens choice — it never forces moves.
 */

export interface Candidate {
  uci: string;
  san: string;
  /** Where it came from (for the rationale log). */
  source: 'engine' | 'motivated';
  /** Which gradient atom motivated it ('' for engine moves). */
  motive: string;
}

const MAX_MOTIVATED = 4;

interface VerboseMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  captured?: string;
  piece: string;
  color: string;
  flags: string;
}

const PIECE_VAL: Record<PieceType, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };

/** Map a DSL side name ('self'|'opp'|'white'|'black') to a concrete color. */
function resolveSideName(name: string, self: Side): Side {
  if (name === 'self') return self;
  if (name === 'opp') return self === 'w' ? 'b' : 'w';
  if (name === 'white') return 'w';
  return 'b';
}

/** True if, after `m`, an opponent capture wins material (victim > capturer − 100). */
function isHangingOffer(game: Chess, m: VerboseMove, oppSide: Side): boolean {
  const moverVal = PIECE_VAL[m.piece as PieceType] ?? 0;
  if (moverVal < 300) return false; // never waste slots offering pawns/minors blindly
  game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
  let offered = false;
  for (const reply of game.moves({ verbose: true }) as VerboseMove[]) {
    if (reply.color !== oppSide || !reply.captured) continue;
    const victimVal = PIECE_VAL[reply.captured as PieceType] ?? 0;
    const capturerVal = PIECE_VAL[reply.piece as PieceType] ?? 0;
    if (victimVal - capturerVal >= 100 || (victimVal >= 500 && capturerVal <= victimVal)) {
      offered = true;
      break;
    }
  }
  game.undo();
  return offered;
}

/**
 * Generate motivated candidates for the active milestone, deduplicated
 * against the engine's own lines. Returns [] when it is not our turn.
 */
export function motivatedCandidates(
  plan: CompiledPlan,
  ctx: GameContext,
  activeIndex: number,
  engineUcis: Set<string>,
): Candidate[] {
  const ms = plan.milestones[activeIndex];
  if (!ms) return [];
  const atoms = extractGradientAtoms(ms.completion.ast);
  if (atoms.length === 0) return [];

  const game = new Chess(ctx.fen);
  const selfTurn = game.turn() === ctx.self;
  if (!selfTurn) return [];
  const legal = game.moves({ verbose: true }) as VerboseMove[];
  const oppSide: Side = ctx.self === 'w' ? 'b' : 'w';

  const out: Candidate[] = [];
  const seen = new Set<string>(engineUcis);
  const push = (m: VerboseMove, motive: string): void => {
    const uci = m.from + m.to + (m.promotion ?? '');
    if (seen.has(uci)) return;
    seen.add(uci);
    out.push({ uci, san: m.san, source: 'motivated', motive });
  };

  outer: for (const atom of atoms) {
    const atomSideName = atom.sides[0];
    const resolved: Side | undefined = atomSideName != null ? resolveSideName(atomSideName, ctx.self) : undefined;
    const piece = atom.pieces[0] as PieceType | undefined;
    const isSelfAtom = resolved === ctx.self;

    switch (atom.fn) {
      case 'captures_count': {
        // Count of captures WE performed → our captures.
        if (isSelfAtom) {
          for (const m of legal) if (m.captured) push(m, `captures_count(self): ${m.san}`);
        }
        break;
      }
      case 'captured_value': {
        // captured_value(side) = value of SIDE'S OWN pieces captured so far.
        if (isSelfAtom && atom.op && ['>=', '>', '=='].includes(atom.op)) {
          // We must lose material: prefer real hanging offers, else speculative
          // non-pawn quiet moves (the opponent will eventually take).
          const offers = legal.filter(
            (m) => !m.captured && m.piece !== 'k' && m.promotion == null && isHangingOffer(game, m, oppSide),
          );
          for (const m of offers) push(m, `captured_value(self): sacrifice ${m.san}`);
          if (out.length === 0) {
            for (const m of legal) {
              if (!m.captured && m.piece !== 'k' && m.piece !== 'p' && m.promotion == null) {
                push(m, `captured_value(self): offer ${m.san}`);
              }
              if (out.length >= 2) break;
            }
          }
        } else if (resolved === oppSide && atom.op && ['>=', '>', '=='].includes(atom.op)) {
          // Opponent's pieces must be captured → our captures.
          for (const m of legal) if (m.captured) push(m, `captured_value(opp): ${m.san}`);
        }
        break;
      }
      case 'material': {
        if (isSelfAtom && atom.op && atom.target != null && ['<', '<=', '=='].includes(atom.op)) {
          // material(self) must shrink (or hit exact number): trade down + offers.
          for (const m of legal) {
            if (m.captured) {
              const victimVal = PIECE_VAL[m.captured as PieceType] ?? 0;
              const moverVal = PIECE_VAL[m.piece as PieceType] ?? 0;
              if (victimVal <= moverVal) push(m, `material(self): trade down ${m.san}`);
            }
          }
          for (const m of legal) {
            if (!m.captured && m.piece !== 'k' && m.promotion == null && isHangingOffer(game, m, oppSide)) {
              push(m, `material(self): sacrifice ${m.san}`);
            }
          }
        }
        break;
      }
      case 'non_pawn_count': {
        if (isSelfAtom && atom.op && atom.target != null && ['<', '<=', '=='].includes(atom.op)) {
          for (const m of legal) {
            if (m.captured) {
              const victimVal = PIECE_VAL[m.captured as PieceType] ?? 0;
              const moverVal = PIECE_VAL[m.piece as PieceType] ?? 0;
              if (victimVal <= moverVal) push(m, `non_pawn_count(self): trade ${m.san}`);
            }
          }
        }
        break;
      }
      case 'checks_count': {
        if (isSelfAtom) {
          for (const m of legal) {
            game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
            if (game.inCheck()) push(m, `checks_count(self): ${m.san}`);
            game.undo();
          }
        }
        break;
      }
      case 'promoted_count':
      case 'piece_count': {
        if (isSelfAtom && piece && piece !== 'pawn' && piece !== 'king') {
          const letter = piece === 'knight' ? 'n' : piece === 'bishop' ? 'b' : piece === 'rook' ? 'r' : 'q';
          for (const m of legal) if (m.promotion === letter) push(m, `${atom.fn}(self, ${piece}): ${m.san}`);
        }
        break;
      }
      case 'mated_by':
      case 'is_checkmate': {
        if (resolved === ctx.self) {
          for (const m of legal) {
            game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
            if (game.isCheckmate()) push(m, `mate-in-1: ${m.san}`);
            game.undo();
          }
        }
        break;
      }
      case 'castled': {
        if (isSelfAtom) {
          for (const m of legal) {
            if (m.flags.includes('k') || m.flags.includes('q')) push(m, `castled(self): ${m.san}`);
          }
        }
        break;
      }
      default:
        break;
    }
    if (out.length >= MAX_MOTIVATED) break outer;
  }

  return out.slice(0, MAX_MOTIVATED);
}
