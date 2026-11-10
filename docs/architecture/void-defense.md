# Void Defense Architecture (`src/void/`)

Void Defense is built as a clean, isolated namespace (`src/void/`) alongside the original `TowerDefense` modules, reusing deterministic math (`src/exact.ts`, `src/random.ts`), hashing (`src/defend/grid.ts`), the magnifying glass (`src/defend/loupe.ts`), and the elastic upgrade tree (`src/ui/upgrade-graph.ts` + `MagicCircle`) while replacing the medieval wave and offline idle-farming systems.

## Module Overview

| Module | Responsibilities |
|--------|------------------|
| `src/void/config.ts` | Central world sizes (`384x512` default, `512x768` large), `CHUNK_SIZE = 16`, 30 Hz fixed tick, material resistances, Void ablation balance, and anti-instant-abort participation thresholds. |
| `src/void/model.ts` | Domain types for terrain materials, metropolitan buildings, Void portals, crystalline Void Nodes, cosmic organisms, towers, 1x1/1x2 agents, strikes, and run outcomes. |
| `src/void/grid.ts` | `VoidGrid`: safe coordinate indexing and `dirtyChunks` tracking for chunked offscreen terrain caching. |
| `src/void/world.ts` | `VoidWorld`: seeded procedural year-3000 New York metropolis generator (avenues, cross-streets, alleys, plazas, hundreds of skyscrapers with height metadata, initial portal blast craters, and scorable baseline snapshot). |
| `src/void/physics.ts` | `VoidPhysics`: cell consumption into Void, local connected-component structural support checks for damaged buildings, drifting debris fragments, and `depositMatterDisc` terrain reclamation. |
| `src/void/void-field.ts` | `VoidField`: finite reservoir (`energyRemaining`) vs instantaneous tick work budget (`workAvailable`), deterministic integer micro-work (`WORK_SCALE = 1000`) distributed across all exposed frontier contact edges, sacrificial land-island diversion, explicit zero-contact resolution states, and bounded infantry ablation. |
| `src/void/towers.ts` | `VoidCombatManager`: live tower placement/selling/pre-battle relocation, Matter Cannon, Mason Depot (`1x2` engineers), Infantry Barracks (`1x1` thermal riflemen), Constructor Hub (polyline wall blueprints), Barrier Projector, Wall Serpent, Gravity Anchor, Rocket Team, Heavy Mech Bay (`2x2` exomechs), futuristic Strikes (`landfall`, `containmentPulse`, `genesis`, `orbitalReinforcement`, `seismicFrame`), and cosmic organisms. |
| `src/void/scoring.ts` | `computeCityIncomePerCycle`, `computeSparksTier`, and `evaluateRunOutcome` (including the anti-instant-abort participation check and baseline cap at 100%). |
| `src/void/sim.ts` | `VoidSim`: 30 Hz fixed-step orchestrator enforcing **Build Under Siege** vs **Build & Watch** mode rules. |
| `src/void/tech/catalog.ts` & `wallet.ts` | Single global technology DAG across 6 sectors, logical `AND`/`OR` prerequisites, cascading 100% refunds, and the shared-per-map Sparks entitlement ledger (`recordScenarioResult`). |
| `src/void/tech/tech-ui.ts` | `VoidTechTreeView`: wraps `UpgradeGraph` (`spatialCulling: true` and `setSecondaryEdges`) and `MagicCircle` for the global technology screen. |
| `src/void/operations/scene.ts` | `ResistanceOperationsView`: cosmetic ambient Engineering Bay (enormous evolving turret prototype + 1x2 welders) and Research Lab (captured Void nebula chambers + 1x2 researchers) with zero offline/idle resource farming. |
| `src/void/render.ts` & `ui.ts` | `VoidRenderer` (dirty-chunk offscreen layer + multi-scale LOD + `Loupe` integration) and `VoidApp` shell. |
| `src/void/save.ts` & `main.ts` | Defensive `voiddefense.v1` persistence and isolated bootstrap entrypoint (never invokes `MinePage`, `LibraryPage`, or `away.ts`). Classic TowerDefense remains accessible via `?classic=1`. |

## Simulation pixels

A **Void pixel** and a simulation cell are the same unit. Each former cell is split
into 2×2 independently damageable pixels (half the width and height, one quarter
the area). The default board is 384×512 pixels; large sectors are 512×768. City
layout generation preserves the existing city footprint, building count and income,
then discards its temporary coarse layout before simulation. Portals, tower
footprints, ranges, movement speeds and strike radii use the finer coordinates.
The `pixels()` helper converts authored distances from the former grid; all runtime
coordinates and cell indices use current pixels.

Terrain caching and the complete scene raster each contain exactly one raster pixel
per simulation cell. Building windows, roof equipment, damage, ground and Void share
that lattice. Camera zoom uses nearest-neighbor scaling of the scene, including on
phones; a display/device pixel is not a world unit. The dirty chunks remain 16×16
simulation pixels and are only cache regions, never destruction units.

Per-pixel erosion costs represent one quarter the former area. `PIXEL_WORK_SCALE`
keeps that conversion in integer fixed-point arithmetic, including shields and
ablation, without multiplying reservoir energy, income or rewards. Progression saves
contain no terrain grid or live placements, so the `voiddefense.v1` save format and
existing progression are retained. Classic mode keeps its original units.

Validation: `tests/void-defense.test.ts` covers four independent pixels, city
footprint/income preservation and erosion accounting. `node tests/void-pixels.mjs`
(with the Vite dev server running) checks scene/terrain resolution, camera hit
coordinates, single-pixel destruction at close zoom, desktop/phone layout and
browser errors. Screenshots go to `test-results/void-pixels/`.
