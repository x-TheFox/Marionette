export type TokenType = 'num' | 'str' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!'];

export class PredicateSyntaxError extends Error {
  constructor(message: string, public pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = 'PredicateSyntaxError';
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: c, pos: i });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      let s = '';
      while (i < n && input[i] !== quote) {
        s += input[i];
        i++;
      }
      if (i >= n) throw new PredicateSyntaxError('unterminated string', start);
      i++; // closing quote
      tokens.push({ type: 'str', value: s, pos: start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const start = i;
      let s = '';
      if (c === '-') {
        s += '-';
        i++;
      }
      while (i < n && /[0-9.]/.test(input[i]!)) {
        s += input[i]!;
        i++;
      }
      const v = Number(s);
      if (!Number.isFinite(v)) throw new PredicateSyntaxError(`invalid number '${s}'`, start);
      tokens.push({ type: 'num', value: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      let s = '';
      while (i < n && /[A-Za-z0-9_]/.test(input[i]!)) {
        s += input[i]!;
        i++;
      }
      tokens.push({ type: 'id', value: s, pos: start });
      continue;
    }
    const op = OPS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
      continue;
    }
    throw new PredicateSyntaxError(`unexpected character '${c}'`, i);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}
