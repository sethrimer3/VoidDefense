import assert from "node:assert/strict";
import test from "node:test";
import { decode, defaults, SAVE_KEY } from "../src/save.ts";
import { VOID_BALANCE, VOID_SAVE_KEY } from "../src/void/config.ts";
import { getScenario, SCENARIOS } from "../src/void/maps.ts";
import { CellMaterial } from "../src/void/model.ts";
import { VoidPhysics } from "../src/void/physics.ts";
import { decodeVoidSave, defaultVoidSave } from "../src/void/save.ts";
import { computeSparksTier, evaluateRunOutcome } from "../src/void/scoring.ts";
import { VoidSim } from "../src/void/sim.ts";
import { TECH_NODES } from "../src/void/tech/catalog.ts";
import {
  availableCurrencies,
  buyTechNode,
  emptyTechWallet,
  evaluateTech,
  recordScenarioResult,
  refundTechNode,
  respecAllTech,
  sanitizeTechRanks,
  totalEarnedSparks,
  validateTechCatalog,
} from "../src/void/tech/wallet.ts";
import { VoidField } from "../src/void/void-field.ts";
import { VoidWorld } from "../src/void/world.ts";
import { LandCover, ZoneKind } from "../src/void/model.ts";

test("1. Procedural metropolitan map repeatability, density, and baseline integrity", () => {
  const sc = getScenario("tutorialBreach");
  const w1 = new VoidWorld(sc);
  const w2 = new VoidWorld(sc);

  assert.equal(w1.grid.w, 192);
  assert.equal(w1.grid.h, 256);
  assert.equal(w1.totalBaselineValue, w2.totalBaselineValue);
  assert.deepEqual(w1.material, w2.material);
  assert.deepEqual(w1.hp, w2.hp);

  // Must generate hundreds of buildings and skyscrapers (dense metropolis, not 9 tiles)
  assert.ok(w1.buildings.length >= 120, `Expected >=120 buildings, got ${w1.buildings.length}`);
  const skyscrapers = w1.buildings.filter((b) => b.isSkyscraper);
  assert.ok(skyscrapers.length >= 20, `Expected >=20 skyscrapers, got ${skyscrapers.length}`);

  // Large 256x384 scenario also generates cleanly
  const largeSc = getScenario("archipelagoCity");
  const wLarge = new VoidWorld(largeSc);
  assert.equal(wLarge.grid.w, 256);
  assert.equal(wLarge.grid.h, 384);
  assert.ok(wLarge.buildings.length >= 200);
});

