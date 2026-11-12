import assert from "node:assert/strict";
import test from "node:test";
import { decodeSettings, defaultSettings } from "../src/settings.ts";
import {
  BuildingSpriteCache,
  cellTierElevation,
  elevationOf,
  FLOORS_PER_PIXEL,
  floorsToElevation,
  MAX_ELEVATION_PX,
  projectRoofY,
  TOWER_ELEVATION_PX,
} from "../src/void/elevation.ts";
import { getScenario } from "../src/void/maps.ts";
import { isOccludedByLedge, ledgeFrontDepthAt } from "../src/void/ledge.ts";
import { CellMaterial } from "../src/void/model.ts";
import { CHUNK_IMPACT_MAX_DAMAGE, CHUNK_STREET_CRACK, MAX_FALLING_CHUNKS, VOID_ABYSS_Z } from "../src/void/physics.ts";
import { computeCityIncomePerCycle } from "../src/void/scoring.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";
import { VoidWorld } from "../src/void/world.ts";

test("Oblique ¾ projection: elevationOf and projectRoofY map floors to 1..15 px across Full, Low, and Flat modes", () => {
  assert.equal(FLOORS_PER_PIXEL, 2);
  assert.equal(MAX_ELEVATION_PX, 15);
  assert.equal(TOWER_ELEVATION_PX, 2);

  // Full mode: ceil(floors / 2), clamped 1..15
  assert.equal(floorsToElevation(0, "full"), 0);
  assert.equal(floorsToElevation(2, "full"), 1);
  assert.equal(floorsToElevation(3, "full"), 2);
  assert.equal(floorsToElevation(6, "full"), 3);
  assert.equal(floorsToElevation(14, "full"), 7);
  assert.equal(floorsToElevation(30, "full"), 15);
  assert.equal(floorsToElevation(48, "full"), 15);

  // Low mode: half of full, rounded up, min 1
  assert.equal(floorsToElevation(2, "low"), 1);
  assert.equal(floorsToElevation(14, "low"), 4);
  assert.equal(floorsToElevation(30, "low"), 8);

  // Flat mode: 0 elevation
  assert.equal(floorsToElevation(2, "flat"), 0);
  assert.equal(floorsToElevation(30, "flat"), 0);

  // Roof y projects upward (smaller screen y)
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "full")), 90);
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "low")), 95);
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "flat")), 100);
});

test("BuildingSpriteCache produces integer whole-pixel runs and accurate roof/facade hit masks without mutating simulation state", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;

  // Snapshot simulation state before building sprites and picking structures
  const matBefore = world.material.slice();
  const hpBefore = world.hp.slice();
  const bAtBefore = world.buildingAt.slice();

  const cache = new BuildingSpriteCache();
  let tallSpriteFound = false;

  for (const b of world.buildings) {
    const sp = cache.getSprite(world, b, "full");
    assert.equal(sp.w, b.w);
    assert.equal(sp.h, b.h + sp.maxElev);
    assert.equal(sp.y, b.y - sp.maxElev);

    // Every pixel run and op must be on integer world coordinates
    for (const r of sp.runs) {
      assert.equal(r.dx, Math.floor(r.dx));
      assert.equal(r.dy, Math.floor(r.dy));
      assert.equal(r.w, Math.floor(r.w));
      assert.ok(r.dx >= 0 && r.dx + r.w <= sp.w);
      assert.ok(r.dy >= 0 && r.dy < sp.h);
    }

    if (b.isSkyscraper && sp.intactCount > 0 && sp.maxElev >= 6) {
      tallSpriteFound = true;
      // Stepped skyscraper inner core reaches full elevation while outer ring is lower
      const cx = b.x + Math.floor(b.w / 2);
      const cy = b.y + Math.floor(b.h / 2);
      assert.ok(
        cellTierElevation(b, cx, cy, sp.maxElev) >= cellTierElevation(b, b.x, b.y, sp.maxElev),
      );
      // Roof hit-test above the north footprint (`y < b.y`) hits the building
      const pick = cache.pickStructureAt(world, sim.combat.towers, cx, b.y - 1, "full");
      assert.ok(pick !== null, "Expected roof hit above north footprint edge");
    }
  }

  assert.ok(tallSpriteFound, "Expected at least one tall skyscraper sprite");

  // Verify simulation arrays were untouched by sprite building and picking
  assert.deepEqual(world.material, matBefore);
  assert.deepEqual(world.hp, hpBefore);
  assert.deepEqual(world.buildingAt, bAtBefore);
});

test("buildingHeight setting defaults to full and round-trips through decodeSettings", () => {
  assert.equal(defaultSettings().buildingHeight, "full");
  assert.equal(decodeSettings({}).buildingHeight, "full");
  assert.equal(decodeSettings({ buildingHeight: "low" }).buildingHeight, "low");
  assert.equal(decodeSettings({ buildingHeight: "flat" }).buildingHeight, "flat");
  assert.equal(decodeSettings({ buildingHeight: "invalid" }).buildingHeight, "full");
});

