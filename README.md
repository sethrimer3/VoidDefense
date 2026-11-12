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
npm run test:depth    # 3D oblique building depth, facades, and roof occlusion
npm run test:defense  # Full browser QA and performance benchmark
```

## How to play

- **Operations & Scenarios.** Choose from diverse metropolitan scenarios across varying scales (384×512 to 512×768): Tutorial Breach, Urban Corridor, Coastal Bulwark, Island Citadel, and Organism Escalation. Each scenario procedurally generates a living metropolis, rural countryside, arterial roads, river ways, and outlying hamlets.
- **Operating Modes.**
  - **Build & Watch:** Spend starting budget to place defensive networks, configure tactical loadouts, and unleash the Void to watch your defenses hold or fall.
  - **Under Siege:** Command active real-time defense. Direct infantry teams, call down kinetic drops, deploy emergency barricades, and activate strike capabilities mid-combat.
- **The Void & Perimeter Budget.** The Void is a physical simulated field governed by perimeter energy budgets. Sacrificial land islands and breakwaters physically ablate incoming Void energy, diverting erosion away from core urban districts. Structural damage causes procedural building collapse, depositing matter debris that infantry can salvage.
- **Defensive Structures.** Deploy 9 specialized defensive installations:
  - **Kinetic Cannon:** Rapid-fire ballistic perimeter defense.
  - **Laser Battery:** Continuous beam piercing and high-single-target ablation.
  - **EMP Emitter:** Disruption field disabling cosmic organism abilities and slowing creep.
  - **Flak Battery:** Area-of-effect anti-swarm air defense.
  - **Plasma Mortar:** Long-range high-explosive ordnance leaving lingering thermal zones.
  - **Resonator Spire:** Field projector stabilizing adjacent terrain against erosion.
  - **Wall Serpent:** Segmented mobile barrier actively patrolling frontline perimeters.
  - **Nanite Foundry:** Automated constructor deploying repair and construction drones.
  - **Matter Synthesizer:** Converts deposited rubble and salvage into defensive energy.
- **Strike Capabilities.** Command 5 orbital and tactical strike abilities: Orbital Strike, EMP Blast, Nanite Swarm, Kinetic Drop, and Singularity Inversion.
- **Cosmic Organisms.** Face evolving cosmic entities including the Nebula Queen Bee, Void Bee Swarms, Nebula Worms, Constellation Spiders, and Void Blooms. Organisms feature organic noise-based contours (smooth cubic value noise with ridged multifractal octaves) that preserve crisp readable silhouettes in motion and remain strictly bounded under Reduced Motion settings.
- **Technology DAG & Sparks.** Earn Sparks from metropolitan survival efficiency and tactical milestones. Invest Sparks across 33 interconnected technology nodes in the global DAG, featuring full cascading refunds and specialization branches.

## How it's built

- **Sole-Game Architecture.** Direct bootstrap through `src/boot.ts` into `src/void/main.ts`. Zero legacy game modes or obsolete medieval simulation overhead.
- **World & Simulation Lattice.** One world pixel equals one simulation cell. Simulation runs on discrete integer lattice coordinates (`VoidWorld`, `VoidField`, `VoidPhysics`, `VoidSim`), eliminating fractional blur.
- **Organic Noise Contours.** `src/void/portal-noise.ts` and `src/void/contour.ts` provide organic boundary contours using smooth cubic value noise and 4-octave ridged multifractals sampled from a 96×96 torus.
- **Exposed Subterranean Ledges.** `src/void/ledge.ts` paints exposed strata and dark undersides along Void cutaways while strictly preserving ground isolation.
- **Oblique ¾ Building Depth & Falling Physics.** `src/void/elevation.ts` and `src/void/render.ts` project buildings (`1..15` px at 2 floors/px) and towers (`2` px) above the ground plane with whole-pixel south facades, exposed floor cutaways, setback terraces, directional SE shadows, and whole-pixel dithered occlusion fades. `src/void/physics.ts` simulates pooled `FallingChunk` debris (and fleeing/falling 1-px `Civilian` pedestrians) sinking into the Void behind subterranean ledges.
- **Deterministic Randomness.** Fixed-seed stream generation via `src/random.ts` and `src/void/grid.ts` preloaded via `tests/pin-random.ts`, guaranteeing repeatable simulations and regression tests.
- **Typography & UI.** Alembic custom pixel font (`assets/fonts/Alembic/`) built directly into vector TrueType outlines (`scripts/pixel-font/build.ts`), paired with Cinzel fallback and responsive CSS (`src/style.css`, `src/theme.css`).
- **Save Isolation.** `src/void/save.ts` persists into `voiddefense.v1` while leaving legacy `towerdefense.v1` in browser storage intact and safely adopting player callsigns and visual accessibility preferences on initial launch.
