import assert from "node:assert/strict";
import test from "node:test";
import { decodeSettings, defaultSettings } from "../src/settings.ts";
import {
  BuildingSpriteCache,
  cellTierElevation,
  elevationOf,
  FLOORS_PER_PIXEL,
  floorsToElevation,
  MAX_ELEVATION_PX,
  projectRoofY,
  TOWER_ELEVATION_PX,
} from "../src/void/elevation.ts";
import { getScenario } from "../src/void/maps.ts";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";
import { VoidWorld } from "../src/void/world.ts";

test("Oblique ¾ projection: elevationOf and projectRoofY map floors to 1..15 px across Full, Low, and Flat modes", () => {
  assert.equal(FLOORS_PER_PIXEL, 2);
  assert.equal(MAX_ELEVATION_PX, 15);
  assert.equal(TOWER_ELEVATION_PX, 2);

  // Full mode: ceil(floors / 2), clamped 1..15
  assert.equal(floorsToElevation(0, "full"), 0);
  assert.equal(floorsToElevation(2, "full"), 1);
  assert.equal(floorsToElevation(3, "full"), 2);
  assert.equal(floorsToElevation(6, "full"), 3);
  assert.equal(floorsToElevation(14, "full"), 7);
  assert.equal(floorsToElevation(30, "full"), 15);
  assert.equal(floorsToElevation(48, "full"), 15);

  // Low mode: half of full, rounded up, min 1
  assert.equal(floorsToElevation(2, "low"), 1);
  assert.equal(floorsToElevation(14, "low"), 4);
  assert.equal(floorsToElevation(30, "low"), 8);

  // Flat mode: 0 elevation
  assert.equal(floorsToElevation(2, "flat"), 0);
  assert.equal(floorsToElevation(30, "flat"), 0);

  // Roof y projects upward (smaller screen y)
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "full")), 90);
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "low")), 95);
  assert.equal(projectRoofY(100, elevationOf({ height: 20 }, "flat")), 100);
});

test("BuildingSpriteCache produces integer whole-pixel runs and accurate roof/facade hit masks without mutating simulation state", () => {
  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world } = sim;

  // Snapshot simulation state before building sprites and picking structures
  const matBefore = world.material.slice();
  const hpBefore = world.hp.slice();
  const bAtBefore = world.buildingAt.slice();

  const cache = new BuildingSpriteCache();
  let tallSpriteFound = false;

  for (const b of world.buildings) {
    const sp = cache.getSprite(world, b, "full");
    assert.equal(sp.w, b.w);
    assert.equal(sp.h, b.h + sp.maxElev);
    assert.equal(sp.y, b.y - sp.maxElev);

    // Every pixel run and op must be on integer world coordinates
    for (const r of sp.runs) {
      assert.equal(r.dx, Math.floor(r.dx));
      assert.equal(r.dy, Math.floor(r.dy));
      assert.equal(r.w, Math.floor(r.w));
      assert.ok(r.dx >= 0 && r.dx + r.w <= sp.w);
      assert.ok(r.dy >= 0 && r.dy < sp.h);
    }

    if (b.isSkyscraper && sp.intactCount > 0 && sp.maxElev >= 6) {
      tallSpriteFound = true;
      // Stepped skyscraper inner core reaches full elevation while outer ring is lower
      const cx = b.x + Math.floor(b.w / 2);
      const cy = b.y + Math.floor(b.h / 2);
      assert.ok(
        cellTierElevation(b, cx, cy, sp.maxElev) >= cellTierElevation(b, b.x, b.y, sp.maxElev),
      );
      // Roof hit-test above the north footprint (`y < b.y`) hits the building
      const pick = cache.pickStructureAt(world, sim.combat.towers, cx, b.y - 1, "full");
      assert.ok(pick !== null, "Expected roof hit above north footprint edge");
    }
  }

  assert.ok(tallSpriteFound, "Expected at least one tall skyscraper sprite");

  // Verify simulation arrays were untouched by sprite building and picking
  assert.deepEqual(world.material, matBefore);
  assert.deepEqual(world.hp, hpBefore);
  assert.deepEqual(world.buildingAt, bAtBefore);
});

test("buildingHeight setting defaults to full and round-trips through decodeSettings", () => {
  assert.equal(defaultSettings().buildingHeight, "full");
  assert.equal(decodeSettings({}).buildingHeight, "full");
  assert.equal(decodeSettings({ buildingHeight: "low" }).buildingHeight, "low");
  assert.equal(decodeSettings({ buildingHeight: "flat" }).buildingHeight, "flat");
  assert.equal(decodeSettings({ buildingHeight: "invalid" }).buildingHeight, "full");
});

test("Phase 2: columnFloors initializes deterministically and cantilever / brink spalling rules hold 1-px overhang while dropping 5-px overhang", () => {
  const sc = getScenario("tutorialBreach");
  const w1 = new VoidWorld(sc);
  const w2 = new VoidWorld(sc);
  assert.deepEqual(w1.columnFloors, w2.columnFloors);

  const sim = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const { world, physics } = sim;
  const { w } = world.grid;

  // Pick an intact skyscraper with width >= 8 and height >= 16 (maxSpan = 1 + floor(height/8) >= 3)
  const target = world.buildings.find((b) => b.isSkyscraper && b.w >= 8 && b.h >= 6 && b.height >= 16);
  assert.ok(target, "Expected a wide tall skyscraper");

  // Verify initial columnFloors match target.height
  for (const idx of target.cells) {
    assert.equal(world.columnFloors[idx], target.height);
  }

  // Consume 1 column on the west edge into Void: 1-px overhang is within maxSpan of supported neighbor (x + 1)
  const westEdgeIdx = (target.y + 1) * w + target.x;
  physics.consumeCellIntoVoid(world, westEdgeIdx, false);
  physics.stepStructuralSupport(world, 1 / 30);
  assert.ok(
    world.columnFloors[westEdgeIdx] > 0,
    `1-px overhang should survive cantilever check (got ${world.columnFloors[westEdgeIdx]})`,
  );

  // Now consume a 6-px wide swath from the west side of the building so the westernmost column is 6 px from any supported column (> maxSpan)
  for (let py = target.y; py < target.y + target.h; py++) {
    for (let px = target.x; px < Math.min(target.x + 6, target.x + target.w - 1); px++) {
      physics.consumeCellIntoVoid(world, py * w + px, false);
    }
  }
  physics.stepStructuralSupport(world, 1 / 30);
  assert.equal(
    world.columnFloors[westEdgeIdx],
    0,
    "Column 6 px from nearest supported foundation (> maxSpan) must detach and drop to 0 floors",
  );

  // Step 40 ticks of structural support so brink spalling erodes upper floors of columns adjacent to Void
  let spalledColumns = 0;
  for (let t = 0; t < 40; t++) {
    physics.stepStructuralSupport(world, 1 / 30);
  }
  for (const idx of target.cells) {
    if (world.material[idx] !== CellMaterial.VOID && world.columnFloors[idx] < target.height) {
      spalledColumns++;
    }
  }
  assert.ok(spalledColumns > 0, "Expected brink columns next to Void to spall upper floors over time");

  // Building sprite for partially collapsed skyscraper renders exposed cutaway floor slab & interior room colors
  const cache = new BuildingSpriteCache();
  const sp = cache.getSprite(world, target, "full");
  const hasSlabOrInterior = sp.ops.some(
    (op) => op.color === "#5c6574" || op.color === "#4a525e" || op.color === "#141923" || op.color === "#2a3344",
  );
  assert.ok(hasSlabOrInterior, "Expected exposed concrete slab or room interior pixels in cutaway sprite");
});

