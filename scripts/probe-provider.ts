/* Quick provider health probe: one minimal completion through the default chain. */
import { LlmChain, loadEnvFile } from '../packages/llm/src/index.js';

loadEnvFile();
const chain = LlmChain.fromEnv();
const t0 = Date.now();
try {
  const r = await chain.chat({
    system: 'Reply with the single word OK.',
    user: 'Say OK.',
    maxTokens: 2000,
    temperature: 0,
  });
  console.log('provider OK:', r.provider, r.model, ((Date.now() - t0) / 1000).toFixed(1) + 's');
} catch (e) {
  console.log('FAILED:', e instanceof Error ? e.message : String(e));
  const attempts = (e as { attempts?: { provider: string; ok?: boolean; error?: string; skipped?: string }[] }).attempts ?? [];
  for (const a of attempts) console.log('  ', a.provider, a.ok ? 'ok' : (a.error ?? a.skipped ?? '').slice(0, 120));
}
