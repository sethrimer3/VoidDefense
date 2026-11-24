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

- **Light Restraint, Hero Landmarks & District Accents (`getLandmarkBuildingIds`, `buildingNeonTier`, `districtNeonAccentFor`, `roofColorAt`, `facadeColorAt` in `src/void/elevation.ts`):**
  - To preserve deep blue-purple night darkness and visual hierarchy, only ~20–30% of urban buildings (`buildingNeonTier(world, b) !== "dark"`) carry strong neon signs, cornice bars, or glowing storefront canopies (`specMap` / `atlasSpec >= 240`). The remaining ~70–80% of buildings have calm, unlit facades and clean dark roofs (with a single HVAC core, helipad, or solar/garden deck), and lit windows appear only in small localized clusters (`(lx >> 2, fRow >> 1)`) rather than on every floor.
  - Each map deterministically selects 2–4 spaced **hero landmark** skyscrapers (`getLandmarkBuildingIds(world)`) that receive the brightest, largest full-height vertical neon strips, crown beacons, wide storefront canopies, and top priority in `priorityBuildingLights`.
  - District sectors (`districtNeonAccentFor`) are predominantly Tron cyan (`#00c8ff` / `#7afcff`), accented by 1–2 districts using cyber magenta (`#d838e8` / `#ff94f2`), electric violet (`#7c4dff` / `#c8b8ff`), or cool white-ice (`#8ce8ff` / `#eafaff`), while placed Resistance towers remain uniquely Tron orange.
  - Spaced boulevard median streetlights (`isBoulevardStreetlightAt`) seed soft cool-cyan/white pools into the half-resolution halo buffer, and dashed boulevard/avenue orange lane markings (`isBoulevardOrAvenueLaneAt`, cached in `terrainLane`) add a faint warm ground sheen that slightly illuminates wet pavement in rain.
  - Building point lights are offset `0.8 px` south of the south facade (`b.y + b.h + 0.8`, radius `12..16 px`) so storefront canopies cast pools of district-colored neon light across the street without self-occlusion.
- **Low-Res (`1/2` Res) Emissive Halo Spill Buffer (`halo` in `LightingEngine`):**
  - Extracts `atlasSpec >= 240` emissive pixels into a half-resolution (`(w/2) × (h/2)`) world light buffer and runs a separable 5-tap horizontal + vertical pass (`~4..5 world px` spill radius).
  - The building atlas supplies emissive pixels and stable building IDs. Every surviving emissive fixture contributes unshadowed spill, including buildings outside the point-light budget. Each world-space halo tile samples a two-texel border so the kernel gives the same result at viewport and tile boundaries.
  - The cache stores spill before the time-of-day multiplier. Terrain and atlas edits dirty nearby halo tiles, and the current preset scales the spill during shading. The effect stays at world-pixel scale.
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
  - Building shadow visibility bytes (`0..254`) are keyed by world-local building ID. Other sources use separate slot caches. Motion and caster-tile revisions invalidate each cache within its world-space footprint.

## 5. Incremental Tiled Cache & Performance Budgets

- **16×16 Tiled Cache (`CHUNK_SIZE = 16`):**
  - `LightingEngine.syncChunks` and `BuildingSpriteCache.syncAtlasGbuffer` rebuild terrain normals, heights, occluder elevations, roof sun shadows, and building G-buffer rects **only** for dirtied 16×16 chunks (with a 2-pixel Sobel seam border).
  - `LightingEngine.syncMovingCasters` clears and restamps only the sparse cells occupied by moving units and falling chunks.
- **64-Bit Tile Light Binning:**
  - Point lights are culled only once their influence clears the viewport margin. They are binned into visible 16×16 tiles using 64-bit bitmasks (`tileLightsLo`, `tileLightsHi`).
  - Ambient tiles retain both their CPU pixels and canvas pixels when they leave the viewport. Tiles shade before first use, after terrain or projected atlas edits, and after point lights leave their tile. Exact preset parameters invalidate all ambient validity flags, and each blend frame invalidates them again. The viewport controls which world tiles are needed and leaves their pixel mapping intact.
  - Building point lights use a seeded, spatially spaced ordering established once per world. Low, Medium, and High use fixed prefixes of up to 4, 7, and 10 building point lights, and a tier change fades the point-light contribution through the cutoff. Combat-light priorities cannot evict a building fixture. The emissive halo stays independent of both budgets.
- **Lighting Quality Tiers & Auto-Drop (`lightingQuality` in `src/settings.ts`):**
  - Configurable in Command Settings (`High`: 34 lights / 12 shadow casters; `Medium`: 24 lights / 9 shadow casters; `Low`: 16 lights / 5 shadow casters). Lights beyond the shadow cap smoothly fade their `shadowStrength` to unshadowed surface glow.
  - `VoidRenderer` monitors the combined lighting and reflection computation time and automatically drops `effectiveLightingQuality` one tier after sustained slow frames (`> 11.5 ms`), recovering when frame times drop (`< 4.5 ms`).


## 6. Void Debris and Traffic

Loose fragments and submerged chunks use cached heat palettes shaded by the current sky. Heat adds its own emission near the event horizon. The Void's floor takes the preset's ambient tint, with a directional highlight on the portal rim. Blue civilian traffic and amber delivery trucks cast small, additive pools on nearby road and park pixels at native resolution.

