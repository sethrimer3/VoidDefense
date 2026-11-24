import assert from "node:assert/strict";
import test from "node:test";
import { BuildingSpriteCache, hexToElevAbgr } from "../src/void/elevation.ts";
import {
  applyWetAlbedo,
  blendTimeOfDayPresets,
  computePuddleDepthAt,
  isPuddleCellAt,
  LightingEngine,
  normalizeVoidWeather,
  puddleWetnessFor,
  stepWetness,
  TIME_OF_DAY_PRESETS,
  WETNESS_DRY_SECONDS,
  WETNESS_RAMP_UP_SECONDS,
} from "../src/void/lighting.ts";
import { CellMaterial, LandCover, SurfaceMaterial } from "../src/void/model.ts";
import {
  computePuddleRippleOffset,
  reflectionColor,
  sampleGlassMirror,
  sampleWaterMirror,
  shadeReflection,
  SurfaceReflections,
} from "../src/void/reflections.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

const WIDTH = 32;
const HEIGHT = 32;
const at = (x: number, y: number) => y * WIDTH + x;

function fixtureAtlas() {
  return {
    atlasBldId: new Int16Array(WIDTH * HEIGHT).fill(-1),
    atlasElev: new Uint8Array(WIDTH * HEIGHT),
    atlasNx: new Int8Array(WIDTH * HEIGHT),
    atlasNy: new Int8Array(WIDTH * HEIGHT),
    atlasNz: new Int8Array(WIDTH * HEIGHT),
  };
}

test("still-water golden mirrors a lit facade at its exact inverse elevation", () => {
  const atlas = fixtureAtlas();
  const face = at(11, 7);
  atlas.atlasBldId[face] = 2;
  atlas.atlasElev[face] = 5; // ground y=12, mirrored y=17
  assert.equal(sampleWaterMirror(11, 17, WIDTH, atlas), face);
  assert.equal(sampleWaterMirror(12, 17, WIDTH, atlas), -1);
  assert.equal(sampleWaterMirror(11, 16, WIDTH, atlas), -1);

  const base = reflectionColor([24, 41, 67]);
  const neon = reflectionColor([39, 180, 238]);
  assert.equal(shadeReflection(SurfaceMaterial.WATER, base, neon, 0.707), reflectionColor([25, 124, 190]));
  assert.notEqual(shadeReflection(SurfaceMaterial.WATER, base, neon, 0.15), shadeReflection(SurfaceMaterial.WATER, base, neon, 1));
});

test("glass golden samples a taller northern roof and adds a sunset glint", () => {
  const atlas = fixtureAtlas();
  const pane = at(15, 18);
  atlas.atlasBldId[pane] = 1;
  atlas.atlasElev[pane] = 3;
  atlas.atlasNz[pane] = 127;
  const height = new Uint8Array(WIDTH * HEIGHT);
  height[at(15, 19)] = 6;
  const buildings = new Int16Array(WIDTH * HEIGHT).fill(-1);
  buildings[at(15, 19)] = 4;
  const source = at(15, 14);
  atlas.atlasBldId[source] = 4;
  atlas.atlasElev[source] = 5;
  assert.equal(sampleGlassMirror(pane, WIDTH, HEIGHT, atlas, height, buildings), source);
  assert.equal(shadeReflection(
    SurfaceMaterial.GLASS, reflectionColor([46, 51, 72]), reflectionColor([205, 98, 116]), 0.48,
    reflectionColor([22, 10, 2]),
  ), reflectionColor([113, 74, 88]));
  height[at(15, 19)] = 3;
  assert.equal(sampleGlassMirror(pane, WIDTH, HEIGHT, atlas, height, buildings), -1);
});

test("water stops reflecting a swallowed canopy", () => {
  const atlas = fixtureAtlas();
  const ground = at(12, 10);
  const material = new Uint8Array(WIDTH * HEIGHT);
  const landCover = new Uint8Array(WIDTH * HEIGHT);
  material[ground] = CellMaterial.PARK;
  landCover[ground] = LandCover.FOREST;
  assert.equal(sampleWaterMirror(12, 13, WIDTH, atlas, { material, landCover }), -2 - ground);
  material[ground] = CellMaterial.VOID;
  assert.equal(sampleWaterMirror(12, 13, WIDTH, atlas, { material, landCover }), -1);
});

