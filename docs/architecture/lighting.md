# 2.5D Surface Lighting, Normal Maps, and Cast Shadows (`src/void/lighting.ts`, `src/void/elevation.ts`)

Void Defense uses a deterministic, tiled 2.5D deferred lighting engine operating at whole-pixel world resolution (`1 cell = 1 world pixel`). There is **no post-process blur or bloom**; every light casts a real surface glow that falls off across nearby terrain, building facades, roofs, towers, and infantry through procedural normal maps and soft-penumbra shadow raycasting.

## 1. Procedural Normal & Bump Maps (3×3 Sobel)

All world surfaces—terrain, buildings, placed towers, and infantry—generate 3D unit normals `(nx, ny, nz)` procedurally from their height relief and sprite part luminance:

- **Terrain Normals (`terrainReliefAt`, `computeTerrainNormalAt` in `src/void/lighting.ts`):**
  - Evaluates procedural terrain relief across streets (curbs adjacent to buildings and avenue crowns), bridges, walls/barriers, rubble salvage, forest canopies, orchards, crop rows (`FIELD_H`, `FIELD_V`), silos, and water ripples.
  - Applies a 3×3 Sobel gradient operator (`[-1, 0, 1; -2, 0, 2; -1, 0, 1]`) over the relief field and quantizes unit normals into `Int8Array` buffers (`terrainNx`, `terrainNy`, `terrainNz` in `-127..127`).
- **Building Roof, Facade & Cutaway G-Buffer (`buildBuildingSprite`, `syncAtlasGbuffer` in `src/void/elevation.ts`):**
  - Combines hand-authored architectural geometry (north/west/south/east parapet bevels, setback terraces, spherical civic domes, pitched homestead/barn gables, solar arrays, helipads, recessed window columns, vertical pilasters, projecting concrete cutaway floor slabs) with a 3×3 Sobel micro-relief filter derived from per-part height and pixel luminance.
  - Emits per-pixel 3D elevation (`elevMap` -> `atlasElev`), quantized unit normals (`nxMap`, `nyMap`, `nzMap` -> `atlasNx`, `atlasNy`, `atlasNz`), and specular weights (`specMap` -> `atlasSpec`).
- **Towers & Infantry (`computeSpriteSobelNormals`, `TOWER_SOBEL_NORMALS`, `INFANTRY_SOBEL_NORMALS` in `src/void/lighting.ts`):**
  - Generates 3×3 Sobel normal grids from hand-authored sprite part height matrices (turret roof dome, beveled armor corners, south mounting collar, infantry helmet dome, and torso armor).
  - `LightingEngine.surfacePalette` samples local point lights, directional sun, ambient fill, and shadow visibility against each sprite part's Sobel normal to shade its pixel palette without smearing or blurring sprite edges.

## 2. Directional Sun, Ambient Fill, and Biome Palette Preservation

- **The Sun (`SUN_DIRECTION`, `SUN_WARM_COLOR`):**
  - Warm directional sunlight from the North-West (`(-0.52, -0.52, 0.68)` normalized) casts long soft-penumbra shadows toward the South-East (`computeShadowAt` in `src/void/render.ts` and `roofShadowAt` in `src/void/lighting.ts`).
  - Buildings, placed towers, and infantry all cast directional sun shadows with a central umbra and flanked penumbra.
- **Cool Ambient & Void Fill (`AMBIENT_COOL_FILL`, `VOID_AMBIENT_FILL`):**
  - Shadowed and lit surfaces receive a cool sky ambient fill (`[0.05, 0.09, 0.16]`), transitioning near the anomaly to a cosmic Void ambient tint (`[0.11, 0.05, 0.20]`).
  - Farmland (warm golden wheat, meadows, red barns), futuristic city blocks (slate steel, limestone, cyber arcologies), and the purple/magenta Void retain their recognizable palettes.

## 3. Light Colors & Dynamic Lights

`collectSceneLights` gathers and prioritizes all active light sources each frame:

- **Tron-Style Neon Blue Building Lights (`#00c8ff`–`#7afcff`):**
  - Urban buildings feature Tron neon blue lobbies, window accents, and rooftop beacons (`ARCH_PALETTES` in `src/void/elevation.ts`) and emit neon blue point lights (`r: 0.08, g: 0.82, b: 1.25`) that cast shadows and illuminate nearby streets, units, and adjacent facades.
- **Tron-Style Neon Orange Tower Lights (`#ff7b18`–`#ff9e38`):**
  - Placed Resistance towers emit Tron neon orange point lights (`r: 1.22, g: 0.54, b: 0.12`) from their elevated housings, casting shadows and lighting surrounding surfaces and units.
- **Short-Lived Dynamic Lights (`falloffPower: 3`):**
  - Explosions (`physics.shockwaves`, `echoPendingBlasts`), muzzle flashes (`justFired` towers and `lasers` origins/impacts), and in-flight parabolic projectiles (`combat.pellets`) use fast cubic falloff (`(1 - d / R)^3`) and high-frequency deterministic flicker.

## 4. Soft-Penumbra 2.5D Shadow Raycasting

- **Grid-Boundary DDA (`traceLightOcclusion`):**
  - Marches exact grid cell boundaries from receiver `(wx, wy, wz)` to light `(lx, ly, lz)` so 1-pixel infantry or thin walls never slip between samples.
  - Checks both static caster heights (`groundElev`: surviving building `columnFloors`, walls, silos, and placed towers) and transient moving caster intervals (`casterTop`, `casterBottom`: infantry, mechs, airborne units, and falling 3D masonry chunks).
  - Grazing height clearance (`softness = 0.24 + (1 - entry) * 0.45`) and cell traversal coverage produce smooth penumbra shadow edges rather than hard binary stencils.
- **Per-Light Shadow Visibility Cache (`ShadowCache`):**
  - Visibility bytes (`0..254`) are cached per light slot and invalidated only when the light moves or a caster tile within the light's footprint increments `shadowTileRevision`.

## 5. Incremental Tiled Cache & Performance Budgets

- **16×16 Tiled Cache (`CHUNK_SIZE = 16`):**
  - `LightingEngine.syncChunks` and `BuildingSpriteCache.syncAtlasGbuffer` rebuild terrain normals, heights, occluder elevations, roof sun shadows, and building G-buffer rects **only** for dirtied 16×16 chunks (with a 2-pixel Sobel seam border).
  - `LightingEngine.syncMovingCasters` clears and restamps only the sparse cells occupied by moving units and falling chunks.
- **64-Bit Tile Light Binning:**
  - Point lights are culled against the camera viewport (`viewBounds` + radius margin), prioritized, and binned into 16×16 tiles using 64-bit bitmasks (`tileLightsLo`, `tileLightsHi`). Only tiles with active lights are shaded and cleared on the next frame.
- **Lighting Quality Tiers & Auto-Drop (`lightingQuality` in `src/settings.ts`):**
  - Configurable in Command Settings (`High`: 48 lights / 28 shadow casters; `Medium`: 34 lights / 14 shadow casters; `Low`: 20 lights / 6 shadow casters). Lights beyond the shadow cap smoothly fade their `shadowStrength` to unshadowed surface glow.
  - `VoidRenderer` monitors `lastTimings.lighting` and automatically drops `effectiveLightingQuality` one tier after sustained slow frames (`> 11.5 ms`), recovering when frame times drop (`< 4.5 ms`).
