# Skills Manifest — marionette

Installed via the `skills` CLI (registry: skills.sh) on 2026-11-17; vendored in-repo so they survive environment resets.

All 8 skills were installed **project-level** (never global) with `--copy`, so the real files are
committed inside this repo — no symlinks into `~` or `node_modules`. Canonical copies live in
[`.agents/skills/<name>/`](../.agents/skills/) and agent-facing copies in
[`.zcode/skills/<name>/`](../.zcode/skills/). The repo-root `skills-lock.json` (managed by the CLI)
pins each skill's source repo, commit hash, content hash, and install mode for reproducible
restores (`npx skills experimental_install` / updates via `npx skills update`).

## Installed skills

| Skill name | Source (publisher + GitHub repo) | License | What it's for | Install command used |
| --- | --- | --- | --- | --- |
| `animate` | Emil Kowalski — [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT (see source repo) | Builds a web (CSS/JS) animation from scratch through a strict decision sequence: should it animate at all (frequency gate — keyboard actions never animate), name the purpose, pick the cheapest tool (CSS transition → `@starting-style` → CSS animation → WAAPI → Motion), then exact properties, curves and durations from design tokens. Ships reduced-motion/hover gating with the code, plus a `RECIPES.md` of ready-to-build patterns (button press, popover, toast…). | `npx -y skills add emilkowalski/skills --copy -y -s animate` |
| `animate-expo` | Emil Kowalski — [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT (see source repo) | The same animation decision discipline as `animate`, targeted at React Native / Expo: Reanimated worklets kept on the UI thread, Gesture Handler velocity handoffs, expo-haptics, and judging feel on a release build on the slowest supported device. Covers sheets, screen transitions, press feedback, and motion that stutters on device. | `npx -y skills add emilkowalski/skills --copy -y -s animate-expo` |
| `emil-design-eng` | Emil Kowalski — [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT (see source repo) | Emil Kowalski's design-engineering philosophy for UI polish: taste as a trained instinct, unseen details compounding into interfaces people love, and an animation decision framework (frequency → purpose → curve/duration). Gets specific about component polish — press/hover states, popover `transform-origin`, tooltip timing, transitions vs keyframes — and mandates a Before/After/Why table format when reviewing UI code. | `npx -y skills add emilkowalski/skills --copy -y -s emil-design-eng` |
| `find-animation-opportunities` | Emil Kowalski — [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT (see source repo) | Read-only audit that sweeps a codebase/UI for the few moments that genuinely merit motion and rejects everything else (keyboard-initiated and 100×/day interactions are auto-disqualified). Caps output at 5–7 leverage-ordered suggestions with exact values; it proposes motion but never edits code. | `npx -y skills add emilkowalski/skills --copy -y -s find-animation-opportunities` |
| `design-taste-frontend` | leonxlnx (Taste Skill) — [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) | MIT (see source repo) | "tasteskill 2.5.1", the anti-slop frontend skill: builds company websites at figma.com / x.ai level — plain copy in a voice of its own, one section per screen, equal edges, real photographs and real product UI, a hero entrance plus one or two "dealt moments" per page, shader scenes only for technical subjects. Ships a large reference library (copy, layout, motion, photos, scenes), an asset library, and Node checker/finish-gate scripts (`gate.mjs`, `consistency.mjs`, …) that enforce the rules in a real browser. | `npx -y skills add leonxlnx/taste-skill --copy -y -s design-taste-frontend` |
| `impeccable` | Paul Bakaus — [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 (see source repo) | A design-director skill for the whole interface lifecycle: `shape` (plan UX/UI), `critique`/`audit` (heuristics, a11y, perf, responsive), `polish`, `bolder`, `quieter`, `distill`, `harden`, `animate`, `colorize`, `typeset`, `layout`, `delight`, and design-system capture into DESIGN.md/tokens. Scales ambition to the surface's mode (Persuade / Operate / Read / Experience) and ships reference playbooks, sub-agent configs, a CLI launcher, and live browser iteration tooling. | `npx -y skills add pbakaus/impeccable --copy -y -s impeccable` |
| `frontend-design` | Anthropic — [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 — **shipped `LICENSE.txt` preserved at `.agents/skills/frontend-design/LICENSE.txt`** | Anthropic's official guidance for distinctive, intentional visual design: ground choices in the subject matter, choose typography deliberately, spend boldness in one place, and work in two passes (design plan → review against the brief for generic defaults → build → self-critique). Includes a calibration list of "AI-generated design" tells (cream+serif+terracotta, SaaS-card kit, ALL-CAPS eyebrows…) to avoid. | `npx -y skills add anthropics/skills --copy -y -s frontend-design` |
| `web-design-guidelines` | Vercel Labs — [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | No license file ships with the skill or the agent-skills repo; the upstream guidelines repo [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) is MIT — see source repos | Reviews UI code for compliance with Vercel's Web Interface Guidelines: fetches the latest rules from `vercel-labs/web-interface-guidelines`, reads the target files (or asks for a pattern), checks every rule (interactions, accessibility, UX details), and outputs terse `file:line` findings. | `npx -y skills add vercel-labs/agent-skills --copy -y -s web-design-guidelines` |

## Discovery pass #2 (2026-11-17, before Phase 3)

Five more skills vendored after a registry (`npx skills find`) + web search sweep
covering the gaps in the first install: chess-domain knowledge, shadcn/ui
composition, sound design, and product brainstorming.

| Skill name | Source (publisher + GitHub repo) | Pinned commit | License | What it's for | Install command used |
| --- | --- | --- | --- | --- | --- |
| `shadcn` | shadcn — [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | `968d8cb9dc42` | MIT (repo LICENSE; skill carries no separate file) | Official shadcn/ui skill (421K installs): component knowledge, CLI usage (`init/add/search/view/docs/diff/info`), theming with CSS variables, registry authoring. Grounds Phase 3 UI work in correct shadcn APIs instead of hallucinated ones — component discovery, composition rules, semantic colors. | `npx -y skills add shadcn-ui/ui --copy -y -s shadcn` |
| `brainstorming` | Jesse Vincent (obra) — [obra/superpowers](https://github.com/obra/superpowers) | `22f0b463e7a5` | MIT (repo LICENSE; skill carries no separate file) | "Drawing out intent before building": a disciplined conversation process (echo the request, ask only questions whose answers change what gets built, play back understanding, write a design doc with intent/goals/non-goals/anti-goals) before any creative work. Used for the Phase 3/4 feature-ideation pass. | `npx -y skills add obra/superpowers --copy -y -s brainstorming` |
| `chess-analysis` | brumar — [brumar/chess-postmortem-skills](https://github.com/brumar/chess-postmortem-skills) | `eca0edfd55fe` | MIT at repo root; vendored `chess.js` is BSD-2-Clause, cburnett piece set CC BY-SA/GFDL (upstream LICENSE spells this out) | Stockfish-swept game post-mortems: eval sweep per move, parallel investigator subagents asking naive questions until every mistake is explained, layered annotated PGN + standalone HTML analysis viewer. Reusable patterns for Marionette: engine-as-fact-checker discipline, eval-sweep scripting, annotated-PGN construction. | `npx -y skills add brumar/chess-postmortem-skills --copy -y -s chess-analysis` |
| `chess-position` | brumar — [brumar/chess-postmortem-skills](https://github.com/brumar/chess-postmortem-skills) | `eca0edfd55fe` | Same as `chess-analysis` (same repo) | Deep study of a single position (FEN/screenshot/"move N"): asks positional-vs-tactical first, explains in human terms with every claim verified by Stockfish; FEN rendering helpers shared with chess-analysis. | `npx -y skills add brumar/chess-postmortem-skills --copy -y -s chess-position` |
| `build-game-audio-feedback` | MengTo — [MengTo/Skills](https://github.com/mengto/skills) | `3cc93458c494` | MIT (repo LICENSE; skill carries no separate file) | Responsive audio feedback for web/Three.js games: distinct cues per event class (input accepted, contact, block, miss, objective…), mix priorities, browser realities (user-gesture unlock, mute/volume, voice caps, node release), accessibility subtitles for cues. Directly maps to Marionette's move/capture/check/promotion/milestone/game-end sound set. | `npx -y skills add mengto/skills --copy -y -s build-game-audio-feedback` |

### Rejected candidates (and why)

- `borghei/Claude-Skills@brainstorm-ideas` — **license**: MIT + Commons Clause (forbids
  selling/repackaging) — not clean enough to vendor. The obra/superpowers
  `brainstorming` skill (pure MIT) covers the same need.
- `letta-ai/skills@chess-best-move` (and its `majiayu000/claude-skill-registry`
  mirror) — best-move-from-image advice skill; thin guidance, low adoption (47
  installs), no advantage over brumar's engine-verified analysis skills.
- `letta-ai/skills@regex-chess`, `urmzd/chess-cli@chess-cli`,
  `emmo00/chess-puzzles-contracts@chess-payout-claims`,
  `dash1971/ai-chess-assistant@chess-opening-study` — regex parsing toys, CLI
  play, smart-contract payouts, opening study: none match Marionette's needs.
- `daniel-brus/chess_teacher@{chess-teacher-vps,chess-teacher-storage,chess-teacher-redis}`
  — deployment/infrastructure skills for one specific chess-teacher SaaS; not
  general-purpose, unvetted license.
- `wldandan/chess-ai-coach-skills@chess-analysis`,
  `skills.volces.com@clawchess`, `omer-metin/skills-for-antigravity@game-audio`,
  `vudovn/ag-kit@game-audio` — low adoption, no discoverable license, or
  fork-of-a-fork provenance; superseded by higher-quality equivalents above.
- `playableintelligence/game-creator@game-audio` (1.5K installs) — audio is one
  chapter of a whole game-creation suite; too heavy for the focused need.
- `davila7/claude-code-templates` game-audio-principles — lives in a 918-skill
  template monorepo; vendoring one skill means dragging the catalog, and the
  skill file 404s at its documented path. MengTo's focused skill covers it.
- `awesome-genmedia/skills@sound-effects` — sound *generation* via external
  AI APIs; adds a key/network dependency Marionette does not want. Rejected in
  favor of sourcing licensed recorded sounds (see `assets/ASSETS.md`).
- `brumar/chess-postmortem-skills@{chess-video,chess-play}` — not installed
  (same repo as the two we took): chess-video is a heavy whisper/TTS video
  pipeline, chess-play plays chess as the agent — both out of scope for
  steering + UI phases.
- `MadeByTokens/claude-chess` — a multi-agent deliberation *plugin* (not a
  skill, not UI); interesting but not vendorable as guidance.
- **No chessboard-UI skill exists in the registry** (searched "chessboard",
  "board ui"): the gap is covered by the component pass in `assets/ASSETS.md`
  (react-chessboard vs alternatives) instead.

### Notes

- `skills-lock.json` pins each skill's source repo + commit hash + content
  hash (13 skills total); `npx skills experimental_install` restores all of
  them in a fresh clone.
- License caveats: only `frontend-design` (Apache-2.0) ships a license file
  inside its skill folder; every other skill's license lives in its source
  repository (checked 2026-11-17): emilkowalski/skills MIT,
  leonxlnx/taste-skill MIT, pbakaus/impeccable Apache-2.0,
  vercel-labs/agent-skills none, shadcn-ui/ui MIT, obra/superpowers MIT,
  brumar/chess-postmortem-skills MIT (+BSD-2 chess.js, CC BY-SA/GFDL cburnett),
  MengTo/Skills MIT.
- All 13 skills are pinned in `skills-lock.json` at the commits listed in the
  tables above; `.zcode/skills/` mirrors are gitignored, the canonical copies
  live in `.agents/skills/`.

## License files

- `frontend-design` is the only skill that ships a license file; it is preserved verbatim at
  `.agents/skills/frontend-design/LICENSE.txt` (Apache License 2.0) and mirrored in
  `.zcode/skills/frontend-design/LICENSE.txt`.
- All other skills carry no LICENSE/COPYING file inside their skill folder; their licenses live in
  the source repositories listed above (emilkowalski/skills: MIT; leonxlnx/taste-skill: MIT;
  pbakaus/impeccable: Apache-2.0; vercel-labs/agent-skills: none found).

## Notes

- Registry entries checked on 2026-11-17; install counts at time of research: `design-taste-frontend` ~788K, `web-design-guidelines` ~871K, `frontend-design` ~1.1M, `emil-design-eng` ~455K, `impeccable` ~413K, `find-animation-opportunities` ~262K.
- The registry still lists `leonxlnx/taste-skill@high-end-visual-design` (~459K installs), but the
  repo now ships a single skill, `design-taste-frontend` (tasteskill 2.5.1), which supersedes it —
  `high-end-visual-design` was therefore not installed separately.
- Verbatim CLI command history (repeated `-s` flags install several skills from one repo):
  - `npx -y skills add emilkowalski/skills --copy -y -s animate -s animate-expo -s find-animation-opportunities`
  - `npx -y skills add leonxlnx/taste-skill --copy -y -s design-taste-frontend`
  - `npx -y skills add pbakaus/impeccable --copy -y -s impeccable`
  - `npx -y skills add anthropics/skills --copy -y -s frontend-design`
  - `npx -y skills add vercel-labs/agent-skills --copy -y -s web-design-guidelines`
  - `npx -y skills add emilkowalski/skills --copy -y -s emil-design-eng`
