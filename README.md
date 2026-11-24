# Void Defense

A mobile-first cosmic city-defense game in TypeScript + Vite. You hold a procedural metropolis and surrounding countryside against an encroaching Void whose perimeter budget physics physically erodes terrain, collapses skyscrapers into matter rubble, and spawns cosmic organisms with organic noise-based contours.

Canvas draws the board at crisp 1:1 simulation cell resolution; plain DOM template strings provide controls, HUD, tech DAG, and dialogs. No backend, no game engine, no framework; progress persists in `localStorage` under `voiddefense.v1` (with non-destructive adoption of display preferences and player profiles from legacy saves).

Play it on GitHub Pages: <https://sethrimer3.github.io/VoidDefense/>

## Run

Use Node.js 22.18+ (CI uses 24) and npm:

```sh
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # Fast unit and simulation test suite (tests/*.test.ts)
npm run build      # tsc --noEmit && vite build -> dist/
npm run preview
```

### Browser Verification Scripts

With `npm run dev` running in another terminal:

```sh
npm run test:pixels   # 1:1 simulation cell to raster pixel regression
npm run test:crisp    # Native-cell art and hard-edged shapes check
npm run test:ledge    # Cutaway strata and subterranean ledge rendering
npm run test:visuals  # Living Void interior wisps and organic noise contours
npm run test:farms    # Living wheat, farm depth, and energy fire
npm run test:depth    # 3D oblique building depth, facades, and roof occlusion
npm run test:defense  # Full browser QA and performance benchmark
```

## How to play

- **Sectors & Campaign.** Progress across 7 campaign sectors plus Endless mode (`384×512` to `512×768` cells): Sector 01: Sub-Station Zero, Sector 02: Westward Canal, Sector 03: Zenith Spire Plaza, Sector 04: Twin Conduit Yards, Sector 05: Secondary Resonance, Sector 06: Tidal Channel Transit Hubs, Sector 07: Astral Hive Nexus, and Endless: Event Horizon. Each sector procedurally generates a living metropolis, rural countryside, arterial roads, rivers, and outlying hamlets.
- **Operating Modes.**
  - **Build Under Siege:** Build and adapt in real time as the Void consumes the city, earning Supplies from surviving buildings.
  - **Build & Watch:** Spend a fixed starting budget during prep, then unleash the Void and watch your defenses hold or fall.
- **The Void & Perimeter Budget.** The Void is a simulated field governed by perimeter energy budgets. Sacrificial land islands physically ablate incoming Void energy, diverting erosion away from core urban districts. Structural damage causes procedural building collapse, depositing matter debris that engineers can salvage. Preserving at least 35% of the baseline city wins; falling below 35% resolves as City Lost.
- **Defensive Structures.** Deploy 16 specialized installations (each upgradeable Lv 1–3):
  - **Matter Cannon:** Fires synthetic land pellets that displace Void and reinforce crumbling frontiers.
  - **Repair Depot:** Deploys 1×2 engineers to haul salvage, repair skyscrapers, and upgrade city income.
  - **Infantry Barracks:** Deploys 1-pixel riflemen that destroy Void Nodes, organisms, and ablate frontier pressure.
  - **Constructor Hub:** Deploys autonomous masons that build player-drawn wall blueprints.
  - **Barrier Projector:** Projects an energy shield wall that dramatically slows Void erosion.
  - **Wall Serpent Bay:** Launches an articulated armored serpent that patrols and hardens frontier terrain.
  - **Gravity Anchor:** Emits a gravity pulse that pulls debris back into reinforced ground and slows cosmic organisms.
  - **Rocket Battery:** Long-range salvo battery that fires high-payload matter warheads at distant breaches.
  - **Heavy Mech Bay:** Deploys a heavy armored exo-mech that clears Void Nodes and hunts major organisms.
  - **Void Siphon:** Absorbs frontier Void pressure into a storage tank and vents it as reclaimed ground.
  - **Boundary Prism:** Projects an angled optical plane that redirects Void erosion pressure along its axis.
  - **Chrono Cannon:** Records local terrain and units, rewinding a single Void breach back to its earlier state.
  - **Beacon Drone Post:** Deploys an aerial drone whose ground halo stabilizes terrain against Void collapse.
  - **Seamwalker Post:** Deploys a swift frontier patroller that tracks the Void rim and aborts nearby Void Nodes.
  - **Echo Mine:** Plants a kinetic mine that detonates in a matter-restoring shockwave when triggered by Void contact.
  - **Countervoid Heart:** Generates a steady anti-Void pulse that reclaims nearby Void cells into solid ground.
