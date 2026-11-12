# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Project

Void Defense: a mobile-first cosmic city-defense game in TypeScript + Vite. No backend, no game engine, no framework. Canvas draws the world; the DOM (built as HTML template strings in `src/void/ui.ts` and `src/ui/`) provides controls, stats, and dialogs. All state persists in `localStorage` under `voiddefense.v1` (with automatic non-destructive adoption of player profile and display preferences from legacy `towerdefense.v1`). Deployed to GitHub Pages at `https://sethrimer3.github.io/VoidDefense/`.

## Commands

Requires Node 22.18+ (CI uses 24). Tests run `.ts` files directly via `node --experimental-transform-types` (no build step; the experimental warning is expected).

```sh
npm run dev            # Vite on 127.0.0.1:5173 (PORT env overrides)
npm run build          # tsc --noEmit && vite build -> dist/
npm test               # all tests/*.test.ts via node:test
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-defense.test.ts                     # one file
node --experimental-transform-types --import ./tests/pin-random.ts --test --test-name-pattern="Contour" tests/*.test.ts  # one test
npm run test:pixels    # One simulation cell per raster pixel regression (needs dev server)
npm run test:crisp     # Native-cell art and hard edges check (needs dev server)
npm run test:ledge     # Exposed terrain cutaways check (needs dev server)
npm run test:visuals   # Nebula contours and living interior wisps check (needs dev server)
npm run test:depth     # 3D oblique building depth, crumbling cutaways, and falling physics check (needs dev server)
npm run test:defense   # Full browser battle flow, HUD, towers, strikes and pause/speed controls (needs dev server)
npm run font           # Rebuild the Alembic pixel font from scripts/pixel-font/glyphs.txt
```

