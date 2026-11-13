# Void Defense Architecture (`src/void/`)

Void Defense is the sole game in this repository, built as a clean, self-contained architecture in `src/void/`, reusing deterministic math (`src/exact.ts`, `src/random.ts`), the magnifying glass (`src/void/loupe.ts`), and the elastic upgrade tree (`src/ui/upgrade-graph.ts` + `MagicCircle`).

## Module Overview

| Module | Responsibilities |
|--------|------------------|
| `src/void/config.ts` | Central world sizes (`384x512` default, `512x768` large), `CHUNK_SIZE = 16`, 30 Hz fixed tick, material resistances, Void ablation balance, and anti-instant-abort participation thresholds. |
| `src/void/model.ts` | Domain types for terrain materials, metropolitan buildings, Void portals, crystalline Void Nodes, cosmic organisms, towers, 1x1/1x2 agents, strikes, and run outcomes. |
| `src/void/grid.ts` | `VoidGrid`: safe coordinate indexing and `dirtyChunks` tracking for chunked offscreen terrain caching. |
| `src/void/world.ts` | `VoidWorld`: seeded procedural generator of the city-to-Void gradient. `computeZones` classifies every cell rural / suburb / urban by its noise-warped distance to the nearest portal rim (`zone`, `urbanity`; per-scenario `countryside: { ruralCells, suburbCells }` in `maps.ts`); `generateMetropolis` lays avenues, cross-streets, alleys, plazas and hundreds of skyscrapers (suburb blocks become low-rise lots with lawns, and lots are clipped cell by cell at the countryside edge); `generateCountryside` paints grass/meadow/forest, a meandering river with bridges, winding dirt lanes (`streetTier = 8`) continuing the avenues toward the anomaly, fields and orchards beside the lanes, and homestead/barn hamlets with silos, all as render-only `landCover`; then the portal blast craters and the scorable baseline snapshot. |
| `src/void/physics.ts` | `VoidPhysics`: cell consumption into Void (marking a 12-pixel radius dirty so the corruption band repaints), per-column structural support (`columnFloors: Uint8Array` on `VoidWorld`, cantilever overhangs up to `1 + floor(floors / 8)` px, seeded brink spalling from the top down, and disconnected splinter collapse into salvage), pooled `FallingChunk` (`MAX_FALLING_CHUNKS = 200`), `DustPuff` (`MAX_DUST_PUFFS = 120`), and `VoidRipple` (`MAX_VOID_RIPPLES = 16`) integration (a chunk landing on solid ground queues a `ChunkImpact` for units, organisms and towers: damage `mass x landing speed x 0.2`, capped at 30, towers take half; it scuffs a street cell by 2 HP and never damages buildings or walls), drifting debris (slow heavy slabs that keep the colour of the land they were, plus fast prismatic sparks), and `depositMatterDisc` terrain reclamation. |
| `src/void/void-field.ts` | `VoidField`: finite reservoir (`energyRemaining`) vs instantaneous tick work budget (`workAvailable`), deterministic integer micro-work (`PIXEL_WORK_SCALE = 4000`) distributed across all exposed frontier contact edges, sacrificial land-island diversion, explicit zero-contact resolution states, and bounded infantry ablation. |
| `src/void/towers.ts` | `VoidCombatManager`: live tower placement/selling/pre-battle relocation, Matter Cannon, Mason Depot (`1x2` engineers), Infantry Barracks (`1x1` thermal riflemen), Constructor Hub (polyline wall blueprints), Barrier Projector, Wall Serpent, Gravity Anchor, Rocket Team, Heavy Mech Bay (`2x2` exomechs), futuristic Strikes (`landfall`, `containmentPulse`, `genesis`, `orbitalReinforcement`, `seismicFrame`), and cosmic organisms. |
| `src/void/scoring.ts` | `computeCityIncomePerCycle` (scaling by surviving `columnFloors`, 1 floor = \$1 per 15s), `computeSparksTier`, and `evaluateRunOutcome` (including the anti-instant-abort participation check and baseline cap at 100%). |
| `src/void/sim.ts` | `VoidSim`: 30 Hz fixed-step orchestrator enforcing **Build Under Siege** vs **Build & Watch** mode rules. |
| `src/void/tech/catalog.ts` & `wallet.ts` | Single global technology DAG across 6 sectors, logical `AND`/`OR` prerequisites, cascading 100% refunds, and the shared-per-map Sparks entitlement ledger (`recordScenarioResult`). |
| `src/void/tech/tech-ui.ts` | `VoidTechTreeView`: wraps `UpgradeGraph` (`spatialCulling: true` and `setSecondaryEdges`) and `MagicCircle` for the global technology screen. |
| `src/void/operations/scene.ts` | `ResistanceOperationsView`: the Resistance Ops tab, laid out like the TowerDefense Mine/Library tabs (`.mine-head` plaque + tally, `.mine-tools` row with Crew drawer and Bay/Lab/Whole-floor framing, framed `.mine-view` canvas). Wheel/pinch zoom, drag pan, tap a figure or crew name to follow. Reads the tech wallet into an `OpsLook` (prototype mark, fitted tower systems, filled chambers = 1 + Sparks/2). Strictly cosmetic, frame-driven only while the tab shows; zero offline/idle farming. |
| `src/void/operations/art.ts` | `OperationsRenderer`: one pixel a world unit (256×144, `geometry.ts`), scaled crisp, lit per pixel through a bump map like the Library's nave: riveted bay plates, lab panels, scaffold, crates, the evolving prototype (a module per unlocked tower system) and containment chambers are baked once per look; work lamps, a floodlight, welders' arcs, chamber specimens, consoles and module lights light them each frame. Crew, crane load, sparks and dust motes are lit by the flat light; lamp cones and blooms are composited over the scaled image. |
| `src/void/operations/crew.ts` | `OperationsCrew`: welders (scaffold decks via the ladder, and round the prototype), riggers (crates to base) and researchers (chamber consoles, viewport); `crewSize` grows the crew with unlocked nodes and chambers. Tested by `tests/void-operations.test.ts`. |
| `src/void/operations/geometry.ts` | Scene layout constants (bay, bulkhead, lab, decks, ladder, prototype, crates, crane, viewport, chambers) and `levelY`. |
| `src/void/farms.ts` | Living wheat gust/parting helpers and fixed-tick, bounded energy-ignited farm fires. |
| `src/void/ledge.ts` | Cosmetic exposed strata, irregular undersides and narrow side faces projected into existing Void cells below the terrain edge, plus `ledgeFrontDepthAt` and `isOccludedByLedge` for clipping `z < 0` falling objects. |
| `src/void/contour.ts` | Nebula-colored organic enemy contours (`computeOrganismContour`, `computeNodeContour`): thin violet/magenta boundary with cyan highlights driven by classic 2D value noise. |
| `src/void/interior.ts` | Living Void interior (`computeVoidInterior`, `paintVoidInterior`): seeded inward-flowing logarithmic spiral wisps and traveling brightness/color bands occluded behind ledges. |
| `src/void/elevation.ts` | Oblique ¾ building elevation (`FLOORS_PER_PIXEL = 2`, `1..15` px), setback tiering, south-facade and roof sprite caching (`BuildingSpriteCache`), incremental board structure atlas, and front-to-back roof/tower picking (`pickStructureAt`). |
| `src/void/pixel-painter.ts` | Hard-edged world-pixel rectangle, line, polygon, circle and ellipse rasterization for moving objects and effects. |
| `src/void/render.ts` & `ui.ts` | `VoidRenderer` (dirty-chunk offscreen layer + multi-scale LOD + `Loupe` integration) and `VoidApp` shell. See "Rendering the concept composition" below. |
| `src/void/save.ts` & `main.ts` | Defensive `voiddefense.v1` persistence and sole-game bootstrap entrypoint with graceful non-destructive adoption of legacy player callsigns and visual settings. |

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
ablation, without multiplying reservoir energy, income or rewards. Progression saves contain no terrain grid or live placements, so the `voiddefense.v1` save format and existing progression are retained cleanly.

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

