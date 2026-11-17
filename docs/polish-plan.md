# Void Defense: Polish Plan (v2, for handoff)

Updated 2026-11-17 against `main` at `fcac337`. The first version of this plan (2026-11-13, `3bb506f`) listed 21 items. Most of them shipped on 2026-11-15 in a different shape than that plan proposed. This version keeps only what is still outstanding, rewrites those items for the code as it is now, and adds problems found in a fresh playthrough.

This file is written to be handed to another coding agent. Everything it needs is below or in the repository.

## How this was checked

- `npm test`: 107 of 107 pass. `npm run build`: clean.
- `npm run test:defense`: passes. Render p95 was 15.9 ms (Sector 03, 384×512) and 15.6 ms (Sector 06, 512×768) in a headless container.
- Played a fresh profile in headless Chromium at 1280×800 (desktop), 390×844 (phone portrait) and 844×390 (phone landscape): loading screen, title screen, Welcome dialog, Sector 01 coach, a full Sector 01 run at 2×, Tech Network, Resistance Ops, Resistance Map and Settings.

---

## Part 1: Repository context for the implementing agent

Read this before starting any item.

### What the game is

Void Defense is a mobile-first city-defense game in TypeScript and Vite. There is no backend, no game engine and no UI framework. A canvas draws the world; the DOM (HTML template strings in `src/void/ui.ts`) provides HUD, controls and dialogs. A violet Void spreads outward through a pixel-art futuristic city surrounded by farmland, and the player places towers and casts strikes to contain it. Saves live in `localStorage` under the key `voiddefense.v1`. It deploys to GitHub Pages from `main` (`sethrimer3/VoidDefense`).

### Where things live

| Area | Files |
|------|-------|
| Battle HUD, dialogs, title screen, coach, settings modal, outcome modal | `src/void/ui.ts`, styles in `src/void/void.css` |
| Old shared skin (still loaded) | `src/theme.css`, `src/style.css`, textures in `assets/theme/` |
| Simulation | `src/void/sim.ts`, `src/void/void-field.ts`, `src/void/physics.ts`, `src/void/world.ts` |
| Towers, strikes, organisms | `src/void/towers.ts` (`TOWER_SPECS`: 16 towers, `STRIKE_SPECS`: 6 strikes) |
| Sectors | `src/void/maps.ts` (`SCENARIOS`) |
| Scoring and rewards | `src/void/scoring.ts` |
| Rendering | `src/void/render.ts`, `contour.ts`, `interior.ts`, `elevation.ts`, `pixel-painter.ts`, `farms.ts` |
| Audio | `src/void/audio.ts` (procedural Void SFX), `src/sound.ts` + `src/sound-files.ts` (legacy sampled sounds) |
| Tech Network | `src/void/tech/catalog.ts` (63 nodes), `tech-ui.ts`, `wallet.ts`; graph widget `src/ui/upgrade-graph.ts` |
| Resistance Ops / Map | `src/void/operations/`, `src/void/map/` |
| Saves and settings | `src/void/save.ts`, `src/settings.ts` |
| Localization | `src/i18n/` (mostly legacy text from the old medieval game) |
| Architecture docs | `docs/architecture/*.md` (read only the file for your area) |
| Glossary | `CONTEXT.md` |

### Commands

Node 22.18 or newer.

```sh
npm install
npm run dev            # Vite on http://127.0.0.1:5173
npm test               # all tests/*.test.ts (node:test, runs .ts directly)
npm run build          # tsc --noEmit && vite build
npm run test:defense   # browser battle flow + screenshots in test-results/ (needs dev server)
npm run test:pixels | test:crisp | test:ledge | test:visuals | test:farms | test:depth   # visual checks (need dev server)
```

Browser checks write screenshots to `test-results/` at 1280×800, 390×844 and 844×390. Use them as before/after evidence.

### Rules that apply to every item

