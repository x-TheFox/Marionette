import type { GameContext, PieceType, Side } from './types.js';
import type { Node } from './parser.js';

export type ValueType = 'number' | 'string' | 'boolean';
export type Val = number | string | boolean;

export class PredicateEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateEvalError';
  }
}

type ArgSpec = { kind: 'side' } | { kind: 'piece' };
export interface FnDef {
  args: ArgSpec[];
  ret: ValueType;
}

export const SIDE_NAMES = ['self', 'opp', 'white', 'black'] as const;
export const PIECE_NAMES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;

/**
 * The fixed predicate vocabulary. The Goal Compiler may only use these
 * functions; anything else fails plan validation.
 */
export const FUNCTIONS: Record<string, FnDef> = {
  material: { args: [{ kind: 'side' }], ret: 'number' },
  non_pawn_count: { args: [{ kind: 'side' }], ret: 'number' },
  piece_count: { args: [{ kind: 'side' }, { kind: 'piece' }], ret: 'number' },
  promoted_count: { args: [{ kind: 'side' }, { kind: 'piece' }], ret: 'number' },
  captured_value: { args: [{ kind: 'side' }], ret: 'number' },
  captures_count: { args: [{ kind: 'side' }], ret: 'number' },
  checks_count: { args: [{ kind: 'side' }], ret: 'number' },
  castled: { args: [{ kind: 'side' }], ret: 'boolean' },
  last_move_piece: { args: [], ret: 'string' },
  last_move_was_capture: { args: [], ret: 'boolean' },
  last_move_was_check: { args: [], ret: 'boolean' },
  last_move_was_promotion: { args: [], ret: 'boolean' },
  is_check: { args: [], ret: 'boolean' },
  is_checkmate: { args: [], ret: 'boolean' },
  is_stalemate: { args: [], ret: 'boolean' },
  is_draw: { args: [], ret: 'boolean' },
  insufficient_material: { args: [], ret: 'boolean' },
  winner: { args: [], ret: 'string' },
  turn: { args: [], ret: 'string' },
  phase: { args: [], ret: 'string' },
  move_number: { args: [], ret: 'number' },
  ply: { args: [], ret: 'number' },
  eval_cp: { args: [], ret: 'number' },
  self_eval_cp: { args: [], ret: 'number' },
  mate_in: { args: [], ret: 'number' },
  mated_by: { args: [{ kind: 'side' }, { kind: 'piece' }], ret: 'boolean' },
};

function resolveSide(v: string, ctx: GameContext): Side {
  switch (v) {
    case 'self':
      return ctx.self;
    case 'opp':
      return ctx.self === 'w' ? 'b' : 'w';
    case 'white':
      return 'w';
    case 'black':
      return 'b';
    default:
      throw new PredicateEvalError(`unknown side '${v}' (use self, opp, white, black)`);
  }
}

/** Resolve a standalone enum value (side names map to the DSL's 'white'/'black' surface). */
function resolveEnumValue(v: string, ctx: GameContext): string {
  if ((SIDE_NAMES as readonly string[]).includes(v)) {
    return resolveSide(v, ctx) === 'w' ? 'white' : 'black';
  }
  return v;
}

function selfPersp(cpWhite: number, ctx: GameContext): number {
  return ctx.self === 'w' ? cpWhite : -cpWhite;
}

