/**
 * Marionette CLI — run a directive game headlessly.
 *
 *   tsx apps/cli/src/main.ts "<directive>" [options]
 *
 * Compiles the directive into a plan (cached by directive hash), steers
 * Stockfish through the game against an Elo-capped opponent, and writes an
 * honest milestone report + PGN under games/.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LlmChain, loadEnvFile, findRepoRoot } from '@marionette/llm';
import { runDirectiveGame, renderReport, type GameEvent, type GameReport } from '@marionette/core';

interface CliArgs {
  directive: string;
  elo: number;
  color: 'w' | 'b';
  steerDepth: number;
  steerMultiPV: number;
  oppDepth?: number;
  maxPlies: number;
  maxReplans: number;
  seed?: number;
  noCache: boolean;
  outDir: string;
  quiet: boolean;
}

function usage(): string {
  return `
Usage: tsx apps/cli/src/main.ts "<directive>" [options]

Options:
  --elo <n>          Opponent Elo (800..3190; below 1320 is emulated). Default 1350.
  --color <w|b>      Marionette's color. Default w.
  --steer-depth <n>  Steering search depth. Default 14.
  --multipv <n>      Steering MultiPV width (<=5). Default 5.
  --opp-depth <n>    Opponent depth cap. Default 16 (native) / auto (emulated).
  --max-plies <n>    Hard ply cap. Default 300.
  --max-replans <n>  LLM replans per game. Default 2.
  --seed <n>         Deterministic seed (emulated opponents / fallbacks).
  --no-cache         Bypass the plan cache.
  --out <dir>        Output dir for PGN + report. Default <repo>/games.
  --quiet            Suppress per-move events.
`.trim();
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const named = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        named.set(key, next);
        i++;
      } else {
        named.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0 || named.has('help')) {
    console.error(usage());
    process.exit(2);
  }
  const num = (k: string, d: number): number => {
    const v = named.get(k);
    if (v == null || v === true) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${k} expects a number, got '${v}'`);
    return n;
  };
  const color = named.get('color');
  if (color != null && color !== 'w' && color !== 'b') throw new Error(`--color must be w or b, got '${color}'`);
  return {
    directive: positional.join(' '),
    elo: num('elo', 1350),
    color: (color as 'w' | 'b') ?? 'w',
    steerDepth: num('steer-depth', 14),
    steerMultiPV: num('multipv', 5),
    oppDepth: named.has('opp-depth') ? num('opp-depth', 16) : undefined,
    maxPlies: num('max-plies', 300),
    maxReplans: num('max-replans', 2),
    seed: named.has('seed') ? num('seed', 0) : undefined,
    noCache: named.has('no-cache'),
    outDir: typeof named.get('out') === 'string' ? (named.get('out') as string) : 'games',
    quiet: named.has('quiet') || named.has('q'),
  };
}

function shortEvent(e: GameEvent): string {
  switch (e.kind) {
    case 'move':
      return `  ply ${String(e.ply).padStart(3)} ${e.side === 'w' ? 'W' : 'B'} ${e.san.padEnd(7)} [${e.source}${e.lambda != null ? `, λ=${e.lambda.toFixed(2)}` : ''}]`;
    case 'milestone':
      return `>> milestone ${e.id} completed at ply ${e.atPly}: ${e.description}`;
    case 'violation':
      return `!! constraint ${e.id} VIOLATED at ply ${e.atPly}: ${e.description}`;
    case 'infeasible':
      return `>> milestone ${e.id} infeasible at ply ${e.atPly}: ${e.reason}`;
    case 'replan':
      return `>> replan at ply ${e.atPly}: ${e.reason} (via ${e.provider})`;
    case 'fallback':
      return `>> fallback engaged at ply ${e.atPly}: ${e.action}`;
    case 'info':
      return `-- ${e.message}`;
    case 'end':
      return `== game over: ${e.result} (${e.reason})`;
  }
}

function main(): void {
  const repoRoot = findRepoRoot(process.cwd());
  loadEnvFile(repoRoot);
  const args = parseArgs(process.argv.slice(2));

  const enginePath = resolve(repoRoot, process.env.MARIONETTE_STOCKFISH_PATH ?? 'vendor/stockfish/stockfish');
  if (!existsSync(enginePath)) {
    console.error(`Stockfish not found at ${enginePath} — run ./scripts/bootstrap.sh`);
    process.exit(1);
  }

  const chain = LlmChain.fromEnv();
  if (chain.providers.length === 0) {
    console.error('No LLM providers configured (see .env.example)');
    process.exit(1);
  }

  const outDir = resolve(repoRoot, args.outDir);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = args.directive.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'directive';
  const pgnPath = join(outDir, `${stamp}-${slug}.pgn`);
  const reportPath = join(outDir, `${stamp}-${slug}.report.md`);

  console.log(`Marionette vs Stockfish @ ${args.elo} Elo — "${args.directive}"`);
  console.log(`PGN: ${pgnPath}\nReport: ${reportPath}\n`);

  const events: GameEvent[] = [];
  const t0 = Date.now();
  runDirectiveGame({
    directive: args.directive,
    selfColor: args.color,
    stockfishPath: enginePath,
    opponentElo: args.elo,
    opponentDepth: args.oppDepth,
    steerDepth: args.steerDepth,
    steerMultiPV: args.steerMultiPV,
    maxPlies: args.maxPlies,
    maxReplans: args.maxReplans,
    seed: args.seed,
    noCache: args.noCache,
    llm: chain,
    pgnPath,
    reportPath,
    onEvent: (e) => {
      events.push(e);
      if (!args.quiet || e.kind !== 'move') console.log(shortEvent(e));
      else if (e.kind === 'move' && e.ply % 10 === 0) console.log(shortEvent(e));
    },
  })
    .then((report: GameReport) => {
      console.log('\n' + renderReport(report));
      const meta = { elapsedSeconds: Math.round((Date.now() - t0) / 1000), pgnPath, reportPath };
      writeFileSync(reportPath.replace(/\.md$/, '.json'), JSON.stringify({ ...report, ...meta }, null, 2));
      process.exit(report.terminalMet ? 0 : 1);
    })
    .catch((err) => {
      console.error('game failed:', err instanceof Error ? err.message : err);
      process.exit(2);
    });
}

main();