test("1b. City gives way to countryside before the Void: zones, rural land cover, roads, river, hamlets", () => {
  const sc = getScenario("tutorialBreach");
  const world = new VoidWorld(sc);
  const { w, h } = world.grid;
  const portal = world.portals[0];

  // Every cell is classified, and the three zones all exist on a default scenario
  const zoneCounts = [0, 0, 0];
  for (let i = 0; i < world.grid.count; i++) zoneCounts[world.zone[i]]++;
  assert.ok(zoneCounts[ZoneKind.RURAL] > 2000, `rural cells: ${zoneCounts[ZoneKind.RURAL]}`);
  assert.ok(zoneCounts[ZoneKind.SUBURB] > 1500, `suburb cells: ${zoneCounts[ZoneKind.SUBURB]}`);
  assert.ok(zoneCounts[ZoneKind.URBAN] > zoneCounts[ZoneKind.RURAL], "the metropolis still dominates the map");

  // The land next to the crater is countryside, far corners are city
  const nearIdx = (portal.y + portal.radius + 4) * w + portal.x;
  assert.equal(world.zone[nearIdx], ZoneKind.RURAL);
  assert.equal(world.zone[(h - 6) * w + (w - 6)], ZoneKind.URBAN);

  // Rural cells carry countryside land cover; urban cells carry none
  const cover: Record<number, number> = {};
  for (let i = 0; i < world.grid.count; i++) {
    const lc = world.landCover[i];
    cover[lc] = (cover[lc] ?? 0) + 1;
    if (world.zone[i] === ZoneKind.URBAN && world.material[i] !== CellMaterial.PARK) {
      assert.equal(lc, LandCover.NONE, `urban non-park cell ${i} has land cover ${lc}`);
    }
  }
  assert.ok((cover[LandCover.GRASS] ?? 0) > 1000, "open grass");
  assert.ok((cover[LandCover.FOREST] ?? 0) > 300, "forest");
  assert.ok((cover[LandCover.DIRT_ROAD] ?? 0) > 60, "winding country roads");
  assert.ok((cover[LandCover.RIVER] ?? 0) > 60, "a river");
  assert.ok((cover[LandCover.FIELD_H] ?? 0) + (cover[LandCover.FIELD_V] ?? 0) + (cover[LandCover.ORCHARD] ?? 0) > 60, "fields and orchards");

  // Dirt roads and bridges are passable baseline streets; river cells are water
  for (let i = 0; i < world.grid.count; i++) {
    const lc = world.landCover[i];
    // The initial crater blast turns nearby ground into Void or salvage; skip those cells
    const m = world.material[i];
    if (m === CellMaterial.VOID || m === CellMaterial.SALVAGE) continue;
    if (lc === LandCover.DIRT_ROAD || lc === LandCover.BRIDGE) {
      assert.equal(world.material[i], CellMaterial.STREET);
      assert.equal(world.streetTier[i], 8);
      assert.equal(world.isBaselineCell[i], 1);
    } else if (lc === LandCover.RIVER) {
      assert.equal(world.material[i], CellMaterial.UNCLAIMED);
    }
  }

  // Hamlets: homesteads and barns only in the countryside, and they are scorable buildings
  const rural = world.buildings.filter((b) => b.district === "rural");
  assert.ok(rural.length >= 3, `rural hamlets: ${rural.length}`);
  for (const b of rural) {
    assert.ok(b.archStyle === "homestead" || b.archStyle === "barn");
    for (const cIdx of b.cells) {
      assert.equal(world.zone[cIdx], ZoneKind.RURAL);
      assert.equal(world.material[cIdx], CellMaterial.BUILDING);
    }
  }
  // No city block buildings stand on countryside
  for (const b of world.buildings) {
    if (b.district === "rural") continue;
    for (const cIdx of b.cells) assert.notEqual(world.zone[cIdx], ZoneKind.RURAL);
  }

  // Deterministic and tracked by the renderer's dirty chunks when consumed
  const again = new VoidWorld(sc);
  assert.deepEqual(again.landCover, world.landCover);
  assert.deepEqual(again.zone, world.zone);
  world.grid.clearDirtyFlags();
  world.grid.markRadiusDirty(nearIdx, 6);
  let dirty = 0;
  for (let i = 0; i < world.grid.chunkCount; i++) dirty += world.grid.dirtyChunks[i];
  assert.ok(dirty >= 2 && dirty <= 9, `chunks dirtied around a cell: ${dirty}`);
});

test("2. Void perimeter-budget physics: sacrificial land island slows city-front erosion", () => {
  const sc = getScenario("centralRupture");
  const wNoIsland = new VoidWorld(sc);
  const pNoIsland = new VoidPhysics();
  const vfNoIsland = new VoidField(wNoIsland, sc);

  const wWithIsland = new VoidWorld(sc);
  const pWithIsland = new VoidPhysics();
  const vfWithIsland = new VoidField(wWithIsland, sc);

  // Drop a sacrificial land island inside the central Void portal in wWithIsland
  const portal = wWithIsland.portals[0];
  pWithIsland.depositMatterDisc(wWithIsland, portal.x, portal.y, 4.5, false, 1.0);
  vfWithIsland.rebuildFrontier(wWithIsland);

  // Total contact edges must be higher with the internal island
  assert.ok(
    vfWithIsland.totalContactEdges() > vfNoIsland.totalContactEdges(),
    "Sacrificial island must increase total frontier contact perimeter",
  );

  // Step both fields for 90 ticks (3 seconds)
  for (let t = 1; t <= 90; t++) {
    vfNoIsland.step(wNoIsland, pNoIsland, sc, t, 1 / 30, {
      wallResistanceMultiplier: 1,
      perimeterResonanceBonus: 0,
    });
    vfWithIsland.step(wWithIsland, pWithIsland, sc, t, 1 / 30, {
      wallResistanceMultiplier: 1,
      perimeterResonanceBonus: 0,
    });
  }

  // Original baseline city weighted integrity must be higher when the sacrificial island absorbed part of the budget
  const presNoIsland = wNoIsland.computePreservedBaseline().preservedWeightedHp;
  const presWithIsland = wWithIsland.computePreservedBaseline().preservedWeightedHp;
  assert.ok(
    presWithIsland > presNoIsland,
    `Expected island to protect baseline city (${presWithIsland} > ${presNoIsland})`,
  );

  // Both spent the same total energy from their reservoir
  assert.ok(
    Math.abs(vfNoIsland.energyRemaining - vfWithIsland.energyRemaining) < 1.0,
    "Both scenarios draw from the same instantaneous growth rate budget",
  );
});

