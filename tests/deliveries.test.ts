import assert from "node:assert/strict";
import test from "node:test";
import { PARKING_STREET_TIER, TICK_HZ } from "../src/void/config.ts";
import { deliveryPayout, depotLinks, depotSpeedMultiplier, depotTargetCount } from "../src/void/deliveries.ts";
import type { PlacedTower } from "../src/void/model.ts";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Delivery depots earn Supplies on arrival and stop paying when a street is severed", () => {
  const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
  const { world } = sim;
  const y = 285;
  // Isolate a straight delivery corridor with two build pads in intact city terrain.
  for (let py = y - 10; py <= y + 15; py++) {
    for (let x = 35; x <= 140; x++) {
      const idx = world.grid.index(x, py);
      world.material[idx] = py === y ? CellMaterial.STREET : CellMaterial.PARK;
      world.buildingAt[idx] = -1;
      world.columnFloors[idx] = 0;
      world.hp[idx] = world.maxHp[idx] = 40;
      world.streetTier[idx] = py === y ? 1 : 0;
    }
  }

  assert.equal(sim.placeTower("deliveryDepot", 48, y + 2), null);
  const a = sim.placeTower("deliveryDepot", 48, y + 1);
  const b = sim.placeTower("deliveryDepot", 110, y + 1);
  assert.ok(a && b);
  const paid = sim.supplies;
  sim.voidField.suppressedSeconds = 80;
  sim.startBattle();
  sim.stepTicks(TICK_HZ * 5);
  assert.equal(sim.supplies, paid, "Loading does not generate income");
  const route = sim.deliveries.routeFor(a.uid);
  assert.ok(route?.path);
  assert.equal(route.payout, deliveryPayout(62));

  // Each depot sends its own car to the other (its furthest depot); both loaded arrivals pay.
  assert.equal(sim.deliveries.routes.length, 2);
  sim.stepTicks(TICK_HZ * 3);
  assert.equal(sim.supplies, paid + route.payout * 2);
  assert.equal(sim.deliveries.arrivals.at(-1)?.amount, route.payout);
  assert.equal(sim.deliveries.arrivals.at(-1)?.y, y);

  for (let py = 0; py < world.grid.h; py++) {
    const idx = world.grid.index(78, py);
    world.material[idx] = CellMaterial.VOID;
    world.hp[idx] = 0;
  }
  sim.stepTicks(TICK_HZ * 8);
  assert.equal(route.path, null);
  assert.equal(sim.supplies, paid + route.payout * 2, "A broken trip never pays");

  const restored = world.grid.index(78, y);
  world.material[restored] = CellMaterial.RECLAIMED;
  world.hp[restored] = world.maxHp[restored];
  sim.stepTicks(TICK_HZ * 10);
  assert.ok(sim.supplies > paid + route.payout * 2, "Repairing the road lets deliveries resume");
  b.hp = 0;
  sim.stepTicks(1);
  assert.equal(sim.deliveries.routes.length, 0, "Losing a depot removes its cars");
});

test("Longer deliveries pay progressively more and generated parking is drivable", () => {
  const a = deliveryPayout(40);
  const b = deliveryPayout(100);
  const c = deliveryPayout(160);
  assert.ok(b > a);
  assert.ok(c - b > b - a);
  const { world } = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  let parking = 0;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.streetTier[i] === PARKING_STREET_TIER) {
      assert.equal(world.material[i], CellMaterial.STREET);
      parking++;
    }
  }
  assert.ok(parking >= 120);
});

const depot = (uid: number, x: number, y: number, level = 1): PlacedTower =>
  ({ uid, type: "deliveryDepot", x, y, w: 6, h: 6, hp: 100, level } as unknown as PlacedTower);

test("Depots deliver to their furthest depots: 1, then 2, then 3 with upgrades", () => {
  const a = depot(1, 0, 0);
  const b = depot(2, 40, 0);
  const c = depot(3, 100, 0);
  const d = depot(4, 200, 0);
  const targets = (from: PlacedTower, all: PlacedTower[]) =>
    depotLinks(all).filter((l) => l.from === from).map((l) => l.to.uid);
  assert.deepEqual(targets(a, [a, b]), [2]);
  assert.deepEqual(targets(a, [a, b, c, d]), [4], "Base depot links only to the single furthest depot");
  assert.deepEqual(targets(c, [a, b, c, d]), [1]);
  a.level = 2;
  assert.deepEqual(targets(a, [a, b, c, d]), [4, 3], "First upgrade adds the second furthest");
  a.level = 3;
  assert.deepEqual(targets(a, [a, b, c, d]), [4, 3, 2], "Second upgrade adds the third furthest");
  assert.deepEqual(targets(a, [a, b]), [2], "Never more links than other depots");
  d.hp = 0;
  assert.deepEqual(targets(a, [a, b, c, d]), [3, 2], "Destroyed depots drop out of the link set");
  assert.equal(depotTargetCount(undefined), 1);
  assert.equal(depotSpeedMultiplier(1), 1);
  assert.equal(depotSpeedMultiplier(2), 1);
  assert.equal(depotSpeedMultiplier(3), 3);
});

test("Placing a new furthest depot relinks existing depots", () => {
  const a = depot(1, 0, 0);
  const b = depot(2, 50, 0);
  const keys = (all: PlacedTower[]) => depotLinks(all).map((l) => l.key).sort();
  assert.deepEqual(keys([a, b]), ["1>2", "2>1"]);
  const c = depot(3, 150, 0);
  assert.deepEqual(keys([a, b, c]), ["1>3", "2>3", "3>1"]);
});

test("Street paths across open pavement take one turn, and cars glide between ticks on one lane", async () => {
  const { findStreetPath } = await import("../src/void/street-routes.ts");
  const { deliveryCarPose } = await import("../src/void/deliveries.ts");
  const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
  const { world } = sim;
  for (let py = 200; py < 240; py++) {
    for (let x = 40; x < 80; x++) {
      const idx = world.grid.index(x, py);
      world.material[idx] = CellMaterial.STREET;
      world.streetTier[idx] = 1;
      world.towerAt[idx] = -1;
    }
  }
  const path = findStreetPath(world, 42, 202, 77, 237);
  assert.ok(path);
  assert.equal(path.length, 35 + 35 + 1, "still a shortest route");
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    if (path[i].x - path[i - 1].x !== path[i - 1].x - path[i - 2].x) turns++;
  }
  assert.equal(turns, 1, "no staircase jogs across open pavement");

  const route = {
    key: "1>2", from: {} as PlacedTower, to: {} as PlacedTower, path, progress: 10, reverse: false,
    retryAt: 0, holdUntil: 0, payout: 0, x: 0, y: 0, dx: 0, dy: 0, head: 10, rate: 3,
  };
  const poses = [0, 0.34, 0.67, 0.99].map((f) => deliveryCarPose(world, route, f)!);
  assert.deepEqual(poses.map((p) => p.idx), [10, 11, 12, 12], "the car advances by wall time inside a tick");
  assert.ok(poses.every((p) => p.ox === poses[0].ox && p.oy === poses[0].oy), "the 2-wide car keeps its lane on a straight");
});