1. **Pixel art in code, at whole-pixel scale.** All world and UI art is drawn in code. No image sprites, no fractional pixel positions, no smoothing. One world pixel is one simulation cell. Keep the look consistent: farmland outside, a futuristic city, and the violet Void.
2. **Deterministic rendering.** Golden tests compare pixels across Node versions. Do not use `Math.random()` in rendering; use the named streams in `src/random.ts`. Avoid floating-point math whose result can differ between engines in anything a golden test captures (prefer integer math and the existing helpers).
3. **Imports use explicit `.ts` extensions** (`import { x } from "./foo.ts"`). Node runs the sources directly.
4. **Text uses `var(--font)`**, never a font name. The pixel font is Alembic; if a glyph is missing, add it to `scripts/pixel-font/glyphs.txt` and run `npm run font`.
5. **Save compatibility.** Never rename internal ids (tower ids, strike ids, tech node ids, save keys). Rename only player-facing `name`, `shortName` and `description`. New save fields must be optional and decoded in `decodeVoidSave` with a safe default.
6. **Docs.** When you add, rename or remove a module, command or save field, update the matching `docs/architecture/*.md` in the same commit. Keep `AGENTS.md` short; detail belongs in `docs/architecture/`. `CLAUDE.md` only imports `AGENTS.md`; do not edit it. Use `CONTEXT.md` terms.
7. **Before you finish an item:** run `npm test` and `npm run build`, run `npm run test:defense`, and look at the desktop, portrait and landscape screenshots. Then commit to `main` and push (the owner's standing preference is to merge finished, validated work straight to `main` and delete any branch afterwards).
8. One item per session and per commit. Each item below is independent unless it says otherwise.

---

## Part 2: What already shipped (do not redo)

These items from the first plan are done. They are listed so you do not rebuild them. Where a follow-up is needed, it is a separate item in Part 3.

| Old # | Item | State now |
|---|---|---|
| 1 | Style inspector and outcome modal | Done. Desktop inspector sits in a right-side panel; phones use a bottom sheet. Outcome is a centred modal with Spark icons, preserved %, sector best, rewards and three buttons. |
| 2 | Hold the battle until ready | Done. Runs start in a prep state with **Start Battle**; time stays 0.0s while the Welcome dialog is open. |
| 3 | Fix onboarding dialog | Done. Titled "Welcome, Commander", sci-fi emblem, readable contrast. (Landscape overflow: see item 3 below.) |
| 4 | Phone HUD layout | Mostly done. Compact one-row header, scrollable tower dock with edge fade. Leftovers in item 3. |
| 5 | Desktop side panel | Done at ≥1000 px: sector, command, telemetry, inspector. |
| 6 | Guided first sector | Done. 4-step coach, `coachDone` saved in `voiddefense.v1`. Copy and placement follow-ups in item 3. |
| 7 | Combat SFX | Done in `src/void/audio.ts` (`uiClick`, `towerPlace`, `towerSell`, `towerUpgrade`, `cannonFire`, `shellImpact`, `collapse`, `voidConsume`, `unitDeath`, `strikeCast`, `victory`, `defeat`). Battle buttons still call legacy cues: item 5. |
| 8 | Title and loading screen | Done. Title screen with skyline and rising Void, New Game / Continue / Settings; loading screen shows the logo. |
| 9 | Settings page | Done. Gear-button modal with Master / SFX / Ambience sliders; Developer Mode only with `?dev=1`. No language picker yet (item 7). |
| 10 | Tech Network framing | **Not done in practice.** See item 1. |
| 11 | Sci-fi UI skin pass | Mostly done for visible screens; old textures and tokens remain in `src/theme.css`. See item 6. |
| 12 | Rename medieval leftovers | Mostly done (Solar Anchor, Repair Depot, Beacon Drone Post, Stasis Beacon, fictional sector names). Leftovers in item 4. |
| 13 | Outcome tiers | Done (City Lost / Pyrrhic Containment / Breach Contained / Flawless Defense). Tier thresholds need balance: item 2. |
| 14 | Placement and big-moment feedback | Done (placement dust/ring, floating +N Supplies, end flash, Reduce Motion respected). |
| 15 | Late Supplies sink | Partly done: towers upgrade Lv 1–3 in the inspector. Income still piles up: item 2. |
| 16 | Large-map render perf | Done for now (p95 ≈ 15.6–15.9 ms). Watch item 11. |

`docs/release-polish.md` in the repo is the checklist that tracked this work. Its Verification section is still unticked; item 9 closes it out.

---

## Part 3: Outstanding work, prioritized

| # | Item | Priority | Size |
|---|------|----------|------|
| 1 | Tech Network: frame the graph and make it readable | P0 | M |
| 2 | Balance: idle runs should not win, Supplies should not pile up | P0 | M |
| 3 | Phone layout and coach leftovers | P1 | S |
| 4 | Finish the medieval-name sweep | P1 | S |
| 5 | Route battle UI sounds through the Void audio engine | P1 | S |
| 6 | Remove the old medieval skin from `theme.css` | P2 | M |
| 7 | Localize the Void UI | P2 | L |
| 8 | Music | P2 | M |
| 9 | Docs, README, glossary and repo tidy | P2 | M |
| 10 | Remove dead legacy code and assets | P3 | M |
| 11 | Render performance headroom | P3 | M |
| 12 | Release polish: share card, offline, icons | P3 | S |

---

### 1. Tech Network: frame the graph and make it readable (P0, M)

**Problem.** On the Global Tech Network tab (1280×800), the 63 nodes sit in a clump at the bottom-left of the canvas and run off the bottom edge. A large dashed-line constellation fills the middle of the canvas and is the most prominent thing on screen, while the nodes themselves are small and their labels are unreadable (a few screen pixels tall). Pressing **Fit View** does not change the framing. On 390×844 the toolbar (title, blurb, currency line, sector select, search, Fit View, Refund All) takes the top third of the screen and the graph is a small blob in the middle; the detail sheet takes the bottom half.

**Files.** `src/void/tech/tech-ui.ts` (page, toolbar, holographic backdrop `HoloGridBackdrop`, detail panel), `src/ui/upgrade-graph.ts` (pan/zoom/fit, node and label drawing), `src/void/void.css`.

**Do.**
- Make the initial view and **Fit View** compute the bounding box of the visible nodes (respecting the sector filter) and fit it to the canvas with padding. Find why Fit View currently has no effect (likely it fits a different bounds, such as the backdrop's, or runs before the canvas has its size) and fix the cause.
- Centre the backdrop on the node cluster and make it clearly secondary: lower opacity, thinner lines, behind nodes. Nodes and their edges must be the brightest things on the canvas.
- Labels: draw at a minimum 10 px on screen; below the zoom where that does not fit, hide labels and show the hovered or tapped node's name in a tooltip.
- Phones (<700 px wide): collapse the toolbar into one row (currency + a filter button that opens sector select, search and Refund All), so the graph gets at least 55% of the viewport height.

**Done when.** At 1280×800 and 390×844, every node is inside the canvas after load and after Fit View, labels are legible at the default zoom on desktop, and the backdrop no longer competes with the nodes. Add an assertion to `tests/void-defense.mjs` that, after Fit View, every node's screen position is within the graph canvas. `npm test`, `npm run build`, `npm run test:defense` pass.

---

### 2. Balance: idle runs should not win, Supplies should not pile up (P0, M)

**Problem.** On a fresh profile, Sector 01 played with **zero towers placed** ended after 96 s as "Pyrrhic Containment" with 23.3% of the city preserved, +480 Void Essence and +1 Spark. Supplies reached 24,294 unspent. So the tutorial sector is won by doing nothing, and income still dwarfs what the player can spend, even with the new Lv 2–3 tower upgrades.

**Files.** `src/void/scoring.ts` (preserved %, Sparks, Essence, outcome tier), `src/void/sim.ts` (income tick, end conditions), `src/void/maps.ts` (per-sector parameters such as Void energy), `src/void/towers.ts` (costs, `upgradePrice`), `renderOutcomeBanner` in `src/void/ui.ts`.

**Do.**
- Decide and document a loss threshold: below it (suggest 35% preserved, tune per sector if needed) the outcome is "City Lost", with no Spark and reduced Essence. Pyrrhic Containment starts above it.
- Scale Supplies income so a greedy player who spends as soon as they can ends Sector 01 with under 3,000 unspent. Options: income proportional to surviving buildings with diminishing returns over time, or a cap on banked Supplies shown in the HUD. Pick one and explain it in the commit message.
- Keep Sector 01 winnable for a new player who follows the coach (one Matter Cannon, one Repair Depot, one Solar Anchor).

**Done when.** New tests in `tests/void-defense.test.ts` (deterministic, headless `VoidSim` runs) show: an idle Sector 01 run ends as City Lost with 0 Sparks; a scripted "coach" run (place what the coach suggests at fixed cells, cast Solar Anchor once) earns at least 1 Spark; a greedy-spend run ends with under 3,000 unspent Supplies. Update `docs/architecture/void-defense.md` with the thresholds. `npm test`, `npm run build`, `npm run test:defense` pass.

---

### 3. Phone layout and coach leftovers (P1, S)

**Problems.**
- **Landscape 844×390:** the Welcome dialog is taller than the screen; its **Enter Command** button sits at y ≈ 454–490 px, below the 390 px viewport. Confirm whether the dialog scrolls; either way it must fit or scroll with the button reachable.
- **Landscape battle:** the progress bar and the telemetry pill overlap the top of the map, and the map uses about 62% of the height.
- **Portrait 390×844 battle:** there is an empty band (about 60 CSS px) between the Start/Speed/Retry row and the top of the map. With a tower selected, the inspector bottom sheet covers the lower quarter of the map.
- **Portrait coach:** the coach callout is drawn on top of the Start Battle / speed / Retry row, hiding those buttons.
- **Coach copy:** step 2 says "tap near the Void frontier to fire synthetic land pellets". Use plain words, for example "Pick **Matter** below, then tap a spot near the Void's edge. The cannon fires matter back into the Void and rebuilds the ground."

**Files.** `src/void/ui.ts` (Welcome dialog, coach steps, HUD markup), `src/void/void.css` (media queries).

**Done when.** In the `npm run test:defense` screenshots plus a fresh-profile capture: landscape Welcome dialog's button is reachable; nothing overlaps the map's top edge in landscape and the map uses at least 75% of the height; no empty band in portrait; the coach callout never covers HUD buttons; the portrait inspector is compact (one row of buttons) or collapses to a chip. `npm test`, `npm run build` pass.

---

### 4. Finish the medieval-name sweep (P1, S)

**Remaining player-facing leftovers.**
- Tech node `masonThroughput` is named "Automated Exosuit Masons" (`src/void/tech/catalog.ts` ~line 144). Rename the display name only (for example "Automated Repair Crews").
- Sector 03 is "Midtown Spire Plaza" (`src/void/maps.ts` ~line 44). "Midtown" reads as a real Manhattan place; pick an invented district name for consistency with the other renamed sectors.
- Check every `name`/`description`/coach/tooltip string in `src/void/` for "Mason", "Hearthseed", "Lantern", "Bell", "seed", "keep", "castle" and similar. Comments and internal ids may stay.

**Done when.** `grep -rniE "mason|hearthseed|lantern|bell|midtown|manhattan|hudson" src/void --include=*.ts` finds only internal ids, field names and comments, never a player-visible string. `npm test`, `npm run build` pass.

---

### 5. Route battle UI sounds through the Void audio engine (P1, S)

**Problem.** Battle UI buttons still call the legacy sampled cues `play("stone")` and `play("knock")` from `src/sound.ts` (`src/void/ui.ts` lines ~354, 362, 621, 632, 1208, 1214, 1220). Those are medieval stone and wood samples. `src/void/audio.ts` already has a procedural `uiClick` cue that respects the Master/SFX sliders.

**Do.** Replace those calls with the Void audio cues (`uiClick` for buttons; add a softer `uiBack`/`uiToggle` variant if useful). Make sure the first user gesture still unlocks the AudioContext.

**Done when.** `grep -n 'play("' src/void/` returns nothing; all UI clicks respect the SFX slider; `npm test`, `npm run build` pass; `docs/architecture/shell-ui.md` lists the cues used.

---

### 6. Remove the old medieval skin from `theme.css` (P2, M)

**Problem.** The visible screens now use the steel and amber style from `src/void/void.css`, but `src/theme.css` (2,376 lines) still defines the medieval skin: `--wood`, `--stone`, `--parchment` texture tokens, wax `seal.svg`, `sigil.svg` alchemical circles (lines ~20–23, 1035, 1045, 1711, 1813). Some of it is probably dead and some may still leak into edge screens. `AGENTS.md`'s conventions bullet still describes "dressed stone … parchment … an alchemical circle behind the tech DAG", which is now wrong. The Resistance Map frame still has brass corner nails.

**Files.** `src/theme.css`, `src/style.css`, `assets/theme/*.svg`, `src/void/void.css`, `AGENTS.md`.

**Do.** Find which rules in `theme.css`/`style.css` still match elements the Void game renders (check in the browser on every tab and dialog). Move what is used into `void.css` with sci-fi tokens (for example `--panel`, `--steel`, `--amber`, `--cyan`, `--void`), delete the rest, and delete unused `assets/theme/*.svg`. Rewrite the theme bullet in `AGENTS.md` in one or two lines.

**Done when.** No stone, parchment, wax-seal, sigil or brass-nail styling is visible anywhere at 1280×800 or 390×844 (screenshot every tab plus Welcome, Settings, outcome); CSS bundle is smaller (report before/after from `npm run build`); `npm test`, `npm run build`, all `npm run test:*` browser checks pass.

---

### 7. Localize the Void UI (P2, L)

**Problem.** All Void UI text in `src/void/ui.ts`, `src/void/tech/`, `src/void/map/`, `src/void/operations/`, `src/void/towers.ts`, `src/void/maps.ts` and `src/void/tech/catalog.ts` is hard-coded English. `src/i18n/` holds mostly legacy medieval text (`siege.ts`, `ambush.ts`, `building-menu.ts`). The Settings modal has no language picker.

**Do.** Follow `docs/LOCALIZATION.md`. Add `src/i18n/void.ts` with keys for all Void UI strings and wire it through the existing `translate()` machinery and language list. Add a Language select to the Settings modal. Keep English as the source; machine-quality translations are acceptable as a first pass if marked as such in the doc.

**Done when.** Switching language changes the HUD, tabs, dialogs, coach, outcome modal and tech panel; a test fails if a key is missing in any language; `npm test`, `npm run build` pass; `docs/LOCALIZATION.md` and `docs/architecture/shell-ui.md` updated. Do item 10's i18n deletions after this item, not before.

---

### 8. Music (P2, M)

**Problem.** There is no music. Only the procedural drone and SFX play.

**Do.** Add a procedural, low-CPU ambient score (Web Audio, no new audio files) in a new `src/void/music.ts`: a calm pad on the title screen and between runs, a tenser layer during battle that rises with Void frontier contacts, and a short resolve on victory or defeat. Add a Music volume slider to Settings (new optional `musicVolume` setting in `src/settings.ts`, default around 50). Any randomness must come from a named stream in `src/random.ts`.

**Done when.** Music plays and crossfades between title, battle and outcome; the slider persists across reload (cover in `tests/void-defense.test.ts`); CPU impact is negligible in `npm run test:defense`'s benchmark; docs updated.

---

### 9. Docs, README, glossary and repo tidy (P2, M)

**Problems.**
- `README.md` "How to play" lists towers and strikes that do not exist (Kinetic Cannon, Laser Battery, EMP Emitter; strikes Orbital Strike, EMP Blast, Nanite Swarm, Kinetic Drop, Singularity Inversion) and says 33 tech nodes. The code has 16 towers and 6 strikes in `src/void/towers.ts` and 63 nodes in `src/void/tech/catalog.ts`.
- `CONTEXT.md` (896 lines) is still the glossary of the old medieval tower defense (walkers, Drowned Temple creatures, wizard towers, mines). It should define Void Defense terms.
- `AGENTS.md` says "9 towers & 5 strikes"; `docs/architecture/void-defense.md` still says "Mason Depot" and lists old strikes.
- Planning files clutter the repo root: `3dPlan.md`, `VoidDefensePlan.md`, `VoidDefence.md`, `TurretAndStrikeIdeas.md`, `ToDo.md`. `docs/void-defense-progress.md` has stale numbers. `docs/release-polish.md` has an unticked Verification section.

**Do.** Rewrite README "How to play" and "How it's built" from the code. Replace `CONTEXT.md` with a Void Defense glossary (Void, frontier, perimeter budget, Supplies, Void Essence, Sparks, sector, Build Under Siege, Build & Watch, each tower and strike, Resistance Ops, Resistance Map, coach). Fix counts and names in `AGENTS.md` (keep it short) and `docs/architecture/*.md`. Move the root planning files and `docs/release-polish.md` into `docs/archive/` and fix links. Refresh `docs/void-defense-progress.md` from `test-results/void-defense-report.json`.

**Done when.** Every tower and strike named in README and `CONTEXT.md` exists in code with the same player-facing name; the repo root holds only README, AGENTS, CLAUDE, CONTEXT and config files; `npm test`, `npm run build` pass.

---

### 10. Remove dead legacy code and assets (P3, M)

**Candidates (prove each is unused before deleting).**
- `public/assets/sounds/` (7.3 MB of medieval clips: arrow hits, sword punches, fireballs, wooden houses, keep collapse, boat splashes) and their entries in `src/sound-files.ts`. Keep any clip the Void game actually plays, or that a reworked cue could reuse (for example a large explosion for skyscraper collapse); otherwise delete.
- Legacy cues in `src/sound.ts` once item 5 is done.
- `src/i18n/siege.ts`, `ambush.ts`, `building-menu.ts` once item 7 is done (note `src/i18n/index.ts` imports `building-menu.ts`, and `src/settings.ts` mentions `MenuSizing`).
- `src/magic-circle/` (only imported by `src/ui/upgrade-graph.ts`; check whether the Tech Network still draws it after item 1), `src/ui/tree-motes.ts`, `src/ui/branch-art.ts`, `src/ui/farmland-bar.ts`, `src/ui/path-icons.ts` if unused.
- Unused settings in `src/settings.ts` left from the old game.

**Done when.** `npm test`, `npm run build` and every `npm run test:*` browser check pass; `dist/` size before/after is reported in the commit message; `docs/architecture/*.md` no longer mention removed modules.

---

### 11. Render performance headroom (P3, M)

**Problem.** Render p95 is 15.6–15.9 ms in the headless benchmark, right at the 16 ms frame budget, and the Sector 06 (512×768) map is the heaviest. Phones will drop frames in busy moments.

**Do.** Profile with `npm run test:defense`'s benchmark and `docs/PERFORMANCE.md`. Look for per-frame work that can be cached or skipped: static layers, off-screen chunks, debris and dust draw caps, contour recomputation when the frontier has not changed. Do not change the look; golden and visual checks must still pass.

**Done when.** `test-results/void-defense-report.json` shows `renderP95Ms` ≤ 12 for both benchmark sectors; `npm run test:pixels`, `test:crisp`, `test:depth`, `test:visuals` pass; `docs/PERFORMANCE.md` has the new numbers.

---

### 12. Release polish: share card, offline, icons (P3, S)

**Do.** Add `og:title`, `og:description`, `og:image` and `twitter:card` meta to `index.html` with a 1200×630 image in `public/` captured with Playwright from the title screen. Add a small service worker that caches built assets so the PWA in `public/manifest.webmanifest` works offline (paths must stay relative because Vite `base` is `"./"`). Check `public/favicon.ico`, `GameIcon*.png` and `apple-touch-icon.png` show the Void emblem, not legacy art.

**Done when.** The game loads offline after one visit from `npm run preview`; Lighthouse reports the PWA as installable; `npm test`, `npm run build` pass; `docs/architecture/shell-ui.md` mentions the service worker.

---

## Definition of "finished"

- A new player opens the link, sees the title screen, gets through Sector 01 with the coach, and understands why they won or lost. Doing nothing loses.
- Every screen is styled and nothing overlaps at 1280×800, 390×844 or 844×390. The map uses most of the screen on phones, and the Tech Network shows the whole graph legibly.
- Every player action and every big world event has a sound, and there is music.
- No medieval names, textures or sounds remain in what the player sees or hears, and none remain in the code that ships.
- Render p95 has headroom under 16 ms for the largest sector.
- README, `AGENTS.md`, `CONTEXT.md` and `docs/architecture/` match the game.
