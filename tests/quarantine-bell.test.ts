import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Quarantine Bell: blocks cross-boundary edges in both directions, allows internal spread, and expires cleanly", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const cx = Math.floor(sim.world.grid.w / 2);
  const cy = Math.floor(sim.world.grid.h / 2);

  // Set up an intact island inside the seal with Void outside, and an internal Void pocket
  for (let dy = -14; dy <= 14; dy++) {
    for (let dx = -14; dx <= 14; dx++) {
      const idx = sim.world.grid.index(cx + dx, cy + dy);
      const d = Math.hypot(dx, dy);
      if (d <= 6) {
        sim.world.material[idx] = d <= 2 ? CellMaterial.VOID : CellMaterial.STREET;
        sim.world.hp[idx] = d <= 2 ? 0 : 100;
        sim.world.maxHp[idx] = 100;
      } else {
        sim.world.material[idx] = CellMaterial.VOID;
        sim.world.hp[idx] = 0;
      }
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  // Cast Quarantine Bell with radius 10 (pixels(10) = 20, or directly via addQuarantineSeal with radius 8)
  const seal = sim.voidField.addQuarantineSeal(sim.world, cx + 0.5, cy + 0.5, 8, 6.0);
  assert.equal(sim.voidField.quarantineSeals.length, 1);

  // Outside-to-inside and inside-to-outside crossings are blocked
  assert.equal(sim.voidField.isEdgeBlockedBySeal(cx + 0.5, cy + 0.5, cx + 10.5, cy + 0.5), true);
  assert.equal(sim.voidField.isEdgeBlockedBySeal(cx + 10.5, cy + 0.5, cx + 0.5, cy + 0.5), true);
  // Internal-to-internal is NOT blocked
  assert.equal(sim.voidField.isEdgeBlockedBySeal(cx + 0.5, cy + 0.5, cx + 3.5, cy + 0.5), false);

  // Advance 6.1 seconds so the seal expires
  for (let i = 0; i < 61; i++) {
    sim.voidField.step(sim.world, sim.physics, sim.scenario, 0.1, i + 1, 1.0, false);
  }
  assert.equal(sim.voidField.quarantineSeals.length, 0, "seal should expire after 6s");
  assert.equal(sim.voidField.isEdgeBlockedBySeal(cx + 0.5, cy + 0.5, cx + 10.5, cy + 0.5), false);
});

test("Quarantine Bell: overlapping seals use independent timers", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const cx = 50;
  const cy = 50;
  sim.voidField.addQuarantineSeal(sim.world, cx, cy, 8, 2.0);
  sim.voidField.addQuarantineSeal(sim.world, cx + 2, cy, 8, 5.0);
  assert.equal(sim.voidField.quarantineSeals.length, 2);

  for (let i = 0; i < 25; i++) {
    sim.voidField.step(sim.world, sim.physics, sim.scenario, 0.1, i + 1, 1.0, false);
  }
  assert.ok(sim.voidField.quarantineSeals.length <= 1, "first seal expired");
});
