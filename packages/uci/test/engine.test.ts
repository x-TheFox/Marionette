import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UciEngine } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const enginePath = join(repoRoot, 'vendor', 'stockfish', 'stockfish');
const engineAvailable = existsSync(enginePath);

const engines: UciEngine[] = [];
afterAll(async () => {
  await Promise.all(engines.map((e) => e.quit().catch(() => undefined)));
});

async function spawnEngine(): Promise<UciEngine> {
  if (!engineAvailable) throw new Error(`engine not found at ${enginePath} — run scripts/bootstrap.sh`);
  const e = await UciEngine.spawn(enginePath);
  engines.push(e);
  return e;
}

describe.skipIf(!engineAvailable)('UciEngine (live, vendored Stockfish)', () => {
  it('handshakes and analyses the start position with MultiPV', async () => {
    const e = await spawnEngine();
    await e.newGame();
    const a = await e.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
      depth: 10,
      multiPV: 3,
    });
    expect(a.lines.length).toBe(3);
    expect(a.lines[0]!.multipv).toBe(1);
    expect(a.bestMove).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(a.lines[0]!.cpSTM).not.toBeNull();
  });

  it('reports mate scores', async () => {
    const e = await spawnEngine();
    await e.newGame();
    // White rook mates in one with Rh8+ (black king a8, white king b6)
    const a = await e.analyse('k7/8/1K6/8/8/8/8/7R w - - 0 1', { depth: 8, multiPV: 1 });
    expect(a.lines[0]!.mateSTM).toBe(1);
    expect(a.bestMove).toBe('h1h8');
  });

  it('applies strength options and still returns a move', async () => {
    const e = await spawnEngine();
    await e.newGame();
    await e.setOption('UCI_LimitStrength', true);
    await e.setOption('UCI_Elo', 1400);
    const mv = await e.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
      depth: 8,
    });
    expect(mv).toMatch(/^[a-h][1-8][a-h][1-8]/);
  });

  it('serializes concurrent analyse calls without corruption', async () => {
    const e = await spawnEngine();
    await e.newGame();
    const fens = [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    ];
    const results = await Promise.all(fens.map((f) => e.analyse(f, { depth: 8, multiPV: 2 })));
    for (const r of results) {
      expect(r.lines.length).toBeGreaterThanOrEqual(1);
      expect(r.lines[0]!.move).toMatch(/^[a-h][1-8]/);
    }
  });
});
