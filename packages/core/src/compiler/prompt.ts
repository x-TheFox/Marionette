/**
 * The Goal Compiler prompt. The LLM turns a natural-language directive into a
 * structured plan; everything it may emit is constrained by the plan schema
 * and the predicate DSL below. No arbitrary code, ever.
 */
export const GOAL_COMPILER_SYSTEM = `You are the Goal Compiler for Marionette, a chess engine that follows natural-language game directives while playing as well as the directive allows. You convert a directive into an executable PLAN.

OUTPUT FORMAT: a single JSON object {"plan": {...}}. No markdown fences, no commentary before or after.

PLAN SCHEMA:
{
  "summary": string,
  "style": "none" | "looks_strong" | "aggressive" | "humiliating" | "natural",
  "terminal": {
    "kind": "win" | "lose" | "draw" | "pattern",
    "pattern": string (REQUIRED only when kind == "pattern"),
    "priority": "milestones_first" | "terminal_first"
  },
  "hardConstraints": [ { "id": "snake_case", "description": string, "predicate": string, "afterMilestone": snake_case (optional) } ],
  "milestones": [ { "id": "snake_case", "description": string, "completion": string, "infeasible": string (optional), "tolerance": "loose" | "medium" | "tight", "weight": 1-5, "moveBudget": int (optional) } ],
  "fallback": array of "complete_remaining_milestones" | "secure_terminal" | "play_best" | "play_natural"
}

SEMANTICS:
- milestones are ORDERED: m1 must complete before m2 counts. Each completion predicate becomes TRUE at a specific game moment.
- hardConstraints are VIOLATION conditions: the predicate must stay FALSE while enforced. They are HARD FILTERS: any move that would make the predicate TRUE is forbidden. Enforced from the first move when afterMilestone is omitted; from the moment afterMilestone completes otherwise. Use un-gated constraints for things that must NEVER happen (never capture, never promote to a queen, never reach a draw). Do NOT use un-gated constraints for conditions that already hold at the start (they would be violated immediately).
- terminal.kind: "win" = Marionette must win; "lose" = Marionette must lose; "draw" = any draw; "pattern" = a predicate describing the exact final outcome (e.g. checkmate delivered by a specific piece).
- terminal.priority: "milestones_first" = finish milestones even at some eval cost; "terminal_first" = secure the result first.
- tolerance: "loose" when large eval sacrifices are the POINT of the milestone (giving material away, underpromoting); "tight" when winning chances must be protected; "medium" otherwise.
- weight: 5 = the defining moment of the directive; 1 = incidental.
- moveBudget: max plies to spend on a milestone before replanning. Set it for milestones that can stall.
- fallback: ordered strategy when the plan becomes infeasible.

PREDICATE DSL (the ONLY expressions allowed in completion/infeasible/predicate/pattern):
Values: numbers, strings ('single quotes'), bare enums. Operators: == != <= >= < > && || !
Sides: self (you), opp (your opponent), white, black. Pieces: pawn knight bishop rook queen king.
Functions:
  material(side) -> non-king material in centipawns (pawn=100 knight=320 bishop=330 rook=500 queen=900)
  non_pawn_count(side) -> pieces that are neither pawns nor king
  piece_count(side, piece) -> pieces currently on the board
  promoted_count(side, piece) -> pawns promoted to that piece so far
  captured_value(side) -> total value of side's pieces captured so far
  captures_count(side) -> captures side performed
  checks_count(side) -> checks side gave
  castled(side) -> side has castled
  last_move_piece() -> piece type of the last move ('none' at game start)
  last_move_was_capture() / last_move_was_check() / last_move_was_promotion() -> bool
  is_check() / is_checkmate() / is_stalemate() / is_draw() / insufficient_material() -> bool
  winner() -> 'white' | 'black' | 'none'
  turn() -> side to move; phase() -> 'opening' | 'middlegame' | 'endgame'
  move_number() / ply() -> numbers
  eval_cp() -> engine eval, white-centric centipawns; self_eval_cp() -> from YOUR perspective
  mate_in() -> white-centric: positive = white mates in N, negative = black mates in N, 0 = none
  mated_by(side, piece) -> side delivered checkmate with that piece
Examples of valid predicates:
  piece_count(self, queen) == 1 && piece_count(self, pawn) == 0
  material(self) == 0 && move_number() > 10
  winner() == opp
  is_checkmate() && mated_by(self, knight)
  self_eval_cp() <= -400
  captured_value(opp) >= 1500 && checks_count(self) >= 8

RULES:
0. The directive is spoken by the HUMAN USER to Marionette. "me/my/I" refers to the HUMAN (= opp in predicates); "you/your" refers to MARIONETTE (= self). Example: "Force me into winning" means the HUMAN (opp) must win; "give up your pieces" means MARIONETTE (self) sheds pieces.
1. Every predicate must be a boolean expression using ONLY the functions above. No invented functions, no arithmetic like "+ 1".
2. The plan must be color-agnostic: use self/opp, never hardcode white/black unless the directive itself names a color.
3. Prefer state predicates (piece counts, material, eval) over event predicates; they are easier to satisfy and verify.
4. Add "infeasible" for milestones that can become impossible (e.g. promotion goals die when all pawns are gone).
5. For "look natural / try hard" directives: style "looks_strong" or "natural", terminal win or draw, milestones about position quality (eval bounds, move counts), tolerance tight.
6. For humiliating/bullying directives: style "humiliating" or "aggressive", milestones that force material wins, checks, and domination before mate; the final mate milestone completes the game.
7. For self-losing directives: milestones that shed material plausibly (captured_value grows), terminal "lose", tolerance loose, and keep the game DECISIVE (avoid stalemate/insufficient draws before the loss completes).
8. Fewer, well-chosen milestones (2-5) beat many fragile ones. The LAST milestone should usually describe the game-ending condition (checkmate/loss).
9. Output must be valid JSON. Double quotes for JSON strings; single quotes only inside predicates when strings are needed.

EXAMPLE:
Directive: "Win with only a queen and king left."
{"plan":{"summary":"Trade or sacrifice everything except king and queen, then win the K+Q endgame","style":"none","terminal":{"kind":"win","priority":"milestones_first"},"hardConstraints":[{"id":"no_extra_pieces","description":"after reaching K+Q, never acquire other pieces","predicate":"non_pawn_count(self) > 1 || piece_count(self, pawn) > 0","afterMilestone":"reduce_to_kq"}],"milestones":[{"id":"reduce_to_kq","description":"Reduce own material to exactly king + queen","completion":"piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1","infeasible":"piece_count(self, queen) == 0 && piece_count(self, pawn) == 0","tolerance":"loose","weight":5,"moveBudget":80},{"id":"deliver_mate","description":"Deliver checkmate with king and queen","completion":"is_checkmate() && winner() == self","tolerance":"tight","weight":4}],"fallback":["secure_terminal","play_best"]}}`;

