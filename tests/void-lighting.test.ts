import assert from "node:assert/strict";
import test from "node:test";
import { BuildingSpriteCache, hexToElevAbgr } from "../src/void/elevation.ts";
import {
  collectSceneLights,
  computeTerrainNormalAt,
  LightingEngine,
  MAX_DYNAMIC_LIGHTS,
  type PointLight,
  terrainReliefAt,
  traceLightOcclusion,
} from "../src/void/lighting.ts";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("1. Building bump maps: south facades, side borders, parapet bevels, domes, and gables produce accurate 3D normals", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const cache = new BuildingSpriteCache();

  // Pick an intact skyscraper
  const sky = world.buildings.find((b) => b.isSkyscraper && b.w >= 6 && b.h >= 6 && b.height >= 16);
  assert.ok(sky, "Expected an intact skyscraper");
  const sp = cache.getSprite(world, sky, "full");
  assert.ok(sp.intactCount > 0);
  assert.equal(sp.nxMap.length, sp.w * sp.h);
  assert.equal(sp.nyMap.length, sp.w * sp.h);
  assert.equal(sp.nzMap.length, sp.w * sp.h);
  assert.equal(sp.elevMap.length, sp.w * sp.h);
  assert.equal(sp.specMap.length, sp.w * sp.h);

  // Every occupied pixel must have a unit-length normal (within quantization tolerance)
  let facadeSouthNormals = 0;
  let westBevelNormals = 0;
  let eastBevelNormals = 0;
  let roofUpNormals = 0;

  for (let i = 0; i < sp.hitMask.length; i++) {
    if (!sp.hitMask[i]) continue;
    const nx = sp.nxMap[i] / 127;
    const ny = sp.nyMap[i] / 127;
    const nz = sp.nzMap[i] / 127;
    const len = Math.hypot(nx, ny, nz);
    assert.ok(len > 0.9 && len < 1.1, `Expected normalized 3D bump normal, got length ${len}`);

    if (ny > 0.55) facadeSouthNormals++;
    if (nx < -0.35) westBevelNormals++;
    if (nx > 0.35) eastBevelNormals++;
    if (nz > 0.75) roofUpNormals++;
  }

  assert.ok(facadeSouthNormals > 10, "South facade pixels must have south-facing normals (ny > 0)");
  assert.ok(westBevelNormals > 3, "West edge/parapet pixels must tilt westward (nx < 0)");
  assert.ok(eastBevelNormals > 3, "East edge/parapet pixels must tilt eastward (nx > 0)");
  assert.ok(roofUpNormals > 10, "Roof pixels must face upward (nz > 0)");

  // Homestead / barn gable roofs have opposing slope normals across their ridge
  const rustic = world.buildings.find(
    (b) => (b.archStyle === "homestead" || b.archStyle === "barn") && b.cells.length >= 9,
  );
  if (rustic) {
    const rsp = cache.getSprite(world, rustic, "full");
    let negSlope = 0;
    let posSlope = 0;
    const horiz = rustic.w >= rustic.h;
    for (let i = 0; i < rsp.hitMask.length; i++) {
      if (!rsp.hitMask[i]) continue;
      const slope = horiz ? rsp.nyMap[i] : rsp.nxMap[i];
      if (slope < -40) negSlope++;
      if (slope > 40) posSlope++;
    }
    assert.ok(negSlope > 0 && posSlope > 0, "Pitched gable roof must have two opposing slope normals");
  }
});

test("2. Terrain relief & bump normals respond to walls, rubble, forest canopy, and street curbs", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const { w } = world.grid;

  const cx = 60;
  const cy = 60;
  const idx = cy * w + cx;

  // Flat uniform street patch has vertical normal (0, 0, 1)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (cy + dy) * w + (cx + dx);
      world.material[i] = CellMaterial.STREET;
      world.buildingAt[i] = -1;
      world.streetTier[i] = 2;
      world.landCover[i] = LandCover.NONE;
    }
  }
  const [nxFlat, nyFlat, nzFlat] = computeTerrainNormalAt(world, cx, cy);
  assert.ok(Math.abs(nxFlat) < 0.05 && Math.abs(nyFlat) < 0.05 && nzFlat > 0.98);

  // Placing a defensive wall to the east (cx + 1, cy) tilts the bump normal at (cx, cy) westward (nx < 0)
  world.material[idx + 1] = CellMaterial.WALL;
  assert.ok(terrainReliefAt(world, cx + 1, cy) > terrainReliefAt(world, cx, cy));
  const [nxWall, , nzWall] = computeTerrainNormalAt(world, cx, cy);
  assert.ok(nxWall < -0.4, `Expected wall on east to tilt normal westward (nx = ${nxWall})`);
  assert.ok(nzWall > 0.2);
});

