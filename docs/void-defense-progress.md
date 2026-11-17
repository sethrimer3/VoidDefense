# Void Defense Implementation Progress Ledger

Tracks the ordered phases, acceptance gates, and measured browser benchmarks from `VoidDefensePlan.md`.

## Phase Checklist & Gate Status

- [x] **Phase 0 — Establish baseline and migration map**
  - Created `pre-void-baseline` git tag.
  - Added `src/void/config.ts` and `docs/architecture/void-defense.md`.
- [x] **Phase 1 — New Void Defense shell and save model**
  - Implemented `src/void/save.ts` (`voiddefense.v1`), leaving `towerdefense.v1` intact.
  - Created isolated `src/void/main.ts` entrypoint with zero Mine/Library offline away-time invocation.
  - Added onboarding profile & play-style mode selector (`Build Under Siege` vs `Build & Watch`) plus the dedicated Resistance Command **Settings** panel.
- [x] **Phase 2 — City-scale renderer and technical proof of concept**
  - Built `src/void/grid.ts`, `src/void/world.ts`, and `src/void/render.ts`.
  - Implemented `192x256` and `256x384` metropolitan grids with hierarchical avenues, cross-streets, alleys, plazas, and 120–1,400+ skyscrapers/buildings with directional drop-shadows and amber window arrays.
  - Implemented `16x16` dirty-chunk offscreen terrain layer caching, multi-scale LOD, and `Loupe` magnification.
- [x] **Phase 3 — Destructible terrain and building physics**
  - Implemented `src/void/physics.ts` with per-cell integrity, local connected-component support checks for damaged buildings, drifting debris fragments, and `depositMatterDisc` reclamation.
- [x] **Phase 4 — Void field, finite-energy encounter, zero-contact states, and basic Supplies wallet**
  - Implemented `src/void/void-field.ts` with `energyRemaining` reservoir, instantaneous tick work budget, deterministic `WORK_SCALE = 1000` fractional conservation, and sacrificial island perimeter sharing.
  - Distinguished all zero-contact resolution states (`cityConsumedDefeat`, `reservoirDepletedVictory`, `voidEradicatedVictory`, `awaitingDelayedPortal`, and `isolatedPocketContainment` burn).
- [x] **Phase 5 — First placeable towers, live during-battle interaction, and playable Landfall strike**
  - Implemented live placement (both tap-then-tap and drag-from-palette with range previews), selling, and pre-combat relocation in `src/void/towers.ts`, `src/void/sim.ts`, and `src/void/ui.ts`.
  - Included **Matter Cannon**, **Barrier Projector**, and playable **Landfall** strike (`1`–`5` hotkeys and `Esc` cancel) in the core vertical slice.
- [x] **Phase 6 — Autonomous engineers, masons, 1-pixel riflemen, and immediate Void Node targets**
  - Implemented `1x2` engineers (hauling, repairing, blueprint construction, and over-100% building development) and `1x1` thermal riflemen.
  - Added crystalline **Void Nodes** near the frontier and bounded anti-Void frontier ablation (`minReservoirFloorFraction = 0.15` floor so cheap terrain/infantry loops cannot cheese the reservoir).
- [x] **Phase 7 — Minimal player guidance and autonomous logic upgrades**
  - Implemented user-drawn polyline wall blueprints and per-tower focus reticles, plus global AI logic nodes (`strategicMasonry`, `priorityTargeting`, `tacticalRetreat`).
- [x] **Phase 8 — In-run economy, accurate baseline scoring, and anti-instant-abort gate**
  - Implemented `src/void/scoring.ts` with periodic building-generated Supplies, baseline score cap at 100%, shared-per-map Sparks entitlement, and the participation gate preventing instant-abort Void Essence farming.
- [x] **Phase 9 — Single enormous elastic technology network**
  - Built `src/void/tech/catalog.ts` (30 nodes across 6 sectors), `wallet.ts`, and `tech-ui.ts` with sector filters and live search input (`[data-tech-search]`).
  - Added backwards-compatible opt-in `spatialCulling` and `setSecondaryEdges` to `src/ui/upgrade-graph.ts`.
- [x] **Phase 10 — Futuristic strike abilities**
  - Implemented `landfall`, `containmentPulse`, `genesis`, `orbitalReinforcement`, and `seismicFrame`, plus strike capacitor cooldown & price upgrades.
- [x] **Phase 11 — Resistance Operations: Lab and Engineering Bay**
  - Implemented `src/void/operations/scene.ts` showing the enormous evolving turret prototype with `1x2` welders and the Void specimen containment lab with `1x2` researchers, strictly cosmetic with zero offline income.
- [x] **Phase 12 — Modes, profiles, and progression campaign**
  - Implemented all 8 scenario configurations (`tutorialBreach`, `edgeAdvance`, `centralRupture`, `twinBreaches`, `delayedCollapse`, `archipelagoCity`, `organismEscalation`, `endless`) with procedural sector preview thumbnails (`canvas.void-sector-thumb`) and mode-split records with single shared Sparks entitlement per sector.
- [x] **Phase 13 — Advanced towers, creative physics, and synthetic matter**
  - Implemented `wallSerpent` (with `serpentConduits`), `gravityAnchor`, `rocketTeam`, `heavyMechBay` (with `mechOverdrive`), and the `matterSynthesis` Spark breakthrough.
