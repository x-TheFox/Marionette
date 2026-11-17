/**
 * Marionette benchmark harness.
 *
 *   tsx apps/harness/src/main.ts --prepare      # compile + cache plans (LLM)
 *   tsx apps/harness/src/main.ts                # quick sweep (offline by default)
 *   tsx apps/harness/src/main.ts --sweep full   # 5 games per cell
 *
 * Quick sweep = 1 game / directive / ELO {800, 1200, 1600, 2000}.
 * By default the sweep runs OFFLINE: cached plans + deterministic replans +
 * heuristic judge — zero LLM calls, immune to provider quotas. Use --online to
 * allow live compiles (plans still cached).
 *
 * Success bars are pre-declared in spec.ts and FROZEN; the harness only
 * reports actual rates against them. D6 is a known failing regression and is
 * reported as FAIL (expected), never passed.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LlmChain, loadEnvFile, findRepoRoot } from '@marionette/llm';
import {
  runDirectiveGame,
  heuristicJudge,
  JUDGE_THRESHOLDS,
  compileDirectivePlan,
  type GameReport,
} from '@marionette/core';
import { DIRECTIVES, ELOS, directiveById, type Bar, type DirectiveSpec } from './spec.js';

interface Args {
  sweep: 'quick' | 'full';
  elos: number[];
  directives: string[]; // ids or 'all'
  prepare: boolean;
  online: boolean;
  concurrency: number;
  outRoot: string;
  tag: string;
  resume: boolean;
  seedBase: number;
  maxPlies: number;
  check: boolean;
}

const USAGE = `
Marionette benchmark harness.

Usage:
  tsx apps/harness/src/main.ts --prepare            compile + cache plans for all directives (LLM)
  tsx apps/harness/src/main.ts                      quick sweep: 1 game / directive / ELO (offline)
  tsx apps/harness/src/main.ts --sweep full         5 games per cell
  tsx apps/harness/src/main.ts --check              exit non-zero on unexpected bar verdicts

Options:
  --sweep <quick|full>   Games per cell: quick=1 (dev iteration), full=5 (regression gate). Default quick.
  --elos <a,b,c>         Opponent ELOs. Default 800,1200,1600,2000 (below 1320 is emulated, labeled).
  --directives <ids>     'all' or a subset like D1,D6. Default all.
  --prepare              Compile and cache plans via the LLM chain, then exit.
  --online               Allow live LLM compiles/replans (default: offline, quota-independent).
  --concurrency <n>      Parallel games, 1..4 (sandbox budget: <=2 recommended). Default 2.
  --out <dir>            Raw output root. Default bench/raw (gitignored).
  --tag <name>           Run directory name under the root (default: the sweep name). Re-runs overwrite the same tag.
  --resume               Skip games whose metrics.json already exists under the tag (load them for aggregation).
  --seed <n>             Seed base for deterministic per-game seeds. Default 42.
  --max-plies <n>        Hard ply cap per game. Default 300.
  --check                Exit 1 on any unexpected FAIL/PASS (expected-fail bars excluded) or crash.
`.trim();

function parseArgs(argv: string[]): Args {
  if (argv.some((a) => a === '--help' || a === '-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const named = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      named.set(key, next);
      i++;
    } else {
      named.set(key, true);
    }
  }
  const str = (k: string, d: string): string => {
    const v = named.get(k);
    return typeof v === 'string' ? v : d;
  };
  const num = (k: string, d: number): number => {
    const v = named.get(k);
    if (v == null || v === true) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${k} expects a number, got '${v}'`);
    return n;
  };
  return {
    sweep: str('sweep', 'quick') === 'full' ? 'full' : 'quick',
    elos: str('elos', [...ELOS].join(',')).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
    directives: str('directives', 'all') === 'all' ? DIRECTIVES.map((d) => d.id) : str('directives', 'all').split(',').map((s) => s.trim().toUpperCase()),
    prepare: named.has('prepare'),
    online: named.has('online'),
    concurrency: Math.max(1, Math.min(4, num('concurrency', 2))),
    outRoot: str('out', 'bench/raw'),
    tag: str('tag', str('sweep', 'quick') === 'full' ? 'full' : 'quick'),
    resume: named.has('resume'),
    seedBase: num('seed', 42),
    maxPlies: num('max-plies', 300),
    check: named.has('check'),
  };
}

/** FNV-1a — deterministic per-game seeds. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface GameOutcome {
  spec: DirectiveSpec;
  elo: number;
  gameIdx: number;
  report: GameReport | null;
  judge: ReturnType<typeof heuristicJudge> | null;
  error?: string;
  dir: string;
}

function barScopeGames(bar: Bar, games: GameOutcome[]): GameOutcome[] {
  return games.filter((g) => g.report != null && (bar.elos == null || bar.elos.includes(g.elo)));
}

function gameFullCompletion(r: GameReport): boolean {
  return r.milestones.length > 0 && r.milestones.every((m) => m.completed) && r.terminalMet;
}

function gamePartialMilestones(r: GameReport, subs: string[]): boolean {
  return subs.every((sub) => r.milestones.some((m) => m.id.includes(sub) && m.completed));
}

function gameWon(r: GameReport): boolean {
  return (r.selfColor === 'w' && r.result === '1-0') || (r.selfColor === 'b' && r.result === '0-1');
}

function gameLost(r: GameReport): boolean {
  return (r.selfColor === 'w' && r.result === '0-1') || (r.selfColor === 'b' && r.result === '1-0');
}

interface BarVerdict {
  bar: Bar;
  spec: DirectiveSpec;
  n: number;
  hits: number;
  rate: number; // or mean for acpl_mean_max
  pass: boolean;
  detail: string;
}

function evaluateBar(bar: Bar, spec: DirectiveSpec, games: GameOutcome[]): BarVerdict {
  const scoped = barScopeGames(bar, games).filter((g) => g.report != null);
  const n = scoped.length;
  let hits = 0;
  let rate = 0;
  let detail = '';
  switch (bar.metric) {
    case 'full_completion':
      hits = scoped.filter((g) => gameFullCompletion(g.report!)).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games fully completed`;
      break;
    case 'partial_milestones':
      hits = scoped.filter((g) => gamePartialMilestones(g.report!, bar.milestoneIds ?? [])).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games with milestones matching [${(bar.milestoneIds ?? []).join(', ')}] completed`;
      break;
    case 'win_rate':
      hits = scoped.filter((g) => gameWon(g.report!)).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} wins`;
      break;
    case 'loss_rate':
      hits = scoped.filter((g) => gameLost(g.report!)).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} losses (opponent wins)`;
      break;
    case 'judge_looks_trying':
      hits = scoped.filter((g) => g.judge!.looksTrying >= JUDGE_THRESHOLDS.looksTrying).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games judged trying (axis >= ${JUDGE_THRESHOLDS.looksTrying})`;
      break;
    case 'judge_natural':
      hits = scoped.filter((g) => g.judge!.natural >= JUDGE_THRESHOLDS.natural).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games judged natural (axis >= ${JUDGE_THRESHOLDS.natural})`;
      break;
    case 'judge_plausible_loss':
      hits = scoped.filter((g) => g.judge!.plausibleLoss >= JUDGE_THRESHOLDS.plausibleLoss).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games judged plausible losses (axis >= ${JUDGE_THRESHOLDS.plausibleLoss})`;
      break;
    case 'judge_bully':
      hits = scoped.filter((g) => g.judge!.bully >= JUDGE_THRESHOLDS.bully).length;
      rate = n > 0 ? hits / n : 0;
      detail = `${hits}/${n} games judged bullying (axis >= ${JUDGE_THRESHOLDS.bully})`;
      break;
    case 'acpl_mean_max': {
      const acpls = scoped.map((g) => g.report!.acplSelf ?? 0);
      rate = acpls.length > 0 ? acpls.reduce((a, b) => a + b, 0) / acpls.length : 0;
      hits = rate <= bar.threshold ? n : 0;
      detail = `mean ACPL ${rate.toFixed(0)} over ${n} games`;
      break;
    }
  }
  const thresholdOk = bar.metric === 'acpl_mean_max' ? rate <= bar.threshold : rate >= bar.threshold;
  return { bar, spec, n, hits, rate, pass: n > 0 && thresholdOk, detail };
}

async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]!();
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  loadEnvFile(repoRoot);

  const enginePath = resolve(repoRoot, process.env.MARIONETTE_STOCKFISH_PATH ?? 'vendor/stockfish/stockfish');
  if (!existsSync(enginePath)) {
    console.error(`Stockfish not found at ${enginePath} — run ./scripts/bootstrap.sh`);
    process.exit(1);
  }

  const specs = args.directives.map((id) => directiveById(id)).filter((s): s is DirectiveSpec => s != null);
  if (specs.length === 0) {
    console.error(`no known directives in '${args.directives.join(',')}' (use ids D1..D6 or 'all')`);
    process.exit(1);
  }

  // --- prepare: compile + cache plans (the only LLM-touching mode) ---------
  if (args.prepare) {
    const chain = LlmChain.fromEnv();
    if (chain.providers.length === 0) {
      console.error('No LLM providers configured (see .env.example) — cannot prepare plans');
      process.exit(1);
    }
    for (const spec of specs) {
      const t0 = Date.now();
      try {
        const r = await compileDirectivePlan({
          directive: spec.directive,
          selfColor: 'w',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          llm: chain,
        });
        console.log(`\n=== ${spec.id} OK (${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.fromCache ? 'cached' : r.provider}) "${spec.directive}"`);
        console.log(`    ${r.compiled.plan.summary}`);
        console.log(`    style ${r.compiled.plan.style} | terminal ${JSON.stringify(r.compiled.plan.terminal)} | fallback ${r.compiled.plan.fallback.join(',')}`);
        for (const m of r.compiled.milestones) {
          console.log(`    m ${m.spec.id} [tol=${m.spec.tolerance} w=${m.spec.weight}${m.spec.moveBudget ? ` budget=${m.spec.moveBudget}` : ''}]: ${m.spec.completion}`);
          if (m.spec.infeasible) console.log(`      infeasible: ${m.spec.infeasible}`);
        }
        for (const c of r.compiled.constraints) {
          console.log(`    hc ${c.spec.id}: ${c.spec.predicate}${c.spec.afterMilestone ? ` (after ${c.spec.afterMilestone})` : ' (from first move)'}`);
        }
      } catch (e: unknown) {
        const att = (e as { attempts?: { provider: string; ok: boolean; error?: string; skipped?: string }[] }).attempts ?? [];
        console.log(`\n=== ${spec.id} FAIL "${spec.directive}"`);
        console.log(`    ${att.map((a) => `${a.provider}: ${a.ok ? 'ok' : (a.error ?? a.skipped ?? '').slice(0, 110)}`).join(' || ') || (e as Error).message}`);
      }
    }
    return;
  }

  // --- sweep ---------------------------------------------------------------
  const gamesPerCell = args.sweep === 'quick' ? 1 : 5;
  const offline = !args.online;
  const chain = args.online ? LlmChain.fromEnv() : null;
  if (args.online && chain!.providers.length === 0) {
    console.error('No LLM providers configured (see .env.example) — or drop --online to run offline');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outRoot = resolve(repoRoot, args.outRoot, args.tag);
  mkdirSync(outRoot, { recursive: true });

  const tasks: (() => Promise<GameOutcome>)[] = [];
  for (const spec of specs) {
    for (const elo of args.elos) {
      for (let g = 0; g < gamesPerCell; g++) {
        const gameIdx = g;
        const selfColor = gameIdx % 2 === 0 ? 'w' : 'b';
        const seed = (hash32(`${spec.id}:${elo}:${gameIdx}`) ^ args.seedBase) >>> 0;
        const dir = join(outRoot, spec.id, `elo${elo}`, `game-${String(gameIdx).padStart(3, '0')}`);
        tasks.push(async (): Promise<GameOutcome> => {
          const label = `${spec.id}/elo${elo}/g${gameIdx}`;
          const metricsPath = join(dir, 'metrics.json');
          if (args.resume && existsSync(metricsPath)) {
            try {
              const cached = JSON.parse(readFileSync(metricsPath, 'utf8')) as {
                report: GameReport;
                judge: ReturnType<typeof heuristicJudge>;
              };
              console.log(`[skip] ${label}: metrics.json exists (resume)`);
              return { spec, elo, gameIdx, report: cached.report, judge: cached.judge, dir };
            } catch {
              // Corrupt metrics: fall through and re-run.
            }
          }
          mkdirSync(dir, { recursive: true });
          const t0 = Date.now();
          try {
            const report = await runDirectiveGame({
              directive: spec.directive,
              selfColor,
              stockfishPath: enginePath,
              opponentElo: elo,
              steerDepth: 14,
              steerMultiPV: 5,
              maxPlies: args.maxPlies,
              maxReplans: 2,
              seed,
              llm: chain,
              replanMode: offline ? 'deterministic' : 'llm',
              planFromCacheOnly: offline,
              pgnPath: join(dir, 'game.pgn'),
              reportPath: join(dir, 'report.md'),
            });
            const judge = heuristicJudge(report);
            writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ report, judge }, null, 2));
            const res = `${report.result} (${report.endReason})`;
            const ms = `${report.milestones.filter((m) => m.completed).length}/${report.milestones.length} ms`;
            console.log(
              `[done] ${label}: ${res}, terminal ${report.terminalMet ? 'MET' : 'no'}, ${ms}, ACPL ${report.acplSelf?.toFixed(0) ?? '-'}, ${((Date.now() - t0) / 1000).toFixed(0)}s`,
            );
            return { spec, elo, gameIdx, report, judge, dir };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`[FAIL] ${label}: ${msg}`);
            return { spec, elo, gameIdx, report: null, judge: null, error: msg, dir };
          }
        });
      }
    }
  }

  console.log(
    `Marionette ${args.sweep} sweep: ${specs.length} directives x ${args.elos.length} ELOs x ${gamesPerCell} game(s) = ${tasks.length} games; ` +
      `${offline ? 'OFFLINE (cached plans, deterministic replans, heuristic judge)' : 'online'}, concurrency ${args.concurrency}, seed base ${args.seedBase}`,
  );
  console.log(`Raw output: ${outRoot}`);
  const t0 = Date.now();
  const outcomes = await pool(tasks, args.concurrency);
  console.log(`\nsweep finished in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);

  // --- aggregate + regression table ---------------------------------------
  const lines: string[] = [];
  lines.push(`# Marionette ${args.sweep} sweep — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(
    `- ${specs.length} directives x ${args.elos.join('/')} Elo x ${gamesPerCell} game(s); Marionette steering depth 14, MultiPV 5; opponent = Stockfish 19 (below 1320 emulated).`,
  );
  lines.push(
    `- Mode: ${offline ? 'offline — cached plans, deterministic replans, heuristic judge v1 (no LLM calls)' : 'online (LLM compiles/replans)'}.`,
  );
  lines.push(`- Seeds deterministic (base ${args.seedBase}); Marionette plays ${gamesPerCell === 1 ? 'White' : 'alternating colors'}.`);
  lines.push('- Success bars are pre-declared and frozen (docs/PLAN.md); the table reports actual rates.');
  lines.push('');
  lines.push('## Per-game results');
  lines.push('');
  lines.push('| Dir | Elo | Result | Terminal | Milestones | ACPL | Trying | Natural | PlausLoss | Bully | Replans |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const o of outcomes) {
    if (!o.report || !o.judge) {
      lines.push(`| ${o.spec.id} | ${o.elo} | FAILED: ${(o.error ?? '').slice(0, 60)} | - | - | - | - | - | - | - | - |`);
      continue;
    }
    const r = o.report;
    const j = o.judge;
    const ms = `${r.milestones.filter((m) => m.completed).length}/${r.milestones.length}`;
    lines.push(
      `| ${o.spec.id} | ${o.elo}${r.opponentEmulated ? ' (emu)' : ''} | ${r.result} (${r.endReason}) | ${r.terminalMet ? 'MET' : 'no'} | ${ms} | ${r.acplSelf?.toFixed(0) ?? '-'} | ${j.looksTrying.toFixed(2)} | ${j.natural.toFixed(2)} | ${j.plausibleLoss.toFixed(2)} | ${j.bully.toFixed(2)} | ${r.replans.length} |`,
    );
  }
  lines.push('');
  lines.push('## Pre-declared bars (frozen) — actual rates');
  lines.push('');
  lines.push('| Dir | Bar | Scope | Actual | Required | Verdict |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  const verdicts: BarVerdict[] = [];
  for (const spec of specs) {
    const specGames = outcomes.filter((o) => o.spec.id === spec.id);
    for (const bar of spec.bars) {
      const v = evaluateBar(bar, spec, specGames);
      verdicts.push(v);
      const verdictStr = v.bar.expectedFail
        ? v.pass
          ? 'UNEXPECTED PASS'
          : 'FAIL (expected)'
        : v.pass
          ? 'PASS'
          : 'FAIL';
      const scope = bar.elos == null ? `all ELOs (${v.n} games)` : `${bar.elos.join('/')} (${v.n} games)`;
      const actual = bar.metric === 'acpl_mean_max' ? v.rate.toFixed(0) : `${(v.rate * 100).toFixed(0)}%`;
      const req = bar.metric === 'acpl_mean_max' ? `<= ${bar.threshold}` : `>= ${Math.round(bar.threshold * 100)}%`;
      lines.push(`| ${spec.id} | ${bar.id}: ${bar.description} | ${scope} | ${actual} | ${req} | ${verdictStr} |`);
    }
  }
  const crashed = outcomes.filter((o) => o.report == null).length;
  if (crashed > 0) {
    lines.push('');
    lines.push(`> WARNING: ${crashed} game(s) crashed — rates above exclude them.`);
  }
  const knownFailing = verdicts.filter((v) => v.bar.expectedFail && !v.pass);
  if (knownFailing.length > 0) {
    lines.push('');
    lines.push('**Known failing regressions (kept visible, not marked passed):**');
    for (const v of knownFailing) {
      lines.push(`- ${v.spec.id} ${v.bar.id}: ${v.detail} vs required ${(v.bar.metric === 'acpl_mean_max' ? v.bar.threshold : `${Math.round(v.bar.threshold * 100)}%`)} — ${v.bar.note ?? ''}`);
    }
  }
  lines.push('');
  lines.push('## Judge v1 thresholds (heuristic, declared)');
  lines.push('');
  lines.push(`looksTrying >= ${JUDGE_THRESHOLDS.looksTrying}, natural >= ${JUDGE_THRESHOLDS.natural}, plausibleLoss >= ${JUDGE_THRESHOLDS.plausibleLoss}, bully >= ${JUDGE_THRESHOLDS.bully}, blunder = eval drop >= ${JUDGE_THRESHOLDS.blunderCp}cp, ACPL band for "trying" <= ${JUDGE_THRESHOLDS.acplTryingMax}.`);
  lines.push('');

  const summaryDir = resolve(repoRoot, 'bench', 'summary');
  mkdirSync(summaryDir, { recursive: true });
  const mdPath = join(summaryDir, `${stamp}-${args.sweep}.md`);
  writeFileSync(mdPath, lines.join('\n') + '\n');
  writeFileSync(
    mdPath.replace(/\.md$/, '.json'),
    JSON.stringify({ stamp, sweep: args.sweep, gamesPerCell, offline, elos: args.elos, outcomes: outcomes.map(({ spec, elo, gameIdx, report, judge, error }) => ({ id: spec.id, elo, gameIdx, error: error ?? null, report, judge })), verdicts: verdicts.map((v) => ({ id: v.spec.id, bar: v.bar.id, n: v.n, hits: v.hits, rate: v.rate, pass: v.pass, expectedFail: v.bar.expectedFail ?? false, detail: v.detail })) }, null, 2),
  );
  console.log(lines.join('\n'));
  console.log(`\nSummary: ${mdPath}`);

  if (args.check) {
    const unexpectedFail = verdicts.filter((v) => !v.pass && !v.bar.expectedFail);
    const unexpectedPass = verdicts.filter((v) => v.pass && v.bar.expectedFail);
    if (unexpectedFail.length > 0 || unexpectedPass.length > 0 || crashed > 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error('harness failed:', e instanceof Error ? e.message : e);
  process.exit(2);
});
