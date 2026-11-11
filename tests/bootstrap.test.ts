import assert from "node:assert/strict";
import test from "node:test";
import { decodeVoidSave, defaultVoidSave, loadVoidSave, persistVoidSave } from "../src/void/save.ts";
import { VOID_SAVE_KEY } from "../src/void/config.ts";

test("Void Defense sole-game bootstrap: save isolation and legacy preferences migration", () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };

  const origLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  try {
    // 1. Fresh state with no saves
    store.clear();
    const freshSave = loadVoidSave();
    assert.equal(freshSave.version, 1);
    assert.equal(freshSave.selectedScenario, "tutorialBreach");
    assert.equal(freshSave.settings.reduceMotion, false);

    // 2. Legacy save present in localStorage ("towerdefense.v1"), no void save yet
    store.clear();
    store.set("towerdefense.v1", JSON.stringify({
      version: 2,
      profile: { name: "Commander Nova", flag: { base: 6, layers: [] } },
      settings: { reduceMotion: true, soundOff: true, pixelFont: true },
    }));

    const legacyLoaded = loadVoidSave();
    // Profile and settings adopted seamlessly
    assert.equal(legacyLoaded.profile?.name, "Commander Nova");
    assert.equal(legacyLoaded.settings.reduceMotion, true);
    assert.equal(legacyLoaded.settings.soundOff, true);
    // Legacy save untouched and preserved
    assert.ok(store.has("towerdefense.v1"));
    assert.ok(!store.has(VOID_SAVE_KEY));

    // 3. Persisting saves strictly to voiddefense.v1
    legacyLoaded.selectedScenario = "edgeAdvance";
    persistVoidSave(legacyLoaded);
    assert.ok(store.has(VOID_SAVE_KEY));
    assert.ok(store.has("towerdefense.v1"));

    // 4. Loading again loads from voiddefense.v1 directly
    const reloaded = loadVoidSave();
    assert.equal(reloaded.selectedScenario, "edgeAdvance");
    assert.equal(reloaded.profile?.name, "Commander Nova");
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      value: origLocalStorage,
      configurable: true,
      writable: true,
    });
  }
});

test("Void Defense sole-game bootstrap: settings and tech wallet round-trip cleanly", () => {
  const save = defaultVoidSave();
  save.settings.reduceMotion = true;
  save.settings.developerMode = true;
  save.settings.devMode = true;
  save.settings.magnifier = true;
  save.wallet.lifetimeEssence = 350;
  save.wallet.ranks = { commandCore: 1, supplyDrop: 2 };

  const encoded = JSON.stringify(save);
  const decoded = decodeVoidSave(encoded);

  assert.equal(decoded.settings.reduceMotion, true);
  assert.equal(decoded.settings.developerMode, true);
  assert.equal(decoded.settings.devMode, true);
  assert.equal(decoded.settings.magnifier, true);
  assert.equal(decoded.wallet.lifetimeEssence, 350);
  assert.equal(decoded.wallet.ranks.supplyDrop, 2);
});
