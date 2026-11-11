# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Project

Tower Defense: a mobile-first city-defense game in TypeScript + Vite. No backend, no game engine, no framework. Canvas draws the board; the DOM (built as HTML template strings in `src/ui/` and `src/defend/ui.ts`) provides controls, stats, and pages. All state persists in `localStorage` under `towerdefense.v1`. Deployed to GitHub Pages at `https://sethrimer3.github.io/VoidDefense/`.

## Commands

Requires Node 22.18+ (CI uses 24). Tests run `.ts` files directly via `node --experimental-transform-types` (no build step; the experimental warning is expected).

```sh
npm run dev            # Vite on 127.0.0.1:5173 (PORT env overrides)
npm run build          # tsc --noEmit && vite build -> dist/
npm test               # all tests/*.test.ts via node:test
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/defend-replay.test.ts                     # one file
node --experimental-transform-types --import ./tests/pin-random.ts --test --test-name-pattern="Smithy" tests/*.test.ts  # one test
npm run test:pointer   # Defend board pointer gestures vs tests/fixtures/defend-pointer.golden.json (needs `npm run dev` running)
npm run test:performance # Browser crowd benchmark, 500 through 10,000 enemies (needs dev server)
npm run test:stress      # Tower/units/effects stress scene; Chrome profiles and JSON (needs dev server)
npm run test:stress-ui   # Full battle page, HUD and frame overlay (needs dev server)
npm run test:render-cache # Original-vs-cached pixels, invalidation and memory bounds (needs dev server)
npm run export-sprites # Every redrawable sprite as a 1:1 PNG with no outline, to art/export/ with manifest.json (needs dev server)
npm run font           # Rebuild the Alembic pixel font from scripts/pixel-font/glyphs.txt
```

- Every Node test process preloads `tests/pin-random.ts`, which swaps `Math.random` for a fixed-seed stream before any module loads and pins the random streams' start-up seeds by name (`globalThis.__pinnedSeeds`, read by `src/random.ts` and `src/defend/grid.ts`), so a failure always reproduces. Run single files with the same `--import`. `tests/test-size.ts` (`FULL`, `ciOnly`) sizes slow property checks: CI sets `CI` and runs them in full.
- `test:pointer` defaults to installed Microsoft Edge (the stress and render-cache scripts to installed Chrome); set `PLAYWRIGHT_CHANNEL=chrome`, or `PLAYWRIGHT_EXECUTABLE=/path/to/chrome` (in the cloud container: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), which every browser script accepts. It hits the dev server at `http://127.0.0.1:5173/` (or `TEST_URL`) and seeds state by writing the `towerdefense.v1` save into localStorage. Its hashes depend on the page layout and machine: when a change moves the page, record it with `UPDATE_GOLDEN=1` on the unchanged code first, then compare. Output goes to `test-results/` (git-ignored).
- Source imports use explicit `.ts` extensions (`allowImportingTsExtensions`), required so Node can run them directly. Keep this in new imports.
- `tsconfig` only includes `src/`; tests are not type-checked by `npm run build`.
- CI (`.github/workflows/static.yml`) runs `npm test` and `npm run build` on push to `main`, then deploys `dist/` to GitHub Pages (the repository's Pages source must be **GitHub Actions**). Vite `base: "./"` keeps asset paths relative, so the build works under `/TowerDefense/`; asset URLs must not be root-absolute.

Void Defense uses one world pixel per simulation cell (384×512 default, 512×768 large). Each former cell is subdivided 2×2; keep terrain art and simulation on the same lattice. `node tests/void-pixels.mjs` checks rendering/cache/input; `node tests/void-crisp.mjs` checks native cell art and hard-edged shapes; `node tests/void-ledge.mjs` checks exposed terrain cutaways (all need the dev server).

Per-feature browser checks and tools are listed in `docs/architecture/commands.md`; each topic doc names its own.

## Architecture

The detailed module-by-module reference lives in `docs/architecture/`. Read only the file for the area you're touching; search it (`grep -n`) for a module or term rather than reading it whole.

| File | Covers |
|------|--------|
| `docs/architecture/defend-core.md` | `DefendSim`, step order, exact arithmetic and replays, targeting, contact, city layout/`citygen`, the Defend page, pointers and edit sessions, randomness |
| `docs/architecture/defend-buildings.md` | Basic buildings, attunements, branch buildings, ultimates (Hero, Shadow, C4, Revolutionary…), keep/wall/gate/ballista trees, deployment and rally points, repair shops, building orders and menu |
| `docs/architecture/defend-play.md` | Defend controls, starting waves, areas and weather (Crystal Caves, Magic Forest, desert), strike spells, war banner, fortresses, boats, zone enemies, developer controls |
| `docs/architecture/blight.md` | Dark One enemies: Darklings, Blight worms and broods, flying Blight, Blight fortresses/ships/plasma, aura, packing and Blight performance |
| `docs/architecture/rendering.md` | Renderer passes, lighting/light field, crisp zoom, outlines and contours, artist sprites and export, forest, city night life, water, capes, facing, motes, magic circles, render performance |
| `docs/architecture/ambush.md` | Ambush levels, tracks, rivers, outposts, gates, economy, waves, star tree, sidebar, validation |
| `docs/architecture/siege.md` | Raid battle, native castles, DPS estimates, calibration, mana, entry/matches, ranks, identities, sky, colours, flags, victory, troop orders |
| `docs/architecture/economy.md` | Mine, Library, lab, metals, Knowledge, timed upgrade work, progression, Realm workshops, economy tiles/trees, shared day clock, window sunlight |
| `docs/architecture/shell-ui.md` | Startup, shell and currency bar, settings, localization, rooms and Tiles, sound, profile, tab icons, viewport, scroll arrows, saves |
| `docs/architecture/void-defense.md` | Void Defense (`src/void/`): metropolitan `VoidWorld`, perimeter-budget `VoidField`, structural collapse & matter deposition (`VoidPhysics`), 9 towers & 5 strikes (`VoidCombatManager`), `VoidSim`, global tech DAG (`VoidTechWallet`), Resistance Operations, `voiddefense.v1` saves |
| `docs/architecture/commands.md` | Every per-feature browser check (`tests/*.mjs`), focused Node tests, benchmarks and tools |

Other references: `docs/DEFEND.md` (game design), `docs/design/`, `docs/upgrades/`, `docs/art/`, the `*_PERFORMANCE.md` notes in `docs/`, and `CONTEXT.md` (glossary).

## Conventions

- Seth's workflow preference: after implementing and validating requested changes, merge them into `main` automatically. Do not stop at a draft PR or ask for another merge confirmation; Seth will revert changes he dislikes. Seth explicitly authorizes pushing requested, validated changes to `sethrimer3/VoidDefense` (`origin`) and merging them into `main` without further confirmation. Never push Void Defense commits to `sethrimer3/TowerDefense`.
- Keep the docs current. When a change adds, renames, or removes modules, alters architecture, changes commands/scripts or test setup, or changes save rules, update the matching `docs/architecture/*.md` file in the same change (add a paragraph under that area, or a new file plus a row in the table above), keep this file's commands, conventions and table accurate, and keep the README's "How it's built" accurate. Keep this file short: detail belongs in `docs/architecture/`. `CLAUDE.md` only imports this file; don't add content there.
- `CONTEXT.md` is the domain glossary (terms only, no implementation). Use its words in code, comments and docs, and add a term there when a change names a new domain concept.
- Latin text uses bundled fonts, no remote fonts (CJK and native language-choice buttons use installed system fonts via `--font`): Alembic, the game's own pixel font (`assets/fonts/Alembic/`, regular and bold), while the Use Custom Font setting (`pixelFont`, on by default, the root's `.pixel-font` class) is on, otherwise Cinzel (`assets/fonts/Cinzel/`). CSS sets text in `var(--font)`, never a font by name. Alembic's glyphs are pixel rows in `scripts/pixel-font/glyphs.txt`; `npm run font` rebuilds the files (`scripts/pixel-font/build.ts` traces each glyph's pixels into TrueType outlines; the bold thickens each stroke a pixel), and `tests/pixel-font.test.ts` fails until the committed files match. Draw a glyph there when text needs a character it lacks.
- The page's look lives in `src/theme.css`, loaded after `src/style.css` (layout): dressed stone for the hall and tabs, oak boards nailed at the corners for buttons and panels, brass trim and an ember glow for chosen and leading buttons, red lacquer for danger, parchment for dialogs, banners, the Defend settings and tooltips, and an alchemical circle behind the skill trees. Its textures are small tiling SVGs in `assets/theme/` (`stone`, `wood`, `parchment`, `sigil`, `rule`, `seal`, and `frame`, the board's iron corner brackets). Style new UI from its tokens (`--wood`, `--stone`, `--parchment`, `--nails`, `--brass-nails`, `--ink`) rather than flat colours.
- Goldens (`tests/fixtures/*.golden.json`) pin current output; an intended change to city generation, the battle, fences or saves fails them until re-recorded with `UPDATE_GOLDEN=1`. Re-record as part of that change and say which and why in the commit message. A refactor re-records nothing.
- Run the area's tests while iterating (`tests/defend*.test.ts` for Defend, `tests/mine.test.ts` for the Mine, `tests/library.test.ts` for the Library, `tests/progression.test.ts tests/settings.test.ts` for progression and saves), then `npm test` and `npm run build` before committing.

