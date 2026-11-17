/**
 * Replay a stored PGN and print the per-ply partial credit of a milestone's
 * top-level conjuncts (and the min() the tracker/steering actually sees).
 * Diagnostic for the D1/D6 steering iteration.
 *
 * Usage: tsx scripts/analyze-credit.ts <pgn> <selfColor> <predicate>
 */
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { buildContext, compilePredicate, predicatePartial } from '../packages/core/src/index.js';

const [pgnPath, selfColor, predicateSrc] = process.argv.slice(2) as ['w' | 'b', string, string];
const pgn = readFileSync(pgnPath, 'utf8');
const game = new Chess();
game.loadPgn(pgn);
const history = game.history({ verbose: true });

const pred = compilePredicate(predicateSrc);
// split top-level && conjuncts
function splitAnd(src: string): string[] {
  // no parens in our predicates; split on ' && '
  return src.split('&&').map((s) => s.trim());
}
const conjuncts = splitAnd(predicateSrc).map((s) => compilePredicate(s));

const checkFlags: boolean[] = [];
let prev = new Chess();
console.log('ply | move | min | ' + conjuncts.map((c, i) => `c${i}`).join(' | '));
let lastMin = -1;
for (let ply = 0; ply < history.length; ply++) {
  const mv = history[ply]!;
  const b = new Chess();
  for (let i = 0; i <= ply; i++) b.move(history[i]!.san);
  const self = selfColor as 'w' | 'b';
  if (b.turn() === self) continue; // we evaluate after opponent moves? No: after ANY move, from self's perspective
  void mv;
  void prev;
  const ctx = buildContext(b, selfColor as 'w' | 'b', { evalWhiteCp: 0, mateWhite: null }, checkFlags);
  const vals = conjuncts.map((c) => predicatePartial(c, ctx));
  const mn = predicatePartial(pred, ctx);
  const flag = Math.abs(mn - lastMin) < 1e-9 ? '' : ' <== min moved';
  console.log(
    `${String(ply + 1).padStart(3)} | ${history[ply]!.san.padEnd(7)} | ${mn.toFixed(3)} | ` +
      vals.map((v) => v.toFixed(3)).join(' | ') + flag,
  );
  lastMin = mn;
}
