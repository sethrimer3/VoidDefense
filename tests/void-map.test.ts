import assert from "node:assert/strict";
import test from "node:test";
import { MAP_CITIES, MAP_H, MAP_W, cityStates, frontier, sectorUnlocked, trailPath, trailsWalked } from "../src/void/map/progress.ts";
import { SCENARIOS } from "../src/void/maps.ts";
import { decodeVoidSave, defaultVoidSave } from "../src/void/save.ts";
import { emptyTechWallet, recordScenarioResult } from "../src/void/tech/wallet.ts";

test("Resistance Map: every sector is a city on the map, in campaign order", () => {
  assert.deepEqual(MAP_CITIES.map((c) => c.id), SCENARIOS.map((s) => s.id));
  for (const c of MAP_CITIES) {
    assert.ok(c.x - c.r >= 0 && c.x + c.r < MAP_W && c.y - c.r >= 0 && c.y + c.r < MAP_H, c.id);
  }
});

test("Resistance Map: beating a sector opens the next, draws its trail and moves the urgent frontier", () => {
  const w = emptyTechWallet();
  assert.deepEqual(cityStates(w), ["open", ...Array(7).fill("locked")]);
  assert.equal(frontier(w), 0);
  assert.deepEqual(trailsWalked(w), []);
  assert.equal(sectorUnlocked(w, "edgeAdvance"), false);

  // A loss opens nothing.
  recordScenarioResult(w, "tutorialBreach", "underSiege", false, 40, 0, 10);
  assert.equal(sectorUnlocked(w, "edgeAdvance"), false);

  recordScenarioResult(w, "tutorialBreach", "buildAndWatch", true, 80, 2, 10);
  assert.deepEqual(cityStates(w).slice(0, 3), ["beaten", "open", "locked"]);
  assert.deepEqual(trailsWalked(w), [0]);
  assert.equal(frontier(w), 1);
  assert.ok(sectorUnlocked(w, "edgeAdvance"));

  // Developer Mode opens everything, but the frontier stays the next unbeaten on the route.
  assert.ok(cityStates(w, true).every((s) => s !== "locked"));
  assert.equal(frontier(w, true), 1);

  // Endless, at the route's end, counts once attempted.
  for (const c of MAP_CITIES.slice(1, -1)) recordScenarioResult(w, c.id, "underSiege", true, 70, 1, 5);
  assert.equal(frontier(w), MAP_CITIES.length - 1);
  recordScenarioResult(w, "endless", "underSiege", false, 0, 0, 5);
  assert.equal(frontier(w), -1);
  assert.equal(trailsWalked(w).length, MAP_CITIES.length - 1);
});

test("Resistance Map: trails are unbroken pixel paths between neighbouring cities", () => {
  for (let i = 0; i + 1 < MAP_CITIES.length; i++) {
    const pts = trailPath(i);
    assert.ok(pts.length > 10);
    for (let k = 1; k < pts.length; k++) {
      assert.ok(Math.abs(pts[k].x - pts[k - 1].x) <= 1 && Math.abs(pts[k].y - pts[k - 1].y) <= 1, `trail ${i} gap at ${k}`);
    }
    for (const p of pts) assert.ok(p.x >= 0 && p.x < MAP_W && p.y >= 0 && p.y < MAP_H);
  }
});

test("Resistance Map: drawn-trail progress round-trips through the save and stays optional", () => {
  const s = defaultVoidSave();
  assert.equal(decodeVoidSave(JSON.stringify(s)).mapRevealed, undefined);
  s.mapRevealed = 3;
  assert.equal(decodeVoidSave(JSON.stringify(s)).mapRevealed, 3);
  assert.equal(decodeVoidSave(JSON.stringify({ ...s, mapRevealed: "x" })).mapRevealed, undefined);
});
