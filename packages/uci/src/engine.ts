import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/** One MultiPV line of an engine analysis. */
export interface PvLine {
  /** 1-based MultiPV index. */
  multipv: number;
  /** First move of the PV, UCI format (e2e4, e7e8q). */
  move: string;
  /** Full principal variation, UCI format. */
  pv: string[];
  /** Search depth reached for this line. */
  depth: number;
  /** Centipawn score from the side-to-move's perspective, or null if a mate score. */
  cpSTM: number | null;
  /** Moves-to-mate from the side-to-move's perspective (positive: STM mates), or null. */
  mateSTM: number | null;
}

export interface Analysis {
  fen: string;
  /** Highest depth seen across lines. */
  depth: number;
  /** Sorted by multipv ascending. May be empty for positions with no legal moves. */
  lines: PvLine[];
  /** Engine's best move in UCI format, or '(none)'. */
  bestMove: string;
}

export interface AnalyseOptions {
  depth?: number;
  movetime?: number;
  multiPV?: number;
  /** Abort timeout in ms; defaults to a depth-derived budget. */
  timeoutMs?: number;
}

export class UciEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UciEngineError';
  }
}

interface PendingCmd {
  onLine: (line: string) => void;
  reject: (err: Error) => void;
}

/**
 * Thin, robust UCI client for a single engine process.
 *
 * Design notes:
 * - All commands are serialized through a promise chain: UCI is a sequential
 *   protocol, and interleaving `go`/`setoption` from concurrent callers corrupts
 *   state.
 * - `analyse` collects `info` lines until `bestmove` arrives, keeping the latest
 *   non-bound line per MultiPV index (aspiration-window `lowerbound`/`upperbound`
 *   lines are ignored as they are partial results).
 * - Scores follow the UCI convention: from the perspective of the side to move.
 *   Convert with `toWhiteCp` / `toSideCp` helpers.
 */
export class UciEngine {
  private proc!: ChildProcessWithoutNullStreams;
  private pending: PendingCmd | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private curMultiPV = 1;
  private readonly path: string;
  private readonly debug: boolean;

  private constructor(path: string, debug: boolean) {
    this.path = path;
    this.debug = debug;
  }

  static async spawn(path: string, opts: { debug?: boolean } = {}): Promise<UciEngine> {
    const eng = new UciEngine(path, opts.debug ?? false);
    eng.proc = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    eng.proc.on('error', (err) =>
      eng.failAll(new UciEngineError(`failed to spawn engine at ${path}: ${err.message}`)),
    );
    eng.proc.on('exit', (code) => {
      eng.closed = true;
      eng.failAll(new UciEngineError(`engine exited prematurely (code ${code})`));
    });
    const rl = createInterface({ input: eng.proc.stdout });
    rl.on('line', (line) => eng.onLine(line));
    eng.proc.stderr.on('data', (d) => {
      if (eng.debug) process.stderr.write(`[uci:${eng.label()} stderr] ${d}`);
    });
    // UCI handshake
    await eng.serial(() => eng.cmd(['uci'], (l) => l.startsWith('uciok'), 30_000));
    await eng.serial(() =>
      eng.cmd(['setoption name Threads value 1', 'setoption name Hash value 256', 'isready'],
        (l) => l === 'readyok', 30_000),
    );
    return eng;
  }

  private label(): string {
    return this.path.split('/').pop() ?? this.path;
  }

  private onLine(line: string): void {
    if (this.pending) {
      this.pending.onLine(line);
    } else if (this.debug) {
      process.stderr.write(`[uci:${this.label()}] ${line}\n`);
    }
  }

  private failAll(err: Error): void {
    this.pending?.reject(err);
    this.pending = null;
  }

  private send(line: string): void {
    this.proc.stdin.write(line + '\n');
  }