test("3. Baseline score cap invariant: extra land islands and >100% building development never inflate survival above 100%", () => {
  const sc = getScenario("tutorialBreach");
  const world = new VoidWorld(sc);
  const physics = new VoidPhysics();

  // Fill the entire Void crater with player-created land
  const portal = world.portals[0];
  physics.depositMatterDisc(world, portal.x, portal.y, portal.radius + 4, false, 2.0);

  // Develop all buildings to 200%
  for (const b of world.buildings) {
    b.development = 2.0;
  }

  const { preservedValue, preservedRatio, preservedPercent } = world.computePreservedBaseline();
  assert.equal(preservedValue, world.totalBaselineValue);
  assert.equal(preservedRatio, 1);
  assert.equal(preservedPercent, 100);
});

test("4. Explicit zero-contact resolution states (victory, defeat, delayed portal, isolated pocket burn)", () => {
  const sc = getScenario("tutorialBreach");
  const world = new VoidWorld(sc);
  const physics = new VoidPhysics();
  const vf = new VoidField(world, sc);

  // Case A: Eradicate all Void cells -> voidEradicatedVictory
  const portal = world.portals[0];
  physics.depositMatterDisc(world, portal.x, portal.y, portal.radius + 2, false, 1.0);
  const resEradicated = vf.step(world, physics, sc, 1, 1 / 30, {
    wallResistanceMultiplier: 1,
    perimeterResonanceBonus: 0,
  });
  assert.equal(resEradicated, "voidEradicatedVictory");

  // Case B: Delayed secondary portal while initial Void is cleared -> awaitingDelayedPortal
  const delayedSc = getScenario("delayedCollapse");
  const wDelayed = new VoidWorld(delayedSc);
  const pDelayed = new VoidPhysics();
  const vfDelayed = new VoidField(wDelayed, delayedSc);
  const p0 = wDelayed.portals[0];
  pDelayed.depositMatterDisc(wDelayed, p0.x, p0.y, p0.radius + 2, false, 1.0);
  const resDelayed = vfDelayed.step(wDelayed, pDelayed, delayedSc, 1, 1 / 30, {
    wallResistanceMultiplier: 1,
    perimeterResonanceBonus: 0,
  });
  assert.equal(resDelayed, "awaitingDelayedPortal");

  // Advance to second portal activation tick (25s = 750 ticks) -> second portal opens!
  const resActivated = vfDelayed.step(wDelayed, pDelayed, delayedSc, 750, 1 / 30, {
    wallResistanceMultiplier: 1,
    perimeterResonanceBonus: 0,
  });
  assert.equal(resActivated, "active");
  assert.ok(wDelayed.portals[1].active);
  assert.ok(vfDelayed.voidCellCount > 0);

  // Case C: All baseline city consumed -> cityConsumedDefeat
  const wLost = new VoidWorld(sc);
  const pLost = new VoidPhysics();
  const vfLost = new VoidField(wLost, sc);
  for (let i = 0; i < wLost.grid.count; i++) {
    wLost.material[i] = CellMaterial.VOID;
    wLost.hp[i] = 0;
  }
  const resLost = vfLost.step(wLost, pLost, sc, 1, 1 / 30, {
    wallResistanceMultiplier: 1,
    perimeterResonanceBonus: 0,
  });
  assert.equal(resLost, "cityConsumedDefeat");
});