## 7. Water and Glass Reflections

Terrain tags open water, and the building atlas tags intact facade panes and glass
roof panels. Damaged panes and exposed floor slabs are opaque. Each surface has
its own reflectivity, Fresnel strength, roughness, tint, and ripple settings in
`reflections.ts`.

For the fixed oblique camera, a point with height `z` appears at
`groundY - z` on screen and `groundY + z` in water. The water ray checks those
exact projected atlas pixels from near to far and samples the existing lit
building color. High also samples trees and projects lit tower and unit
silhouettes. Point lights cast staggered streaks on nearby water, including
lights along the banks. Ripple displacement uses whole pixels.

Glass reflects the preset sky and sun, the lighting pass supplies aligned
point-light highlights, and a short grid-boundary ray following the reflected
view direction can intercept taller neighboring columns. The sky colors
interpolate during a preset blend.

Only visible reflection tiles and a small camera margin are drawn. Terrain and
atlas edits invalidate nearby receiver tiles. The cache stores geometry hits
separately from their lit colors. Its color validity uses exact sky and sun
parameters, lighting tile revisions, and current moving samples and streaks.
Stable tiles skip uploads. Medium shares ray hits across 2×2 blocks and omits
trees and actors. Low uses sky, light streaks, and glass glints.

Run `node tests/void-reflections.mjs` against the dev server for desktop and
mobile captures, a destruction and moving-unit regression, and per-tier
timings at close zoom and at fit. The gallery uses a canal beside existing
procedural city buildings.

- [Day river](../void-defense/reflections/reflection-river-day.png)
- [Sunset river](../void-defense/reflections/reflection-river-sunset.png)
- [Night river](../void-defense/reflections/reflection-river-night.png)
- [Glass tower at sunset](../void-defense/reflections/reflection-glass-sunset.png)
- [Explosion reflected in water](../void-defense/reflections/reflection-explosion.png)

## 8. Rain Weather, Wet Surface Materials, Puddles, and Ripples

- **Weather State & Wetness Ramp (`weather`, `stepWetness`, `puddleWetnessFor` in `src/void/lighting.ts`):**
  - Supports two weather states (`clear`, `rain`) persisted in `settings.weather` and toggled via the **Rain** button next to **Day / Sunset / Night** in `.void-hud-top-left` (and in Command Settings).
  - Global surface `wetness` (`0..1`) ramps up over `20 s` when rain starts and dries over `60 s` when rain stops. Puddles retain moisture (`wetness^0.55`) and dry last.
  - Subtle whole-pixel rain droplets (`1–2` per 16×16 tile, fast-falling across a 14-px vertical drop in `0.14 s` with low `0.11..0.22` opacity) and 1-px impact splashes draw over non-Void cells and glint softly with local point-light and half-res neon halo colors (`LightingEngine.rainGlintStyle`).
- **Wet Surface Classification & Puddle Mask (`computePuddleDepthAt`, `isPuddleCellAt`, `applyWetAlbedo`):**
  - Urban streets, sidewalks, parking lots, and plazas (`CellMaterial.STREET`, `CellMaterial.PARK` with `LandCover.NONE`) and flat urban rooftops (`SurfaceMaterial.WET_ROOF`) get wet; rural dirt roads (`streetTier === 8`) get slightly wet; grass, crops, forests, and reclaimed soil darken slightly (`applyWetAlbedo`) without reflecting; the Void anomaly absorbs rain without pooling or reflecting.
  - Seeded multi-octave value noise combined with low spots in `terrainReliefAt` (depressions away from raised street curbs and crowns) classifies wet ground into mirror-like puddles (`SurfaceMaterial.WET_PUDDLE`) and blurry wet road sheen (`SurfaceMaterial.WET_SHEEN`).
  - Wet surfaces darken and saturate base albedo with a cool slate-blue tint, flatten puddle bump normals toward `(0, 0, 1)`, lower roughness, and boost specular highlights while keeping sun and point-light shadows intact.
- **Wet Ground Reflections, Light Streaks & Raindrop Ripples (`src/void/reflections.ts`):**
  - Every point light (building neon, orange tower lights, explosions, muzzle flashes, projectiles) and the half-resolution emissive halo buffer cast vertically stretched, palette-quantized colored streaks southward across wet ground in screen space.
  - Puddles and wet streets pick up the time-of-day sky tint and faint blurred inverse-elevation (`groundY + z`) mirrors of nearby buildings, trees, towers, and units, fading with vertical distance from the object.
  - Expanding raindrop ripple rings (`computePuddleRippleOffset`) deterministically perturb puddle reflection lookups by `1–2` whole pixels per tile and time slot; non-puddle wet pavement uses a 1-px shimmer without ring ripples.
  - **Quality Tiers:** When `wetness === 0`, wet reflection work is skipped completely (`0 ms` overhead). On `low`, only sky tint and vertical light streaks are evaluated; on `medium`, streaks plus half-resolution (`2×2`) puddle mirrors are drawn; on `high`, puddles (with raindrop ripples, foliage, and actors) and blurred wet road sheen are all active.

