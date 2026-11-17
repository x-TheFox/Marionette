#!/usr/bin/env python3
"""Aggregate D1/D6 sweep stats for the steering-iteration report."""
import json
import glob
import re
from collections import Counter

def load(tag):
    out = {}
    for f in sorted(glob.glob(f'bench/raw/{tag}/D*/elo*/game-*/metrics.json')):
        r = json.load(open(f))['report']
        parts = f.split('/')
        d = parts[3]
        elo = parts[4].replace('elo', '')
        out.setdefault((d, elo), []).append(r)
    return out

before = load('quick')
after = load('d1d6-full')

for tag, data in [('BEFORE (quick sweep, 3/cell)', before), ('AFTER (10/cell)', after)]:
    print('=' * 78)
    print(tag)
    for d in ['D1', 'D6']:
        print(f'--- {d} ---')
        for elo in ['800', '1200', '1600', '2000']:
            games = data.get((d, elo), [])
            if not games:
                continue
            n = len(games)
            ms = {}
            for r in games:
                for m in r['milestones']:
                    ms.setdefault(m['id'], []).append(m)
            line = f'{elo}: {n} games | '
            for mid, arr in ms.items():
                bpart = sum(m.get('bestPartial', 0) for m in arr) / len(arr)
                comp = sum(1 for m in arr if m['completed'])
                line += f'{mid[:14]}: avgPartial={bpart:.2f} comp={comp}/{len(arr)}  '
            print(line)

# D1: infeasibility timing (pawn loss) and promotion counts
print('=' * 78)
print('D1 AFTER - reduce_to_pawns death mode and timing per game:')
for (d, elo), games in sorted(after.items()):
    if d != 'D1':
        continue
    for i, r in enumerate(games):
        replans = r.get('replans', [])
        death = ''
        for rp in replans:
            if 'reduce_to_pawns' in rp.get('reason', '') and 'infeasible' in rp.get('reason', ''):
                death = f"pawn lost @ply {rp['atPly']}"
        prom = next((m for m in r['milestones'] if m['id'] == 'promote_all_pawns_to_knights'), {})
        prom_part = prom.get('bestPartial', 0)
        # promotions achieved: partial*8 approx minus advancement... use PGN instead
        print(f'  {elo} g{i:02d}: {death or "survived":22s} plies={r["plies"]:3d} promotePartial={prom_part:.2f}')

# count knight promotions from PGNs
print('=' * 78)
print('D1 AFTER - knight promotions per game (from PGN =N):')
for d in ['D1']:
    for elo in ['800', '1200', '1600', '2000']:
        counts = []
        for g in sorted(glob.glob(f'bench/raw/d1d6-full/{d}/elo{elo}/game-*/game.pgn')):
            pgn = open(g).read()
            counts.append(len(re.findall(r'=\s*N\b', pgn)))
        print(f'  {elo}: promotions={counts} total={sum(counts)}')

# D6: drop reason + final partial
print('=' * 78)
print('D6 AFTER - reduce_to_kq fate per game:')
fate_counter = Counter()
partials = []
for (d, elo), games in sorted(after.items()):
    if d != 'D6':
        continue
    for i, r in enumerate(games):
        replans = r.get('replans', [])
        fate = 'survived-to-end'
        for rp in replans:
            if 'reduce_to_kq' in rp.get('reason', ''):
                if 'infeasible' in rp['reason']:
                    fate = 'infeasible (queen gone, no pawns)'
                elif 'exceeded' in rp['reason']:
                    fate = 'budget+stall'
                elif 'stalled' in rp['reason']:
                    fate = 'stall'
        red = next((m for m in r['milestones'] if m['id'] == 'reduce_to_kq'), {})
        partials.append(red.get('bestPartial', 0))
        fate_counter[fate] += 1
        if fate != 'budget+stall':
            print(f'  {elo} g{i:02d}: {fate:34s} partial={red.get("bestPartial",0):.2f} plies={r["plies"]}')
print('  fate distribution:', dict(fate_counter))
print(f'  reduce_to_kq avg bestPartial AFTER: {sum(partials)/len(partials):.3f}')

partials_b = []
for (d, elo), games in sorted(before.items()):
    if d != 'D6':
        continue
    for r in games:
        red = next((m for m in r['milestones'] if m['id'] == 'reduce_to_kq'), {})
        partials_b.append(red.get('bestPartial', 0))
print(f'  reduce_to_kq avg bestPartial BEFORE: {sum(partials_b)/len(partials_b):.3f}')

partials_b1 = []
for (d, elo), games in sorted(before.items()):
    if d != 'D1':
        continue
    for r in games:
        red = next((m for m in r['milestones'] if m['id'] == 'reduce_to_pawns'), {})
        partials_b1.append(red.get('bestPartial', 0))
partials_a1 = []
for (d, elo), games in sorted(after.items()):
    if d != 'D1':
        continue
    for r in games:
        red = next((m for m in r['milestones'] if m['id'] == 'reduce_to_pawns'), {})
        partials_a1.append(red.get('bestPartial', 0))
print(f'D1 reduce_to_pawns avg bestPartial BEFORE: {sum(partials_b1)/len(partials_b1):.3f} AFTER: {sum(partials_a1)/len(partials_a1):.3f}')

# D1 pawn-loss ply distribution
print('=' * 78)
print('D1 AFTER - pawn-loss ply (reduce_to_pawns infeasible trigger):')
losses = []
for (d, elo), games in sorted(after.items()):
    if d != 'D1':
        continue
    for r in games:
        for rp in r.get('replans', []):
            if 'reduce_to_pawns' in rp.get('reason', '') and 'infeasible' in rp['reason']:
                losses.append(rp['atPly'])
losses.sort()
print(f'  n={len(losses)}/40 games, plies: {losses}')