`src/void/interior.ts` renders dynamic volumetric cosmic visuals across active
anomaly regions using a recolored, pixelated Star Nest fractal (adapted from Sign99).
The field uses a precomputed 96×96 toroidal fractal tile (11 folding iterations and
8 raymarch steps) polar-mapped with Keplerian accretion swirl into `CellMaterial.VOID`
cells behind exposed earth/rock ledges. High fractal ridges become luminous cyan
and white stars, while filaments glow hot magenta and deep violet, completely
eliminating noisy particle clutter. Both systems adhere strictly to the 1 cell = 1 world
pixel lattice, respect Reduce Motion / Reduced Effects by switching to stable, static
visuals, and maintain complete simulation isolation.

Validation: `tests/void-visuals.test.ts` tests noise algorithm verification, thin
contour silhouettes, color mapping, living wisp flows, clipping, and simulation
isolation. `node tests/void-visuals.mjs` verifies browser rendering, ledge occlusion,
black hole core preservation, reduced motion stability, and captures screenshots
and frame recordings in `test-results/void-visuals/`.

## Specialized Towers, Strikes, and Infantry Roster

- **Chrono Cannon (`chronoCannon`):** `VoidPhysics.consumeCellIntoVoid` emits `recentCellLosses` with `buildingId` and `columnFloors`, and agent Void deaths emit `"unit"` loss events (recording `lastSafeHp` / pre-Void health) into `VoidCombatManager.chronoJournal`. `stepChronoCannons` rewinds terrain and building floors first, then restores Void-fallen units onto safe ground without duplicate IDs or double-claims, recording restored `items` for upward reconstruction rendering.
- **Boundary Prism (`boundaryPrism`):** `VoidField.step` redirects incoming erosion work conservatively along each prism's `angleRad` without creating phantom pressure or bypassing Quarantine Seals, enforcing an order-independent combined per-source redirection cap (`COMBINED_PRISM_REDIRECT_CAP`) across overlapping prisms; rotatable in 45° steps from the tower inspector.
- **Void Siphon (`voidSiphon`):** `VoidField.step` intercepts frontier erosion work up to `siphonIntakeCap` into finite `SiphonState` tanks (`intake` -> `venting` -> `intake`), ticked via `stepSiphonTimers`.
- **Quarantine Bell (`quarantineBell`):** Creates circular `QuarantineSeal` boundaries blocking cross-edge Void propagation in both directions while allowing internal spread, with duration and radius upgrades in `tech/catalog.ts`.
- **Hearthseed (`landfall`):** `VoidPhysics.depositHearthseedIsland` creates monotonically nested reclaimed islands with deterministic `FOREST` (rank 1+) and `FIELD_H`/`FIELD_V` (rank 2+) cover without resurrecting historical buildings.
- **Lantern Bearers (`lanternBearer`), Seamwalkers (`seamwalker`), Jetpack Infantry (`jetpack`):** Spawned as live `Agent` units in `VoidCombatManager` with dedicated upgrade branches in `tech/catalog.ts` (`lanternEscortRadius`, `lanternSurvivability`, `lanternStride`, `seamwalkerWidth`, `seamwalkerHold`, `seamwalkerCadence`). Bearers maintain atomic `lanternRefCount`/`lanternCreatedTemp` solid ground beneath themselves via centralized `releaseAgentResources` cleanup on every death/sell/removal path. Seamwalkers fire staple lasers that populate `frozenVoidCells` with bounded holds. Jetpacks (`layer: "air"`) traverse Void, target organisms only, and ignore ground-only impacts.
- **Echo Mine (`echoMine`):** Lures nearby organisms within a bounded target cap with finite lure duration and post-lure cooldown (`lureCooldownUntilTick`); only enemy-caused destruction (`hp <= 0` with `lastDamageCause === "enemy"`) queues a brief telegraphed `echoPendingBlasts` detonation (and `persistentEchoes` if upgraded), while selling, Void collapse, and falling masonry do not detonate.
- **Countervoid Heart (`countervoidHeart`):** `VoidField.stepCountervoidField` projects a finite-budget opposing orange frontier (`countervoidCells`) across land and into purple Void within heart range, tracking Countervoid-created provenance (`countervoidCreated`) separately so decaying influence when no living Heart remains never deletes pre-existing city or reclaimed land (unless stabilized by `countervoidLasting`).

### Farm fire

`VoidSim.farms` owns `FarmFires` (`src/void/farms.ts`): actual combat energy beams opt in through `LaserBeam.energy`, while Seamwalker staples and cosmetic lines do not ignite terrain. Beam paths ignite wheat, silos and rural building cells. A capped 512-cell active set advances at fixed simulation ticks, spreading locally every half second, damaging HP and leaving persistent run-local scorch. Ruined farm structures lose their building identity/floors and become salvage; crop fires leave soil rather than creating Void. Void consumption cancels burning. New scenarios create fresh fire state; profile/save schemas are unchanged.
