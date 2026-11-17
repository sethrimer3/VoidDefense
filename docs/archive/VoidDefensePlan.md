# Void Defense: Implementation Plan for AI Coding Agents

**Repository:** https://github.com/sethrimer3/VoidDefense (never push Void Defense changes to `sethrimer3/TowerDefense`)  
**New implementation roadmap:** `VoidDefensePlan.md`  
**Original brainstorming transcript:** `VoidDefence.md`  
**Visual reference gallery:** [`docs/void-defense/visual-references.md`](docs/void-defense/visual-references.md)  
**Status:** Implementation roadmap with a **blocking visual-quality recovery gate**. Argon reports implementation complete, but completion is **not independently verified on this branch**, and the current screenshot has **not passed user visual acceptance**.  
**Primary goal:** Transform the existing medieval-scale TowerDefense game into a new, futuristic, large-scale, pixel-art, physics-driven incremental tower-defense game in which a united human Resistance fights an expanding cosmic void.

> **Agent directive:** Follow this plan in order, but inspect the current repository before editing each subsystem. This document describes targets, not a claim that the new mechanics already exist. Preserve useful TowerDefense infrastructure, avoid transplanting obsolete medieval economics or wave logic, keep a playable vertical slice after each milestone, and do not treat speculative balance numbers as final requirements.

## Implementation progress tracker

