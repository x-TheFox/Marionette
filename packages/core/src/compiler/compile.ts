import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmChain } from '@marionette/llm';
import { extractJson, findRepoRoot } from '@marionette/llm';
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

export class PlanCacheMissError extends Error {
  constructor(
    message: string,
    public readonly directive: string,
    public readonly cachePath: string,
  ) {
    super(message);
    this.name = 'PlanCacheMissError';
  }
}

export interface CompileOptions {
  directive: string;
  selfColor: 'w' | 'b';
  /** FEN of the position the plan is compiled against (start position for initial compiles). */
  fen: string;
  /** LLM chain used for live compiles; may be null when fromCacheOnly is set. */
  llm?: LlmChain | null;
  /** Cache directory; defaults to <repoRoot>/plans/v<schema> (COMMITTED to git so
   *  sandbox resets do not force recompiles); override with MARIONETTE_PLAN_CACHE. */
  cacheDir?: string;
  /** Skip the cache (both read and write). */
  noCache?: boolean;
  /** Offline mode: never call an LLM; throw PlanCacheMissError on a cache miss. */
  fromCacheOnly?: boolean;
  /** Progress context for replans; omit for initial compiles. */
  progress?: ProgressReport;
  replanReason?: string;
  maxTokens?: number;
}

/** Deterministic cache file path for a directive (slug + short key hash). */
export function planCachePath(directive: string, cacheDir: string): string {
  const key = createHash('sha256')
    .update(`${directive}\u0000${PLAN_SCHEMA_VERSION}`)
    .digest('hex')
    .slice(0, 32);
  const slug =
    directive
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'directive';
  return join(cacheDir, `${slug}-${key.slice(0, 8)}.json`);
}

/**
 * Compile (or fetch from cache) a validated plan for a directive.
 * Failover, retries and JSON-extraction are handled by the LlmChain; on
 * success the plan is Zod- and predicate-validated before being returned.
 */
export async function compileDirectivePlan(opts: CompileOptions): Promise<CompileResult> {
  const cacheDir =
    opts.cacheDir ??
    process.env.MARIONETTE_PLAN_CACHE ??
    join(findRepoRoot(process.cwd()), 'plans', `v${PLAN_SCHEMA_VERSION}`);
  const model = opts.llm?.providers[0]?.model ?? 'offline';
  // Plans are color-agnostic (predicates use self/opp), so the cache key
  // excludes color. Keyed by (directive, schema version) — one cached plan
  // per directive; the compiling model is recorded for provenance only.
  // Replans are position-dependent -> never cached.
  // The plan store is COMMITTED to git: compiled plans are deterministic
  // inputs to offline sweeps, and a fresh clone must not need LLM quota.
  const isReplan = opts.progress != null;
  const cachePath = planCachePath(opts.directive, cacheDir);

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

  if (opts.fromCacheOnly) {
    throw new PlanCacheMissError(
      `no cached plan for directive "${opts.directive}" (schema v${PLAN_SCHEMA_VERSION}); ` +
        `run the harness with --prepare (or one online game) to populate the cache`,
      opts.directive,
      cachePath,
    );
  }

  if (!opts.llm) {
    throw new Error('compileDirectivePlan: live compile requested but no LLM chain provided');
  }
  const llm = opts.llm;

  const user = isReplan
    ? replanUserMessage(opts.directive, opts.selfColor, opts.progress!, opts.replanReason ?? 'plan infeasible')
    : initialCompileUserMessage(opts.directive, opts.selfColor, opts.fen);

  let compiledPlan: CompiledPlan | null = null;
  const result = await llm.chat({
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
          schemaVersion: PLAN_SCHEMA_VERSION,
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
