import assert from "node:assert/strict";
import test from "node:test";
import { isBoulevardOrAvenueLaneAt } from "../src/void/lighting.ts";
import { CellMaterial } from "../src/void/model.ts";
import { VoidSim } from "../src/void/sim.ts";
import { CURB_LIGHT_SPACING, StreetGlow, streetGlowAt, streetGlowSpillAt } from "../src/void/street-glow.ts";
import { emptyTechWallet } from "../src/void/tech/wallet.ts";

test("curb lines carry spaced inset light dots instead of a solid line, and major intersections get rings", () => {
  const sim = new VoidSim("centralRupture", "buildWatch", emptyTechWallet(), true);
  const { world } = sim;
  const { w, count } = world.grid;
  let lights = 0, seams = 0, rings = 0;
  for (let i = 0; i < count; i++) {
    const code = streetGlowAt(world, i);
    const x = i % w, y = (i - x) / w;
    if (code === StreetGlow.CURB_LIGHT) {
      lights++;
      assert.ok(isBoulevardOrAvenueLaneAt(world, x, y), "lights sit on curb lines");
      assert.equal((x + y) % CURB_LIGHT_SPACING, 0);
      assert.equal(streetGlowSpillAt(world, i), 3);
    } else if (code === StreetGlow.CURB_SEAM) seams++;
    else if (code === StreetGlow.RING) rings++;
  }
  assert.ok(lights >= 50, `expected curb lights, got ${lights}`);
  assert.ok(seams > lights * 4, "most of a curb line is a quiet seam between lights");
  assert.ok(rings >= 20, `expected intersection rings, got ${rings}`);
  // Glow goes out with the street.
  const lit = Array.from({ length: count }, (_, i) => i).find((i) => streetGlowAt(world, i) === StreetGlow.CURB_LIGHT)!;
  world.material[lit] = CellMaterial.VOID;
  assert.equal(streetGlowAt(world, lit), 0);
  assert.equal(streetGlowSpillAt(world, lit), 0);
});