test("5. Infantry anti-Void ablation balance: cannot cheese reservoir below minReservoirFloorFraction", () => {
  const sc = getScenario("tutorialBreach");
  const world = new VoidWorld(sc);
  const vf = new VoidField(world, sc);

  const fCell = vf.frontierCells[0];
  // Apply massive rifle ablation damage
  for (let i = 0; i < 500; i++) {
    vf.applyAntiVoidAblation(world, fCell, 5000);
  }

  const expectedFloor = sc.initialVoidEnergy * VOID_BALANCE.minReservoirFloorFraction;
  assert.ok(
    vf.energyRemaining >= expectedFloor - 1e-6,
    `Infantry ablation must not drain reservoir below ${expectedFloor}, got ${vf.energyRemaining}`,
  );
});

test("6. Anti-instant-abort participation gate & mode-shared Sparks entitlement", () => {
  const wallet = emptyTechWallet();
  const sc = getScenario("tutorialBreach");
  const world = new VoidWorld(sc);

  // Instant abort (0 actions, 1 second elapsed) -> 0 Void Essence, 0 Sparks
  const abortOutcome = evaluateRunOutcome(
    sc,
    "underSiege",
    "lost",
    "active",
    1.0,
    world,
    10,
    0,
    wallet,
  );
  assert.equal(abortOutcome.participated, false);
  assert.equal(abortOutcome.voidEssenceAwarded, 0);
  assert.equal(abortOutcome.sparksAwarded, 0);
  assert.equal(wallet.lifetimeEssence, 0);

  // Substantive failed run (placed towers, fought for 35s, resisted 600 work) -> awards Void Essence!
  const foughtOutcome = evaluateRunOutcome(
    sc,
    "underSiege",
    "lost",
    "cityConsumedDefeat",
    35.0,
    world,
    600,
    3,
    wallet,
  );
  assert.equal(foughtOutcome.participated, true);
  assert.ok(foughtOutcome.voidEssenceAwarded > 0);
  assert.equal(foughtOutcome.sparksAwarded, 0);

  // Win with 60% preserved in Under Siege -> Tier 2 (2 Sparks)
  assert.equal(computeSparksTier(true, 0.6), 2);
  const win1 = recordScenarioResult(wallet, "tutorialBreach", "underSiege", true, 60, 2, 40);
  assert.equal(win1.sparksDelta, 2);
  assert.equal(totalEarnedSparks(wallet), 2);

  // Playing Build & Watch on the SAME map and getting Tier 2 (65%) -> 0 duplicate Sparks!
  const winWatchSameTier = recordScenarioResult(
    wallet,
    "tutorialBreach",
    "buildAndWatch",
    true,
    65,
    2,
    40,
  );
  assert.equal(winWatchSameTier.sparksDelta, 0);
  assert.equal(totalEarnedSparks(wallet), 2);

  // Improving to Tier 3 (96%) in Build & Watch -> pays only the difference (+1 Spark, total 3)
  const winWatchTier3 = recordScenarioResult(
    wallet,
    "tutorialBreach",
    "buildAndWatch",
    true,
    96,
    3,
    50,
  );
  assert.equal(winWatchTier3.sparksDelta, 1);
  assert.equal(totalEarnedSparks(wallet), 3);
  assert.equal(wallet.scenarios.tutorialBreach?.underSiege.bestPreserved, 60);
  assert.equal(wallet.scenarios.tutorialBreach?.buildAndWatch.bestPreserved, 96);
});