test("damage strips glass and destruction removes a projected water source on the dirty atlas", () => {
  const { world } = new VoidSim("centralRupture", "underSiege", emptyTechWallet());
  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  const { w, h } = world.grid;
  const pane = cache.atlasSurface.findIndex((tag, idx) => tag === SurfaceMaterial.GLASS &&
    cache.atlasElev[idx] > 0 && ((idx / w) | 0) + cache.atlasElev[idx] * 2 < h);
  assert.ok(pane >= 0);
  const owner = cache.atlasBldId[pane];
  const x = pane % w;
  const waterY = ((pane / w) | 0) + cache.atlasElev[pane] * 2;
  const building = world.buildings[owner];
  world.grid.clearDirtyFlags();
  for (const i of building.cells) {
    world.hp[i] = Math.max(1, Math.floor(world.maxHp[i] * 0.64));
    world.grid.markIndexDirty(i);
  }
  cache.syncAtlasGbuffer(world, "full", world.grid.dirtyChunks);
  assert.ok(!cache.atlasSurface.some((tag, i) => tag === SurfaceMaterial.GLASS && cache.atlasBldId[i] === owner));
  const before = sampleWaterMirror(x, waterY, w, cache);
  assert.ok(before >= 0);
  assert.equal(cache.atlasBldId[before], owner);

  for (const i of building.cells) {
    world.material[i] = CellMaterial.VOID;
    world.buildingAt[i] = -1;
    world.hp[i] = world.columnFloors[i] = 0;
    world.grid.markIndexDirty(i);
  }
  cache.syncAtlasGbuffer(world, "full", world.grid.dirtyChunks);
  const after = sampleWaterMirror(x, waterY, w, cache);
  assert.ok(after === -1 || cache.atlasBldId[after] !== owner);
});

test("reflected sky blends continuously across time of day", () => {
  const day = TIME_OF_DAY_PRESETS.day;
  const night = TIME_OF_DAY_PRESETS.night;
  const mixed = blendTimeOfDayPresets(day, night, 0.5);
  assert.deepEqual(mixed.skyColor, [64.5, 101.5, 147]);
  assert.equal(blendTimeOfDayPresets(day, night, 1), night);
});

test("weather state wetness ramps up over 20s in rain, dries over 60s when clear, and puddles dry last", () => {
  assert.equal(normalizeVoidWeather("rain"), "rain");
  assert.equal(normalizeVoidWeather("clear"), "clear");
  assert.equal(normalizeVoidWeather("storm"), "clear");
  assert.equal(WETNESS_RAMP_UP_SECONDS, 20);
  assert.equal(WETNESS_DRY_SECONDS, 60);

  let w = 0;
  w = stepWetness(w, "rain", 5);
  assert.ok(Math.abs(w - 0.25) < 1e-6);
  w = stepWetness(w, "rain", 10);
  assert.ok(Math.abs(w - 0.75) < 1e-6);
  w = stepWetness(w, "rain", 10);
  assert.equal(w, 1, "wetness clamps at 1 after 20s of rain");

  w = stepWetness(w, "clear", 15);
  assert.ok(Math.abs(w - 0.75) < 1e-6);
  assert.ok(puddleWetnessFor(w) > w, "puddles retain higher wetness while drying");
  w = stepWetness(w, "clear", 30);
  assert.ok(Math.abs(w - 0.25) < 1e-6);
  assert.ok(puddleWetnessFor(w) > 0.45, "puddles dry last when roads are mostly dry");
  w = stepWetness(w, "clear", 20);
  assert.equal(w, 0, "wetness reaches 0 after 60s of drying");
  assert.equal(puddleWetnessFor(w), 0);
});

