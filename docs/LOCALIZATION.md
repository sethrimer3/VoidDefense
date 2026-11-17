# Languages

Settings → Language opens a three-column menu. Buttons always use native language names, making English easy to find again. The selected language is saved in `settings.language` in the existing local save. Old saves and unsupported language codes use English. Selection applies immediately; it does not reload the page, reset workers, or end a defense.

The first release includes English, Spanish, French, German, Brazilian Portuguese, Italian, Japanese, Korean and Simplified Chinese. Settings, navigation, resource names/prices, primary Defend controls, Mine/Library purchase controls, Tiles filters and common research actions are translated. Building/unit names, upgrade descriptions, story text, statistics explanations and many contextual dialogs still use their original English. The picker and Settings explain this partial coverage. Translations are maintained locally, with no translation service or network dependency; native-speaker review remains useful.

## Catalog and rendering

- `src/i18n/languages.ts` defines stable language codes and native names. `settings.ts` derives the saved choice from this list.
- `core.ts`, `settings.ts`, and `void.ts` under `src/i18n/` contain rows of plain text: key, English, Spanish, French, German, Portuguese, Italian, Japanese, Korean, Chinese. Every locale must preserve the English row's `{placeholders}`. Keep HTML out of messages. Non-English rows in `void.ts` are machine-translated first passes pending native-speaker review.
- `t(key, values)` selects a message; `translate(locale, key, values)` is the pure version. Missing translations use English. Message keys are checked by TypeScript. Interpolated values are literal, not replacement patterns.
- Call `t()` where dynamic HTML is built. For persistent static labels, place `data-i18n="key"` on the text-only element; `translateWithin()` updates these without replacing buttons, listeners, canvases or focus. `data-i18n-title` and `data-i18n-aria-label` translate those attributes. Do not annotate an element containing interactive children.
- Include `getLanguage()` in cached text signatures (Mine/Library). The app updates annotations on selection; pages redraw dynamic labels through their existing show/refresh methods. There is no DOM observer or additional animation loop.
- Never translate save IDs, resource keys, enum values, CSS selectors, player/worker names or combat calculations. This is presentation only. English stays the default for existing and new players.

The bundled Latin display fonts remain the default. Alembic includes the accented letters and punctuation used by all six Latin-language catalogs, with coverage checked alongside its generated font files. Japanese, Korean and Chinese use installed system fonts via `--font`, because Alembic and Cinzel lack these glyphs. Native language-choice buttons also use the system font so they remain readable from every locale. The player's Use Custom Font preference is retained and applies again on returning to a Latin-script language. There are no remote font requests.

## Extending coverage

Add a stable semantic key and all nine translations to the appropriate catalog, then explicitly replace that UI label. For a new language, add the code/native name/script to `LANGUAGES`, extend `TranslationRow`, and add its column to every row. Keep untranslated English fallback honest in the coverage note. Review long labels at 320px and in landscape, and review new scripts on real target devices.

`tests/i18n.test.ts` checks catalog completeness, matching placeholders, fallback, migration and unchanged gameplay data. `tests/languages.mjs` checks the real nine-language picker at desktop/phone/landscape sizes, saved selection/reload, persistent pages, keyboard dismissal, active battles and invalid saves:

```sh
npm test
npm run build
# With the dev server running:
PLAYWRIGHT_EXECUTABLE=/usr/bin/chromium node tests/languages.mjs
```

Browser screenshots go to the ignored `test-results/` directory.
