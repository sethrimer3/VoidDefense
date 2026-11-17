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
- **Tactical Hotbar & Tower Palette:** 9 defensive installations and 6 strike abilities in a centered bottom dock (horizontally scrollable on phones), plus a desktop right-side tactical panel (`>= 1000px`) with sector briefing, run controls, telemetry, and tower/building inspector.
- **Title Screen, Onboarding & Sector 01 Coach:** Animated pixel-art skyline Title Screen (`Continue`, `New Game`, `Settings`), high-contrast Commander Profile dialog (`Welcome, Commander`), and a 4-step Sector 01 tactical coach (`VoidSave.coachDone`) that holds the simulation until ready.
- **Settings Modal:** Opened from the header gear button or Title Screen with Master/SFX/Ambience volume sliders, Magnifier, Reduce Motion, Pixel Font, Building Height, and `?dev=1`-gated Developer Mode.
- **Simulation Controls:** Real-time speed stepping (`1x`, `2x`, `3x`), pause/resume toggle, and retry.
- **Telemetry & Warnings:** Real-time frontier edge counts, Void energy remaining, active units, city survival percentage, and tiered outcome modal.

## Technology Screen & DAG

- **DAG Interface (`src/void/tech/tech-ui.ts`):** Renders the 63-node technology tree using `UpgradeGraph` (`src/ui/upgrade-graph.ts`), `HoloGridBackdrop` holographic star-chart rings, and responsive bottom-sheet detail panel on `< 700px` screens.
- **Research Operations:** Node selection, dependency checking, Sparks purchasing, and non-destructive cascading refund trees.

## Audio & Sound Synthesis

- **Sound Catalogs (`src/sound-files.ts`):** Lists pre-recorded audio beds and one-shots stored in `public/assets/sounds/` with seamless loop crossfades.
- **Void Audio Engine (`src/void/audio.ts`):** Procedural Web Audio synthesizer generating atmospheric cosmic drone soundscapes, Brownian noise buffers seeded deterministically via `stream("effects")` from `src/random.ts`, and rate-limited, voice-capped sci-fi SFX cues (`uiClick`, `uiToggle`, `towerPlace`, `towerSell`, `towerUpgrade`, `cannonFire`, `shellImpact`, `collapse`, `voidConsume`, `unitDeath`, `strikeCast`, `victory`, `defeat`) with Master/SFX/Ambience volume scaling.

## Player Profile & Call-Sign

- **Model (`src/profile/model.ts`):** Normalizes player callsign (defaulting to random `player#0000`–`player#9999`) and maintains a 16×24 pixel flag banner constructed from 12 composited color/stamp layers with opacity blending.
- **Persistence:** Stored cleanly within the primary save structure without raw markup or image uploads.

## Save Persistence & Isolation

- **Key:** All game progress, technology purchases, Sparks balances, mission milestones, settings, and profiles persist in `localStorage` under `voiddefense.v1`.
- **Resistance Map:** the fourth tab (formerly Sectors & Mode, `VoidTab` `"map"`, page `#void-page-map`) shows the campaign map (`src/void/map/`) above the play-style picker and command settings. Deploying is refused for locked sectors. A victory banner offers "Advance on the Resistance Map". Optional `VoidSave.mapRevealed` counts the trails already drawn on for the player, so each new trail draws on once; absent means 0.
- **Legacy Preservation & Safe Migration (`src/void/save.ts`):**
  - If `voiddefense.v1` does not exist on initial launch, the loader checks `towerdefense.v1` for existing player profiles and visual settings (`reduceMotion`, `pixelFont`, `soundOn`).
  - These values are gracefully imported into the initial `voiddefense.v1` payload.
  - The legacy `towerdefense.v1` key in `localStorage` is **never modified, mutated, or deleted**, preserving existing player storage.

## Localization (`src/i18n/`)

- Supports 9 languages (`en`, `es`, `fr`, `de`, `pt-BR`, `it`, `ja`, `ko`, `zh-CN`), with Void Defense UI strings in `src/i18n/void.ts` wired through `t()`, `translateWithin()`, and the Language selector in Command Settings (`settings.language`).