  /** Serialize access to the engine. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private cmd(sendLines: string[], isDone: (l: string) => boolean, timeoutMs: number): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const collected: string[] = [];
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new UciEngineError(`timeout (${timeoutMs}ms) waiting for engine; sent: ${sendLines.join(' | ')}`));
      }, timeoutMs);
      this.pending = {
        onLine: (l) => {
          collected.push(l);
          if (isDone(l)) {
            clearTimeout(timer);
            this.pending = null;
            resolve(collected);
          }
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      for (const s of sendLines) this.send(s);
    });
  }

  async setOption(name: string, value: string | number | boolean): Promise<void> {
    if (this.closed) throw new UciEngineError('engine closed');
    if (name === 'MultiPV') this.curMultiPV = Number(value);
    await this.serial(() =>
      this.cmd([`setoption name ${name} value ${value}`, 'isready'], (l) => l === 'readyok', 30_000),
    );
  }

  async newGame(): Promise<void> {
    if (this.closed) throw new UciEngineError('engine closed');
    await this.serial(() => this.cmd(['ucinewgame', 'isready'], (l) => l === 'readyok', 60_000));
  }

  async analyse(fen: string, opts: AnalyseOptions = {}): Promise<Analysis> {
    if (this.closed) throw new UciEngineError('engine closed');
    const depth = opts.depth ?? 12;
    return this.serial(async () => {
      const sends: string[] = [];
      if (opts.multiPV != null && opts.multiPV !== this.curMultiPV) {
        sends.push(`setoption name MultiPV value ${opts.multiPV}`, 'isready');
        this.curMultiPV = opts.multiPV;
      }
      sends.push(`position fen ${fen}`);
      const limits: string[] = ['go'];
      if (opts.movetime != null) limits.push(`movetime ${opts.movetime}`);
      if (opts.depth != null) limits.push(`depth ${depth}`);
      sends.push(limits.join(' '));
      const timeoutMs =
        opts.timeoutMs ?? Math.max(120_000, depth * 30_000 + (opts.movetime ?? 0) * 3);
      const lines = await this.cmd(sends, (l) => l.startsWith('bestmove'), timeoutMs);
      return parseAnalysis(fen, lines);
    });
  }

  /** Convenience: engine's single best move (UCI) for a position. */
  async bestMove(fen: string, opts: AnalyseOptions = {}): Promise<string> {
    const a = await this.analyse(fen, { ...opts, multiPV: 1 });
    return a.bestMove;
  }

  async quit(): Promise<void> {
    if (this.closed) return;
    try {
      this.send('quit');
    } catch {
      /* stdin may already be gone */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (!this.closed) this.proc.kill('SIGKILL');
  }
}

export function parseAnalysis(fen: string, lines: string[]): Analysis {
  const map = new Map<number, PvLine>();
  let bestMove = '(none)';
  for (const raw of lines) {
    if (raw.startsWith('info')) {
      const tk = raw.trim().split(/\s+/);
      if (tk.includes('lowerbound') || tk.includes('upperbound')) continue;
      const iMultipv = tk.indexOf('multipv');
      const multipv = iMultipv >= 0 ? parseInt(tk[iMultipv + 1]!, 10) : 1;
      if (!Number.isFinite(multipv)) continue;
      const iScore = tk.indexOf('score');
      if (iScore < 0) continue;
      let cpSTM: number | null = null;
      let mateSTM: number | null = null;
      if (tk[iScore + 1] === 'cp') cpSTM = parseInt(tk[iScore + 2]!, 10);
      else if (tk[iScore + 1] === 'mate') mateSTM = parseInt(tk[iScore + 2]!, 10);
      else continue;
      const iPv = tk.indexOf('pv');
      if (iPv < 0) continue;
      const pv = tk.slice(iPv + 1);
      if (pv.length === 0) continue;
      const iDepth = tk.indexOf('depth');
      const depth = iDepth >= 0 ? parseInt(tk[iDepth + 1]!, 10) : 0;
      map.set(multipv, { multipv, move: pv[0]!, pv, depth, cpSTM, mateSTM });
    } else if (raw.startsWith('bestmove')) {
      const m = raw.trim().split(/\s+/)[1];
      if (m) bestMove = m;
    }
  }
  const arr = [...map.values()].sort((a, b) => a.multipv - b.multipv);
  const depth = arr.length ? Math.max(...arr.map((l) => l.depth)) : 0;
  return { fen, depth, lines: arr, bestMove };
}

/** Convert a side-to-move-perspective centipawn score to white's perspective. */
export function toWhiteCp(cpSTM: number, fen: string): number {
  return fen.split(' ')[1] === 'b' ? -cpSTM : cpSTM;
}

/** Convert a white-perspective centipawn score to the given side's perspective. */
export function toSideCp(cpWhite: number, side: 'w' | 'b'): number {
  return side === 'b' ? -cpWhite : cpWhite;
}
