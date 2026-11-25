/** Deterministic unit and golden tests for grid-based Void fluid (`src/void/void-fluid.ts`)
 * and short-lived chunk dissolution (`src/void/physics.ts`). */

import assert from "node:assert/strict";
import test from "node:test";
import { BuildingSpriteCache } from "../src/void/elevation.ts";
import { LightingEngine, TIME_OF_DAY_PRESETS } from "../src/void/lighting.ts";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import { MAX_DEBRIS_CHUNKS_DESKTOP, MAX_DEBRIS_CHUNKS_MOBILE } from "../src/void/physics.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";
import {
  classifyFluidMaterial,
  evaluateFluidHeatColor,
  FLUID_BAND_COUNT,
  FLUID_MATERIAL_PALETTES,
  FluidMaterial,
  sampleSourceCellColors,
  VoidFluidGrid,
} from "../src/void/void-fluid.ts";

test("1. VoidFluidGrid precomputes spiral accretion flow field once per Void and rebuilds only when portal moves or grows", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const p = world.portals[0];
  p.active = true;

  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);
  assert.equal(fluid.flowRebuilds, 1, "Initial flow field build");

  // Subsequent syncs with unchanged portal state do not rebuild
  fluid.syncFlowField(world);
  fluid.syncFlowField(world);
  assert.equal(fluid.flowRebuilds, 1, "Flow field must stay cached while portal is unchanged");

  // Growing or moving the portal triggers a rebuild
  p.radius += 4;
  fluid.syncFlowField(world);
  assert.equal(fluid.flowRebuilds, 2, "Growing portal must rebuild flow field");

  p.x += 5;
  fluid.syncFlowField(world);
  assert.equal(fluid.flowRebuilds, 3, "Moving portal must rebuild flow field");

  // Verify spiral twist (accretion-disk swirl) at a sample cell east of the portal
  const gx = Math.min(fluid.gridW - 1, Math.round(p.x + 20));
  const gy = Math.min(fluid.gridH - 1, Math.round(p.y));
  const idx = gy * fluid.gridW + gx;
  // East of portal: inward pull is -X (vx < 0), tangential accretion swirl is -Y (vy < 0)
  assert.ok(fluid.flowVx[idx] < -2, `Expected inward -X pull east of portal, got vx=${fluid.flowVx[idx]}`);
  assert.ok(Math.abs(fluid.flowVy[idx]) > 4, `Expected strong tangential Y swirl east of portal, got vy=${fluid.flowVy[idx]}`);
});

