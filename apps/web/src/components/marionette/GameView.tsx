'use client';

/**
 * Live game view: streams puppeteer games over socket.io (board, milestone
 * panel, "why this move", eval bar) and drives the human challenge (F7) with
 * honest milestone scoring after every ply. Game end shows the honest overlay
 * with the frozen bar verdict for the directive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { Copy, Flag, History, Keyboard, RotateCcw } from 'lucide-react';
import { api } from '@/lib/marionette/api';
import { sound } from '@/lib/marionette/sound';
import { getRealtimeSocket } from '@/lib/marionette/socket';
import { generateCoach } from '@/lib/marionette/commentary';
import { isPuppetRecord, type CandidateScore, type GameRecord, type GameReport, type HumanPlyEvent, type HumanRecord, type PlanInfo, type SteeringEntry, type SweepResponse, type WrappedEvent } from '@/lib/marionette/types';
import BoardPanel, { findKingSquare } from './BoardPanel';
import EvalGraph, { markersFromReport } from './EvalGraph';
import HonestPanel from './HonestPanel';
import MilestonePanel, { PlanHeader, SteerCard, type MilestoneDisplay } from './MilestonePanel';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function milestonesFromPlan(planMilestones: { id: string; description: string; completion: string; weight: number }[]): MilestoneDisplay[] {
  const out = planMilestones.map((m) => ({
    id: m.id,
    description: m.description,
    completion: m.completion,
    weight: m.weight,
    status: 'pending' as const,
    partial: 0,
    completedAtPly: null,
  }));
  if (out.length > 0) out[0]!.status = 'active';
  return out;
}

/** Ordered statuses: completed stays, first non-completed = active, rest pending. */
function normalizeStatuses(list: MilestoneDisplay[]): MilestoneDisplay[] {
  let activeAssigned = false;
  return list.map((m) => {
    if (m.status === 'completed' || m.status === 'dropped') return m;
    if (!activeAssigned) {
      activeAssigned = true;
      return { ...m, status: 'active' as const };
    }
    return { ...m, status: 'pending' as const };
  });
}

function milestonesFromReport(report: GameReport): MilestoneDisplay[] {
  return report.milestones.map((m) => ({
    id: m.id,
    description: m.description,
    completion: m.completion,
    weight: m.weight,
    status: m.completed ? 'completed' : m.droppedAtPly != null ? 'dropped' : 'pending',
    partial: m.completed ? 1 : m.bestPartial,
    completedAtPly: m.completedAtPly ?? null,
    droppedAtPly: m.droppedAtPly ?? null,
    dropReason: m.dropReason ?? null,
    addedByReplan: m.addedByReplan,
    trueAtEnd: m.trueAtEnd,
  }));
}

function milestonesFromSnapshots(snaps: HumanPlyEvent['milestones']): MilestoneDisplay[] {
  return snaps.map((m) => ({
    id: m.id,
    description: m.description,
    completion: m.completion,
    weight: m.weight,
    status: m.status === 'completed' ? 'completed' : m.status === 'active' ? 'active' : 'pending',
    partial: m.status === 'completed' ? 1 : m.partial,
    completedAtPly: m.completedAtPly,
  }));
}

interface LogEntry {
  seq: number;
  kind: string;
  text: string;
}

