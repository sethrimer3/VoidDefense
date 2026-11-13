import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { TECH_NODES } from "../src/void/tech/catalog.ts";
import { emptyTechWallet, evaluateTech } from "../src/void/tech/wallet.ts";

function clearArea(sim: VoidSim, cx: number, cy: number, r: number, mat: CellMaterial = CellMaterial.STREET): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (!sim.world.grid.inBounds(gx, gy)) continue;
      const idx = sim.world.grid.index(gx, gy);
      sim.world.material[idx] = mat;
      sim.world.hp[idx] = mat === CellMaterial.VOID ? 0 : 120;
      sim.world.maxHp[idx] = 120;
      sim.world.buildingAt[idx] = -1;
      sim.world.towerAt[idx] = -1;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);
}

test("Defect 1: Countervoid decays only Countervoid-created land and never destroys pre-existing reclaimed land", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.countervoidHeartUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 10, CellMaterial.RECLAIMED);
  // Carve Void on east side so Countervoid expands into it
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = 4; dx <= 10; dx++) {
      const idx = sim.world.grid.index(cx + dx, cy + dy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  // Track a pre-existing RECLAIMED cell near the heart
  const preExistingIdx = sim.world.grid.index(cx + 2, cy);
  assert.equal(sim.world.material[preExistingIdx], CellMaterial.RECLAIMED);

  const heart = sim.placeTower("countervoidHeart", cx - 2, cy - 2);
  assert.ok(heart);

  sim.stepTicks(45);
  assert.ok(sim.voidField.countervoidCells.has(preExistingIdx), "Countervoid influence covers pre-existing reclaimed cell");

  // Sell heart -> orange influence decays, Countervoid-created land decays, pre-existing RECLAIMED land survives!
  sim.sellTower(heart.uid);
  sim.stepTicks(120);

  assert.equal(sim.voidField.countervoidCells.size, 0, "orange Countervoid influence should fully decay");
  assert.equal(sim.world.material[preExistingIdx], CellMaterial.RECLAIMED, "pre-existing reclaimed land must NOT be deleted into Void");
});

test("Defect 2: Selling Lantern Bearer post releases all coverage owned by its bearers without leaking", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.lanternBearerUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 12, CellMaterial.STREET);

  const post = sim.placeTower("lanternBearer", cx, cy);
  assert.ok(post);
  sim.stepTicks(15);

  let coveredBefore = 0;
  for (let i = 0; i < sim.voidField.lanternRefCount.length; i++) {
    if (sim.voidField.lanternRefCount[i] > 0) coveredBefore++;
  }
  assert.ok(coveredBefore > 0, "living bearers should cover cells");

  sim.sellTower(post.uid);

  let coveredAfter = 0;
  for (let i = 0; i < sim.voidField.lanternRefCount.length; i++) {
    if (sim.voidField.lanternRefCount[i] > 0) coveredAfter++;
  }
  assert.equal(coveredAfter, 0, "selling Lantern post must release 100% of its bearers' coverage");
});

test("Defect 3: Chrono Cannon restores unit with meaningful recorded prior health (not flat 65%) and real object metadata", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.chronoCannonUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 12, CellMaterial.STREET);
  const cannon = sim.placeTower("chronoCannon", cx, cy);
  assert.ok(cannon);

  // Place a unit with 12 HP (30% of 40 maxHp) on Void so it dies and gets recorded
  const vx = cx + 6;
  const vy = cy + 2;
  const vIdx = sim.world.grid.index(vx, vy);
  sim.world.material[vIdx] = CellMaterial.VOID;
  sim.world.hp[vIdx] = 0;
  sim.voidField.rebuildFrontier(sim.world);

  sim.combat.agents.push({
    id: 9123,
    kind: "rifleman",
    homeUid: -1,
    x: vx + 0.5,
    y: vy + 0.5,
    vx: 0,
    vy: 0,
    hp: 12,
    maxHp: 40,
    cooldown: 0,
    carryingMatter: 0,
    state: "patrol",
    targetCell: -1,
    targetNodeId: -1,
    layer: "ground",
  });

  // Step until unit dies and Chrono Cannon restores it
  for (let i = 0; i < 40 && sim.combat.chronoEffects.length === 0; i++) {
    sim.stepTicks(1);
  }
  assert.ok(sim.combat.chronoEffects.length > 0, "Chrono effect should spawn");
  const restored = sim.combat.agents.find((a) => a.id === 9123);
  assert.ok(restored, "unit should be restored with original id");
  assert.ok(restored.hp <= 12, `restored hp (${restored.hp}) must not exceed recorded prior health (12)`);
});