- **Strike Capabilities.** Command 6 tactical strikes: **Solar Anchor**, **Stasis Beacon**, **Containment Pulse**, **Genesis Wave**, **Orbital Drop Squad**, and **Seismic Stiffener**.
- **Cosmic Organisms.** Face evolving cosmic entities including the **Nebula Queen**, **Void Bees**, **Nebula Worms**, **Constellation Spiders**, **Void Blooms**, **Honeycomb Crystals**, and **Nexus Crystals**.
- **Global Tech Network, Resistance Ops & Map.** Earn **Void Essence** and **Sparks of Defiance** (shared per sector) to research 63 interconnected nodes across 6 sectors with free between-run refunds, watch your unlocked systems assemble in **Resistance Ops**, and deploy across sectors from the **Resistance Map**.

## How it's built

- **Sole-Game Architecture.** Direct bootstrap through `src/boot.ts` into `src/void/main.ts` (`VoidCommandShell` in `src/void/ui.ts`).
- **World & Simulation Lattice.** One world pixel equals one simulation cell. Simulation runs at 30 Hz on discrete integer lattice coordinates (`VoidWorld`, `VoidField`, `VoidPhysics`, `VoidSim`).
- **Organic Noise Contours.** `src/void/portal-noise.ts` and `src/void/contour.ts` provide organic boundary contours using smooth cubic value noise and 4-octave ridged multifractals sampled from a 96×96 torus.
- **Exposed Subterranean Ledges.** `src/void/ledge.ts` paints exposed strata and dark undersides along Void cutaways while preserving ground isolation.
- **Oblique ¾ Building Depth & Falling Physics.** `src/void/elevation.ts` and `src/void/render.ts` project buildings (`1..15` px) and towers above the ground plane with south facades, exposed floor cutaways, directional shadows, and dithered occlusion fades. `src/void/physics.ts` simulates pooled `FallingChunk` debris and fleeing `Civilian` pedestrians.
- **2.5D Surface Lighting and Cast Shadows.** `src/void/lighting.ts` and `src/void/elevation.ts` generate procedural 3×3 Sobel normal maps for terrain, buildings, towers, and infantry in an incrementally updated 16×16 tiled cache. Warm directional sunlight with cooler ambient fill, Tron-style neon blue building lights, Tron-style neon orange tower lights, and fast-falloff flickering explosions/muzzle flashes/projectiles cast soft-penumbra 2.5D shadows from buildings, towers, infantry, and falling debris at whole-pixel resolution with configurable quality tiers (`low`/`medium`/`high`) and auto-drop on slow devices.
- **Delivery routes.** Build two Delivery Depots next to connected roads to earn Supplies when a truck arrives. Longer routes pay more per trip and can be interrupted by the Void.
- **Deterministic Randomness.** Fixed-seed stream generation via `src/random.ts` and `src/void/grid.ts` preloaded via `tests/pin-random.ts`.
- **Audio & Music.** `src/void/audio.ts` (`VoidSoundEngine`) synthesizes procedural cosmic drones and SFX cues; `src/void/music.ts` (`VoidMusicEngine`) crossfades title, battle, and outcome ambient scores.
- **Typography, Theme & Localization.** Alembic custom pixel font (`assets/fonts/Alembic/`) built into TrueType outlines (`scripts/pixel-font/build.ts`), paired with Cinzel fallback, cyber-industrial styling (`src/void/void.css`, `src/style.css`), and 9-language UI localization (`src/i18n/void.ts`).
- **Save Isolation.** `src/void/save.ts` persists into `voiddefense.v1` while leaving legacy `towerdefense.v1` intact.
