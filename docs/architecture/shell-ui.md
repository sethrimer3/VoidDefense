# Shell, UI and Saves

Void Defense UI architecture, sole-game bootstrap, HUD controls, audio, profile, and save persistence.

## Sole-Game Bootstrap & Loading Screen

- **Entry Point:** `index.html` loads `src/boot.ts`.
- **Loading Screen (`src/ui/loading-screen.ts`):** Lightweight, self-contained canvas animation showing a cosmic nebula backdrop, sequenced loading dots, and a farmland loading bar progressively consumed from the left by the cosmic void (`src/ui/farmland-bar.ts`). Automatically detects Reduced Motion preferences from localStorage or media queries.
- **Boot Guard (`src/ui/boot-guard.ts`):** Ensures resilient startup with strict timeout protections:
  - Font loading completes within 3 seconds or falls back to system fonts.
  - The loading screen automatically uncovers the game upon initialization.
  - Error recovery guards prevent indefinite hangs with single-retry capabilities.
- **Sole-Game Launch:** Directly imports and initializes `src/void/main.ts` via `startVoidGame()`. All legacy game modes, redundant tabs, and classic switch buttons are omitted.

## Void Defense HUD & Interface

Constructed via clean DOM template strings in `src/void/ui.ts` and styled in `src/style.css` and `src/theme.css`:
- **Scenario & Mission Selector:** Scenario cards across varied scales (384×512 to 512×768) with baseline density and objective parameters.
- **Operating Modes:** Toggle between "Build & Watch" (planning and automated defense) and "Under Siege" (active tactical command with dynamic infantry rallies and strike drops).
- **Tactical Hotbar & Tower Palette:** 9 defensive installations mapped to keyboard shortcuts `1` through `9`, with energy cost indicators and placement previews.
- **Strike Abilities:** 5 orbital and tactical strike abilities mapped to keys `Q` through `T` with real-time cooldown tracking.
- **Simulation Controls:** Real-time speed stepping (`1x`, `2x`, `5x`), pause/resume toggle, and emergency abort options.
- **Telemetry & Warnings:** Real-time frontier edge counts, matter debris levels, city survival percentage, and perimeter collapse alerts.

## Technology Screen & DAG

- **DAG Interface (`src/void/tech/tech-ui.ts`):** Renders the 33-node technology tree using `UpgradeGraph` (`src/ui/upgrade-graph.ts`), animated `TreeMotes` fluid particle flows (`src/ui/tree-motes.ts`), and mathematical `MagicCircle` backdrops (`src/magic-circle/`).
- **Research Operations:** Node selection, dependency checking, Sparks purchasing, and non-destructive cascading refund trees.

## Audio & Sound Synthesis

- **Sound Catalogs (`src/sound-files.ts`):** Lists pre-recorded audio beds and one-shots stored in `public/assets/sounds/` with seamless loop crossfades.
- **Void Audio Engine (`src/void/audio.ts`):** Procedural Web Audio synthesizer generating atmospheric cosmic drone soundscapes, Brownian noise buffers seeded deterministically via `stream("effects")` from `src/random.ts`, and dynamic firing/collapse cues.

## Player Profile & Call-Sign

- **Model (`src/profile/model.ts`):** Normalizes player callsign (defaulting to random `player#0000`–`player#9999`) and maintains a 16×24 pixel flag banner constructed from 12 composited color/stamp layers with opacity blending.
- **Persistence:** Stored cleanly within the primary save structure without raw markup or image uploads.

## Save Persistence & Isolation

- **Key:** All game progress, technology purchases, Sparks balances, mission milestones, settings, and profiles persist in `localStorage` under `voiddefense.v1`.
- **Legacy Preservation & Safe Migration (`src/void/save.ts`):**
  - If `voiddefense.v1` does not exist on initial launch, the loader checks `towerdefense.v1` for existing player profiles and visual settings (`reduceMotion`, `pixelFont`, `soundOn`).
  - These values are gracefully imported into the initial `voiddefense.v1` payload.
  - The legacy `towerdefense.v1` key in `localStorage` is **never modified, mutated, or deleted**, preserving existing player storage.
