import assert from "node:assert/strict";
import test from "node:test";
import { BuildingSpriteCache } from "../src/void/elevation.ts";
import { TIME_OF_DAY_PRESETS, blendTimeOfDayPresets } from "../src/void/lighting.ts";
import { CellMaterial, LandCover, SurfaceMaterial } from "../src/void/model.ts";
import { reflectionColor, sampleGlassMirror, sampleWaterMirror, shadeReflection } from "../src/void/reflections.ts";
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
