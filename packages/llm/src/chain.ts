export interface ProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  /** Extra in-provider retries on schema-invalid output (with error feedback). */
  maxRetries: number;
}

export interface AttemptLog {
  provider: string;
  model: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  ms?: number;
}

export interface CompletionResult {
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
  attempts: AttemptLog[];
}

export interface ChatArgs {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  /**
   * Callback that validates raw content. Return null when acceptable, or an
   * error string that is fed back to the same provider for a corrected retry.
   */
  validate?: (raw: string) => string | null;
}

export class LlmChainError extends Error {
  constructor(
    message: string,
    public readonly attempts: AttemptLog[],
  ) {
    super(message);
    this.name = 'LlmChainError';
  }
}

type BreakerKind = 'ok' | 'http' | 'empty' | 'schema';

class CircuitBreaker {
  private consecutive = 0;
  private openUntil = 0;
  constructor(private threshold = 3, private defaultCooldownMs = 5 * 60_000) {}

  record(kind: BreakerKind, retryAfterS?: number): void {
    if (kind === 'ok' || kind === 'schema') {
      if (kind === 'ok') this.consecutive = 0;
      return; // schema errors are the model's fault, not the server's
    }
    this.consecutive++;
    if (this.consecutive >= this.threshold) {
      const cooldown =
        retryAfterS && retryAfterS > 0 ? retryAfterS * 1000 : this.defaultCooldownMs;
      this.openUntil = Date.now() + cooldown;
    }
  }

  get available(): boolean {
    return Date.now() >= this.openUntil;
  }

  get opensAt(): number {
    return this.openUntil;
  }
}

interface HttpResult {
  ok: boolean;
  status?: number;
  content: string | null;
  finishReason?: string | null;
  error?: string;
  retryAfterS?: number;
}

