'use client';

/**
 * Puppeteer panel: plan summary, ordered milestone list with animated circular
 * progress bars (honest partials, drop reasons verbatim), replan log, lambda,
 * and the "why this move" chosen-vs-rejected-best card (F5).
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Ban, CheckCircle2, CircleDashed, GitBranch, Scale, ShieldAlert } from 'lucide-react';
import { CircularProgress, NumberTicker } from './magic';
import type { CandidateScore, PlanInfo, ReportMilestone, SteeringEntry } from '@/lib/marionette/types';

export interface MilestoneDisplay {
  id: string;
  description: string;
  completion: string;
  weight: number;
  status: 'completed' | 'active' | 'dropped' | 'pending';
  /** Live partial credit (active milestone) or bestPartial from the report. */
  partial: number;
  completedAtPly?: number | null;
  droppedAtPly?: number | null;
  dropReason?: string | null;
  addedByReplan?: boolean;
  trueAtEnd?: boolean;
}

export function MilestoneList({ milestones }: { milestones: MilestoneDisplay[] }) {
  return (
    <ol className="space-y-2">
      {milestones.map((m, i) => (
        <li
          key={m.id}
          className={`rounded-xl border p-3 transition-colors ${
            m.status === 'completed'
              ? 'border-emerald-500/40 bg-emerald-500/5'
              : m.status === 'dropped'
                ? 'border-rose-500/40 bg-rose-500/5'
                : m.status === 'active'
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-border/50 bg-card/40'
          }`}
        >
          <div className="flex items-start gap-3">
            <CircularProgress value={m.partial} status={m.status} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-bold">{m.id}</span>
                {m.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="completed" />}
                {m.status === 'dropped' && <Ban className="h-3.5 w-3.5 text-rose-400" aria-label="dropped" />}
                {m.status === 'active' && <CircleDashed className="h-3.5 w-3.5 text-amber-400 animate-pulse" aria-label="active" />}
                <Badge variant="outline" className="ml-auto text-[10px]">
                  w={m.weight}
                </Badge>
                {m.addedByReplan && <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px]">added by replan</Badge>}
                {m.trueAtEnd && !m.completed && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    true at end (not in order)
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs leading-snug text-foreground/85">{m.description}</p>
              {m.completedAtPly != null && m.status === 'completed' && (
                <p className="mt-1 text-[11px] text-emerald-300/90">completed at ply {m.completedAtPly}</p>
              )}
              {m.status === 'dropped' && (
                <p className="mt-1 text-[11px] leading-snug text-rose-300/90">
                  dropped at ply {m.droppedAtPly ?? '?'} &mdash; {m.dropReason ?? 'replan'}
                </p>
              )}
              <p className="mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground/70">{m.completion}</p>
            </div>
          </div>
          {i < milestones.length - 1 && <Separator className="mt-3 opacity-0" />}
        </li>
      ))}
    </ol>
  );
}

export function PlanHeader({ plan, terminalMet, terminalResult }: { plan: PlanInfo | null; terminalMet?: boolean; terminalResult?: string }) {
  if (!plan) return null;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">plan</span>
          <Badge variant="outline" className="text-[10px]">
            {plan.provider} / {plan.model}
          </Badge>
          {terminalMet != null && (
            <Badge
              className={`ml-auto text-[10px] ${
                terminalMet ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/15 text-rose-300 border border-rose-500/40'
              }`}
            >
              terminal {terminalMet ? 'MET' : 'NOT MET'}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-sm leading-snug">{plan.summary}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          terminal: {terminalResult ?? plan.terminal.kind} ({plan.terminal.priority}) &middot; style: {plan.style}
          {plan.fallback.length > 0 && <> &middot; fallback: {plan.fallback.join(' > ')}</>}
        </p>
      </CardContent>
    </Card>
  );
}

export function ReplanLog({ replans, violations }: { replans: { atPly: number; reason: string; provider: string }[]; violations: { id: string; description: string; atPly: number }[] }) {
  if (replans.length === 0 && violations.length === 0) return null;
  return (
    <div className="space-y-2">
      {replans.map((r, i) => (
        <div key={`rp-${i}`} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <GitBranch className="h-3.5 w-3.5" /> replan at ply {r.atPly}
            <Badge variant="outline" className="ml-auto text-[10px]">
              {r.provider}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-foreground/80">{r.reason}</p>
        </div>
      ))}
      {violations.map((v, i) => (
        <div key={`vi-${i}`} className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
            <ShieldAlert className="h-3.5 w-3.5" /> constraint violated at ply {v.atPly}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-foreground/80">
            {v.id}: {v.description}
          </p>
        </div>
      ))}
    </div>
  );
}

export function SteerCard({ entry, candidates, live }: { entry: SteeringEntry; candidates?: CandidateScore[]; live?: boolean }) {
  const chosen = candidates?.find((c) => c.uci === entry.chosenUci);
  const isEngineBest = entry.bestUci != null && entry.bestUci === entry.chosenUci;
  const others = (candidates ?? []).filter((c) => c.uci !== entry.chosenUci && !c.excluded).slice(0, 4);
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">why this move</span>
          {live && (
            <Badge variant="outline" className="text-[10px]">
              ply {entry.ply + 1}
            </Badge>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Scale className="h-3 w-3" /> &lambda; = <NumberTicker value={entry.lambda ?? 0} format={(v) => v.toFixed(2)} className="font-mono font-semibold text-foreground" />
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">chosen</p>
            <p className="mt-1 font-mono text-base font-bold">{entry.san}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{chosen?.motive ?? 'steering score winner'}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">steering score</dt>
                <dd className="font-mono">{entry.chosenScore != null ? entry.chosenScore.toFixed(2) : '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">eval (self)</dt>
                <dd className="font-mono">{Math.round(entry.chosenEvalSelfCp)}cp</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">progress after</dt>
                <dd className="font-mono">{Math.round(entry.chosenProgress * 100)}%</dd>
              </div>
            </dl>
          </div>
          <div className={`rounded-lg border p-3 ${isEngineBest ? 'border-border/50 bg-card/40' : 'border-rose-500/30 bg-rose-500/5'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${isEngineBest ? 'text-muted-foreground' : 'text-rose-300'}`}>
              {isEngineBest ? 'engine best (also chosen)' : 'rejected best'}
            </p>
            <p className="mt-1 font-mono text-base font-bold">{entry.bestSan ?? '-'}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{isEngineBest ? 'steering agreed with the engine' : 'highest-eval MultiPV candidate'}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">eval (self)</dt>
                <dd className="font-mono">{entry.bestEvalSelfCp != null ? `${Math.round(entry.bestEvalSelfCp)}cp` : '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">eval loss paid</dt>
                <dd className={`font-mono font-bold ${(entry.evalLossCp ?? 0) >= 150 ? 'text-rose-300' : ''}`}>
                  {entry.evalLossCp != null ? `${Math.round(entry.evalLossCp)}cp` : '-'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {others.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">other candidates</p>
            <ul className="space-y-1">
              {others.map((c) => (
                <li key={c.uci} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono font-semibold">{c.san}</span>
                  <span className="text-muted-foreground">{c.source === 'motivated' ? `motivated (${c.motive})` : `engine top-${c.motive.split('-').pop() ?? ''}`}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {Math.round(c.evalSelfCp)}cp &middot; &Delta;prog {c.deltaProgress >= 0 ? '+' : ''}
                    {(c.deltaProgress * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MilestonePanel({
  plan,
  milestones,
  replans,
  violations,
}: {
  plan: PlanInfo | null;
  milestones: MilestoneDisplay[];
  replans: { atPly: number; reason: string; provider: string }[];
  violations: { id: string; description: string; atPly: number }[];
}) {
  return (
    <div className="space-y-3">
      <PlanHeader plan={plan} />
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Milestones (in plan order)</h3>
        <div className="max-h-96 overflow-y-auto theater-scroll pr-1">
          <MilestoneList milestones={milestones} />
        </div>
      </div>
      {(replans.length > 0 || violations.length > 0) && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Replans &amp; violations</h3>
          <div className="max-h-44 overflow-y-auto theater-scroll pr-1">
            <ReplanLog replans={replans} violations={violations} />
          </div>
        </div>
      )}
    </div>
  );
}
