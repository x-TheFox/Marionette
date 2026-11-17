'use client';

/**
 * Benchmark honesty panel: the frozen success bars joined with the committed
 * sweep verdicts, exactly as recorded. Failures are shown as failures.
 */
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PanelBar, SweepResponse } from '@/lib/marionette/types';

function verdictBadge(b: PanelBar) {
  if (!b.verdict) return <Badge variant="outline" className="text-[10px]">no sweep data</Badge>;
  if (b.expectedFail) {
    return b.pass ? (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px]">UNEXPECTED PASS</Badge>
    ) : (
      <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px]">FAIL (expected)</Badge>
    );
  }
  return b.pass ? (
    <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px]">PASS</Badge>
  ) : (
    <Badge className="bg-rose-500/15 text-rose-300 border border-rose-500/40 text-[10px]">FAIL</Badge>
  );
}

function actualText(b: PanelBar): string {
  if (!b.verdict) return '-';
  if (b.metric === 'acpl_mean_max') return `${b.verdict.rate.toFixed(1)} mean ACPL`;
  return `${Math.round(b.verdict.rate * 100)}% (${b.verdict.hits}/${b.verdict.n})`;
}

function requiredText(b: PanelBar): string {
  return b.metric === 'acpl_mean_max' ? `<= ${b.threshold}` : `>= ${Math.round(b.threshold * 100)}%`;
}

export default function HonestPanel({ sweep, directiveFilter }: { sweep: SweepResponse; directiveFilter?: string }) {
  const bars = directiveFilter ? sweep.bars.filter((b) => b.directiveId === directiveFilter) : sweep.bars;
  return (
    <div className="space-y-2">
      <div className="max-h-96 overflow-y-auto theater-scroll rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Dir</TableHead>
              <TableHead className="min-w-56">Frozen bar</TableHead>
              <TableHead className="w-28">Required</TableHead>
              <TableHead className="w-32">Actual (sweep)</TableHead>
              <TableHead className="w-32">Verdict</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bars.map((b) => (
              <TableRow key={b.barId}>
                <TableCell className="font-mono text-xs font-bold text-primary">{b.directiveId}</TableCell>
                <TableCell>
                  <div className="text-xs font-medium">{b.barId}</div>
                  <div className="text-[11px] text-muted-foreground">{b.description}</div>
                  {b.elos && <div className="text-[10px] text-muted-foreground">scope: ELO {b.elos.join('/')}</div>}
                  {b.expectedFail && (
                    <div className="text-[10px] text-amber-300/80">known failing regression, kept visible on purpose{b.note ? ` — ${b.note}` : ''}</div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{requiredText(b)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{actualText(b)}</TableCell>
                <TableCell>{verdictBadge(b)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Bars are pre-declared and frozen (spec.ts). Actuals come from the committed offline sweeps:{' '}
        {sweep.sweeps.map((s) => `${s.file} (${s.games} games)`).join(', ')}. Most full-completion bars FAIL today &mdash;
        that is the honest state of the engine, shown here as-is (see finding F1&ndash;F5 in the iteration report).
      </p>
    </div>
  );
}
