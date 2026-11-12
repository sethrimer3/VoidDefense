# Rendering and Visual Architecture

Void Defense rendering architecture, pixel pipeline, organic noise contours, subterranean ledges, and living Void visual effects.

## 1:1 World-Pixel Resolution & Discrete Cell Lattice

Void Defense uses one world pixel per simulation cell (384×512 default, 512×768 large).
- Terrain, buildings, infantry, towers, and cosmic entities operate directly on discrete integer lattice coordinates.
- Drawing routines snap positions to discrete integers (`Math.round(x), Math.round(y)`), preventing fractional sub-pixel anti-aliasing blur and maintaining a hard-edged, razor-sharp visual presentation.
- The canvas scales cleanly to viewport dimensions using nearest-neighbor or crisp pixel scaling (`src/void/render.ts`, `src/void/pixel-painter.ts`).

## Organic Noise-Based Enemy Outlines

Cosmic organisms (such as the Queen Bee, Bee Swarms, Nebula Worms, and Constellation Spiders) and Void Nodes feature evolving organic boundary contours.

- **Noise Algorithm:** Defined in `src/void/portal-noise.ts`. It uses smooth cubic Hermite value noise with 4-octave ridged multifractals (`ridged()`, `valueNoise()`, `smooth()`, `hash2()`) sampled on a 96×96 torus.
- **Contour Extraction:** `src/void/contour.ts` computes the exterior boundary of organisms and nodes (`computeOrganismContour()`, `computeNodeContour()`).
- **Chromatic Styling:** Contours sample the multi-octave noise tile, producing flowing violet, magenta, and cyan hues around entity silhouettes.
- **Crisp Cell Rendering:** Organism rendering in `src/void/render.ts` (`drawOrganisms`) anchors drawing at discrete integer cell coordinates (`cx = Math.round(o.x), cy = Math.round(o.y)`), ensuring exact alignment with `organismFootprint()` and avoiding sub-pixel raster jitter.
- **Reduced Motion & Performance Bounding:** When the player enables Reduced Motion (`reduceMotion: true` in settings, setting `renderer.reduceEffects = true`), animation time is clamped to 0. The noise contours remain completely static, deterministic, and eliminate ongoing shader/canvas recomposition costs.

## Subterranean Cutaway Ledges

`src/void/ledge.ts` paints exposed strata along the perimeter where solid ground meets the Void:
- Procedural strata layers (topsoil, sedimentary rock, deep metamorphic stone) are painted with dark basaltic undersides.
- Ledges strictly occupy only existing Void cells and do not overwrite or mutate ground, islands, or active simulation state.
- Cutaway geometry adapts cleanly to viewport scale and respects Reduced Motion modes.

## Oblique ¾ Building Depth & Sorted Structure Pass

`src/void/elevation.ts` and `src/void/render.ts` give buildings, towers, and units whole-pixel ¾ oblique height above the ground plane:
- **Vertical Scale (`FLOORS_PER_PIXEL = 2`):** Two stories map to 1 world pixel of vertical rise (`elevationOf(b)` in `1..15` px). Screen coordinates project upward via $(x_{\text{screen}}, y_{\text{screen}}) = (x, y - E)$.
- **Ground Foundation vs. Elevated Sprite:** `paintCell` paints only the ground foundation slab into the 16×16 terrain chunk cache. `buildBuildingSprite` constructs each building's south facade (window columns, ground lobby, east/west border shading, setback terraces), exposed interior cutaways (`cutawayColorAt` for columns where `columnFloors[idx] < b.height` or whose south neighbor collapsed, painting horizontal concrete floor slabs every 2 px, lit/unlit rooms, broken rebar spikes, and violet Void rim lighting), and raised roof (bevels, helipads, sky gardens, solar arrays) into an offscreen sprite (`CachedBuildingSprite`), composited into a board-wide structure atlas (`getBoardAtlas`) that incrementally repaints only dirty building bounding boxes.
- **Sorted Structure Pass:** After `paintVoidLedge`, towers (elevated 2 px with a dark south base), agents (0–1 px), and buildings sort back-to-front by footprint bottom $y$ (`y + h`), so tall roofs naturally occlude Void, streets, and units north of their south wall while Void, ledges, and units to the left, right, and south remain in front.
- **Whole-Pixel Occlusion Fade & Roof Picking:** When a placement preview or selected tower lies on the ground behind a tall building's raised roof, `render.ts` punches a whole-pixel checkerboard dither (`(x + y) % 2 === 0`, never alpha blur) through the roof. `pickStructureAt` tests elevated building hit masks and tower boxes front-to-back while keeping tower placement and strike targeting strictly footprint-based.
- **Building Height Setting (`buildingHeight`):** Configurable in Sectors & Mode settings (`"full"` default, `"low"` half-height, `"flat"` legacy top-down).
- **Falling Chunks & Civilians:** Pooled `FallingChunk` debris (from collapsing columns, tipped towers, and fallen agents), pooled 1-px grey `DustPuff` particles, and cosmetic 1-px street `Civilian` pedestrians project at `(round(x), round(y - z))`. Over Void (`z < 0`), chunks sink down-screen, shrink in whole-pixel LOD steps (`6 -> 4 -> 2 -> 1 px`), darken toward the Void palette, and are clipped behind northern subterranean ledge front faces (`isOccludedByLedge` in `src/void/ledge.ts`) before disappearing at `z < -24` (emitting a brief `paintVoidRipples` brightness ripple in `src/void/interior.ts` for large chunks). Large structural collapses (`>= 20` columns in one tick) trigger a 1 device-pixel camera shake for 120 ms. Reduced Motion (`reduceEffects`) suppresses falling chunks, dust, camera shake, Void ripples, and civilians while keeping static facades and cutaways intact.

## Living Void Interior

`src/void/interior.ts` renders the living dynamics inside the Void field using a recolored, pixelated Star Nest volumetric fractal:
- Adapts the Star Nest volumetric raymarch fractal (Pablo Roman Andrioli; Sign99 `starNestBackground.ts`) into a toroidal 96×96 discrete field with 11 folding iterations and 8 raymarch steps.
- Torus UV sampling is polar-mapped around active portals with Keplerian-like accretion swirl ($\propto 1 / (1 + 0.15r)$) and logarithmic depth coordinates.
- Recolored along the cosmic Void spectrum: deep indigo/violet nebula beds, hot magenta filaments, and brilliant cyan/white star cores at peak fractal ridges.
- Inward motion halts under Reduced Motion settings, freezing the fractal field in place without visual artifacts.

## Tech DAG & Magic Circles

The technology screen features interactive visual components:
- **Golden Motes (`src/ui/tree-motes.ts`):** Dynamic golden particles flowing along DAG branches towards unlocked technologies, implemented as a discrete 2D fluid simulation. Fully disabled under Reduced Motion.
- **Magic Circle (`src/magic-circle/`):** Pure mathematical formation rendering (`formation.ts`, `render.ts`) generating Voronoi cells, inscribed nested triangles, and projected 4D tesseracts behind technological research trees.
