/**
 * F3 director's commentary: one rule-generated sentence per significant move,
 * derived ONLY from report data (milestones, replans, steering trail, eval
 * trail, PGN history). Zero LLM.
 */
import { Chess } from 'chess.js';
import type { GameReport, SteeringEntry } from './types';

export interface CommentaryLine {
  ply: number; // 0-based move index into the SAN history
  text: string;
  kind: 'milestone' | 'drop' | 'replan' | 'swing' | 'capture' | 'sacrifice' | 'promotion' | 'end';
}

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function historyOf(pgn: string): { san: string; captured?: string; promotion?: string; color: 'w' | 'b' }[] {
  const g = new Chess();
  try {
    g.loadPgn(pgn);
  } catch {
    return [];
  }
  return g.history({ verbose: true }) as unknown as { san: string; captured?: string; promotion?: string; color: 'w' | 'b' }[];
}

/** Ply (0-based) of the i-th Marionette move given Marionette's color. */
function marionettePly(i: number, selfColor: 'w' | 'b'): number {
  return selfColor === 'w' ? i * 2 : i * 2 + 1;
}

export function generateCommentary(report: GameReport): CommentaryLine[] {
  const lines: CommentaryLine[] = [];
  const hist = historyOf(report.pgn);
  const self = report.selfColor;

  // Milestone completions + drops.
  for (const m of report.milestones) {
    if (m.completed && m.completedAtPly != null) {
      const idx = m.completedAtPly - 1;
      const san = idx >= 0 && idx < hist.length ? hist[idx]?.san : undefined;
      lines.push({
        ply: idx,
        kind: 'milestone',
        text: `${san ? `${san}: ` : ''}milestone '${m.id}' completed — ${m.description.toLowerCase()}`,
      });
    }
    if (m.droppedAtPly != null && !m.completed) {
      const idx = m.droppedAtPly - 1;
      lines.push({
        ply: idx,
        kind: 'drop',
        text: `milestone '${m.id}' dropped: ${m.dropReason ?? 'replan'}`,
      });
    }
  }

  // Replans.
  for (const r of report.replans) {
    lines.push({
      ply: r.atPly - 1,
      kind: 'replan',
      text: `plan revised (${r.provider}): ${r.reason}`,
    });
  }

  // Steering trail: sacrifices, big progress steps, captures of majors.
  const trail: SteeringEntry[] = report.steeringTrail ?? [];
  for (const e of trail) {
    const idx = e.ply;
    const h = hist[idx];
    if (!h) continue;
    const pct = Math.round((e.activeMilestoneProgress ?? 0) * 100);
    const milestone = e.activeMilestoneId ? `milestone ${e.activeMilestoneId}` : 'the terminal';
    if (e.evalLossCp != null && e.evalLossCp >= 150 && h.captured) {
      lines.push({
        ply: idx,
        kind: 'sacrifice',
        text: `${e.san}: takes the ${PIECE_NAMES[h.captured] ?? 'piece'} and gives up ${e.evalLossCp}cp of eval to push ${milestone} to ${pct}%`,
      });
    } else if (e.evalLossCp != null && e.evalLossCp >= 150) {
      lines.push({
        ply: idx,
        kind: 'sacrifice',
        text: `${e.san}: steered away from the engine best (${e.bestSan ?? '-'}) — ${e.evalLossCp}cp spent for ${milestone} at ${pct}%`,
      });
    } else if (e.chosenProgress >= 0.15) {
      // Compare against the PREVIOUS steering entry for the same milestone
      // (last earlier entry), so a single jump yields one line, not one per move.
      let prevForMs: number | null = null;
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i]!;
        if (p.ply < e.ply && p.activeMilestoneId === e.activeMilestoneId) {
          prevForMs = p.activeMilestoneProgress;
          break;
        }
      }
      if ((prevForMs ?? 0) < e.chosenProgress - 0.12) {
        lines.push({
          ply: idx,
          kind: 'milestone',
          text: `${e.san}: big step for ${milestone} — now at ${pct}%`,
        });
      }
    } else if (h.captured && ['q', 'r'].includes(h.captured)) {
      lines.push({
        ply: idx,
        kind: 'capture',
        text: `${e.san}: captures the ${PIECE_NAMES[h.captured]}${e.activeMilestoneId ? ` — ${milestone} at ${pct}%` : ''}`,
      });
    } else if (h.promotion) {
      lines.push({
        ply: idx,
        kind: 'promotion',
        text: `${e.san}: pawn promotes to ${PIECE_NAMES[h.promotion]}${e.activeMilestoneId ? ` — ${milestone} at ${pct}%` : ''}`,
      });
    }
  }

  // Big eval swings between consecutive Marionette moves (> 200cp).
  let prev: number | null = null;
  report.evalTrail.forEach((cp, i) => {
    if (cp == null) return;
    if (prev != null && Math.abs(cp - prev) > 200) {
      const idx = marionettePly(i, self);
      const dir = cp > prev ? "in Marionette's favor" : 'against Marionette';
      lines.push({
        ply: idx,
        kind: 'swing',
        text: `eval swings ${Math.abs(Math.round(cp - prev))}cp ${dir} (${Math.round(prev)} to ${Math.round(cp)})`,
      });
    }
    prev = cp;
  });

  // Game end.
  lines.push({
    ply: Math.max(0, report.plies - 1),
    kind: 'end',
    text: `game over: ${report.result} (${report.endReason}), terminal ${report.terminalMet ? 'MET' : 'NOT MET'}`,
  });

  const seen = new Set<string>();
  return lines
    .filter((l) => l.ply >= 0)
    .sort((a, b) => a.ply - b.ply || a.kind.localeCompare(b.kind))
    .filter((l) => {
      const key = `${l.ply}:${l.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ---------------------------------------------------------------------------
// F7 coach card (human challenge): rule-based, from the human report.

export interface CoachCard {
  headline: string;
  scoreLine: string;
  lines: { text: string; kind: 'good' | 'miss' | 'info' }[];
}

export function generateCoach(report: GameReport & { milestones: (GameReport['milestones'][number] & { endPartial?: number; conjuncts?: { src: string; partial: number }[] })[] }): CoachCard {
  const completed = report.milestones.filter((m) => m.completed);
  const missed = report.milestones.filter((m) => !m.completed);
  const lines: CoachCard['lines'] = [];

  for (const m of completed) {
    lines.push({ kind: 'good', text: `Completed '${m.id}' at ply ${m.completedAtPly ?? '?'} — ${m.description}` });
  }
  for (const m of missed) {
    const pct = Math.round((m.endPartial ?? m.bestPartial) * 100);
    lines.push({ kind: 'miss', text: `Missed '${m.id}' (${pct}% of the predicate) — ${m.description}` });
    // Name the conjuncts that never reached full credit (kept simple + honest).
    const failing = (m.conjuncts ?? []).filter((c) => c.partial < 1);
    if (failing.length > 0 && m.conjuncts && m.conjuncts.length > 1) {
      for (const c of failing.slice(0, 3)) {
        lines.push({
          kind: 'miss',
          text: `The plan needed '${c.src}' — it stayed at ${Math.round(c.partial * 100)}%.`,
        });
      }
    }
  }
  for (const v of report.violations) {
    lines.push({ kind: 'info', text: `Constraint '${v.id}' was violated at ply ${v.atPly}: ${v.description}` });
  }

  const scoreLine = `${completed.length}/${report.milestones.length} milestones completed, terminal ${report.terminalMet ? 'MET' : 'NOT MET'}`;
  const headline = report.terminalMet && completed.length === report.milestones.length
    ? 'Directive fulfilled. The puppet danced.'
    : completed.length > 0
      ? 'Partial progress — the plan shows through.'
      : 'Directive not fulfilled — the plan stayed hidden.';
  return { headline, scoreLine, lines };
}
