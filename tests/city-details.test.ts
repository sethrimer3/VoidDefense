import assert from "node:assert/strict";
import test from "node:test";
import { CityDetail, cityDetailAt, halogenLamps, halogenPoolCell, isHalogenPoolAt } from "../src/void/city-details.ts";
import { rooftopPropAt } from "../src/void/elevation.ts";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("Cities dress themselves with crosswalks, furniture, halogen lamps and rooftop props", () => {
  const { world } = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet());
  const counts = new Map<number, number>();
  for (let i = 0; i < world.grid.count; i++) {
    const code = cityDetailAt(world, i);
    if (code === 0) continue;
    assert.equal(world.material[i], CellMaterial.STREET, "Details sit on street ground only");
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  assert.ok((counts.get(CityDetail.CROSSWALK) ?? 0) > 200, "Intersections carry zebra crosswalks");
  assert.ok((counts.get(CityDetail.MANHOLE_CORE) ?? 0) > 5, "Roads carry manholes");
  assert.ok((counts.get(CityDetail.BENCH) ?? 0) + (counts.get(CityDetail.PLANTER_LEAF) ?? 0) > 10, "Sidewalks carry furniture");
  const lamps = halogenLamps(world);
  assert.ok(lamps.length >= 12 && lamps.length <= 80, `Occasional halogen lamps, got ${lamps.length}`);
  for (const l of lamps) {
    const pool = halogenPoolCell(l);
    assert.ok(isHalogenPoolAt(world, pool.x, pool.y));
  }
  let props = 0;
  for (const b of world.buildings) for (const i of b.cells) if (rooftopPropAt(world, b, i % world.grid.w, Math.floor(i / world.grid.w))) props++;
  assert.ok(props > 200, `Rooftops carry props, got ${props}`);

  // Same seed, same city dressing
  const again = new VoidSim("tutorialBreach", "underSiege", emptyTechWallet()).world;
  assert.deepEqual(halogenLamps(again), lamps);
  for (let i = 0; i < world.grid.count; i += 97) assert.equal(cityDetailAt(again, i), cityDetailAt(world, i));
});
