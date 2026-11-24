import assert from "node:assert/strict";
import test from "node:test";
import { ARCH_PALETTES, BuildingSpriteCache, hexToElevAbgr } from "../src/void/elevation.ts";
import {
  AMBIENT_COOL_FILL,
  blendTimeOfDayPresets,
  collectSceneLights,
  computeSpriteSobelNormals,
  computeTerrainNormalAt,
  INFANTRY_SOBEL_NORMALS,
  LIGHTING_QUALITY_CAPS,
  LightingEngine,
  MAX_DYNAMIC_LIGHTS,
  normalizeVoidTimeOfDay,
  type PointLight,
  SUN_DIRECTION,
  SUN_WARM_COLOR,
  terrainReliefAt,
  TIME_OF_DAY_PRESETS,
  TOWER_SOBEL_NORMALS,
  traceLightOcclusion,
  VOID_AMBIENT_FILL,
} from "../src/void/lighting.ts";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import {
  computeDebrisGlowAlpha,
  computeDebrisHeat,
  computeWhirlpoolKinematics,
  MAX_DEBRIS,
  moltenColorAtHeat,
  moltenGlowColorAtHeat,
} from "../src/void/physics.ts";
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
  // Isolate the tested caster. Exact traversal also sees neighbouring buildings on this row.
  for (let x = shadowX; x <= lightX; x++) {
    const idx = midY * w + x;
    if (world.buildingAt[idx] === sky.id) continue;
    world.material[idx] = CellMaterial.STREET;
    world.buildingAt[idx] = -1;
    world.landCover[idx] = LandCover.NONE;
  }
  engine.syncChunks(world, "full");
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
  assert.ok(lights.some((l) => l.shadowStrength >= 0.4 && l.castsShadows), "Expected strong shadow-casting explosion/portal light");
});

