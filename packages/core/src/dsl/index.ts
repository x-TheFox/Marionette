import { parsePredicate } from './parser.js';
import { evaluatePredicate, partialCredit, validateAst } from './functions.js';
import type { Node } from './parser.js';
import type { GameContext } from './types.js';

export * from './types.js';
export * from './lexer.js';
export * from './parser.js';
export * from './functions.js';
export * from './context.js';

/** A parsed + statically validated predicate, ready for evaluation. */
export interface CompiledPredicate {
  src: string;
  ast: Node;
}

export class PredicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateError';
  }
}

/** Parse and statically validate a predicate expression. Throws PredicateError. */
export function compilePredicate(src: string): CompiledPredicate {
  try {
    const ast = parsePredicate(src);
    validateAst(ast);
    return { src, ast };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PredicateError(`invalid predicate '${src}': ${msg}`);
  }
}

export function evalPredicate(p: CompiledPredicate, ctx: GameContext): boolean {
  return evaluatePredicate(p.ast, ctx);
}

export function predicatePartial(p: CompiledPredicate, ctx: GameContext): number {
  return partialCredit(p.ast, ctx);
}
