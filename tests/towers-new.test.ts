import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Void Siphon: state initialization, venting cycle, and cleanup", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const tower = {
    uid: 9001,
    type: "voidSiphon" as const,
    x: 20,
    y: 20,
    w: 4,
    h: 4,
    hp: 140,
    maxHp: 140,
    cooldown: 0,
    targetMode: "nearest" as const,
  };
  sim.combat.initTowerSpecialState(tower);
  const s = sim.combat.siphonStates.get(9001);
  assert.ok(s);
  assert.equal(s.phase, "intake");

  s.phase = "venting";
  s.stored = s.maxStorage;
  s.ventRemaining = 4.0;
  sim.combat.stepSiphonTimers(2.0);
  assert.equal(s.phase, "venting");
  assert.equal(s.ventRemaining, 2.0);

  sim.combat.stepSiphonTimers(2.0);
  assert.equal(s.phase, "intake");
  assert.equal(s.stored, 0);

  sim.combat.clearTowerSpecialState(9001);
  assert.equal(sim.combat.siphonStates.has(9001), false);
});

test("Boundary Prism: directional orientation and rotation", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const tower = {
    uid: 9002,
    type: "boundaryPrism" as const,
    x: 30,
    y: 30,
    w: 4,
    h: 4,
    hp: 130,
    maxHp: 130,
    cooldown: 0,
    targetMode: "nearest" as const,
  };
  sim.combat.initTowerSpecialState(tower);
  const p = sim.combat.prismStates.get(9002);
  assert.ok(p);
  assert.equal(p.angleRad, 0);
  assert.equal(sim.combat.rotatePrism(9002), true);
  assert.ok(Math.abs(p.angleRad - Math.PI / 4) < 1e-6);
  sim.combat.clearTowerSpecialState(9002);
  assert.equal(sim.combat.prismStates.has(9002), false);
});

test("Chrono Cannon: bounded journal, 6s window, and single-use transactional recovery", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const cx = 40;
  const cy = 40;
  const idx = sim.world.grid.index(cx, cy);
  sim.world.material[idx] = CellMaterial.VOID;

  const cannon = {
    uid: 9003,
    type: "chronoCannon" as const,
    x: cx + 2,
    y: cy + 2,
    w: 4,
    h: 4,
    hp: 150,
    maxHp: 150,
    cooldown: 0,
    targetMode: "nearest" as const,
  };
  sim.combat.towers.push(cannon);

  // Record an expired loss (t = 1s) and a recent loss (t = 10s)
  sim.combat.recordChronoLoss(1.0, "terrain", cx, cy, idx, CellMaterial.STREET, 100);
  sim.combat.recordChronoLoss(10.0, "terrain", cx, cy, idx, CellMaterial.STREET, 100);

  const restored = sim.combat.stepChronoCannons(sim.world, sim.voidField, 0.1, 12.0);
  assert.equal(restored, 1);
  assert.equal(sim.world.material[idx], CellMaterial.STREET);
  assert.equal(sim.combat.chronoJournal[1].claimed, true);

  // Second pass must not double-claim the same event
  cannon.cooldown = 0;
  const restoredAgain = sim.combat.stepChronoCannons(sim.world, sim.voidField, 0.1, 12.1);
  assert.equal(restoredAgain, 0);
});