test("6. Sucked-in Void debris retains original color at detachment, heats into molten hues, and smoothly ramps from no glow to slight glow near the core", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  sim.stepTicks(30);
  const { world, physics } = sim;
  const { w } = world.grid;

  // 1. Consume a building cell and a grass countryside cell: both retain their original material/building color at birth
  physics.debris.length = 0;
  const bld = world.buildings.find((b) => b.cells.length > 0 && world.material[b.cells[0]] !== CellMaterial.VOID)!;
  const bldCell = bld.cells[0];
  physics.consumeCellIntoVoid(world, bldCell, true);
  assert.equal(physics.debris.length, 1);
  const bldDebris = physics.debris[0];
  assert.equal(bldDebris.glowColor, "rgba(0, 0, 0, 0)", "Newly detached pixel must have zero initial glow");
  assert.ok((bldDebris.startDist ?? 0) > 0, "Debris records its initial distance to the portal");

  // Find a green grass cell and consume it
  let grassCell = -1;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.material[i] === CellMaterial.PARK && world.landCover[i] === LandCover.GRASS) {
      grassCell = i;
      break;
    }
  }
  assert.ok(grassCell >= 0);
  physics.consumeCellIntoVoid(world, grassCell, true);
  const grassDebris = physics.debris[1];
  // Original grass color has green channel > red and blue channels
  const gR = parseInt(grassDebris.color.slice(1, 3), 16);
  const gG = parseInt(grassDebris.color.slice(3, 5), 16);
  const gB = parseInt(grassDebris.color.slice(5, 7), 16);
  assert.ok(gG > gR && gG > gB, `Expected original green grass color, got ${grassDebris.color}`);

  // 2. At detachment (dist = startDist, lifeRatio = 0): heat is 0, color is unchanged, glow is strictly 0
  const startDist = 28;
  const coreR = 5;
  const h0 = computeDebrisHeat(startDist, startDist, coreR, 0);
  assert.equal(h0, 0, "Heat at detachment must be 0");
  assert.equal(moltenColorAtHeat(grassDebris.color, h0), grassDebris.color, "Original color preserved at heat 0");
  assert.equal(computeDebrisGlowAlpha(h0), 0, "Glow alpha at detachment must be strictly 0");
  assert.equal(moltenGlowColorAtHeat(h0), "rgba(0, 0, 0, 0)");

  // 3. As distance to portal core shrinks from startDist down to coreR, heat and glow ramp up smoothly and monotonically
  const distances = [26, 20, 15, 11, 8, 5.5];
  let prevHeat = 0;
  let prevGlow = 0;
  for (const d of distances) {
    const h = computeDebrisHeat(d, startDist, coreR, 0);
    const g = computeDebrisGlowAlpha(h);
    assert.ok(h >= prevHeat, `Heat must increase monotonically as pixel approaches core (${h} >= ${prevHeat} at d=${d})`);
    assert.ok(g >= prevGlow, `Glow must increase monotonically as pixel approaches core (${g} >= ${prevGlow} at d=${d})`);
    prevHeat = h;
    prevGlow = g;
  }
  assert.ok(prevHeat > 0.9, `Near core rim (d=5.5), heat should approach 1.0 (got ${prevHeat})`);
  assert.ok(prevGlow > 0.25 && prevGlow <= 0.35, `Near core rim, glow should be a slight warm glow ~0.34 (got ${prevGlow})`);

  // 4. Verify molten color progression: original green -> ember red -> molten orange -> incandescent gold -> white-hot
  const parseRgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [rEmber, gEmber, bEmber] = parseRgb(moltenColorAtHeat(grassDebris.color, 0.32));
  const [rOrange, gOrange, bOrange] = parseRgb(moltenColorAtHeat(grassDebris.color, 0.64));
  const [rGold, gGold, bGold] = parseRgb(moltenColorAtHeat(grassDebris.color, 0.88));
  const [rHot, gHot, bHot] = parseRgb(moltenColorAtHeat(grassDebris.color, 1.0));

  // Ember red: strong red, low green & blue
  assert.ok(rEmber > 180 && gEmber < 50 && bEmber < 30, `Expected ember red at heat 0.32, got (${rEmber},${gEmber},${bEmber})`);
  // Molten orange: brighter red and rising green
  assert.ok(rOrange > rEmber && gOrange > gEmber + 50 && bOrange < 40, `Expected molten orange at heat 0.64, got (${rOrange},${gOrange},${bOrange})`);
  // Incandescent gold: high red and green
  assert.ok(rGold >= 250 && gGold > gOrange + 70 && bGold > bOrange, `Expected incandescent gold at heat 0.88, got (${rGold},${gGold},${bGold})`);
  // White-hot near event horizon core
  assert.ok(rHot === 255 && gHot > 235 && bHot > 195, `Expected white-hot core incandescence at heat 1.0, got (${rHot},${gHot},${bHot})`);
});

