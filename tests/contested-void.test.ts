import assert from "node:assert/strict";
import test from "node:test";
import { VOID_CONTEST_COSTS, contestHoldTicksForDifficulty } from "../src/void/config.ts";
import { floorsToElevation } from "../src/void/elevation.ts";
import { SCENARIOS, getScenario } from "../src/void/maps.ts";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import { VoidPhysics } from "../src/void/physics.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";
import { TOWER_SPECS } from "../src/void/towers.ts";
import { VoidField } from "../src/void/void-field.ts";
import { VoidWorld } from "../src/void/world.ts";

function makeFlatWorld(w = 16, h = 16) {
  const scenario = {
    ...getScenario("tutorialBreach"),
    worldW: w,
    worldH: h,
    portals: [{ xFrac: 0.5, yFrac: 0.5, radius: 1, activateAtSeconds: 0 }],
    initialVoidEnergy: 1000,
    baseGrowthRate: 10,
    rampPerMinute: 0,
  };
  const world = new VoidWorld(scenario);
  world.material.fill(CellMaterial.STREET);
  world.hp.fill(20);
  world.maxHp.fill(20);
  world.buildingAt.fill(-1);
  world.columnFloors.fill(0);
  world.landCover.fill(LandCover.NONE);
  return { scenario, world };
}

test("Contested Void: empty space costs 1 void power to consume", () => {
  assert.equal(VOID_CONTEST_COSTS.EMPTY_COST, 1);
  const { scenario, world } = makeFlatWorld();
  const physics = new VoidPhysics();
  const idx = world.grid.index(4, 4);
  world.material[idx] = CellMaterial.EMPTY;
  world.hp[idx] = 0;
  world.maxHp[idx] = 0;

  const field = new VoidField(world, scenario);
  assert.equal(field.voidPowerCost(world, idx), 1);

  const consumed = field.spendVoidPowerOnCell(world, physics, idx, 1);
  assert.equal(consumed, true);
  assert.equal(world.material[idx], CellMaterial.VOID);
});

test("Contested Void: land costs 2 void power and carries partial progress deterministically", () => {
  assert.equal(VOID_CONTEST_COSTS.LAND_COST_PER_PIXEL, 2);
  const { scenario, world } = makeFlatWorld();
  const physics = new VoidPhysics();
  const idx = world.grid.index(5, 5);
  world.material[idx] = CellMaterial.STREET;
  world.hp[idx] = 20;
  world.maxHp[idx] = 20;

  const field = new VoidField(world, scenario);
  assert.equal(field.voidPowerCost(world, idx), 2);

  // Spend 1 power: partial progress carried over, cell remains land
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 1), false);
  assert.equal(world.material[idx], CellMaterial.STREET);
  assert.ok(field.cellMicroWork[idx] > 0, "partial void power progress is carried over");
  assert.ok(world.hp[idx] < 20, "partial power reduces land HP proportionally");

  // Spend remaining 1 power (2 total): cell is consumed into Void
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 1), true);
  assert.equal(world.material[idx], CellMaterial.VOID);
  assert.equal(field.cellMicroWork[idx], 0);
});

test("Contested Void: land + 3px building costs 2 + (3 * 2) = 8 void power", () => {
  assert.equal(VOID_CONTEST_COSTS.BUILDING_COST_PER_PIXEL, 2);
  const { scenario, world } = makeFlatWorld();
  const physics = new VoidPhysics();
  const idx = world.grid.index(6, 6);

  // 6 floors = 3 world pixels tall (FLOORS_PER_PIXEL = 2)
  world.material[idx] = CellMaterial.BUILDING;
  world.columnFloors[idx] = 6;
  world.hp[idx] = 50;
  world.maxHp[idx] = 50;
  assert.equal(floorsToElevation(world.columnFloors[idx], "full"), 3);

  const field = new VoidField(world, scenario);
  assert.equal(field.voidPowerCost(world, idx), 8);

  // Spend 3 power, then 4 power (7 total): still not consumed
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 3), false);
  assert.equal(world.material[idx], CellMaterial.BUILDING);
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 4), false);
  assert.equal(world.material[idx], CellMaterial.BUILDING);

  // Spend final 1 power (8 total): consumed into Void
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 1), true);
  assert.equal(world.material[idx], CellMaterial.VOID);
});