test("3. 2.5D height-field shadow raycasting: buildings block light and cast shadows until they collapse", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const { w } = world.grid;
  const engine = new LightingEngine();
  engine.syncChunks(world, "full");

  // Pick a tall skyscraper
  const sky = world.buildings.find(
    (b) => b.isSkyscraper && b.height >= 20 && b.x > 30 && b.x < w - 30 && b.y > 30 && b.y < world.grid.h - 30,
  )!;
  assert.ok(sky);

  // Place a light source due East of the skyscraper at height z = 5 (lower than the skyscraper's elevation ~10..15)
  const midY = sky.y + Math.floor(sky.h * 0.5);
  const lightX = sky.x + sky.w + 6;
  const lightY = midY;
  const lightZ = 5;

  // Target point on the ground due West of the skyscraper (on the shadow side)
  const shadowX = sky.x - 3;
  const shadowY = midY;
  const visBlocked = traceLightOcclusion(
    world,
    engine.groundElev,
    shadowX,
    shadowY,
    0,
    -1,
    lightX,
    lightY,
    lightZ,
  );
  assert.equal(visBlocked, 0, "Tall skyscraper must occlude low light source on the opposite side");

  // Target point on the ground on the SAME (East) side as the light source has clear line of sight
  const litX = sky.x + sky.w + 2;
  const visClear = traceLightOcclusion(
    world,
    engine.groundElev,
    litX,
     midY,
    0,
    -1,
    lightX,
    lightY,
    lightZ,
  );
  assert.equal(visClear, 1, "Unobstructed ground between building and light must have visibility 1");

  // Collapse the skyscraper (set columnFloors to 0) and re-sync chunks: shadow clears!
  for (const cIdx of sky.cells) {
    world.columnFloors[cIdx] = 0;
    world.grid.markIndexDirty(cIdx);
  }
  engine.syncChunks(world, "full", world.grid.dirtyChunks);
  const visAfterCollapse = traceLightOcclusion(
    world,
    engine.groundElev,
    shadowX,
    shadowY,
    0,
    -1,
    lightX,
    lightY,
    lightZ,
  );
  assert.equal(visAfterCollapse, 1, "Once building collapses, light ray is no longer blocked");
});