test("7. Whirlpool spin, spaghettification acceleration, intact-to-pixel disintegration, and exact inner-circle disappearance", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  sim.stepTicks(30);
  const { world, physics } = sim;
  physics.debris.length = 0;

  // 1. Spaghettification speedup: particles accelerate strongly as distance approaches coreRadius
  const startDist = 42;
  const coreR = 6;
  const kFar = computeWhirlpoolKinematics(42, startDist, coreR, true);
  const kMid = computeWhirlpoolKinematics(22, startDist, coreR, false);
  const kNear = computeWhirlpoolKinematics(7, startDist, coreR, false);

  assert.ok(
    kNear.radialSpeed > kMid.radialSpeed && kMid.radialSpeed > kFar.radialSpeed,
    "Inward radial speed must accelerate as particle nears the black hole",
  );
  assert.ok(
    kNear.tangentialSpeed > kMid.tangentialSpeed && kMid.tangentialSpeed > kFar.tangentialSpeed,
    "Whirlpool tangential spin speed must accelerate as particle nears the black hole",
  );
  assert.ok(
    kNear.totalSpeed > kFar.totalSpeed * 5,
    `Expected >= 5x spaghettification speedup near event horizon (${kNear.totalSpeed} vs ${kFar.totalSpeed})`,
  );

  // 2. Consume a building cell: starts as an intact multi-pixel block (intact = true, size >= 2),
  //    then disintegrates into individual 1x1 pixels closer to the black hole, and vanishes upon
  //    touching the inner circle (coreRadius)
  const bld = world.buildings.find((b) => b.cells.length > 0 && world.material[b.cells[0]] !== CellMaterial.VOID)!;
  physics.consumeCellIntoVoid(world, bld.cells[0], true);
  assert.equal(physics.debris.length, 1);
  const frag = physics.debris[0];
  assert.equal(frag.intact, true, "Consumed building piece must start as an intact block");
  assert.ok(frag.size >= 2.0, `Expected intact building block size >= 2.0, got ${frag.size}`);

  const pX = frag.portalX;
  const pY = frag.portalY;
  const cR = frag.coreRadius ?? 5;
  const initialAngle = Math.atan2(frag.y - pY, frag.x - pX);
  let totalAngleSwept = 0;
  let prevAngle = initialAngle;
  let prevDist = Math.hypot(frag.x - pX, frag.y - pY);
  let sawDisintegration = false;
  let lastDistBeforeVanish = prevDist;

  for (let tick = 0; tick < 300 && physics.debris.length > 0; tick++) {
    physics.stepStructuralSupport(world, 1 / 30);
    if (!frag.intact && frag.size === 1.0 && physics.debris.length >= 3) {
      sawDisintegration = true;
    }
    if (physics.debris.includes(frag)) {
      const curDist = Math.hypot(frag.x - pX, frag.y - pY);
      const curAngle = Math.atan2(frag.y - pY, frag.x - pX);
      let dAng = curAngle - prevAngle;
      while (dAng <= -Math.PI) dAng += Math.PI * 2;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      totalAngleSwept += Math.abs(dAng);
      assert.ok(curDist < prevDist, `Radius of tracked particle must decrease monotonically (${curDist} < ${prevDist})`);
      assert.ok(curDist > cR, `Active debris must not exist inside inner circle (${curDist} > ${cR})`);
      prevDist = curDist;
      prevAngle = curAngle;
      lastDistBeforeVanish = curDist;
    }
  }

  assert.equal(sawDisintegration, true, "Intact building block must disintegrate into individual 1x1 pixels closer to the black hole");
  assert.equal(physics.debris.length, 0, "All disintegrated pixels must be swallowed by the black hole");
  assert.ok(totalAngleSwept > 0.85, `Expected whirlpool spiral rotation > 0.85 rad, got ${totalAngleSwept}`);
  assert.ok(
    lastDistBeforeVanish <= cR + 3.5,
    `Pixels must disappear right upon touching the inner circle coreR=${cR} (last dist=${lastDistBeforeVanish})`,
  );

  // 3. Consuming street cells always crumbles into visible asphalt/pavement particles starting slightly closer to the center
  let streetCell = -1;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.material[i] === CellMaterial.STREET && world.streetTier[i] !== 8) {
      streetCell = i;
      break;
    }
  }
  assert.ok(streetCell >= 0, "Expected an urban street cell");
  const sxCell = (streetCell % world.grid.w) + 0.5;
  const syCell = ((streetCell / world.grid.w) | 0) + 0.5;
  physics.consumeCellIntoVoid(world, streetCell, true);
  assert.ok(physics.debris.length >= 1, "Consumed street cell must spawn crumbling pavement debris");
  const streetFrag = physics.debris[0];
  const rawCellDist = Math.hypot(sxCell - streetFrag.portalX, syCell - streetFrag.portalY);
  const spawnDist = Math.hypot(streetFrag.x - streetFrag.portalX, streetFrag.y - streetFrag.portalY);
  assert.ok(spawnDist < rawCellDist, `Spawned particle must start slightly closer to the Void center (${spawnDist} < ${rawCellDist})`);
  const sR = parseInt(streetFrag.color.slice(1, 3), 16);
  const sG = parseInt(streetFrag.color.slice(3, 5), 16);
  const sB = parseInt(streetFrag.color.slice(5, 7), 16);
  assert.ok(sR >= 55 && sG >= 65 && sB >= 80, `Street debris must use readable broken asphalt tones, got ${streetFrag.color}`);
});

