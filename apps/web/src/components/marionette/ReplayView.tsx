'use client';

/**
 * Replay view (F2/F4): deterministic client-side replay of a finished game
 * from the stored report (PGN + steering trail + milestone timeline), with a
 * scrubber, synced eval graph, per-ply milestone state and director's
 * commentary (F3, rule-generated).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';
import { Copy, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { api } from '@/lib/marionette/api';
import { sound } from '@/lib/marionette/sound';
import { generateCommentary, type CommentaryLine } from '@/lib/marionette/commentary';
import { isPuppetRecord, type GameRecord, type GameReport, type SteeringEntry } from '@/lib/marionette/types';
import BoardPanel, { findKingSquare } from './BoardPanel';
import EvalGraph, { markersFromReport } from './EvalGraph';
import MilestonePanel, { type MilestoneDisplay } from './MilestonePanel';

export default function ReplayView({ gameId, onNavigate }: { gameId: string; onNavigate: (to: string) => void }) {
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0); // plies applied (0..N)
  const lastCursor = useRef(0);

  useEffect(() => {
    let alive = true;
    api
      .game(gameId)
      .then((rec) => {
        if (!alive) return;
        setRecord(rec);
        if ((isPuppetRecord(rec) && rec.report) || (!isPuppetRecord(rec) && rec.report)) {
          setCursor((isPuppetRecord(rec) ? rec.report! : rec.report!).plies);
        }
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [gameId]);

  const report: GameReport | null = record?.report ?? null;

  // PGN history (SAN + verbose metadata)
  const hist = useMemo(() => {
    if (!report) return [];
    const g = new Chess();
    try {
      g.loadPgn(report.pgn);
    } catch {
      return [];
    }
    return g.history({ verbose: true }) as unknown as { san: string; from: string; to: string; captured?: string; promotion?: string; color: string }[];
  }, [report]);

  const board = useMemo(() => {
    const g = new Chess();
    for (let i = 0; i < cursor && i < hist.length; i++) {
      try {
        g.move(hist[i]!.san);
      } catch {
        break;
      }
    }
    return g;
  }, [cursor, hist]);

  // play move/undo sounds while scrubbing
  useEffect(() => {
    if (cursor > lastCursor.current && hist[cursor - 1]) {
      const m = hist[cursor - 1]!;
      if (m.promotion) sound.play('promotion');
      else if (m.captured) sound.play('capture');
      else sound.play('move');
      const probe = new Chess(board.fen());
      if (probe.isCheck()) window.setTimeout(() => sound.play('check'), 130);
    } else if (cursor < lastCursor.current) {
      sound.play('move');
    }
    lastCursor.current = cursor;
  }, [cursor, hist, board]);

  const milestoneTimeline: MilestoneDisplay[] = useMemo(() => {
    if (!report) return [];
    return report.milestones.map((m) => {
      const completedNow = m.completed && (m.completedAtPly ?? Infinity) <= cursor;
      const droppedNow = m.droppedAtPly != null && !m.completed && m.droppedAtPly <= cursor;
      return {
        id: m.id,
        description: m.description,
        completion: m.completion,
        weight: m.weight,
        status: completedNow ? 'completed' : droppedNow ? 'dropped' : 'pending',
        partial: completedNow ? 1 : droppedNow ? m.bestPartial : m.droppedAtPly != null ? m.bestPartial : 0,
        completedAtPly: completedNow ? m.completedAtPly ?? null : null,
        droppedAtPly: droppedNow ? m.droppedAtPly ?? null : null,
        dropReason: droppedNow ? m.dropReason ?? null : null,
        addedByReplan: m.addedByReplan,
        trueAtEnd: m.trueAtEnd,
      };
    });
  }, [report, cursor]);

  const steerAtCursor: SteeringEntry | null = useMemo(() => {
    if (!report?.steeringTrail) return null;
    return report.steeringTrail.find((e) => e.ply === cursor - 1) ?? null;
  }, [report, cursor]);

  const evalAtCursor: number | null = useMemo(() => {
    if (!report) return null;
    if (report.evalTrail.length === 0) return null;
    const self = report.selfColor;
    if (cursor === 0) return null;
    const i = Math.floor((cursor - 1 - (self === 'b' ? 1 : 0)) / 2);
    if (i < 0 || i >= report.evalTrail.length) return null;
    return report.evalTrail[i] ?? null;
  }, [report, cursor]);

  const commentary: CommentaryLine[] = useMemo(() => (report ? generateCommentary(report) : []), [report]);
  const visibleCommentary = useMemo(() => commentary.filter((l) => l.ply <= cursor - 1), [commentary, cursor]);

  // milestone flash when the scrubber lands on a completion ply (derived state)
  const flashSquares: string[] = useMemo(() => {
    if (!report || cursor === 0 || !hist[cursor - 1]) return [];
    const justCompleted = report.milestones.find((m) => m.completed && m.completedAtPly === cursor);
    if (!justCompleted) return [];
    const m = hist[cursor - 1]!;
    return [m.from, m.to];
  }, [report, cursor, hist]);

  if (error) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="p-6 text-center">
          <p className="font-semibold text-rose-300">Replay unavailable</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={() => onNavigate('/')}>
            Back to lobby
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!record || !report) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        {record ? 'This game has no stored report yet — the replay becomes available when the game finishes.' : 'Loading replay...'}
      </div>
    );
  }

  const total = Math.max(1, hist.length);
  const fen = board.fen();
  const moveNumber = Math.floor((cursor + 1) / 2);
  const sanAtCursor = cursor > 0 ? hist[cursor - 1]?.san : null;
  const moverAtCursor = cursor > 0 ? hist[cursor - 1]?.color : null;
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/?replay=${gameId}`;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {isPuppetRecord(record) ? record.directiveId : record.directiveId}
          </Badge>
          <span className="text-sm font-medium">&ldquo;{report.directive}&rdquo;</span>
          <Badge variant="outline" className="text-[10px]">
            replay (deterministic from the stored report)
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            vs Stockfish {report.opponentElo} {report.opponentEmulated ? '(emulated)' : '(native)'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto min-h-9"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(shareUrl)
                .then(() => toast({ title: 'Share link copied', description: shareUrl }))
                .catch(() => toast({ title: 'Share link', description: shareUrl }));
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" /> Copy share link
          </Button>
        </div>

        <BoardPanel
          fen={fen}
          orientation={report.selfColor === 'b' ? 'black' : 'white'}
          highlights={
            cursor > 0
              ? { lastMove: hist[cursor - 1] ? { from: hist[cursor - 1]!.from, to: hist[cursor - 1]!.to } : null, checkSquare: board.isCheck() ? findKingSquare(fen, board.turn()) : null, flashSquares }
              : { checkSquare: null, flashSquares }
          }
          beamActive={false}
          evalSelfCp={evalAtCursor}
          boardLabel="Replay board"
        />

        {/* Scrubber */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setCursor((c) => Math.max(0, c - 1))} aria-label="Previous ply">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Slider
                value={[cursor]}
                min={0}
                max={total}
                step={1}
                onValueChange={(v) => setCursor(v[0] ?? 0)}
                className="flex-1"
                aria-label="Replay scrubber"
              />
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setCursor((c) => Math.min(total, c + 1))} aria-label="Next ply">
                <SkipForward className="h-4 w-4" />
              </Button>
              <span className="w-24 text-right font-mono text-xs text-muted-foreground">
                ply {cursor}/{total} &middot; move {moveNumber}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {cursor === 0
                ? 'Start position — press play or drag the scrubber.'
                : `${moverAtCursor === 'w' ? 'White' : 'Black'} played ${sanAtCursor}`}
              {cursor === total && ` — end: ${report.result} (${report.endReason}), terminal ${report.terminalMet ? 'MET' : 'NOT MET'}`}
            </p>
          </CardContent>
        </Card>

        <EvalGraph
          evalTrail={report.evalTrail}
          selfColor={report.selfColor}
          totalPlies={total}
          markers={markersFromReport(report.milestones, report.replans)}
          cursorPly={Math.max(0, cursor - 1)}
          onSeek={(ply) => setCursor(ply + 1)}
        />

        {isPuppetRecord(record) && (
          <p className="text-[11px] text-muted-foreground">
            Server-side re-run link: <code className="font-mono">/?replaySeed={isPuppetRecord(record) ? record.directiveId : ''}&amp;elo={report.opponentElo}&amp;seed={isPuppetRecord(record) ? record.seed : 0}</code> starts a fresh
            game with the same directive, seed and settings (offline compile, seeded RNG). The seeded opponent emulation is deterministic, but the steered Stockfish search can still deviate between runs &mdash; treat it as a re-run, not a guaranteed
            replay of this exact game. For an exact reproduction use this page&rsquo;s scrubber (it replays the stored PGN).
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardContent className="p-4">
            <MilestonePanel plan={null} milestones={milestoneTimeline} replans={report.replans} violations={report.violations} />
          </CardContent>
        </Card>

        {steerAtCursor && <Card className="border-primary/40">
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Steering decision at this ply</p>
            <SteerMini entry={steerAtCursor} />
          </CardContent>
        </Card>}

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Director&rsquo;s commentary (rule-generated)</h3>
            <div className="theater-scroll max-h-72 space-y-1 overflow-y-auto pr-1">
              {visibleCommentary.length === 0 && <p className="text-xs text-muted-foreground">Nothing significant yet — keep scrubbing.</p>}
              {visibleCommentary.map((l, i) => (
                <p key={i} className="rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-snug">
                  <Badge variant="outline" className="mr-1 text-[9px] uppercase">
                    {l.kind}
                  </Badge>
                  {l.text}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button variant="outline" className="min-h-9 flex-1" onClick={() => onNavigate('/')}>
            <RotateCcw className="mr-1 h-4 w-4" /> Lobby
          </Button>
          <Button variant="outline" className="min-h-9 flex-1" onClick={() => onNavigate(`/?view=game&id=${gameId}`)}>
            Back to game view
          </Button>
        </div>
      </div>
    </div>
  );
}

function SteerMini({ entry }: { entry: SteeringEntry }) {
  const loss = entry.evalLossCp ?? 0;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold text-emerald-300">{entry.san}</span>
        <span className="text-muted-foreground">chosen</span>
        <span className="ml-auto text-muted-foreground">
          progress {Math.round((entry.activeMilestoneProgress ?? entry.chosenProgress) * 100)}% &middot; &lambda; {entry.lambda?.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold text-rose-300">{entry.bestSan ?? '-'}</span>
        <span className="text-muted-foreground">rejected best</span>
        <span className="ml-auto text-muted-foreground">
          eval loss <span className={loss >= 150 ? 'font-bold text-rose-300' : ''}>{Math.round(loss)}cp</span>
        </span>
      </div>
      {entry.activeMilestoneId && <p className="text-[11px] text-muted-foreground">active milestone: {entry.activeMilestoneId}</p>}
    </div>
  );
}
