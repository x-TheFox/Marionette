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