test("Saturated whirlpool debris keeps existing fragments and resumes emission when space frees up", () => {
  const { world, physics } = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const portal = world.portals[0];
  portal.active = true;
  const site = world.grid.index(portal.x + portal.radius + 8, portal.y);
  const material = world.material[site];
  physics.consumeCellIntoVoid(world, site);
  const first = physics.debris[0];
  assert.ok(first);
  first.intact = false;

  while (physics.debris.length < MAX_DEBRIS) physics.debris.push({ ...first });
  const existing = physics.debris.slice();
  world.material[site] = material;
  physics.consumeCellIntoVoid(world, site);
  assert.equal(world.material[site], CellMaterial.VOID);
  assert.equal(physics.debris.length, MAX_DEBRIS);
  assert.ok(physics.debris.every((fragment, i) => fragment === existing[i]));

  first.life = first.maxLife;
  physics.stepStructuralSupport(world, 1 / 30);
  assert.equal(physics.debris.length, MAX_DEBRIS - 1);
  assert.equal(physics.debris[0], existing[1]);

  world.material[site] = material;
  physics.consumeCellIntoVoid(world, site);
  assert.equal(physics.debris.length, MAX_DEBRIS);
  assert.equal(physics.debris[0], existing[1]);
  assert.equal(physics.debris.at(-1)?.life, 0);
});

test("Street lights resolve single-pixel infantry, tower and airborne debris shadows", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const { w, count } = world.grid;
  world.material.fill(CellMaterial.STREET);
  world.landCover.fill(LandCover.NONE);
  world.buildingAt.fill(-1);
  world.columnFloors.fill(0);

  const engine = new LightingEngine();
  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  engine.syncChunks(world, "full");
  world.grid.clearDirtyFlags();
  const terrain = new Uint32Array(count).fill(0xff707070);
  const light: PointLight = {
    x: 50, y: 60, z: 2, radius: 23,
    r: 2, g: 0.8, b: 0.3, specular: 0.7, castsShadows: true, shadowStrength: 0.55,
  };
  const receiver = 60 * w + 65;
  const brightness = () => {
    engine.renderLighting(world, terrain, cache, [light]);
    return engine.terrainLightU32[receiver] & 0xff;
  };
  const clear = brightness();

  const rifleman = {
    id: 1, kind: "rifleman" as const, homeUid: -1, x: 60.5, y: 60.5, vx: 0, vy: 0, hp: 40,
    maxHp: 40, cooldown: 0, carryingMatter: 0, state: "patrol" as const, targetCell: -1, targetNodeId: -1,
  };
  engine.syncMovingCasters([rifleman], []);
  const infantryShadow = brightness();
  assert.ok(infantryShadow + 10 < clear, "An infantry-width caster interrupts the street light");
  assert.equal(brightness(), infantryShadow, "A reused shadow trace gives the same output");
  light.y += 4;
  assert.ok(brightness() > infantryShadow, "Moving light re-traces the shadow");
  light.y -= 4;
  rifleman.y += 2;
  engine.syncMovingCasters([rifleman], []);
  assert.equal(brightness(), clear, "Moving infantry clears its previous shadow");

  const chunk = sim.physics.spawnFallingChunk(60, 60, 3, 0, 0, 0, 1, 2, "#aaaaaa", "#bbbbbb", "salvage");
  engine.syncMovingCasters([], [chunk]);
  assert.equal(brightness(), clear, "A ray can pass beneath high debris");
  chunk.z = 0.3;
  engine.syncMovingCasters([], [chunk]);
  assert.ok(brightness() + 10 < clear, "Lowered debris casts a shadow");
  engine.syncMovingCasters([], []);

  const towerCell = 60 * w + 60;
  world.towerAt[towerCell] = 12;
  world.grid.markIndexDirty(towerCell);
  engine.syncChunks(world, "full", world.grid.dirtyChunks);
  assert.ok(brightness() + 10 < clear, "Placed towers cast shadows with no moving casters");
  world.towerAt[towerCell] = -1;
  engine.syncChunks(world, "full", world.grid.dirtyChunks);
  assert.equal(brightness(), clear, "Removing a tower clears its cached caster");
});

