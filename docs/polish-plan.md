# Void Defense: Polish Plan

What the game needs to look and feel professional and finished, from a review on 2026-11-13 of `main` at `3bb506f`. Each work item ends with a short prompt you can paste into Claude or Gemini. The prompts name files and a finish line, and skip background the agent can read in `AGENTS.md`.

## How this review was done

- Read the source (`src/void/`, `src/ui/`, CSS, sound, i18n) and the docs.
- `npm test`: 106 of 106 pass. `npm run test:defense`: passes.
- Played a fresh profile in headless Chromium at 1280×800 (desktop), 390×844 (portrait phone) and 844×390 (landscape phone): onboarding, a full run of Sector 01 at 3× speed, Tech Network, Resistance Ops and Resistance Map.

## The short version

The world art is the game's strength. The city, the Void, the Ops lab and the campaign map look good. What makes it feel unfinished is everything around the world: two panels have no styling at all, the battle starts before the player is ready, nothing teaches the game, almost nothing makes a sound, and the phone layout wastes most of the screen. Fix those, then the theme leftovers from the old medieval game, and the game will read as a product instead of a prototype.

## Observations

### What already works

- **City and Void art.** Varied buildings with 2.5D depth, roads, parks, farmland, and a Void with a starfield interior and glowing rim (`test-results/void-v1-city-overview.png`). Close-up the portrait and rim hold up at whole-pixel scale.
- **Resistance Ops scene.** Lit lab and engineering bay with good mood (`void-operations-desktop.png`).
- **Resistance Map.** Farmland patchwork with river, sector badges and a Void blot. Reads well.
- **Performance is acceptable.** Benchmark: 384×512 sim p50 2.6 ms, render p50 13 ms; 512×768 sim p50 4.3 ms, render p50 18.7 ms (p95 31 ms). The large map is over a 16 ms frame on desktop headless, so phones will drop frames there.
- **Tests and determinism.** Good coverage and pinned randomness.

### Bugs that make it look broken (P0)

1. **The tower/building inspector has no CSS.** `.void-inspector` (`src/void/ui.ts:238`) has no rule in any stylesheet. It renders as bare text and buttons pinned to the far top-left, half off the map on desktop and on top of the map on phones (`void-v3-active-battle.png`, `void-battle-portrait.png`, `void-battle-landscape.png`).
2. **The end-of-run banner has no CSS.** `[data-outcome-banner]` (`renderOutcomeBanner`, `src/void/ui.ts:888`) is unstyled text over the map, on top of the inspector. The single most important screen in a run looks like a debug print.
3. **The battle runs behind the first-launch dialog.** On a fresh profile the HUD shows `Time 3.0s` and 99.0% preserved while the onboarding dialog is still open. The player loses city before they can act.
4. **Onboarding dialog art collides.** The red wax seal sits on top of the title "Resistance Commander Onboarding", and the title and intro text are dim brown on dark blue (low contrast).

### First-time experience

- No title screen. The loading screen is an empty dark gradient with a tiny "loading." bar in the corner, then the game drops straight into a battle.
- The word "Onboarding" is developer language, and the seal is a castle icon.
- No tutorial. Sector 01 is called a tutorial but gives no hints: what Supplies are, where to place, what Masons or Hearthseed do. A run with one cannon placed ended as "VICTORY" with 28% of the city left.
- Mixed messages on outcome: 72% of the city lost is labelled "BREACH CONTAINED - VICTORY".

### HUD and layout

- **Phone portrait:** the header (title, four chips) takes about 300 of 844 px. Pause/Speed/Retry float over the map. The tower bar clips its last card (Hearthseed) with no scroll cue.
- **Phone landscape:** the map is a small column about one eighth of the screen; header and tab bar take the rest.
- **Desktop:** the map is a narrow column with large empty starfield on both sides. No side panel uses that space.
- Tab names are odd: the battle tab is "Defense Feed".
- Supplies pile up unspent (25,137 at the end of the test run). The economy gives the player nothing to do with income late in a run, or the HUD does not push them to spend it.
- **Settings are hidden** at the bottom of the Resistance Map page. No volume slider, no language picker, and "Developer Mode (Unlimited Supplies)" is offered to every player.

### Tech Network

- Nodes sit in a clump in the lower-left, overlapping the alchemical magic circle; Fit View does not frame them (`void-network-desktop.png`).
- Node labels are too small to read at default zoom.
- On phones the detail panel takes half the width and the graph is mostly cut off (`void-network-portrait.png`).