/** Evaluate one function call with already-validated enum args. */
function callFn(fn: string, sides: (string | undefined)[], pieces: (string | undefined)[], ctx: GameContext): Val {
  const side0 = sides[0] !== undefined ? resolveSide(sides[0], ctx) : undefined;
  const piece0 = pieces[0];
  switch (fn) {
    case 'material':
      return ctx.material[side0!];
    case 'non_pawn_count':
      return ctx.pieces[side0!].knight + ctx.pieces[side0!].bishop + ctx.pieces[side0!].rook + ctx.pieces[side0!].queen;
    case 'piece_count':
      return ctx.pieces[side0!][piece0 as PieceType];
    case 'promoted_count':
      return ctx.promoted[side0!][piece0 as PieceType];
    case 'captured_value':
      return ctx.capturedValue[side0!];
    case 'captures_count':
      return ctx.capturesCount[side0!];
    case 'checks_count':
      return ctx.checksCount[side0!];
    case 'castled':
      return ctx.castled[side0!];
    case 'last_move_piece':
      return ctx.lastMove?.piece ?? 'none';
    case 'last_move_was_capture':
      return ctx.lastMove?.captured != null;
    case 'last_move_was_check':
      return ctx.lastMove?.wasCheck ?? false;
    case 'last_move_was_promotion':
      return ctx.lastMove?.promotion != null;
    case 'is_check':
      return !ctx.over && ctx.turn != null ? isCheckNow(ctx) : false;
    case 'is_checkmate':
      return ctx.checkmate;
    case 'is_stalemate':
      return ctx.stalemate;
    case 'is_draw':
      return ctx.draw;
    case 'insufficient_material':
      return ctx.insufficient;
    case 'winner':
      return ctx.winner == null ? 'none' : ctx.winner === 'w' ? 'white' : 'black';
    case 'turn':
      return ctx.turn === 'w' ? 'white' : 'black';
    case 'phase':
      return ctx.phase;
    case 'move_number':
      return ctx.moveNumber;
    case 'ply':
      return ctx.ply;
    case 'eval_cp':
      return ctx.evalWhiteCp ?? 0;
    case 'self_eval_cp':
      return ctx.evalWhiteCp == null ? 0 : selfPersp(ctx.evalWhiteCp, ctx);
    case 'mate_in':
      return ctx.mateWhite ?? 0;
    case 'mated_by':
      return ctx.checkmate && ctx.winner === side0 && ctx.matedBy === piece0;
    default:
      throw new PredicateEvalError(`unknown function '${fn}'`);
  }
}

function isCheckNow(ctx: GameContext): boolean {
  // The side to move is in check iff the previous move gave check.
  return ctx.lastMove?.wasCheck === true && ctx.lastMove.color !== ctx.turn;
}

/** Static validation + enum argument extraction. Throws on any violation. */
export function validateAst(ast: Node): void {
  const go = (n: Node): ValueType => {
    switch (n.k) {
      case 'num':
        return 'number';
      case 'str':
      case 'enum':
        return 'string';
      case 'not': {
        const t = go(n.e);
        require(t === 'boolean', "'!' needs a boolean operand");
        return 'boolean';
      }
      case 'and':
      case 'or': {
        const lt = go(n.l);
        const rt = go(n.r);
        require(lt === 'boolean' && rt === 'boolean', `'${n.k}' needs boolean operands`);
        return 'boolean';
      }
      case 'cmp': {
        const lt = go(n.l);
        const rt = go(n.r);
        require(lt === rt, `comparison '${n.op}' needs matching types (got ${lt} vs ${rt})`);
        require(lt !== 'boolean' || n.op === '==' || n.op === '!=', 'booleans only support == and !=');
        return 'boolean';
      }
      case 'call': {
        const def = FUNCTIONS[n.fn];
        require(def != null, `unknown function '${n.fn}'`);
        require(n.args.length === def.args.length, `function '${n.fn}' expects ${def.args.length} argument(s), got ${n.args.length}`);
        const sides: (string | undefined)[] = [];
        const pieces: (string | undefined)[] = [];
        def.args.forEach((spec, i) => {
          const a = n.args[i]!;
          const v = a.k === 'str' || a.k === 'enum' ? a.v : null;
          require(v != null, `argument ${i + 1} of '${n.fn}' must be a ${spec.kind} name (self/opp/white/black or a piece name)`);
          if (spec.kind === 'side') {
            require((SIDE_NAMES as readonly string[]).includes(v!), `argument ${i + 1} of '${n.fn}' must be a side (self, opp, white, black), got '${v}'`);
            sides.push(v);
          } else {
            require((PIECE_NAMES as readonly string[]).includes(v!), `argument ${i + 1} of '${n.fn}' must be a piece (pawn, knight, bishop, rook, queen, king), got '${v}'`);
            pieces.push(v);
          }
        });
        return def.ret;
      }
    }
  };
  const t = go(ast);
  require(t === 'boolean', 'a predicate must be a boolean expression');
}

