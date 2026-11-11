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
| `src/void/ledge.ts` | Cosmetic exposed strata, irregular undersides and narrow side faces projected into existing Void cells below the terrain edge. |
| `src/void/contour.ts` | Nebula-colored organic enemy contours (`computeOrganismContour`, `computeNodeContour`): thin violet/magenta boundary with cyan highlights driven by classic 2D value noise. |
| `src/void/interior.ts` | Living Void interior (`computeVoidInterior`, `paintVoidInterior`): seeded inward-flowing logarithmic spiral wisps and traveling brightness/color bands occluded behind ledges. |
| `src/void/pixel-painter.ts` | Hard-edged world-pixel rectangle, line, polygon, circle and ellipse rasterization for moving objects and effects. |
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
that lattice. Native terrain colors occupy whole cells; no 4×4 artwork is downsampled
into a cell, and there is no terrain blur/bloom pass. `pixel-painter.ts` rasterizes
moving objects, fractional rectangles, lines, circles and rotated ellipses with hard
pixel edges; Canvas `imageSmoothingEnabled = false` alone does not disable path
antialiasing. Translucent effects still color whole pixels.

Camera zoom uses nearest-neighbor scaling. Overview/zoom-out fits the board, while
close zoom uses whole device-pixel steps and rounded pan. Rendering and hit testing
use the same snapped transform. A display/device pixel is not a world unit. Dirty
chunks remain 16×16 simulation pixels and are only cache regions. Per-pixel paint
signatures include material, cover, damage, development, building identity, neighboring
surfaces, shadow and frontier distance/edges; browser checks compare retained pixels
with a fresh repaint.

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

The target look (`docs/void-defense/visual-references.md`, section E) runs from a warm,
dense neon city through countryside into a cosmic black hole. `paintCell` authors
whole-pixel neon building perimeters, stepped roof rings, conduits, helipads, solar
arrays and gardens across building footprints. Rural roofs, field rows, trees, river,
bridges and silos likewise choose whole-cell colors. The Void uses a discrete nebula
palette with pixel stars and a hot event-horizon rim. Whole-cell shadow and corruption
colors follow erosion, using the shared 12-pixel corruption reach for invalidation.

Dynamic passes preserve street light cycles, frontier lightning, portal arcs,
shockwaves, tower silhouettes, agents, shells, lasers and inward debris, drawn through
`pixelPainter` into the world raster before nearest-neighbor display scaling. The
canvas backdrop remains cosmetic. `reduceEffects` suppresses extra animation; sharp
world pixels are the default in both effects modes.

`node tests/void-crisp.mjs` checks native palette colors, opaque pixel masks without
antialiased fringes for small rectangles, lines, circles and rotated ellipses, whole
close-zoom device-pixel steps, pan/input agreement and absence of the terrain filter
on desktop DPR 1 and phone DPR 2. Screenshots go to `test-results/void-crisp/`.

## Exposed ground above the Void

`paintVoidLedge` draws a cutaway after the portal/nebula pass, before structures,
agents and drifting debris. The slightly elevated view exposes the down-screen face
most clearly: a broken soil/rock lip, seeded 3–6-pixel strata, jagged dark undercuts,
a contact shadow and occasional violet-lit lower facets. Narrow darker side cuts
reinforce thickness without outlining the whole hole with a uniform border.
Parkland/dirt expose earth; city and engineered terrain expose rock. Unclaimed water
has no soil face. Every projected pixel must already be Void, with front and side
faces stopping at solid ground or islands. The function never mutates terrain,
health, collision, placement, scoring or saves. It uses the current frontier each
frame, so erosion/reclamation updates the cutaway immediately; reduced effects keep
the same static geometry. All face details are whole world pixels.

`tests/void-ledge.test.ts` covers seeded irregular depth, strata, clipping, water,
material palettes and simulation isolation. `node tests/void-ledge.mjs` checks the
real city's scene-layer visibility after portal compositing, reduced effects and
desktop/phone screenshots in `test-results/void-ledge/` (needs the dev server).

## Living Void interior and enemy contours

`src/void/contour.ts` paints thin 1-pixel organic silhouettes for cosmic Void organisms
(Nebula Worms, Constellation Spiders, Void Blooms, Nebula Queens, Honeycomb Crystals,
Nexus Crystals, and Void Bees) and crystalline Void Nodes. The contour samples the
classic portal noise tile (`portalNoiseTile()`, verified as smooth 2D cubic Value
Noise with ridged multifractal octaves rather than gradient Perlin noise). Noise
coordinates evolve slowly across space and time to produce shifting violet/magenta
boundaries with occasional cyan highlights while preserving crisp pixel-art silhouettes.

`src/void/interior.ts` renders dynamic inward-flowing spiral wisps and traveling
color/brightness waves across active anomaly regions. The motion uses pre-seeded
spiral streams accelerated non-linearly toward the event horizon, strictly confined
to `CellMaterial.VOID` cells and rendered behind the exposed earth/rock ledges.
Both systems adhere strictly to the 1 cell = 1 world pixel lattice, respect
Reduce Motion / Reduced Effects by switching to stable, static visuals, and maintain
complete simulation isolation.

Validation: `tests/void-visuals.test.ts` tests noise algorithm verification, thin
contour silhouettes, color mapping, living wisp flows, clipping, and simulation
isolation. `node tests/void-visuals.mjs` verifies browser rendering, ledge occlusion,
black hole core preservation, reduced motion stability, and captures screenshots
and frame recordings in `test-results/void-visuals/`.
