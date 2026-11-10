# Void Defense Architecture (`src/void/`)

Void Defense is built as a clean, isolated namespace (`src/void/`) alongside the original `TowerDefense` modules, reusing deterministic math (`src/exact.ts`, `src/random.ts`), hashing (`src/defend/grid.ts`), the magnifying glass (`src/defend/loupe.ts`), and the elastic upgrade tree (`src/ui/upgrade-graph.ts` + `MagicCircle`) while replacing the medieval wave and offline idle-farming systems.

## Module Overview

| Module | Responsibilities |
|--------|------------------|
| `src/void/config.ts` | Central world sizes (`384x512` default, `512x768` large), `CHUNK_SIZE = 16`, 30 Hz fixed tick, material resistances, Void ablation balance, and anti-instant-abort participation thresholds. |
| `src/void/model.ts` | Domain types for terrain materials, metropolitan buildings, Void portals, crystalline Void Nodes, cosmic organisms, towers, 1x1/1x2 agents, strikes, and run outcomes. |
| `src/void/grid.ts` | `VoidGrid`: safe coordinate indexing and `dirtyChunks` tracking for chunked offscreen terrain caching. |
| `src/void/world.ts` | `VoidWorld`: seeded procedural generator of the city-to-Void gradient. `computeZones` classifies every cell rural / suburb / urban by its noise-warped distance to the nearest portal rim (`zone`, `urbanity`; per-scenario `countryside: { ruralCells, suburbCells }` in `maps.ts`); `generateMetropolis` lays avenues, cross-streets, alleys, plazas and hundreds of skyscrapers (suburb blocks become low-rise lots with lawns, and lots are clipped cell by cell at the countryside edge); `generateCountryside` paints grass/meadow/forest, a meandering river with bridges, winding dirt lanes (`streetTier = 8`) continuing the avenues toward the anomaly, fields and orchards beside the lanes, and homestead/barn hamlets with silos, all as render-only `landCover`; then the portal blast craters and the scorable baseline snapshot. |
| `src/void/physics.ts` | `VoidPhysics`: cell consumption into Void (marking a 12-pixel radius dirty so the corruption band repaints), local connected-component structural support checks for damaged buildings, drifting debris (slow heavy slabs that keep the colour of the land they were, plus fast prismatic sparks), and `depositMatterDisc` terrain reclamation. |
| `src/void/void-field.ts` | `VoidField`: finite reservoir (`energyRemaining`) vs instantaneous tick work budget (`workAvailable`), deterministic integer micro-work (`PIXEL_WORK_SCALE = 4000`) distributed across all exposed frontier contact edges, sacrificial land-island diversion, explicit zero-contact resolution states, and bounded infantry ablation. |
| `src/void/towers.ts` | `VoidCombatManager`: live tower placement/selling/pre-battle relocation, Matter Cannon, Mason Depot (`1x2` engineers), Infantry Barracks (`1x1` thermal riflemen), Constructor Hub (polyline wall blueprints), Barrier Projector, Wall Serpent, Gravity Anchor, Rocket Team, Heavy Mech Bay (`2x2` exomechs), futuristic Strikes (`landfall`, `containmentPulse`, `genesis`, `orbitalReinforcement`, `seismicFrame`), and cosmic organisms. |
| `src/void/scoring.ts` | `computeCityIncomePerCycle`, `computeSparksTier`, and `evaluateRunOutcome` (including the anti-instant-abort participation check and baseline cap at 100%). |
| `src/void/sim.ts` | `VoidSim`: 30 Hz fixed-step orchestrator enforcing **Build Under Siege** vs **Build & Watch** mode rules. |
| `src/void/tech/catalog.ts` & `wallet.ts` | Single global technology DAG across 6 sectors, logical `AND`/`OR` prerequisites, cascading 100% refunds, and the shared-per-map Sparks entitlement ledger (`recordScenarioResult`). |
| `src/void/tech/tech-ui.ts` | `VoidTechTreeView`: wraps `UpgradeGraph` (`spatialCulling: true` and `setSecondaryEdges`) and `MagicCircle` for the global technology screen. |
| `src/void/operations/scene.ts` | `ResistanceOperationsView`: cosmetic ambient Engineering Bay (enormous evolving turret prototype + 1x2 welders) and Research Lab (captured Void nebula chambers + 1x2 researchers) with zero offline/idle resource farming. |
| `src/void/render.ts` & `ui.ts` | `VoidRenderer` (dirty-chunk offscreen layer + multi-scale LOD + `Loupe` integration) and `VoidApp` shell. See "Rendering the concept composition" below. |
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
phones; a display/device pixel is not a world unit. Authored vector paths and color accents are rasterized into that single pixel;
no finer art grid is retained. Existing neon city, countryside, corruption and
black-hole passes share the final scene raster. The dirty chunks remain 16×16
simulation pixels and are only cache regions, never destruction units. A per-pixel paint signature includes material,
land cover, damage stage, development, building identity, shadow and frontier
distance/edges, so broad dirty regions skip unchanged pixels. Browser regression
checks compare incremental terrain with a fresh repaint.

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
## Rendering the concept composition