async function requestOnce(
  p: ProviderConfig,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number,
): Promise<HttpResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), p.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let retryAfterS: number | undefined;
      try {
        const j = JSON.parse(text);
        const ra = j?.retry_after ?? j?.error?.retry_after;
        if (typeof ra === 'number') retryAfterS = ra;
      } catch {
        /* not json */
      }
      return {
        ok: false,
        status: res.status,
        content: null,
        error: `HTTP ${res.status}: ${text.slice(0, 180)}`,
        retryAfterS,
      };
    }
    const j: any = await res.json();
    const ch = j?.choices?.[0];
    const content: string | null = ch?.message?.content ?? null;
    return { ok: true, content, finishReason: ch?.finish_reason ?? null };
  } catch (e) {
    return { ok: false, content: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI-compatible provider chain with automatic failover.
 *
 * Order (per project spec): kilo -> llm7 -> nim.
 * Failover triggers: HTTP 429/5xx, timeouts/network errors, empty content,
 * or schema-invalid output after in-provider retries with error feedback.
 * A provider that fails `threshold` times consecutively is circuit-broken
 * for a cooldown (honouring retry_after when the API supplies it).
 */
export class LlmChain {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(public providers: ProviderConfig[]) {
    for (const p of providers) this.breakers.set(p.name, new CircuitBreaker());
  }

  /** Builds the default chain from environment variables. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): LlmChain {
    const providers: ProviderConfig[] = [];
    // 0. Groq — fastest and most reliable when reachable; requires a key.
    //    FIRST when present: sub-10s compiles and replans. (Note: the dev
    //    sandbox's IP range is edge-blocked by Groq with 403 — provider
    //    failover skips it in ~1s; works from unblocked networks.)
    if (env.GROQ_API_KEY) {
      providers.push({
        name: 'groq',
        baseUrl: env.MARIONETTE_GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        model: env.MARIONETTE_LLM_MODEL_GROQ ?? 'llama-3.3-70b-versatile',
        apiKey: env.GROQ_API_KEY,
        timeoutMs: num(env.MARIONETTE_GROQ_TIMEOUT_MS, 60_000),
        maxRetries: 1,
      });
    }
    // 1. Kilo gateway — anonymous free tier works without a key.
    providers.push({
      name: 'kilo',
      baseUrl: env.MARIONETTE_KILO_BASE_URL ?? 'https://ai-gateway.kilo.ai/api/v1',
      model: env.MARIONETTE_LLM_MODEL ?? 'kilo-auto/free',
      apiKey: env.KILO_API_KEY || undefined,
      timeoutMs: num(env.MARIONETTE_KILO_TIMEOUT_MS, 150_000),
      maxRetries: 2,
    });
    // 2. LLM7.io — keyless fallback (placeholder key).
    if (env.MARIONETTE_LLM7_DISABLED !== '1') {
      providers.push({
        name: 'llm7',
        baseUrl: env.MARIONETTE_LLM7_BASE_URL ?? 'https://api.llm7.io/v1',
        model: env.MARIONETTE_LLM_MODEL_LLM7 ?? 'DeepSeek-V4-Flash-0731',
        apiKey: env.LLM7_API_KEY || 'placeholder',
        timeoutMs: num(env.MARIONETTE_LLM7_TIMEOUT_MS, 90_000),
        maxRetries: 2,
      });
    }
    // 3. NVIDIA NIM — last resort; requires a key.
    if (env.NVIDIA_API_KEY) {
      providers.push({
        name: 'nim',
        baseUrl: env.MARIONETTE_NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
        model: env.MARIONETTE_LLM_MODEL_NIM ?? 'openai/gpt-oss-20b',
        apiKey: env.NVIDIA_API_KEY,
        timeoutMs: num(env.MARIONETTE_NIM_TIMEOUT_MS, 45_000),
        maxRetries: 1,
      });
    }
    return new LlmChain(providers);
  }

  async chat(args: ChatArgs): Promise<CompletionResult> {
    const attempts: AttemptLog[] = [];
    for (const p of this.providers) {
      const breaker = this.breakers.get(p.name)!;
      if (!breaker.available) {
        attempts.push({
          provider: p.name,
          model: p.model,
          ok: false,
          skipped: `circuit-open (until ${new Date(breaker.opensAt).toISOString()})`,
        });
        continue;
      }
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ];
      for (let retry = 0; retry <= p.maxRetries; retry++) {
        const t0 = Date.now();
        const r = await requestOnce(p, messages, args.maxTokens, args.temperature ?? 0.2);
        const ms = Date.now() - t0;
        if (!r.ok) {
          attempts.push({ provider: p.name, model: p.model, ok: false, error: r.error, ms });
          breaker.record('http', r.retryAfterS);
          if (r.status != null && r.status >= 500 && retry < p.maxRetries) continue;
          break; // fail over to next provider
        }
        if (r.content == null || !r.content.trim()) {
          attempts.push({
            provider: p.name,
            model: p.model,
            ok: false,
            error: `empty content (finish=${r.finishReason ?? '?'})`,
            ms,
          });
          breaker.record('empty');
          if (retry < p.maxRetries) continue;
          break;
        }
        if (args.validate) {
          const err = args.validate(r.content);
          if (err != null) {
            attempts.push({
              provider: p.name,
              model: p.model,
              ok: false,
              error: `schema: ${err.slice(0, 200)}`,
              ms,
            });
            breaker.record('schema');
            if (retry < p.maxRetries) {
              messages.push({ role: 'assistant', content: r.content });
              messages.push({
                role: 'user',
                content:
                  `Your previous output was invalid: ${err}\n` +
                  'Return ONLY the corrected JSON object. No commentary, no markdown fences.',
              });
              continue;
            }
            break;
          }
        }
        attempts.push({ provider: p.name, model: p.model, ok: true, ms });
        breaker.record('ok');
        return { content: r.content, provider: p.name, model: p.model, latencyMs: ms, attempts };
      }
    }
    throw new LlmChainError('all LLM providers failed or were skipped', attempts);
  }
}

function num(v: string | undefined, dflt: number): number {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
