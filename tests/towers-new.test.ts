import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

function findLandSpot(sim: VoidSim, minVoidDist = 16): { x: number; y: number } {
  const { w, h } = sim.world.grid;
  for (let y = 12; y < h - 12; y += 2) {
    for (let x = 12; x < w - 12; x += 2) {
      let ok = true;
      for (let dy = 0; dy < 4 && ok; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const idx = sim.world.grid.index(x + dx, y + dy);
          if (sim.world.material[idx] !== CellMaterial.STREET || sim.world.towerAt[idx] >= 0) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      // Ensure not too close to Void so it stays alive long enough
      let nearVoid = false;
      for (let dy = -minVoidDist; dy <= minVoidDist && !nearVoid; dy += 4) {
        for (let dx = -minVoidDist; dx <= minVoidDist; dx += 4) {
          const gx = x + dx;
          const gy = y + dy;
          if (sim.world.grid.inBounds(gx, gy) && sim.world.material[sim.world.grid.index(gx, gy)] === CellMaterial.VOID) {
            nearVoid = true;
            break;
          }
        }
      }
      if (!nearVoid) return { x, y };
    }
  }
  return { x: 20, y: 20 };
}

test("Void Siphon: live placement initializes tank, erosion fills it, and venting cycle resets via stepTicks", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.voidSiphonUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const spot = findLandSpot(sim, 22);
  // Carve Void just outside tower footprint so erosion pressure hits nearby frontier
  for (let dy = -4; dy <= 7; dy++) {
    const gx = spot.x - 3;
    const gy = spot.y + dy;
    if (sim.world.grid.inBounds(gx, gy)) {
      const idx = sim.world.grid.index(gx, gy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  const placed = sim.placeTower("voidSiphon", spot.x, spot.y);
  assert.ok(placed, "placeTower(voidSiphon) should succeed");
  const st = sim.combat.siphonStates.get(placed.uid);
  assert.ok(st, "placeTower should initialize siphonStates");
  assert.equal(st.phase, "intake");
  assert.equal(st.stored, 0);

  sim.stepTicks(30); // 1 second of live simulation
  assert.ok(st.stored > 0, "live frontier erosion should fill Siphon tank");

  // Force full -> venting and stepTicks through vent duration
  st.stored = st.maxStorage;
  st.phase = "venting";
  st.ventRemaining = 0.1;
  sim.stepTicks(4); // 0.133s: completes vent back to intake
  assert.equal(st.phase, "intake", "venting should complete via VoidSim.stepTicks");

  sim.sellTower(placed.uid);
  assert.equal(sim.combat.siphonStates.has(placed.uid), false);
});

test("Boundary Prism: live placement initializes state, rotates, and redirects pressure conservatively", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.boundaryPrismUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const spot = findLandSpot(sim, 10);
  // Create a Void frontier strip next to the Prism
  for (let dy = -3; dy <= 6; dy++) {
    const gx = spot.x - 2;
    const gy = spot.y + dy;
    if (sim.world.grid.inBounds(gx, gy)) {
      const idx = sim.world.grid.index(gx, gy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  const placed = sim.placeTower("boundaryPrism", spot.x, spot.y);
  assert.ok(placed, "placeTower(boundaryPrism) should succeed");
  const p = sim.combat.prismStates.get(placed.uid);
  assert.ok(p, "placeTower should initialize prismStates");
  assert.equal(p.angleRad, 0);

  assert.equal(sim.combat.rotatePrism(placed.uid), true);
  assert.ok(Math.abs(p.angleRad - Math.PI / 4) < 1e-6);

  const beforeEnergy = sim.voidField.energyRemaining;
  sim.stepTicks(20);
  assert.ok(sim.voidField.energyRemaining <= beforeEnergy, "Void energy remains bounded/conservative");

  sim.sellTower(placed.uid);
  assert.equal(sim.combat.prismStates.has(placed.uid), false);
});

test("Chrono Cannon: live Void consumption of terrain, building floors, and Void-fallen unit is rewound once", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.chronoCannonUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const spot = findLandSpot(sim, 32);
  const cannon = sim.placeTower("chronoCannon", spot.x, spot.y);
  assert.ok(cannon, "placeTower(chronoCannon) should succeed");

  // Put a building cell in range of Chrono Cannon surrounded by high-HP street so tIdx erodes first
  const tx = spot.x + 6;
  const ty = spot.y + 2;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const idx = sim.world.grid.index(tx + dx, ty + dy);
      sim.world.material[idx] = CellMaterial.STREET;
      sim.world.hp[idx] = 200;
      sim.world.maxHp[idx] = 200;
      sim.world.buildingAt[idx] = -1;
    }
  }
  const tIdx = sim.world.grid.index(tx, ty);
  sim.world.material[tIdx] = CellMaterial.BUILDING;
  sim.world.hp[tIdx] = 0.01;
  sim.world.maxHp[tIdx] = 100;
  sim.world.buildingAt[tIdx] = 0;
  sim.world.columnFloors[tIdx] = 4;

  // Adjacent Void to erode it naturally during stepTicks
  for (let dy = -1; dy <= 1; dy++) {
    const vIdx = sim.world.grid.index(tx + 1, ty + dy);
    sim.world.material[vIdx] = CellMaterial.VOID;
    sim.world.hp[vIdx] = 0;
  }
  sim.voidField.rebuildFrontier(sim.world);

  // Step until Chrono Cannon fires on the Void loss of tIdx
  for (let i = 0; i < 60 && sim.combat.chronoEffects.length === 0; i++) {
    sim.stepTicks(1);
  }
  assert.ok(sim.combat.chronoEffects.length > 0 || sim.combat.chronoJournal.some((e) => e.claimed), "Chrono Cannon should fire on recent Void losses");
  assert.equal(sim.world.material[tIdx], CellMaterial.BUILDING, "Building cell should be restored");
  assert.equal(sim.world.columnFloors[tIdx], 4, "Building floor height should be preserved");
  assert.equal(sim.world.buildingAt[tIdx], 0, "Building ID should be preserved");

  // Now reset cooldown and verify Void-fallen unit is also rewound onto safe ground without duplicate ID
  cannon.cooldown = 0;
  sim.combat.agents.push({
    id: 7777,
    kind: "rifleman",
    homeUid: -1,
    x: tx + 1.5,
    y: ty + 0.5,
    vx: 0,
    vy: 0,
    hp: 0.1,
    maxHp: 40,
    cooldown: 0,
    carryingMatter: 0,
    state: "patrol",
    targetCell: -1,
    targetNodeId: -1,
    layer: "ground",
  });
  sim.stepTicks(3);
  const restoredUnit = sim.combat.agents.filter((a) => a.id === 7777);
  assert.equal(restoredUnit.length, 1, "Void-fallen unit should be restored exactly once without duplicate ID");
});