test("Dirty terrain normals update across a chunk boundary", () => {
  const { world } = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  world.material.fill(CellMaterial.STREET);
  world.landCover.fill(LandCover.NONE);
  world.buildingAt.fill(-1);
  const engine = new LightingEngine();
  engine.syncChunks(world, "full");
  world.grid.clearDirtyFlags();

  const neighbor = world.grid.index(15, 40);
  assert.equal(engine.terrainNx[neighbor], 0);
  const wall = world.grid.index(16, 40);
  world.material[wall] = CellMaterial.WALL;
  world.grid.markIndexDirty(wall);
  engine.syncChunks(world, "full", world.grid.dirtyChunks);
  assert.ok(engine.terrainNx[neighbor] < -40);
  assert.equal(engine.terrainNx[world.grid.index(12, 40)], 0);
});

test("8. Tron neon blue building lights, Tron neon orange tower lights, Sobel sprite normals, directional sun, and quality caps", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet(), true);
  // Place a Matter Cannon tower in the city
  let placed = false;
  for (let y = 30; y < 120 && !placed; y += 4) {
    for (let x = 30; x < 120 && !placed; x += 4) {
      if (sim.placeTower("matterCannon", x, y)) placed = true;
    }
  }
  assert.ok(placed, "Expected to place a Resistance tower");

  // Urban building palettes use Tron neon blue accents (b > r)
  for (const style of ["glassTower", "artDecoSetback", "cyberArcology", "foundryComplex", "solarTerrace", "civicDome"] as const) {
    for (const pal of ARCH_PALETTES[style]) {
      const r = parseInt(pal.neonEdge.slice(1, 3), 16);
      const b = parseInt(pal.neonEdge.slice(5, 7), 16);
      assert.ok(b > r + 100, `Expected Tron neon blue accent on ${style}, got ${pal.neonEdge}`);
    }
  }

  // Sobel sprite normal generators produce unit-length 3D normals with opposing bevel tilts
  assert.equal(TOWER_SOBEL_NORMALS.nx.length, 9);
  assert.ok(TOWER_SOBEL_NORMALS.nx[3] < -0.3 && TOWER_SOBEL_NORMALS.nx[5] > 0.3, "Tower west/east Sobel bevels tilt outward");
  assert.ok(TOWER_SOBEL_NORMALS.nz[4] > 0.95, "Tower roof center faces upward");
  assert.equal(INFANTRY_SOBEL_NORMALS.nx.length, 6);
  assert.ok(INFANTRY_SOBEL_NORMALS.ny[4] > 0.25, "Infantry torso front faces south");
  const customSobel = computeSpriteSobelNormals([0, 1, 0, 1, 2, 1, 0, 1, 0], 3, 3);
  assert.ok(Math.abs(Math.hypot(customSobel.nx[0], customSobel.ny[0], customSobel.nz[0]) - 1) < 1e-5);

  // Directional sun & cool ambient fill constants
  assert.ok(Math.abs(Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) - 1) < 1e-6);
  assert.ok(SUN_WARM_COLOR[0] > SUN_WARM_COLOR[2], "Sun light is warm (R > B)");
  assert.ok(AMBIENT_COOL_FILL[2] > AMBIENT_COOL_FILL[0], "Ambient fill is cool (B > R)");
  assert.ok(VOID_AMBIENT_FILL[2] > VOID_AMBIENT_FILL[1], "Void ambient fill is violet-tinted");

  // Scene lights include Tron neon blue building lights (b > r * 3) and Tron neon orange tower lights (r > b * 3)
  const highLights = collectSceneLights(sim, 1.2, false, "full", "high");
  const hasBlueBuildingLight = highLights.some((l) => l.b > 0.9 && l.g > 0.6 && l.r < 0.2 && l.castsShadows);
  const hasOrangeTowerLight = highLights.some((l) => l.r > 0.9 && l.g > 0.4 && l.b < 0.25 && l.castsShadows);
  assert.ok(hasBlueBuildingLight, "Expected Tron neon blue shadow-casting building lights");
  assert.ok(hasOrangeTowerLight, "Expected Tron neon orange shadow-casting tower lights");

  // Low quality caps total lights and shadow-casting lights, fading excess lights to unshadowed glow
  const lowLights = collectSceneLights(sim, 1.2, false, "full", "low");
  assert.ok(lowLights.length <= LIGHTING_QUALITY_CAPS.low.maxLights);
  const lowShadowCasters = lowLights.filter((l) => l.castsShadows).length;
  assert.ok(
    lowShadowCasters <= LIGHTING_QUALITY_CAPS.low.maxShadowLights,
    `Expected <= ${LIGHTING_QUALITY_CAPS.low.maxShadowLights} shadow casters on low quality, got ${lowShadowCasters}`,
  );
});