The target look (`docs/void-defense/visual-references.md`, section E) is a top-down map that runs from a warm, dense year-3000 city through countryside into a huge cosmic black hole that is tearing the terrain apart. `VoidRenderer` splits that into a cached layer and per-frame passes.

**Cached terrain layer (`paintChunk` → `paintCell`).** Each 16×16-cell chunk is repainted only when dirty. `paintCell` dispatches on material and `world.landCover`:

- City: Tron-style neon circuitry. Carbon-black streets and obsidian plazas with faint grid lines; dark rooftops traced by an orange neon perimeter (`neonEdge` with a brighter `neonCore`), an inner neon ring on stepped setbacks, and rooftop bus lines feeding a glowing centre core (`roofAccent`); directional shadows from taller neighbours (`computeShadowAt`).
- Countryside (`paintCountryCell`): grass and meadow with tufts and wildflowers, forest canopy (shaded floor, round crowns with a sunlit highlight), crop rows in gold and ochre with soil between, orchards, silos; dirt lanes with ruts and a grass verge, timber bridges, bright river water with glints. `paintRuralBuilding` draws homesteads and barns as pitched roofs seen from above (ridge highlight, eave shadow, chimney, one warm window).
- The anomaly (`paintVoidCell`): every Void cell is coloured by its distance and angle to the nearest portal (`nearestPortal`, preferring active ones): a lightless core, a photon-ring rim (white-pink → magenta → violet), then a two-armed logarithmic spiral nebula on the `NEBULA_RAMP` fading into deep indigo, with pixel-scale knots and dust lanes, cyan filaments on the arms and a lensed star field that thickens in deep space.
- The corruption band (`paintCorruption`): for chunks with Void within `CORRUPTION_REACH` (12 pixels), each land cell finds its distance to the nearest Void cell with a local chamfer distance transform. It is stained violet by distance, cracked with magenta veins and dark pits near the frontier, and every side touching the Void gets a dark cliff line with a glowing violet/magenta rim. Walls and barriers only take the cliff edge. `VoidPhysics` marks a 12-pixel radius dirty whenever a cell is consumed or restored so the band follows the frontier.

**Per-frame passes (`draw`).** A cached deep-space backdrop (stars and a faint violet wash, rebuilt on resize) fills the canvas behind the board. Then: a soft bloom (the terrain layer downsampled, blurred and screen-blended so neon edges glow; skipped under `reduceEffects`); Tron light cycles with fading trails on breadth-first street corridors between nearby buildings (`syncCorridors`, city streets only, never the dirt lanes); a soft violet corona on frontier cells with warm/cyan/pink matter sparks; up to twelve lightning veins per 110 ms slot, jagged polylines from hashed frontier cells toward the nearest active portal; forty twinkling stars sampled inside the Void's bounding box; the black hole overlay per active portal (breathing halo rings, eighteen lensed light arcs at hashed radii and speeds, the lightless core, photon ring, magenta event horizon, violet glow ring, counter-rotating cyan and gold accretion ellipses, and twenty-six orbiting sparkles spiralling inward); then nodes, blueprints, towers, agents, organisms, shells, shockwaves, lasers, debris (slabs with a dark underside and violet rim shrinking as they fall, sparks with glow trails), previews and the loupe. `reduceEffects` keeps the rings and core but drops halos, streaks, lightning, twinkles and sparkles.

Scoring and physics are untouched by the composition: countryside cells are parkland (`PARK`, value 1) with higher HP than urban parks so the band is not eaten in seconds; rivers are `UNCLAIMED` water; dirt lanes and bridges are baseline streets; hamlets are ordinary `BUILDING` cells.
