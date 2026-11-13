import assert from "node:assert/strict";
import test from "node:test";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

function clearPlaza(sim: VoidSim, cx: number, cy: number, radius = 12): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (!sim.world.grid.inBounds(gx, gy)) continue;
      const idx = sim.world.grid.index(gx, gy);
      sim.world.material[idx] = CellMaterial.STREET;
      sim.world.hp[idx] = 100;
      sim.world.maxHp[idx] = 100;
      sim.world.buildingAt[idx] = -1;
      sim.world.towerAt[idx] = -1;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);
}

test("Lantern Bearer: spawns bearer units, walks into Void with solid ground, and reverts temporary footing on departure/death", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.lanternBearerUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const cx = 40;
  const cy = 40;
  clearPlaza(sim, cx, cy, 12);
  // Carve Void moat east of plaza
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = 4; dx <= 10; dx++) {
      const idx = sim.world.grid.index(cx + dx, cy + dy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  const post = sim.placeTower("lanternBearer", cx, cy);
  assert.ok(post, "placeTower(lanternBearer) should succeed");
  const bearers = sim.combat.agents.filter((a) => a.kind === "lanternBearer" && a.homeUid === post.uid);
  assert.ok(bearers.length >= 1, "lanternBearer post should spawn bearer units");

  const voidTestX = cx + 6;
  const voidTestY = cy;
  const voidTestIdx = sim.world.grid.index(voidTestX, voidTestY);
  assert.equal(sim.world.material[voidTestIdx], CellMaterial.VOID);

  // Set focus into the Void cell so bearers walk into Void organically
  post.focus = { x: voidTestX + 0.5, y: voidTestY + 0.5 };
  sim.stepTicks(45);

  assert.ok(sim.voidField.lanternRefCount[voidTestIdx] >= 1, "living bearer protects Void cell");
  assert.notEqual(sim.world.material[voidTestIdx], CellMaterial.VOID, "bearer creates solid ground beneath itself");

  // Kill all bearers -> coverage removed -> temporary footing reverts to VOID
  for (const b of bearers) b.hp = 0;
  sim.stepTicks(2);
  assert.equal(sim.voidField.lanternRefCount[voidTestIdx], 0);
  assert.equal(sim.world.material[voidTestIdx], CellMaterial.VOID, "temporary Void footing reverts when last bearer dies");
});

test("Seamwalker: spawns infantry that staple Void frontier, arrest propagation, and expire cleanly without burst", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.seamwalkerUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const cx = 50;
  const cy = 50;
  clearPlaza(sim, cx, cy, 12);
  // Carve Void frontier right next to plaza (outside 4x4 tower footprint x: cx..cx+3)
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = 4; dx <= 9; dx++) {
      const idx = sim.world.grid.index(cx + dx, cy + dy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  const post = sim.placeTower("seamwalker", cx, cy);
  assert.ok(post, "placeTower(seamwalker) should succeed");
  const walkers = sim.combat.agents.filter((a) => a.kind === "seamwalker" && a.homeUid === post.uid);
  assert.ok(walkers.length >= 1, "seamwalker post should spawn seamwalker soldiers");

  sim.stepTicks(45); // 1.5s: soldiers fire staples onto Void frontier
  assert.ok(sim.voidField.frozenVoidCells.size > 0, "seamwalker staples should freeze Void frontier cells");

  // Bounded refresh check
  const sampleIdx = [...sim.voidField.frozenVoidCells.keys()][0];
  sim.voidField.freezeVoidCell(sampleIdx, 999);
  assert.ok((sim.voidField.frozenVoidCells.get(sampleIdx) ?? 0) <= 4.0, "freeze duration is strictly bounded");

  // Remove post & walkers so no new staples fire, then let freeze expire cleanly
  sim.sellTower(post.uid);
  sim.combat.agents = sim.combat.agents.filter((a) => a.kind !== "seamwalker");
  sim.stepTicks(130); // > 4.0s
  assert.equal(sim.voidField.frozenVoidCells.size, 0, "frozen cells expire cleanly after hold");
});

