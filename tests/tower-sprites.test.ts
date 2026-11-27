import assert from "node:assert/strict";
import test from "node:test";
import { TOWER_SPRITES, forEachTowerSpritePixel } from "../src/void/tower-sprites.ts";
import { TOWER_SPECS } from "../src/void/towers.ts";
import type { TowerTypeId } from "../src/void/model.ts";

test("Every tower has a whole-pixel sprite matching its footprint", () => {
  for (const type of Object.keys(TOWER_SPECS) as TowerTypeId[]) {
    const spec = TOWER_SPECS[type];
    const sprite = TOWER_SPRITES[type];
    assert.ok(sprite, `${type} has a sprite`);
    assert.equal(sprite.top.length, sprite.over + spec.h, `${type} roof rows`);
    for (const row of [...sprite.top, ...sprite.face]) assert.equal(row.length, spec.w, `${type} row width`);
    // The roof itself is fully opaque so the footprint never shows holes.
    for (const row of sprite.top.slice(sprite.over)) assert.ok(!row.includes("."), `${type} solid roof`);
  }
});

test("Tower sprite pixels land on whole cells with resolved colours", () => {
  const state = { tick: 37, uid: 3, fired: true, fill: 0.6, venting: true, reduceEffects: false };
  for (const type of Object.keys(TOWER_SPECS) as TowerTypeId[]) {
    const spec = TOWER_SPECS[type];
    let count = 0;
    forEachTowerSpritePixel(type, spec.color, spec.w, spec.h, 2, state, (dx, dy, color, light) => {
      count++;
      assert.ok(Number.isInteger(dx) && Number.isInteger(dy), `${type} integer pixel`);
      assert.ok(dx >= 0 && dx < spec.w, `${type} stays in its columns`);
      assert.ok(dy < spec.h + 2, `${type} stays above its base`);
      assert.match(color, /^#[0-9a-f]{6}$/i);
      assert.ok(light === "top" || light === "front" || light === "emit");
    });
    assert.ok(count >= spec.w * (spec.h + 2), `${type} paints its roof and wall`);
  }
});
