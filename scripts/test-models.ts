/* Head-to-head model test for the Goal Compiler on the hardest directive. */
import { LlmChain, loadEnvFile, extractJson } from '@marionette/llm';
import { GOAL_COMPILER_SYSTEM, initialCompileUserMessage } from '../packages/core/src/compiler/prompt.ts';
import { compilePlan } from '../packages/core/src/plan/schema.ts';

loadEnvFile();
const directive =
  'Win by giving up every piece except pawns, promote all of them to knights, then checkmate with a knight.';
const user = initialCompileUserMessage(directive, 'w', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

const models = (process.argv[2] ?? '').split(',').filter(Boolean);
for (const model of models) {
  const chain = new LlmChain([
    {
      name: 'kilo',
      baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
      model,
      timeoutMs: 120_000,
      maxRetries: 0,
    },
  ]);
  const t0 = Date.now();
  try {
    const r = await chain.chat({
      system: GOAL_COMPILER_SYSTEM,
      user,
      maxTokens: 8192,
      temperature: 0.2,
      validate: (raw) => {
        try {
          compilePlan(JSON.parse(extractJson(raw))?.plan);
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
    });
    console.log(`OK   ${model}  ${((Date.now() - t0) / 1000).toFixed(0)}s  (content ${r.content.length} chars)`);
  } catch (e: any) {
    const att = (e?.attempts ?? []).map((a: any) => `${a.ok ? 'ok' : (a.error ?? '').slice(0, 90)} ${a.ms}ms`).join(' || ');
    console.log(`FAIL ${model}  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${att}`);
  }
}
