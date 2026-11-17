'use client';

/**
 * Lobby: directive picker with honest frozen-bar verdict chips, opponent ELO
 * selector with the F1 "just hard enough" calibration suggestion, side and
 * mode pickers, and the benchmark honesty panel.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronUp, HelpCircle, Info, Swords, Theater } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/marionette/api';
import { sound } from '@/lib/marionette/sound';
import type { DirectiveInfo, SweepResponse } from '@/lib/marionette/types';
import HonestPanel from './HonestPanel';

const ELOS = [800, 1200, 1600, 2000] as const;

type Mode = 'puppeteer' | 'human';

function verdictChip(directiveId: string, sweep: SweepResponse | null) {
  const bars = sweep?.bars.filter((b) => b.directiveId === directiveId) ?? [];
  if (bars.length === 0 || bars.some((b) => b.verdict == null)) {
    return { label: 'no sweep data', cls: 'bg-muted text-muted-foreground border-border' };
  }
  // The verdict lives inside b.verdict — top-level `pass` does not exist.
  const fails = bars.filter((b) => b.verdict && !b.verdict.pass && !b.expectedFail);
  const expectedFails = bars.filter((b) => b.expectedFail && b.verdict && !b.verdict.pass);
  const passes = bars.filter((b) => b.verdict?.pass === true);
  if (fails.length === 0) {
    if (expectedFails.length > 0 && passes.length === bars.length - expectedFails.length) {
      return { label: 'expected-FAIL', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };
    }
    if (passes.length === bars.length) {
      return { label: 'PASS', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' };
    }
    return { label: 'mixed', cls: 'bg-muted text-muted-foreground border-border' };
  }
  if (passes.length === 0 && expectedFails.length === 0) {
    return { label: `FAIL ${fails.length}/${bars.length} bars`, cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' };
  }
  return {
    label: `mixed ${passes.length + expectedFails.length}/${bars.length} bars`,
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  };
}

function eloLabel(elo: number): string {
  return elo < 1320 ? `${elo} (emulated)` : `${elo} (native)`;
}

export default function Lobby({ onNavigate, serviceOk }: { onNavigate: (to: string) => void; serviceOk: boolean | null }) {
  const [directives, setDirectives] = useState<DirectiveInfo[] | null>(null);
  const [sweep, setSweep] = useState<SweepResponse | null>(null);
  const [selected, setSelected] = useState<string>('D6');
  const [elo, setElo] = useState<number>(800);
  const [side, setSide] = useState<'w' | 'b'>('w');
  const [mode, setMode] = useState<Mode>('puppeteer');
  const [starting, setStarting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelAll, setPanelAll] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .directives()
      .then((d) => {
        if (!alive) return;
        setDirectives(d.directives);
        const def = d.directives.find((x) => x.id === 'D6');
        if (def) setElo(def.calibration.suggestedElo);
      })
      .catch((e: Error) => {
        if (alive) toast({ title: 'Engine service unreachable', description: e.message, variant: 'destructive' });
      });
    api
      .sweep()
      .then((s) => alive && setSweep(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const selectedInfo = useMemo(() => directives?.find((d) => d.id === selected) ?? null, [directives, selected]);

  const start = async () => {
    setStarting(true);
    try {
      const res = await api.start({ directiveId: selected, opponentElo: elo, side, mode });
      sound.play('move');
      onNavigate(`/?view=game&id=${res.gameId}`);
    } catch (e) {
      const err = e as Error;
      toast({ title: 'Could not start the game', description: err.message, variant: 'destructive' });
      setStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Puppeteer a chess engine with a directive
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              The Goal Compiler turns the directive into a plan of ordered milestones. Steering picks every Marionette move to
              maximize progress &minus; &lambda;&middot;evalLoss + style. Bars are frozen and results are shown honestly &mdash;
              including the failures.
            </p>
          </div>
          {serviceOk === false && (
            <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300">
              engine service offline
            </Badge>
          )}
        </div>
      </section>

      <section aria-label="Directive picker">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            1. Choose a directive <span className="normal-case">(frozen benchmark set D1&ndash;D6, held-out H1&ndash;H5)</span>
          </h2>
          {sweep && (
            <span className="text-xs text-muted-foreground">
              verdicts from {sweep.sweeps.length} committed sweeps ({sweep.sweeps.reduce((a, s) => a + s.games, 0)} games)
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(directives ?? []).map((d) => {
            const chip = verdictChip(d.id, sweep);
            const isSelected = d.id === selected;
            return (
              <button
                key={d.id}
                onClick={() => {
                  setSelected(d.id);
                  setElo(d.calibration.suggestedElo);
                }}
                aria-pressed={isSelected}
                className={`min-h-[44px] rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary/70 bg-primary/10 shadow-[0_0_0_1px_oklch(0.8_0.16_85/0.4)]'
                    : 'border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-primary">{d.id}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${chip.cls}`}>{chip.label}</span>
                </div>
                <p className="mt-2 text-sm leading-snug text-foreground/90">&ldquo;{d.directive}&rdquo;</p>
                {d.plan && <p className="mt-2 line-clamp-2 text-[11px] italic text-muted-foreground">plan: {d.plan.summary}</p>}
              </button>
            );
          })}
          {!directives && <div className="col-span-full py-8 text-center text-sm text-muted-foreground">Loading directives...</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-label="Game setup">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-5 p-5">
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">2. Opponent strength</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ELOS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setElo(e)}
                    aria-pressed={elo === e}
                    className={`min-h-[44px] rounded-lg border px-3 py-2 text-center transition-colors ${
                      elo === e ? 'border-primary/70 bg-primary/10' : 'border-border/60 bg-card/50 hover:bg-card'
                    }`}
                  >
                    <div className="text-sm font-bold">{e}</div>
                    <div className="text-[10px] text-muted-foreground">{e < 1320 ? 'emulated' : 'native'}</div>
                  </button>
                ))}
              </div>
              {selectedInfo && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    F1 suggestion: <strong className="text-primary">{eloLabel(selectedInfo.calibration.suggestedElo)}</strong>
                    {' '}&mdash; just hard enough
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted" aria-label="Why this level">
                        <HelpCircle className="h-3 w-3" /> why this level
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-xs">
                      <p className="mb-2 font-semibold">Calibration (F1)</p>
                      <p className="mb-2 text-muted-foreground">{selectedInfo.calibration.note}</p>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="py-1">ELO</th>
                            <th className="py-1">games</th>
                            <th className="py-1">ordered-full</th>
                            <th className="py-1">terminal-met</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInfo.calibration.points.map((p) => (
                            <tr key={p.elo} className={p.elo === elo ? 'text-primary' : ''}>
                              <td className="py-1 font-mono">{p.elo}</td>
                              <td className="py-1">{p.n}</td>
                              <td className="py-1 tabular-nums">{Math.round(p.orderedFull * 100)}%</td>
                              <td className="py-1 tabular-nums">{Math.round(p.terminalMet * 100)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Suggested level = where the {selectedInfo.calibration.metric.replace('_', '-')} rate crosses ~
                        {Math.round(selectedInfo.calibration.target * 100)}% (linear interpolation between measured points,
                        snapped to a supported level). Measured on the committed sweep.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">3. Marionette plays</h2>
                <div className="flex gap-2">
                  {(['w', 'b'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      aria-pressed={side === s}
                      className={`min-h-[44px] flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        side === s ? 'border-primary/70 bg-primary/10' : 'border-border/60 bg-card/50 hover:bg-card'
                      }`}
                    >
                      {s === 'w' ? 'White' : 'Black'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">4. Mode</h2>
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
                  <Theater className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className={`text-xs ${mode === 'puppeteer' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>Puppeteer showcase</span>
                  <Switch checked={mode === 'human'} onCheckedChange={(v) => setMode(v ? 'human' : 'puppeteer')} aria-label="Toggle human challenge mode" />
                  <span className={`text-xs ${mode === 'human' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>Human challenge</span>
                  <Swords className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {mode === 'puppeteer'
                    ? 'Marionette plays itself: steered Stockfish vs a capped opponent, every decision explained.'
                    : 'You play Marionette\u2019s side; the tracker scores your play against the plan after every move.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button size="lg" className="min-h-11 flex-1 font-bold" onClick={start} disabled={starting || !directives}>
                {starting ? 'Starting...' : mode === 'puppeteer' ? 'Start puppeteer game' : 'Start human challenge'}
              </Button>
              <p className="text-[11px] text-muted-foreground sm:max-w-xs">
                Offline compile from the committed plan store, deterministic replans, seeded RNG &mdash; zero LLM calls.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Plan preview</h2>
            {selectedInfo?.plan ? (
              <ScrollArea className="h-64 theater-scroll pr-3">
                <p className="mb-3 text-sm italic text-foreground/80">&ldquo;{selectedInfo.plan.summary}&rdquo;</p>
                <ol className="space-y-3">
                  {selectedInfo.plan.milestones.map((m, i) => (
                    <li key={m.id} className="rounded-lg border border-border/50 bg-background/40 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-bold text-primary">
                          {i + 1}
                        </span>
                        <span className="font-mono text-xs font-bold">{m.id}</span>
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          w={m.weight} {m.moveBudget ? `budget ${m.moveBudget}` : ''}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-foreground/80">{m.description}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{m.completion}</p>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  terminal: {selectedInfo.plan.terminal.kind} ({selectedInfo.plan.terminal.priority}) &middot; style:{' '}
                  {selectedInfo.plan.style} &middot; compiled by {selectedInfo.plan.provider}
                </p>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">{selectedInfo ? 'No committed plan for this directive.' : 'Loading...'}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Benchmark honesty">
        <Collapsible open={panelOpen} onOpenChange={setPanelOpen}>
          <Card>
            <div className="flex flex-wrap items-center gap-2 p-4">
              <Info className="h-4 w-4 text-primary" />
              <span className="font-semibold">Benchmark honesty &mdash; frozen bars vs the committed sweep</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant={panelAll ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-9"
                  onClick={() => setPanelAll((v) => !v)}
                  aria-pressed={panelAll}
                >
                  <span className="text-xs">{panelAll ? 'All 11 directives' : `Only ${selected}`}</span>
                </Button>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="min-h-9">
                    {panelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="ml-1 text-xs">{panelOpen ? 'Hide' : 'Show'}</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {sweep ? <HonestPanel sweep={sweep} directiveFilter={panelAll ? undefined : selected} /> : <p className="text-sm text-muted-foreground">Loading sweep data...</p>}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </section>
    </div>
  );
}