test("puddle mask and raindrop ripples are deterministic per tile and favor low elevation spots", () => {
  const sim1 = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const sim2 = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim1;
  const { w, h } = world.grid;

  let streetPuddles = 0;
  let curbPuddles = 0;
  let crownOrLowPuddles = 0;
  for (let y = 10; y < h - 10; y += 2) {
    for (let x = 10; x < w - 10; x += 2) {
      const idx = y * w + x;
      const d1 = computePuddleDepthAt(world, x, y);
      const d2 = computePuddleDepthAt(sim2.world, x, y);
      assert.equal(d1, d2, "Puddle depth must be deterministic across identical seeds");
      assert.equal(isPuddleCellAt(world, x, y), d1 > 0);
      if (world.material[idx] === CellMaterial.VOID || world.material[idx] === CellMaterial.WALL) {
        assert.equal(d1, 0, "Void and walls never form puddles");
      }
      if (world.material[idx] === CellMaterial.PARK && world.landCover[idx] !== LandCover.NONE) {
        assert.equal(d1, 0, "Grass, crops, and forests do not form reflective puddles");
      }
      if (world.material[idx] === CellMaterial.STREET && world.landCover[idx] !== LandCover.BRIDGE) {
        if (d1 > 0) streetPuddles++;
        // Compare low street spot vs raised curb relief at the same coordinate
        const lowDepth = computePuddleDepthAt(world, x, y, 0.0);
        const raisedDepth = computePuddleDepthAt(world, x, y, 0.24);
        if (lowDepth > 0) crownOrLowPuddles++;
        if (raisedDepth > 0) curbPuddles++;
        assert.ok(lowDepth >= raisedDepth, "Lower elevation relief must be at least as puddle-prone as raised curbs");
      }
    }
  }
  assert.ok(streetPuddles > 20, `Expected deterministic street puddles, got ${streetPuddles}`);
  assert.ok(crownOrLowPuddles > curbPuddles, "Low spots form more puddles than raised curbs");

  // Wet albedo darkens and saturates with a cool blue shift
  const [wr, wg, wb] = applyWetAlbedo(80, 80, 80, 1.0);
  assert.ok(wr < 80 && wg < 80 && wb < 80, "Wet surface darkens albedo");
  assert.ok(wb >= wg && wg >= wr, "Wet surface has a cool slate-blue tint");

  // Raindrop ripple ring offsets are deterministic and bounded to 1-2 whole pixels
  let activeRipples = 0;
  for (let y = 16; y < 80; y++) {
    for (let x = 16; x < 80; x++) {
      const r1 = computePuddleRippleOffset(world.seed, x, y, 2.4);
      const r2 = computePuddleRippleOffset(world.seed, x, y, 2.4);
      assert.deepEqual(r1, r2);
      assert.equal(r1[0], Math.round(r1[0]));
      assert.equal(r1[1], Math.round(r1[1]));
      assert.ok(Math.abs(r1[0]) <= 2 && Math.abs(r1[1]) <= 2);
      if (r1[0] !== 0 || r1[1] !== 0) activeRipples++;
    }
  }
  assert.ok(activeRipples > 15, `Expected active expanding ripple rings across puddle tiles, got ${activeRipples}`);
});