test("2. Chunks live ~0.4-0.6s, crack into 2-4 pieces, cap at 150 desktop / 60 mobile, and dissolve into material-typed fluid", () => {
  const sim = new VoidSim("centralRupture", "underSiege", emptyTechWallet(), true);
  const { world, physics } = sim;
  const p = world.portals[0];
  p.active = true;
  physics.debris.length = 0;
  physics.voidFluid.clear();

  // Verify material classification for all 6 source materials: grass, dirt, stone, concrete, crops, water
  const cellIdx = world.grid.index(20, 20);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.PARK, LandCover.GRASS, -1), FluidMaterial.GRASS);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.RECLAIMED, LandCover.DIRT_ROAD, -1), FluidMaterial.DIRT);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.WALL, LandCover.NONE, -1), FluidMaterial.STONE);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.BUILDING, LandCover.NONE, 0), FluidMaterial.CONCRETE);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.PARK, LandCover.FIELD_H, -1), FluidMaterial.CROPS);
  assert.equal(classifyFluidMaterial(world, cellIdx, CellMaterial.UNCLAIMED, LandCover.RIVER, -1), FluidMaterial.WATER);

  // Consume a cell at r = 24 from portal: spawns a chunk with maxLife in [0.4, 0.6]
  const targetIdx = world.grid.index(Math.round(p.x + 24), Math.round(p.y));
  world.material[targetIdx] = CellMaterial.PARK;
  world.landCover[targetIdx] = LandCover.FIELD_H;
  world.buildingAt[targetIdx] = -1;
  physics.consumeCellIntoVoid(world, targetIdx, true);

  assert.equal(physics.debris.length, 1);
  const chunk = physics.debris[0];
  assert.ok(chunk.maxLife >= 0.4 && chunk.maxLife <= 0.6, `Chunk maxLife must be ~0.4-0.6s, got ${chunk.maxLife}`);
  assert.equal(chunk.fluidMaterial, FluidMaterial.CROPS, "Chunk preserves its crops source material");

  // Step 22 ticks (0.73 s): chunk must crack and then completely dissolve into fluid cells
  for (let t = 0; t < 22; t++) {
    physics.stepStructuralSupport(world, 1 / 30);
  }
  assert.equal(physics.debris.length, 0, "All chunks must dissolve within 0.6 s");
  assert.ok(physics.voidFluid.activeCellCount > 0, "Fluid grid must contain active cells after chunk dissolves");

  // Verify live chunk caps (150 desktop, 60 mobile) overflow directly into fluid
  for (const cap of [MAX_DEBRIS_CHUNKS_DESKTOP, MAX_DEBRIS_CHUNKS_MOBILE]) {
    physics.debris.length = 0;
    physics.voidFluid.clear();
    physics.maxChunks = cap;
    for (let i = 0; i < cap + 45; i++) {
      const ang = (i / (cap + 45)) * Math.PI * 2;
      const cx = Math.round(p.x + Math.cos(ang) * 26);
      const cy = Math.round(p.y + Math.sin(ang) * 26);
      const idx = world.grid.index(cx, cy);
      world.material[idx] = CellMaterial.BUILDING;
      physics.consumeCellIntoVoid(world, idx, true);
    }
    assert.equal(physics.debris.length, cap, `Live chunks must never exceed cap (${cap})`);
    assert.ok(physics.voidFluid.activeCellCount > 0, "Excess consumed cells deposit directly into Void fluid");
  }
});

test("3. Fluid advects inward within dirty bounding box, shifts bands from material -> orange-hot -> violet/magenta, and feeds event horizon", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const p = world.portals[0];
  p.active = true;

  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);

  // Deposit grass fluid at outer distance (r = 24), mid distance (r = 13), and inner horizon rim (r = 7)
  const coreR = Math.max(3.6, p.radius * 0.42);
  fluid.depositAtWorld(p.x + 24, p.y, 1.2, FluidMaterial.GRASS, 24);
  fluid.depositAtWorld(p.x + 13, p.y, 1.2, FluidMaterial.GRASS, 24);
  fluid.depositAtWorld(p.x + coreR + 1.5, p.y, 1.2, FluidMaterial.GRASS, 24);

  const outerIdx = Math.floor(p.y) * fluid.gridW + Math.floor(p.x + 24);
  const midIdx = Math.floor(p.y) * fluid.gridW + Math.floor(p.x + 13);
  const innerIdx = Math.floor(p.y) * fluid.gridW + Math.floor(p.x + coreR + 1.5);

  const bandOuter = fluid.computeCellBand(outerIdx, 0);
  const bandMid = fluid.computeCellBand(midIdx, 0);
  const bandInner = fluid.computeCellBand(innerIdx, 0);

  assert.ok(bandOuter <= 1, `Outer band should preserve material color (band 0..1), got ${bandOuter}`);
  assert.ok(bandMid >= 3 && bandMid <= 5, `Mid band should shift to ember/orange-hot (band 3..5), got ${bandMid}`);
  assert.ok(bandInner >= 5 && bandInner < FLUID_BAND_COUNT, `Inner band should shift to violet/magenta (band 5..6), got ${bandInner}`);

  // Check palette RGB values for GRASS: band 0 is green-dominant, band 4 is orange-hot, band 6 is violet/magenta
  const grassPal = FLUID_MATERIAL_PALETTES[FluidMaterial.GRASS];
  assert.ok(grassPal[0][1] > grassPal[0][0] && grassPal[0][1] > grassPal[0][2], "Band 0 grass is green");
  assert.ok(grassPal[4][0] > 230 && grassPal[4][1] > 100 && grassPal[4][2] < 60, "Band 4 is orange-hot");
  assert.ok(grassPal[6][0] > 160 && grassPal[6][2] > 220 && grassPal[6][1] < 100, "Band 6 is violet/magenta");

  // Step fluid over 90 ticks: fluid spirals inward and is consumed at the event horizon
  const beforeConsumed = fluid.consumedAmount;
  for (let t = 0; t < 90; t++) {
    fluid.step(world, 1 / 30);
  }
  assert.ok(fluid.consumedAmount > beforeConsumed + 0.5, "Fluid reaching the event horizon is consumed");
});