export default function GameView({ gameId, onNavigate }: { gameId: string; onNavigate: (to: string) => void }) {
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // live board state
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [checkSquare, setCheckSquare] = useState<string | null>(null);
  const [flashSquares, setFlashSquares] = useState<string[]>([]);
  const [milestones, setMilestones] = useState<MilestoneDisplay[]>([]);
  const [replans, setReplans] = useState<{ atPly: number; reason: string; provider: string }[]>([]);
  const [violations, setViolations] = useState<{ id: string; description: string; atPly: number }[]>([]);
  const [lastSteer, setLastSteer] = useState<{ entry: SteeringEntry; candidates: CandidateScore[] } | null>(null);
  const [evalSelfCp, setEvalSelfCp] = useState<number | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [report, setReport] = useState<GameReport | null>(null);
  const [sweep, setSweep] = useState<SweepResponse | null>(null);

  // human mode state
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [yourTurn, setYourTurn] = useState(false);

  const puppetBoardRef = useRef<Chess>(new Chess());
  const humanBoardRef = useRef<Chess>(new Chess());

  // ---- sound helper for a played move --------------------------------------
  const playMoveSounds = useCallback((opts: { captured?: string; promotion?: string; check: boolean }) => {
    if (opts.promotion) sound.play('promotion');
    else if (opts.captured) sound.play('capture');
    else sound.play('move');
    if (opts.check) window.setTimeout(() => sound.play('check'), 130);
  }, []);

  const flash = useCallback((squares: string[]) => {
    setFlashSquares(squares);
    window.setTimeout(() => setFlashSquares([]), 2600);
  }, []);

  const pushLog = useCallback((seq: number, kind: string, text: string) => {
    setLog((prev) => [...prev.slice(-150), { seq, kind, text }]);
  }, []);

  // ---- puppeteer event processing -------------------------------------------
  const processPuppetEvent = useCallback(
    (wrapped: WrappedEvent, firstLoad: boolean) => {
      const e = wrapped.event;
      switch (e.kind) {
        case 'move': {
          const san = String(e.san ?? '');
          let verbose: { from: string; to: string; captured?: string; promotion?: string } | null = null;
          try {
            verbose = puppetBoardRef.current.move(san) as unknown as { from: string; to: string; captured?: string; promotion?: string };
          } catch {
            try {
              puppetBoardRef.current.move(san, { strict: false });
              const hist = puppetBoardRef.current.history({ verbose: true }) as unknown as { from: string; to: string; captured?: string; promotion?: string }[];
              verbose = hist[hist.length - 1] ?? null;
            } catch {
              verbose = null;
            }
          }
          const newFen = puppetBoardRef.current.fen();
          setFen(newFen);
          if (verbose) setLastMove({ from: verbose.from, to: verbose.to });
          const inCheck = puppetBoardRef.current.isCheck();
          setCheckSquare(inCheck ? findKingSquare(newFen, puppetBoardRef.current.turn()) : null);
          if (!firstLoad) playMoveSounds({ captured: verbose?.captured, promotion: verbose?.promotion, check: inCheck });
          pushLog(wrapped.seq, 'move', `${e.side === 'w' ? 'White' : 'Black'} ${san} (${String(e.source ?? '')})`);
          break;
        }
        case 'steer': {
          const entry = e.entry as SteeringEntry;
          const candidates = (e.candidates ?? []) as CandidateScore[];
          setLastSteer({ entry, candidates });
          setEvalSelfCp(entry.chosenEvalSelfCp);
          if (entry.activeMilestoneId) {
            const progress = entry.activeMilestoneProgress ?? 0;
            const msId = entry.activeMilestoneId;
            setMilestones((prev) =>
              normalizeStatuses(prev.map((m) => (m.id === msId && m.status !== 'completed' ? { ...m, partial: Math.max(m.partial, progress) } : m))),
            );
          }
          break;
        }
        case 'milestone': {
          const id = String(e.id ?? '');
          const atPly = Number(e.atPly ?? 0);
          setMilestones((prev) =>
            normalizeStatuses(
              prev.map((m) => (m.id === id ? { ...m, status: 'completed' as const, partial: 1, completedAtPly: atPly } : m)),
            ),
          );
          sound.play('milestone');
          const hist = puppetBoardRef.current.history({ verbose: true }) as unknown as { from: string; to: string }[];
          const last = hist[hist.length - 1];
          if (last) flash([last.from, last.to]);
          toast({ title: `Milestone completed: ${id}`, description: String(e.description ?? ''), duration: 4000 });
          pushLog(wrapped.seq, 'milestone', `milestone ${id} completed at ply ${atPly}`);
          break;
        }
        case 'infeasible': {
          pushLog(wrapped.seq, 'infeasible', `milestone ${String(e.id ?? '')} infeasible: ${String(e.reason ?? '')}`);
          toast({ title: `Milestone infeasible: ${String(e.id ?? '')}`, description: String(e.reason ?? ''), variant: 'destructive', duration: 5000 });
          break;
        }
        case 'replan': {
          const rp = { atPly: Number(e.atPly ?? 0), reason: String(e.reason ?? ''), provider: String(e.provider ?? '') };
          setReplans((prev) => (prev.some((x) => x.atPly === rp.atPly && x.reason === rp.reason) ? prev : [...prev, rp]));
          toast({ title: `Replan at ply ${rp.atPly}`, description: rp.reason, duration: 5000 });
          pushLog(wrapped.seq, 'replan', rp.reason);
          break;
        }
        case 'violation': {
          const v = { id: String(e.id ?? ''), description: String(e.description ?? ''), atPly: Number(e.atPly ?? 0) };
          setViolations((prev) => (prev.some((x) => x.id === v.id) ? prev : [...prev, v]));
          pushLog(wrapped.seq, 'violation', `constraint ${v.id} violated: ${v.description}`);
          break;
        }
        case 'fallback': {
          pushLog(wrapped.seq, 'fallback', `fallback engaged: ${String(e.action ?? '')} at ply ${String(e.atPly ?? '')}`);
          break;
        }
        case 'info': {
          pushLog(wrapped.seq, 'info', String(e.message ?? ''));
          break;
        }
        case 'end': {
          pushLog(wrapped.seq, 'end', `game over: ${String(e.result ?? '')} (${String(e.reason ?? '')})`);
          break;
        }
        default:
          break;
      }
    },
    [flash, playMoveSounds, pushLog],
  );

  const applyPuppetReport = useCallback((r: GameReport) => {
    setReport(r);
    // Mark the game finished so the end overlay renders (status lives on the
    // record loaded before the report arrived).
    setRecord((prev) => (prev ? { ...prev, status: 'finished', finishedAt: prev.finishedAt ?? new Date().toISOString(), report: r } : prev));
    setMilestones(milestonesFromReport(r));
    setReplans(r.replans);
    setViolations(r.violations);
    const trail = r.steeringTrail ?? [];
    if (trail.length > 0) setLastSteer({ entry: trail[trail.length - 1]!, candidates: [] });
    const lastEval = [...r.evalTrail].reverse().find((v) => v != null);
    if (lastEval != null) setEvalSelfCp(lastEval);
    const marionetteWon = (r.selfColor === 'w' && r.result === '1-0') || (r.selfColor === 'b' && r.result === '0-1');
    sound.play(marionetteWon ? 'victory' : 'defeat');
  }, []);

  // ---- human event application ----------------------------------------------
  const applyHumanEvent = useCallback(
    (ev: HumanPlyEvent) => {
      let verbose: { from: string; to: string } | null = null;
      try {
        verbose = humanBoardRef.current.move(ev.san) as unknown as { from: string; to: string };
      } catch {
        verbose = null;
      }
      setFen(ev.fenAfter);
      if (verbose) setLastMove({ from: verbose.from, to: verbose.to });
      setCheckSquare(ev.inCheck ? findKingSquare(ev.fenAfter, ev.side === 'w' ? 'b' : 'w') : null);
      setMilestones(milestonesFromSnapshots(ev.milestones));
      playMoveSounds({ captured: ev.captured, promotion: ev.promotion, check: ev.inCheck });
      if (ev.gameOver && ev.endReason) {
        pushLog(ev.ply + 1, 'end', `game over: ${ev.result ?? ''} (${ev.endReason})`);
      }
    },
    [playMoveSounds, pushLog],
  );

  // ---- initial load + socket subscription -----------------------------------
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    const socket = getRealtimeSocket();

    (async () => {
      try {
        const rec = await api.game(gameId);
        if (cancelled) return;
        setRecord(rec);
        if (isPuppetRecord(rec)) {
          setMilestones(rec.plan ? milestonesFromPlan(rec.plan.milestones) : []);
          for (const wrapped of rec.events) {
            processPuppetEvent(wrapped, true);
          }
          if (rec.report) applyPuppetReport(rec.report);
          if (rec.status === 'error' && rec.error) setLoadError(rec.error);
          api
            .sweep()
            .then((s) => {
              if (!cancelled) setSweep(s);
            })
            .catch(() => undefined);

          const onEvent = (msg: { gameId: string } & WrappedEvent) => {
            if (msg.gameId !== gameId) return;
            processPuppetEvent(msg, false);
          };
          const onOver = (msg: { gameId: string; report: GameReport }) => {
            if (msg.gameId !== gameId) return;
            applyPuppetReport(msg.report);
          };
          const onError = (msg: { gameId: string; message: string }) => {
            if (msg.gameId !== gameId) return;
            setLoadError(msg.message);
          };
          socket.emit('join', { gameId });
          socket.on('game-event', onEvent);
          socket.on('game-over', onOver);
          socket.on('game-error', onError);
          detach = () => {
            socket.off('game-event', onEvent);
            socket.off('game-over', onOver);
            socket.off('game-error', onError);
          };
        } else {
          // human mode: replay stored plies into the local board
          const human = rec as HumanRecord;
          for (const ev of human.events) {
            try {
              humanBoardRef.current.move(ev.san);
            } catch {
              break;
            }
          }
          const last = human.events[human.events.length - 1];
          if (last) {
            setFen(last.fenAfter);
            setCheckSquare(last.inCheck ? findKingSquare(last.fenAfter, last.side === 'w' ? 'b' : 'w') : null);
            setMilestones(milestonesFromSnapshots(last.milestones));
          } else if (human.planMilestones.length > 0) {
            // No plies yet: show the plan's milestones upfront (all pending).
            setMilestones(milestonesFromPlan(human.planMilestones));
          }
          setYourTurn(human.status === 'active' && human.yourTurn);
          if (human.report) setReport(human.report);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [gameId, processPuppetEvent, applyPuppetReport]);

  // ---- human mode socket (redundant with REST response, catches other tabs) --
  const humanRecord = record && record.mode === 'human' ? (record as HumanRecord) : null;

  useEffect(() => {
    if (!humanRecord) return;
    const socket = getRealtimeSocket();
    const onHumanEvent = (msg: { gameId: string; event: HumanPlyEvent }) => {
      if (msg.gameId !== gameId) return;
      applyHumanEvent(msg.event);
    };
    const onHumanOver = (msg: { gameId: string; report: GameReport }) => {
      if (msg.gameId !== gameId) return;
      setRecord((prev) => (prev ? { ...prev, status: 'finished', finishedAt: prev.finishedAt ?? new Date().toISOString(), report: msg.report } : prev));
      setReport(msg.report);
      const won = (msg.report.selfColor === 'w' && msg.report.result === '1-0') || (msg.report.selfColor === 'b' && msg.report.result === '0-1');
      sound.play(won ? 'victory' : 'defeat');
    };
    socket.emit('join', { gameId });
    socket.on('human-event', onHumanEvent);
    socket.on('human-over', onHumanOver);
    return () => {
      socket.off('human-event', onHumanEvent);
      socket.off('human-over', onHumanOver);
    };
  }, [gameId, humanRecord, applyHumanEvent]);

  const makeHumanMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      if (!humanRecord) return;
      try {
        const out = await api.humanMove(gameId, from, to, promotion);
        for (const ev of out.events) applyHumanEvent(ev);
        setYourTurn(out.record.status === 'active' && out.record.yourTurn);
        if (out.record.status === 'finished' && out.record.report) {
          setReport(out.record.report);
          const won = (out.record.report.selfColor === 'w' && out.record.report.result === '1-0') || (out.record.report.selfColor === 'b' && out.record.report.result === '0-1');
          sound.play(won ? 'victory' : 'defeat');
        }
      } catch (err) {
        sound.play('illegal');
        toast({ title: 'Illegal move', description: err instanceof Error ? err.message : String(err), variant: 'destructive', duration: 2500 });
      }
    },
    [applyHumanEvent, gameId, humanRecord],
  );

  const onPieceDrop = useCallback(
    (from: string, to: string): boolean => {
      if (!humanRecord || humanRecord.status !== 'active' || !yourTurn) return false;
      const probe = new Chess(humanBoardRef.current.fen());
      const piece = probe.get(from as never) as { type: string; color: string } | undefined;
      const isPawnToLast = !!piece && piece.type === 'p' && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
      if (isPawnToLast) {
        setPendingPromotion({ from, to });
        return false;
      }
      void makeHumanMove(from, to);
      return true;
    },
    [humanRecord, makeHumanMove, yourTurn],
  );

  const resign = useCallback(async () => {
    if (!humanRecord) return;
    try {
      const out = await api.humanResign(gameId);
      if (out.record.report) {
        const rep = out.record.report;
        setRecord((prev) => (prev ? { ...prev, status: 'finished', finishedAt: prev.finishedAt ?? new Date().toISOString(), report: rep } : prev));
        setReport(rep);
        sound.play('defeat');
      }
    } catch (err) {
      toast({ title: 'Cannot resign', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  }, [gameId, humanRecord]);

  // ---- render ---------------------------------------------------------------
  if (loadError && !record) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="p-6 text-center">
          <p className="font-semibold text-rose-300">Game could not load</p>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-4" onClick={() => onNavigate('/')}>
            Back to lobby
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!record) {
    return <div className="py-24 text-center text-muted-foreground">Loading game...</div>;
  }

  const puppetRec = isPuppetRecord(record) ? record : null;
  const running = record.status === 'running' || (record.mode === 'human' && record.status === 'active');
  const orientation: 'white' | 'black' = record.side === 'b' ? 'black' : 'white';
  const done = record.status === 'finished' && !!report;
  const marionetteWon = report ? (report.selfColor === 'w' && report.result === '1-0') || (report.selfColor === 'b' && report.result === '0-1') : false;
  const drawResult = report?.result === '1/2-1/2' || report?.result === '*';

  const planInfo: PlanInfo | null = puppetRec?.plan ?? (humanRecord ? ({
    summary: humanRecord.planSummary,
    style: 'none',
    terminal: { kind: '-', priority: 'milestones_first' },
    milestones: humanRecord.planMilestones,
    hardConstraints: [],
    fallback: [],
    provider: 'cache',
    model: 'offline',
    compiledAt: humanRecord.startedAt,
    fromCache: true,
  }) : null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* Board column */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {record.directiveId}
          </Badge>
          <span className="text-sm font-medium">&ldquo;{record.directive}&rdquo;</span>
          <Badge variant="outline" className="text-[10px]">
            vs Stockfish {record.elo} {record.elo < 1320 ? '(emulated below 1320)' : '(native)'}
          </Badge>
          {puppetRec && (
            <Badge variant="outline" className="text-[10px]">
              seed {puppetRec.seed}
            </Badge>
          )}
          {running && (
            <Badge className="animate-pulse border border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-300">
              {record.mode === 'human' ? 'your move' : 'steering...'}
            </Badge>
          )}
          {done && (
            <Badge className={`border text-[10px] ${marionetteWon ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-rose-500/40 bg-rose-500/15 text-rose-300'}`}>
              {report!.result} &middot; {report!.endReason}
            </Badge>
          )}
        </div>

        <div className="relative">
          <BoardPanel
            fen={fen}
            orientation={orientation}
            highlights={{ lastMove, checkSquare, flashSquares }}
            beamActive={record.mode === 'puppeteer' && running}
            allowDrag={record.mode === 'human' && yourTurn && !done}
            onPieceDrop={record.mode === 'human' ? onPieceDrop : undefined}
            evalSelfCp={evalSelfCp}
            boardLabel="Marionette game board"
          />
          {pendingPromotion && (
            <div className="absolute inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
              <span className="text-xs text-muted-foreground">Promote to:</span>
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  className="min-h-9 min-w-9"
                  onClick={() => {
                    const pp = pendingPromotion;
                    setPendingPromotion(null);
                    void makeHumanMove(pp.from, pp.to, p);
                  }}
                >
                  {p.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
          {done && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 p-4 backdrop-blur-sm">
              <Card className="w-full max-w-md">
                <CardContent className="space-y-3 p-5">
                  <div className="text-center">
                    <p className="text-lg font-bold">{marionetteWon ? 'Marionette won' : drawResult ? 'Draw / unfinished' : 'Marionette lost'}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {report!.result} after {Math.ceil(report!.plies / 2)} moves ({report!.endReason}) &middot; terminal{' '}
                      <span className={report!.terminalMet ? 'font-bold text-emerald-300' : 'font-bold text-rose-300'}>
                        {report!.terminalMet ? 'MET' : 'NOT MET'}
                      </span>
                      {!report!.terminalMet && ' — the directive was not fully achieved'}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" className="min-h-9" onClick={() => onNavigate(`/?replay=${gameId}`)}>
                      <History className="mr-1 h-4 w-4" /> Replay &amp; scrubber
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-9"
                      onClick={() => {
                        const url = `${window.location.origin}/?replay=${gameId}`;
                        void navigator.clipboard
                          ?.writeText(url)
                          .then(() => toast({ title: 'Share link copied', description: url }))
                          .catch(() => toast({ title: 'Share link', description: url }));
                      }}
                    >
                      <Copy className="mr-1 h-4 w-4" /> Copy share link
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-9" onClick={() => onNavigate('/')}>
                      <RotateCcw className="mr-1 h-4 w-4" /> Lobby
                    </Button>
                  </div>
                  {sweep && (
                    <details className="rounded-lg border border-border/50 p-3">
                      <summary className="cursor-pointer text-xs font-semibold">Honest benchmark panel for {record.directiveId}</summary>
                      <div className="mt-2">
                        <HonestPanel sweep={sweep} directiveFilter={record.directiveId} />
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Human helper bar */}
        {record.mode === 'human' && running && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
            <Keyboard className="h-4 w-4 text-primary" />
            <span>{yourTurn ? 'You are playing Marionette\u2019s side — drag a piece.' : 'Opponent is thinking...'}</span>
            <Button size="sm" variant="outline" className="ml-auto min-h-9" onClick={resign}>
              <Flag className="mr-1 h-3.5 w-3.5" /> Resign
            </Button>
          </div>
        )}

        {/* Eval graph appears once a report exists (human reports have no evalTrail) */}
        {report && (report.evalTrail?.length ?? 0) > 0 && (
          <EvalGraph
            evalTrail={report.evalTrail}
            selfColor={report.selfColor}
            totalPlies={report.plies}
            markers={markersFromReport(report.milestones, report.replans)}
            cursorPly={Math.max(0, report.plies - 1)}
          />
        )}
      </div>

      {/* Panel column */}
      <div className="space-y-3">
        <Card>
          <CardContent className="p-4">
            <MilestonePanel plan={planInfo} milestones={milestones} replans={replans} violations={violations} />
          </CardContent>
        </Card>

        {lastSteer && record.mode === 'puppeteer' && <SteerCard entry={lastSteer.entry} candidates={lastSteer.candidates} live />}

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event log</h3>
            <ScrollArea className="h-40 theater-scroll pr-2">
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {log.length === 0 && <li>waiting for events...</li>}
                {log.slice(-14).map((l, i) => (
                  <li key={i}>
                    <span className="font-mono text-primary">{l.kind}</span> {l.text}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Post-game coach card (human mode) */}
        {record.mode === 'human' && report && (
          <Card className="border-primary/40">
            <CardContent className="space-y-2 p-4">
              <h3 className="text-sm font-bold">Coach card</h3>
              {(() => {
                const coach = generateCoach(report);
                return (
                  <>
                    <p className="text-sm italic text-foreground/85">{coach.headline}</p>
                    <p className="text-xs font-semibold text-primary">{coach.scoreLine}</p>
                    <ul className="theater-scroll max-h-60 space-y-1 overflow-y-auto pr-1">
                      {coach.lines.map((l, i) => (
                        <li
                          key={i}
                          className={`rounded-md px-2 py-1 text-[11px] leading-snug ${
                            l.kind === 'good' ? 'bg-emerald-500/10 text-emerald-200' : l.kind === 'miss' ? 'bg-rose-500/10 text-rose-200' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {loadError && (
          <Dialog open>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Engine error</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
