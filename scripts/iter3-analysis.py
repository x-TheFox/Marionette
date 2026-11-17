#!/usr/bin/env python3
"""Iteration #3 sweep analysis: milestone-level outcomes per directive/cell.

Reads bench/raw/<tag>/<DIR>/elo<E>/game-*/metrics.json and prints:
- per-cell ordered-full / terminal rates
- per-milestone completed-in-order rate and mean final partial credit
- drop/replan reason histogram per directive
Usage: python3 scripts/iter3-analysis.py <tag> [tag2...]
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

RAW = Path('bench/raw')

def load(tag):
    games = []
    for m in sorted(RAW.glob(f'{tag}/*/elo*/game-*/metrics.json')):
        try:
            data = json.loads(m.read_text())
        except Exception:
            continue
        parts = m.parts  # bench/raw/tag/DIR/eloE/game-XXX/metrics.json
        games.append({
            'tag': parts[2], 'dir': parts[3], 'elo': parts[4],
            'report': data.get('report') or {}, 'judge': data.get('judge') or {},
        })
    return games

def main(tags):
    for tag in tags:
        games = load(tag)
        if not games:
            print(f'[{tag}] no data'); continue
        print(f'\n=== {tag}: {len(games)} games ===')
        per_dir_cell = defaultdict(list)
        for g in games:
            per_dir_cell[(g['dir'], g['elo'])].append(g)
        for (d, elo), cell in sorted(per_dir_cell.items()):
            n = len(cell)
            full = sum(1 for g in cell if g['report'].get('milestones')
                       and all(m.get('completed') for m in g['report']['milestones'])
                       and g['report'].get('terminalMet'))
            term = sum(1 for g in cell if g['report'].get('terminalMet'))
            # per-milestone stats
            nm = max(len(g['report'].get('milestones') or []) for g in cell)
            rows = []
            for mi in range(nm):
                comp = 0; part = 0.0; seen = 0
                for g in cell:
                    ms = g['report'].get('milestones') or []
                    if mi < len(ms):
                        seen += 1
                        comp += 1 if ms[mi].get('completed') else 0
                        part += ms[mi].get('bestPartial', ms[mi].get('partial', 0)) or 0
                rows.append((mi, comp, seen, part / seen if seen else 0))
            wld = [0, 0, 0]
            for g in cell:
                r = g['report'].get('result', '')
                self_w = g['report'].get('selfColor') == 'w'
                if r == '1/2-1/2': wld[2] += 1
                elif (r == '1-0') == self_w: wld[0] += 1
                else: wld[1] += 1
            print(f'  {d:3s} {elo:5s} n={n:2d} W-L-D={wld[0]}-{wld[1]}-{wld[2]} term={term}/{n} full={full}/{n}')
            for mi, comp, seen, avg in rows:
                print(f'        m{mi}: completed {comp}/{seen}  meanPartial {avg:.2f}')
        # drop / replan reasons
        reasons = defaultdict(int)
        for g in games:
            for m in g['report'].get('milestones') or []:
                if m.get('droppedAtPly') is not None:
                    why = (m.get('droppedReason') or '?').split('(')[0].strip()[:60]
                    reasons[why] += 1
            for r in g['report'].get('replans') or []:
                why = (r if isinstance(r, str) else (r.get('reason') or '?')).split('(')[0].strip()[:60]
                reasons['replan: ' + why] += 1
        if reasons:
            print(f'  [{tag}] drop/replan reasons:')
            for why, c in sorted(reasons.items(), key=lambda kv: -kv[1]):
                print(f'    {c:3d}  {why}')

if __name__ == '__main__':
    main(sys.argv[1:])
