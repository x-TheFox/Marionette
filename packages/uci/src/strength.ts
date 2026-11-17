import { UciEngine } from './engine.js';
import type { Analysis } from './engine.js';

/**
 * Engine strength control.
 *
 * Stockfish's `UCI_Elo` option only goes down to 1320. Below that floor we
 * emulate weaker opponents with a combination of:
 *   1. `Skill Level` — Stockfish's built-in noise injection,
 *   2. a reduced search depth cap,
 *   3. eval-weighted randomization across MultiPV lines (softmax).
 * Emulated levels are always labeled as such in reports — never passed off as
 * real `UCI_Elo` results.
 */

/** Minimum Elo the engine's native UCI_Elo option accepts. */
export const UCI_ELO_MIN = 1320;
export const UCI_ELO_MAX = 3190;

export interface StrengthConfig {
  /** Target opponent Elo (800..3190). Values ≥ 1320 use native UCI_Elo. */
  elo: number;
  /** Max search depth for the emulated opponent; ignored at native Elo. */
  emulatedDepth?: number;
}

export interface StrengthSetup {
  /** true when the target Elo is below the native floor and is emulated. */
  emulated: boolean;
  skillLevel?: number;
  /** Depth cap callers should pass to `analyse` for this opponent. */
  depthCap: number;
}

/** Map an Elo below the floor to a Skill Level (0..10). Documented approximation. */
export function skillForElo(elo: number): number {
  const clamped = Math.max(800, Math.min(UCI_ELO_MIN, elo));
  return Math.max(0, Math.min(10, Math.round((clamped - 800) / 52)));
}

/** Depth cap for an emulated opponent: weaker targets search shallower. */
export function emulatedDepthFor(elo: number): number {
  if (elo < 900) return 6;
  if (elo < 1100) return 8;
  return 10;
}

/**
 * Configure an engine to play at the requested strength. Call once after
 * `spawn`, before the first `newGame`. Re-callable between games.
 */
export async function configureStrength(eng: UciEngine, cfg: StrengthConfig): Promise<StrengthSetup> {
  const elo = Math.max(800, Math.min(UCI_ELO_MAX, Math.round(cfg.elo)));
  if (elo >= UCI_ELO_MIN) {
    await eng.setOption('UCI_LimitStrength', true);
    await eng.setOption('UCI_Elo', elo);
    return { emulated: false, depthCap: 30 };
  }
  const skill = skillForElo(elo);
  await eng.setOption('UCI_LimitStrength', false);
  await eng.setOption('Skill Level', skill);
  const depthCap = cfg.emulatedDepth ?? emulatedDepthFor(elo);
  return { emulated: true, skillLevel: skill, depthCap };
}

/** Small deterministic PRNG (mulberry32) — reproducible emulated play. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Side-to-move-centric cp for an analysis line (mate scores → large cp). */
export function lineCpSTM(mateSTM: number | null, cpSTM: number | null): number {
  if (mateSTM != null) {
    return mateSTM > 0 ? 10_000 - mateSTM * 50 : -(10_000 - Math.abs(mateSTM) * 50);
  }
  return cpSTM ?? 0;
}

/**
 * Pick a move for an emulated (sub-floor) opponent: softmax over the MultiPV
 * lines' scores. Higher temperature (weaker Elo) ⇒ flatter distribution.
 * `rng` defaults to `Math.random`; pass a seeded PRNG for reproducibility.
 */
export function pickEmulatedMove(analysis: Analysis, elo: number, rng: () => number = Math.random): string {
  if (analysis.lines.length === 0) return analysis.bestMove;
  if (analysis.lines.length === 1) return analysis.lines[0]!.move;
  // Temperature in cp: 1350 → ~25 (near-best play), 800 → ~160 (noisy).
  const t = Math.max(20, Math.min(180, (1350 - Math.max(800, elo)) * 0.27 + 20));
  const scored = analysis.lines.map((l) => ({ move: l.move, cp: lineCpSTM(l.mateSTM, l.cpSTM) }));
  const best = Math.max(...scored.map((s) => s.cp));
  const weights = scored.map((s) => Math.exp(-(best - s.cp) / t));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return scored[i]!.move;
  }
  return scored[scored.length - 1]!.move;
}