test("Phase 2: columnFloors initializes deterministically and cantilever / brink spalling rules hold 1-px overhang while dropping 5-px overhang", () => {
  const sc = getScenario("tutorialBreach");
  const w1 = new VoidWorld(sc);
  const w2 = new VoidWorld(sc);
  assert.deepEqual(w1.columnFloors, w2.columnFloors);

  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world, physics } = sim;
  const { w } = world.grid;

  // Pick an intact skyscraper with width >= 8 and height >= 16 (maxSpan = 1 + floor(height/8) >= 3)
  const target = world.buildings.find((b) => b.isSkyscraper && b.w >= 8 && b.h >= 6 && b.height >= 16);
  assert.ok(target, "Expected a wide tall skyscraper");

  // Verify initial columnFloors match target.height
  for (const idx of target.cells) {
    assert.equal(world.columnFloors[idx], target.height);
  }

  // Consume 1 column on the west edge into Void: 1-px overhang is within maxSpan of supported neighbor (x + 1)
  const westEdgeIdx = (target.y + 1) * w + target.x;
  physics.consumeCellIntoVoid(world, westEdgeIdx, false);
  physics.stepStructuralSupport(world, 1 / 30);
  assert.ok(
    world.columnFloors[westEdgeIdx] > 0,
    `1-px overhang should survive cantilever check (got ${world.columnFloors[westEdgeIdx]})`,
  );

  // Now consume a 6-px wide swath from the west side of the building so the westernmost column is 6 px from any supported column (> maxSpan)
  for (let py = target.y; py < target.y + target.h; py++) {
    for (let px = target.x; px < Math.min(target.x + 6, target.x + target.w - 1); px++) {
      physics.consumeCellIntoVoid(world, py * w + px, false);
    }
  }
  physics.stepStructuralSupport(world, 1 / 30);
  assert.equal(
    world.columnFloors[westEdgeIdx],
    0,
    "Column 6 px from nearest supported foundation (> maxSpan) must detach and drop to 0 floors",
  );

  // Step 40 ticks of structural support so brink spalling erodes upper floors of columns adjacent to Void
  let spalledColumns = 0;
  for (let t = 0; t < 40; t++) {
    physics.stepStructuralSupport(world, 1 / 30);
  }
  for (const idx of target.cells) {
    if (world.material[idx] !== CellMaterial.VOID && world.columnFloors[idx] < target.height) {
      spalledColumns++;
    }
  }
  assert.ok(spalledColumns > 0, "Expected brink columns next to Void to spall upper floors over time");

  // Building sprite for partially collapsed skyscraper renders exposed cutaway floor slab & interior room colors
  const cache = new BuildingSpriteCache();
  const sp = cache.getSprite(world, target, "full");
  const hasSlabOrInterior = sp.ops.some(
    (op) => op.color === "#5c6574" || op.color === "#4a525e" || op.color === "#141923" || op.color === "#2a3344",
  );
  assert.ok(hasSlabOrInterior, "Expected exposed concrete slab or room interior pixels in cutaway sprite");
});

