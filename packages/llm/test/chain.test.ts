import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/json.js';
import { parseEnvFile, findRepoRoot } from '../src/env.js';
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