test("wet ground reflections respect quality tiers (dry off, low streaks only, medium streaks + puddles, high full + ripples)", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const { w, h, count } = world.grid;

  const b = world.buildings.find(
    (mb) => mb.isSkyscraper && mb.height >= 16 && mb.w >= 6 && mb.x > 40 && mb.x < w - 50 && mb.y > 40 && mb.y < h - 60,
  )!;
  assert.ok(b, "Expected a skyscraper");

  // Create a clean wet street corridor immediately south of building `b` with both puddle and non-puddle sheen cells
  const southY = b.y + b.h;
  for (let y = southY; y < southY + 14; y++) {
    for (let x = b.x - 4; x < b.x + b.w + 4; x++) {
      const idx = y * w + x;
      world.material[idx] = CellMaterial.STREET;
      world.landCover[idx] = LandCover.NONE;
      world.streetTier[idx] = 2;
      world.buildingAt[idx] = -1;
      world.columnFloors[idx] = 0;
    }
  }
  world.grid.markAllDirty();

  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  const lighting = new LightingEngine();
  lighting.syncChunks(world, "full");

  // Force two known mirror cells directly below `b` (where sampleWaterMirror hits `b`): one puddle, one wet sheen
  let puddleIdx = -1;
  let sheenIdx = -1;
  for (let y = southY + 1; y < southY + 10; y++) {
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      const hit = sampleWaterMirror(x, y, w, cache);
      if (hit >= 0 && cache.atlasBldId[hit] === b.id) {
        const idx = y * w + x;
        if (puddleIdx < 0) {
          lighting.terrainSurface[idx] = SurfaceMaterial.WET_PUDDLE;
          puddleIdx = idx;
        } else if (sheenIdx < 0 && x !== (puddleIdx % w)) {
          lighting.terrainSurface[idx] = SurfaceMaterial.WET_SHEEN;
          sheenIdx = idx;
        }
      }
    }
  }
  assert.ok(puddleIdx >= 0 && sheenIdx >= 0, "Expected both puddle and sheen mirror cells south of building");

  const baseTerrain = new Uint32Array(count).fill(hexToElevAbgr("#181e28"));
  const preset = TIME_OF_DAY_PRESETS.night;
  const view = { x0: b.x - 16, y0: b.y - 16, x1: b.x + b.w + 16, y1: southY + 20 };
  const light = {
    x: (puddleIdx % w),
    y: southY,
    z: 4,
    r: 1.4,
    g: 0.65,
    b: 0.15,
    radius: 18,
    specular: 0.9,
    castsShadows: false,
    shadowStrength: 0,
  };

  const reflections = new SurfaceReflections();
  const dirty = new Uint8Array(world.grid.chunkCount);

  // 1. Dry (wetness = 0): zero wet ground reflection pixels painted
  lighting.renderLighting(world, baseTerrain, cache, [light], preset, view, undefined, false, 16, 0);
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [light], preset, "high", 1.0, 0);
  assert.equal(reflections.water.pixels[puddleIdx], 0, "Dry puddle cell must have no reflection overlay");
  assert.equal(reflections.water.pixels[sheenIdx], 0, "Dry road sheen cell must have no reflection overlay");

  // 2. Low quality with wetness = 1: light streaks only (building image hit is ignored on low)
  lighting.renderLighting(world, baseTerrain, cache, [light], preset, view, undefined, false, 0, 1);
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [], preset, "low", 1.0, 1);
  const lowNoLightPuddle = reflections.water.pixels[puddleIdx];
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [light], preset, "low", 1.0, 1);
  const lowStreakPuddle = reflections.water.pixels[puddleIdx];
  assert.notEqual(lowStreakPuddle, 0, "Wet surface on low quality receives sky tint and light streak");
  assert.notEqual(lowStreakPuddle, lowNoLightPuddle, "Light streak visibly brightens wet ground below light on low quality");

  // 3. Medium quality with wetness = 1 and no point lights: puddles reflect building image, non-puddle sheen only reflects sky
  lighting.renderLighting(world, baseTerrain, cache, [], preset, view, undefined, false, 16, 1);
  // Make the building's lit facade bright so its reflection differs from dark night sky
  for (let i = 0; i < count; i++) {
    if (cache.atlasBldId[i] === b.id) {
      lighting.buildingLightU32[i] = hexToElevAbgr("#ffaa44");
    }
  }
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [], preset, "low", 1.0, 1);
  const lowPuddle = reflections.water.pixels[puddleIdx];
  const lowSheen = reflections.water.pixels[sheenIdx];

  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [], preset, "medium", 1.0, 1);
  const medPuddle = reflections.water.pixels[puddleIdx];
  const medSheen = reflections.water.pixels[sheenIdx];
  assert.notEqual(medPuddle, lowPuddle, "Medium quality reflects building facade in puddles");
  assert.equal(medSheen, lowSheen, "Medium quality omits building image ray on non-puddle sheen");

  // 4. High quality with wetness = 1: both puddles and wet road sheen reflect building image
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [], preset, "high", 1.0, 1);
  const highSheen = reflections.water.pixels[sheenIdx];
  assert.notEqual(highSheen, medSheen, "High quality reflects blurred building image on wet road sheen as well as puddles");

  // 5. Drying back to 0 clears wet reflection pixels cleanly
  reflections.begin(world, dirty, view);
  reflections.paint(cache, lighting, baseTerrain, [light], preset, "high", 2.0, 0);
  assert.equal(reflections.water.pixels[puddleIdx], 0, "Drying to 0 clears puddle reflection pixels");
  assert.equal(reflections.water.pixels[sheenIdx], 0, "Drying to 0 clears sheen reflection pixels");
});

