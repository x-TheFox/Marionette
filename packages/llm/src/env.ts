/**
 * Minimal .env loader (no dependency): finds the repo root by walking up from
 * cwd until a package.json with "workspaces" appears, then parses KEY=VALUE
 * lines. Never overrides variables already present in the environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (;;) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        if (Array.isArray(j.workspaces) || j.name === 'marionette') return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvFile(startDir: string = process.cwd()): string {
  const root = findRepoRoot(startDir);
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return root;
  const vars = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return root;
}
