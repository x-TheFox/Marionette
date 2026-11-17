#!/usr/bin/env bash
# Vendor the official Stockfish release binary into vendor/stockfish/.
#
# What it does:
#   1. Queries official Stockfish releases (GitHub API; GITHUB_TOKEN optional, avoids
#      rate limits — note: the repo lives at official-stockfish/Stockfish since the
#      2026 rename; the old officialstockfish/stockfish path 404s).
#   2. Picks the newest stable (non-prerelease, non-draft) release, then the asset
#      matching this OS/arch. New releases ship "universal" builds (runtime CPU
#      dispatch); older ones ship per-flavour builds (avx2 > bmi2 > plain).
#   3. Downloads the tarball INTO the repo (committed to git; the extracted binary
#      at vendor/stockfish/stockfish is gitignored).
#   4. Extracts the binary, keeps the upstream license file, smoke-tests UCI.
#
# Idempotent: exits early if the binary already answers `uci`.
# Offline-friendly: if a release tarball is already vendored in the repo, it is
# extracted without any network access (the GitHub API is only queried when no
# tarball is present).
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
VDIR="vendor/stockfish"
BIN="$VDIR/stockfish"
mkdir -p "$VDIR"

if [ -x "$BIN" ] && printf 'uci\nisready\nquit\n' | "$BIN" 2>/dev/null | grep -q 'id name Stockfish'; then
  echo "[vendor-stockfish] binary already works:"
  printf 'uci\nquit\n' | "$BIN" | grep 'id name'
  exit 0
fi

# Prefer a tarball already vendored in the repo — no network needed.
TAR="$(ls "$VDIR"/stockfish-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -n "$TAR" ]; then
  echo "[vendor-stockfish] using vendored tarball $(basename "$TAR") (offline)"
else
  echo "[vendor-stockfish] fetching release list..."
  auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer $GITHUB_TOKEN"); fi
  curl -s -m 30 "${auth[@]}" \
    "https://api.github.com/repos/official-stockfish/Stockfish/releases?per_page=10" \
    -o /tmp/sf_rels.json

  read -r TAG URL NAME < <(python3 - <<'PY'
import json, platform, sys

rels = json.load(open('/tmp/sf_rels.json'))
if isinstance(rels, dict):
    print('API ERROR: ' + rels.get('message', '?'), file=sys.stderr)
    sys.exit(2)

stable = [r for r in rels if not r.get('prerelease') and not r.get('draft')]
if not stable:
    print('no stable release found', file=sys.stderr)
    sys.exit(2)
rel = stable[0]

machine = platform.machine().lower()
if machine in ('x86_64', 'amd64'):
    arch_kw, flavors = 'x86-64', ['avx2', 'bmi2', 'x86-64']
elif machine in ('aarch64', 'arm64'):
    arch_kw, flavors = 'arm64', ['universal', '']
else:
    arch_kw, flavors = machine, ['']

if sys.platform == 'linux':
    os_kws = ['linux', 'ubuntu']
elif sys.platform == 'darwin':
    os_kws = ['macos', 'darwin']
else:
    os_kws = [sys.platform]

def cpu_has(flag):
    try:
        return flag in open('/proc/cpuinfo').read()
    except OSError:
        return False

if arch_kw == 'x86-64':
    flavors = [f for f in flavors if f == 'x86-64' or cpu_has(f)]

assets = rel['assets']
candidates = []
for f in flavors:
    for a in assets:
        n = a['name'].lower()
        if any(k in n for k in os_kws) and arch_kw in n and (not f or f in n):
            candidates.append((a['name'], a['browser_download_url']))
    if candidates:
        break

if not candidates:
    print('\n'.join(a['name'] for a in assets), file=sys.stderr)
    sys.exit(2)

name, url = candidates[0]
print(rel['tag_name'], url, name)
PY
) || { echo "[vendor-stockfish] could not pick an asset for this platform (list above, if any)."; exit 2; }

  echo "[vendor-stockfish] release $TAG -> $NAME"
  TAR="$VDIR/$NAME"
  if [ ! -f "$TAR" ]; then
    echo "[vendor-stockfish] downloading $URL"
    curl -sL --retry 3 -m 900 -o "$TAR" "$URL"
  fi
fi

echo "[vendor-stockfish] sha256 of $TAR:"
sha256sum "$TAR"

echo "[vendor-stockfish] extracting..."
rm -rf "$VDIR/extract"
mkdir -p "$VDIR/extract"
tar -xf "$TAR" -C "$VDIR/extract"
found=$(find "$VDIR/extract" -type f -name 'stockfish*' -perm -u+x | head -1 || true)
if [ -z "$found" ]; then
  echo "[vendor-stockfish] no executable found in tarball" >&2
  exit 3
fi
cp "$found" "$BIN"
chmod +x "$BIN"
lic=$(find "$VDIR/extract" \( -iname 'COPYING*' -o -iname 'LICENSE*' \) | head -1 || true)
if [ -n "$lic" ]; then cp "$lic" "$VDIR/COPYING.Stockfish.txt"; fi
rm -rf "$VDIR/extract"

echo "[vendor-stockfish] smoke test (uci handshake):"
printf 'uci\nisready\nquit\n' | "$BIN" | grep -E 'id (name|author)|uciok|readyok'
echo "[vendor-stockfish] strength-related options:"
printf 'uci\nquit\n' | "$BIN" | grep -E 'UCI_LimitStrength|UCI_Elo|Skill Level' || true
echo "[vendor-stockfish] done."