**Snapshot:** 2026-11-09 (review of repository's `main` branch plus user-supplied prototype, target-gameplay and cinematic stills). **Visual gate remains open regardless of agent-reported feature completion.**
**Tracking rule:** A phase is **complete** only when its source, tests, screenshots (if visual), and acceptance gate have been verified on a named Git branch/commit. An agent's plan or an unverified screenshot is not sufficient to check off an entire phase.

### Confirmed planning work
- [x] Original concept and dialogue captured in `VoidDefence.md`.
- [x] Phased implementation roadmap written and code-reuse opportunities reviewed in this file.
- [x] Argon's revised technical execution proposal reviewed in conversation. **Proposal only; not evidence of implementation.**

### Implementation phase checklist

| Phase | Verified complete? | Current evidence and remaining gate |
| --- | --- | --- |
| 0. Baseline and recovery | - [x] | Protected tags `pre-void-baseline` and `visual-recovery-pre-v1` created; `src/void/config.ts`, `docs/architecture/void-defense.md`, and `docs/void-defense-progress.md` committed; full baseline + Void test suite passes. |
| 1. New shell and saves | - [x] | Verified in `src/void/save.ts` (`voiddefense.v1`), `src/void/main.ts`, and `tests/void-defense.test.ts` (Save Isolation & Offline Invariant); `towerdefense.v1` preserved untouched (`tests/void-defense.mjs`). |
| 2. Metropolitan city renderer | - [ ] | **V1–V4 visual recovery implemented** in `src/void/world.ts`, `src/void/render.ts`, `src/void/void-field.ts`, and `src/void/physics.ts` (6 architectural styles, L/U/octagonal/twin-tower footprints, 7 rooftop features, multi-step NW shadows, arterial avenues with traffic, prismatic event-horizon portal, disease-like Void tendrils). Standardized screenshots (`test-results/void-v1-city-overview.png` .. `void-v5-reduced-effects.png`) and busy-siege benchmarks (`192x256` sim `0.5ms` / render `2.5ms` p50; `256x384` sim `1.9ms` / render `8.7ms` p50) recorded. **Awaiting user visual acceptance review to close gate.** |
| 3. Destructible city physics | - [x] | Verified in `src/void/physics.ts` (`consumeCellIntoVoid`, connected-component structural support collapse, curved inward prismatic/ember `DebrisFragment` streams, `depositMatterDisc` with `ShockwaveEffect`) and `tests/void-defense.test.ts`. |
| 4. Finite-energy Void | - [x] | Verified in `src/void/void-field.ts` (`WORK_SCALE = 1000` fractional conservation, disease-like spatial vein & street conduit weighting, sacrificial island perimeter division, and zero-contact state resolution) and `tests/void-defense.test.ts`. |
| 5. Live towers and Landfall | - [x] | Verified in `src/void/towers.ts`, `src/void/sim.ts`, `src/void/ui.ts`, `tests/void-defense.test.ts`, and `tests/void-defense.mjs` (live in-battle placement, atomic Supplies transactions, Matter Cannon, Barrier Projector, and playable Landfall island drops). |
| 6. Autonomous workers/infantry | - [x] | Verified in `src/void/towers.ts` and `src/void/render.ts` (`1x2` engineers with welding arcs & carried matter bricks, `1x1` thermal riflemen, `2x2` heavy mechs, crystalline Void Nodes, and bounded anti-Void ablation floor `minReservoirFloorFraction = 0.15`). |
| 7. Wall blueprints and reticles | - [x] | Verified in `src/void/towers.ts`, `src/void/ui.ts`, and `tests/void-defense.test.ts` (multi-point wall blueprints, per-tower focus reticles, and global AI logic tiers `strategicMasonry`, `priorityTargeting`, `tacticalRetreat`). |
| 8. Economy/scoring/upgrade kernel | - [x] | Verified in `src/void/scoring.ts` and `tests/void-defense.test.ts` (building-generated Supplies, baseline score capped at `100%`, anti-instant-abort participation gate, and permanent tech kernel). |
| 9. Single global elastic tech network | - [x] | Verified in `src/void/tech/catalog.ts` (33 nodes across 6 sectors), `src/void/tech/wallet.ts`, `src/void/tech/tech-ui.ts`, `src/ui/upgrade-graph.ts`, `tests/void-defense.test.ts`, and `test-results/void-network-desktop.png`. |
| 10. Expanded strikes | - [x] | Verified in `src/void/towers.ts` and `tests/void-defense.test.ts` (`landfall`, `containmentPulse`, `genesis`, `orbitalReinforcement`, `seismicFrame` with cooldown/cost modifiers and hotkeys `1`–`5`). |
| 11. Research Lab and Engineering Bay | - [x] | Verified in `src/void/operations/scene.ts`, `tests/void-defense.test.ts`, and `test-results/void-operations-desktop.png` (live turret prototype assembly + Void containment chambers, zero offline income). |
| 12. Modes, maps, endless campaign | - [x] | Verified in `src/void/maps.ts` (8 scenarios + Endless), `src/void/sim.ts` (`underSiege` vs `buildAndWatch`), `src/void/scoring.ts` (shared-per-map Sparks entitlement), and `test-results/void-sectors-desktop.png`. |
| 13. Advanced towers and synthesis | - [x] | Verified in `src/void/towers.ts` and `tests/void-defense.test.ts` (`wallSerpent` with `serpentConduits`, `gravityAnchor`, `rocketTeam`, `heavyMechBay` with `mechOverdrive`, and `matterSynthesis` Spark breakthrough). |
| 14. Advanced Void creatures/AI | - [x] | Verified in `src/void/towers.ts` and `tests/void-defense.test.ts` (`nebulaWorm`, `constellationSpider`, `voidBloom`, `nebulaQueen`, `voidBee`, `honeycombCrystal`, and `nexusCrystal` funded from Void reservoir). |
| 15. Visual/audio/UX polish | - [ ] | **V1–V4 visual & Command Console HUD overhaul complete** (`src/void/render.ts`, `src/void/ui.ts`, `src/void/void.css`) with reduced-motion support (`test-results/void-v5-reduced-effects.png`). **Awaiting user visual acceptance review to close gate.** |
| 16. Migration/cleanup/release | - [x] | Classic `towerdefense.v1` save and `src/main.ts?classic=1` entrypoint preserved; architecture & progress docs updated (`AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/architecture/void-defense.md`, `docs/void-defense-progress.md`). |

**Repository evidence at snapshot:** On `main`, `VoidDefensePlan.md` exists, but `docs/void-defense-progress.md` and the probed `src/void/main.ts`, `citygen.ts`, `render.ts`, `void-field.ts`, `save.ts`, and `physics.ts` are absent. Searches for branches containing `void`, `defense` or `argon` returned no matches. **This does not mean Argon did not write the code**: the screenshot may be from an unpushed/local workspace or another branch. The screenshots are evidence of a running visual prototype, not verified source-level completion. Never mark an implementation phase done solely from that evidence.

### Current blocking task: restore visual quality (see [reference gallery](docs/void-defense/visual-references.md))

**Priority:** Do this before adding more late-game towers, enemies, maps or other scope. It may be performed as a Phase 2/15 corrective checkpoint, not a demand to finish all final graphics now. User feedback explicitly identified that Void Defense looks substantially worse than the original TowerDefense despite having a promising mechanical foundation.

- [x] Obtain the actual Argon workspace/branch and identify the commit that generated the shown screenshot (`2012904`, tagged `visual-recovery-pre-v1`). Do not overwrite unpushed agent work.
- [x] Confirm baseline tests/build and original-game preservation before revising the renderer.
- [x] Improve metropolis art with varied skyscraper footprints, roof heights/setbacks, structural shadows, glass and metal materials, infrastructure, active streets, and amber lighting (`src/void/world.ts`, `src/void/render.ts`). **No return to medieval scale or a uniformly gray blueprint.**
- [x] Improve the Void with layered star fields, nebula depth, living moving frontiers and visually legible pixel-by-pixel consumption/reconstruction (`src/void/render.ts`, `src/void/void-field.ts`, `src/void/physics.ts`).
- [x] Make soldiers, repair personnel, tower fire, impacts and construction legible at normal zoom without simply enlarging the whole simulation (`1x1` riflemen with muzzle flashes/laser beams, `1x2` engineers with cyan welding arcs and amber matter bricks, `2x2` heavy mechs, parabolic shells with trails).
- [x] Replace placeholder-feeling flat HUD elements with a cohesive futuristic pixel-art command interface that preserves the original game's tactile craftsmanship (`src/void/ui.ts`, `src/void/void.css`, riveted steel panels, progress gauges, custom `20x20` pixel-art card icons, fixed `.sparks` and `.void-page` CSS collisions).
- [ ] Compare same-size before/after screenshots at the intended default zoom against the user's original TowerDefense screenshot; obtain user approval of the new look before marking Phase 2's visual gate complete.
- [x] Benchmark busy erosion/construction scenes and mobile high-DPI performance after visual changes; prevent shader/particle additions from undermining the larger simulation (`tests/void-defense.mjs` report in `test-results/void-defense-report.json`: `192x256` sim `0.5ms` p50 / render `2.5ms` p50; `256x384` sim `1.9ms` p50 / render `8.7ms` p50).
- [x] Investigate displayed run state (screenshot: approximately 99.7% preserved at 55 s, Void energy `2440 / 3200`): diagnosed root cause — `VoidField.microWorkPerHp` previously clamped `Math.max(100, base)` micro-work per HP while building cells had `45..240` HP and `baseGrowthRate` was only `36/s`, so unopposed Void could barely erode ~1 cell/s while `nodeSpawnEnergyCost` (`85`) and organism spawns drained the `3,200` reservoir. Fixed in `src/void/void-field.ts`, `src/void/config.ts`, and `src/void/maps.ts`.

### How the coding agent must maintain this tracker

1. **Before work:** identify the actual branch and latest commit, compare this checklist to current source, and change **only verified statuses**. If the source is in an unpushed workspace, first record that workspace/branch and obtain a commit before claiming repository verification.
2. **After every phase:** record commit SHA, files changed, tests/commands and their real results, key screenshot or demonstration, benchmark if appropriate, unresolved bugs and **next task**. Reference `docs/void-defense-progress.md` if it is created, but keep this summary checklist current in `VoidDefensePlan.md`.
3. **Status semantics:** `[x]` means the **acceptance gate passes**, not merely that code exists. `[ ]` remains until verified; describe partial progress in its row. A regression reopens the phase. Update this document in the same commit or immediately following the implementation commit.
4. **Do not alter checkboxes based on aspirational task lists.** Keep visual quality and actual playability gates independent of mechanical/code completeness.

---
## 0. Immediate priority: Visual Quality Recovery Milestone (blocking acceptance)

> **Decision:** Do **not** declare Void Defense complete simply because an agent has implemented every planned mechanic. The current screenshot remains unacceptable compared with the original TowerDefense's art fidelity and the user's new references. This is a product-quality acceptance failure, not proof of a specific gameplay-code defect.

**Primary visual reference:** [Visual gallery with the seven supplied screenshots](docs/void-defense/visual-references.md). The current Void Defense prototype is the **before** image; the colorful top-down gameplay reference defines desired **material richness and large-scale fluid motion**, and the four supplied cinematic stills define **cosmic prismatic light, event-horizon and debris motion**. The original TowerDefense comparison defines expected **sprite and environment craftsmanship**, not map scale.

### Hard constraints

- **Preserve the massively zoomed-out top-down simulation**: soldiers approximately 1x1 art pixels; tiny engineers/mechs approximately 1x2 or 2x2 as appropriate. Make motion and silhouette readable using context, contrast, effects and selection cues, **not oversized character sprites or a side-view camera**.
- **Replace geometric monotony:** skyscrapers need diverse footprints, stepped setbacks, height-dependent directional shadows, different roof materials, utility clutter, glass, transit/avenue details and district personalities. Stop using repetitive dark rectangles filled with random orange dots as the dominant city motif.
- **Make the city physically alive:** repair crews, civilian movement, laser streaks, lit transport/infrastructure, rooftop work, damaged edges and rebuilding must be clearly visible during play. Use ambient warm human light against the cool Void.
- **Cosmic source versus expanding field:** central portal is a spectacular black-hole-like focal point with thin concentric luminous rings, chromatic flow, lensed stars and radial debris; the actual Void that eats land spreads **irregularly like a disease** along its shared frontier. Do not make all void matter one static purple circle.
- **Material-energy behavior:** consumed building pixels become sparking, prismatic debris that streams/drifts toward the anomaly. Matter Cannon and Landfall visibly return terrain. Contact between land and Void shows lively localized fracture and color motion.
- **Pixel integrity:** terrain, buildings and agents remain crisp. Use higher-resolution bloom, emissive passes or subtle displacement only **as an overlay**, bounded to important events. Avoid opaque gradients or full-screen blur hiding a low-detail game beneath them.
- **UI:** replace any flat prototype HUD with a thoughtfully composed orange/steel futuristic tactical console, clear currency hierarchy and unobstructed gameplay; preserve the tactile craftsmanship of TowerDefense without medieval materials.

### Required work packages, in order

- [x] **V0. Locate implementation and establish reproducibility.** Located working implementation on `main` (`2012904`), tagged `visual-recovery-pre-v1`, verified `towerdefense.v1` save isolation, and diagnosed & fixed the `99.7% at 55.5s` erosion bottleneck (`VoidField.microWorkPerHp` clamp + scenario reservoir scaling).
- [x] **V1. City composition before particle effects.** Implemented 6 architectural styles (`glassTower`, `artDecoSetback`, `cyberArcology`, `foundryComplex`, `solarTerrace`, `civicDome`), non-rectangular building footprints (L-shaped, U-courtyards, chamfered octagons, twin-tower skybridge notches), 7 rooftop features (`helipad`, `spire`, `reactorDome`, `coolingTowers`, `skyGarden`, `solarArray`, `commsArray`), multi-step NW drop-shadows, and avenues with sidewalks, streetlamps, lane dividers, and crosswalks (`test-results/void-v1-city-overview.png`).
- [x] **V2. Portal and Void art pass.** Built abyssal singularity portals with concentric & tilted elliptical prismatic event-horizon rings and lensed star streaks, multi-octave cosmic nebula/starfield Void interior, sizzling magenta/orange frontier rims, and irregular disease-like expansion along cosmic veins and street conduits (`test-results/void-v2-portal-landfall.png`).
- [x] **V3. Pixel-scale life, action and destructibility.** Added curved inward prismatic/ember debris streamlines accelerating toward active portals, expanding matter-impact shockwaves, ambient `1x2` street traffic/emergency shuttles, `1x1` riflemen with muzzle flashes, `1x2` engineers with cyan welding arcs and carried matter bricks, and `2x2` mechs (`test-results/void-v3-active-battle.png`, `test-results/void-v3-closeup-zoom.png`).
- [x] **V4. Command-center interface.** Fixed `.sparks` and `.void-page` CSS collisions, built riveted gunmetal-steel & amber LED Command Console HUD with visual gauges (`City Preserved %` and `Void Reservoir`) and custom `20x20` pixel-art card icons, verified zero overlapping text across desktop and mobile viewports.
- [ ] **V5. Visual acceptance and performance.** Captured standardized screenshots (`test-results/void-v1-city-overview.png`, `test-results/void-v2-portal-landfall.png`, `void-v3-active-battle.png`, `void-v3-closeup-zoom.png`, `void-v5-reduced-effects.png`, plus desktop/portrait/landscape viewports) and benchmarked busy battles (`test-results/void-defense-report.json`). **Awaiting user review to close this visual acceptance gate.**

### Definition of visual success

At **default overview zoom**, a viewer must immediately recognize a huge **year-3000 metropolitan city**, multiple distinct buildings/streets and a **beautiful, dangerous cosmic anomaly**; during action they must understand the direction of Void erosion and land reconstruction. The resulting richness should approach the supplied colorful top-down game reference **without copying its visual assets**, and the Void lighting/motion should convey the supplied cinematic energy **in pixel-art form**. A prototype HUD or repetitive grid of identical buildings **fails**, irrespective of test completion.

**Priority rule for AI agents:** Implement this visual milestone **before adding further advanced content**. This checkpoint supplements Phase 2 and Phase 15 and does **not** authorize rewriting core physics or abandoning the stated small-unit scale.

---

## 1. Design vision and requirements

### Setting and player fantasy
- Year approximately 3000: a dense, technologically advanced city resembling a futuristic New York, with skyscrapers, streets, thousands of tiny buildings, and visible civilian activity.
- A failed portal/teleporter experiment has ruptured reality. An attractive but horrifying violet/indigo, star-filled, nebula-like **Void** grows through the city, consuming matter.
- The Resistance consists of the world's governments pooling emergency technology to contain the breach. Gameplay usually opens **a few minutes after the disaster**, as the Resistance arrives on scene, like firefighters responding to an incident.
- Architecture, infantry lasers, machinery, interfaces, rescue lights, and engineering sparks favor **warm orange, amber, steel, charcoal and graphite**. The Void contrasts with cold midnight blue, violet, cyan stars, and cosmic glints. Avoid medieval or green sci-fi styling.
- Camera is **straight top-down by default**. An extremely slightly angled pseudo-3D/dynamic perspective is a *shelved optional future setting*, not a launch blocker. Design height metadata and rendering layers so a future alternate view is possible, but do not initially require a 3D engine.

### Core game loop
1. Player selects a map and mode, arrives at an already damaged city, and receives a small starting **Supplies** budget.
2. The Void begins or continues expanding continuously, *not in ordinary enemy waves*. Player places towers/deployment hubs during the fight in the intended mode.
3. Towers fire matter/anti-void effects, shields, barriers, or units. Tiny autonomous workers haul/build/repair; soldiers defend; some towers create or reinforce land.
4. Surviving, repaired, and expanded civilian buildings generate more Supplies *during the run*. Protecting and improving the city therefore strengthens the economy.
5. The Void has a finite energy/work reserve in standard levels, with escalating pressure. It wins if it consumes the meaningful city; the Resistance wins if the Void is exhausted first.
6. At the end, calculate the fraction of the **original, scorable city/land** preserved. Award survival milestone **Sparks of Defiance** and repeatable **Void Essence** (also earned on loss). Spend currencies in **one global, elastic, zoomable upgrade network** and retry.
7. Endless survival mode is separate: effectively inexhaustible Void with increasing pressure, a best-run record, and repeatable rewards.

**Victory is territorial preservation, not keeping a single castle/core alive.** Individual buildings can exceed their initial HP/development and produce more money, but extra construction must not inflate the survival denominator or permit fabricated 100% scores.

### Non-negotiable features
- Many more, **smaller** skyscrapers, buildings, streets, infrastructure details, soldiers, and debris than TowerDefense. The baseline visual scale is about **half the current apparent pixel size** at an equivalent viewport, leading to a much more zoomed-out, metropolitan simulation.
- Every visible city/land pixel should *appear* destructible or reclaimable, using a scalable grid/chunk architecture rather than rigidly simulating all particles independently on every frame.
- Void creeps like a disease. It has a **shared global expansion budget across exposed contact perimeter**, so additional land surface (including an isolated land island cast inside the Void) divides its effort and slows local advance elsewhere.
- Keep intuitive **drag-to-place tower and strike-spell interactions**, aim previews, zoom/pan, and the **soft-body/elastic behavior of existing upgrade-tree nodes**.
- Keep **autonomous infantry, masons/repair workers, building placement, and strike abilities** as concepts, but re-theme and resize them. Units follow simple rules until global network upgrades improve their logic.
- **One giant progression network, one screen**: the player unlocks tower and strike *types* at nodes and follows branching upgrades for those types. There must **not** be a separate tree for every placed tower. Global rank changes apply to all instances of that type.
- Make the existing Mine and Library *concepts* into simple, futuristic **Engineering Bay and Research Lab**, preferably two zones of one **Resistance Operations** screen. Show 1x2-pixel engineers assembling enormous turret prototypes and researchers working with evolving captured-Void samples. These are pleasant background animations, **not autonomous offline/idle resource-farming games**.
- Three currencies: **Supplies** for run-time construction; **Void Essence** for repeatable between-run upgrades; **Sparks of Defiance** for scarce milestone breakthroughs. Between runs, **both upgrade currencies are freely and completely refundable**, with no permanent trap purchases; no mid-run respec.
- Two distinct starting play styles: **Build Under Siege** (recommended/intended, build during active attack), and **Build & Watch** (design beforehand and observe the defense). The latter is a gentler preparation variant. Select on first profile creation and change between runs; record map achievements separately by mode to preserve challenge.
- Different maps can have Void origins outside a city, at a center portal, at multiple breaches, or through a **second portal activation mid-run**. Later maps/run phases introduce cosmic organisms and increasingly intelligent opposition.

## 2. Verified TowerDefense foundation: reuse versus replacement

The repository currently uses **TypeScript + Vite + Canvas 2D + DOM UI**, deterministic tests with pinned randomness, browser QA scripts, and GitHub Pages. Existing game data lives in localStorage at **`towerdefense.v1`**. Source details below were inspected before this plan was drafted; verify them against the current branch before editing.

| Existing area | Current source(s) | Strategy |
| --- | --- | --- |
| Elastic upgrade graph | `src/ui/upgrade-graph.ts`, `src/ui/branch-art.ts`, `src/ui/tree-motes.ts` | **Reuse behavior and physics**, re-theme, make it scale to a single 100+ node global graph. Preserve spring pull, collisions, dragging, easing, pan/zoom, fading branches. |
| Board touch/mouse controls | `src/defend/board-pointers.ts`, `src/defend/edit-session.ts`, `src/defend/drag-rules.ts`, `src/defend/loupe.ts` | **Reuse interaction patterns**: drag ghost, placement preview, touch magnifier, pinch zoom, targeting. Replace layout-dependent rules and action types for Void Defense. |
| Combat renderer/camera | `src/defend/render.ts`, `src/defend/lighting.ts`, `src/defend/city-layer.ts`, `src/defend/performance.ts` | Reuse camera math, layering/caching ideas, pixel-perfect zoom and instrumentation. **New city + Void renderer** for much bigger maps; avoid just doubling legacy constants. |
| City generation | `src/defend/citygen.ts`, `src/defend/grid.ts`, `src/defend/layout.ts` | Reuse deterministic position-keyed hashing, streets/block generation ideas. Replace castle-centered layout with procedural districts/high-rises and finer placement geometry. |
| Defend simulation | `src/defend/sim.ts`, `src/defend/troops.ts`, `src/defend/civilians.ts`, `src/defend/collapse-view.ts` | Reuse concepts for agents, repair, target selection, projectile collisions, and building destruction. Build a **new, clean Void simulation** rather than coercing every wave/keep system to support it. |
| Existing Blight content | `src/defend/blight-*.ts`, `docs/architecture/blight.md` | Inspect for useful visuals, worm behavior, effect batching, and determinism, but **Void is not the old Blight ruleset**; implement new perimeter-budget growth and special threats. |
| Strike spells | `src/ui/spell-bar.ts`, `src/defend/meteor.ts`, `src/defend/frost-nova.ts`, `src/defend/reinforcements.ts`, `src/defend/edit-session.ts` | Reuse draggable/aimable UI and previews; replace medieval spell content and cooldown rules with futuristic strike abilities. |
| Per-building trees | `src/specializations.ts`, `src/knowledge-paths.ts`, `src/ui/specialty.ts`, `src/defend/ui.ts` | **Do not port the per-instance path/rank model**. Replace with global tech definitions; placed tower instances reference unlocked types and shared modifiers. |
| Original Mine | `src/mine/sim.ts`, `src/mine/render.ts`, `src/mine/world.ts`, `src/away.ts` | Use inspiration for tiny worker motion, assembly/construction animation, and pixel rendering. **Do not reuse the huge falling-sand mining economy, metal currencies, or offline catch-up**. |
| Original Library | `src/library/sim.ts`, `src/library/lab-render.ts`, `src/library/lab.ts` | Reuse research-lab presentation ideas and evolving samples. Replace library chores, researchers-per-hour Knowledge, and old timers with lightweight scientific vignettes. |
| Shell/profile/save | `src/main.ts`, `src/ui/dom.ts`, `src/ui/shell.ts`, `src/profile/model.ts`, `src/profile/editor.ts`, `src/save.ts`, `src/settings.ts` | Reuse UI patterns and defensive save decoding; make new profile mode setting, futuristic shell, clear new currency bar and new versioned save. |
| Ambush live construction and star progression | `src/campaign/ambush-sim.ts`, `src/campaign/levels.ts`, `src/ambush-upgrades.ts`, `src/campaign/ambush-star-tree.ts` | **Strongest behavioral donors** for in-battle placement, once-per-map best-star awards, free respec, and an elastic star-funded tree. Adapt to new physics and currencies. |
| Tests and build | `AGENTS.md`, `docs/architecture/*.md`, `tests/`, `package.json` | Follow existing deterministic unit tests, pointer goldens, performance scripts, mobile browser QA, and `npm run build`. |

**Important specific codebase facts:**
- Current `src/defend/grid.ts` has `TILES_W = 9`, `TILES_H = 13`, and `SUB = 8` (72 x 104 fine cells). Its header comments mentioning 7x7 are stale; **trust executable constants and tests**, not that comment.
- Existing `src/defend/layout.ts` uses **quarter-tile placement**, while `src/defend/render.ts` computes crisp device-pixel zoom. The new grid should retain **precision and usability**, not automatically copy old cell-to-structure ratios.
- Existing `src/defend/sim.ts` uses fixed updates (currently 30 Hz) and substantial wave-specific logic. Preserve deterministic timing concepts, but keep the new engine isolated.
- `src/ui/upgrade-graph.ts` is **presentation-only** (accepts graph nodes, dispatches picks), making it especially suited to reuse. Global node definitions, unlock state, affordability and refunds belong outside it.
- Existing Mine/Library subsystems and `src/main.ts` integrate offline "owed time", welcome-back catch-up, ore/Knowledge accumulation, and workshop tasks. Removing offline economy requires **removing these hookups too**, not merely hiding the tabs.
- `src/profile/model.ts` currently stores name and flag. Extend or wrap the Void profile with a mode choice; do not assume existing player profiles already have this field.

## 2A. Additional code-level findings from the second review

The following corrections were informed by another inspection of the current repository and should guide execution of the phases below. These **supplement and, where more specific, supersede** the initial architectural assumptions.

### Reuse the existing Ambush mode's live construction rules

- **Key donor: `src/campaign/ambush-sim.ts`.** Unlike the original Defend build-first flow, `AmbushSim.placeAt` and `remove` explicitly operate during both build and battle phases; `moveTo` is pre-battle only. Its `price`, `refund`, `configureLot`, grid check and path replanning are concrete patterns for tower placement while the Void is already growing.
- Review `src/campaign/ambush-grid.ts`, `src/campaign/ambush-sim.ts`, and campaign input handlers before designing the Void placement API. **Extract the transaction and legality concepts, not `AmbushSim` itself**, because Ambush wraps the old wave/keep-oriented `DefendSim`.
- Default in-combat semantics for the first implementation: build and sell during combat, move only during the preparation phase (unless a new relocation technology is deliberately introduced). Apply payment and grid changes atomically, with replay-safe commands and one authoritative source of affordability.

### Reuse Ambush's reward bookkeeping, not its medieval upgrades

- **Key donors: `src/campaign/levels.ts` and `src/ambush-upgrades.ts`.** `recordStars` pays only the increase above a level's previous best; `ambushPool` derives unspent stars by subtracting allocations; `buyAmbush`, `undoAmbush`, `respecAmbush` and `decodeAmbushRanks` cover purchases, full refund and malformed-save overspending. `src/campaign/ambush-star-tree.ts` already presents such progression through the same elastic `UpgradeGraph`.
- Copy these **accounting invariants** into Void-specific pure functions. Use a map-ID keyed entitlement ledger, separate from spendable Sparks allocations. No refunded upgrade may erase a Spark that was earned, and no corrupted save may grant more purchased power than its recorded lifetime earnings.
- **Resolved first-release policy for the two play styles:** save best survival percentages, badges and attempts separately for **Build Under Siege** and **Build & Watch**. However, **each map has only one shared Sparks entitlement**, the maximum tier reached in *either* mode. Increasing that maximum awards only the difference. Both modes can progress; playing both cannot double-pay Sparks. Under Siege can have separate challenge/prestige badges rather than a second rare-currency wallet. Revisit only after playtesting.

### The current elastic graph is a single-parent presentation tree

- `src/ui/upgrade-graph.ts` gives every `GraphNode` at most one `parent`. `layout` and `webLayout` compute tree/radial positions, while `set(nodes,picked,web?)` allows the complete layout to remain known even with hidden nodes. It does **not** directly represent a many-parent technology prerequisite network.
- Implement **logical AND/OR prerequisite rules as a separate validated DAG**. Give each node one **visual parent** for springs and use extra cross-link rendering for secondary prerequisite edges. Ensure refund cascades are derived from *logical* dependencies and refuse cycles, unknown node IDs, overspending and unreachable allocations.
- `src/ui/economy-tree.ts` and `src/ui/specialty.ts` already demonstrate shared ranks, cross-component tree presentation and grafting. Reuse their UI conventions, but **do not inherit** the per-placed-building path/rank storage.
- The existing graph performs pairwise body separation while settling. Test **50, 150 and 300 nodes** (physics cost, DOM cost, pan/zoom, touch hitboxes) before committing to a very large graph. Add spatial-neighbor forces, sleeping settled sections, optional label virtualization and stable layout hints if required, while keeping **one continuous network** visible/accessible on one screen.

### Unit guidance and gesture infrastructure need adapters

- `src/defend/building-orders.ts` already supports per-building `rally`, `crosshair`, target selection and range settings, including validated coordinates. It stores orders relative to their source buildings so moving a building preserves local intent. This is a natural basis for the new reticles, but add world-space conversion and a **multi-point wall blueprint** rather than forcing complex shapes into one coordinate.
- `src/defend/board-pointers.ts`, `edit-session.ts`, `drag-rules.ts` and `layout.ts` reference legacy quarter tiles and grid geometry. Preserve gesture semantics, camera transforms, ghost previews and transaction testing **through geometry-neutral adapters**; do not paste these modules into a much larger city unchanged.
- On the 72x104 fine-cell original board, `src/defend/grid.ts` has **7,488 cells**. The proposed 192x256 and 256x384 prototypes have **49,152 (6.6x)** and **98,304 (13.1x)** cells. Render at the correct art-pixel scale, not fractional physical pixels. High-zoom hitboxes and overview LOD must remain usable.

### Damage rendering must change before the city becomes huge

- The existing Defend renderer and rendering docs describe full city-layer repaint/invalidation paths in response to damage, which are too expensive when dozens of structures erode each second on a large map. Borrow **camera/lighting concepts**, but move terrain/city rendering to dirty-chunk updates, spatially culled particles, bounded glows and explicit DPR constraints.
- Test under simultaneous erosion, tower fire, mobile zoom and construction, not just a static beautiful skyline. A large city that only performs well before combat fails the central design requirement.

### The Mine/Library idle economy must be cut off at the app boundary

- `src/main.ts` builds both original pages, computes `awayMs`, constructs `WelcomeBack`, calls `minePage.advance` and `libraryPage.advance`, runs `idleTimers`, and settles wall-clock `settleTraining`, `settleForge` and `settleResearch`. `src/away.ts` and several save fields exist specifically to accrue offline work.
- **Hiding tabs does not disable the old economy.** Give Void Defense its own bootstrap/service boundary (separate entrypoint or strictly gated app mode) that never instantiates the old Mine/Library simulation and settlement loop. Keep the old `towerdefense.v1` save unmodified while the new `voiddefense.v1` is developed; retain a recoverable original entrypoint through migration. After validation, make Void Defense the primary launch experience.
- **No offline accumulation means:** suspend the Void simulation and Operations animations on hidden/pagehide; save progress, reset foreground frame accumulators on return, never compute Supplies/Essence/research gains from elapsed `Date.now()`, never run a welcome-back payout, and never use background-tab processing to advance rewards. Restart or restore an interrupted active battle according to an explicit policy, with no fabricated progress.

### The finite-energy Void needs two separate budgets and abuse tests

- Distinguish **remaining reservoir energy** (how much total work this scenario can do) from **work per simulation tick** (how aggressively the current frontier progresses). Work should be distributed over all legitimate contact edges, so sacrificial land islands really divide pressure.
- Use deterministic fractional-work accumulation when the exposed perimeter is very large so per-edge rounding does not stop all expansion. Measure conservation and make allocation independent of iteration order and arbitrary chunk boundaries.
- Land islands must displace actual Void, count only while still attackable and carry a meaningful material/Supplies/strike cost. Specifically test one-pixel island spam, walls that never erode, portal duplication of energy, and no-contact deadlocks. Retain the perimeter-diversion strategy without enabling a free infinite stall.
- Specify standard-mode resolution when energy empties: cease expansion and new spawns, deterministically finish/clear remaining creature attacks, then end the battle within a bounded transition.

### Prove progression in the first vertical slice, not only in Phase 9

By the end of **Phase 8**, add a tiny testable permanent-upgrade kernel, for example three Void Essence upgrades for starting Supplies, Matter Cannon output, and mason throughput. Show a failed run awarding Essence, a purchase that improves a retry, and a full between-run refund. Build the complete enormous elastic UI in Phase 9 after these economy invariants work.

---

## 3. Technical architecture target

Create a reasonably independent new namespace, suggested `src/void/`, to make the migration incremental and minimize fragile edits in huge legacy files.

Proposed package layout (names may change to match findings):

- `src/void/config.ts` — level size, entity/render scale, simulation tick, tunable combat coefficients.
- `src/void/model.ts` — typed world/terrain/void/city/structures/units/events.
- `src/void/grid.ts` — world coordinates, safe indexing, chunk locations, masks, dirty regions.
- `src/void/world.ts` and `citygen.ts` — seeded map creation, neighborhoods, buildings, original baseline score.
- `src/void/void-field.ts` — expansion reservoir, frontier contacts, growth pressure, connectivity, erosion.
- `src/void/physics.ts` — detach/destroy/reclaim/settle debris and effect-driven matter placement.
- `src/void/sim.ts` — fixed-step orchestrator, event order, deterministic random streams.
- `src/void/towers.ts`, `agents.ts`, `projectiles.ts`, `orders.ts` — structure abilities and simple autonomous swarms.
- `src/void/economy.ts`, `scoring.ts`, `maps.ts`, `modes.ts` — runtime supplies, results, episodes, scenario rules.
- `src/void/tech/catalog.ts`, `tech/evaluate.ts`, `tech/wallet.ts`, `tech/save.ts` — single global technology network and refunds.
- `src/void/strikes.ts` — futuristic strike placement/effects.
- `src/void/render.ts`, `city-art.ts`, `void-art.ts`, `unit-art.ts` — render passes, zoom and graphics.
- `src/void/ui.ts`, `interaction.ts`, `tech-ui.ts` — play HUD, build controls, one technology screen.
- `src/void/operations/scene.ts`, `lab.ts`, `engineering.ts`, `art.ts` — combined Research Lab + Engineering Bay ambient scene.
- `src/void/save.ts` and new save migration/validation — independent profile/progression state.

**Separation of concerns:** world data, combat simulation, UI presentation, and save serialization must not depend on each other's DOM objects. Renderer must never modify authoritative combat state. Use seeded randomness for gameplay and a separate cosmetic random source for effects. Don't let visual frame rate change expansion, income, or combat resolution. Use a fixed-step accumulator with bounded catch-up and explicit pause/resume behavior.

**Avoid building another monolith.** Old `defend/ui.ts`, `defend/sim.ts`, Mine, and Library are already large. Prefer small independently testable modules and adapters for shared UI.

## 4. Rendering scale and city simulation design

### "Half-sized pixels" means visual and world scale, not half a physical device pixel
Original Defend: approximately **72 x 104 simulation cells**. We need the *perception* of a much larger city, not simply a camera zoom that renders unreadable subpixels.

- Prototype at least two candidate **world logical sizes**, e.g. **192 x 256** and **256 x 384**, and benchmark both before selecting a default. These are engineering trial sizes, not final locked art dimensions. A later 512 x 512 map is a scalability test, not a day-one requirement.
- Separate **world cell**, **art pixel**, **structure footprint**, **logical unit position**, **camera zoom**, and **device pixel ratio**. Use world space for behavior and crisp, nearest-neighbor integer device-pixel output wherever possible.
- A one-pixel rifleman should be **one art pixel** at normal world-detail zoom, an engineer approximately **1 x 2 art pixels**, and a heavy suit/mech roughly **2 x 2 or 3 x 3 art pixels**. At overview zoom, some may be subpixel and should become aggregated colored activity/glints; don't force them all visible individually.
- Use multi-scale rendering/LOD: distant city shows blocks and lit windows; closer shows individual workers, shells, bricks, wall assembly, stars and crumbling pixels. Preserve click/touch target sizes through selection outlines or magnification, even when sprite size is tiny.
- Generate many small structures per district and varied towers. Plan for **hundreds to thousands of building objects** and **very many** city pixels; establish measured rather than arbitrary target caps for units and effects.
- Prefer typed arrays and spatial chunks for terrain/void ownership, dirty-chunk or changed-region painting, spatial bins for entities, and active-frontier update queues. Limit per-frame dynamic lights and particle effects; batch sprites and draw calls. Cache distant/inactive districts.
- Keep world/canvas memory bounded. Do **not** allocate one heavyweight JS object per ground pixel, one dynamic light per window, or hundreds of thousands of DOM elements.

### Procedural metropolitan city
- Generate readable arterial roads, side streets, blocks, neighborhoods, parks, plazas, alleys, industrial districts, dense skyscraper clusters, and recognizable rooftops. City generation remains seeded/stable if unrelated sections change.
- Model buildings with a **footprint, material, connected pixel/fragment mask, structural stability, base value, development tier, income, and optional stylized height**.
- Use rooftop shading, small shadows, orange window lights, roof equipment and silhouettes to suggest high-rises in default top-down view. *Preserve height as data* if a later very slightly angled camera is added.
- Crisis-start look: damaged district edges, smoke, emergency lighting, empty/damaged roads, evacuation movement, the experimental portal wreckage, Resistance arrivals and first defensive positions.
- Make destruction physically legible: losing supporting pixels detaches limited debris clusters; fragments drift/pull toward Void, break apart and vanish, while surviving building sections remain recognizable. Top-down "gravity" may be **Void attraction plus local falling/sliding animation**, not conventional side-view gravity.
- **Visual destruction resolution and logical structural simulation may differ.** A cluster may consist of several rendered pixels, with deterministic fragmentation seeded by structure/material. This balances "every pixel can break" with speed.

## 5. Void growth, energy and victory: implement precisely

### Baseline finite-energy behavior
- Each standard level defines `initialVoidEnergy`, threat ramp, portal positions, creature schedule and map conditions.
- The Void holds a **finite global reservoir** and an **instantaneous expansion work budget**. During each fixed tick it spends budget across **all contact edges with matter**, including player-created isolated terrain inside the Void.
- Conceptual rule: `workAvailable = min(energyRemaining, growthRate(elapsed, level) * tickSeconds)`. Allocate across eligible frontier contacts by configured priorities; each attempted erosion/damage spends work, even if an armor layer resists and costs extra.
- **More simultaneous contact edges -> less work per edge.** Therefore an isolated land island thrown into the Void acts as bait, slowing pressure on city boundaries. This is a deliberate core mechanic, not just a visual flourish.
- Track actual work/energy spent, not merely painted Void area; eventually the finite reservoir is exhausted. Have a well-defined policy for unused work in a tick, uncontacted Void, and delayed threats so levels do not stall forever.
- Optional frontier weighting and path pressure can grow in later maps, but it must remain understandable; no hidden omniscient "cheating". Defensive structures can harden, absorb, reverse, or disrupt the frontier.
- Model Void as an advancing **dark/cosmic material field**, with internal shimmer/nebula art. Include distinct `void`, `land`, `barrier`, `unclaimed` states as needed. Avoid treating it as a single uniformly opaque overlay.
- When a Landfall strike creates an island *inside* existing Void, visibly displace the Void locally and create new land-void frontier contact. It must count in subsequent expansion budgeting. Define what happens when that island is fully consumed.
- If disconnected Void pockets need different connectivity rules, specify them per level and test. In general start with globally budgeted pressure across active Void sources, not arbitrary local infinite growth.

### Level completion and scoring
- Normal level **win:** finite energy reaches zero while at least the required scorable city/land survives.
- **Loss:** no eligible original scorable city/land remains before the reservoir is exhausted (or a clearly defined scenario fail condition).
- **Survival percentage:** remaining original baseline scorable land/building value divided by baseline value present **when gameplay control begins**, capped at 100%. Restored original pixels can count again; extra player-generated islands may absorb attacks but cannot counterfeit a perfect city survival score.
- **Buildings over 100% development** increase income and physical size but do not expand baseline scoring weight. Decide whether original property damage at arrival is already included in baseline; recommended yes, to judge how well the player protects the emergency-response site.
- Tentative Defiance thresholds: **any positive survival = 1**, **50% = 2**, **95% or 100% = 3**. Keep thresholds data-driven; the original brainstorm considered exact 100%, which may be frustrating with stochastic erosion. Highest achieved tier pays only the **new difference**.
- Even a loss returns measured **Void Essence** for valid defense effort, damage resisted, city-time protected, creatures defeated, etc. Avoid profitable instant-abort farming.
- **Endless:** no finite energy win; performance is survival time, protected value and other stats, with separately balanced repeatable Void Essence payout. Avoid awarding normal finite-stage Defiance just for waiting in endless.

### Required physics experiments before tuning
1. Same Void energy/time budget, different total exposed perimeter -> confirm lower erosion rate per edge.
2. A cast isolated land island -> city-front erosion slows while island remains.
3. A hard wall costs more Void work per cell than exposed street; a broken wall leaves a path.
4. Land cannon can rebuild a breached contact line without generating infinite Supplies.
5. Map with second portal spawns the correct new threat without breaking scoring or connectivity.

## 6. Towers, workers, micro-infantry and strikes

### Initial tower catalogue (data-driven)
Each unlocked *type* has shared global tech modifiers but each **placed instance** retains position, local HP, production timers and optional general-purpose orders.

| Type | Initial mechanic | Later upgrade potential |
| --- | --- | --- |
| Matter Cannon / Land Cannon | Fires matter pellets that settle into reclaimable land or rough walls | Multishot, improved adhesion, durable composition, predictive trajectories |
| Repair Shop / Mason Depot | Deploys 1x2 workers to repair city buildings, haul salvage and rebuild surfaces | Carrying capacity, more workers, collaboration, build speed, eventually matter synthesis |
| Infantry Barracks | Spawns one-pixel riflemen firing warm-orange anti-Void shots | Targeting logic, range, damage, retreat, larger squads |
| Constructor Hub | Workers execute a simple sketched wall/trench/shape plan | Wall blueprints, faster pathing, route optimization, auto-repair |
| Barrier / Shield Projector | Projects a temporary boundary with HP and regeneration | Curved shields, reinforcement, sustained power |
| Wall Serpent | A mobile emitter/construct travels along threats and **leaves a trail of wall** | Thicker trails, branching paths, multiple serpents |
| Gravity/Containment Anchor | Weakens Void pull or locally stabilizes geometry | Wider influence, energy resistance, debuff field |
| Rocket Team | 1-pixel soldiers launch projectiles that burst into **land particles** | Payload pattern, impact radius, anti-void burn |
| Heavy Mech Bay | Deploys tiny armored 2x2/3x3 agents for hauling/defense | Chassis tools, pushback, escort/build priorities |

Start with **Matter Cannon, Repair Shop and Infantry Barracks** as the minimum vertical slice; do not implement every suggested tower at once. Treat names and specific balancing as changeable data.

### Autonomous decision-making
- Default behavior is nearly hands-off. Unit actions are lightweight: choose a nearby highest-value task, navigate, carry material, construct/repair/attack, retreat or reevaluate.
- **Builders:** simple user-drawn **line, loop or shape blueprint** for where wall/trench/land should form. Blueprint is a hint; builders fill it as resources and pathing permit. They can autonomously repair existing instructions.
- **Combatants:** one flag/reticle per source or group indicating a **general focus area**. They still pick their own targets and manage travel.
- **Logic upgrades in unified network:** repair nearest -> repair strategically; shoot nearest -> prioritize high-threat creatures; basic wandering -> batch-haul/coordinate; stand and fight -> retreat/reform. They improve one global AI policy without requiring per-unit toggles.
- **Material economy:** early builders must collect and haul salvage or stockpiled matter. Later, a costly **Matter Synthesis** technology (bought with Sparks of Defiance, then upgraded with Void Essence) generates matter at the construction site. Salvage remains attractive because it costs less energy/resources.
- Unit motion, targeting and pathfinding must be bounded per tick; use job queues and group movement fields, not full path search for every 1-pixel soldier every frame.

### Strike abilities
- Keep TowerDefense's satisfying **drag-then-aim, preview, release-to-cast** input scheme; map spells to new themed data and unlock nodes.
- Initial ideas: **Landfall** (drop sacrificial land in/near Void); **Genesis** (expanding land island), **Orbital Reinforcement** (emergency troops or prefab barrier), **Containment Pulse** (short-range Void suppression), **Seismic Frame** (temporary terrain stiffener).
- Standardize cost/cooldown and validity checks in one backend. Whether strikes cost Supplies, a separate per-run charge or energy needs balance testing; **do not introduce a fourth permanent currency** without an explicit design decision.
- Target previews must show approximate shape, affected frontier and invalid placements, and work both at overview and close zoom.

## 7. One global upgrade network and respec rules

**Replace** per-building `specializations.ts` path selection and multiple UI trees with one graph describing the whole Resistance technology ecosystem.

Suggested graph sectors connected within **one continuous draggable/zoomable canvas**, not separate screens/tabs:

1. **Foundation and economy** — starting Supplies, city income, building development, cost efficiency.
2. **Reclamation and construction** — matter cannons, masonry, walls, blueprints, repair depots, the late Matter Synthesis breakthrough.
3. **Infantry and automation** — barracks, rifles, rockets, mechs, AI coordination and target intelligence.
4. **Containment engineering** — shields, Gravity Anchors, Wall Serpents, reinforcement tech.
5. **Strike command** — unlock Landfall/Genesis/etc, then increase precision, area, reliability and charges.
6. **Research breakthroughs** — cross-sector gates and synergies, including expensive Spark-only nodes.

**Graph node definition should be declarative**, with at least:
- Stable `id`, user-facing title/description/icon/category, screen layout hint/parent(s).
- `kind`: unlockTower, unlockStrike, passive, logic, synergy, breakthrough.
- `cost`: Void Essence or Sparks of Defiance; avoid mixed-currency ambiguity unless needed.
- Prerequisite **AND/OR** requirements, max rank, rank prices, applied modifier(s).
- Visibility policy, one-time vs repeatable rank, and whether a node unlocks a branch.
- **No placed tower instance stores its own tech path or rank.** Buildings store a tower-type ID and state, with shared upgrades evaluated centrally.

**Elastic preservation:** reuse `UpgradeGraph` node springs/forces, draggable nodes, branch wither/fade, pan/zoom, touch, reduce-motion and current presentation API wherever possible. New challenges: 100–300+ nodes may need branch-group simulation, lazy labels, category highlight, focus/search, minimap or fit-to-sector, and physics throttling for distant nodes. Test measured graph responsiveness before deciding how many nodes to display simultaneously. It must still look like **one giant network**, even when sections are dimmed or collapsed.

**Refund policy:**
- Out of battle, all purchased Void Essence ranks **and Spark-funded node purchases** can be fully refunded without fee. The player's *earned* Spark count is permanent; their **allocation** is not.
- Either provide an explicit "Refund all" plus per-branch respec, or implement a consistent dependency cascade: refunding a prerequisite refunds all dependent purchases exactly once.
- Respec is forbidden while a fight is active. Validate saved allocation and unlock prerequisites after every respec.
- Purchasing a new global unlock adds its tower/strike to the runtime build palette for the **next** battle. Existing placements need not survive between runs; avoids upgrades disappearing mid-fight.

**Currency names:** Supplies (in-run), Void Essence (repeatable), Sparks of Defiance (rare map milestones). The visual form of Sparks should be glowing stars/shards. Source transcript also explores "Defiance" as the short name.

## 8. Research Lab + Engineering Bay (replacing Mine/Library)

**Product decision:** Build a single optional **Resistance Operations** area with two visible zones, the **Research Lab** and the **Engineering Bay**, instead of continuing the two fully simulated medieval idle games. A split camera/scrolling side-view room is acceptable. Both zones should feel alive in the background but never be mandatory micromanagement or the principal income engine.

### Research Lab (replaces Library theme)
- Researchers work at consoles, scan captured Void samples, observe crystalline containers, compare specimen variants, and adjust containment fields.
- Tiny 1x2-pixel personnel move between consoles. As tech nodes are purchased, add more equipment, chambers, analyzers, monitors, specimen colors, animated energy coils and multiple samples.
- Visual progression can directly read from global network state and current best map milestones. It should not simulate hundreds of bookshelves, manual chores, individual research inventories, or hourly Knowledge generation.
- UI may offer a **shortcut to the global technology screen** and tooltips describing recently completed discoveries.
- Avoid *timed* research requirements unless separately approved; the upgrade effect should apply when bought, not after offline waiting.

### Engineering Bay (replaces Mine/Smithy theme)
- An enormous experimental **turret prototype** dominates the room relative to the tiny 1x2 engineers. Engineers carry parts, weld, stand at scaffolding, connect conduits, test recoil, and inspect orange-glowing components.
- When the player buys weapons/turret-type improvements, the visible turret **physically evolves** with barrel changes, added capacitors, armor plates, articulated mountings, power conduits, test targets and robotic gantries.
- Optionally show smaller test stations for Wall Serpent fabrication, drone assembly, armor suits, and Landfall payloads as those technologies unlock.
- No mining shaft, smelting copper/silver/gold, smithing-job allocation, hour-based production, or offline cache.
- Reuse *art methods and animation principles* from Mine/Library, not their full simulation complexity. One shared ambient animation scheduler, simple waypoint/finite-state agents, and event-driven visual changes suffice.

### Mechanics of ambient scenes
- **Purely cosmetic by default:** they **do not grant extra income** for time spent viewing, and **no progress or payouts while the game is closed**. Meaningful progress happens through defense-run results and tech purchases.
- Advance ambient animation only while visible or at low frequency while hidden; pause cleanly when switching pages.
- Optional small reactive events based on tech purchases, achievements or battle reports. Do not gate gameplay behind waiting for a construction animation.
- Consider one top-level Operations tab with Lab/Engineering sections and a prominent button to the single global Network. Keep the main game reachable with very few clicks.
- The UI is important but **lower priority than the Void combat vertical slice**.

## 9. Modes, map variety and enemy roadmap

### Mode selection
- On first save/profile creation, after name/flag (if retained), present:
  - **Build Under Siege** — "Recommended: build and adapt in real time as the Void consumes the city. The intended, more demanding experience."
  - **Build & Watch** — "Prepare your defenses, then unleash the Void and watch the battle unfold. A calmer planning-focused experience."
- Both share the main tech wallet. Record map best-survival, tier badge and attempt count **separately by mode**, but for the first release use **one shared Sparks entitlement per map**, equal to the highest tier earned in either mode. Award only the increase over the existing entitlement. Under Siege can earn separate challenge/prestige badges. Test switching modes cannot produce duplicate Sparks.
- Modes can be changed **between runs**, never midway through a run. Under Siege has active placement and income. Build & Watch permits a placement phase with a defined starting/preparation budget then locks placement during attack; don't enable infinite free prep-income. Both should share combat physics for comparable results.
- **Endless** is an independent mode with run records, not a third main map difficulty setting.

### Scenario portfolio
1. **Tutorial breach:** one failing portal, small city district, gives player first land cannon; can dramatize initial experiment.
2. **Edge advance:** Void enters from one or more map edges, emphasizing continuous front-line defense.
3. **Central rupture:** isolated center portal, defensive ring and sacrificial land islands.
4. **Twin breaches:** two portals, disjoint fronts compete for the shared defense economy.
5. **Delayed collapse:** a second teleporter malfunctions mid-run, telegraphed before activation.
6. **Archipelago city:** separated districts need bridges/reclaimed paths and targeted protection.
7. **Organism escalation:** creatures and advanced tactical Void pressure integrated into later missions.
8. **Endless:** escalating pressure and replayability.

### Void creatures (progressive implementation)
- **Nebula Worms:** comet-like heads and glowing trails, damaging infrastructure or leaving corrosive Void.
- **Constellation Spiders:** thin star-linked spindly legs, deliberately bypass/scale defenses and attack repair hubs.
- **Void Blooms:** slowly open galaxy-like petals, release parasitic stars/spores that consume building pixels.
- **Nebula Queen + Bees:** luminous crystalline queen surrounded by swarming 1-pixel Void bees. **Void Honeycomb Crystals** grow or are established by queens and periodically produce local colonies. This is a mothership/aircraft-carrier enemy archetype.
- **Nexus Crystals (late):** coordinate creatures and focus attacks on observed weak points. Destroying a Nexus disrupts cohesion. The Void may learn/choose tactics but may only react to **visible/touched/observed** defenses, not all player state.
- Creature threat should emerge **both** in later maps and later phases of long individual fights. Begin with simple autonomous rules; add smarter coordinating commanders only when base combat is stable.

## 10. Performance, test and compatibility requirements

### Performance targets (hypotheses, benchmark and revise)
- Desktop: aim for **60 FPS** at typical target zoom with a representative active frontier, many buildings, multiple towers, hundreds of visible small agents and particle effects.
- Midrange mobile: aim for **30 FPS** or better with adaptive effect density, reduced lights, chunk caching and conservative simulation workload.
- Benchmark at world sizes and stresses from section 4. Report worst-case/p95 frame time, simulation work, render work, peak objects, memory, active frontier count, number of agents/projectiles/particles and graph-node responsiveness.
- Void expansion and game outcome must stay **deterministic at a fixed simulation tick**, independent of frame rate, toggled special effects or input zoom.
- Do not promise a numeric target without measuring on actual hardware. Tests should separate simulation cost from rendering cost.

### Required tests
- Procedural map repeatability; world bounds and independent district generation.
- Frontier conservation, deterministic fractional-work budget, contact perimeter, finite energy, disconnected islands, one-pixel island spam, blocked fronts, delayed second portal, error conditions and anti-stall termination.
- Destruction/scoring invariants: no score inflation from newly created land, original baseline remains fixed, thresholds paid only once, preservation after repair.
- Tower costs, placement legality, drag cancellations, strikes and aim previews, touch zoom/pan.
- Unit job selection/hauling, no inaccessible infinite-path loops, resource caps and optional synthetic matter costs.
- Network unlock/dependency validity, modifier effects on all placed instances, respec refunds, no mid-run changes, total balance invariants.
- Build & Watch versus Under Siege restrictions and achievement payout policy.
- Save decode/round-trip, profile choice, invalid data and migration; **old TowerDefense save remains intact**.
- No offline payout after closing/reopening; no background catch-up exploit; no run income for simply watching ambient Lab.
- Accessibility: touch target hitboxes larger than tiny sprite, reduced motion, readable color alternatives.
- Browser screenshots for portrait, landscape, desktop; initial menu, battle with many city blocks, global graph at full size, Lab/Engineering scenes.

**Existing project commands (check AGENTS.md for updates):**
- `npm test` — deterministic Node tests.
- `npm run build` — TypeScript + Vite.
- `npm run test:pointer` — native Defend pointer goldens.
- `npm run test:performance`, `npm run test:stress`, `npm run test:stress-ui`, `npm run test:render-cache` — existing browser stress tools.
- New Void-specific test files and browser scripts should be added without mutating unrelated original goldens. Document any intentional golden update and why.

**Save strategy:** Prefer a new key **`voiddefense.v1`** and a versioned defensive decoder. The old `towerdefense.v1` save should remain recoverable. No silent conversion of historical medieval resources or skill ranks into Void currencies. If explicit opt-in migration is eventually useful, define a deterministic conversion and offer it separately.

## 11. Agent execution protocol

For each phase below:
1. Read `AGENTS.md` and `VoidDefence.md`, the *current* relevant `docs/architecture/*.md`, the source files named in the phase, and this roadmap. Verify symbols; the repository can evolve after this document.
2. State the smallest playable change and intended interfaces before writing code. Prefer adapters/extracted helpers to changing legacy components in place.
3. Implement in small commits with tests for game rules, then rendering/UI, then integration.
4. Run focused tests, `npm test`, and `npm run build`; run relevant browser tests and record performance when touching input/rendering.
5. Keep new module/API descriptions, `CONTEXT.md` glossary, `AGENTS.md` and README accurate as architecture changes; add `docs/architecture/void-defense.md`.
6. Inspect desktop and mobile behavior. **Update the Implementation progress tracker at the top of this document** after each verified phase, with commit/test/screenshot evidence and any blockers. Maintain a detailed optional `docs/void-defense-progress.md` ledger, but it must not replace the in-plan checklist.
7. Preserve deterministic seed/replay behavior, avoid stale legacy constants, and stop a phase if major regression or performance risk cannot be resolved.
8. Do not delete old content early. Build Void Defense alongside it first, then remove dead code only after new features pass replacement tests.

**Source control:** Create a recoverable pre-conversion tag/branch before changes. Follow current repository collaboration/merge rules for any later *implementation* work, but the presence of this plan does not itself authorize implementing all phases in a single unreviewed change. Never break or overwrite the user's original localStorage save.

## 12. Ordered implementation phases and acceptance gates

### Phase 0 — Establish baseline and migration map
**Inspect:** `AGENTS.md`; `docs/architecture/defend-core.md`, `defend-buildings.md`, `defend-play.md`, `rendering.md`, `economy.md`, `shell-ui.md`; old and new game specs.

**Build:**
- Create a short reuse/replace dependency diagram of `src/main.ts`, Defend, Mine, Library, progression, shell and saves.
- Run full tests/build plus existing performance benchmarks and collect baseline results.
- Establish a branch/tag protecting original game and original save examples.
- Write a concrete backlog and new `docs/architecture/void-defense.md` for the isolated implementation.
- Lock provisional MVP rules in config rather than scattered constants.

**Gate:** Baseline build/tests pass; rollback possible; measured old performance; legacy saves untouched.

### Phase 1 — New Void Defense shell and save model
**Inspect:** `src/main.ts`, `src/save.ts`, `src/settings.ts`, `src/profile/model.ts`, `src/profile/editor.ts`, `src/ui/dom.ts`, `src/ui/shell.ts`.

**Build:**
- Add an independently loadable Void Defense page with a placeholder board using existing app shell patterns. Create an explicit bootstrap boundary so the old Mine/Library `advance`, away-time and timed research/forge settlements are not invoked by the new game.
- Introduce explicit run state, progression state, profile/mode, settings and new save key/version.
- First-profile prompt for the two modes. Preserve existing name/flag controls when useful.
- Add a futuristic basic HUD with Supplies, Void Essence, Sparks of Defiance (each shown in relevant contexts).
- Decouple new game startup from Mine/Library away-time processing.

**Gate:** New game page starts, persists a profile/mode, reloads reliably; original game and its old save remain untouched.

### Phase 2 — City-scale renderer and technical proof of concept
**Inspect:** `src/defend/grid.ts`, `citygen.ts`, `render.ts`, `lighting.ts`, `pixel-sprites.ts`, `city-life-art.ts`, camera and performance scripts.

**Build:**
- Configurable large 2D world with logical cell/art-pixel separation, camera pan/zoom and nearest-neighbor crisp rendering.
- Prototype 192x256 versus 256x384 maps of dozens of streets, hundreds/thousands of rooftops, far more varied tiny buildings and a few tall landmarks.
- Draw placeholder 1x1 soldiers, 1x2 engineers, tiny turrets and optional glow with selectable magnification.
- Dirty-chunk static scenery layers and basic level-of-detail.
- Benchmark idle city, scrolling, zooming, screen resize and mobile DPR.

**Gate:** The game **visibly feels like a metropolis**, not nine large medieval tiles, and zoom/pan stay usable. Measured frame time/memory justify chosen map size.

### Phase 3 — Destructible terrain and building physics
**Inspect:** `src/defend/collapse-view.ts`, `citygen.ts`, `render.ts`, city art and destructibility tests.

**Build:**
- Logical terrain ownership and destructible pixel/fragment masks.
- Buildings with original scorable pixel/value baseline, dynamic integrity, connected-component support checks and limited drifting debris.
- Simple restoration/reinforcement operation. Hook seed and replay to every structural change.
- Show meaningful rooftop/side shadows for tall buildings while keeping top-down gameplay.
- Track dirtied map chunks and only recompute local structural connectivity after a relevant change.

**Gate:** A tower can visibly remove and add local matter; individual structures chip, detach and crumble deterministically; large map remains performant.

### Phase 4 — Void field and finite-energy encounter
**Inspect:** `src/defend/blight-*.ts`, `docs/architecture/blight.md`, `src/defend/sim.ts`, `src/defend/performance.ts`.

**Build:**
- Seeded Void sources, active frontier, global energy reservoir, tick budget, erosion/damage against material, spreading and cold starry/nebula render.
- Shared perimeter-budget logic and isolated-island bait behavior.
- The first test mission: an already damaged district with one active Void breach.
- Energy remaining and city-survival status HUD.
- A robust end-of-run condition and no perpetual stalemate.

**Gate:** With no defenses the Void consumes the city; additional sacrificial land slows the city's own erosion; finite energy can run out; win/loss is deterministic.

### Phase 5 — First placeable towers and during-battle interaction
**Inspect:** `src/campaign/ambush-sim.ts`, `src/campaign/ambush-grid.ts`, `src/defend/board-pointers.ts`, `edit-session.ts`, `drag-rules.ts`, `src/ui/spell-bar.ts`, `src/defend/catalog.ts`.

**Build:**
- New placement legality for small tower footprints, occupied road/terrain masks, collisions, resource cost and focus highlighting. Model the during-battle transaction after `AmbushSim.placeAt`/`remove`, with no assumption that legacy `DefendPage` permits active placement; separate the command from rendering.
- Tower palette, drag ghost, selection, refund/sell policy, range outlines, touch magnifier, smart hitboxes.
- Matter Cannon fires real land particles which create/rescue terrain.
- Initial barrier/repair behavior or simple shielding prototype.
- Keep building **while** the fight is active, with clear paused-versus-running rules.

**Gate:** Player can afford, drag, place and use a Matter Cannon during an active Void encounter with both mouse and touch. No impossible placement/duplicate payment.

### Phase 6 — Autonomous engineers, masons and soldiers
**Inspect:** `src/defend/troops.ts`, `civilians.ts`, `city-life.ts`, `building-controls.ts`, `pathing.ts` and performance tests.

**Build:**
- Repair Depot spawns 1x2 engineers/masons; they locate stockpiles/salvage, haul material, repair and upgrade civilian buildings.
- Barracks deploy one-art-pixel orange-rifle soldiers to fire anti-Void shots.
- Basic job priority queues, shared navigation fields and unit caps; no micromanagement.
- City development can exceed original max, add structures/extensions and increase in-run income.
- Visible bullets, sparks, carried bricks, tiny traffic streams and meaningful results from upgrades.

**Gate:** Watching autonomous workers and troops is enjoyable and understandable; each action physically affects terrain or defense. No unbounded pathfinding/particle costs.

### Phase 7 — Minimal player guidance and autonomous logic upgrades
**Inspect:** `src/defend/board-pointers.ts`, `defend/edit-session.ts`, `defend/building-orders.ts`, `defend/building-controls.ts`.

**Build:**
- User-drawn **polyline/closed-shape wall blueprints** with clear build cost/volume preview.
- Dragged/placed infantry focus flag/reticle; a click/tap to cancel or move it.
- Default AI tolerates no user orders; optional orders bias tasks, they do not script every step.
- Data-driven intelligence levels for path priorities, safe retargeting, job coordination and retreat.

**Gate:** Builders execute rough user plans autonomously; rifle squads focus near a marker; both still behave sensibly without orders.

### Phase 8 — In-run economy and accurate scoring
**Inspect:** `src/defend/progress.ts`, `src/progression.ts`, `src/save.ts`, `src/ui/shell.ts`.

**Build:**
- Supplies start amount; periodic income from remaining/developed buildings; costs for structures and strikes.
- Void Essence event accounting/anti-abort constraints; post-run results and awards. Include three simple functional permanent upgrades and free respec in a minimal non-graph menu, proving failure -> earn -> upgrade -> retry before Phase 9 builds the full network.
- Original city baseline, preservation percentage, configurable Sparks thresholds, once-per-map claim ledger.
- If a building is destroyed and repaired, score restoration cannot exceed original baseline.
- Ensure post-run progression earnings remain available after total loss.

**Gate:** Two identical seeded runs produce the same income/result. A loss can pay Void Essence, but not fabricate Sparks; adding arbitrary new land cannot inflate city preservation.

### Phase 9 — Single enormous elastic technology network
**Inspect:** `src/ui/upgrade-graph.ts`, `branch-art.ts`, `tree-motes.ts`, `specializations.ts`, `knowledge-paths.ts`, `ui/specialty.ts`.

**Build:**
- One screen for all tower, unit, economy, command and strike progression; explicit node catalog and global modifier evaluator. Represent logical multi-prerequisite rules independently of the graph renderer's single visual parent, and draw validated secondary-dependency connections.
- Begin with 30–50 useful nodes as an *MVP network* but structure layout and data for 100–300+ without separate per-tower trees.
- Nodes for unlocks, upgrade branches, late technology and Spark breakpoints. Purchasing a tower-type unlock changes future palette.
- Preserve springy elastic movement, faded hidden branches, touch/pan/zoom. Benchmark the current pairwise settling algorithm at 50/150/300 nodes, and optimize neighbor forces/layout and DOM visibility as needed; add inspect/search/focus if necessary for size.
- Full no-penalty refund of Essence and Sparks with dependent-node reversal; block any modification during combat.
- Test state after saving, upgrading, respec, and reopening the game.

**Gate:** A single network controls **all** towers/strikes, with elastic physics retained. No placed building opens an independent persistent upgrade tree. Refunds never lose earned rare points.

### Phase 10 — Futuristic strike abilities
**Inspect:** `src/ui/spell-bar.ts`, `src/defend/edit-session.ts`, `src/defend/meteor.ts`, `frost-nova.ts`, `reinforcements.ts`.

**Build:**
- Rename spell infrastructure where useful, keep input behavior. Implement Landfall first, then Genesis and at least one suppression/defensive strike.
- Drop an isolated matter island in the Void to demonstrate shared contact-perimeter reduction.
- Global network unlock/upgrade nodes for each new strike.
- Clear costs, cooldowns, accuracy preview and mouse/touch targeting; no medieval icon/name leakage.

**Gate:** Drag, preview, place, resolve and cool down. Spell-produced land interacts correctly with frontiers and scores.

### Phase 11 — Resistance Operations: Lab and Engineering Bay
**Inspect:** `src/mine/sim.ts`, `mine/render.ts`, `src/library/sim.ts`, `library/lab-render.ts`, `src/away.ts`, `src/main.ts`.

**Build:**
- Add shared Operations scene with a futuristic Research Lab and Engineering Bay, accessible from shell.
- **Lab:** sample chambers, nebula specimens, scanning equipment, animated monitors, tiny researchers, room growth tied to research/unlock milestones.
- **Bay:** giant turret under construction, 1x2 engineers, welds/gantries, test fire, modules added as weapon branches are purchased.
- Simple finite-state/cosmetic motion and directly derived tech-state scene variants. **No hours-per-resource, ore mining, offline catch-up, idle bank, or per-character production task management**.
- Remove/disable old Mine/Library navigation and away-time hooks for the new game only, without destroying original game saves or code needed during transition. Do not calculate any new-game production from wall-clock time, hidden-tab time or a delayed welcome-back payout.

**Gate:** Scenes reflect unlock progress, show scale contrast (enormous turret/tiny engineers), and are animated but **economically inert while closed, hidden, or unattended**.

### Phase 12 — Modes, profiles and progression campaign
**Inspect:** `src/profile/editor.ts`, `src/profile/model.ts`, `src/defend/progress.ts`, `src/campaign/ambush-ui.ts` (level select patterns).

**Build:**
- First-profile mode picker; change mode between battles.
- Build Under Siege: free in-combat placement for Supplies. Build & Watch: preconstruction with strict budget, then observation with placement locked.
- Multiple map configurations (edge, central, two origins, delayed second portal) and the one-shared-Sparks-entitlement-per-map policy. Keep separate best results/attempts by play style, matching Section 2A.
- Seeded level map replay, preview thumbnails, player best percentage and Sparks earned; optional stars/spark icons and mode distinction.
- Endless survival as alternate episode type with own records.

**Gate:** Switching play style cannot double-claim restricted Sparks or bypass mode rules. Normal battles end; endless rewards and leaderboard-like records work without an infinite-energy win.

### Phase 13 — Advanced towers, creative physics and synthetic matter
**Inspect:** New `src/void/towers.ts`, `agents.ts`, `physics.ts`, `tech/catalog.ts`.

**Build:**
- Wall Serpent leaving a continuous permanent wall trail; Shield Projector; Containment/Gravity Anchor; Rocket Team with land-creating payload; heavy construction/combat mechs.
- Major Spark breakthrough **Matter Synthesis** lets builders construct without hauling but has a balancing resource/power opportunity cost; usual material hauling remains valid.
- Add global tech nodes/modifiers and Operations visuals for each significant unlock.
- Evaluate emergent interactions: wall snakes around Void, islands as decoys, repair/industry build-ups and collapses.

**Gate:** At least three **different** defense strategies can win the first few maps, not simply a single high-DPS tower. All devices visibly interact with world matter.

### Phase 14 — Cosmic organisms and intelligent Void
**Inspect:** Existing `src/defend/blight-worm.ts`, `blight-fliers.ts`, `docs/architecture/blight.md` for reusable tactical ideas.

**Build:**
- Worm/serpent with comet head and nebula trail; spider constellation; bloom/star spores; honeycomb crystals; queen and 1-pixel bee clouds.
- Spatial batching and swarm LOD. Crystals serve as local spawn sources; queen creates/coordinates crystal clusters.
- Later, Nexus/command nodes organize attacks on observed weak spots, with limits on what the AI knows.
- Creature spawn schedules by map and elapsed conflict state, integrated into finite Void energy budgeting rather than infinite free offensive pressure.

**Gate:** Creatures are visually unique, behave differently, affect real terrain/towers, and late tactics are understandable and counterable. Performance holds with representative bee swarms.

### Phase 15 — Art direction, audio, UX and optional visual experiments

**Critical acceptance dependency:** The Phase 0 Visual Quality Recovery Milestone must already have passed representative screenshot review. This phase finishes and polishes that art direction; it cannot be used to defer all city/portal quality until the very end.
**Inspect:** `src/theme.css`, `src/style.css`, `src/defend/pixel-sprites.ts`, lighting/art modules.

**Build:**
- Full Resistance visual identity: orange cyber-industrial accents, steel/glass skyscrapers, flickering windows, lasers, construction sparks; cold starry Void and physically animated disintegration.
- Rework home/shell/map screens, tooltips, achievement results, sounds and feedback for futuristic setting.
- Make overview informative even with tiny sprites; readable resource HUD, simple world-scale selection and restrained particle glow.
- Optional **proof of concept only** for very slightly angled/dynamic camera; do not enable unless it preserves terrain alignment, intuitive hit-testing and 60/30 FPS targets. Straight overhead remains default.

**Gate:** A single screenshot clearly communicates *massive futuristic city versus cosmic Void*; graphics remain legible at normal scale and with reduced motion.

### Phase 16 — Migration cleanup, polish and release
**Inspect:** All dependencies on old idle economies, medieval terms, old spell IDs, old save types, old page routes and exported content.

**Build:**
- Remove obsolete old-game code and assets **only after** new game has parity for intended reused features; if original TowerDefense must remain playable, split it into a legacy entrypoint instead of deleting.
- Replace obsolete documentation references and update README to Void Defense product description.
- Validate CI, Vite relative asset paths, GitHub Pages, mobile orientation/performance, save safety and first-run onboarding.
- Balance income, Void energy curves, research economy, milestone scarcity, respec handling, tutorial clarity and level difficulty.
- Record final production performance, replay determinism and a concise change log.

**Gate:** New game can be played from profile creation through multiple maps, permanent network upgrades, full refunds, victory/loss and endless; Lab/Bay display progress; **no idle-away payouts**; old saves can still be recovered.

## 13. Recommended first vertical slice (stop before mass content)

Before implementing the larger campaign, stop at **Phases 0–6 plus a minimal Phase 8** and ensure there is a fun **single district** prototype:

- Existing TowerDefense-feeling drag and zoom, but on a much bigger metropolitan board.
- A cold, glittering Void already eating city blocks, with a finite energy pool and perimeter sharing.
- One Matter Cannon that fires land, one Repair Depot whose 1x2 workers fix streets/buildings, one Infantry Barracks deploying 1x1 orange riflemen.
- Destructible/repairable city, Supplies from surviving buildings, clear win/loss, and Void Essence even on failure.
- No complex honeycomb swarms, full mega-network, operations art scene, or cinematic polish yet.

**Playtest questions:** Is it satisfying to build/reclaim physical land? Is extra contact perimeter strategically meaningful? Does zoomed-out destruction still read? Do players understand why some city survives or falls? Does income from restored development create interesting choices? Can the game run at target frame rates?

Only after these answers are positive, proceed to the global network and expanded content. This is the main safeguard against investing weeks in art and upgrades before proving the central physics loop.

## 14. Decisions intentionally left tunable

Do not silently lock these without a prototype:
- Exact map resolution, chunk size, art scale, building density and viewport default.
- Whether preservation's top threshold is strict 100% or forgiving 95%; retain the 3-tier concept.
- Exact energy spending for resisted attacks and for creature spawns; determine in balance testing.
- Whether post-loss Void Essence is based primarily on territory-time, defended matter, combat impact or a capped combination.
- The precise relationship between Supplies, strike charges and material synthesis's energy cost.
- The first-release mode reward policy is set to **one shared maximum-tier Sparks entitlement per map** across both modes, with separate best-result records. Reconsider only if playtesting shows it harms the intended difficulty/reward balance; never allow double claiming.
- Whether both Operations zones are in one scrollable side-view canvas or two panels on one Operations tab.
- Whether late Void intelligence uses a local commander, networked crystals or both.
- Whether optional angled view is worth the technical/art complexity at all.

## 15. Definition of done

Void Defense is **not** finished merely because TowerDefense's menus turn orange or its enemy sprites turn violet. It is finished when:

- The player visibly defends a **large futuristic city** with many small buildings and tiny autonomous personnel.
- A **continuous, finite-energy Void** grows by shared frontier pressure, making land islands and terrain-reclamation tactics meaningful.
- **Towers, soldiers, construction swarms, drawn blueprints, targeting markers and strike actions** all affect physical terrain or Void containment.
- Level outcomes reward **percentage preserved**; regular Essence comes from every substantive attempt; special **Sparks of Defiance** unlock and can be fully refunded between runs.
- Every unlock/upgrade is managed by **one responsive elastic global network**, never per-tower independent trees.
- The **Research Lab** and **Engineering Bay** show engaging little futuristic people and evolving huge machines, but do not create **offline income** or demand idle simulation management.
- Both **Build Under Siege** and **Build & Watch** work as defined, with correctly tracked separate results and non-exploitable milestones.
- The visual identity is **warm orange/steel Resistance versus cold cosmic starry Void**, with deterministic simulation, scalable rendering, intact save safety and passing tests; **the user has approved the visual-recovery comparison against the attached reference gallery**.

**Final agent instruction:** Preserve the interaction quality and elastic UI that made TowerDefense enjoyable; replace its scale, theme, idle economy, technology structure and wave-based premise. The new defining experience is **watching a living megacity and hundreds of tiny agents struggle to build and repair reality faster than a beautiful expanding cosmic Void consumes it**.