test("Contested Void: Void removal leaves empty space (never land/buildings) costing 1 power to reclaim", () => {
  const { scenario, world } = makeFlatWorld();
  const physics = new VoidPhysics();
  const idx = world.grid.index(7, 7);

  // Start as a 3-px building, consume into Void
  world.material[idx] = CellMaterial.BUILDING;
  world.columnFloors[idx] = 6;
  world.hp[idx] = 50;
  world.maxHp[idx] = 50;
  physics.consumeCellIntoVoid(world, idx, false);
  assert.equal(world.material[idx], CellMaterial.VOID);

  const field = new VoidField(world, scenario);
  const voidBefore = field.voidCellCount;
  assert.equal(field.removeVoidPixel(world, idx), true);

  // Must become EMPTY space, never restoring land or building
  assert.equal(world.material[idx], CellMaterial.EMPTY);
  assert.equal(world.hp[idx], 0);
  assert.equal(world.maxHp[idx], 0);
  assert.equal(world.buildingAt[idx], -1);
  assert.equal(world.columnFloors[idx], 0);
  assert.equal(world.landCover[idx], LandCover.NONE);
  assert.equal(field.voidCellCount, voidBefore - 1);

  // Empty space costs only 1 void power to reclaim once contest holdback expires
  assert.equal(field.voidPowerCost(world, idx), 1);
  assert.ok(field.contestedCells.has(idx), "removed Void pixel is marked contested");
  // While contested, Void holds back
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 1), false);
  assert.equal(world.material[idx], CellMaterial.EMPTY);

  // Advance 1.0s (30 ticks at 30 Hz for voidDifficulty=1) so contest holdback fades out
  assert.equal(field.contestHoldTicks, 30);
  for (let t = 0; t < 29; t++) {
    field.step(world, physics, scenario, t + 1, 1 / 30, {
      wallResistanceMultiplier: 1,
      perimeterResonanceBonus: 0,
    });
  }
  assert.equal(field.contestedCells.has(idx), true, "still contested before 1s elapses at difficulty 1");
  field.step(world, physics, scenario, 30, 1 / 30, {
    wallResistanceMultiplier: 1,
    perimeterResonanceBonus: 0,
  });
  assert.equal(field.contestedCells.has(idx), false, "contest holdback expires after 1s at difficulty 1");
  assert.equal(field.spendVoidPowerOnCell(world, physics, idx, 1), true);
  assert.equal(world.material[idx], CellMaterial.VOID);
});

test("Contested Void: difficulty levels 1-10 scale contest holdback as 1s / voidDifficulty", () => {
  for (const s of SCENARIOS) {
    assert.ok((s.voidDifficulty ?? 0) >= 1 && (s.voidDifficulty ?? 0) <= 10, `${s.id} has difficulty 1..10`);
  }
  assert.equal(getScenario("tutorialBreach").voidDifficulty, 1);
  assert.equal(getScenario("endless").voidDifficulty, 10);
  assert.equal(contestHoldTicksForDifficulty(1), 30);
  assert.equal(contestHoldTicksForDifficulty(2), 15);
  assert.equal(contestHoldTicksForDifficulty(5), 6);
  assert.equal(contestHoldTicksForDifficulty(10), 3);

  const bossScenario = {
    ...getScenario("endless"),
    worldW: 16,
    worldH: 16,
    portals: [{ xFrac: 0.5, yFrac: 0.5, radius: 1, activateAtSeconds: 0 }],
  };
  const bossWorld = new VoidWorld(bossScenario);
  const bossPhysics = new VoidPhysics();
  bossWorld.material.fill(CellMaterial.STREET);
  const idx = bossWorld.grid.index(4, 4);
  bossPhysics.consumeCellIntoVoid(bossWorld, idx, false);
  const bossField = new VoidField(bossWorld, bossScenario);
  assert.equal(bossField.contestHoldTicks, 3);
  assert.equal(bossField.removeVoidPixel(bossWorld, idx), true);
  for (let t = 0; t < 3; t++) {
    bossField.step(bossWorld, bossPhysics, bossScenario, t + 1, 1 / 30, {
      wallResistanceMultiplier: 1,
      perimeterResonanceBonus: 0,
    });
  }
  assert.equal(bossField.contestedCells.has(idx), false, "difficulty 10 fades in 3 ticks (0.1s)");
});