### Theme consistency

The game was converted from a medieval tower defense, and leftovers break the sci-fi city tone:

- **UI skin:** `src/theme.css` is "dressed stone, brass, parchment, alchemical circle" (see `AGENTS.md`). The battle HUD is steel and amber, but dialogs use a wax seal and parchment, and the Tech Network sits on an alchemical circle (`src/magic-circle/`).
- **Names:** "Hearthseed", "Masons" (Mason Depot), "Lantern Bearer", "Quarantine Bell" next to "Matter Cannon" and "Orbital Drop Squad".
- **Sounds:** `src/sound-files.ts` maps arrow hits, sword punches, fireballs, wooden houses and a keep collapse. UI clicks use cues named `stone` and `knock`.
- **Dead i18n:** `src/i18n/siege.ts`, `ambush.ts`, `building-menu.ts` are legacy text. The Void UI itself is hard-coded English, so the language setting does nothing in the actual game.
- **Real place names:** sector text says "Lower Manhattan", "Hudson Riverfront", "East River" while the map is invented farmland.

### Audio

- The only in-battle sound is a procedural drone (`src/void/audio.ts`). No cannon fire, impacts, building collapse, Void consumption, unit death, victory or defeat stings.
- No music.
- 7.3 MB of recorded clips ship in `public/assets/sounds/`, almost all for medieval events the game no longer has.

### Game feel

- Placing a tower gives no feedback beyond the range ring: no thump, flash, or dust.
- No screen-space juice on big moments (skyscraper collapse, portal closing, victory). Shake was recently reduced to only close collapses, which is fine; a flash or slow-mo on the final moment would help.
- No floating numbers or icons for Supplies income or rewards.

### Docs and repo hygiene

- README "How to play" lists towers and strikes that do not match the code (Kinetic Cannon, Laser Battery, EMP Emitter; the code has Matter Cannon, Mason Depot, Infantry Barracks and 16 towers, and 63 tech nodes, not 33).
- Five planning files clutter the repo root (`3dPlan.md`, `VoidDefensePlan.md`, `VoidDefence.md`, `TurretAndStrikeIdeas.md`, `ToDo.md`). `docs/void-defense-progress.md` has stale numbers.
- No social preview (`og:` meta), no offline service worker despite a manifest.

## Prioritized work items

Order matters: P0 first, then P1 in order. Each item is one agent session. Every prompt assumes the agent follows `AGENTS.md` (tests, build, docs, merge to `main`).

| # | Item | Priority | Size |
|---|------|----------|------|
| 1 | Style the inspector and end-of-run dialog | P0 | S |
| 2 | Hold the battle until the player is ready | P0 | S |
| 3 | Fix the onboarding dialog | P0 | S |
| 4 | Phone HUD layout | P1 | M |
| 5 | Desktop side panel | P1 | M |
| 6 | Guided first sector | P1 | M |
| 7 | Combat and UI sound effects | P1 | M |
| 8 | Title screen and loading screen | P1 | S |
| 9 | Settings page | P1 | S |
| 10 | Tech Network framing and readability | P1 | M |
| 11 | Sci-fi UI skin pass | P2 | L |
| 12 | Rename medieval leftovers | P2 | S |
| 13 | Outcome tiers and reward screen | P2 | S |
| 14 | Game feel: placement and big moments | P2 | M |
| 15 | Economy sink for late Supplies | P2 | M |
| 16 | Large-map render performance | P2 | M |
| 17 | Localize the Void UI | P3 | L |
| 18 | Music | P3 | M |
| 19 | Remove dead legacy code and assets | P3 | S |
| 20 | Docs, README and repo tidy | P3 | S |
| 21 | Release polish: share card, offline, favicon | P3 | S |

## Prompts

Paste one at a time. Each one is meant to be self-contained.

### 1. Style the inspector and end-of-run dialog (P0)

```
VoidDefense: `.void-inspector` (src/void/ui.ts ~line 238, filled in renderInspector) and `[data-outcome-banner]` (renderOutcomeBanner ~line 888) have no CSS, so they render as bare text at the top-left over the map. Style both in src/void/void.css using the existing steel/amber HUD tokens.
- Inspector: a compact panel anchored to the bottom of the map area above the tower bar (phone) or next to the selected tower (desktop), never covering the HUD.
- Outcome: a centered modal with a dim backdrop, title, preserved %, rewards and the three buttons; it hides the inspector while open.
Done when: screenshots at 1280×800, 390×844 and 844×390 (npm run test:defense writes them to test-results/) show both panels styled with no overlap; npm test and npm run build pass.
```

