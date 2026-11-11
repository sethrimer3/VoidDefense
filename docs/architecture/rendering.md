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

## Living Void Interior

`src/void/interior.ts` renders the living dynamics inside the Void field:
- Bounded inward-flowing spiral wisps and traveling brightness bands sweep toward the Void's gravitational center.
- Wisps are occluded by intact ground and exposed subterranean strata.
- Inward motion halts under Reduced Motion settings, freezing the wisps in place without visual artifacts.

## Tech DAG & Magic Circles

The technology screen features interactive visual components:
- **Golden Motes (`src/ui/tree-motes.ts`):** Dynamic golden particles flowing along DAG branches towards unlocked technologies, implemented as a discrete 2D fluid simulation. Fully disabled under Reduced Motion.
- **Magic Circle (`src/magic-circle/`):** Pure mathematical formation rendering (`formation.ts`, `render.ts`) generating Voronoi cells, inscribed nested triangles, and projected 4D tesseracts behind technological research trees.
