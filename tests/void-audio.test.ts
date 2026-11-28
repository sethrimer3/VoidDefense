import { test } from "node:test";
import assert from "node:assert/strict";
import { random, stream } from "../src/random.ts";
import {
  cityDetailZoomGain,
  computeVoidBedParams,
  createAudioRng,
  fireZoomGain,
  mergeCollapseEvents,
  screenToSpatial,
  selectFireVoices,
} from "../src/void/audio-math.ts";

test("screenToSpatial pans 0 at centre and stays within +-0.6", () => {
  const centre = screenToSpatial(400, 300, 800, 600);
  assert.equal(centre.pan, 0);
  assert.equal(centre.onScreen, true);
  assert.equal(centre.distGain, 1);

  const leftEdge = screenToSpatial(0, 300, 800, 600);
  assert.ok(leftEdge.pan <= -0.59 && leftEdge.pan >= -0.6);

  const rightEdge = screenToSpatial(800, 300, 800, 600);
  assert.ok(rightEdge.pan >= 0.59 && rightEdge.pan <= 0.6);

  const farLeft = screenToSpatial(-5000, 300, 800, 600);
  assert.equal(farLeft.pan, -0.6);
  assert.equal(farLeft.onScreen, false);
  assert.ok(farLeft.distGain < centre.distGain);
  assert.ok(farLeft.lpfHz < centre.lpfHz);

  const farRight = screenToSpatial(9000, 300, 800, 600);
  assert.equal(farRight.pan, 0.6);
  assert.equal(farRight.onScreen, false);
});

test("fireZoomGain is 0 at zoom 1 and rises monotonically with zoom", () => {
  assert.equal(fireZoomGain(0.85), 0);
  assert.equal(fireZoomGain(1), 0);
  assert.equal(fireZoomGain(1.4), 0);

  let prev = 0;
  for (const z of [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.5]) {
    const g = fireZoomGain(z);
    assert.ok(g >= prev, `fireZoomGain(${z})=${g} should be >= ${prev}`);
    prev = g;
  }
  assert.equal(fireZoomGain(5.0), 1);
  assert.equal(fireZoomGain(8.0), 1);
  assert.equal(cityDetailZoomGain(1.0), 0);
  assert.ok(cityDetailZoomGain(4.5) === 1);
});

test("computeVoidBedParams widens stereo with takeover and horizontal extent", () => {
  const small = computeVoidBedParams(98, 40, 0, 0.05, 0.5);
  const medium = computeVoidBedParams(60, 400, 5, 0.4, 0.5);
  const large = computeVoidBedParams(15, 1100, 25, 0.9, 0.5);

  assert.ok(small.width < medium.width, "width should grow from small to medium Void");
  assert.ok(medium.width < large.width, "width should grow from medium to large Void");
  assert.ok(small.rumbleGain < large.rumbleGain, "rumble should grow with Void size");
  assert.ok(small.bodyGain < large.bodyGain, "mid-low body should grow with Void size");
  assert.ok(small.quakeIntensity < large.quakeIntensity, "earthquake intensity should grow");

  const leftVoid = computeVoidBedParams(80, 200, 0, 0.2, 0.1);
  const rightVoid = computeVoidBedParams(80, 200, 0, 0.2, 0.9);
  assert.ok(leftVoid.pan < 0, "Void on left should pan left");
  assert.ok(rightVoid.pan > 0, "Void on right should pan right");
});