### 2. Hold the battle until the player is ready (P0)

```
VoidDefense: on a fresh profile the simulation runs while the onboarding dialog is open (HUD reaches "Time 3.0s"). In src/void/ui.ts and src/void/sim.ts, keep the sim paused while any modal is open, and start each run in a paused "Deploy" state with a clear "Start" button so the player can place towers first (Build Under Siege included). Pressing Start or placing the first tower begins the clock.
Done when: a Playwright check (add to tests/void-defense.mjs) shows Time 0.0s after 3 s with the dialog open, and the clock moves only after Start; npm test, npm run build pass.
```

### 3. Fix the onboarding dialog (P0)

```
VoidDefense: the first-launch dialog (search "Resistance Commander Onboarding" in src/void/ui.ts; styles in src/theme.css / src/void/void.css) has a wax seal overlapping the title and low-contrast brown intro text. Retitle it "Welcome, Commander", replace the castle seal with a small sci-fi emblem drawn in code (or remove it), give the title and intro text at least 4.5:1 contrast, and keep the callsign field and two mode cards.
Done when: screenshots at 1280×800 and 390×844 show no overlap and readable text; npm test, npm run build pass.
```

### 4. Phone HUD layout (P1)

```
VoidDefense: on 390×844 the battle header takes ~300 px, Pause/Speed/Retry overlap the map and the tower bar clips its last card; on 844×390 the map is a tiny column. Rework the media queries in src/void/void.css (and markup in src/void/ui.ts if needed):
- Portrait: one-row header (title shrinks to an icon, Supplies/Essence/Sparks as a single compact row, profile chip moves to a menu); speed controls in a slim row under the progress bar; tower bar scrolls horizontally with a visible edge fade.
- Landscape: header and tab bar collapse into a left rail so the map gets the full height.
Done when: in test-results/void-battle-portrait.png the map fills at least 65% of the height, and in void-battle-landscape.png at least 80% of the height; no clipped controls; npm test, npm run build pass.
```

### 5. Desktop side panel (P1)

```
VoidDefense: at 1280×800 the battle map is a narrow column with empty space on both sides. Use the right side for a fixed panel (src/void/ui.ts, src/void/void.css): sector name and goal, the selected tower's inspector, wave/organism warnings, and the speed controls. Keep the tower bar at the bottom. Hide the panel below 1000 px width.
Done when: test-results/void-battle-desktop.png shows the panel with no overlap on the map; npm test, npm run build pass.
```

### 6. Guided first sector (P1)

```
VoidDefense: Sector 01 (tutorialBreach in src/void/maps.ts) teaches nothing. Add a short step-by-step coach in src/void/ui.ts that runs only the first time a player plays it (store a flag in the voiddefense.v1 save via src/void/save.ts, with a migration default): 1) what the Void and Supplies are, 2) place a Matter Cannon (highlight its card and a suggested spot), 3) place Masons, 4) use Hearthseed, 5) press Start. Each step is one sentence in a small callout with Next/Skip, and waits for the action. Pause the sim during steps.
Done when: a test in tests/void-defense.test.ts covers the save flag; a Playwright run shows each callout; npm test, npm run build pass; docs/architecture/shell-ui.md mentions the coach.
```

### 7. Combat and UI sound effects (P1)

```
VoidDefense: the battle only has a drone (src/void/audio.ts); UI uses medieval cues ("stone", "knock" in src/sound.ts). Add procedural Web Audio sounds in code (no new files) in src/void/audio.ts for: tower placed, tower sold, cannon fire, shell impact, building collapse (scaled by height), Void consuming a cell (rate-limited), unit death, strike cast, victory sting, defeat sting, button press. Trigger them from src/void/sim.ts / towers.ts / physics.ts events, with a voice limit and distance-based volume from the camera centre. Respect settings.soundOff.
Done when: each event plays once per trigger without clipping at 3× speed with 40 units; npm test, npm run build pass; docs/architecture/void-defense.md lists the cues.
```

### 8. Title screen and loading screen (P1)