test("4. Tiled deferred 2.5D lighting: explosions and Void light up facing building facades/roofs and darken shadowed ground without mutating sim", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const { w, count } = world.grid;

  const matBefore = world.material.slice();
  const hpBefore = world.hp.slice();
  const floorsBefore = world.columnFloors.slice();

  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");

  const engine = new LightingEngine();
  engine.syncChunks(world, "full");

  // Fill dummy base terrain colors
  const terrainU32 = new Uint32Array(count).fill(hexToElevAbgr("#202632"));

  // Pick a tall skyscraper with a visible south facade
  const sky = world.buildings.find(
    (b) => b.isSkyscraper && b.height >= 18 && b.w >= 6 && b.h >= 6 && b.x > 30 && b.x < w - 30 && b.y > 30 && b.y < world.grid.h - 30,
  )!;
  assert.ok(sky);

  // Clear any neighboring buildings immediately south or north of `sky` for an isolated test
  for (let y = sky.y - 10; y < sky.y + sky.h + 12; y++) {
    for (let x = sky.x - 6; x < sky.x + sky.w + 6; x++) {
      const idx = y * w + x;
      if (world.buildingAt[idx] !== sky.id) {
        world.material[idx] = CellMaterial.STREET;
        world.buildingAt[idx] = -1;
        world.columnFloors[idx] = 0;
      }
    }
  }
  cache.syncAtlasGbuffer(world, "full");
  engine.syncChunks(world, "full");

  // Place a bright orange explosion light South-East of `sky` so it lights the south facade & east bevel
  // while casting a dynamic shadow onto the visible street West of `sky`
  const midY = sky.y + Math.floor(sky.h * 0.5);
  const explosionLight: PointLight = {
    x: sky.x + sky.w + 3,
    y: midY + 3,
    z: 6,
    r: 1.8,
    g: 0.9,
    b: 0.3,
    radius: 28,
    specular: 0.9,
    castsShadows: true,
    shadowStrength: 0.52,
    bloom: 0.9,
  };

  const matSnap = world.material.slice();
  const floorsSnap = world.columnFloors.slice();
  engine.renderLighting(world, terrainU32, cache, [explosionLight]);

  // 1. South facade and roof pixels of `sky` must be lit in `buildingLightU32`
  let litBuildingPixels = 0;
  for (let sy = sky.y - 15; sy < sky.y + sky.h; sy++) {
    for (let sx = sky.x; sx < sky.x + sky.w; sx++) {
      const idx = sy * w + sx;
      if (engine.buildingLightU32[idx] !== 0) {
        litBuildingPixels++;
      }
    }
  }
  assert.ok(litBuildingPixels >= 15, `Expected explosion to light >= 15 skyscraper pixels, got ${litBuildingPixels}`);

  // 2. Street ground West of `sky` (occluded by `sky` from the SE explosion) must be darkened by the dynamic cast shadow
  const eastLitIdx = midY * w + (sky.x + sky.w + 1);
  const westShadowIdx = (midY - 1) * w + (sky.x - 2);

  const litEastAbgr = engine.terrainLightU32[eastLitIdx];
  const shadowedWestAbgr = engine.terrainLightU32[westShadowIdx];
  assert.notEqual(litEastAbgr, 0, "Street between building and explosion must be lit");
  assert.notEqual(shadowedWestAbgr, 0, "Street behind building must receive dynamic cast shadow");

  const eastR = litEastAbgr & 0xff;
  const baseR = terrainU32[eastLitIdx] & 0xff;
  const westR = shadowedWestAbgr & 0xff;
  assert.ok(eastR > baseR, `Lit street R (${eastR}) must be brighter than base R (${baseR})`);
  assert.ok(westR < baseR, `Shadowed street R (${westR}) behind building must be darker than base R (${baseR})`);

  // 3. Simulation state is untouched by renderLighting
  assert.deepEqual(world.material, matSnap);
  assert.deepEqual(world.hp, hpBefore);
  assert.deepEqual(world.columnFloors, floorsSnap);
});

test("5. collectSceneLights gathers lights from explosions, portals, frontier, shells, lasers, fires, and towers within cap", () => {
  const sim = new VoidSim("organismEscalation", "underSiege", emptyTechWallet(), true);
  sim.stepTicks(60);

  // Add an active explosion shockwave, a laser beam, an artillery shell, and a farm fire
  sim.physics.shockwaves.push({
    x: 100,
    y: 100,
    maxRadius: 12,
    life: 0.05,
    maxLife: 0.4,
    color: "#ff9e38",
    secondaryColor: "#fff3b0",
  });
  sim.combat.lasers.push({
    x0: 80,
    y0: 80,
    x1: 95,
    y1: 95,
    color: "#48e5ff",
    ttl: 0.15,
    energy: true,
  });
  sim.combat.pellets.push({
    x: 60,
    y: 60,
    tx: 110,
    ty: 110,
    progress: 0.5,
    speed: 1,
    radius: 4,
    wallPayload: false,
    matterDensity: 1,
    damage: 40,
  });

  const lights = collectSceneLights(sim, 1.5, false, "full");
  assert.ok(lights.length >= 6, `Expected >= 6 scene lights, got ${lights.length}`);
  assert.ok(lights.length <= MAX_DYNAMIC_LIGHTS, `Lights must be capped at ${MAX_DYNAMIC_LIGHTS}`);
  assert.ok(lights.some((l) => l.bloom >= 0.6 && l.castsShadows), "Expected high-bloom shadow-casting explosion/portal light");
});