function require(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new PredicateEvalError(msg);
}

/** Evaluate a validated predicate to a boolean. */
export function evaluatePredicate(ast: Node, ctx: GameContext): boolean {
  const v = evalNode(ast, ctx);
  if (typeof v !== 'boolean') throw new PredicateEvalError('predicate did not evaluate to boolean');
  return v;
}

function evalNode(n: Node, ctx: GameContext): Val {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'enum':
      return resolveEnumValue(n.v, ctx);
    case 'not':
      return !evalNode(n.e, ctx);
    case 'and':
      return evalNode(n.l, ctx) && evalNode(n.r, ctx);
    case 'or':
      return evalNode(n.l, ctx) || evalNode(n.r, ctx);
    case 'cmp': {
      const l = evalNode(n.l, ctx);
      const r = evalNode(n.r, ctx);
      switch (n.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return (l as number) < (r as number);
        case '>':
          return (l as number) > (r as number);
        case '<=':
          return (l as number) <= (r as number);
        case '>=':
          return (l as number) >= (r as number);
      }
    }
    case 'call': {
      const sides: (string | undefined)[] = [];
      const pieces: (string | undefined)[] = [];
      const def = FUNCTIONS[n.fn]!;
      def.args.forEach((spec, i) => {
        const a = n.args[i] as Node & { v?: string };
        if (spec.kind === 'side') sides.push(a.v);
        else pieces.push(a.v);
      });
      return callFn(n.fn, sides, pieces, ctx);
    }
  }
}

/** Normalized ranges used for partial-credit distance scaling. */
export const RANGES: Record<string, number> = {
  material: 4000,
  non_pawn_count: 8,
  piece_count: 10,
  promoted_count: 8,
  captured_value: 4000,
  captures_count: 40,
  checks_count: 60,
  move_number: 80,
  ply: 200,
  eval_cp: 1500,
  self_eval_cp: 1500,
  mate_in: 30,
};

/**
 * Gradient value for a numeric function: like the raw value but with built-in
 * progress heuristics (e.g. promoted_count credits pawn advancement). Used by
 * both partial-credit computation and motivated-candidate generation.
 */
