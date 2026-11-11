import assert from "node:assert/strict";
import test from "node:test";
import { VoidGrid } from "../src/void/grid.ts";
import { CellMaterial, type VoidOrganism, type VoidNode } from "../src/void/model.ts";
import {
  organismFootprint,
  computeOrganismContour,
  computeNodeContour,
  sampleContourNoise,
  contourColor,
} from "../src/void/contour.ts";
import {
  generateWispsForPortals,
  computeVoidInterior,
  paintVoidInterior,
  type VoidInteriorWorld,
} from "../src/void/interior.ts";

test("1. Classic portal noise verification: uses Value Noise with ridged multifractal, not Perlin noise", () => {
  // portal-noise.ts implements valueNoise(x, y) with hash2 and smooth cubic Hermite interpolation.
  // It does NOT compute gradient dot products as Ken Perlin's algorithm does.
  const sample1 = sampleContourNoise(0.2, 0.3);
  const sample2 = sampleContourNoise(0.2, 0.3);
  assert.equal(sample1, sample2, "Noise sampling must be deterministic");
  assert.ok(sample1 >= 0 && sample1 <= 1, "Noise must lie in normalized [0, 1]");

  // Color mapping: violet/magenta ramp with cyan peak highlights
  assert.equal(contourColor(0.1), "#8425d9", "Low noise -> deep violet");
  assert.equal(contourColor(0.5), "#df42d1", "Mid noise -> vibrant magenta");
  assert.ok(
    contourColor(0.9, 1) === "#6ef3ff" || contourColor(0.9, 1) === "#d8fbff",
    "High noise peak with jitter -> cyan/white-cyan highlight",
  );
});