test("4. Hot inner fluid bands feed the 1/2-res emissive halo buffer cheaply and low quality uses a coarser grid", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const p = world.portals[0];
  p.active = true;

  for (let y = Math.max(0, Math.floor(p.y - 25)); y < Math.min(world.grid.h, Math.ceil(p.y + 25)); y++) {
    for (let x = Math.max(0, Math.floor(p.x - 25)); x < Math.min(world.grid.w, Math.ceil(p.x + 25)); x++) {
      world.material[y * world.grid.w + x] = CellMaterial.VOID;
      world.buildingAt[y * world.grid.w + x] = -1;
    }
  }

  const engine = new LightingEngine();
  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  engine.syncChunks(world, "full");
  const terrainU32 = new Uint32Array(world.grid.count).fill(0xff201030);

  // Baseline lighting without fluid
  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night);
  const { halo, haloW } = engine.getHaloBuffer();
  // Add hot inner fluid at (p.x + coreR + 2, p.y) where band >= 4 and re-render lighting with voidFluid
  const coreR = Math.max(3.6, p.radius * 0.42);
  const sampleX = Math.round(p.x + coreR + 2);
  const sampleY = Math.round(p.y);
  const hx = Math.floor(sampleX / 2);
  const hy = Math.floor(sampleY / 2);
  const hIdx = (hy * haloW + hx) * 3;
  const baseHaloR = halo[hIdx];

  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);
  fluid.depositAtWorld(sampleX, sampleY, 1.6, FluidMaterial.CONCRETE, coreR + 18);

  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  assert.ok(halo[hIdx] > baseHaloR + 15, `Hot inner fluid band must emit into the 1/2-res halo buffer (${halo[hIdx]} > ${baseHaloR})`);

  // Switch fluid grid to Low quality (cellSize = 2): coarser grid preserves fluid mass and uses 1/4 the cells
  const fullGridCount = fluid.gridW * fluid.gridH;
  fluid.ensureSize(world.grid.w, world.grid.h, 2);
  assert.equal(fluid.cellSize, 2);
  assert.equal(fluid.gridW * fluid.gridH, fullGridCount / 4, "Coarser low-quality fluid grid uses 1/4 as many cells");
  assert.ok(fluid.activeCellCount > 0, "Resampling to coarser grid preserves active fluid");
});

