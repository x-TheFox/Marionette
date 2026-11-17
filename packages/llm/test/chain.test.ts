import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/json.js';
import { parseEnvFile, findRepoRoot } from '../src/env.js';
import { LlmChain } from '../src/chain.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('extractJson', () => {
  it('extracts a plain object', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it('strips fences and prose', () => {
    const raw = 'Here you go:\n```json\n{"plan": {"x": 2}}\n```\nHope that helps!';
    expect(extractJson(raw)).toBe('{"plan": {"x": 2}}');
  });
  it('throws when no object present', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON object/);
  });
});

describe('parseEnvFile', () => {
  it('parses keys, quotes and comments, skips blanks', () => {
    const vars = parseEnvFile('# comment\nA=1\nB = "two words"\nC=\'x\'\n\nD=\n');
    expect(vars).toEqual({ A: '1', B: 'two words', C: 'x', D: '' });
  });
});

describe('findRepoRoot', () => {
  it('finds the marionette root from a nested dir', () => {
    const root = findRepoRoot(join(process.cwd(), 'packages', 'llm', 'test'));
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(root.endsWith('marionette')).toBe(true);
  });
});

describe('LlmChain.fromEnv', () => {
  it('puts Groq first when GROQ_API_KEY is set, with OpenAI-compatible defaults', () => {
    const chain = LlmChain.fromEnv({ GROQ_API_KEY: 'gsk-test' } as NodeJS.ProcessEnv);
    const first = chain.providers[0]!;
    expect(first.name).toBe('groq');
    expect(first.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(first.model).toBe('llama-3.3-70b-versatile');
    expect(first.apiKey).toBe('gsk-test');
    // kilo still present as failover
    expect(chain.providers.some((p) => p.name === 'kilo')).toBe(true);
  });

  it('omits Groq without a key and keeps kilo first', () => {
    const chain = LlmChain.fromEnv({} as NodeJS.ProcessEnv);
    expect(chain.providers[0]!.name).toBe('kilo');
    expect(chain.providers.some((p) => p.name === 'groq')).toBe(false);
  });

  it('honours model overrides for groq', () => {
    const chain = LlmChain.fromEnv({
      GROQ_API_KEY: 'gsk-test',
      MARIONETTE_LLM_MODEL_GROQ: 'openai/gpt-oss-120b',
    } as NodeJS.ProcessEnv);
    expect(chain.providers[0]!.model).toBe('openai/gpt-oss-120b');
  });
});
