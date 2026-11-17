#!/bin/bash
# Iteration #3 sweep driver: runs ONE foreground harness pass (max 590s) with
# --resume, then reports how many games are complete vs expected. Call it
# repeatedly until it reports "complete" (the sandbox kills background
# processes, and one invocation cannot exceed the 10-minute tool timeout).
#
# Usage: bash scripts/iter3-sweep.sh <tag> <games> <directives> <elos>
set -u
TAG="$1"; GAMES="$2"; DIRECTIVES="$3"; ELOS="$4"
EXPECTED=0
IFS=',' read -ra DIRS <<< "$DIRECTIVES"
IFS=',' read -ra ELOLIST <<< "$ELOS"
for d in "${DIRS[@]}"; do for e in "${ELOLIST[@]}"; do EXPECTED=$((EXPECTED + GAMES)); done; done

count_done() {
  local n=0
  for d in "${DIRS[@]}"; do
    for e in "${ELOLIST[@]}"; do
      n=$((n + $(ls bench/raw/"$TAG"/"$d"/elo"$e"/game-*/metrics.json 2>/dev/null | wc -l)))
    done
  done
  echo "$n"
}

DONE=$(count_done)
echo "[sweep] $DONE/$EXPECTED games done (tag $TAG)"
if [ "$DONE" -ge "$EXPECTED" ]; then
  echo "[sweep] complete."
  exit 0
fi
timeout 590 npm run harness -- --games "$GAMES" --directives "$DIRECTIVES" --elos "$ELOS" \
  --tag "$TAG" --resume --concurrency 2 2>&1 | tail -3
echo "[sweep] now: $(count_done)/$EXPECTED games"
