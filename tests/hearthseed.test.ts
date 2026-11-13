import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial, LandCover } from "../src/void/model.ts";
import { VoidPhysics } from "../src/void/physics.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Hearthseed: monotonic nested footprint, deterministic planting, and no historical building resurrection", () => {
  const baseSim = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  const cx = Math.floor(baseSim.world.grid.w / 2);
  const cy = Math.floor(baseSim.world.grid.h / 2);
  for (let dy = -16; dy <= 16; dy++) {
    for (let dx = -16; dx <= 16; dx++) {
      baseSim.world.material[baseSim.world.grid.index(cx + dx, cy + dy)] = CellMaterial.VOID;
    }
  }
  const testIdx = baseSim.world.grid.index(cx, cy);

  const counts: number[] = [];
  const sets: Set<number>[] = [];

  for (let rank = 0; rank <= 3; rank++) {
    const wallet = emptyTechWallet();
    wallet.ranks.commandCore = 1;
    wallet.ranks.landfallPayload = rank;
    const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
    const w = sim.world;
    for (let dy = -16; dy <= 16; dy++) {
      for (let dx = -16; dx <= 16; dx++) {
        const idx = w.grid.index(cx + dx, cy + dy);
        w.material[idx] = CellMaterial.VOID;
        w.landCover[idx] = LandCover.NONE;
      }
    }

    // Mark one Void cell as having been a baseline building cell to verify new-land mode does NOT restore it
    w.material[testIdx] = CellMaterial.VOID;
    w.isBaselineCell[testIdx] = 1;
    w.originalMaterial[testIdx] = CellMaterial.BUILDING;
    w.originalBuildingAt[testIdx] = 0;

    const ok = sim.castStrike("landfall", cx, cy);
    assert.equal(ok, true, `rank ${rank} castStrike(landfall) should succeed`);

    // Verify no historical building was resurrected
    assert.equal(w.material[testIdx], CellMaterial.RECLAIMED);
    assert.equal(w.buildingAt[testIdx], -1);

    const s = new Set<number>();
    let hasForest = false;
    let hasField = false;
    for (let i = 0; i < w.grid.count; i++) {
      if (w.material[i] === CellMaterial.RECLAIMED && baseSim.world.material[i] === CellMaterial.VOID) {
        s.add(i);
        if (w.landCover[i] === LandCover.FOREST) hasForest = true;
        if (w.landCover[i] === LandCover.FIELD_H || w.landCover[i] === LandCover.FIELD_V) hasField = true;
      }
    }
    counts.push(s.size);
    sets.push(s);

    if (rank >= 1) {
      assert.ok(hasForest, `rank ${rank} should create FOREST cover`);
    }
    if (rank >= 2) {
      assert.ok(hasField, `rank ${rank} should create FIELD_H or FIELD_V cover`);
    }
    assert.notEqual(w.landCover[testIdx], LandCover.NONE, `rank ${rank} should set landCover`);
  }

  for (let r = 1; r <= 3; r++) {
    assert.ok(counts[r] > counts[r - 1], `rank ${r} area (${counts[r]}) > rank ${r - 1} (${counts[r - 1]})`);
    for (const idx of sets[r - 1]) {
      assert.ok(sets[r].has(idx), `rank ${r} footprint should nest rank ${r - 1}`);
    }
  }
});

test("Hearthseed: no-op cast on intact land spends no supplies or cooldown, and edge casts clip safely", () => {
  const sim = new VoidSim("classicCore", "buildWatch", emptyTechWallet());
  const startSupplies = sim.supplies;

  // Find an intact street cell far from Void
  let intactX = -1;
  let intactY = -1;
  for (let y = 10; y < sim.world.grid.h - 10 && intactX < 0; y++) {
    for (let x = 10; x < sim.world.grid.w - 10; x++) {
      const idx = sim.world.grid.index(x, y);
      if (sim.world.material[idx] === CellMaterial.STREET) {
        let allIntact = true;
        for (let dy = -10; dy <= 10 && allIntact; dy++) {
          for (let dx = -10; dx <= 10; dx++) {
            const m = sim.world.material[sim.world.grid.index(x + dx, y + dy)];
            if (m === CellMaterial.VOID || m === CellMaterial.UNCLAIMED) allIntact = false;
          }
        }
        if (allIntact) {
          intactX = x;
          intactY = y;
          break;
        }
      }
    }
  }

  assert.ok(intactX >= 0, "found intact area");
  const okNoOp = sim.castStrike("landfall", intactX, intactY);
  assert.equal(okNoOp, false, "no-op cast on intact land should return false");
  assert.equal(sim.supplies, startSupplies, "no-op cast must not spend supplies");
  assert.equal(sim.combat.strikeCooldowns.landfall, 0, "no-op cast must not trigger cooldown");

  // Edge cast at (0, 0) where Void/UNCLAIMED exists
  sim.world.material[sim.world.grid.index(0, 0)] = CellMaterial.VOID;
  const okEdge = sim.castStrike("landfall", 0, 0);
  assert.equal(okEdge, true, "edge cast with eligible Void cell should succeed");
  assert.ok(sim.supplies < startSupplies, "valid cast spends supplies");
  assert.ok(sim.combat.strikeCooldowns.landfall > 0, "valid cast triggers cooldown");
});