```
VoidDefense: the loading screen (src/ui/loading-screen.ts, src/loading.css, index.html) is an empty gradient with a small corner bar, and the game opens straight into a battle. Add a title screen: the city skyline with a slow Void rising behind it (drawn in code, whole pixels, reuse src/void/render.ts helpers where possible), the "VOID DEFENSE" logo in Alembic, and buttons Continue / New Run / Settings. Show the logo on the loading screen too.
Done when: screenshots at 1280×800 and 390×844 show the title screen; Continue resumes the last sector; npm test, npm run build pass.
```

### 9. Settings page (P1)

```
VoidDefense: settings live at the bottom of the Resistance Map page (renderMapPage in src/void/ui.ts). Move them to their own dialog opened from a gear button in the header. Add a master volume slider and separate SFX/ambience sliders (src/sound.ts gain nodes, saved in voiddefense.v1 via src/void/save.ts), keep reduce motion, magnifier and building height, and hide Developer Mode unless the URL has ?dev=1.
Done when: settings persist across reload (cover in tests/void-defense.test.ts); the Map page no longer shows settings; npm test, npm run build pass; docs/architecture/shell-ui.md updated.
```

### 10. Tech Network framing and readability (P1)

```
VoidDefense: in the Tech Network (src/void/tech/tech-ui.ts, src/ui/upgrade-graph.ts) nodes clump in the lower-left over the magic circle, Fit View does not frame them, and labels are unreadable. Make Fit View (and the initial view) frame all visible nodes with padding; centre the backdrop circle on the node cluster; draw labels at a minimum 10 px screen size or hide them below a zoom threshold and show on hover/tap; on screens under 700 px wide, show the detail panel as a bottom sheet instead of a side column.
Done when: test-results/void-network-desktop.png and void-network-portrait.png show the whole graph framed and legible; npm test, npm run build pass.
```

### 11. Sci-fi UI skin pass (P2)

```
VoidDefense: src/theme.css and assets/theme/*.svg give dialogs and menus a medieval skin (stone, parchment, wax seal, brass), clashing with the steel/amber battle HUD in src/void/void.css. Replace the textures with sci-fi equivalents drawn as small tiling SVGs (brushed steel, hazard stripe, circuit trace, riveted frame) and swap the alchemical circle behind the tech graph (src/magic-circle/) for a holographic grid or star chart. Keep the token names (--stone, --parchment, etc.) or rename them everywhere; keep Alembic as the font.
Done when: no parchment, wax seal or stone texture is visible on any page at 1280×800 or 390×844; AGENTS.md's theme bullet is updated; npm test, npm run build pass.
```

### 12. Rename medieval leftovers (P2)

```
VoidDefense: rename player-facing names that read as medieval: "Hearthseed" (strike), "Mason Depot"/"Masons", "Lantern Bearer", "Quarantine Bell" in src/void/towers.ts and any text in src/void/maps.ts, src/void/tech/catalog.ts, src/void/ui.ts. Suggest sci-fi names, keep internal ids unchanged so saves still load. Also replace real place names in src/void/maps.ts ("Lower Manhattan", "Hudson", "East River") with invented ones.
Done when: grep for the old names in src/ finds only ids/comments; CONTEXT.md and README match; npm test, npm run build pass.
```

### 13. Outcome tiers and reward screen (P2)

```
VoidDefense: a run that loses 72% of the city is titled "BREACH CONTAINED - VICTORY" (renderOutcomeBanner, src/void/ui.ts). Title the result by Sparks tier (e.g. 0: "City Lost", 1: "Pyrrhic Containment", 2: "Containment", 3: "Flawless Defense"), show three Spark icons that fill in one by one, count up Essence, and show the best-ever result for the sector. Builds on item 1's modal.
Done when: a unit test covers the tier-to-title mapping; screenshots show the animated screen; npm test, npm run build pass.
```

### 14. Game feel: placement and big moments (P2)

```
VoidDefense: add whole-pixel feedback in src/void/render.ts (respect reduceEffects): a 3-frame dust puff and brief ring flash when a tower is placed; a short white flash and 0.3 s time slow when the last portal closes or the city falls; small floating "+N" Supplies text over buildings when income ticks (rate-limited, pooled). Keep rendering deterministic for the golden tests.
Done when: each effect is visible in a Playwright capture, disabled with Reduce Motion; npm test, npm run build pass.
```

### 15. Economy sink for late Supplies (P2)