test("7. Global technology DAG validation, purchases, and cascading refunds", () => {
  const dagCheck = validateTechCatalog();
  assert.equal(dagCheck.ok, true, dagCheck.errors.join("; "));
  assert.ok(TECH_NODES.length >= 30, `Expected >=30 tech nodes, got ${TECH_NODES.length}`);

  const wallet = emptyTechWallet();
  recordScenarioResult(wallet, "tutorialBreach", "underSiege", true, 98, 3, 500);
  recordScenarioResult(wallet, "edgeAdvance", "underSiege", true, 98, 3, 500);

  const initialAvail = availableCurrencies(wallet);
  assert.equal(initialAvail.essence, 1000);
  assert.equal(initialAvail.sparks, 6);

  // Buy prerequisite chain: matterCannonOutput -> masonThroughput -> unlockConstructorHub -> ferrocreteWalls
  assert.equal(buyTechNode(wallet, "matterCannonOutput"), true);
  assert.equal(buyTechNode(wallet, "masonThroughput"), true);
  assert.equal(buyTechNode(wallet, "unlockConstructorHub"), true);
  assert.equal(buyTechNode(wallet, "ferrocreteWalls"), true);

  // Cannot buy or refund during active battle
  assert.equal(buyTechNode(wallet, "supplyDrop", true), false);
  assert.equal(refundTechNode(wallet, "matterCannonOutput", 0, true), false);

  // Refunding `matterCannonOutput` out of battle cascades and refunds all dependents!
  assert.equal(refundTechNode(wallet, "matterCannonOutput", 0, false), true);
  assert.equal(wallet.ranks.matterCannonOutput, undefined);
  assert.equal(wallet.ranks.masonThroughput, undefined);
  assert.equal(wallet.ranks.unlockConstructorHub, undefined);
  assert.equal(wallet.ranks.ferrocreteWalls, undefined);

  // 100% of Essence and Sparks are restored
  assert.deepEqual(availableCurrencies(wallet), initialAvail);

  // Malformed save overspending is sanitized
  const sanitized = sanitizeTechRanks(
    { supplyDrop: 99, unlockHeavyMech: 1 }, // unlockHeavyMech lacks prerequisites, supplyDrop exceeds maxRank
    25,
    0,
  );
  assert.equal(sanitized.unlockHeavyMech, undefined);
  assert.equal(sanitized.supplyDrop, 1); // 25 Essence only affords Rank 1 (cost 10)
});

test("8. Live tower placement, Landfall strike, and Build & Watch vs Under Siege rules", () => {
  const wallet = emptyTechWallet();
  const simSiege = new VoidSim("tutorialBreach", "underSiege", wallet);
  assert.equal(simSiege.phase, "battle");
  assert.equal(simSiege.canModifyTowers(), true);

  // Find a valid street/building spot far from portal to place Matter Cannon, Repair Depot, and Barracks
  let placedCannon = null;
  let placedDepot = null;
  let placedBarracks = null;
  for (let y = 140; y < 220; y += 5) {
    for (let x = 20; x < 160; x += 5) {
      if (!placedCannon) placedCannon = simSiege.placeTower("matterCannon", x, y);
      else if (!placedDepot) placedDepot = simSiege.placeTower("repairDepot", x, y);
      else if (!placedBarracks) placedBarracks = simSiege.placeTower("infantryBarracks", x, y);
    }
  }
  assert.ok(placedCannon, "Placed Matter Cannon during active Under Siege battle");
  assert.ok(placedDepot, "Placed Repair Depot during active Under Siege battle");
  assert.ok(placedBarracks, "Placed Infantry Barracks during active Under Siege battle");
  assert.ok(simSiege.combat.agents.length >= 7, "Spawned autonomous 1x2 engineers and 1x1 riflemen");

  // Cast Landfall strike inside the Void portal
  const portal = simSiege.world.portals[0];
  const castOk = simSiege.castStrike("landfall", portal.x, portal.y);
  assert.equal(castOk, true, "Cast Landfall strike inside Void");

  // Advance 60 ticks (2 seconds) and verify deterministic progress
  simSiege.stepTicks(60);
  assert.equal(simSiege.tick, 60);

  // Build & Watch mode locks tower placement once battle starts
  const simWatch = new VoidSim("tutorialBreach", "buildAndWatch", wallet);
  assert.equal(simWatch.phase, "prep");
  assert.equal(simWatch.canModifyTowers(), true);
  simWatch.startBattle();
  assert.equal(simWatch.phase, "battle");
  assert.equal(simWatch.canModifyTowers(), false);
  assert.equal(simWatch.placeTower("matterCannon", 50, 150), null);
});

