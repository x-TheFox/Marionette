/**
 * F1 calibration: "just hard enough" opponent suggestions.
 *
 * Loads the two committed quick-sweep summaries (the newest full sweep, 188
 * games, 2026-11-17) and computes, per directive, the actual completion metric
 * at each opponent ELO. The suggestion is the ELO at which the best available
 * metric (ordered-full rate, falling back to terminal-met rate when
 * ordered-full never reaches the target) crosses ~60% — with linear
 * interpolation between measured points. Suggestions are never invented: when
 * a directive never reaches 60% on any measured metric, the easiest measured
 * level is suggested with an honest note.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH_DIR } from './engine.js';

export const SUPPORTED_ELOS = [800, 1200, 1600, 2000] as const;
export const CALIBRATION_TARGET = 0.6;

interface SweepOutcome {
  id: string;
  elo: number;
  gameIdx: number;
  error: string | null;
  report: {
    selfColor: 'w' | 'b';
    result: string;
    terminalMet: boolean;
    milestones: { id: string; completed: boolean }[];
  } | null;
}

interface SweepFile {
  file: string;
  stamp: string;
  gamesPerCell: number;
  offline: boolean;
  elos: number[];
  outcomes: SweepOutcome[];
  verdicts: { id: string; bar: string; n: number; hits: number; rate: number; pass: boolean; expectedFail: boolean; detail: string }[];
}

function loadSweeps(): SweepFile[] {
  const files = readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json')).sort();
  const sweeps: SweepFile[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(BENCH_DIR, f), 'utf8'));
      if (!Array.isArray(raw.outcomes) || !Array.isArray(raw.verdicts)) continue;
      sweeps.push({
        file: f,
        stamp: raw.stamp ?? f,
        gamesPerCell: raw.gamesPerCell ?? 0,
        offline: raw.offline ?? true,
        elos: raw.elos ?? [],
        outcomes: raw.outcomes,
        verdicts: raw.verdicts,
      });
    } catch {
      // unreadable summary: skip it
    }
  }
  // newest first (filenames are ISO-ish stamps)
  return sweeps.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
}

export const SWEEPS = loadSweeps();

export function gameWon(o: SweepOutcome): boolean {
  if (!o.report) return false;
  return (o.report.selfColor === 'w' && o.report.result === '1-0') || (o.report.selfColor === 'b' && o.report.result === '0-1');
}

export function gameLost(o: SweepOutcome): boolean {
  if (!o.report) return false;
  return (o.report.selfColor === 'w' && o.report.result === '0-1') || (o.report.selfColor === 'b' && o.report.result === '1-0');
}

export function gameOrderedFull(o: SweepOutcome): boolean {
  if (!o.report) return false;
  return o.report.milestones.length > 0 && o.report.milestones.every((m) => m.completed) && o.report.terminalMet;
}

interface Cell {
  n: number;
  orderedFull: number;
  terminalMet: number;
  wins: number;
  losses: number;
}

/** Per-ELO measured cells for a directive across ALL loaded sweeps (newest include D1/D6). */
export function cellsFor(directiveId: string): Record<number, Cell> {
  const cells: Record<number, Cell> = {};
  for (const elo of SUPPORTED_ELOS) cells[elo] = { n: 0, orderedFull: 0, terminalMet: 0, wins: 0, losses: 0 };
  for (const sweep of SWEEPS) {
    for (const o of sweep.outcomes) {
      if (o.id !== directiveId || o.error || !o.report) continue;
      const cell = cells[o.elo];
      if (!cell) continue;
      cell.n++;
      if (gameOrderedFull(o)) cell.orderedFull++;
      if (o.report.terminalMet) cell.terminalMet++;
      if (gameWon(o)) cell.wins++;
      if (gameLost(o)) cell.losses++;
    }
  }
  return cells;
}

export interface CalibrationPoint {
  elo: number;
  n: number;
  orderedFull: number;
  terminalMet: number;
  wins: number;
  losses: number;
}

export interface DirectiveCalibration {
  directiveId: string;
  target: number;
  /** Metric used for the crossing computation (best available). */
  metric: 'ordered_full' | 'terminal_met';
  /** Measured points per ELO (all games of the newest sweeps). */
  points: CalibrationPoint[];
  /** Interpolated ELO where the chosen metric crosses the target, or null. */
  crossingElo: number | null;
  /** Suggested opponent ELO snapped to a supported level. */
  suggestedElo: number;
  /** Suggestion quality note — honest about weak calibration data. */
  note: string;
  /** n = 3 or 10 games per cell in the source sweeps. */
  gamesPerCell: number;
}

function interpolateCrossing(points: CalibrationPoint[], metric: 'ordered_full' | 'terminal_met', target: number): number | null {
  const rate = (p: CalibrationPoint) => (metric === 'ordered_full' ? p.orderedFull : p.terminalMet);
  const asc = [...points].sort((a, b) => a.elo - b.elo);
  if (asc.length === 0) return null;
  // Stronger opponents are harder: the rate decreases with ELO. Find the
  // segment where the rate falls through the target.
  for (let i = 0; i < asc.length - 1; i++) {
    const a = asc[i]!;
    const b = asc[i + 1]!;
    const ra = rate(a);
    const rb = rate(b);
    if (ra >= target && rb < target && ra > rb) {
      const frac = (ra - target) / (ra - rb);
      return a.elo + frac * (b.elo - a.elo);
    }
  }
  if (rate(asc[asc.length - 1]!) >= target) return asc[asc.length - 1]!.elo; // still >= target at the hardest level
  return null; // never reached the target at any measured level
}