test("Phase 3: FallingChunk pool (cap 200), ground salvage deposition vs Void abyss plunge (z < -24), and ledge front-face occlusion", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet(), true);
  const { world, physics } = sim;
  const { w } = world.grid;

  assert.equal(physics.fallingChunks.length, MAX_FALLING_CHUNKS);

  // 1. Test falling chunk over solid street ground with settle="salvage": bounces once at z=0, then settles into CellMaterial.SALVAGE
  let streetX = 20;
  let streetY = 20;
  for (let y = 10; y < 80; y++) {
    for (let x = 10; x < 80; x++) {
      const idx = y * w + x;
      if (
        world.material[idx] === CellMaterial.STREET &&
        world.buildingAt[idx] < 0 &&
        world.towerAt[idx] < 0
      ) {
        streetX = x;
        streetY = y;
        break;
      }
    }
  }
  const streetIdx = streetY * w + streetX;
  const chGround = physics.spawnFallingChunk(
    streetX + 0.5,
    streetY + 0.5,
    6,
    0,
    0,
    0,
    2,
    2,
    "#6e472b",
    "#ff8c29",
    "salvage",
  );
  assert.equal(chGround.active, true);

  let bounced = false;
  for (let t = 0; t < 40 && chGround.active; t++) {
    physics.stepFallingChunks(world, 1 / 30);
    if (chGround.bounces > 0) bounced = true;
  }
  assert.equal(bounced, true, "Falling chunk over ground should bounce once before settling");
  assert.equal(chGround.active, false, "Chunk should deactivate after settling on ground");
  assert.equal(world.material[streetIdx], CellMaterial.SALVAGE, "Settled salvage chunk deposits CellMaterial.SALVAGE");

  // 2. Test falling chunk over Void: falls below z = 0 (`z < 0`, drawn at `screenY = y - z`) and is removed at `z < -24`
  const p = world.portals[0];
  const chVoid = physics.spawnFallingChunk(
    p.x,
    p.y,
    4,
    0,
    0,
    0,
    3,
    3,
    "#161f30",
    "#ff8c29",
    "void",
  );
  let sawNegativeZ = false;
  let minZ = 4;
  for (let t = 0; t < 60 && chVoid.active; t++) {
    physics.stepFallingChunks(world, 1 / 30);
    if (chVoid.z < 0) sawNegativeZ = true;
    if (chVoid.z < minZ) minZ = chVoid.z;
  }
  assert.equal(sawNegativeZ, true, "Chunk over Void must plunge below ground level (z < 0)");
  assert.equal(chVoid.active, false, "Chunk over Void must deactivate once z < -24");
  assert.ok(minZ <= VOID_ABYSS_Z, `Expected minZ <= ${VOID_ABYSS_Z}, got ${minZ}`);

  // 3. Test pool cap (~200): spawning 250 chunks never allocates beyond MAX_FALLING_CHUNKS and recycles oldest Void-bound first
  for (let k = 0; k < 250; k++) {
    physics.spawnFallingChunk(p.x, p.y, 5, 0, 0, 0, 1, 1, "#4a525e", "#ff8c29", k % 2 === 0 ? "void" : "fade");
    physics.stepFallingChunks(world, 0.001);
  }
  assert.equal(physics.fallingChunks.length, MAX_FALLING_CHUNKS);
  assert.ok(physics.activeFallingChunkCount() <= MAX_FALLING_CHUNKS);

  // 4. Test ledge front-face occlusion helper
  let foundLedge = false;
  for (const fIdx of sim.voidField.frontierCells) {
    const fx = fIdx % w;
    const fy = (fIdx / w) | 0;
    const d = ledgeFrontDepthAt(world, fx, fy);
    if (d >= 4) {
      foundLedge = true;
      assert.equal(isOccludedByLedge(world, fx, fy + 1), true, "Pixel 1 px below north rim is occluded by ledge");
      assert.equal(isOccludedByLedge(world, fx, fy + d), true, "Pixel at bottom of ledge front face is occluded");
      if (fy + d + 2 < world.grid.h && world.material[(fy + d + 2) * w + fx] === CellMaterial.VOID) {
        assert.equal(isOccludedByLedge(world, fx, fy + d + 2), false, "Pixel below ledge undercut is visible in Void");
      }
      break;
    }
  }
  assert.ok(foundLedge, "Expected at least one north-rim subterranean ledge on tutorialBreach");
});

test("Phase 4: pooled dust puffs, large-collapse camera shake trigger, and Void abyss ripples", () => {
  const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
  const { world, physics } = sim;
  const p = world.portals[0];

  // 1. Dust puffs are pooled and capped (zero per-tick allocation)
  for (let i = 0; i < 160; i++) {
    physics.spawnDustPuff(p.x, p.y, 4, "#868080");
  }
  assert.equal(physics.dustPuffs.length, 120);
  const activeDust = physics.dustPuffs.filter((d) => d.active).length;
  assert.equal(activeDust, 120);

  // 2. Large falling chunk (w * h >= 4) plunging past VOID_ABYSS_Z emits a Void interior ripple
  for (const r of physics.voidRipples) r.active = false;
  const big = physics.spawnFallingChunk(p.x, p.y, 1, 0, 0, -50, 2, 2, "#5a6376", "#78dcff", "void");
  for (let t = 0; t < 60 && big.active; t++) {
    physics.stepFallingChunks(world, 1 / 30);
  }
  const activeRipples = physics.voidRipples.filter((r) => r.active).length;
  assert.ok(activeRipples >= 1, "Expected >= 1 Void ripple when a 2x2 chunk plunges past VOID_ABYSS_Z");

  // 3. Collapsing >= 20 columns in one tick advances lastLargeCollapseTick for 1-px camera shake
  const b = world.buildings.find((bld) => bld.cells.length >= 25)!;
  const prevTick = physics.lastLargeCollapseTick;
  for (let i = 0; i < b.cells.length; i++) {
    physics.consumeCellIntoVoid(world, b.cells[i], false);
  }
  physics.stepStructuralSupport(world, 1 / 30);
  assert.ok(
    physics.lastLargeCollapseTick > prevTick,
    "Collapsing >= 20 columns in one tick must advance lastLargeCollapseTick",
  );
});

