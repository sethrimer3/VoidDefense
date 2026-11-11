import assert from "node:assert/strict";
import test from "node:test";
import { decodeSettings, defaultSettings, SETTINGS, settingValue, type Setting, type SettingKey } from "../src/settings.ts";

const rows = Object.entries(SETTINGS) as [SettingKey, Setting][];
const decoded = (settings: unknown) => decodeSettings(settings);

/** Values each setting's row allows, and ones a save could hold that it doesn't. */
function values(row: Setting): { good: unknown[]; bad: unknown[] } {
  switch (row.kind) {
    case "toggle": return { good: [true, false], bad: ["yes", 1, 0, null, {}] };
    case "choice": return { good: row.choices.map(([c]) => c), bad: [String(row.choices[0][0]) + "x", null, [], row.default === 3 ? "3" : 3] };
    case "range": return { good: [row.min, row.max, row.default], bad: ["50", NaN, Infinity, null] };
  }
}

test("every setting defaults to a value its own row allows", () => {
  const d = defaultSettings();
  assert.deepEqual(Object.keys(d), Object.keys(SETTINGS));
  for (const [key, row] of rows) assert.equal(settingValue(row, d[key]), d[key], key);
});

test("each setting keeps every value it allows and defaults the rest", () => {
  for (const [key, row] of rows) {
    const { good, bad } = values(row);
    for (const v of good) assert.equal(decoded({ [key]: v })[key], v, `${key} = ${JSON.stringify(v)}`);
    for (const v of bad) assert.equal(decoded({ [key]: v })[key], row.default, `${key} = ${String(v)}`);
  }
});

test("settings on the page have their own control ids", () => {
  const ids = rows.flatMap(([, row]) => (row.page ? [row.page.id] : []));
  assert.equal(new Set(ids).size, ids.length);
});

test("grid opacity defaults to 30 percent and preserves every 5-percent step, including zero", () => {
  assert.equal(defaultSettings().gridOpacity, 30);
  assert.equal(decoded({}).gridOpacity, 30);
  for (let value = 0; value <= 100; value += 5) assert.equal(decoded({ gridOpacity: value }).gridOpacity, value);
  for (const [raw, expected] of [[-10, 0], [104, 100], [17, 15], [27, 25], [28, 30], [97.5, 100]]) {
    assert.equal(decoded({ gridOpacity: raw }).gridOpacity, expected, `saved opacity ${raw}`);
  }
});

test("grid colours persist only the five supported names and keep gold for older saves", () => {
  assert.equal(decoded({}).gridColor, "gold");
  for (const value of ["white", "brown", "black", "gray", "gold"]) assert.equal(decoded({ gridColor: value }).gridColor, value);
  for (const value of ["red", "#ffffff", "", {}, null, 0]) assert.equal(decoded({ gridColor: value }).gridColor, "gold");
});

test("legacy graphics is opt-in and round-trips independently of Pixel Art", () => {
  assert.equal(defaultSettings().legacyGraphics, false);
  assert.equal(decoded({ pixelArt: true }).legacyGraphics, false);
  const settings = defaultSettings();
  settings.legacyGraphics = true;
  settings.pixelArt = false;
  const restored = decodeSettings(settings);
  assert.equal(restored.legacyGraphics, true);
  assert.equal(restored.pixelArt, false);
});

test("dragged items ride above the finger by default only on touch screens", () => {
  const was = (globalThis as any).matchMedia;
  try {
    for (const coarse of [true, false]) {
      (globalThis as any).matchMedia = (q: string) => ({ matches: q === "(pointer: coarse)" && coarse });
      assert.equal(defaultSettings().raiseDrag, coarse, "a new game");
      assert.equal(decoded({}).raiseDrag, coarse, "a save from before the setting");
      assert.equal(decoded({ raiseDrag: !coarse }).raiseDrag, !coarse, "the player's own choice is kept");
    }
  } finally {
    (globalThis as any).matchMedia = was;
  }
});
