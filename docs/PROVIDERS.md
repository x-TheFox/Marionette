# LLM providers — verified facts, failover, caching

All facts below verified live on 2026-11-17 from this sandbox. Base URLs and model IDs are config, never hardcoded assumptions in code.

## Chain (in order)

### 1. Kilo gateway — primary
- Base URL: `https://ai-gateway.kilo.ai/api/v1` (OpenAI-compatible; from Kilo's gateway docs).
- Free tier works **anonymously** (no key). Anonymous rate limit: 200 requests/hour per IP.
- Router model: `kilo-auto/free` (deterministic affinity across available free candidates). Observed routing: `nvidia/nemotron-3.5-super-vl:free` (provider: Nvidia). Direct `:free` model IDs also exist (e.g. `openrouter/free`, `baidu/ernie-5.5-flash-preview:free`, ...).
- Caveats observed:
  - Free models are often **reasoning models**: they spend tokens on `message.reasoning` before `message.content`. Budget `max_tokens` generously (>= 1024 for plan compilation) and parse `content` first, falling back to `reasoning` only for diagnostics.
  - Model metadata includes `mayTrainOnYourPrompts` — only chess directives/board states are ever sent, which is acceptable; never send secrets.
  - Set `KILO_API_KEY` in `.env` to authenticate (raises rate limits) — optional.

### 2. LLM7.io — keyless fallback
- Base URL: `https://api.llm7.io/v1`, any non-empty placeholder string as API key. `json_mode: true` supported per model metadata.
- 74 models at probe time (e.g. `DeepSeek-V4-Flash-0731`, `anthropic/claude-sonnet-5`, ...). Model list is fetched at runtime, never hardcoded.
- Caveat observed: **per-IP daily quota** can be exhausted (`insufficient_quota`, with `retry_after` seconds) — recovers on its own; the circuit breaker must respect `retry_after` when present.

### 3. NVIDIA NIM — last resort
- Base URL: `https://integrate.api.nvidia.com/v1` (OpenAI-compatible), key from `NVIDIA_API_KEY`.
- `/models` works (32 models, e.g. `openai/gpt-oss-20b`, `google/gemma-3-4b-it`, `z-ai/glm-5.3-flash`, `nvidia/nemotron-3.5-lightning-30b-a3b`).
- Caveat observed: chat completions **time out (>120 s) from this sandbox** even when `/models` responds — keep NIM last, with a short request timeout and let the circuit breaker cool it down. May behave differently from other networks.

## Failover rules (implemented in the provider service)

- Per request: try provider in chain order. A provider attempt fails on: HTTP 429/5xx, timeout, empty content, or schema-invalid output after N=2 in-provider retries (with brief backoff).
- Circuit breaker per provider: 3 consecutive failures → open for a cooldown (default 5 min; extended if the error carried `retry_after`). Open breakers are skipped instantly.
- Every call is logged with the serving provider, model, latency, and failure reason — surfaced in the UI puppeteer view and benchmark reports.
- Model choice is config (`MARIONETTE_LLM_MODEL`), validated against the provider's live model list when possible; code never depends on one model.

## Plan cache

- Compiled plans are cached by `(sha256(directive), model, schema_version)` under `.cache/plans/` (gitignored) so benchmark sweeps don't burn provider quota. Replans during a game are NOT cached (position-dependent).
- Cache is keyed by model because different models may compile different plans; benchmark reports record the model that served each compile.
