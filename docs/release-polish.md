# Void Defense — Release Polish Checklist

Verified against `main` (`04c477f`) on 2026-11-15.
Baseline checks:
- `npm test`: 106/106 passing
- `npm run build`: clean (`tsc --noEmit && vite build`)
- `npm run test:defense`: passing (`384x512` render p95 = 6 ms, `512x768` render p95 = 8 ms — already under 16 ms target)

## Phase 1: Broken UI, Onboarding & Prep State (P0)
- [ ] Style `.void-inspector` in `src/void/void.css` (anchored cleanly, never overlapping HUD or off-screen)
- [ ] Style `[data-outcome-banner]` as a centered sci-fi modal with dim backdrop, hiding inspector when open
- [ ] Hold simulation while any modal/dialog is open; start runs in a clear `"prep"` / Deploy state with a prominent Start Battle button (preserving `VoidSim` unit test invariants)
- [ ] Fix onboarding dialog (`"Welcome, Commander"`): remove/replace medieval wax seal, ensure >= 4.5:1 text contrast, sci-fi styling

## Phase 2: HUD Hierarchy, Phone & Desktop Layouts (P1)
- [ ] Phone portrait (`390x844`): single-row compact header, slim speed/status row, horizontally scrollable tower/strike bar with edge fade, map >= 65% height
- [ ] Phone landscape (`844x390`): compact left rail or slim bars so map gets >= 80% height
- [ ] Desktop (`1280x800`): right-side tactical panel (>= 1000px) with sector info, inspector, warnings, and speed controls
- [ ] Improve tab naming (`Battlefield` instead of `Defense Feed`) and currency/control hierarchy

## Phase 3: Title Screen, Settings Modal & Guided First Sector (P1)
- [ ] Title screen with pixel-art city skyline + rising Void backdrop, `VOID DEFENSE` logo, Continue / New Game / Settings
- [ ] Show `VOID DEFENSE` branding on loading screen (`src/ui/loading-screen.ts`, `index.html`)
- [ ] Move Settings from Resistance Map to a header/title Settings modal with Master / SFX / Ambience volume sliders persisted in `voiddefense.v1`, plus `?dev=1` gated Developer Mode
- [ ] Guided Sector 01 tactical coach (`coachDone` in `voiddefense.v1`) with contextual step-by-step callouts

## Phase 4: Tech Network, Secondary Screens & Sci-Fi Visual Identity (P1/P2)
- [ ] Global Tech Network: frame all visible nodes on init and `Fit View`, minimum legible label size, bottom-sheet detail panel on `<700px`
- [ ] Replace medieval alchemical circle behind Tech Network with a holographic tactical grid / star chart
- [ ] Sci-fi UI skin pass: eliminate remaining parchment, stone, brass nail, and wax seal styling on dialogs, Resistance Ops, and Resistance Map
- [ ] Rename medieval player-facing terms (e.g. Hearthseed, Mason Depot, Lantern Bearer, Quarantine Bell, real-world NYC names) while keeping internal IDs for save compatibility

## Phase 5: Game Feel, Procedural Audio & Outcome Polish (P1/P2)
- [ ] Procedural Web Audio SFX in `src/void/audio.ts` (placement, sell, cannon fire, impact, collapse, void consume, unit death, strike, victory/defeat, UI click) with voice limiting and volume controls
- [ ] Whole-pixel visual feedback in `src/void/render.ts` (placement dust/ring, floating `+N` Supplies ticks, subtle end-of-run flash/slow-mo) respecting `reduceEffects`
- [ ] Tiered outcome titles (`City Lost`, `Pyrrhic Containment`, `Containment`, `Flawless Defense`), Spark icons, and sector best-ever display
- [ ] In-run Supplies sink (tower overcharge/upgrade tiers in inspector) so late-run Supplies remain meaningful

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run test:defense` passes and screenshots at `1280x800`, `390x844`, `844x390` inspected
- [ ] `npm run test:pixels`, `test:crisp`, `test:ledge`, `test:visuals`, `test:farms`, `test:depth` pass