- [x] **Phase 14 — Cosmic organisms and intelligent Void**
  - Implemented `nebulaWorm`, `constellationSpider`, `voidBloom`, `nebulaQueen`, `voidBee`, `honeycombCrystal`, and `nexusCrystal` funded out of the Void energy reservoir.
- [x] **Phase 15 & 16 — Art direction, UX, documentation, and verification**
  - Styled cyber-industrial orange/amber/steel UI vs starry midnight-violet Void (`src/void/void.css`), updated `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/architecture/void-defense.md`, and `docs/architecture/commands.md`.
  - Verified all unit tests (`npm test`), production build (`npm run build`), and browser QA & performance benchmarks (`node tests/void-defense.mjs`).

## Visual Quality Recovery Milestone (`V0`–`V5`)

- [x] **V0 — Reproducibility & 55.5s Run State Diagnosis**
  - Tagged rollback snapshot `visual-recovery-pre-v1` (`2012904`).
  - Diagnosed why `docs/void-defense/images/current-void-defense.webp` showed `99.7%` preserved at `55.5s` with `2440 / 3200` Void Reservoir: `VoidField.microWorkPerHp` had a `Math.max(100, base)` clamp combined with high cell HP (`45..240`) and low `baseGrowthRate` (`36/s`), limiting unopposed erosion to ~1 cell/s while `nodeSpawnEnergyCost` (`85`) and organism spawns drained the reservoir.
  - Recalibrated `MATERIAL_RESISTANCE` (`street: 18, building: 30, skyscraper: 45` vs `reclaimed: 180, wall: 520, barrier: 440`) and scenario reservoirs/growth rates (`src/void/config.ts`, `src/void/maps.ts`, `src/void/void-field.ts`) so unopposed Void visibly devours city blocks while Resistance defenses and sacrificial Landfall islands contain and exhaust the reservoir.
- [x] **V1 — Metropolitan City Composition (`test-results/void-v1-city-overview.png`)**
  - Replaced uniform dark-gray rectangular blocks with 6 distinct architectural styles (`glassTower`, `artDecoSetback`, `cyberArcology`, `foundryComplex`, `solarTerrace`, `civicDome`), non-rectangular building footprints (L-shaped, U-courtyards, chamfered octagons, twin-tower skybridge notches), 7 rooftop features (`helipad`, `spire`, `reactorDome`, `coolingTowers`, `skyGarden`, `solarArray`, `commsArray`), multi-step directional NW drop-shadows, and detailed arterial avenues with sidewalks, streetlamps, lane dividers, and crosswalks.
- [x] **V2 — Portal & Void Art Pass (`test-results/void-v2-portal-landfall.png`)**
  - Built abyssal black singularity portals with concentric & tilted elliptical prismatic event-horizon rings (`#ff38b8`, `#ffd6ff`, `#48e5ff`, `#ff8c29`) and lensed star streaks.
  - Implemented multi-octave cosmic nebula/starfield Void interior, sizzling magenta/orange frontier rims, and irregular disease-like expansion along spatial cosmic veins and street conduits.
- [x] **V3 — Pixel-Scale Life, Action & Destructibility (`test-results/void-v3-active-battle.png`, `test-results/void-v3-closeup-zoom.png`)**
  - Added curved inward prismatic/ember debris streamlines (`DebrisFragment`) accelerating toward active portals, expanding matter-impact `ShockwaveEffect` rings, moving `1×2` street traffic/emergency shuttles, `1×1` riflemen with muzzle flashes and laser beams, `1×2` engineers with cyan welding arcs and carried matter bricks, `2×2` heavy mechs, and parabolic Matter Cannon shells with trails.
- [x] **V4 — Command Console Interface**
  - Fixed `.sparks` and `.void-page` CSS selector collisions (`src/void/void.css`, `src/void/ui.ts`) that previously caused the Sparks badge to float over the canvas and background tabs to remain visible.
  - Built a riveted gunmetal-steel & amber LED Command Console HUD with visual progress gauges (`City Preserved %` and `Void Reservoir`), custom `20×20` pixel-art mini-canvas icons (`paintCardIcon`) on every tower and strike card, and zero text overlap across desktop and mobile viewports.
- [ ] **V5 — Standardized Visual Acceptance Captures & Benchmarks (`test-results/void-v5-reduced-effects.png`)**
  - Captured standardized before/after and reduced-effects screenshots via `node tests/void-defense.mjs` (awaiting user visual review to close gate).

## Browser QA & Performance Benchmark Results (`tests/void-defense.mjs`)

- **Viewports Verified**: Desktop (`1280×800`), Mobile Portrait (`390×844`), and Mobile Landscape (`844×390`) — all 63 tech nodes, Resistance Map, Resistance Ops, and Settings verified with screenshots saved to `test-results/`.
- **Standard Sector (`tutorialBreach`, `384×512`, 610 buildings, 40 agents, 737 debris particles, 600 frontier edges)**:
  - Simulation step: `p50 = 2.0 ms`, `p95 = 3.4 ms`
  - Canvas render: `p50 = 4.3 ms`, `p95 = 6.4 ms`
- **Large Sector (`organismEscalation`, `512×768`, 1,053 buildings, 40 agents, 740 debris particles, 938 frontier edges)**:
  - Simulation step: `p50 = 3.5 ms`, `p95 = 7.2 ms`
  - Canvas render: `p50 = 6.1 ms`, `p95 = 10.6 ms`