test("9. Time of Day presets (Day, Sunset, Night), smooth preset blending, emissive neon features, and 1/2-res halo spill", () => {
  const { day, sunset, night } = TIME_OF_DAY_PRESETS;

  // Day: bright warm-white sun high in the sky, short shadows, subtle neon
  assert.ok(day.sunHeight > sunset.sunHeight && sunset.sunHeight > night.sunHeight, "Sun height decreases Day -> Sunset -> Night");
  assert.ok(day.shadowReachScale < sunset.shadowReachScale, "Day casts shorter shadows than Sunset");
  assert.ok(day.neonIntensity < sunset.neonIntensity && sunset.neonIntensity < night.neonIntensity, "Neon intensity ramps up Day -> Sunset -> Night");

  // Sunset: golden-orange sun (R > G > B) with purple-blue ambient in the shade (B > R and B > G)
  assert.ok(sunset.sunColor[0] > sunset.sunColor[1] && sunset.sunColor[1] > sunset.sunColor[2], "Sunset sun is golden-orange");
  assert.ok(sunset.ambientColor[2] > sunset.ambientColor[0] && sunset.ambientColor[2] > sunset.ambientColor[1], "Sunset shade ambient is purple-blue");

  // Night: deep blue ambient (B > G > R), never flat black or grey, strong neon and haze
  assert.ok(night.ambientColor[2] > night.ambientColor[1] && night.ambientColor[1] > night.ambientColor[0], "Night ambient is deep tinted blue");
  assert.ok(night.voidAmbientColor[2] > night.voidAmbientColor[0] && night.voidAmbientColor[0] > night.voidAmbientColor[1], "Void night ambient is deep purple");

  // Normalization & smooth blending
  assert.equal(normalizeVoidTimeOfDay("day"), "day");
  assert.equal(normalizeVoidTimeOfDay("sunset"), "sunset");
  assert.equal(normalizeVoidTimeOfDay("night"), "night");
  assert.equal(normalizeVoidTimeOfDay("dusk"), "sunset");
  assert.equal(normalizeVoidTimeOfDay("unknown"), "night");

  const mid = blendTimeOfDayPresets(day, night, 0.5);
  assert.ok(mid.sunHeight < day.sunHeight && mid.sunHeight > night.sunHeight);
  assert.ok(mid.neonIntensity > day.neonIntensity && mid.neonIntensity < night.neonIntensity);
  assert.ok(Math.abs(Math.hypot(mid.sunDir[0], mid.sunDir[1], mid.sunDir[2]) - 1) < 1e-6);

  // Render a city scene across Day, Sunset, and Night and verify contrast, emissive neon tags, and 1/2-res halo spill
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet(), true);
  const { world } = sim;
  const { w, h, count } = world.grid;
  const cache = new BuildingSpriteCache();
  cache.getBoardAtlas(world, "full");
  const engine = new LightingEngine();
  engine.syncChunks(world, "full");
  world.grid.clearDirtyFlags();

  // Verify buildings paint coherent emissive neon features marked with atlasSpec >= 240
  let emissivePixels = 0;
  for (let i = 0; i < count; i++) {
    if (cache.atlasSpec[i] >= 240 && cache.atlasColorU32[i] !== 0) emissivePixels++;
  }
  assert.ok(emissivePixels >= 100, `Expected >= 100 emissive neon building pixels, got ${emissivePixels}`);

  const terrainU32 = new Uint32Array(count).fill(hexToElevAbgr("#363d4a"));
  const view = { x0: 16, y0: 16, x1: 180, y1: 180 };

  // Compare average non-emissive ground/roof luminance across the view in Day vs Night,
  // and verify that Night mode lights up streets near neon buildings much brighter than unlit Night ambient
  const dayLights = collectSceneLights(sim, 1.0, false, "full", "high", view, day);
  engine.renderLighting(world, terrainU32, cache, dayLights, day, view);
  let daySumLuma = 0;
  let dayCount = 0;
  for (let y = 40; y < 140; y += 2) {
    for (let x = 40; x < 140; x += 2) {
      const idx = y * w + x;
      if (world.material[idx] === CellMaterial.VOID || cache.atlasSpec[idx] >= 240) continue;
      const px = engine.buildingLightU32[idx] || engine.terrainLightU32[idx];
      if (!px) continue;
      daySumLuma += (px & 0xff) + ((px >>> 8) & 0xff) + ((px >>> 16) & 0xff);
      dayCount++;
    }
  }

  // Render Night with no point lights to measure pure unlit Night ambient darkness
  engine.renderLighting(world, terrainU32, cache, [], night, view);
  let nightAmbientB = 0;
  let nightAmbientR = 0;
  for (let y = 40; y < 140; y += 4) {
    for (let x = 40; x < 140; x += 4) {
      const idx = y * w + x;
      if (world.material[idx] === CellMaterial.VOID || cache.atlasColorU32[idx] !== 0) continue;
      const px = engine.terrainLightU32[idx];
      if (px) {
        nightAmbientR += px & 0xff;
        nightAmbientB += (px >>> 16) & 0xff;
      }
    }
  }

  const nightLights = collectSceneLights(sim, 1.0, false, "full", "high", view, night);
  engine.renderLighting(world, terrainU32, cache, nightLights, night, view);
  let nightSumLuma = 0;
  let nightLitPools = 0;
  for (let y = 40; y < 140; y += 2) {
    for (let x = 40; x < 140; x += 2) {
      const idx = y * w + x;
      if (world.material[idx] === CellMaterial.VOID || cache.atlasSpec[idx] >= 240) continue;
      const px = engine.buildingLightU32[idx] || engine.terrainLightU32[idx];
      if (!px) continue;
      const luma = (px & 0xff) + ((px >>> 8) & 0xff) + ((px >>> 16) & 0xff);
      nightSumLuma += luma;
      if (luma > 160) nightLitPools++;
    }
  }

  assert.ok(dayCount > 100 && daySumLuma > nightSumLuma, `Average Day scene luminance (${daySumLuma}) must exceed Night (${nightSumLuma})`);
  assert.ok(nightAmbientB > nightAmbientR, `Unlit Night ambient surface must have deep blue tint (B=${nightAmbientB} > R=${nightAmbientR})`);
  assert.ok(nightLitPools >= 20, `Expected >= 20 bright neon light pool samples in Night mode, got ${nightLitPools}`);
  assert.ok(w > 0 && h > 0);
});