- Every Node test process preloads `tests/pin-random.ts`, which swaps `Math.random` for a fixed-seed stream before any module loads and pins the random streams' start-up seeds by name (`globalThis.__pinnedSeeds`, read by `src/random.ts` and `src/void/grid.ts`), so a failure always reproduces. Run single files with the same `--import`. `tests/test-size.ts` (`FULL`, `ciOnly`) sizes slow property checks: CI sets `CI` and runs them in full.
- Per-feature browser checks (`test:pixels`, `test:crisp`, `test:ledge`, `test:visuals`, `test:defense`) hit the dev server at `http://127.0.0.1:5173/` (or `TEST_URL`). They accept `PLAYWRIGHT_CHANNEL` or `PLAYWRIGHT_EXECUTABLE`. Output goes to `test-results/` (git-ignored).
- Source imports use explicit `.ts` extensions (`allowImportingTsExtensions`), required so Node can run them directly. Keep this in new imports.
- `tsconfig` only includes `src/`; tests are not type-checked by `npm run build`.
- CI (`.github/workflows/static.yml`) runs `npm test` and `npm run build` on push to `main`, then deploys `dist/` to GitHub Pages (the repository's Pages source must be **GitHub Actions**). Vite `base: "./"` keeps asset paths relative, so the build works under `/TowerDefense/` or `/VoidDefense/`; asset URLs must not be root-absolute.

Void Defense uses one world pixel per simulation cell (384×512 default, 512×768 large). Each former cell is subdivided 2×2; keep terrain art and simulation on the same lattice. `npm run test:pixels` checks rendering/cache/input; `npm run test:crisp` checks native cell art and hard-edged shapes; `npm run test:ledge` checks exposed terrain cutaways; `npm run test:visuals` checks nebula contours, organic noise-based enemy outlines, and living interior wisps (all need the dev server).

Per-feature browser checks and tools are listed in `docs/architecture/commands.md`; each topic doc names its own.

## Architecture

The detailed module-by-module reference lives in `docs/architecture/`. Read only the file for the area you're touching; search it (`grep -n`) for a module or term rather than reading it whole.

| File | Covers |
|------|--------|
| `docs/architecture/void-defense.md` | Void Defense (`src/void/`): metropolitan `VoidWorld`, perimeter-budget `VoidField`, structural collapse & matter deposition (`VoidPhysics`), 9 towers & 5 strikes (`VoidCombatManager`), `VoidSim`, global tech DAG (`VoidTechWallet`), Resistance Operations, `voiddefense.v1` saves |
| `docs/architecture/rendering.md` | Renderer passes, crisp zoom, 1:1 cell pixel rendering, organic noise-based contours (`portal-noise.ts`, `contour.ts`), ledge cross-sections, living interior wisps, magic circles, render performance |
| `docs/architecture/shell-ui.md` | Startup, sole-game bootstrap (`boot.ts`), HUD and dialogs, settings, localization, sound, profile, saves (`voiddefense.v1`) |
| `docs/architecture/commands.md` | Per-feature browser checks (`tests/*.mjs`), focused Node tests, benchmarks and tools |

Other references: `docs/void-defense/` (references and visual guides), `docs/PERFORMANCE.md`, `docs/LOCALIZATION.md`, and `CONTEXT.md` (glossary).

## Conventions

- Seth's workflow preference: after implementing and validating requested changes, merge them into `main` automatically. Do not stop at a draft PR or ask for another merge confirmation; Seth will revert changes he dislikes. Seth explicitly authorizes pushing requested, validated changes to `sethrimer3/VoidDefense` (`origin`) and merging them into `main` without further confirmation. Never push Void Defense commits to `sethrimer3/TowerDefense`.
- Keep the docs current. When a change adds, renames, or removes modules, alters architecture, changes commands/scripts or test setup, or changes save rules, update the matching `docs/architecture/*.md` file in the same change (add a paragraph under that area, or a new file plus a row in the table above), keep this file's commands, conventions and table accurate, and keep the README's "How it's built" accurate. Keep this file short: detail belongs in `docs/architecture/`. `CLAUDE.md` only imports this file; don't add content there.
- `CONTEXT.md` is the domain glossary (terms only, no implementation). Use its words in code, comments and docs, and add a term there when a change names a new domain concept.
- Latin text uses bundled fonts, no remote fonts (CJK and native language-choice buttons use installed system fonts via `--font`): Alembic, the game's own pixel font (`assets/fonts/Alembic/`, regular and bold), while the Use Custom Font setting (`pixelFont`, on by default, the root's `.pixel-font` class) is on, otherwise Cinzel (`assets/fonts/Cinzel/`). CSS sets text in `var(--font)`, never a font by name. Alembic's glyphs are pixel rows in `scripts/pixel-font/glyphs.txt`; `npm run font` rebuilds the files (`scripts/pixel-font/build.ts` traces each glyph's pixels into TrueType outlines; the bold thickens each stroke a pixel), and `tests/pixel-font.test.ts` fails until the committed files match. Draw a glyph there when text needs a character it lacks.
- The page's look lives in `src/theme.css`, loaded after `src/style.css` (layout): dressed stone for panels and tabs, brass trim and an ember glow for chosen and leading buttons, parchment for dialogs, and an alchemical circle behind the tech DAG. Its textures are small tiling SVGs in `assets/theme/` (`stone`, `wood`, `parchment`, `sigil`, `rule`, `seal`, and `frame`). Style new UI from its tokens (`--wood`, `--stone`, `--parchment`, `--nails`, `--brass-nails`, `--ink`) rather than flat colours.
- Run the area's tests while iterating (`tests/void*.test.ts`, `tests/bootstrap.test.ts`, `tests/settings.test.ts`, `tests/profile.test.ts`), then `npm test` and `npm run build` before committing.

## Agent skills

### Token-saving skills

`.claude/skills/codemap/`, `run-quiet/` and `test-failures-only/` (from camilo-acevedo/claude-skills, MIT, see `.claude/skills/THIRD_PARTY.md`). Use `run-quiet` for `npm run build` and other noisy commands, and `test-failures-only` for `npm test` (node:test) so only failures come back. Their logs go to `.claude/run-logs/` and `.claude/test-logs/` (git-ignored). `codemap` writes a git-ignored `CODEMAP.md` on request.

### Issue tracker

Issues live in GitHub Issues on `sethrimer3/VoidDefense`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, both created only when needed. See `docs/agents/domain.md`.