```
VoidDefense: in a Sector 01 run Supplies reached 25,137 unspent by the end. Inspect income in src/void/scoring.ts and costs in src/void/towers.ts, then either scale income down after the first minute or add a sink: in-run tower upgrades (2 levels, shown in the inspector) costing Supplies. Pick the one that keeps decisions interesting and explain the choice in the commit.
Done when: a simulated run in tests/void-defense.test.ts ends with under 3,000 unspent Supplies when the player spends greedily; npm test, npm run build pass.
```

### 16. Large-map render performance (P2)

```
VoidDefense: npm run test:defense reports 512×768 (organismEscalation) render p50 18.7 ms / p95 31 ms on desktop. Profile src/void/render.ts with the benchmark and get render p95 under 16 ms on desktop without changing the look (cache static layers, skip off-screen chunks, cap debris draws). See docs/PERFORMANCE.md.
Done when: test-results/void-defense-report.json shows renderP95Ms < 16 for both sectors; pixel/crisp/depth checks still pass; npm test, npm run build pass; docs/PERFORMANCE.md has the new numbers.
```

### 17. Localize the Void UI (P3)

```
VoidDefense: all text in src/void/ui.ts, src/void/tech/, src/void/map/ and src/void/towers.ts is hard-coded English, while src/i18n/ only holds legacy text. Move Void UI strings into a new src/i18n/void.ts using the existing translate() table and languages, wire the language setting into the Void UI, and drop siege.ts/ambush.ts/building-menu.ts if unused. Follow docs/LOCALIZATION.md.
Done when: switching language changes the battle HUD, tabs, dialogs and tech panel; tests in tests/ cover missing keys; npm test, npm run build pass.
```

### 18. Music (P3)

```
VoidDefense: there is no music. Add a procedural, low-CPU ambient score in src/void/audio.ts (or a new src/void/music.ts): a calm synth pad on menus, a tenser layer during battle that rises with Void contact count, and a resolve on victory/defeat. Its own volume slider in settings. No new audio files.
Done when: music plays and crossfades between menu, battle and outcome; volume persists; npm test, npm run build pass; docs updated.
```

### 19. Remove dead legacy code and assets (P3)

```
VoidDefense: find and delete code and assets left from the medieval game that the Void game no longer uses: medieval clips in public/assets/sounds/ and their entries in src/sound-files.ts, unused cues in src/sound.ts, legacy i18n files, unused rules in src/style.css and src/theme.css. Use the build output and grep to prove each is unused before deleting.
Done when: npm test, npm run build and all npm run test:* browser checks pass; dist/ is smaller (report before/after size); docs/architecture/*.md no longer mention removed modules.
```

### 20. Docs, README and repo tidy (P3)

```
VoidDefense: README "How to play" lists towers/strikes that don't exist (Kinetic Cannon, Laser Battery, EMP...) and says 33 tech nodes (code has 63). Rewrite it from src/void/towers.ts, src/void/maps.ts and src/void/tech/catalog.ts. Move 3dPlan.md, VoidDefensePlan.md, VoidDefence.md, TurretAndStrikeIdeas.md and ToDo.md into docs/archive/ and update links. Refresh docs/void-defense-progress.md numbers from test-results/void-defense-report.json.
Done when: every tower/strike named in README exists in code; repo root has only README, AGENTS, CLAUDE, CONTEXT and config files; npm test, npm run build pass.
```

### 21. Release polish: share card, offline, favicon (P3)

```
VoidDefense: add og:title/og:description/og:image and twitter:card meta to index.html with a 1200×630 screenshot in public/ (capture it with Playwright from the title screen); add a small service worker that caches the built assets so the PWA in public/manifest.webmanifest works offline (Vite base "./" must keep paths relative); check favicon and icons are the Void emblem, not legacy art.
Done when: Lighthouse PWA "installable" passes against npm run preview; the game loads offline after one visit; npm test, npm run build pass.
```

## Definition of "finished"

The game can be called finished when:

- A new player can open the link, see a title screen, get through Sector 01 with guidance, and understand their result without reading anything outside the game.
- Every screen is styled, nothing overlaps at 1280×800, 390×844 or 844×390, and the map uses most of the screen on phones.
- Every player action and every big world event has a sound.
- No medieval names, textures or sounds remain in what the player sees or hears.
- Render p95 stays under 16 ms on desktop for the largest sector.
- README matches the game.