test("5. Halo glow from Void fluid clears once the fluid drains away", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const p = world.portals[0];
  p.active = true;
  for (let y = Math.max(0, Math.floor(p.y - 25)); y < Math.min(world.grid.h, Math.ceil(p.y + 25)); y++) {
    for (let x = Math.max(0, Math.floor(p.x - 25)); x < Math.min(world.grid.w, Math.ceil(p.x + 25)); x++) {
      world.material[y * world.grid.w + x] = CellMaterial.VOID;
      world.buildingAt[y * world.grid.w + x] = -1;
    }
  }
  const engine = new LightingEngine();
  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  engine.syncChunks(world, "full");
  const terrainU32 = new Uint32Array(world.grid.count).fill(0xff201030);
  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);

  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  const baseline = Float32Array.from(engine.getHaloBuffer().halo);

  const coreR = Math.max(3.6, p.radius * 0.42);
  fluid.depositAtWorld(Math.round(p.x + coreR + 2), Math.round(p.y), 1.6, FluidMaterial.CONCRETE, coreR + 18);
  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  const lit = engine.getHaloBuffer().halo;
  let litDiff = 0;
  for (let i = 0; i < lit.length; i++) litDiff = Math.max(litDiff, Math.abs(lit[i] - baseline[i]));
  assert.ok(litDiff > 15, "fluid glow reaches the halo buffer");

  fluid.clear();
  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  const after = engine.getHaloBuffer().halo;
  let staleDiff = 0;
  for (let i = 0; i < after.length; i++) staleDiff = Math.max(staleDiff, Math.abs(after[i] - baseline[i]));
  assert.ok(staleDiff < 0.5, `halo returns to its fluid-free state after the fluid drains (max diff ${staleDiff})`);
});

