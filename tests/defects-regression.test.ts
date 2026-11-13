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

  // Overlapping hearts & countervoidLasting stabilization
  const w2 = emptyTechWallet();
  w2.ranks.countervoidHeartUnlock = 1;
  w2.ranks.countervoidLasting = 1;
  const sim2 = new VoidSim("classicCore", "buildWatch", w2, true);
  sim2.supplies = 5000;
  clearArea(sim2, cx, cy, 12, CellMaterial.RECLAIMED);
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = 3; dx <= 8; dx++) {
      const idx = sim2.world.grid.index(cx + dx, cy + dy);
      sim2.world.material[idx] = CellMaterial.VOID;
      sim2.world.hp[idx] = 0;
    }
  }
  sim2.voidField.rebuildFrontier(sim2.world);
  const h1 = sim2.placeTower("countervoidHeart", cx - 2, cy - 2);
  const h2 = sim2.placeTower("countervoidHeart", cx - 2, cy + 2);
  assert.ok(h1 && h2);
  sim2.stepTicks(60);
  const createdIdx = sim2.world.grid.index(cx + 4, cy);
  assert.notEqual(sim2.world.material[createdIdx], CellMaterial.VOID, "overlapping hearts reclaim Void");
  sim2.sellTower(h1.uid);
  sim2.stepTicks(30);
  assert.ok(sim2.voidField.countervoidCells.size > 0, "remaining heart keeps Countervoid field active");
  sim2.sellTower(h2.uid);
  sim2.stepTicks(120);
  assert.equal(sim2.voidField.countervoidCells.size, 0, "orange field decays after final heart sold");
  assert.notEqual(sim2.world.material[createdIdx], CellMaterial.VOID, "countervoidLasting stabilizes Countervoid-created land");
});

test("Defect 2: Selling Lantern Bearer post releases only its own coverage and preserves overlapping post coverage", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.lanternBearerUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 12, CellMaterial.STREET);

  const post1 = sim.placeTower("lanternBearer", cx, cy);
  const post2 = sim.placeTower("lanternBearer", cx + 3, cy);
  assert.ok(post1 && post2);
  sim.stepTicks(15);

  const countCovered = (): number => {
    let n = 0;
    for (let i = 0; i < sim.voidField.lanternRefCount.length; i++) {
      if (sim.voidField.lanternRefCount[i] > 0) n++;
    }
    return n;
  };
  assert.ok(countCovered() > 0, "living bearers should cover cells");

  sim.sellTower(post1.uid);
  assert.ok(countCovered() > 0, "selling one overlapping post must preserve the second post's coverage");

  sim.sellTower(post2.uid);
  assert.equal(countCovered(), 0, "selling final Lantern post must release 100% of coverage");
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
  const unitItem = sim.combat.chronoEffects[0].items?.find((it) => it.kind === "unit");
  assert.ok(unitItem && unitItem.agentKind === "rifleman", "Chrono effect records real restored unit metadata");

  // Also verify building-section recovery preserves columnFloors & buildingId and emits building item
  const bx = cx - 6;
  const by = cy + 2;
  const bIdx = sim.world.grid.index(bx, by);
  sim.world.material[bIdx] = CellMaterial.BUILDING;
  sim.world.buildingAt[bIdx] = 42;
  sim.world.columnFloors[bIdx] = 5;
  sim.combat.recordChronoLoss(sim.tick * (1 / 15), "terrain", bx + 0.5, by + 0.5, bIdx, CellMaterial.BUILDING, 42, 5, 110);
  sim.world.material[bIdx] = CellMaterial.VOID;
  sim.world.buildingAt[bIdx] = -1;
  sim.world.columnFloors[bIdx] = 0;
  sim.voidField.rebuildFrontier(sim.world);
  cannon.cooldown = 0;
  const effBefore = sim.combat.chronoEffects.length;
  sim.stepTicks(2);
  assert.equal(sim.world.material[bIdx], CellMaterial.BUILDING, "building cell restored");
  assert.equal(sim.world.buildingAt[bIdx], 42, "buildingId preserved");
  assert.equal(sim.world.columnFloors[bIdx], 5, "columnFloors preserved");
  assert.ok(sim.combat.chronoEffects.length > effBefore, "Chrono effect spawned for building");
  const bldItem = sim.combat.chronoEffects[sim.combat.chronoEffects.length - 1].items?.find((it) => it.kind === "building");
  assert.ok(bldItem && bldItem.floors === 5, "Chrono effect records real building floor metadata");
});

