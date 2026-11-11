import assert from "node:assert/strict";
import test from "node:test";
import { VoidGrid } from "../src/void/grid.ts";
import { paintVoidLedge } from "../src/void/ledge.ts";
import { CellMaterial } from "../src/void/model.ts";

function scene() {
  const grid = new VoidGrid(24, 24);
  const world = { grid, seed: 123, material: new Uint8Array(grid.count).fill(CellMaterial.VOID),
    landCover: new Uint8Array(grid.count) };
  const edge: number[] = [];
  for (let x = 3; x < 21; x++) {
    for (let y = 0; y <= 5; y++) world.material[grid.index(x, y)] = CellMaterial.PARK;
    edge.push(grid.index(x, 5));
  }
  return { world, edge };
}
function render(world: ReturnType<typeof scene>["world"], edge: number[]) {
  const pixels: { x: number; y: number; color: string }[] = [];
  const pen = { fillStyle: "", fillRect(x: number, y: number, w: number, h: number) {
    assert.equal(w, 1); assert.equal(h, 1);
    assert.ok(Number.isInteger(x) && Number.isInteger(y));
    pixels.push({ x, y, color: this.fillStyle });
  } };
  paintVoidLedge(pen, world, edge);
  return pixels;
}

test("Void ledges have deterministic irregular depth, strata and a dark underside", () => {
  const { world, edge } = scene();
  const pixels = render(world, edge);
  assert.deepEqual(pixels, render(world, edge));
  assert.ok(pixels.some(p => p.color === "#846443"), "exposed earth lip");
  assert.ok(pixels.some(p => p.color === "#08060f"), "undercut shadow");
  const bottoms = new Set(Array.from({ length: 14 }, (_, n) =>
    Math.max(...pixels.filter(p => p.x === n + 5).map(p => p.y))));
  assert.ok(bottoms.size >= 2, "the underside must vary rather than form a uniform border");
});

test("Ledges only occupy existing Void, preserve ground/islands, and do not mutate simulation", () => {
  const { world, edge } = scene();
  world.material[world.grid.index(10, 8)] = CellMaterial.RECLAIMED;
  const before = world.material.slice();
  const pixels = render(world, edge);
  assert.ok(pixels.length > 20);
  for (const p of pixels) assert.equal(world.material[world.grid.index(p.x, p.y)], CellMaterial.VOID);
  assert.ok(!pixels.some(p => p.x === 10 && p.y >= 8), "front face stops at the reclaimed island");
  assert.deepEqual(world.material, before);
});

test("Water has no soil cross-section; constructed terrain exposes rock instead of dirt", () => {
  const { world, edge } = scene();
  for (const i of edge) world.material[i] = CellMaterial.UNCLAIMED;
  assert.deepEqual(render(world, edge), []);
  for (const i of edge) world.material[i] = CellMaterial.RECLAIMED;
  assert.ok(render(world, edge).some(p => p.color === "#868080"));
});
