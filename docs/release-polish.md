# Void Defense — Release Polish Checklist

Verified against `main` (`04c477f`) on 2026-11-15.
Baseline checks:
- `npm test`: 106/106 passing
- `npm run build`: clean (`tsc --noEmit && vite build`)
- `npm run test:defense`: passing (`384x512` render p95 = 6 ms, `512x768` render p95 = 8 ms — already under 16 ms target)

## Phase 1: Broken UI, Onboarding & Prep State (P0)
- [x] Style `.void-inspector` in `src/void/void.css` (anchored cleanly, never overlapping HUD or off-screen)
- [x] Style `[data-outcome-banner]` as a centered sci-fi modal with dim backdrop, hiding inspector when open
- [x] Hold simulation while any modal/dialog is open; start runs in a clear `"prep"` / Deploy state with a prominent Start Battle button (preserving `VoidSim` unit test invariants)
- [x] Fix onboarding dialog (`"Welcome, Commander"`): remove/replace medieval wax seal, ensure >= 4.5:1 text contrast, sci-fi styling

## Phase 2: HUD Hierarchy, Phone & Desktop Layouts (P1)
- [x] Phone portrait (`390x844`): single-row compact header, slim speed/status row, horizontally scrollable tower/strike bar with edge fade, map >= 65% height
- [x] Phone landscape (`844x390`): ultra-slim single-row bars so map gets >= 80% height, inspector docked cleanly to right edge
- [x] Desktop (`1280x800`): right-side tactical panel (>= 1000px) with sector info, inspector, warnings, and speed controls
- [x] Improve tab naming (`Battlefield` instead of `Defense Feed`) and currency/control hierarchy

## Phase 3: Title Screen, Settings Modal & Guided First Sector (P1)
- [x] Title screen with pixel-art city skyline + rising Void backdrop, `VOID DEFENSE` logo, Continue / New Game / Settings
- [x] Show `VOID DEFENSE` branding on loading screen (`src/ui/loading-screen.ts`, `index.html`)
- [x] Move Settings from Resistance Map to a header/title Settings modal with Master / SFX / Ambience volume sliders persisted in `voiddefense.v1`, plus `?dev=1` gated Developer Mode
- [x] Guided Sector 01 tactical coach (`coachDone` in `voiddefense.v1`) with contextual step-by-step callouts

## Phase 4: Tech Network, Secondary Screens & Sci-Fi Visual Identity (P1/P2)
- [x] Global Tech Network: frame all visible nodes on init and `Fit View`, minimum legible label size, bottom-sheet detail panel on `<700px`
- [x] Replace medieval alchemical circle behind Tech Network with a holographic tactical grid / star chart
- [x] Sci-fi UI skin pass: eliminate remaining parchment, stone, brass nail, and wax seal styling on dialogs, Resistance Ops, and Resistance Map
- [x] Rename medieval player-facing terms (Hearthseed -> Solar Anchor, Mason Depot -> Repair Depot, Lantern Bearer -> Beacon Drone Post, Quarantine Bell -> Stasis Beacon, real-world NYC names -> fictional) while keeping internal IDs for save compatibility

## Phase 5: Game Feel, Procedural Audio & Outcome Polish (P1/P2)
- [x] Procedural Web Audio SFX in `src/void/audio.ts` (placement, sell, upgrade, cannon fire, impact, collapse, void consume, unit death, strike, victory/defeat, UI click) with voice limiting and volume controls
- [x] Whole-pixel visual feedback in `src/void/render.ts` (placement dust/ring, floating `+N` Supplies ticks, subtle end-of-run flash) respecting `reduceEffects`
- [x] Tiered outcome titles (`City Lost`, `Pyrrhic Containment`, `Breach Contained`, `Flawless Defense`), Spark icons, and sector best-ever display
- [x] In-run Supplies sink (tower Lv 1-3 upgrade tiers in inspector) so late-run Supplies remain meaningful

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run test:defense` passes and screenshots at `1280x800`, `390x844`, `844x390` inspected
- [ ] `npm run test:pixels`, `test:crisp`, `test:ledge`, `test:visuals`, `test:farms`, `test:depth` pass