test("Ambient farmland tiles match a fresh raster after both preset blends and a pan", () => {
  const { world } = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  world.material.fill(CellMaterial.PARK);
  world.landCover.fill(LandCover.FIELD_H);
  world.buildingAt.fill(-1);
  world.columnFloors.fill(0);
  const { w, h, count } = world.grid;
  const terrain = new Uint32Array(count).fill(hexToElevAbgr("#6f8737"));
  const atlas = new BuildingSpriteCache();
  atlas.syncAtlasGbuffer(world, "full");
  const engine = new LightingEngine();
  engine.syncChunks(world, "full");
  const fresh = new LightingEngine();
  fresh.syncChunks(world, "full");
  const shadows = new Uint8Array(count);
  const day = TIME_OF_DAY_PRESETS.day;
  const night = TIME_OF_DAY_PRESETS.night;
  const left = { x0: 0, y0: 0, x1: 65, y1: 100 };
  const right = { x0: w - 62, y0: 0, x1: w, y1: 100 };
  const render = (preset: typeof day, view?: typeof left, blending = false) =>
    engine.renderLighting(world, terrain, atlas, [], preset, view, shadows, blending);

  render(day);
  const dayOutput = engine.terrainLightU32.slice();
  render(day, left);
  render(day, right);
  assert.deepEqual(engine.terrainLightU32, dayOutput, "Panning preserves valid offscreen ambient pixels");
  for (const [from, to] of [[day, night], [night, day]]) {
    for (let step = 1; step < 8; step++) {
      render(blendTimeOfDayPresets(from, to, step / 8), step % 2 ? left : right, true);
    }
    render(to, left);
    render(to, right);
    render(to);
    fresh.renderLighting(world, terrain, atlas, [], to, undefined, shadows);
    assert.deepEqual(engine.terrainLightU32, fresh.terrainLightU32);
    assert.ok(engine.terrainLightU32.every((pixel, idx) => pixel !== 0 &&
      (to === day ? pixel === dayOutput[idx] : pixel !== dayOutput[idx])));
  }

  world.grid.clearDirtyFlags();
  const changed = world.grid.index(w - 15, h - 15);
  world.landCover[changed] = LandCover.FOREST;
  terrain[changed] = hexToElevAbgr("#a5874a");
  world.grid.markIndexDirty(changed);
  engine.syncChunks(world, "full", world.grid.dirtyChunks);
  render(day, left);
  render(day);
  assert.notEqual(engine.terrainLightU32[changed], dayOutput[changed]);
});