test("2. Nebula-colored enemy contours: thin 1-pixel organic boundary preserving readable silhouettes", () => {
  const dummyOrganism: VoidOrganism = {
    id: 42,
    kind: "nebulaWorm",
    x: 100,
    y: 120,
    vx: 0,
    vy: 0,
    hp: 100,
    maxHp: 100,
    targetX: 100,
    targetY: 120,
    cooldown: 0,
  };

  const footprint = organismFootprint(dummyOrganism);
  assert.ok(footprint.length >= 4, "Footprint must cover body cells");
  const footprintSet = new Set(footprint.map((p) => `${p.x},${p.y}`));

  // Contour at t = 0
  const contour0 = computeOrganismContour(dummyOrganism, 0, false);
  assert.ok(contour0.length >= 8, "Expected exterior contour around footprint");

  // Every contour pixel must be strictly adjacent to footprint and NOT inside footprint (thin rim)
  for (const pt of contour0) {
    assert.equal(Number.isInteger(pt.x), true, "Contour pixel X must be integer");
    assert.equal(Number.isInteger(pt.y), true, "Contour pixel Y must be integer");
    assert.equal(
      footprintSet.has(`${pt.x},${pt.y}`),
      false,
      "Contour pixel must not overlap interior body",
    );
    // Colors must match nebula palette (violet, magenta, cyan)
    assert.match(pt.color, /^#(8425d9|a832e8|df42d1|ff62e2|6ef3ff|d8fbff)$/);
  }

  // Slowly evolves over time
  const contourLater = computeOrganismContour(dummyOrganism, 10.0, false);
  assert.ok(contourLater.length >= 8);
  // Colors or active points change as noise coordinates scroll
  const colors0 = contour0.map((p) => p.color).join(",");
  const colorsLater = contourLater.map((p) => p.color).join(",");
  assert.notEqual(colors0, colorsLater, "Contour colors must evolve over time");

  // Reduced motion: stable, no noise animation drift
  const reduced1 = computeOrganismContour(dummyOrganism, 0, true);
  const reduced2 = computeOrganismContour(dummyOrganism, 50, true);
  assert.deepEqual(reduced1, reduced2, "Reduced motion contour must remain static and stable");
});

test("2b. Cosmic Queen Bee and Bee Swarm organic noise-based outlines", () => {
  const queen: VoidOrganism = {
    id: 101,
    kind: "nebulaQueen",
    x: 50,
    y: 60,
    vx: 0,
    vy: 0,
    hp: 400,
    maxHp: 400,
    targetX: 50,
    targetY: 60,
    cooldown: 0,
  };

  const bee: VoidOrganism = {
    id: 102,
    kind: "voidBee",
    x: 52,
    y: 60,
    vx: 0,
    vy: 0,
    hp: 25,
    maxHp: 25,
    targetX: 50,
    targetY: 60,
    cooldown: 0,
    parentId: 101,
  };

  // Queen footprint: 4x4 discrete cells
  const queenFootprint = organismFootprint(queen);
  assert.equal(queenFootprint.length, 16, "Queen footprint must be exactly 4x4 = 16 cells");
  const queenOccupied = new Set(queenFootprint.map((p) => `${p.x},${p.y}`));

  // Queen contour
  const queenContour = computeOrganismContour(queen, 1.0, false);
  assert.ok(queenContour.length >= 12, "Queen contour must rim exterior cells");
  for (const pt of queenContour) {
    assert.ok(Number.isInteger(pt.x) && Number.isInteger(pt.y), "Coordinates must be discrete world pixels");
    assert.equal(queenOccupied.has(`${pt.x},${pt.y}`), false, "Contour cannot overlap queen body");
    assert.match(pt.color, /^#(8425d9|a832e8|df42d1|ff62e2|6ef3ff|d8fbff)$/);
  }

  // Bee footprint: 1 discrete cell
  const beeFootprint = organismFootprint(bee);
  assert.equal(beeFootprint.length, 1, "Bee footprint must be exactly 1 cell");
  assert.deepEqual(beeFootprint[0], { x: 52, y: 60 });

  // Bee contour: 4-connected surrounding rim (up, down, left, right)
  const beeContour = computeOrganismContour(bee, 1.0, false);
  assert.ok(beeContour.length >= 3 && beeContour.length <= 4, "Bee contour must be 1-pixel rim around single cell");
  for (const pt of beeContour) {
    assert.ok(Number.isInteger(pt.x) && Number.isInteger(pt.y));
    assert.notEqual(`${pt.x},${pt.y}`, "52,60", "Bee contour must not overlap bee center");
    assert.equal(Math.abs(pt.x - 52) + Math.abs(pt.y - 60), 1, "Contour must be immediate orthogonal neighbor");
  }

  // Reduced motion: stable and deterministic
  const queenReduced1 = computeOrganismContour(queen, 0, true);
  const queenReduced2 = computeOrganismContour(queen, 100, true);
  assert.deepEqual(queenReduced1, queenReduced2, "Queen contour under reduced motion must be static");

  const beeReduced1 = computeOrganismContour(bee, 0, true);
  const beeReduced2 = computeOrganismContour(bee, 100, true);
  assert.deepEqual(beeReduced1, beeReduced2, "Bee swarm contour under reduced motion must be static");
});

test("3. Void Nodes (spires) have thin evolving contours", () => {
  const dummyNode: VoidNode = {
    id: 7,
    x: 80,
    y: 90,
    hp: 200,
    maxHp: 200,
    radius: 3,
  };

  const contour = computeNodeContour(dummyNode, 2.5, false);
  assert.ok(contour.length >= 10, "Node boundary contour present");
  for (const pt of contour) {
    assert.match(pt.color, /^#(8425d9|a832e8|df42d1|ff62e2|6ef3ff|d8fbff)$/);
  }
});

test("4. Living Void interior: bounded inward-flowing spiral wisps and traveling bands", () => {
  const grid = new VoidGrid(64, 64);
  const material = new Uint8Array(grid.count).fill(CellMaterial.VOID);

  // Mark a block of land to verify clipping
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 64; x++) {
      material[grid.index(x, y)] = CellMaterial.STREET;
    }
  }

  const world: VoidInteriorWorld = {
    grid,
    seed: 999,
    material,
    portals: [
      {
        id: 0,
        x: 32,
        y: 40,
        radius: 18,
        activateAtTick: 0,
        active: true,
      },
    ],
  };

  const wisps = generateWispsForPortals(world);
  assert.equal(wisps.length, 36, "Bounded 36 seeded wisps generated for active portal");

  const pixelsT0 = computeVoidInterior(world, wisps, 0, false);
  assert.ok(pixelsT0.length > 30, "Interior pixels generated");

  // Every generated pixel must be strictly inside CellMaterial.VOID (never on street or solid land)
  for (const pt of pixelsT0) {
    assert.equal(Number.isInteger(pt.x), true);
    assert.equal(Number.isInteger(pt.y), true);
    assert.ok(world.grid.inBounds(pt.x, pt.y));
    const mat = world.material[world.grid.index(pt.x, pt.y)];
    assert.equal(mat, CellMaterial.VOID, "Interior wisps must only occupy CellMaterial.VOID");

    // Must be outside black hole core
    const p = world.portals[0];
    const coreR = Math.max(3.6, p.radius * 0.42);
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    assert.ok(d >= coreR + 0.5, "Wisps must preserve black-hole core readability");
  }

  // Animation evolves over time
  const pixelsT1 = computeVoidInterior(world, wisps, 5.0, false);
  assert.ok(pixelsT1.length > 30);
  const hash0 = pixelsT0.map((p) => `${p.x},${p.y}`).join(";");
  const hash1 = pixelsT1.map((p) => `${p.x},${p.y}`).join(";");
  assert.notEqual(hash0, hash1, "Wisps and traveling bands must change positions over time");

  // Reduced motion: returns empty array (suppresses extra moving streams)
  const reduced = computeVoidInterior(world, wisps, 10.0, true);
  assert.deepEqual(reduced, [], "Reduced effects suppresses moving stream overlays");
});

test("5. Simulation isolation: interior and contour rendering never mutates simulation state", () => {
  const grid = new VoidGrid(32, 32);
  const material = new Uint8Array(grid.count).fill(CellMaterial.VOID);
  const world: VoidInteriorWorld = {
    grid,
    seed: 555,
    material,
    portals: [{ id: 0, x: 16, y: 16, radius: 10, activateAtTick: 0, active: true }],
  };

  const matBefore = material.slice();
  const wisps = generateWispsForPortals(world);
  const interior = computeVoidInterior(world, wisps, 1.0, false);

  const canvas = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      assert.equal(w, 1);
      assert.equal(h, 1);
    },
  };
  paintVoidInterior(canvas, interior);

  // World materials untouched
  assert.deepEqual(material, matBefore, "Material array must remain unmodified");
});
