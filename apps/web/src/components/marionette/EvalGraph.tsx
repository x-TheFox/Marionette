'use client';

/**
 * Eval graph: SVG line of the self-perspective eval trail with milestone
 * completion markers, drop markers, replan markers and a scrub cursor.
 * Null evals (unknown positions) are gaps in the line.
 */
import type { ReportMilestone } from '@/lib/marionette/types';

export interface GraphMarkers {
  completions: { ply: number; id: string }[];
  drops: { ply: number; id: string }[];
  replans: { ply: number; reason: string }[];
}

const W = 1000;
const H = 220;
const PAD_X = 14;
const PAD_Y = 14;

function evalToY(cp: number): number {
  const clamped = Math.max(-1200, Math.min(1200, cp));
  const t = 1 / (1 + Math.exp(-clamped / 300));
  return PAD_Y + (1 - t) * (H - 2 * PAD_Y);
}

export default function EvalGraph({
  evalTrail,
  selfColor,
  totalPlies,
  markers,
  cursorPly,
  onSeek,
}: {
  evalTrail: (number | null)[];
  selfColor: 'w' | 'b';
  totalPlies: number;
  markers: GraphMarkers;
  cursorPly: number; // 0-based ply the cursor points at
  onSeek?: (ply: number) => void;
}) {
  const total = Math.max(1, totalPlies);
  const xOfPly = (ply: number) => PAD_X + (ply / total) * (W - 2 * PAD_X);

  // Build points: evalTrail[i] sits at the ply of the i-th Marionette move.
  const points: { x: number; y: number; ply: number }[] = [];
  evalTrail.forEach((cp, i) => {
    if (cp == null) return;
    const ply = selfColor === 'w' ? i * 2 : i * 2 + 1;
    points.push({ x: xOfPly(ply), y: evalToY(cp), ply });
  });

  const segments: { d: string }[] = [];
  let current: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && p.ply - prev.ply > 2) {
      // gap (would include opponent-only stretches): break the line
      if (current.length > 1) segments.push({ d: current.join(' ') });
      current = [];
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  if (current.length > 1) segments.push({ d: current.join(' ') });

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full cursor-crosshair rounded-lg border border-border/50 bg-background/60 sm:h-52"
        role="img"
        aria-label="Eval graph over plies with milestone markers"
        onClick={(e) => {
          if (!onSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const ply = Math.round(frac * total);
          onSeek(Math.max(0, Math.min(total - 1, ply)));
        }}
      >
        {/* midline */}
        <line x1={PAD_X} y1={H / 2} x2={W - PAD_X} y2={H / 2} stroke="oklch(1 0 0 / 15%)" strokeDasharray="4 6" />
        {/* eval line */}
        {segments.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke="oklch(0.8 0.16 85)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* milestone completions (emerald) */}
        {markers.completions.map((m) => (
          <g key={`c-${m.id}-${m.ply}`}>
            <line x1={xOfPly(m.ply)} y1={PAD_Y} x2={xOfPly(m.ply)} y2={H - PAD_Y} stroke="oklch(0.72 0.17 160 / 55%)" strokeWidth={1.5} />
            <circle cx={xOfPly(m.ply)} cy={PAD_Y + 6} r={4} fill="oklch(0.72 0.17 160)" />
            <title>{`milestone ${m.id} completed at ply ${m.ply + 1}`}</title>
          </g>
        ))}
        {/* drops (rose) */}
        {markers.drops.map((m, i) => (
          <g key={`d-${m.id}-${i}`}>
            <line x1={xOfPly(m.ply)} y1={PAD_Y} x2={xOfPly(m.ply)} y2={H - PAD_Y} stroke="oklch(0.63 0.2 18 / 60%)" strokeWidth={1.5} strokeDasharray="3 4" />
            <circle cx={xOfPly(m.ply)} cy={H - PAD_Y - 6} r={4} fill="oklch(0.63 0.2 18)" />
            <title>{`milestone ${m.id} dropped at ply ${m.ply + 1}`}</title>
          </g>
        ))}
        {/* replans (amber diamond) */}
        {markers.replans.map((r, i) => (
          <g key={`r-${i}`}>
            <rect
              x={xOfPly(r.ply) - 5}
              y={H / 2 - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${xOfPly(r.ply)} ${H / 2})`}
              fill="oklch(0.8 0.16 85)"
            />
            <title>{`replan at ply ${r.ply + 1}: ${r.reason.slice(0, 120)}`}</title>
          </g>
        ))}
        {/* cursor */}
        <line x1={xOfPly(cursorPly)} y1={PAD_Y} x2={xOfPly(cursorPly)} y2={H - PAD_Y} stroke="oklch(0.96 0.005 90 / 70%)" strokeWidth={2} />
        <circle cx={xOfPly(cursorPly)} cy={H / 2} r={5} fill="oklch(0.96 0.005 90)" />
      </svg>
      <figcaption className="mt-1 text-[10px] text-muted-foreground">
        Self-perspective eval after each Marionette move (logistic scale). Emerald = milestone completion, rose dashed = drop,
        diamond = replan. Click to scrub.
      </figcaption>
    </figure>
  );
}

export function markersFromReport(
  milestones: ReportMilestone[],
  replans: { atPly: number; reason: string }[],
): GraphMarkers {
  return {
    completions: milestones.filter((m) => m.completed && m.completedAtPly != null).map((m) => ({ ply: (m.completedAtPly ?? 1) - 1, id: m.id })),
    drops: milestones.filter((m) => m.droppedAtPly != null && !m.completed).map((m) => ({ ply: (m.droppedAtPly ?? 1) - 1, id: m.id })),
    replans: replans.map((r) => ({ ply: Math.max(0, r.atPly - 1), reason: r.reason })),
  };
}
