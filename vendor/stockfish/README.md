# Vendored Stockfish

## What

Official **Stockfish 19** release binary — Linux x86-64 **universal** build (runtime CPU-feature dispatch: picks the best supported subset, no separate avx2/bmi2 flavours needed).

## Provenance

| Field | Value |
| --- | --- |
| Upstream | https://github.com/official-stockfish/Stockfish |
| Release tag | `sf_19` (newest stable, non-prerelease at vendoring time) |
| Asset | `stockfish-linux-x86-64-universal.tar.gz` |
| Size | 81,388,977 bytes |
| sha256 | `9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f` |
| Vendored on | 2026-11-17 |
| License | **GPL-3.0** — full text in `COPYING.Stockfish.txt` (shipped inside the tarball) |

Note: the upstream repo was renamed `officialstockfish/stockfish` → `official-stockfish/Stockfish`; the old path returns 404 on the GitHub API. `scripts/vendor-stockfish.sh` uses the new path and re-verifies checksums on extraction.

## Layout

- `stockfish-linux-x86-64-universal.tar.gz` — **committed** (81 MB, under git's 100 MB blob limit) so a fresh clone has the engine even with no network or apt access.
- `stockfish` — extracted binary, **gitignored**, created by `scripts/bootstrap.sh` / `scripts/vendor-stockfish.sh`.
- `COPYING.Stockfish.txt` — GPL-3.0 text from the tarball.

## Verified behaviour (2026-11-17, 2-core sandbox)

- `uci` handshake OK: `id name Stockfish 19`.
- Strength options: `Skill Level` 0–20; `UCI_LimitStrength` check; **`UCI_Elo` 1320–3190** — opponents below 1320 must be emulated (skill level + depth caps + randomization; see `docs/PLAN.md`).

## Updating to a newer release

```bash
rm vendor/stockfish/stockfish-linux-x86-64-universal.tar.gz
GITHUB_TOKEN=... ./scripts/vendor-stockfish.sh   # picks newest stable release for this OS/arch
```
Then update this README's provenance table (tag/size/sha256 are printed by the script) and commit both files together.
