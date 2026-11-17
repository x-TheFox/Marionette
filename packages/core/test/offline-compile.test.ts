import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDirectivePlan, planCachePath, PlanCacheMissError } from '../src/compiler/compile.js';
import { PLAN_SCHEMA_VERSION } from '../src/plan/schema.js';

const VALID_PLAN = {
  summary: 'just win',
  style: 'none',
  terminal: { kind: 'win', priority: 'milestones_first' },
  hardConstraints: [],
  milestones: [
    { id: 'mate', description: 'checkmate', completion: 'is_checkmate() && winner() == self', tolerance: 'tight', weight: 5 },
  ],
  fallback: ['play_best'],
};

function cacheKey(directive: string): string {
  return createHash('sha256').update(`${directive}\u0000${PLAN_SCHEMA_VERSION}`).digest('hex').slice(0, 32);
}

describe('offline (cache-only) compile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marionette-cache-'));
  const directive = 'Offline replay test directive.';

  it('returns the cached plan without any LLM chain', async () => {
    writeFileSync(
      planCachePath(directive, dir),
      JSON.stringify({ directive, schemaVersion: PLAN_SCHEMA_VERSION, provider: 'kilo', model: 'test', plan: VALID_PLAN }),
    );
    const r = await compileDirectivePlan({
      directive,
      selfColor: 'w',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      llm: null,
      cacheDir: dir,
      fromCacheOnly: true,
    });
    expect(r.fromCache).toBe(true);
    expect(r.compiled.plan.milestones[0]!.id).toBe('mate');
    expect(r.provider).toBe('kilo');
  });

  it('throws PlanCacheMissError on a miss (never falls back to an LLM call)', async () => {
    await expect(
      compileDirectivePlan({
        directive: 'never cached directive',
        selfColor: 'w',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        llm: null,
        cacheDir: dir,
        fromCacheOnly: true,
      }),
    ).rejects.toBeInstanceOf(PlanCacheMissError);
  });

  it('old hash-only filenames (pre slug-key scheme) are not found', async () => {
    // Cache files from before the slug+short-key naming are naturally orphaned.
    const oldKey = cacheKey('v1 directive');
    writeFileSync(
      join(dir, `${oldKey}.json`),
      JSON.stringify({ directive: 'v1 directive', model: 'some-model', plan: VALID_PLAN }),
    );
    await expect(
      compileDirectivePlan({
        directive: 'v1 directive',
        selfColor: 'w',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        llm: null,
        cacheDir: dir,
        fromCacheOnly: true,
      }),
    ).rejects.toBeInstanceOf(PlanCacheMissError);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