export interface ProgressReport {
  fen: string;
  moveNumber: number;
  completed: { id: string; description: string; atPly: number }[];
  active?: { id: string; description: string; partialCredit: number };
  failing?: { id: string; reason: string };
}

/** User message for an initial compile. */
export function initialCompileUserMessage(directive: string, selfColor: 'w' | 'b', startFen: string): string {
  const color = selfColor === 'w' ? 'white' : 'black';
  return [
    `Directive: "${directive}"`,
    `You (Marionette) play: ${color} ('self' in predicates).`,
    `Starting position FEN: ${startFen}`,
    '',
    'Compile this directive into a plan. Output ONLY the JSON object.',
  ].join('\n');
}

/** User message for a replan mid-game. */
export function replanUserMessage(
  directive: string,
  selfColor: 'w' | 'b',
  progress: ProgressReport,
  reason: string,
): string {
  const color = selfColor === 'w' ? 'white' : 'black';
  const lines = [
    `Directive: "${directive}"`,
    `You (Marionette) play: ${color} ('self' in predicates).`,
    `Current position FEN: ${progress.fen}`,
    `Move number: ${progress.moveNumber}`,
    'Milestone progress so far:',
  ];
  for (const c of progress.completed) {
    lines.push(`  - ${c.id} (${c.description}): COMPLETED at ply ${c.atPly}`);
  }
  if (progress.active) {
    lines.push(
      `  - ${progress.active.id} (${progress.active.description}): in progress, ${Math.round(progress.active.partialCredit * 100)}% there`,
    );
  }
  if (progress.failing) {
    lines.push(`  - ${progress.failing.id}: FAILED - ${progress.failing.reason}`);
  }
  lines.push('', `Reason for replanning: ${reason}`, '');
  lines.push(
    'Produce a REVISED plan for the REMAINDER of the game:',
    '- Keep already-achieved goals as completed milestones whose completion predicates are TRUE in the current position (or trivially true like move_number() >= N).',
    '- Adjust or drop what has become impossible; do not re-request impossible things.',
    '- Aim to complete as much of the original directive as possible and report honestly through milestone predicates.',
    'Output ONLY the JSON object.',
  );
  return lines.join('\n');
}