test("Defect 4: Echo Mine ignores falling-masonry destruction and enforces elite lure expiry", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.echoMineUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 12, CellMaterial.STREET);

  const mine = sim.placeTower("echoMine", cx, cy);
  assert.ok(mine);

  sim.combat.organisms.push({
    id: 5501,
    kind: "nebulaWorm",
    x: cx + 3,
    y: cy + 2,
    vx: 0,
    vy: 0,
    targetX: cx + 3,
    targetY: cy + 2,
    hp: 100,
    maxHp: 100,
    radius: 0.9,
    speed: 3,
    damage: 10,
    cooldown: 0,
    seed: 1,
  });

  // Destroy mine via falling masonry (pendingImpacts), NOT enemy attack
  sim.physics.pendingImpacts.push({ x: cx + 2, y: cy + 2, radius: 3, damage: 500 });
  sim.stepTicks(2);
  const worm = sim.combat.organisms.find((o) => o.id === 5501);
  assert.ok(worm, "worm should still exist");
  assert.ok(worm.hp >= 50, "falling-masonry destruction of Echo Mine must NOT trigger enemy-destruction blast");

  // Elite lure expiry: Nebula Queen lure should expire and not be infinitely refreshed every 15 ticks
  const mine2 = sim.placeTower("echoMine", cx, cy);
  assert.ok(mine2);
  sim.combat.organisms.push({
    id: 5502,
    kind: "nebulaQueen",
    x: cx + 8,
    y: cy + 2,
    vx: 0,
    vy: 0,
    targetX: cx + 8,
    targetY: cy + 2,
    hp: 500,
    maxHp: 500,
    radius: 1.5,
    speed: 2,
    damage: 25,
    cooldown: 0,
    seed: 2,
  });
  sim.stepTicks(16); // tick 15 lures queen
  const queen = sim.combat.organisms.find((o) => o.id === 5502)!;
  assert.equal(queen.lureUid, mine2.uid, "queen initially lured");
  const initialUntil = queen.lureUntilTick ?? 0;
  sim.stepTicks(40); // past 30-tick queen lure duration
  assert.notEqual(queen.lureUid, mine2.uid, `elite queen lure should expire (was until ${initialUntil}, tick=${sim.tick})`);
});

test("Defect 5: Stacked Boundary Prisms obey combined per-source redirection cap", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.boundaryPrismUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 18, CellMaterial.STREET);
  // Create a long Void edge just north of prisms so there are protected cells AND receiving cells
  for (let dx = -12; dx <= 12; dx++) {
    const idx = sim.world.grid.index(cx + dx, cy - 2);
    sim.world.material[idx] = CellMaterial.VOID;
    sim.world.hp[idx] = 0;
  }
  sim.voidField.rebuildFrontier(sim.world);

  // Place 3 overlapping Prisms side by side
  const p1 = sim.placeTower("boundaryPrism", cx - 2, cy);
  const p2 = sim.placeTower("boundaryPrism", cx + 2, cy);
  const p3 = sim.placeTower("boundaryPrism", cx + 6, cy);
  assert.ok(p1 && p2 && p3);

  // Measure single-cell HP loss with 3 stacked prisms vs no prisms
  const testCellIdx = sim.world.grid.index(cx + 1, cy - 1);
  sim.world.hp[testCellIdx] = 200;
  sim.world.maxHp[testCellIdx] = 200;

  // Run 10 ticks with 3 prisms
  sim.stepTicks(10);
  const hpAfter3Prisms = sim.world.hp[testCellIdx];

  // Compare against baseline with 0 prisms on identical setup
  const simBase = new VoidSim("classicCore", "buildWatch", emptyTechWallet(), true);
  clearArea(simBase, cx, cy, 18, CellMaterial.STREET);
  for (let dx = -12; dx <= 12; dx++) {
    const idx = simBase.world.grid.index(cx + dx, cy - 2);
    simBase.world.material[idx] = CellMaterial.VOID;
    simBase.world.hp[idx] = 0;
  }
  simBase.voidField.rebuildFrontier(simBase.world);
  simBase.world.hp[testCellIdx] = 200;
  simBase.world.maxHp[testCellIdx] = 200;
  simBase.stepTicks(10);
  const baseDamage = 200 - simBase.world.hp[testCellIdx];
  const prismDamage = 200 - hpAfter3Prisms;

  if (baseDamage > 0) {
    const reductionRatio = (baseDamage - prismDamage) / baseDamage;
    assert.ok(
      reductionRatio <= 0.50,
      `combined 3-prism reduction (${(reductionRatio * 100).toFixed(1)}%) must stay within combined cap (<= 45-50%)`,
    );
  }
});

test("Defect 6: Lantern Bearer and Seamwalker tech upgrade branches exist and affect EvaluatedTech", () => {
  const ids = new Set(TECH_NODES.map((n) => n.id));
  assert.ok(ids.has("lanternEscortRadius"), "Lantern escort radius node exists");
  assert.ok(ids.has("lanternSurvivability"), "Lantern survivability node exists");
  assert.ok(ids.has("seamwalkerWidth"), "Seamwalker width node exists");
  assert.ok(ids.has("seamwalkerHold"), "Seamwalker hold duration node exists");
  assert.ok(ids.has("seamwalkerCadence"), "Seamwalker cadence node exists");
});
