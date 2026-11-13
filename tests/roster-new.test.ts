import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Seamwalker: frozen-Void cells hold and expire cleanly", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const idx = sim.world.grid.index(25, 25);
  sim.voidField.freezeVoidCell(idx, 2.0);
  assert.equal(sim.voidField.frozenVoidCells.has(idx), true);

  sim.voidField.stepRosterFields(sim.world, 1.0, []);
  assert.equal(sim.voidField.frozenVoidCells.has(idx), true);

  sim.voidField.stepRosterFields(sim.world, 1.5, []);
  assert.equal(sim.voidField.frozenVoidCells.has(idx), false);
});

test("Countervoid Heart: seeds friendly orange frontier and reclaims adjacent Void", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const cx = 30;
  const cy = 30;
  const nIdx = sim.world.grid.index(cx + 1, cy);
  sim.world.material[nIdx] = CellMaterial.VOID;
  sim.world.hp[nIdx] = 0;

  sim.voidField.stepRosterFields(sim.world, 0.1, [{ x: cx, y: cy, range: 16 }]);
  assert.ok(sim.voidField.countervoidCells.size >= 2);
  assert.equal(sim.world.material[nIdx], CellMaterial.RECLAIMED);
});

test("Lantern Bearer: unconditional footing over Void, overlap refcounting, and pre-existing terrain preservation", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const vx = 15;
  const vy = 15;
  const vIdx = sim.world.grid.index(vx, vy);
  const sIdx = sim.world.grid.index(vx + 1, vy);
  sim.world.material[vIdx] = CellMaterial.VOID;
  sim.world.material[sIdx] = CellMaterial.STREET;

  // Two overlapping bearers
  sim.voidField.applyLanternCoverage(sim.world, vx, vy, 2);
  sim.voidField.applyLanternCoverage(sim.world, vx, vy, 2);
  assert.equal(sim.world.material[vIdx], CellMaterial.RECLAIMED);
  assert.equal(sim.voidField.lanternRefCount[vIdx], 2);

  // First leaves -> still protected
  sim.voidField.releaseLanternCoverage(sim.world, vx, vy, 2);
  assert.equal(sim.world.material[vIdx], CellMaterial.RECLAIMED);
  assert.equal(sim.voidField.lanternRefCount[vIdx], 1);

  // Second leaves -> temporary Void footing reverts, pre-existing STREET remains intact
  sim.voidField.releaseLanternCoverage(sim.world, vx, vy, 2);
  assert.equal(sim.world.material[vIdx], CellMaterial.VOID);
  assert.equal(sim.world.material[sIdx], CellMaterial.STREET);
});
