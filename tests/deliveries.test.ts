import assert from "node:assert/strict";
import test from "node:test";
import { PARKING_STREET_TIER, TICK_HZ } from "../src/void/config.ts";
import { deliveryPayout } from "../src/void/deliveries.ts";
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

  sim.stepTicks(TICK_HZ * 3);
  assert.equal(sim.supplies, paid + route.payout);
  assert.equal(sim.deliveries.arrivals.at(-1)?.amount, route.payout);
  assert.equal(sim.deliveries.arrivals.at(-1)?.y, y);

  for (let py = 0; py < world.grid.h; py++) {
    const idx = world.grid.index(78, py);
    world.material[idx] = CellMaterial.VOID;
    world.hp[idx] = 0;
  }
  sim.stepTicks(TICK_HZ * 8);
  assert.equal(route.path, null);
  assert.equal(sim.supplies, paid + route.payout, "A broken trip never pays");

  const restored = world.grid.index(78, y);
  world.material[restored] = CellMaterial.RECLAIMED;
  world.hp[restored] = world.maxHp[restored];
  sim.stepTicks(TICK_HZ * 10);
  assert.ok(sim.supplies > paid + route.payout, "Repairing the road lets deliveries resume");
  b.hp = 0;
  sim.stepTicks(1);
  assert.equal(sim.deliveries.routes.length, 0, "Losing a depot removes its truck");
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