export function gradientValue(fn: string, sides: (string | undefined)[], pieces: (string | undefined)[], ctx: GameContext): number {
  const side0 = sides[0] !== undefined ? resolveSide(sides[0], ctx) : undefined;
  const piece0 = pieces[0];
  switch (fn) {
    case 'material':
      return ctx.material[side0!];
    case 'non_pawn_count':
      return ctx.pieces[side0!].knight + ctx.pieces[side0!].bishop + ctx.pieces[side0!].rook + ctx.pieces[side0!].queen;
    case 'piece_count':
      return ctx.pieces[side0!][piece0 as PieceType];
    case 'promoted_count': {
      // Promotions already made + advancement progress of remaining pawns,
      // so every pawn push toward promotion yields gradient.
      const promoted = ctx.promoted[side0!][piece0 as PieceType];
      let adv = 0;
      const boardSide = side0!;
      const dir = boardSide === 'w' ? 1 : -1;
      const board = ctx.fen.split(' ')[0]!;
      let rank = 0;
      let file = 0;
      for (const ch of board) {
        if (ch === '/') {
          rank++;
          file = 0;
          continue;
        }
        if (/[1-8]/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const isWhite = ch === ch.toUpperCase();
        if (ch.toLowerCase() === 'p' && (isWhite ? 'w' : 'b') === boardSide) {
          const r8 = 8 - rank; // 1..8 from white's view
          const steps = boardSide === 'w' ? 8 - r8 : r8 - 1;
          adv += Math.max(0, 6 - steps) / 6;
        }
        file++;
      }
      return promoted + adv;
    }
    case 'captured_value':
      return ctx.capturedValue[side0!];
    case 'captures_count':
      return ctx.capturesCount[side0!];
    case 'checks_count':
      return ctx.checksCount[side0!];
    case 'move_number':
      return ctx.moveNumber;
    case 'ply':
      return ctx.ply;
    case 'eval_cp':
      return ctx.evalWhiteCp ?? 0;
    case 'self_eval_cp':
      return ctx.evalWhiteCp == null ? 0 : selfPersp(ctx.evalWhiteCp, ctx);
    case 'mate_in':
      return ctx.mateWhite ?? 0;
    default:
      throw new PredicateEvalError(`no gradient defined for '${fn}'`);
  }
}

/** Functions whose gradient can be improved by a single move (candidate generation). */
export const MOTIVATABLE = new Set([
  'material',
  'non_pawn_count',
  'piece_count',
  'promoted_count',
  'captured_value',
  'captures_count',
  'checks_count',
  'mated_by',
  'is_checkmate',
]);

/**
 * Partial credit (0..1) of a predicate on a context: how close the state is to
 * satisfying it. Fuzzy semantics over the boolean structure: AND = min of
 * conjuncts (all must hold), OR = max, NOT = 1−c. Transient boolean calls
 * (is_check, last_move_*) are neutral 0.5 when false so they don't zero out
 * progress driven by their siblings. Used by the steering layer as a progress
 * gradient and by the tracker as milestone partial credit.
 */
export function partialCredit(ast: Node, ctx: GameContext): number {
  if (evaluatePredicate(ast, ctx)) return 1;
  return Math.max(0, Math.min(1, fuzzyCredit(ast, ctx)));
}

const TRANSIENT_BOOLEANS = new Set([
  'is_check',
  'last_move_was_capture',
  'last_move_was_check',
  'last_move_was_promotion',
]);

function fuzzyCredit(n: Node, ctx: GameContext): number {
  switch (n.k) {
    case 'cmp':
      return cmpCredit(n, ctx);
    case 'and':
      return Math.min(fuzzyCredit(n.l, ctx), fuzzyCredit(n.r, ctx));
    case 'or':
      return Math.max(fuzzyCredit(n.l, ctx), fuzzyCredit(n.r, ctx));
    case 'not':
      return 1 - fuzzyCredit(n.e, ctx);
    case 'call': {
      // Boolean call as a (sub)expression.
      if (n.fn === 'is_checkmate' || n.fn === 'mated_by') {
        try {
          if (evalNode(n, ctx) === true) return 1;
        } catch {
          return 0;
        }
        return ctx.lastMove?.wasCheck ? 0.5 : 0;
      }
      if (TRANSIENT_BOOLEANS.has(n.fn)) {
        try {
          return evalNode(n, ctx) === true ? 1 : 0.5;
        } catch {
          return 0.5;
        }
      }
      try {
        return evalNode(n, ctx) === true ? 1 : 0;
      } catch {
        return 0;
      }
    }
    default:
      return 0;
  }
}

function cmpCredit(n: Extract<Node, { k: 'cmp' }>, ctx: GameContext): number {
  if (n.l.k !== 'call' || n.r.k !== 'num') {
    // string comparisons / non-call LHS: binary
    try {
      return evalNode(n, ctx) === true ? 1 : 0;
    } catch {
      return 0;
    }
  }
  const fn = (n.l as { fn: string }).fn;
  const def = FUNCTIONS[fn];
  if (def?.ret !== 'number') return 0;
  const sides: (string | undefined)[] = [];
  const pieces: (string | undefined)[] = [];
  def.args.forEach((spec, i) => {
    const a = (n.l as { args: Node[] }).args[i] as Node & { v?: string };
    if (spec.kind === 'side') sides.push(a.v);
    else pieces.push(a.v);
  });
  const target = (n.r as { v: number }).v;
  let g: number;
  try {
    g = gradientValue(fn, sides, pieces, ctx);
  } catch {
    return 0;
  }
  if (fn === 'promoted_count' && target > 0) {
    // monotone build-up: clamp(g / target)
    return Math.max(0, Math.min(1, g / target));
  }
  const range = Math.max(RANGES[fn] ?? 1000, Math.abs(target) || 1);
  const dist = Math.abs(g - target);
  switch (n.op) {
    case '==':
      return clamp01(1 - dist / range);
    case '!=':
      return dist > 0 ? 1 : 0;
    case '<':
      return g < target ? 1 : clamp01(1 - (g - target) / range);
    case '<=':
      return g <= target ? 1 : clamp01(1 - (g - target) / range);
    case '>':
      return g > target ? 1 : clamp01(1 - (target - g) / range);
    case '>=':
      return g >= target ? 1 : clamp01(1 - (target - g) / range);
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A comparison or boolean atom whose gradient can be improved by a move. */
export interface GradientAtom {
  fn: string;
  sides: (string | undefined)[];
  pieces: (string | undefined)[];
  op?: '==' | '!=' | '<=' | '>=' | '<' | '>';
  target?: number;
}

/** Extract motivating atoms from a predicate (drives candidate generation). */
export function extractGradientAtoms(ast: Node): GradientAtom[] {
  const out: GradientAtom[] = [];
  const visit = (n: Node): void => {
    switch (n.k) {
      case 'cmp': {
        if (n.l.k === 'call' && n.r.k === 'num') {
          const fn = n.l.fn;
          const def = FUNCTIONS[fn];
          if (def && def.ret === 'number' && MOTIVATABLE.has(fn)) {
            const { sides, pieces } = collectEnumArgs(n.l);
            out.push({ fn, sides, pieces, op: n.op, target: n.r.v });
          }
        }
        break;
      }
      case 'and':
      case 'or':
        visit(n.l);
        visit(n.r);
        break;
      case 'not':
        visit(n.e);
        break;
      case 'call': {
        if (MOTIVATABLE.has(n.fn) && FUNCTIONS[n.fn]?.ret === 'boolean') {
          const { sides, pieces } = collectEnumArgs(n);
          out.push({ fn: n.fn, sides, pieces });
        }
        break;
      }
      default:
        break;
    }
  };
  visit(ast);
  return out;
}

function collectEnumArgs(call: Extract<Node, { k: 'call' }>): {
  sides: (string | undefined)[];
  pieces: (string | undefined)[];
} {
  const sides: (string | undefined)[] = [];
  const pieces: (string | undefined)[] = [];
  const def = FUNCTIONS[call.fn]!;
  def.args.forEach((spec, i) => {
    const a = call.args[i] as Node & { v?: string };
    if (spec.kind === 'side') sides.push(a.v);
    else pieces.push(a.v);
  });
  return { sides, pieces };
}

/** Gradient value of an atom on a context (numeric for cmp atoms, 0/0.5/1 for boolean atoms). */
export function atomGradientValue(atom: GradientAtom, ctx: GameContext): number {
  if (!atom.op) {
    if (atom.fn === 'mated_by') {
      const side = resolveSide(atom.sides[0]!, ctx);
      const piece = atom.pieces[0] as PieceType;
      if (ctx.checkmate && ctx.winner === side && ctx.matedBy === piece) return 1;
      if (
        ctx.lastMove &&
        ctx.lastMove.color === side &&
        ctx.lastMove.wasCheck &&
        ctx.lastMove.piece === piece
      ) {
        return 0.5;
      }
      return 0;
    }
    if (atom.fn === 'is_checkmate') {
      if (ctx.checkmate) return 1;
      if (ctx.lastMove?.wasCheck) return 0.5;
      return 0;
    }
    return 0;
  }
  return gradientValue(atom.fn, atom.sides, atom.pieces, ctx);
}

/** How much a gradient change improves the atom (positive = progress). */
export function atomImprovement(atom: GradientAtom, gBefore: number, gAfter: number): number {
  if (!atom.op) return gAfter - gBefore;
  const t = atom.target ?? 0;
  switch (atom.op) {
    case '==':
      return Math.abs(gBefore - t) - Math.abs(gAfter - t);
    case '!=':
      return gBefore === gAfter ? 0 : gAfter !== t ? 1 : -1;
    case '<=':
    case '<':
      return gBefore - gAfter;
    case '>=':
    case '>':
      return gAfter - gBefore;
  }
}