function snapElo(elo: number | null, fallback: number): number {
  if (elo == null) return fallback;
  let best = SUPPORTED_ELOS[0] as number;
  let dist = Infinity;
  for (const e of SUPPORTED_ELOS) {
    const d = Math.abs(e - elo);
    if (d < dist) {
      dist = d;
      best = e as number;
    }
  }
  return best;
}

const calibrationCache = new Map<string, DirectiveCalibration>();

export function calibrationFor(directiveId: string): DirectiveCalibration {
  const cached = calibrationCache.get(directiveId);
  if (cached) return cached;
  const cells = cellsFor(directiveId);
  const points: CalibrationPoint[] = SUPPORTED_ELOS.map((elo) => {
    const c = cells[elo]!;
    return {
      elo: elo as number,
      n: c.n,
      orderedFull: c.n > 0 ? c.orderedFull / c.n : 0,
      terminalMet: c.n > 0 ? c.terminalMet / c.n : 0,
      wins: c.n > 0 ? c.wins / c.n : 0,
      losses: c.n > 0 ? c.losses / c.n : 0,
    };
  });
  const maxOrdered = Math.max(...points.map((p) => p.orderedFull), 0);
  const maxTerminal = Math.max(...points.map((p) => p.terminalMet), 0);
  let metric: 'ordered_full' | 'terminal_met' = 'ordered_full';
  let note = '';
  if (maxOrdered >= CALIBRATION_TARGET) {
    metric = 'ordered_full';
  } else if (maxTerminal >= CALIBRATION_TARGET) {
    metric = 'terminal_met';
    note = `ordered-full never reaches ${(CALIBRATION_TARGET * 100).toFixed(0)}% (max ${(maxOrdered * 100).toFixed(0)}%); calibrated on the terminal-met rate instead`;
  } else {
    metric = 'ordered_full';
    note = `neither ordered-full (max ${(maxOrdered * 100).toFixed(0)}%) nor terminal-met (max ${(maxTerminal * 100).toFixed(0)}%) reaches ${(CALIBRATION_TARGET * 100).toFixed(0)}% in the sweep — suggesting the easiest measured level`;
  }
  const crossing = interpolateCrossing(points, metric, CALIBRATION_TARGET);
  const fallback = points.find((p) => p.n > 0)?.elo ?? SUPPORTED_ELOS[0] as number;
  const suggested = snapElo(crossing, fallback);
  if (!note) {
    note =
      crossing == null
        ? `metric still >= ${(CALIBRATION_TARGET * 100).toFixed(0)}% at the hardest measured level`
        : `metric crosses ${(CALIBRATION_TARGET * 100).toFixed(0)}% near ELO ${Math.round(crossing)} (linear interpolation between measured points)`;
  }
  const gamesPerCell = SWEEPS.length > 0 ? Math.max(...SWEEPS.map((s) => s.gamesPerCell)) : 0;
  const cal: DirectiveCalibration = {
    directiveId,
    target: CALIBRATION_TARGET,
    metric,
    points,
    crossingElo: crossing,
    suggestedElo: suggested,
    note,
    gamesPerCell,
  };
  calibrationCache.set(directiveId, cal);
  return cal;
}

/** Expected completion rate (chosen metric) at an arbitrary ELO — tooltip curve. */
export function expectedCompletionRate(directiveId: string, elo: number): number | null {
  const cal = calibrationFor(directiveId);
  const pts = [...cal.points].sort((a, b) => a.elo - b.elo).filter((p) => p.n > 0);
  if (pts.length === 0) return null;
  const rate = (p: CalibrationPoint) => (cal.metric === 'ordered_full' ? p.orderedFull : p.terminalMet);
  if (elo <= pts[0]!.elo) return rate(pts[0]!);
  if (elo >= pts[pts.length - 1]!.elo) return rate(pts[pts.length - 1]!);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (elo >= a.elo && elo <= b.elo) {
      const frac = (elo - a.elo) / (b.elo - a.elo);
      return rate(a) + frac * (rate(b) - rate(a));
    }
  }
  return null;
}

/**
 * Honest-panel verdicts: the frozen bars joined with the committed sweep
 * verdicts. D1/D6 verdicts come from the D1/D6 sweep file, the rest from the
 * other (both are the newest runs of their scope, per bench/summary).
 */
export interface PanelBar {
  directiveId: string;
  barId: string;
  description: string;
  metric: string;
  threshold: number;
  elos?: number[];
  milestoneIds?: string[];
  expectedFail: boolean;
  note?: string;
  verdict: {
    n: number;
    hits: number;
    rate: number;
    pass: boolean;
    detail: string;
    source: string;
  } | null;
}

export function honestPanelBars(specs: { id: string; bars: { id: string; description: string; metric: string; threshold: number; elos?: number[]; milestoneIds?: string[]; expectedFail?: boolean; note?: string }[] }[]): PanelBar[] {
  const out: PanelBar[] = [];
  for (const spec of specs) {
    for (const bar of spec.bars) {
      let verdict: PanelBar['verdict'] = null;
      for (const sweep of SWEEPS) {
        const v = sweep.verdicts.find((x) => x.id === spec.id && x.bar === bar.id);
        if (v) {
          verdict = { n: v.n, hits: v.hits, rate: v.rate, pass: v.pass, detail: v.detail, source: sweep.file };
          break;
        }
      }
      out.push({
        directiveId: spec.id,
        barId: bar.id,
        description: bar.description,
        metric: bar.metric,
        threshold: bar.threshold,
        elos: bar.elos,
        milestoneIds: bar.milestoneIds,
        expectedFail: bar.expectedFail ?? false,
        note: bar.note,
        verdict,
      });
    }
  }
  return out;
}