test("Jetpack infantry: airborne over Void, organism-only targeting, immune to ground chunk impacts", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.jetpackInfantry = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const cx = 60;
  const cy = 60;
  clearPlaza(sim, cx, cy, 10);
  const barrack = sim.placeTower("infantryBarracks", cx, cy);
  assert.ok(barrack, "placeTower(infantry) should succeed");

  const jetpacks = sim.combat.agents.filter((a) => a.kind === "jetpack");
  assert.ok(jetpacks.length >= 1, "unlockedJetpack should spawn jetpack infantry");
  assert.equal(jetpacks[0].layer, "air");

  // Place jetpack directly over Void and drop a ground chunk on it -> stays alive & airborne
  const voidX = cx + 14;
  const voidY = cy;
  const vIdx = sim.world.grid.index(voidX, voidY);
  sim.world.material[vIdx] = CellMaterial.VOID;
  sim.world.hp[vIdx] = 0;
  jetpacks[0].x = voidX + 0.5;
  jetpacks[0].y = voidY + 0.5;
  const startHp = jetpacks[0].hp;
  sim.physics.pendingImpacts.push({ x: voidX + 0.5, y: voidY + 0.5, radius: 3, damage: 50 });

  sim.stepTicks(16); // hits tick % 15 === 0 lure re-evaluation
  assert.equal(jetpacks[0].hp, startHp, "airborne jetpack ignores ground chunk impact and does not fall into Void");
});

test("Echo Mine: lures organisms, explodes on enemy destruction, but does NOT detonate when sold", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.echoMineUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const cx = 70;
  const cy = 70;
  clearPlaza(sim, cx, cy, 10);

  const mine1 = sim.placeTower("echoMine", cx, cy);
  assert.ok(mine1, "placeTower(echoMine) should succeed");

  // Spawn an enemy organism near mine1 -> should be lured
  sim.combat.organisms.push({
    id: 8801,
    kind: "nebulaWorm",
    x: cx + 6,
    y: cy + 2,
    vx: 0,
    vy: 0,
    targetX: cx + 6,
    targetY: cy + 2,
    hp: 60,
    maxHp: 60,
    radius: 0.9,
    speed: 3.5,
    damage: 15,
    cooldown: 0,
    seed: 1,
  });
  sim.stepTicks(16); // hits tick % 15 === 0 lure re-evaluation
  const org = sim.combat.organisms.find((o) => o.id === 8801);
  assert.ok(org && org.lureUid === mine1.uid, "Echo Mine lures nearby organism");

  // Enemy destroys mine1 -> blast damages nearby organism
  mine1.hp = 0;
  sim.stepTicks(1);
  assert.ok(!org || org.hp < 60, "Enemy destruction of Echo Mine triggers volatile blast");

  // Selling a fresh mine2 must NOT detonate or damage nearby organisms
  const mine2 = sim.placeTower("echoMine", cx, cy);
  assert.ok(mine2);
  sim.combat.organisms.push({
    id: 8802,
    kind: "nebulaWorm",
    x: cx + 3,
    y: cy + 2,
    vx: 0,
    vy: 0,
    targetX: cx + 3,
    targetY: cy + 2,
    hp: 60,
    maxHp: 60,
    radius: 0.9,
    speed: 3.5,
    damage: 15,
    cooldown: 0,
    seed: 2,
  });
  sim.sellTower(mine2.uid);
  sim.stepTicks(1);
  const org2 = sim.combat.organisms.find((o) => o.id === 8802);
  assert.equal(org2?.hp, 60, "Selling Echo Mine must not trigger blast");
});

test("Countervoid Heart: grows finite-budget orange frontier in stepTicks and decays on heart removal", () => {
  const wallet = emptyTechWallet();
  wallet.ranks.countervoidHeartUnlock = 1;
  const sim = new VoidSim("classicCore", "buildWatch", wallet, true);
  sim.supplies = 2000;

  const cx = 80;
  const cy = 80;
  clearPlaza(sim, cx, cy, 6);
  // Surround east side with Void
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = 4; dx <= 12; dx++) {
      const idx = sim.world.grid.index(cx + dx, cy + dy);
      sim.world.material[idx] = CellMaterial.VOID;
      sim.world.hp[idx] = 0;
    }
  }
  sim.voidField.rebuildFrontier(sim.world);

  const heart = sim.placeTower("countervoidHeart", cx, cy);
  assert.ok(heart, "placeTower(countervoidHeart) should succeed");

  sim.stepTicks(45); // 1.5s
  assert.ok(sim.voidField.countervoidCells.size > 1, "Countervoid Heart grows orange frontier via VoidSim.stepTicks");
  const peakCount = sim.voidField.countervoidCells.size;

  // Destroy/remove heart without Lasting Ground -> unstabilized Countervoid decays
  sim.sellTower(heart.uid);
  sim.stepTicks(60); // 2s
  assert.ok(sim.voidField.countervoidCells.size < peakCount, "Countervoid decays when no living Heart remains");
});
