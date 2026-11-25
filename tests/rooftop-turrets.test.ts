import assert from "node:assert/strict";
import test from "node:test";
import { roofCellUnderPointer, towerRoofElevation } from "../src/void/elevation.ts";
import { CellMaterial, type MetroBuilding } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";
import {
  ROOF_COLLAPSE_DAMAGE,
  ROOFTOP_RANGE_MULT,
  STREET_LEVEL_TOWERS,
  TOWER_SPECS,
  canMountOnRoof,
  footprintBuilding,
  towerRange,
} from "../src/void/towers.ts";

function newSim(): VoidSim {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  sim.stepTicks(5);
  sim.supplies = 100000;
  return sim;
}

/** A building whose whole bounding box is intact roof, big enough for a 6x6 footprint. */
function solidBuilding(sim: VoidSim, min = TOWER_SPECS.matterCannon.w + 2): MetroBuilding {
  const { world } = sim;
  for (const b of world.buildings) {
    if (!b || b.w < min || b.h < min || b.height < 4) continue;
    let solid = true;
    for (let y = b.y; y < b.y + b.h && solid; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const idx = world.grid.index(x, y);
        if (world.buildingAt[idx] !== b.id || world.towerAt[idx] >= 0 || world.material[idx] === CellMaterial.VOID ||
          (world.columnFloors && world.columnFloors[idx] <= 0)) {
          solid = false;
          break;
        }
      }
    }
    if (solid) return b;
  }
  throw new Error("no solid building on the map");
}

test("street-level set covers unit, delivery and ground structures; everything else is a turret", () => {
  for (const t of ["deliveryDepot", "infantryBarracks", "repairDepot", "constructorHub", "heavyMechBay", "rocketTeam"] as const) {
    assert.ok(STREET_LEVEL_TOWERS.has(t), `${t} should be street level`);
    assert.equal(canMountOnRoof(t), false);
  }
  for (const t of ["matterCannon", "chronoCannon", "gravityAnchor", "shieldProjector", "countervoidHeart"] as const) {
    assert.ok(canMountOnRoof(t), `${t} should mount on roofs`);
  }
});

test("turrets can be placed on a rooftop and gain range; infantry and depots cannot", () => {
  const sim = newSim();
  const b = solidBuilding(sim);
  const x = b.x + 1;
  const y = b.y + 1;
  assert.equal(footprintBuilding(sim.world, x, y, TOWER_SPECS.matterCannon.w, TOWER_SPECS.matterCannon.h), b.id);
  assert.equal(sim.combat.canPlaceTower(sim.world, "infantryBarracks", x, y), false, "barracks never go on a roof");
  assert.equal(sim.combat.canPlaceTower(sim.world, "deliveryDepot", x, y), false, "depots never go on a roof");
  const cannon = sim.placeTower("matterCannon", x, y);
  assert.ok(cannon, "a matter cannon fits on the roof");
  assert.equal(cannon.roofBuildingId, b.id);
  assert.equal(towerRange(cannon), TOWER_SPECS.matterCannon.range * ROOFTOP_RANGE_MULT);
  assert.ok(towerRoofElevation(sim.world, cannon, "full") > 0, "a rooftop turret stands above the street");
  assert.equal(towerRoofElevation(sim.world, cannon, "flat"), 0);
});

test("a footprint straddling a roof edge is rejected for every structure", () => {
  const sim = newSim();
  const b = solidBuilding(sim);
  const spec = TOWER_SPECS.matterCannon;
  const x = b.x - Math.floor(spec.w / 2);
  const y = b.y + 1;
  assert.equal(footprintBuilding(sim.world, x, y, spec.w, spec.h), -2);
  assert.equal(sim.combat.canPlaceTower(sim.world, "matterCannon", x, y), false);
});

test("a street-level turret keeps its normal range", () => {
  const sim = newSim();
  const { world } = sim;
  const spec = TOWER_SPECS.matterCannon;
  let placed = null;
  for (let y = 4; y < world.grid.h - 12 && !placed; y += 3) {
    for (let x = 4; x < world.grid.w - 12 && !placed; x += 3) {
      if (footprintBuilding(world, x, y, spec.w, spec.h) === -1 && sim.combat.canPlaceTower(world, "matterCannon", x, y)) {
        placed = sim.placeTower("matterCannon", x, y);
      }
    }
  }
  assert.ok(placed, "found open ground for a matter cannon");
  assert.equal(placed.roofBuildingId, undefined);
  assert.equal(towerRange(placed), spec.range);
});

test("a rooftop turret crashes to the street, damaged, when its roof gives way", () => {
  const sim = newSim();
  const b = solidBuilding(sim);
  const cannon = sim.placeTower("matterCannon", b.x + 1, b.y + 1);
  assert.ok(cannon);
  sim.phase = "battle";
  for (let y = cannon.y; y < cannon.y + cannon.h; y++) {
    for (let x = cannon.x; x < cannon.x + cannon.w; x++) {
      const idx = sim.world.grid.index(x, y);
      sim.world.buildingAt[idx] = -1;
      if (sim.world.columnFloors) sim.world.columnFloors[idx] = 0;
      sim.world.material[idx] = CellMaterial.STREET;
    }
  }
  sim.stepTicks(1);
  const after = sim.combat.towers.find((t) => t.uid === cannon.uid);
  assert.ok(after, "the turret survives the fall");
  assert.equal(after.roofBuildingId, undefined);
  assert.ok(after.hp <= after.maxHp * (1 - ROOF_COLLAPSE_DAMAGE) + 1e-6, "the fall costs HP");
  assert.equal(towerRange(after), TOWER_SPECS.matterCannon.range);
});

test("pointing at a raised roof resolves to the footprint cell under it", () => {
  const sim = newSim();
  const b = solidBuilding(sim);
  const gx = b.x + Math.floor(b.w / 2);
  const gy = b.y + Math.floor(b.h / 2);
  const elev = towerRoofElevation(sim.world, { x: gx, y: gy, w: 1, h: 1, roofBuildingId: b.id }, "full");
  assert.ok(elev > 0);
  const hit = roofCellUnderPointer(sim.world, gx, gy - elev, "full");
  assert.ok(hit, "the pointer finds the roof");
  assert.equal(hit.buildingId, b.id);
  assert.equal(roofCellUnderPointer(sim.world, gx, gy - elev, "flat"), null);
});
