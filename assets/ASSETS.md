# Marionette assets registry

Every third-party asset (component library, sound, image set) used by the web
UI is recorded here with its license and where it was verified. Researched
2026-11-17 (discovery pass before any Phase 3 UI code).

## UI component stack (evaluated via a research subagent; facts verified against source repos/docs)

| Layer | Pick | License (verified at) | Why |
| --- | --- | --- | --- |
| Base components | **shadcn/ui** | MIT — `raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md` | Copy-paste ownership; its own repo runs the exact Marionette stack (Next 16.4.5 / React 19.2.3 / Tailwind v4.3), so compatibility is proven by construction. Radix (MIT, `radix-ui/primitives`) comes along underneath; no separate adoption needed. |
| Animation components | **Magic UI** (`magicuidesign/magicui`) | MIT — `raw.githubusercontent.com/magicuidesign/magicui/main/LICENSE.md` | shadcn-CLI-native copy-paste components (Number Ticker, Border Beam, Animated Circular Progress Bar, Confetti, Blur Fade, Animated List); no commercial restrictions. Uses `motion` (MIT) for custom effects. |
| Chess board | **react-chessboard v5** (`Clariity/react-chessboard`) | MIT — `raw.githubusercontent.com/Clariity/react-chessboard/main/LICENSE` | TS-first, React 19 required (peer `react ^19`), ~229k npm downloads/month, active (5.12.1, 2026-08). Verified APIs: move animation, `squareStyles` (milestone/check/last-move highlights), `arrows` (engine lines — official Stockfish-WASM story is exactly our use case), dnd-kit drag + click-to-move, CSS-responsive, custom piece renderers. Promotion dialog is DIY in v5 → small shadcn Popover (budgeted). |
| Move validation (UI side) | **chess.js** | BSD-2-Clause | Already a Marionette dependency (core engine). react-chessboard is intentionally logic-free; official examples pair it with chess.js. |
| Piece set | **cburnett "Wikimedia standard"**, used under its **BSD-3-Clause** option | Multi-licensed GFDL-1.2+/CC-BY-SA-3.0/GPL-2+/BSD-3 ("select the license of your choice") — `commons.wikimedia.org/wiki/File:Chess_klt45.svg` (Cburnett, 2006) | The classic set react-chessboard embeds as defaults; BSD-3 option makes it commercial-safe with a retained copyright notice. Attribution line goes in the UI footer + here. |

### Rejected (with reasons)

| Candidate | License | Why rejected |
| --- | --- | --- |
| **Chessground** (`lichess-org/chessground`) | GPL-3.0-or-later | README: using it on a website forces the whole combined work under GPL with mandatory source release. Would contaminate the Marionette frontend. Re-evaluate only if the project ever goes GPL wholesale. |
| **Aceternity UI** | Custom proprietary license (free tier permits commercial *use*; forbids redistribution/competing template sale) — `ui.aceternity.com/licence` | Not open source; public GitHub repo deleted (provenance unverifiable). Magic UI (MIT) covers the same needs. |
| **cm-chessboard** (`shaack/cm-chessboard`) | Code MIT, but default Staunty sprite is **CC BY-NC-SA 4.0 (non-commercial)** | Vanilla JS (no React wrapper; wrapper would be hand-written), plus a non-commercial default asset. react-chessboard fits the stack better. |
| `chessboardjsx`, `chessboardjs` | MIT | Unmaintained (2021 / 2019), pre-React-19. |
| `@mirasen/react-chessboard` | MIT | Promising but ~775 downloads/month — too young to bet Phase 3 on. |
| `piece-packager` sets (deverac) | Mostly non-commercial per author | Not commercial-safe without per-set verification. |

### Notes

- Capture/check/promotion/milestone effects: no library ships these; we build
  a thin custom layer (square-style pulses via `squareStyles` + Motion
  transitions) on top of the picks above.
- Alternative piece set if cburnett's look is ever unwanted: livius/meridian
  from `kmar/chess_svg_piece_sets` (declared CC0 in README; no formal LICENSE
  file — flagged as a caveat).

## Sounds (UI event set)

Sourced 2026-11-17 from **Kenney** asset packs ("Interface Sounds" 1.0 and
"Digital Audio") — **Creative Commons Zero (CC0 1.0)**, verified against the
License.txt shipped inside each pack (preserved at
`assets/sounds/KENNEY-LICENSE.txt`). Files are unmodified pack originals
renamed to event names; per-file attribution in
`assets/sounds/LICENSES.md`; reproducible via `scripts/fetch-sounds.py`.

| Event | File | Original | License |
| --- | --- | --- | --- |
| move | `assets/sounds/move.ogg` | Interface Sounds `pluck_001.ogg` | CC0 |
| capture | `assets/sounds/capture.ogg` | Interface Sounds `drop_001.ogg` | CC0 |
| check | `assets/sounds/check.ogg` | Interface Sounds `glass_002.ogg` | CC0 |
| promotion | `assets/sounds/promotion.ogg` | Digital Audio `powerUp4.ogg` | CC0 |
| milestone | `assets/sounds/milestone.ogg` | Interface Sounds `confirmation_001.ogg` | CC0 |
| game end (win) | `assets/sounds/victory.ogg` | Digital Audio `threeTone1.ogg` | CC0 |
| game end (loss/draw) | `assets/sounds/defeat.ogg` | Digital Audio `lowDown.ogg` | CC0 |
| illegal move (human mode) | `assets/sounds/illegal.ogg` | Interface Sounds `error_001.ogg` | CC0 |

Rejected sound sources: Lichess `lila` standard set (acoustically ideal but
the repo is AGPL-3.0 with no per-sound license — not safely redeployable),
freesound.org per-file recordings (account-gated, hard to reproduce),
AI-generated sounds (external API dependency, unclear provenance).
