import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmChain } from '@marionette/llm';
import { extractJson } from '@marionette/llm';
import { compilePlan, PLAN_SCHEMA_VERSION, type CompiledPlan } from '../plan/schema.js';
import {
  GOAL_COMPILER_SYSTEM,
  initialCompileUserMessage,
  replanUserMessage,
  type ProgressReport,
} from './prompt.js';

export interface CompileResult {
  compiled: CompiledPlan;
  fromCache: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  attempts: { provider: string; model: string; ok: boolean; error?: string; ms?: number }[];
}

export interface CompileOptions {
  directive: string;
  selfColor: 'w' | 'b';
  /** FEN of the position the plan is compiled against (start position for initial compiles). */
  fen: string;
  llm: LlmChain;
  /** Cache directory; defaults to <cwd>/.cache/plans. */
  cacheDir?: string;
  /** Skip the cache (both read and write). */
  noCache?: boolean;
  /** Progress context for replans; omit for initial compiles. */
  progress?: ProgressReport;
  replanReason?: string;
  maxTokens?: number;
}

/**
 * Compile (or fetch from cache) a validated plan for a directive.
 * Failover, retries and JSON-extraction are handled by the LlmChain; on
 * success the plan is Zod- and predicate-validated before being returned.
 */
export async function compileDirectivePlan(opts: CompileOptions): Promise<CompileResult> {
  const cacheDir = opts.cacheDir ?? join(process.cwd(), '.cache', 'plans');
  const model = opts.llm.providers[0]?.model ?? 'unknown';
  // Plans are color-agnostic (predicates use self/opp), so the cache key
  // excludes color. Replans are position-dependent -> never cached.
  const isReplan = opts.progress != null;
  const key = createHash('sha256')
    .update(`${opts.directive}\u0000${model}\u0000${PLAN_SCHEMA_VERSION}`)
    .digest('hex')
    .slice(0, 32);
  const cachePath = join(cacheDir, `${key}.json`);

  if (!opts.noCache && !isReplan && existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf8'));
      const compiled = compilePlan(raw.plan);
      return {
        compiled,
        fromCache: true,
        provider: raw.provider ?? 'cache',
        model: raw.model ?? model,
        latencyMs: 0,
        attempts: [],
      };
    } catch {
      // Corrupt cache entry: fall through to a fresh compile.
    }
  }

  const user = isReplan
    ? replanUserMessage(opts.directive, opts.selfColor, opts.progress!, opts.replanReason ?? 'plan infeasible')
    : initialCompileUserMessage(opts.directive, opts.selfColor, opts.fen);

  let compiledPlan: CompiledPlan | null = null;
  const result = await opts.llm.chat({
    system: GOAL_COMPILER_SYSTEM,
    user,
    maxTokens: opts.maxTokens ?? 16_384,
    temperature: 0.2,
    validate: (raw) => {
      try {
        const json = extractJson(raw);
        const obj = JSON.parse(json);
        const inner = obj?.plan ?? obj;
        (compiledPlan as CompiledPlan | null) = compilePlan(inner) as CompiledPlan;
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });

  const finalPlan = compiledPlan as CompiledPlan | null;
  if (!finalPlan) throw new Error('provider returned success but no plan was compiled');

  if (!opts.noCache && !isReplan) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify(
        {
          directive: opts.directive,
          model: result.model,
          provider: result.provider,
          compiledAt: new Date().toISOString(),
          plan: finalPlan.plan,
        },
        null,
        2,
      ),
    );
  }

  return {
    compiled: finalPlan,
    fromCache: false,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
  };
}