test("6. Dissolving road, grass, and building chunks start with fluid cell RGB close to their true rendered source colors, blend weighted by amount, and heat along trails", () => {
  const sim = new VoidSim("centralRupture", "underSiege", emptyTechWallet(), true);
  const { world, physics } = sim;
  const p = world.portals[0];
  p.active = true;

  const colorDist = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // 1. Road cell (asphalt street)
  const roadX = Math.round(p.x + 24);
  const roadY = Math.round(p.y);
  const roadIdx = world.grid.index(roadX, roadY);
  world.material[roadIdx] = CellMaterial.STREET;
  world.streetTier[roadIdx] = 2;
  world.buildingAt[roadIdx] = -1;
  const roadSource = sampleSourceCellColors(world, roadIdx, CellMaterial.STREET, LandCover.NONE, -1, 0);

  // 2. Grass cell (park / countryside)
  const grassX = Math.round(p.x - 24);
  const grassY = Math.round(p.y);
  const grassIdx = world.grid.index(grassX, grassY);
  world.material[grassIdx] = CellMaterial.PARK;
  world.landCover[grassIdx] = LandCover.GRASS;
  world.buildingAt[grassIdx] = -1;
  const grassSource = sampleSourceCellColors(world, grassIdx, CellMaterial.PARK, LandCover.GRASS, -1, 0);

  // 3. Building cell (find a real building in the city and sample one of its footprint cells)
  const bld = world.buildings.find((b) => b.cells.length > 0)!;
  assert.ok(bld, "Expected at least one metropolitan building");
  const bldIdx = bld.cells[0];
  const bldId = bld.id;
  world.material[bldIdx] = CellMaterial.BUILDING;
  world.buildingAt[bldIdx] = bldId;
  world.columnFloors[bldIdx] = bld.height;
  world.hp[bldIdx] = 100;
  world.maxHp[bldIdx] = 100;
  const bldSource = sampleSourceCellColors(world, bldIdx, CellMaterial.BUILDING, LandCover.NONE, bldId, bld.height);

  // Verify the three source colors are genuinely distinct (road slate/orange, grass green, building palette)
  assert.ok(grassSource.rgb[1] > grassSource.rgb[0] + 15 && grassSource.rgb[1] > grassSource.rgb[2] + 15,
    `Grass source color must be green-dominant: [${grassSource.rgb.join(", ")}]`);
  assert.ok(colorDist(roadSource.rgb, grassSource.rgb) > 25,
    `Road [${roadSource.rgb}] and grass [${grassSource.rgb}] source colors must be distinct`);

  // Dissolve each chunk into the fluid grid and check starting cell colors are close to their true source RGB
  for (const sample of [
    { name: "road", idx: roadIdx, src: roadSource },
    { name: "grass", idx: grassIdx, src: grassSource },
    { name: "building", idx: bldIdx, src: bldSource },
  ]) {
    physics.debris.length = 0;
    physics.voidFluid.clear();
    physics.consumeCellIntoVoid(world, sample.idx, true);
    assert.equal(physics.debris.length, 1, `Expected 1 chunk spawned for ${sample.name}`);
    const chunk = physics.debris[0];
    assert.equal(chunk.color, sample.src.color, `${sample.name} chunk must carry true source hex color`);

    // Force immediate chunk dissolution at its starting position (simulating chunk expiry)
    chunk.life = chunk.maxLife;
    physics.stepStructuralSupport(world, 0.001);

    // Find the fluid cell with maximum amount
    let bestCell = -1;
    let bestAmt = 0;
    for (let i = 0; i < physics.voidFluid.amount.length; i++) {
      if (physics.voidFluid.amount[i] > bestAmt) {
        bestAmt = physics.voidFluid.amount[i];
        bestCell = i;
      }
    }
    assert.ok(bestCell >= 0 && bestAmt > 0.2, `Expected active fluid cell after dissolving ${sample.name} chunk`);
    const cellRgb = physics.voidFluid.getCellSourceRgb(bestCell);
    const dRgb = colorDist(cellRgb, sample.src.rgb);
    assert.ok(
      dRgb <= 12,
      `${sample.name} starting fluid cell RGB [${cellRgb.map(Math.round)}] must be close to source [${sample.src.rgb}] (dist=${dRgb.toFixed(2)})`,
    );
  }

  // Verify amount-weighted RGB color blending when two different streams meet in the same cell
  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);
  const mixX = Math.floor(p.x + 22);
  const mixY = Math.floor(p.y);
  const mixIdx = mixY * fluid.gridW + mixX;
  fluid.depositAtWorld(mixX + 0.5, mixY + 0.5, 0.5, FluidMaterial.CONCRETE, 22, [40, 50, 60], 0);
  fluid.depositAtWorld(mixX + 0.5, mixY + 0.5, 1.5, FluidMaterial.GRASS, 22, [80, 170, 60], 0);
  const mixed = fluid.getCellSourceRgb(mixIdx);
  // Expected weighted average (1:3 ratio): R ~ 70, G ~ 140, B ~ 60 (+/- deterministic per-cell variation <= 6)
  assert.ok(Math.abs(mixed[0] - 70) <= 8 && Math.abs(mixed[1] - 140) <= 8,
    `Expected 1:3 amount-weighted RGB blend near [70, 140, 60], got [${mixed.map(Math.round)}]`);

  // Verify per-cell heat rises with time spent in the flow, flow speed friction, and closeness to the Void,
  // and that evaluateFluidHeatColor transitions smoothly from source color -> dark red -> orange -> yellow-white -> violet
  const h0 = fluid.heat[mixIdx];
  for (let t = 0; t < 10; t++) {
    fluid.step(world, 1 / 30);
  }
  let maxAdvectedHeat = 0;
  for (let i = 0; i < fluid.amount.length; i++) {
    if (fluid.amount[i] > 0.025 && fluid.heat[i] > maxAdvectedHeat) {
      maxAdvectedHeat = fluid.heat[i];
    }
  }
  assert.ok(maxAdvectedHeat > h0 + 0.05, `Heat must rise and travel with the fluid stream (${maxAdvectedHeat} > ${h0})`);

  const cCool = evaluateFluidHeatColor(70, 140, 60, 0.05);
  const cRed = evaluateFluidHeatColor(70, 140, 60, 0.35);
  const cOrange = evaluateFluidHeatColor(70, 140, 60, 0.52);
  const cYellowWhite = evaluateFluidHeatColor(70, 140, 60, 0.65);
  const cViolet = evaluateFluidHeatColor(70, 140, 60, 0.96);
  assert.ok(cCool[1] > cCool[0], "Cool heat preserves green source color");
  assert.ok(cRed[0] > 140 && cRed[0] > cRed[1] * 1.4, "Warm heat shifts toward dark red");
  assert.ok(cOrange[0] > 235 && cOrange[1] > 110 && cOrange[2] < 80, "Hot heat shifts to molten orange");
  assert.ok(cYellowWhite[0] > 240 && cYellowWhite[1] > 190 && cYellowWhite[2] > 110, "Peak heat reaches yellow-white");
  assert.ok(cViolet[2] > 210 && cViolet[0] > 150 && cViolet[1] < 95, "Horizon heat shifts to Void violet/magenta");

  // Verify fluid starts right at the crater rim where ground is consumed, chunks lift with z > 0, and horizon crossing spawns flashes
  physics.debris.length = 0;
  physics.voidFluid.clear();
  const rimX = Math.round(p.x + 20);
  const rimY = Math.round(p.y);
  const rimCell = world.grid.index(rimX, rimY);
  world.material[rimCell] = CellMaterial.STREET;
  world.streetTier[rimCell] = 2;
  world.buildingAt[rimCell] = -1;
  physics.consumeCellIntoVoid(world, rimCell, true);
  assert.ok(physics.voidFluid.amount[rimY * physics.voidFluid.gridW + rimX] > 0.4,
    "Fluid must start directly at the rim cell where ground was eaten");
  assert.ok((physics.debris[0].z ?? 0) > 0, "Torn-off chunk must lift with z > 0 at the rim");

  // Step fluid near core to trigger event-horizon crossing flash
  const coreR = Math.max(3.6, p.radius * 0.42);
  physics.voidFluid.depositAtWorld(p.x + coreR + 1.4, p.y, 1.5, FluidMaterial.CONCRETE, 20, [120, 130, 140], 0.95);
  for (let t = 0; t < 4; t++) physics.voidFluid.step(world, 1 / 30);
  assert.ok(physics.voidFluid.horizonFlashes.some((f) => f.active), "Crossing the event horizon spawns a bright horizon flash");
});

