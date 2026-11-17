import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGES, MESSAGES, translate } from "../src/i18n/index.ts";
import { VOID_TEXT } from "../src/i18n/void.ts";

test("i18n catalogs have no missing keys, empty translations, or mismatched placeholders", () => {
  const seen = new Set<string>();
  const expectedColumns = 1 + LANGUAGES.length;
  for (const row of MESSAGES) {
    const key = row[0];
    assert.ok(!seen.has(key), `Duplicate i18n key: ${key}`);
    seen.add(key);
    assert.equal(row.length, expectedColumns, `Row ${key} must have ${expectedColumns} columns`);

    const en = row[1];
    assert.ok(en.trim().length > 0, `Empty English text for ${key}`);
    const enPlaceholders = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (let i = 0; i < LANGUAGES.length; i++) {
      const val = row[i + 1];
      assert.ok(val && val.trim().length > 0, `Missing ${LANGUAGES[i].code} translation for ${key}`);
      const placeholders = [...val.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        placeholders,
        enPlaceholders,
        `Placeholder mismatch in ${LANGUAGES[i].code} for ${key}`,
      );
    }
  }
});

test("Void UI translations resolve in every supported language", () => {
  assert.ok(VOID_TEXT.length >= 40, "Expected comprehensive Void UI catalog");
  for (const lang of LANGUAGES) {
    const label = translate(lang.code, "void.tab.battle");
    assert.ok(label.length > 0 && label !== "void.tab.battle");
    const lv = translate(lang.code, "void.insp.lv", { n: 2 });
    assert.ok(lv.includes("2"), `Expected interpolated level in ${lang.code}, got ${lv}`);
  }
});
