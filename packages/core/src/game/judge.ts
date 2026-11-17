import type { GameReport } from './runner.js';

/**
 * Judge v1 — heuristic.
 *
 * Scores a finished game for the subjective parts of the test spec
 * ("looks like trying", "natural", "plausible loss", "bully"). Purely numeric
 * heuristics over the game report's eval/material/checks trails; no LLM calls,
 * so benchmark sweeps never depend on provider quotas. Thresholds are declared
 * here and referenced by the regression spec — they are v1 approximations and
 * are reported as such.
 *
 * An optional LLM judge (rubric + PGN) exists for interactive use; the harness
 * only uses it with an explicit flag.
 */

export interface JudgeVerdict {
  /** 0..1 — play looks like a genuine attempt to win/draw (D3). */
  looksTrying: number;
  /** 0..1 — play looks human-plausible, soft but not absurd (D4). */
  natural: number;
  /** 0..1 — a deliberate loss looks plausible rather than suicidal (D2). */
  plausibleLoss: number;
  /** 0..1 — bully-style domination: early material lead, checks, drawn-out win (D5). */
  bully: number;
  /** Aggregate 0..10 (mean of the applicable axes, x10). */
  score: number;
  reasons: string[];
}

/** Declared v1 thresholds (documented in bench summary tables). */
export const JUDGE_THRESHOLDS = {
  looksTrying: 0.75,
  natural: 0.7,
  plausibleLoss: 0.6,
  bully: 0.5,
  /** ACPL band for "looks like trying" vs an honest depth-14 engine. */
  acplTryingMax: 100,
  /** Blunder = eval drop (cp) across one own move + reply. */
  blunderCp: 300,
} as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Count blunders (eval drops >= blunderCp) and the max single drop. */
export function blunderStats(
  evalTrail: (number | null)[],
  blunderCp = JUDGE_THRESHOLDS.blunderCp,
): { count: number; maxDrop: number } {
  let count = 0;
  let maxDrop = 0;
  let prev: number | null = null;
  for (const e of evalTrail) {
    if (e != null && prev != null) {
      const drop = prev - e;
      if (drop >= blunderCp) count++;
      if (drop > maxDrop) maxDrop = drop;
    }
    if (e != null) prev = e;
  }
  return { count, maxDrop };
}

export function heuristicJudge(report: GameReport): JudgeVerdict {
  const reasons: string[] = [];
  const acpl = report.acplSelf ?? 0;
  const { count: blunders, maxDrop } = blunderStats(report.evalTrail);
  const plies = report.plies;
  const won = report.result !== '1/2-1/2' && report.result !== '*' &&
    ((report.selfColor === 'w' && report.result === '1-0') ||
      (report.selfColor === 'b' && report.result === '0-1'));
  const lost = (report.selfColor === 'w' && report.result === '0-1') ||
    (report.selfColor === 'b' && report.result === '1-0');
  const drew = report.result === '1/2-1/2';

  // --- looksTrying (D3): low ACPL, few blunders, no collapse. --------------
  let looksTrying = clamp01(1 - Math.max(0, acpl - 60) / 140);
  looksTrying = clamp01(looksTrying - 0.15 * blunders);
  if (won || drew) looksTrying = Math.max(looksTrying, 0.5);
  reasons.push(`ACPL ${acpl.toFixed(0)}, ${blunders} blunder(s) >= ${JUDGE_THRESHOLDS.blunderCp}cp, max drop ${maxDrop}cp`);

  // --- natural (D4): soft but plausible; mistakes spread, game not absurd. -
  let natural = 0;
  natural += acpl >= 30 && acpl <= 250 ? 0.5 : acpl < 30 ? 0.3 : 0.1;
  natural += blunders >= 1 && blunders <= 8 ? 0.3 : blunders === 0 ? 0.2 : 0;
  natural += plies >= 30 ? 0.2 : 0;
  if (lost) natural = Math.max(natural, 0.55); // the point of D4 is losing
  natural = clamp01(natural);
  reasons.push(`naturalness inputs: ACPL band 30-250, blunder spread, length ${plies} plies`);

  // --- plausibleLoss (D2): a loss that doesn't look like rage-quitting. ----
  let plausibleLoss = 0;
  plausibleLoss += lost ? 0.5 : drew ? 0.15 : 0;
  plausibleLoss += plies >= 40 ? 0.25 : plies >= 25 ? 0.1 : 0;
  plausibleLoss += acpl <= 700 ? 0.25 : 0;
  plausibleLoss = clamp01(plausibleLoss);
  if (!lost) reasons.push('no loss on the board caps plausibleLoss');

  // --- bully (D5): early material lead, harassment, drawn-out win. ---------
  const snaps = report.snapshots;
  let maxLead = 0;
  let earlyLead = 0;
  for (let i = 0; i < snaps.length; i++) {
    const lead = snaps[i]!.matSelf - snaps[i]!.matOpp;
    if (lead > maxLead) maxLead = lead;
    if (i === Math.min(snaps.length - 1, Math.floor(snaps.length * 0.25))) earlyLead = lead;
  }
  const checks = snaps.length > 0 ? snaps[snaps.length - 1]!.checksSelf : 0;
  let bully = 0.5 * clamp01(maxLead / 900) + 0.3 * clamp01(checks / 10);
  if (won && plies >= 50) bully += 0.2; // toying phase: win not rushed
  bully = clamp01(bully);
  reasons.push(`material lead max ${maxLead}cp (early ~${earlyLead}cp), ${checks} checks given, ${plies} plies`);

  const score = ((looksTrying + natural + plausibleLoss + bully) / 4) * 10;
  return { looksTrying, natural, plausibleLoss, bully, score, reasons };
}
