#!/usr/bin/env python3
"""Per-milestone completed-in-order stats from a committed sweep summary JSON."""
import json
import sys
from collections import defaultdict
from pathlib import Path

def stats(path, dirs):
    data = json.loads(Path(path).read_text())
    per = defaultdict(list)
    for o in data['outcomes']:
        if o['report'] is None or o['id'] not in dirs:
            continue
        per[o['id']].append(o['report'])
    for d in dirs:
        games = per.get(d) or []
        if not games:
            print(f'{d}: no games'); continue
        n = len(games)
        nm = max(len(g['milestones']) for g in games)
        out = []
        for mi in range(nm):
            comp = sum(1 for g in games if mi < len(g['milestones']) and g['milestones'][mi].get('completed'))
            part = sum((g['milestones'][mi].get('bestPartial', 0) or 0) for g in games if mi < len(g['milestones']))
            out.append(f'm{mi}: {comp}/{n} (meanPartial {part/n:.2f})')
        full = sum(1 for g in games if all(m.get('completed') for m in g['milestones']) and g.get('terminalMet'))
        print(f'{d}: n={n} full={full}/{n}  ' + '  '.join(out))

if __name__ == '__main__':
    path, dirs = sys.argv[1], sys.argv[2].split(',')
    stats(path, dirs)