## Agent skills

### Adding an upgrade

`.claude/skills/add-upgrade/` defines a new Armory upgrade (shown in the Smithy below the Mine), Smithy row (Training in code) or skill-tree node: it records a spec and implements directly, with tests and docs. The user permits implementing first and revising afterward; do not pause for separate spec approval unless the user requests it. Its `references/panels.md` describes each panel; keep it current when those mechanisms change.

### Mode plans

`docs/plans/` holds the agreed plans for each game mode: `AmbushPlan.md` (phased Ambush rebuild: level select, zone waves, outposts and stars, free build grid, gold upgrades, the star-funded Ambush tree), `SiegePlan.md` (ranks and divisions, Find Match, bots with player-like names and flags, native castles generated from a defensive-DPS budget anchored to the maxed ceiling, board name plates, the strike-spell mana experiment; Part 2: side outlines, the defender's flags and flag-bearers, the victory collapse, two minutes from day to night, no muster buildings, directing units), `DefendPlan.md`, and `OtherPlans.md` for work shared by every mode (fences as walls, the strike spell quick bar, tab icons, the currency bar, ropes). Read the relevant plan before working on a mode, and tick its phases as they land.

### Token-saving skills

`.claude/skills/codemap/`, `run-quiet/` and `test-failures-only/` (from camilo-acevedo/claude-skills, MIT, see `.claude/skills/THIRD_PARTY.md`). Use `run-quiet` for `npm run build` and other noisy commands, and `test-failures-only` for `npm test` (node:test) so only failures come back. Their logs go to `.claude/run-logs/` and `.claude/test-logs/` (git-ignored). `codemap` writes a git-ignored `CODEMAP.md` on request.

### Issue tracker

Issues live in GitHub Issues on `sethrimer3/TowerDefense`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, both created only when needed. See `docs/agents/domain.md`.