test("Phase 5: floor-based income, chunk fall damage (units/organisms/turrets, not buildings), and engineer shoring", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world, physics, combat, tech } = sim;
  const { w } = world.grid;

  // 1. Income scales with remaining columnFloors (1 floor = $1 per 15s = $2/15 per 2s cycle)
  const fullIncome = computeCityIncomePerCycle(world, tech);
  for (let i = 0; i < world.columnFloors.length; i++) {
    if (world.columnFloors[i] > 2) {
      world.columnFloors[i] = Math.floor(world.columnFloors[i] / 2);
    }
  }
  const halfIncome = computeCityIncomePerCycle(world, tech);
  assert.ok(halfIncome < fullIncome, `Expected halved floors to reduce income (${halfIncome} < ${fullIncome})`);

  // 2. Ground impact cracks streets, damages turrets/agents/organisms, and emits smoke clouds
  let streetX = -1;
  let streetY = -1;
  for (let y = 10; y < world.grid.h - 10 && streetX < 0; y++) {
    for (let x = 10; x < w - 10; x++) {
      if (world.material[y * w + x] === CellMaterial.STREET) {
        streetX = x;
        streetY = y;
        break;
      }
    }
  }
  assert.ok(streetX >= 0, "Expected a street cell");
  const streetIdx = streetY * w + streetX;
  const streetHpBefore = world.hp[streetIdx];

  combat.towers.push({
    uid: 9999,
    type: "matterCannon",
    x: streetX,
    y: streetY,
    w: 2,
    h: 2,
    hp: 100,
    maxHp: 100,
    paid: 10,
    placedAtTick: 1,
    cooldown: 0,
  });
  combat.agents.push({
    id: 9998,
    kind: "rifleman",
    homeUid: 9999,
    x: streetX + 0.5,
    y: streetY + 0.5,
    hp: 100,
    maxHp: 100,
    cooldown: 0,
    targetCell: -1,
    carryingMatter: 0,
  });
  combat.organisms.push({
    id: 9997,
    kind: "voidBee",
    x: streetX + 0.5,
    y: streetY + 0.5,
    vx: 0,
    vy: 0,
    hp: 100,
    maxHp: 100,
    targetX: streetX,
    targetY: streetY,
    cooldown: 0,
  });

  for (const d of physics.dustPuffs) d.active = false;
  const heavyChunk = physics.spawnFallingChunk(
    streetX + 0.5,
    streetY + 0.5,
    2,
    0,
    0,
    -60,
    2,
    2,
    "#5c6574",
    "#ff8c29",
    "fade",
  );
  for (let t = 0; t < 5 && heavyChunk.bounces === 0 && heavyChunk.active; t++) {
    physics.stepFallingChunks(world, 1 / 30);
  }
  assert.ok(world.hp[streetIdx] < streetHpBefore, "Heavy falling chunk must scuff street HP");
  assert.ok(streetHpBefore - world.hp[streetIdx] <= CHUNK_STREET_CRACK, "Street scuff stays small");
  assert.ok(physics.dustPuffs.some((d) => d.active), "Impact must emit smoke cloud dust puffs");
  assert.ok(physics.pendingImpacts.length >= 1, "Impact must queue damage for combat entities");

  const impactDamage = physics.pendingImpacts[0].damage;
  assert.ok(impactDamage <= CHUNK_IMPACT_MAX_DAMAGE, `Impact damage ${impactDamage} is capped`);
  combat.step(world, physics, sim.voidField, sim.tick + 1, 1 / 30, tech, false);
  const towerHp = combat.towers.find((t) => t.uid === 9999)!.hp;
  assert.ok(towerHp < 100, "Impact must damage nearby turret");
  assert.ok(100 - towerHp < impactDamage, "Turrets take reduced impact damage");
  assert.ok(combat.agents.find((a) => a.id === 9998)!.hp < 100, "Impact must damage nearby friendly unit");
  assert.ok(combat.organisms.find((o) => o.id === 9997)!.hp < 100, "Impact must damage nearby Void organism");

  // 2b. Chunks landing on a building leave it untouched
  const bld = world.buildings.find((bb) => bb.cells.length > 0 && world.buildingAt[bb.cells[0]] === bb.id)!;
  const bCell = bld.cells[0];
  const bHpBefore = world.hp[bCell];
  physics.spawnFallingChunk((bCell % w) + 0.5, Math.floor(bCell / w) + 0.5, 2, 0, 0, -60, 2, 2, "#5c6574", "#ff8c29", "fade");
  for (let t = 0; t < 10; t++) physics.stepFallingChunks(world, 1 / 30);
  assert.equal(world.hp[bCell], bHpBefore, "Falling chunks must not damage buildings");
  physics.pendingImpacts.length = 0;

  // 3. Engineer shoring registers building support until future tick
  const b = world.buildings[0];
  physics.shoreBuilding(b.id, 500);
  assert.equal(physics.shoredBuildings.get(b.id), 500);
});


