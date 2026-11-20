import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS } from "../src/void/maps.ts";
import { VoidWorld } from "../src/void/world.ts";
import { CellMaterial } from "../src/void/model.ts";
import {
  collectBuildingDoors,
  findStreetPath,
  TRON_CYCLE_COLORS,
} from "../src/void/render.ts";

test("Tron vehicles: routes connect distant random buildings across city streets", () => {
  const world = new VoidWorld(SCENARIOS[0]);
  const doors = collectBuildingDoors(world);
  assert.ok(doors.length >= 10, `expected >= 10 building doors, got ${doors.length}`);

  // Pick two distant buildings on opposite ends of the door list
  const start = doors[0];
  let far = doors[doors.length - 1];
  for (const d of doors) {
    const manhattan = Math.abs(d.x - start.x) + Math.abs(d.y - start.y);
    if (manhattan > Math.abs(far.x - start.x) + Math.abs(far.y - start.y)) {
      far = d;
    }
  }

  const dist = Math.abs(far.x - start.x) + Math.abs(far.y - start.y);
  assert.ok(dist > 60, `expected distant buildings (>60 cells apart), got ${dist}`);

  const path = findStreetPath(world, start.x, start.y, far.x, far.y);
  assert.ok(path !== null, "expected valid street path between distant buildings");
  assert.equal(path[0].x, start.x);
  assert.equal(path[0].y, start.y);
  assert.equal(path[path.length - 1].x, far.x);
  assert.equal(path[path.length - 1].y, far.y);

  for (let i = 0; i < path.length; i++) {
    const pt = path[i];
    const idx = world.grid.index(pt.x, pt.y);
    assert.equal(world.material[idx], CellMaterial.STREET);
    assert.notEqual(world.streetTier[idx], 8);
    if (i > 0) {
      const step = Math.abs(pt.x - path[i - 1].x) + Math.abs(pt.y - path[i - 1].y);
      assert.equal(step, 1, "path steps must be orthogonal 1-cell moves");
    }
  }
});

test("Tron vehicles: palette uses neon blue/cyan colors", () => {
  assert.ok(TRON_CYCLE_COLORS.length > 0);
  for (const hex of TRON_CYCLE_COLORS) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    assert.equal(b, 255, `expected full blue channel in ${hex}`);
    assert.ok(g >= 200, `expected high cyan-blue green channel in ${hex}, got ${g}`);
    assert.ok(r <= 110, `expected low red channel in ${hex}, got ${r}`);
  }
});
