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

## 2. Time of Day Presets (`day`, `sunset`, `night`), Ambient Fill, and Tone-Mapping

- **Time of Day Data Presets (`TIME_OF_DAY_PRESETS`, `TimeOfDayPreset` in `src/void/lighting.ts`):**
  - Each mode is a self-contained data preset (`sunDir`, `sunHeight`, `sunColor`, `sunIntensity`, `ambientColor`, `voidAmbientColor`, `neonIntensity`, `hazeAmount`, `shadowReachScale`, `shadowStrengthScale`):
    - **Day (`day`):** Bright warm-white sun high in the sky (`sunHeight: 0.86`, `sunIntensity: 0.42`) with short crisp shadows (`shadowReachScale: 0.52`), subtle neon (`neonIntensity: 0.42`), and strong normal-map depth relief.
    - **Sunset (`sunset`):** Low golden-orange sun (`sunHeight: 0.48`, `sunColor: [1.38, 0.68, 0.24]`) casting long dramatic shadows (`shadowReachScale: 1.18`), deep purple-blue ambient in the shade (`ambientColor: [0.36, 0.34, 0.64]`), and emerging neon (`neonIntensity: 1.05`).
    - **Night (`night`):** Deep tinted blue ambient (`ambientColor: [0.17, 0.22, 0.44]`, `voidAmbientColor: [0.24, 0.14, 0.48]`—never flat black or grey). Lighting comes primarily from building neon (Tron blue & warm storefronts), tower neon (Tron orange), streetlights, explosions, and projectiles (`neonIntensity: 1.65`, `hazeAmount: 0.34`).
  - Three compact pixel-styled buttons (**Day / Sunset / Night**, `.void-hud-top-left` in `src/void/ui.ts` and `src/void/void.css`) sit in the top-left of the battle HUD (shifting automatically when the collapsible left deployment palette opens or closes) and persist in `settings.timeOfDay`. Switching modes triggers an instant smooth `0.32s` preset blend (`blendTimeOfDayPresets`).
- **Soft-Shoulder Tone-Mapping & Atmospheric Haze (`toneMapChannel`, `shadeTimeOfDayChannel`):**
  - Multiplies base albedo by normal-lit ambient + directional sunlight + point-light diffuse, adds colored light spill (`pointDiffuse * 64`) and atmospheric haze (`hazeColor * 44`), and applies soft shoulder compression above `185` so bright neon and explosion cores stay saturated without clipping flat white while dark areas retain detail.
  - Wet/shiny city streets and water (`isWetOrShinyGround`) catch subtle specular reflections from nearby point lights and neon halos.
  - Farmland (warm golden wheat, meadows, red barns), futuristic city blocks (slate steel, limestone, cyber arcologies), and the purple/magenta Void retain their recognizable palettes across all three modes.

## 3. Coherent Neon Features, 1/2-Res Emissive Halo Spill, and Dynamic Lights

`collectSceneLights` gathers and prioritizes all active light sources each frame, scaled by the active `TimeOfDayPreset`:

- **Larger Coherent Building Neon Features (`roofColorAt`, `facadeColorAt` in `src/void/elevation.ts`):**
  - Urban buildings replace scattered 1-px window speckles with larger, readable emissive features: wide 3–5 px ground-floor storefront canopies, upper-cornice neon bars, full-height vertical neon sign strips, and 2-row horizontal neon signs / warm amber window bays.
  - All emissive building pixels are tagged in `specMap` / `atlasSpec` with values `>= 240` (`242..250`).
  - Building point lights are offset `0.8 px` south of the south facade (`b.y + b.h + 0.8`, radius `18..23 px`) so storefront canopies cast wide pools of Tron blue (and occasional warm amber) light across the street without self-occlusion.
- **Low-Res (`1/2` Res) Emissive Halo Spill Buffer (`haloR`, `haloG`, `haloB` in `LightingEngine`):**
  - Extracts `atlasSpec >= 240` emissive pixels into a half-resolution (`(w/2) × (h/2)`) world light buffer and runs a separable 5-tap horizontal + vertical pass (`~4..5 world px` spill radius).
  - Adds a soft colored halo around neon signs, canopies, and rooftop beacons directly in the world-pixel light buffer while keeping every sprite edge 100% pixel-crisp (no post-scale screen bloom).
- **Tron-Style Neon Orange Tower Lights (`#ff7b18`–`#ff9e38`):**
  - Placed Resistance towers emit Tron neon orange point lights (`r: 1.38, g: 0.58, b: 0.11`, radius `19..24 px`) from their elevated housings, casting shadows and pooling warm orange light on the ground around them.
- **Short-Lived Dynamic Lights (`falloffPower: 3`):**
  - Explosions (`physics.shockwaves`, `echoPendingBlasts`, radius up to `54 px`, boost `2.65×`), muzzle flashes (`justFired` towers and `lasers` origins/impacts), and in-flight parabolic projectiles (`combat.pellets`) use fast cubic falloff (`(1 - d / R)^3`) and high-frequency deterministic flicker to flash across surrounding buildings and throw moving shadows.

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
  - Configurable in Command Settings (`High`: 34 lights / 12 shadow casters; `Medium`: 24 lights / 9 shadow casters; `Low`: 16 lights / 5 shadow casters). Lights beyond the shadow cap smoothly fade their `shadowStrength` to unshadowed surface glow.
  - `VoidRenderer` monitors `lastTimings.lighting` and automatically drops `effectiveLightingQuality` one tier after sustained slow frames (`> 11.5 ms`), recovering when frame times drop (`< 4.5 ms`).
