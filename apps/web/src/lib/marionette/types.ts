/** Shared client-side types mirroring the marionette-engine service payloads. */

export interface Bar {
  id: string;
  description: string;
  metric: string;
  elos?: number[];
  threshold: number;
  milestoneIds?: string[];
  expectedFail?: boolean;
  note?: string;
}

export interface CalibrationPoint {
  elo: number;
  n: number;
  orderedFull: number;
  terminalMet: number;
  wins: number;
  losses: number;
}

export interface Calibration {
  directiveId: string;
  target: number;
  metric: 'ordered_full' | 'terminal_met';
  points: CalibrationPoint[];
  crossingElo: number | null;
  suggestedElo: number;
  note: string;
  gamesPerCell: number;
}

export interface PlanMilestoneSpec {
  id: string;
  description: string;
  completion: string;
  infeasible?: string;
  tolerance: string;
  weight: number;
  moveBudget?: number;
}

export interface PlanInfo {
  summary: string;
  style: string;
  terminal: { kind: string; pattern?: string; priority: string };
  milestones: PlanMilestoneSpec[];
  hardConstraints: { id: string; description: string; predicate: string; afterMilestone?: string }[];
  fallback: string[];
  provider: string;
  model: string;
  compiledAt: string;
  fromCache: boolean;
}

export interface DirectiveInfo {
  id: string;
  directive: string;
  bars: Bar[];
  calibration: Calibration;
  plan: PlanInfo | null;
}

export interface Verdict {
  n: number;
  hits: number;
  rate: number;
  pass: boolean;
  detail: string;
  source: string;
}

export interface PanelBar {
  directiveId: string;
  barId: string;
  description: string;
  metric: string;
  threshold: number;
  elos?: number[];
  milestoneIds?: string[];
  expectedFail: boolean;
  note?: string;
  verdict: Verdict | null;
}

export interface SweepResponse {
  bars: PanelBar[];
  sweeps: { file: string; stamp: string; gamesPerCell: number; offline: boolean; elos: number[]; games: number }[];
}

export interface SteeringEntry {
  ply: number;
  san: string;
  chosenUci: string;
  chosenEvalSelfCp: number;
  chosenScore: number | null;
  chosenProgress: number;
  bestUci: string | null;
  bestSan: string | null;
  bestEvalSelfCp: number | null;
  evalLossCp: number | null;
  lambda: number | null;
  activeMilestoneId: string | null;
  activeMilestoneProgress: number | null;
}

export interface CandidateScore {
  uci: string;
  san: string;
  source: 'engine' | 'motivated';
  motive: string;
  evalSelfCp: number;
  deltaProgress: number;
  completes: boolean;
  excluded?: string;
  parts?: { progress: number; evalCost: number; bonus: number; total: number };
}

export interface ReportMilestone {
  id: string;
  description: string;
  completion: string;
  tolerance: string;
  weight: number;
  completed: boolean;
  completedAtPly?: number;
  bestPartial: number;
  droppedAtPly?: number;
  dropReason?: string;
  addedByReplan?: boolean;
  trueAtEnd?: boolean;
  endPartial?: number;
  conjuncts?: { src: string; partial: number }[];
}

export interface JudgeVerdict {
  looksTrying: number;
  natural: number;
  plausibleLoss: number;
  bully: number;
}

export interface GameReport {
  directive: string;
  selfColor: 'w' | 'b';
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  endReason: string;
  terminalMet: boolean;
  plies: number;
  moveNumber: number;
  milestones: ReportMilestone[];
  finalPositionTrue: string[];
  violations: { id: string; description: string; atPly: number }[];
  replans: { atPly: number; reason: string; provider: string; model: string }[];
  fallbackEngaged: string | null;
  acplSelf: number | null;
  steeredMoves: number;
  marionetteMoves: number;
  evalTrail: (number | null)[];
  snapshots: { matSelf: number; matOpp: number; checksSelf: number }[];
  steeringTrail?: SteeringEntry[];
  planFromCache: boolean;
  planProvider: string;
  planModel: string;
  opponentElo: number;
  opponentEmulated: boolean;
  steerDepth: number;
  steerMultiPV: number;
  elapsedMs: number;
  pgn: string;
  notes: string[];
}

export interface WrappedEvent {
  seq: number;
  at: number;
  event: { kind: string } & Record<string, unknown>;
  fenAfter?: string;
}

export interface HumanMilestoneSnapshot {
  id: string;
  description: string;
  completion: string;
  weight: number;
  status: 'completed' | 'active' | 'pending';
  partial: number;
  bestPartial: number;
  completedAtPly: number | null;
}

export interface HumanPlyEvent {
  ply: number;
  san: string;
  side: 'w' | 'b';
  fenAfter: string;
  moveNumber: number;
  inCheck: boolean;
  captured?: string;
  promotion?: string;
  milestones: HumanMilestoneSnapshot[];
  activeMilestoneId: string | null;
  gameOver: boolean;
  endReason?: string;
  result?: string;
}

export interface HumanReport extends GameReport {
  mode: 'human';
  directiveId: string;
  opponentEmulated: boolean;
  milestones: (ReportMilestone & { endPartial?: number; conjuncts?: { src: string; partial: number }[] })[];
  replans: [];
  planSummary: string;
  judge: null;
}

export interface HumanRecord {
  id: string;
  mode: 'human';
  directiveId: string;
  directive: string;
  elo: number;
  side: 'w' | 'b';
  status: 'active' | 'finished' | 'error';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  report?: HumanReport;
  fen: string;
  yourTurn: boolean;
  plies: number;
  events: HumanPlyEvent[];
  planSummary: string;
  planMilestones: PlanMilestoneSpec[];
  opponentEmulated: boolean;
  runningNow?: boolean;
}

export interface PuppetRecord {
  id: string;
  mode: 'puppeteer';
  directiveId: string;
  directive: string;
  elo: number;
  side: 'w' | 'b';
  seed: number;
  status: 'running' | 'finished' | 'error';
  startedAt: string;
  finishedAt?: string;
  report?: GameReport;
  judge?: JudgeVerdict;
  error?: string;
  events: WrappedEvent[];
  plan: PlanInfo | null;
  runningNow?: boolean;
}

export type GameRecord = PuppetRecord | HumanRecord;

export function isPuppetRecord(r: GameRecord): r is PuppetRecord {
  return r.mode === 'puppeteer';
}

export interface StartResponse {
  gameId: string;
  mode: 'puppeteer' | 'human';
  seed: number;
  side: 'w' | 'b';
  elo: number;
  record?: HumanRecord;
}