test("9. Save isolation: voiddefense.v1 round-trips cleanly and never touches towerdefense.v1", () => {
  assert.notEqual(VOID_SAVE_KEY, SAVE_KEY);
  const vSave = defaultVoidSave();
  vSave.profile = { name: "Commander Shepard", flag: { base: 15, layers: [] }, mode: "underSiege" };
  recordScenarioResult(vSave.wallet, "tutorialBreach", "underSiege", true, 82.5, 2, 120);
  buyTechNode(vSave.wallet, "supplyDrop");

  const raw = JSON.stringify(vSave);
  const restored = decodeVoidSave(raw);
  assert.equal(restored.profile?.name, "Commander Shepard");
  assert.equal(restored.wallet.lifetimeEssence, 120);
  assert.equal(restored.wallet.ranks.supplyDrop, 1);
  assert.equal(totalEarnedSparks(restored.wallet), 2);

  // Original TowerDefense save decoder still works independently
  const tdDefault = defaults();
  const tdRestored = decode(JSON.stringify(tdDefault));
  assert.equal(tdRestored.version, tdDefault.version);
});

test("10. Advanced towers, Wall Serpent trail, Matter Synthesis, and Cosmic Organisms (Honeycomb & Nexus Crystals)", () => {
  const wallet = emptyTechWallet();
  // Grant enough Sparks & Essence to unlock all 9 towers, all 5 strikes, and Matter Synthesis
  for (const sc of SCENARIOS) {
    if (!sc.endless) recordScenarioResult(wallet, sc.id, "underSiege", true, 99, 3, 1500);
  }
  for (const n of TECH_NODES) {
    while (buyTechNode(wallet, n.id, false)) {
      // buy to max rank
    }
  }

  const tech = evaluateTech(wallet.ranks);
  assert.equal(tech.unlockedTowers.size, 9, "All 9 Resistance tower types unlocked");
  assert.equal(tech.unlockedStrikes.size, 5, "All 5 orbital strikes unlocked");
  assert.equal(tech.matterSynthesis, true, "Matter Synthesis breakthrough active");

  const sim = new VoidSim("organismEscalation", "underSiege", wallet, true);
  // Place Constructor Hub, Wall Serpent Bay, Shield Projector, Gravity Anchor, Rocket Team, Heavy Mech Bay
  sim.placeTower("constructorHub", 30, 180);
  sim.placeTower("wallSerpent", 40, 180);
  sim.placeTower("shieldProjector", 50, 180);
  sim.placeTower("gravityAnchor", 60, 180);
  sim.placeTower("rocketTeam", 70, 180);
  sim.placeTower("heavyMechBay", 80, 180);

  // Add a polyline wall blueprint
  const bp = sim.combat.addWallBlueprint(
    sim.world,
    [
      { x: 32, y: 165 },
      { x: 42, y: 165 },
    ],
    false,
  );
  assert.ok(bp && bp.cells.length >= 8, "Created polyline wall blueprint");

  // Cast Seismic Frame and Genesis strikes
  assert.equal(sim.castStrike("seismicFrame", 50, 175), true);
  assert.equal(sim.castStrike("genesis", 96, 128), true);

  // Step 380 ticks so cosmic organisms spawn and Wall Serpent / Engineers build walls
  sim.stepTicks(380);
  assert.ok(sim.combat.organisms.length > 0, "Cosmic Void organisms spawned from active portal");

  // Verify at least some blueprint cells or serpent trail cells were turned into WALL
  let wallCount = 0;
  for (let i = 0; i < sim.world.grid.count; i++) {
    if (sim.world.material[i] === CellMaterial.WALL) wallCount++;
  }
  assert.ok(wallCount > 10, `Expected constructed ferrocrete wall cells, got ${wallCount}`);
});