test("Defect 4: Echo Mine ignores falling-masonry/sell, detonates after warning on enemy kill, and enforces elite lure expiry", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.echoMineUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 5000;

  const cx = 60;
  const cy = 60;
  clearArea(sim, cx, cy, 14, CellMaterial.STREET);

  const mine = sim.placeTower("echoMine", cx, cy);
  assert.ok(mine);

  sim.combat.organisms.push({
    id: 5501,
    kind: "nebulaWorm",
    x: cx + 9,
    y: cy + 2,
    vx: 0,
    vy: 0,
    targetX: cx + 9,
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
  sim.stepTicks(8);
  const worm = sim.combat.organisms.find((o) => o.id === 5501);
  assert.ok(worm, "worm should still exist");
  assert.ok(worm.hp >= 95, "falling-masonry destruction of Echo Mine must NOT trigger enemy-destruction blast");
  assert.equal(sim.combat.echoPendingBlasts.length, 0, "no pending blast on masonry kill");

  // Enemy-caused destruction triggers telegraphed warning then blast
  const mineEnemy = sim.placeTower("echoMine", cx, cy);
  assert.ok(mineEnemy);
  mineEnemy.hp = 10;
  worm.x = cx + 1;
  worm.y = cy + 1;
  worm.cooldown = 0;
  sim.stepTicks(2);
  assert.ok(sim.combat.echoPendingBlasts.length > 0 || worm.hp < 20, "enemy kill queues telegraphed Echo blast");
  sim.stepTicks(10);
  const wormAfter = sim.combat.organisms.find((o) => o.id === 5501);
  assert.ok(!wormAfter || wormAfter.hp < 20, "telegraphed Echo blast damages/kills attacking organism");

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

  // Order invariance: reversed placement [p3, p2, p1] yields identical damage
  const simRev = new VoidSim("classicCore", "buildWatch", wallet, true);
  simRev.supplies = 5000;
  clearArea(simRev, cx, cy, 18, CellMaterial.STREET);
  for (let dx = -12; dx <= 12; dx++) {
    const idx = simRev.world.grid.index(cx + dx, cy - 2);
    simRev.world.material[idx] = CellMaterial.VOID;
    simRev.world.hp[idx] = 0;
  }
  simRev.voidField.rebuildFrontier(simRev.world);
  simRev.placeTower("boundaryPrism", cx + 6, cy);
  simRev.placeTower("boundaryPrism", cx + 2, cy);
  simRev.placeTower("boundaryPrism", cx - 2, cy);
  simRev.world.hp[testCellIdx] = 200;
  simRev.world.maxHp[testCellIdx] = 200;
  simRev.stepTicks(10);
  assert.equal(simRev.world.hp[testCellIdx], hpAfter3Prisms, "combined prism cap is order-independent");
});

test("Defect 6: Lantern Bearer and Seamwalker tech upgrade branches exist and affect live VoidSim", () => {
  const ids = new Set(TECH_NODES.map((n) => n.id));
  assert.ok(ids.has("lanternEscortRadius"), "Lantern escort radius node exists");
  assert.ok(ids.has("lanternSurvivability"), "Lantern survivability node exists");
  assert.ok(ids.has("lanternStride"), "Lantern stride node exists");
  assert.ok(ids.has("seamwalkerWidth"), "Seamwalker width node exists");
  assert.ok(ids.has("seamwalkerHold"), "Seamwalker hold duration node exists");
  assert.ok(ids.has("seamwalkerCadence"), "Seamwalker cadence node exists");

  const baseWallet = emptyTechWallet();
  baseWallet.ranks.lanternBearerUnlock = 1;
  baseWallet.ranks.seamwalkerUnlock = 1;
  const baseEval = evaluateTech(baseWallet);

  const upgWallet = emptyTechWallet();
  upgWallet.ranks.lanternBearerUnlock = 1;
  upgWallet.ranks.lanternEscortRadius = 2;
  upgWallet.ranks.lanternSurvivability = 2;
  upgWallet.ranks.lanternStride = 2;
  upgWallet.ranks.seamwalkerUnlock = 1;
  upgWallet.ranks.seamwalkerWidth = 1;
  upgWallet.ranks.seamwalkerHold = 2;
  upgWallet.ranks.seamwalkerCadence = 2;
  const upgEval = evaluateTech(upgWallet);

  assert.ok(upgEval.lanternRadiusBonus > baseEval.lanternRadiusBonus);
  assert.ok(upgEval.lanternHpMultiplier > baseEval.lanternHpMultiplier);
  assert.ok(upgEval.lanternSpeedMultiplier > baseEval.lanternSpeedMultiplier);
  assert.ok(upgEval.seamwalkerSegmentRadius > baseEval.seamwalkerSegmentRadius);
  assert.ok(upgEval.seamwalkerHoldDuration > baseEval.seamwalkerHoldDuration);
  assert.ok(upgEval.seamwalkerCooldownMultiplier < baseEval.seamwalkerCooldownMultiplier);

  const simBase = new VoidSim("classicCore", "buildWatch", baseWallet, true);
  const simUpg = new VoidSim("classicCore", "buildWatch", upgWallet, true);
  simBase.supplies = 5000;
  simUpg.supplies = 5000;
  clearArea(simBase, 60, 60, 14, CellMaterial.STREET);
  clearArea(simUpg, 60, 60, 14, CellMaterial.STREET);
  simBase.placeTower("lanternBearer", 60, 60);
  simUpg.placeTower("lanternBearer", 60, 60);
  simBase.stepTicks(5);
  simUpg.stepTicks(5);

  const countCov = (s: VoidSim): number => {
    let n = 0;
    for (let i = 0; i < s.voidField.lanternRefCount.length; i++) if (s.voidField.lanternRefCount[i] > 0) n++;
    return n;
  };
  assert.ok(countCov(simUpg) > countCov(simBase), "upgraded Lantern Bearer covers more cells in live sim");
  assert.ok(simUpg.combat.agents[0].maxHp > simBase.combat.agents[0].maxHp, "upgraded Lantern Bearer has higher HP");
});
