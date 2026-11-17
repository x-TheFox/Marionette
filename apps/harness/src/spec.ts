/**
 * The pre-declared directive set and success bars (docs/PLAN.md, test spec v1).
 *
 * RED LINE: these thresholds are FROZEN. The harness reports actual rates
 * against them and never tunes them to fit results. D6's full-completion bar
 * is marked expectedFail: it is a KNOWN FAILING regression (Phase 1 close-out:
 * reduce_to_kq reaches only partial credit) and must never be reported as
 * passed until steering actually achieves it.
 *
 * HELD-OUT SET (H1..H5, added 2026-11-17 BEFORE their first run): directives
 * the Goal Compiler prompt and steering were never tuned on. Their bars were
 * declared before running and are frozen for this iteration's sweep:
 *   - loss-rate bars mirror the frozen D2 loss bar (0.7) for the same
 *     operationalization family (directed losing);
 *   - full-completion bars for shed-then-win directives mirror D6's 0.4 /
 *     D1's 0.3 scaled by how much material must be shed and how exotic the
 *     mating request is (H1 minors-only is the hardest -> 0.15);
 *   - win-rate bars mirror D5's 0.6 when the directive only constrains HOW
 *     Marionette wins, 0.5 when it also demands a sequencing feat.
 * Held-out results are reported but cannot move any D1..D6 threshold.
 */

export type DirectiveId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5';

export type BarMetric =
  | 'full_completion' // all milestones completed AND terminal met
  | 'partial_milestones' // all milestones matching every substring completed
  | 'win_rate' // Marionette won the game
  | 'loss_rate' // Marionette lost the game (opponent won)
  | 'judge_looks_trying'
  | 'judge_natural'
  | 'judge_plausible_loss'
  | 'judge_bully'
  | 'acpl_mean_max'; // mean ACPL across games must stay <= threshold

export interface Bar {
  id: string;
  description: string;
  metric: BarMetric;
  /** ELOs the bar applies to; omit for all. */
  elos?: number[];
  threshold: number;
  /** Substrings a milestone id must contain (ALL must match some milestone, each completed). */
  milestoneIds?: string[];
  /** Known-failing regression: reported as FAIL (expected), never as passed. */
  expectedFail?: boolean;
  note?: string;
}

export interface DirectiveSpec {
  id: DirectiveId;
  directive: string;
  bars: Bar[];
}

export const ELOS = [800, 1200, 1600, 2000] as const;
export const ELOS_LE_1600 = [800, 1200, 1600];