test("selectFireVoices picks nearest visible fires and never exceeds pool size", () => {
  const candidates = [
    { id: 1, screenX: 400, screenY: 300, kind: 0 as const }, // dead centre
    { id: 2, screenX: 460, screenY: 310, kind: 1 as const }, // near centre right
    { id: 3, screenX: 250, screenY: 280, kind: 2 as const }, // mid left
    { id: 4, screenX: 700, screenY: 500, kind: 0 as const }, // corner
    { id: 5, screenX: 100, screenY: 100, kind: 1 as const }, // other corner
    { id: 6, screenX: 420, screenY: 295, kind: 2 as const }, // very close to centre
    { id: 7, screenX: -400, screenY: 300, kind: 2 as const }, // off-screen
  ];

  // Silent at overview zoom
  assert.deepEqual(selectFireVoices(candidates, 800, 600, 1.0, 4), []);

  // Zoomed in: capped to pool size 4, off-screen excluded, closest fires chosen first
  const picked = selectFireVoices(candidates, 800, 600, 4.5, 4);
  assert.equal(picked.length, 4);
  assert.ok(!picked.some((v) => v.id === 7), "off-screen fire should not be selected");
  assert.ok(picked.some((v) => v.id === 1), "centre fire should be selected");
  assert.ok(picked.some((v) => v.id === 6), "near-centre large fire should be selected");
  for (const v of picked) {
    assert.ok(v.pan >= -0.6 && v.pan <= 0.6, `pan ${v.pan} must stay within +-0.6`);
    assert.ok(v.gain > 0 && v.gain <= 1);
  }
});

test("mergeCollapseEvents combines simultaneous collapses and caps voices", () => {
  assert.deepEqual(mergeCollapseEvents([]), []);

  const merged = mergeCollapseEvents(
    [
      { x: 100, y: 200, size: 4 },
      { x: 140, y: 240, size: 12 },
      { x: 120, y: 220, size: 20 },
    ],
    1,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 3);
  assert.equal(merged[0].size, 24, "combined magnitude is capped at 24");
  assert.ok(merged[0].x > 100 && merged[0].x < 140);

  const two = mergeCollapseEvents(
    [
      { x: 10, y: 10, size: 8 },
      { x: 300, y: 300, size: 6 },
      { x: 14, y: 12, size: 4 },
    ],
    2,
  );
  assert.equal(two.length, 2);
});

test("audio modules are Node-safe and never consume shared game/effects random streams", async () => {
  // Capture the next values expected from the pinned streams before importing audio modules
  const effects = stream("effects");
  const game = stream("game");
  const pinnedSeed = (globalThis as { __pinnedSeeds?: Record<string, number> }).__pinnedSeeds?.game;
  assert.ok(typeof pinnedSeed === "number", "pin-random.ts should pin the game stream seed");

  // Import and exercise all audio modules in Node (no window / AudioContext)
  const beforeEffects = effects();
  const beforeGame = game();

  const soundMod = await import("../src/sound.ts");
  const audioMod = await import("../src/void/audio.ts");
  const musicMod = await import("../src/void/music.ts");

  assert.equal(soundMod.audioGraph(), null);
  soundMod.setBusVolumes(0.8, 0.85, 0.65, 0.5);
  soundMod.syncAudioFocus(false);

  const sfx = new audioMod.VoidSoundEngine();
  sfx.setVolumes(0.8, 0.85, 0.65, 0.5);
  sfx.update(80, 120, true, 5);
  sfx.playSfx("collapse", 1.2);
  sfx.playCollapse(10);
  sfx.playStrike("quarantineBell");
  sfx.playTowerShot("chronoCannon");
  sfx.playAnimalSound("sheep");
  sfx.dispose();

  const music = new musicMod.VoidMusicEngine();
  music.setVolumes(0.8, 0.5);
  music.update("battle", 200, 1000);
  music.triggerOutcome("won");
  music.destroy();

  // Private RNG works deterministically without touching shared streams
  const priv = createAudioRng(12345);
  assert.ok(priv() >= 0 && priv() < 1);

  // Verify the next draw from both shared streams matches a fresh pinned generator
  // advanced by the exact same 1 draw (no extra draws consumed by audio imports/calls)
  const freshGame = random(pinnedSeed ^ Math.imul(1, 0x9e3779b9));
  const freshEffects = random(pinnedSeed ^ Math.imul(2, 0x9e3779b9));
  assert.equal(beforeGame, freshGame());
  assert.equal(beforeEffects, freshEffects());
  assert.equal(game(), freshGame());
  assert.equal(effects(), freshEffects());
});