test("Contested Void: rocketeers deploy from rocketTeam and remove an area of Void pixels", () => {
  assert.equal(TOWER_SPECS.rocketTeam.removesVoid, true);
  assert.ok((TOWER_SPECS.rocketTeam.voidRemovalRadius ?? 0) > 0);

  const wallet = emptyTechWallet();
  wallet.ranks.rocketTeamUnlock = 1;
  const sim = new VoidSim("tutorialBreach", "buildAndWatch", wallet, true);
  const { world, voidField } = sim;

  const fCell = voidField.frontierCells[0];
  const fx = world.grid.xOf(fCell);
  const fy = world.grid.yOf(fCell);

  const bx = Math.max(4, Math.min(world.grid.w - 10, fx + 6));
  const by = Math.max(4, Math.min(world.grid.h - 10, fy));
  for (let y = by; y < by + 6; y++) {
    for (let x = bx; x < bx + 6; x++) {
      const idx = world.grid.index(x, y);
      world.material[idx] = CellMaterial.STREET;
      world.hp[idx] = 40;
      world.maxHp[idx] = 40;
      world.buildingAt[idx] = -1;
      world.columnFloors[idx] = 0;
    }
  }

  sim.supplies = 500;
  const battery = sim.placeTower("rocketTeam", bx, by);
  assert.ok(battery, "Rocket Battery placed");
  const rocketeers = sim.combat.agents.filter((a) => a.homeUid === battery.uid && a.kind === "rocketeer");
  assert.ok(rocketeers.length >= 2, `Expected rocketeers deployed, got ${rocketeers.length}`);
  sim.setTowerFocus(battery.uid, fx, fy);

  voidField.suppressedSeconds = 10;
  sim.startBattle();
  for (let t = 0; t < 180; t++) {
    sim.stepOneTick();
  }

  let emptyCount = 0;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.material[i] === CellMaterial.EMPTY) emptyCount++;
  }
  assert.ok(emptyCount >= 3, `Expected rocketeer area attacks to remove multiple Void pixels, got ${emptyCount}`);
});

test("Contested Void: laser guns declare removesVoid=true (1 px) and remove Void into empty space in live sim", () => {
  assert.equal(TOWER_SPECS.infantryBarracks.removesVoid, true);
  assert.equal(TOWER_SPECS.infantryBarracks.voidRemovalAmount, 1);
  assert.equal(TOWER_SPECS.heavyMechBay.removesVoid, true);
  assert.equal(TOWER_SPECS.heavyMechBay.voidRemovalAmount, 1);
  assert.notEqual(TOWER_SPECS.matterCannon.removesVoid, true);

  const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
  const { world, voidField } = sim;

  // Find a frontier cell near the active portal to place an Infantry Barracks nearby
  assert.ok(voidField.frontierCells.length > 0);
  const fCell = voidField.frontierCells[0];
  const fx = world.grid.xOf(fCell);
  const fy = world.grid.yOf(fCell);

  // Clear a safe build pad 6 pixels away from the frontier
  const bx = Math.max(4, Math.min(world.grid.w - 10, fx + 6));
  const by = Math.max(4, Math.min(world.grid.h - 10, fy));
  for (let y = by; y < by + 6; y++) {
    for (let x = bx; x < bx + 6; x++) {
      const idx = world.grid.index(x, y);
      world.material[idx] = CellMaterial.STREET;
      world.hp[idx] = 40;
      world.maxHp[idx] = 40;
      world.buildingAt[idx] = -1;
      world.columnFloors[idx] = 0;
    }
  }

  sim.supplies = 500;
  const barracks = sim.placeTower("infantryBarracks", bx, by);
  assert.ok(barracks, "Infantry Barracks placed near frontier");
  sim.setTowerFocus(barracks.uid, fx, fy);

  // Suppress Void expansion briefly so empty pixels created by riflemen remain visible
  voidField.suppressedSeconds = 10;
  sim.startBattle();

  for (let t = 0; t < 180; t++) {
    sim.stepOneTick();
  }

  let emptyCount = 0;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.material[i] === CellMaterial.EMPTY) emptyCount++;
  }
  assert.ok(emptyCount >= 1, `Expected laser riflemen to remove at least 1 Void pixel into EMPTY, got ${emptyCount}`);
});