export const DIRECTIVES: DirectiveSpec[] = [
  {
    id: 'D1',
    directive:
      'Win by giving up every piece except pawns, promote all of them to knights, then checkmate with a knight.',
    bars: [
      {
        id: 'd1-full',
        description: 'full completion (pawns-only, all-knight promotions, knight mate) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.3,
      },
      {
        id: 'd1-partial',
        description: '"pawns + promotions" partial (no non-pawn pieces, all pawns promoted) vs <=1600',
        metric: 'partial_milestones',
        elos: ELOS_LE_1600,
        milestoneIds: ['pawn', 'promot'],
        threshold: 0.8,
      },
    ],
  },
  {
    id: 'D2',
    directive: 'Give up all your pieces and lose.',
    bars: [
      {
        id: 'd2-loss',
        description: 'losses vs all ELOs',
        metric: 'loss_rate',
        threshold: 0.7,
      },
      {
        id: 'd2-plausible',
        description: 'judge: loss looks plausible (v1 heuristic >= 0.6)',
        metric: 'judge_plausible_loss',
        threshold: 0.6,
        note: 'v1 operationalization of "game looks plausible (judge)"',
      },
    ],
  },
  {
    id: 'D3',
    directive: "Make it look like you're trying hard.",
    bars: [
      {
        id: 'd3-trying',
        description: 'judge: looks like trying (>= 0.75)',
        metric: 'judge_looks_trying',
        threshold: 0.75,
      },
      {
        id: 'd3-acpl',
        description: 'mean ACPL <= 100 (v1 band vs honest depth-14 engine)',
        metric: 'acpl_mean_max',
        threshold: 100,
        note: 'full baseline-vs-honest-engine band comparison deferred to full sweep',
      },
    ],
  },
  {
    id: 'D4',
    directive: 'Force me into winning.',
    bars: [
      {
        id: 'd4-oppwin',
        description: 'opponent (the human) wins',
        metric: 'loss_rate',
        threshold: 0.7,
      },
      {
        id: 'd4-natural',
        description: 'judge: soft moves look natural (>= 0.7)',
        metric: 'judge_natural',
        threshold: 0.7,
      },
    ],
  },
  {
    id: 'D5',
    directive: 'Bully me.',
    bars: [
      {
        id: 'd5-win',
        description: 'wins vs <=1600',
        metric: 'win_rate',
        elos: ELOS_LE_1600,
        threshold: 0.6,
      },
      {
        id: 'd5-bully',
        description: 'bully-style heuristic score (>= 0.5, v1)',
        metric: 'judge_bully',
        threshold: 0.5,
        note: 'v1 operationalization of "bully-style heuristic score >= threshold"',
      },
    ],
  },
  {
    id: 'D6',
    directive: 'Win with only a queen and king left.',
    bars: [
      {
        id: 'd6-full',
        description: 'full completion (K+Q material, queen mate, win) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.4,
        expectedFail: true,
        note: 'KNOWN FAILING regression kept visible on purpose (Phase 1 close-out: reduce_to_kq partial only). Do not mark passed.',
      },
    ],
  },
  // --- held-out set: never tuned on; bars declared before first run -------
  {
    id: 'H1',
    directive: 'Win using only knights and bishops.',
    bars: [
      {
        id: 'h1-full',
        description: 'full completion (win with minors only) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.15,
        note: 'hardest held-out ask: shed Q+R+pawns AND mate with knights/bishops',
      },
      {
        id: 'h1-win',
        description: 'wins vs <=1600',
        metric: 'win_rate',
        elos: ELOS_LE_1600,
        threshold: 0.5,
      },
    ],
  },
  {
    id: 'H2',
    directive: "Capture the opponent's queen before move 15, then win.",
    bars: [
      {
        id: 'h2-full',
        description: 'full completion (queen captured by ply 30 in order, then win) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.3,
      },
      {
        id: 'h2-win',
        description: 'wins vs <=1600',
        metric: 'win_rate',
        elos: ELOS_LE_1600,
        threshold: 0.5,
      },
    ],
  },
  {
    id: 'H3',
    directive: 'Promote a pawn to a queen, then lose the game.',
    bars: [
      {
        id: 'h3-full',
        description: 'full completion (queen promotion, then ordered loss) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.3,
      },
      {
        id: 'h3-loss',
        description: 'losses vs all ELOs',
        metric: 'loss_rate',
        threshold: 0.7,
        note: 'mirrors frozen D2 loss bar (same directed-losing family)',
      },
    ],
  },
  {
    id: 'H4',
    directive: 'Checkmate your opponent using a rook.',
    bars: [
      {
        id: 'h4-full',
        description: 'full completion (rook mate) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.4,
      },
      {
        id: 'h4-win',
        description: 'wins vs <=1600',
        metric: 'win_rate',
        elos: ELOS_LE_1600,
        threshold: 0.6,
        note: 'mirrors frozen D5 win bar (directive constrains HOW Marionette wins)',
      },
    ],
  },
  {
    id: 'H5',
    directive: 'Lose, but capture at least three of my pieces first.',
    bars: [
      {
        id: 'h5-full',
        description: 'full completion (3+ captures, then ordered loss) vs <=1600',
        metric: 'full_completion',
        elos: ELOS_LE_1600,
        threshold: 0.3,
      },
      {
        id: 'h5-loss',
        description: 'losses vs all ELOs',
        metric: 'loss_rate',
        threshold: 0.7,
        note: 'mirrors frozen D2 loss bar (same directed-losing family)',
      },
    ],
  },
];

export function directiveById(id: string): DirectiveSpec | undefined {
  return DIRECTIVES.find((d) => d.id === id);
}