test("Small camera pans preserve building emitter IDs and their glow in the shared viewport", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const atlas = new BuildingSpriteCache();
  atlas.syncAtlasGbuffer(world, "full");
  const terrain = new Uint32Array(world.grid.count).fill(hexToElevAbgr("#52634b"));
  const engine = new LightingEngine();
  engine.syncChunks(world, "full");
  const night = TIME_OF_DAY_PRESETS.night;
  const first = collectSceneLights(sim, 12, true, "full", "high", undefined, night)
    .find((light) => light.buildingId !== undefined)!;
  assert.ok(first);
  const x0 = Math.max(0, Math.floor(first.x) - 56);
  const y0 = Math.max(0, Math.floor(first.y) - 56);
  const { w, h } = world.grid;
  const common = { x0: x0 + 8, y0: y0 + 8, x1: Math.min(w, x0 + 101), y1: Math.min(h, y0 + 101) };
  const pixels = (buffer: Uint32Array) => {
    const width = common.x1 - common.x0;
    const region = new Uint32Array(width * (common.y1 - common.y0));
    for (let y = common.y0; y < common.y1; y++) {
      region.set(buffer.subarray(y * w + common.x0, y * w + common.x1), (y - common.y0) * width);
    }
    return region;
  };
  let expected: { ids: number[]; ground: Uint32Array; roofs: Uint32Array } | undefined;
  for (const offset of [0, 2, 4, 7, 1, 0]) {
    const viewport = { x0: x0 + offset, y0: y0 + offset, x1: x0 + offset + 104, y1: y0 + offset + 104 };
    const lights = collectSceneLights(sim, 12, true, "full", "high", viewport, night)
      .filter((light) => light.buildingId !== undefined);
    const ids = lights.filter(({ x, y }) => x >= common.x0 && x < common.x1 && y >= common.y0 && y < common.y1)
      .map((light) => light.buildingId!);
    assert.ok(ids.includes(first.buildingId!));
    engine.renderLighting(world, terrain, atlas, lights, night, viewport);
    const sample = { ids, ground: pixels(engine.terrainLightU32), roofs: pixels(engine.buildingLightU32) };
    assert.ok(sample.roofs.some((pixel) => pixel !== 0));
    if (expected) assert.deepEqual(sample, expected);
    else expected = sample;
  }

  // The half-res fallback remains present even with no budgeted building lights.
  engine.renderLighting(world, terrain, atlas, [], night);
  const emissive = atlas.atlasSpec.findIndex((spec, idx) => spec >= 240 && atlas.atlasBldId[idx] >= 0);
  assert.ok(emissive >= 0);
  assert.notEqual(engine.buildingLightU32[emissive], 0);
  const withSpill = engine.terrainLightU32.slice();
  atlas.atlasSpec.fill(0);
  engine.syncChunks(world, "full");
  engine.renderLighting(world, terrain, atlas, [], night);
  assert.ok(withSpill.some((pixel, idx) => pixel !== engine.terrainLightU32[idx]),
    "Emissive buildings spill light on the ground without budgeted point lights");
});
