import assert from "node:assert/strict";
import test from "node:test";
import { wheatLean } from "../src/void/farms.ts";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import { elevationOf, BuildingSpriteCache } from "../src/void/elevation.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

function field() {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet(), true);
  const w = sim.world;
  for (let y = 65; y <= 85; y++) for (let x = 65; x <= 95; x++) {
    const i = w.grid.index(x, y);
    w.material[i] = CellMaterial.PARK; w.hp[i] = w.maxHp[i] = 60;
    w.buildingAt[i] = -1; w.columnFloors[i] = 0; w.towerAt[i] = -1;
    w.landCover[i] = LandCover.FIELD_H; w.wheatCells.add(i);
  }
  sim.voidField.rebuildFrontier(w);
  return sim;
}

test("energy fire: actual infantry fire ignites crops, pause freezes fire, and burning leaves soil", () => {
  const sim = field(), w = sim.world;
  const post = sim.placeTower("infantryBarracks", 66, 70);
  assert.ok(post);
  sim.combat.organisms.push({ id: 9000, kind: "honeycombCrystal", x: 88, y: 72, vx: 0, vy: 0, hp: 10000, maxHp: 10000, targetX: 88, targetY: 72, cooldown: 100 });
  sim.stepTicks(20);
  assert.ok(sim.farms.active.size > 0, "live weapon path ignites fields");
  const [idx, fire] = [...sim.farms.active][0];
  const age = fire.age;
  sim.paused = true; sim.advanceFrame(0.2);
  assert.equal(fire.age, age);
  sim.paused = false;
  sim.combat.organisms.length = 0;
  sim.combat.agents.length = 0;
  sim.stepTicks(260);
  assert.equal(sim.farms.scorch[idx], 2);
  assert.notEqual(w.material[idx], CellMaterial.VOID, "crop fire leaves real soil");
  assert.ok(sim.farms.active.size <= 512);
});

test("staples do not ignite; deterministic fire spreads locally and stops at gaps/Void", () => {
  const a = field(), b = field();
  const idx = a.world.grid.index(75, 75);
  a.farms.igniteBeam({ x0: 70, y0: 75, x1: 80, y1: 75, ttl: 0.2, color: "orange" });
  assert.equal(a.farms.active.size, 0);
  for (const sim of [a, b]) {
    sim.world.material[idx + 1] = CellMaterial.VOID;
    sim.farms.ignite(idx);
    for (let t = 0; t < 180; t++) sim.farms.step(1 / 30, []);
    assert.equal(sim.farms.scorch[idx + 1], 0);
    assert.ok(sim.farms.active.size > 0, "fire propagates through neighboring wheat");
  }
  assert.deepEqual(a.farms.scorch, b.farms.scorch);
});

test("farm structures use raised roofs/facades and burn into ruins, never artificial Void", () => {
  const sim = field(), w = sim.world;
  const farm = w.buildings.find(b => b.district === "rural" && b.cells.some(i => w.material[i] !== CellMaterial.VOID));
  assert.ok(farm);
  const i = farm.cells.find(i => w.buildingAt[i] === farm.id)!;
  assert.ok(i >= 0);
  assert.ok(elevationOf(farm, "full") >= 2);
  assert.equal(elevationOf(farm, "flat"), 0);
  const cache = new BuildingSpriteCache();
  const before = cache.getSprite(w, farm, "full");
  assert.ok(before.h > farm.h);
  w.hp[i] = 20;
  sim.farms.ignite(i);
  for (let t = 0; t < 80; t++) sim.farms.step(1 / 30, []);
  assert.equal(w.material[i], CellMaterial.SALVAGE);
  assert.equal(w.buildingAt[i], -1);
  assert.equal(w.columnFloors[i], 0);
  assert.notEqual(cache.getSprite(w, farm, "full").signature, before.signature);
});

test("wheat gusts vary over time and part away from nearby people", () => {
  assert.notEqual(wheatLean(10, 10, 0, []), wheatLean(10, 10, 1, []));
  assert.ok(wheatLean(10, 10, 0, [{ x: 9, y: 10 }]) > wheatLean(10, 10, 0, []));
  assert.ok(wheatLean(10, 10, 0, [{ x: 11, y: 10 }]) < wheatLean(10, 10, 0, []));
});