test("7. Fluid halo glow blurs across 16-px lighting tile edges without dark seams", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;
  const p = world.portals[0];
  p.active = true;
  for (let y = Math.max(0, Math.floor(p.y - 30)); y < Math.min(world.grid.h, Math.ceil(p.y + 30)); y++) {
    for (let x = Math.max(0, Math.floor(p.x - 30)); x < Math.min(world.grid.w, Math.ceil(p.x + 30)); x++) {
      world.material[y * world.grid.w + x] = CellMaterial.VOID;
      world.buildingAt[y * world.grid.w + x] = -1;
    }
  }
  const engine = new LightingEngine();
  const cache = new BuildingSpriteCache();
  cache.syncAtlasGbuffer(world, "full");
  engine.syncChunks(world, "full");
  const terrainU32 = new Uint32Array(world.grid.count).fill(0xff201030);
  const fluid = new VoidFluidGrid();
  fluid.ensureSize(world.grid.w, world.grid.h, 1);
  fluid.syncFlowField(world);

  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  const { halo, haloW } = engine.getHaloBuffer();
  const coreR = Math.max(3.6, p.radius * 0.42);
  // First tile edge at least 4 px outside the event horizon; fluid sits on the halo texel just left of it
  const edgeX = Math.ceil((p.x + coreR + 4) / 16) * 16;
  const y = Math.round(p.y) & ~1; // halo seeds sample even rows
  const rightTexel = ((y >> 1) * haloW + (edgeX >> 1)) * 3;
  const baseline = halo[rightTexel] + halo[rightTexel + 2];

  fluid.depositAtWorld(edgeX - 2, y, 0.4, FluidMaterial.CONCRETE, coreR + 18, [96, 104, 120], 0.95);
  engine.renderLighting(world, terrainU32, cache, [], TIME_OF_DAY_PRESETS.night, undefined, undefined, false, 0, 0, fluid);
  const lit = halo[rightTexel] + halo[rightTexel + 2];
  assert.ok(lit > baseline + 5, `glow from fluid just left of a tile edge spills into the next tile (${lit} > ${baseline})`);
});
