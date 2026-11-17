import { tokenize, PredicateSyntaxError, type Token } from './lexer.js';

/**
 * Predicate AST. The LLM never emits code — it emits expressions from this
 * fixed grammar, which are parsed here and validated against the function
 * table before a plan is accepted.
 */
export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'enum'; v: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'not'; e: Node }
  | { k: 'and'; l: Node; r: Node }
  | { k: 'or'; l: Node; r: Node }
  | { k: 'cmp'; op: '==' | '!=' | '<=' | '>=' | '<' | '>'; l: Node; r: Node };

const CMP_OPS = new Set(['==', '!=', '<=', '>=', '<', '>']);

export function parsePredicate(input: string): Node {
  const tokens = tokenize(input);
  let pos = 0;

  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;
  const expect = (type: Token['type'], what: string): Token => {
    const t = next();
    if (t.type !== type) throw new PredicateSyntaxError(`expected ${what}, got '${t.value || 'end'}'`, t.pos);
    return t;
  };

  function parseExpr(): Node {
    return parseOr();
  }

  function parseOr(): Node {
    let l = parseAnd();
    while (peek().type === 'op' && peek().value === '||') {
      next();
      const r = parseAnd();
      l = { k: 'or', l, r };
    }
    return l;
  }

  function parseAnd(): Node {
    let l = parseCmp();
    while (peek().type === 'op' && peek().value === '&&') {
      next();
      const r = parseCmp();
      l = { k: 'and', l, r };
    }
    return l;
  }

  function parseCmp(): Node {
    const l = parseUnary();
    if (peek().type === 'op' && CMP_OPS.has(peek().value)) {
      const op = next().value as '==' | '!=' | '<=' | '>=' | '<' | '>';
      const r = parseUnary();
      return { k: 'cmp', op, l, r };
    }
    return l;
  }

  function parseUnary(): Node {
    if (peek().type === 'op' && peek().value === '!') {
      next();
      return { k: 'not', e: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const t = peek();
    if (t.type === 'num') {
      next();
      return { k: 'num', v: Number(t.value) };
    }
    if (t.type === 'str') {
      next();
      return { k: 'str', v: t.value };
    }
    if (t.type === 'lparen') {
      next();
      const e = parseExpr();
      expect('rparen', "')'");
      return e;
    }
    if (t.type === 'id') {
      next();
      if (peek().type === 'lparen') {
        next();
        const args: Node[] = [];
        if (peek().type !== 'rparen') {
          args.push(parseExpr());
          while (peek().type === 'comma') {
            next();
            args.push(parseExpr());
          }
        }
        expect('rparen', "')'");
        return { k: 'call', fn: t.value, args };
      }
      // bare identifier used as an enum value (self, opp, white, black, knight, ...)
      return { k: 'enum', v: t.value };
    }
    throw new PredicateSyntaxError(
      `expected a value, function call or '(' but got '${t.value || 'end of input'}'`,
      t.pos,
    );
  }

  const ast = parseExpr();
  const t = peek();
  if (t.type !== 'eof') {
    throw new PredicateSyntaxError(`unexpected trailing input '${t.value}'`, t.pos);
  }
  return ast;
}
