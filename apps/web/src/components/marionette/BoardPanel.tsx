'use client';

/**
 * The stage: react-chessboard (cburnett default set) with last-move, check and
 * milestone-flash highlights, the self-perspective eval bar, and the Border
 * Beam that runs while the steering layer is working.
 */
import { Chess } from 'chess.js';
import { useMemo } from 'react';
import { Chessboard, type PieceDropHandlerArgs } from 'react-chessboard';
import { BorderBeam, NumberTicker } from './magic';

export interface BoardHighlights {
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  flashSquares?: string[];
}

const LAST_MOVE_STYLE = {
  background: 'oklch(0.8 0.16 85 / 38%)', // amber spotlight
};
const CHECK_STYLE = {
  background: 'radial-gradient(circle, oklch(0.63 0.2 18 / 75%) 15%, transparent 72%)',
};
const FLASH_STYLE = {
  background: 'oklch(0.72 0.17 160 / 45%)', // emerald milestone flash
};

function findKingSquare(fen: string, color: 'w' | 'b'): string | null {
  try {
    const g = new Chess(fen);
    if (!g.inCheck()) return null;
    for (const row of g.board()) {
      for (const sq of row) {
        if (sq && sq.type === 'k' && sq.color === color) return sq.square;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function EvalBar({ cpSelf, flipped }: { cpSelf: number | null; flipped?: boolean }) {
  // Logistic mapping: +300cp ~ 88% of the bar, 0 ~ 50%.
  const share = cpSelf == null ? 0.5 : 1 / (1 + Math.exp(-cpSelf / 300));
  const advantage = cpSelf == null ? '' : cpSelf >= 0 ? 'Marionette' : 'opponent';
  return (
    <div className="flex h-full flex-col items-center justify-between gap-2 py-1">
      <div
        className="relative w-6 flex-1 overflow-hidden rounded-full border border-border/60 bg-background"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(share * 100)}
        aria-label="Self-perspective eval"
      >
        <div
          className="absolute bottom-0 left-0 w-full rounded-full bg-gradient-to-t from-amber-500/90 to-amber-300/90 transition-all duration-700"
          style={{ height: `${Math.max(2, Math.min(98, share * 100))}%` }}
        />
        <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 bg-foreground/30" />
      </div>
      <div className="text-center text-[10px] leading-tight text-muted-foreground">
        {cpSelf != null ? (
          <>
            <NumberTicker value={cpSelf} format={(v) => (v >= 0 ? `+${Math.round(v)}` : String(Math.round(v)))} className="font-mono font-bold text-amber-300" />
            <div>{advantage}</div>
          </>
        ) : (
          <>
            <span className="font-mono font-bold">-</span>
            <div>eval</div>
          </>
        )}
      </div>
      {flipped && <span className="sr-only">eval shown from Marionette's perspective</span>}
    </div>
  );
}

export default function BoardPanel({
  fen,
  orientation,
  highlights,
  beamActive,
  allowDrag,
  onPieceDrop,
  evalSelfCp,
  children,
  boardLabel,
}: {
  fen: string;
  orientation: 'white' | 'black';
  highlights: BoardHighlights;
  beamActive: boolean;
  allowDrag?: boolean;
  onPieceDrop?: (from: string, to: string) => boolean;
  evalSelfCp?: number | null;
  children?: React.ReactNode;
  boardLabel?: string;
}) {
  const checkSquare = useMemo(() => {
    if (!highlights.checkSquare) return null;
    return highlights.checkSquare;
  }, [highlights.checkSquare]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (highlights.lastMove) {
      styles[highlights.lastMove.from] = LAST_MOVE_STYLE;
      styles[highlights.lastMove.to] = LAST_MOVE_STYLE;
    }
    if (checkSquare) styles[checkSquare] = CHECK_STYLE;
    for (const s of highlights.flashSquares ?? []) styles[s] = FLASH_STYLE;
    return styles;
  }, [highlights, checkSquare]);

  return (
    <div className="relative w-full" aria-label={boardLabel ?? 'Chess board'}>
      <BorderBeam active={beamActive} />
      <div className="relative flex gap-2">
        <div className="min-w-0 flex-1">
          <Chessboard
            options={{
              position: fen,
              boardOrientation: orientation,
              squareStyles,
              animationDurationInMs: 240,
              allowDragging: allowDrag ?? false,
              onPieceDrop: onPieceDrop
                ? ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => (targetSquare ? onPieceDrop(sourceSquare, targetSquare) : false)
                : undefined,
            }}
          />
        </div>
        <div className="hidden sm:block">
          <EvalBar cpSelf={evalSelfCp ?? null} flipped={orientation === 'black'} />
        </div>
      </div>
      {children}
    </div>
  );
}

export { findKingSquare };
