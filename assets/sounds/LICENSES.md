# Sound licenses — per-file attribution

All files in this directory come from Kenney (www.kenney.nl) asset packs,
downloaded 2026-11-17. **License: Creative Commons Zero (CC0 1.0 Universal)**
— free for personal, educational and commercial use, no attribution required
(crediting Kenney is appreciated but not mandatory). The full license text
shipped with the packs is preserved in `KENNEY-LICENSE.txt`.

- Packs used: "Interface Sounds" (1.0, 2020-02-11) and "Digital Audio"
  (https://kenney.nl/assets/interface-sounds, https://kenney.nl/assets/digital-audio)
- Files are unmodified copies of the pack originals, renamed to Marionette's
  event names.

| Event (Marionette) | File | Original pack file | Pack |
| --- | --- | --- | --- |
| move (a piece moves) | `move.ogg` | `pluck_001.ogg` | Interface Sounds |
| capture (a piece is taken) | `capture.ogg` | `drop_001.ogg` | Interface Sounds |
| check (self or opponent in check) | `check.ogg` | `glass_002.ogg` | Interface Sounds |
| promotion (a pawn promotes) | `promotion.ogg` | `powerUp4.ogg` | Digital Audio |
| milestone (a plan milestone completes) | `milestone.ogg` | `confirmation_001.ogg` | Interface Sounds |
| game end — win | `victory.ogg` | `threeTone1.ogg` | Digital Audio |
| game end — loss or draw | `defeat.ogg` | `lowDown.ogg` | Digital Audio |
| illegal move attempted (human mode) | `illegal.ogg` | `error_001.ogg` | Interface Sounds |

## Alternatives considered and rejected

- **Lichess `lila` standard sound set** (`public/sound/standard/`, files like
  `Move.mp3`, `Capture.mp3`, `Check.mp3`, `Victory.mp3`): acoustically the
  best fit, but the `lila` repo is AGPL-3.0 and ships **no per-file license**
  for the sounds — they would default to AGPL terms, which is not safely
  redeployable inside Marionette's license scheme. Rejected.
- **freesound.org** individual CC0 chess recordings: license-clean but
  requires per-file account-gated downloads and provenance checking that is
  hard to reproduce from a sandbox; pack-level Kenney CC0 is reproducible
  (`scripts/` keeps the mapping).
- **AI sound generation** (awesome-genmedia skills etc.): rejected — adds an
  external API dependency and unclear provenance.

## Reproduction

`scripts/fetch-sounds.py` (if present) or the recorded mapping above
reproduces this directory from the two Kenney packs. Volume/muting behavior
in the UI follows the `build-game-audio-feedback` skill guidance
(user-gesture unlock, mute + volume controls, voice caps, visual
alternatives for accessibility).
