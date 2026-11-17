/* Compile all six example directives and print the plans for review. */
import { LlmChain, loadEnvFile } from '@marionette/llm';
import { compileDirectivePlan } from '../packages/core/src/compiler/compile.ts';

loadEnvFile();
const model = process.argv[2] ?? 'cohere/north-mini-code:free';
const directives = [
  'Win by giving up every piece except pawns, promote all of them to knights, then checkmate with a knight.',
  'Give up all your pieces and lose.',
  'Make it look like you\'re trying hard.',
  'Force me into winning.',
  'Bully me.',
  'Win with only a queen and king left.',
];
const chain = new LlmChain([
  { name: 'kilo', baseUrl: 'https://ai-gateway.kilo.ai/api/v1', model, timeoutMs: 120_000, maxRetries: 2 },
]);
for (const d of directives) {
  const t0 = Date.now();
  try {
    const r = await compileDirectivePlan({
      directive: d,
      selfColor: 'w',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      llm: chain,
      noCache: true,
    });
    console.log(`\n=== OK (${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.attempts.length} attempt(s)) ${d}`);
    console.log(`    summary: ${r.compiled.plan.summary}`);
    console.log(`    style: ${r.compiled.plan.style} | terminal: ${JSON.stringify(r.compiled.plan.terminal)} | fallback: ${r.compiled.plan.fallback.join(',')}`);
    for (const m of r.compiled.milestones) {
      console.log(`    m ${m.spec.id} [tol=${m.spec.tolerance} w=${m.spec.weight}${m.spec.moveBudget ? ` budget=${m.spec.moveBudget}` : ''}]: ${m.spec.completion}`);
      if (m.spec.infeasible) console.log(`      infeasible: ${m.spec.infeasible}`);
    }
    for (const c of r.compiled.constraints) {
      console.log(`    hc ${c.spec.id}: ${c.spec.predicate}${c.spec.afterMilestone ? ` (after ${c.spec.afterMilestone})` : ''}`);
    }
  } catch (e: any) {
    const att = (e?.attempts ?? []).map((a: any) => `${a.provider}:${a.ok ? 'ok' : (a.error ?? a.skipped ?? '').slice(0, 110)}`).join(' || ');
    console.log(`\n=== FAIL ${d}\n    ${att}`);
  }
}
