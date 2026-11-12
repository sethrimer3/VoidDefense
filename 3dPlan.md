# 3D Plan: Building Depth, Crumbling Structures and Falling into the Void

**Status:** Plan only. Nothing here exists in the code yet.
**Branch rule:** Work in `sethrimer3/VoidDefense` only. Never push to `sethrimer3/TowerDefense`.
**Goal:** Tilt the camera slightly so buildings show their fronts (about **1 world pixel per 2 floors**). Then make buildings at the Void's edge crumble bit by bit and show their floors inside, with chunks, people and units falling *down* into the Void using lightweight physics.

---

## 1. The idea in one picture

Today every building is a flat top-down footprint baked into the terrain chunk cache (`VoidRenderer.paintCell`). Height (`MetroBuilding.height`, 1–30 floors) only affects roof detail and the NW shadow (`computeShadowAt`).

The new view is a **slight oblique (¾-ish) projection**:

```
   roof (shifted up by E px)   ┌──────┐
                               │ roof │  ← drawn at footprint y − E
                               ├──────┤
   south facade (E px tall)    │▒▒▒▒▒▒│  ← floors, windows, lit rooms
   footprint on the ground     └──────┘  ← simulation cells (unchanged)
```

- **Elevation** `E = ceil(height / FLOORS_PER_PIXEL)` with `FLOORS_PER_PIXEL = 2`, so 1–15 px tall.
- The ground (streets, fields, Void, ledges) stays strictly top-down. Only structures are raised.
- If the Void surrounds a building, Void shows on its left, right and bottom, and the raised roof **covers some Void behind it (up-screen)**. That is the effect described.
- Simulation, collision, erosion, scoring, tower placement and hit testing keep using the **footprint**. Height is visual, plus the new collapse state (section 4).

## 2. Hard invariants (carry these into every phase)

1. **One world pixel per simulation cell.** Facades, floors, chunks and people are whole world pixels drawn through `src/void/pixel-painter.ts`. No antialiasing, no blur, no fractional `fillRect` for new art.
2. **Rendering never mutates simulation state.** The tests already check this for ledges and the interior; extend those checks to every new render pass.
3. **Determinism.** Anything that affects the simulation (collapse timing, salvage spawn, deaths) runs inside the 30 Hz `VoidSim` tick using the seeded streams in `src/random.ts` / `hash01` from `grid.ts`. Never use `Math.random`. Pure eye candy may be render-side, but it must be seeded too, so screenshots and tests stay stable.
4. **Saves are unchanged.** `voiddefense.v1` stores no terrain, so nothing new is persisted. Don't bump the save format.
5. **Scoring and balance are unchanged** unless a phase explicitly says otherwise. City integrity stays footprint-based.
6. **Mobile performance.** Stay within the budgets in `docs/PERFORMANCE.md`. Use the existing `lap("…")` timings in `render.ts` to measure each new pass.
7. **Reduced Effects / Reduce Motion.** Static geometry still shows (facades, exposed floors). Falling animation becomes instant removal or a very short drop, and wind, sway and dust go away.
8. Imports keep explicit `.ts` extensions. Docs, `CONTEXT.md`, the `AGENTS.md` command list and the README's "How it's built" are updated in the same change.

## 3. Phase 1: Elevated buildings and facades (rendering only)

**Outcome:** The city looks dimensional. No gameplay change.

### 3.1 Split ground from structures
- In `paintCell`, building cells paint only their **ground footprint** (foundation, plaza paving, or a dark base). Roofs, roof features and windows move out of the chunk cache.
- Add `src/void/elevation.ts`:
  - `FLOORS_PER_PIXEL = 2`, `elevationOf(b: MetroBuilding): number`.
  - `projectRoofY(y, elevation)` and helpers that map a screen pixel back to a building (used for hover/selection).
  - A per-building **sprite cache**: an offscreen canvas holding the roof (the current roof art moved from `paintCell`) plus the south facade. Rebuild it only when the building is dirtied (any footprint cell changed, development changed). Key the cache by `building.id` with a version counter, the same way `dirtyChunks` works.
- **Facade art** (whole pixels, seeded by `building.variant`):
  - Each facade row is two floors. Window columns every 1–2 px. Lit and unlit windows follow the existing night palette and street-light cycle. The base row is darker (lobby/awning). Arch styles from `ARCH_STYLES_BY_DISTRICT` choose glass, brick, neon trim, and so on.
  - Setback tiers (stepped skyscrapers): each tier's roof is raised by its own elevation, so steps read as terraces.
  - The east/west faces are not drawn by default (the camera tilts north–south only). A 1-px darker edge column on each side is enough to suggest volume.

### 3.2 Draw order (painter's algorithm)
- Add a **structure pass** after `paintVoidLedge` (`lap("ledge")`) and before towers. Gather the visible buildings, towers and units, sort by **footprint bottom y** (ties by x), then draw back to front. A building lower on screen overlaps the roof and facade of one behind it, and both overlap the Void behind them.
- Ledges stay below structures. A building at the brink overhangs its own ledge, which is the effect we want.
- Towers get a small elevation too (e.g. 2 px) so they sit in the same sorted list. Agents get 0–1 px.

### 3.3 Shadows
- Replace the ad-hoc logic in `computeShadowAt` with an elevation-based cast: a building shades ground cells up to `ceil(E × 0.6)` px toward the SE (or the current sun angle). Keep it cached in the chunk layer, and invalidate it when a building's elevation changes (Phase 3).

### 3.4 Readability and input
- **Hit testing:** `toCell` stays footprint-based. Also add `pickStructureAt(screenPx)`, which checks the drawn sprite pixels front-to-back, so tapping a roof selects that building.
- **Occlusion fade:** when the player is placing a tower, drawing a wall blueprint, or a selected tower or unit lies behind a facade, draw the occluding buildings at reduced opacity (whole-pixel dither, not alpha blur). Add a setting `buildingHeight: "full" | "low" | "flat"` (flat = today's look). Default is `full`. Save it with the other display preferences (preferences only, not terrain).
- **Camera:** extend the camera clamp so the tallest roofs on the top rows (up to 15 px above the board) aren't cut off.

### 3.5 Acceptance
- A screenshot of a building fully ringed by Void shows Void left, right and below, with the roof covering Void behind it.
- `npm run test:pixels`, `test:crisp`, `test:ledge` and `test:visuals` still pass. Update their expectations only where the change is intended, and say so in the commit.
- Render p50 on the busy-siege benchmark rises by no more than ~15%.

## 4. Phase 2: Structural damage and exposed floors

**Outcome:** Buildings at the Void edge visibly break open and show their insides, floor by floor.

### 4.1 Column model (simulation, deterministic)
- Add `columnFloors: Uint8Array` to `VoidWorld` (one per cell), set from `building.height` at generation and 0 for non-building cells. It's the remaining floors standing over that footprint cell. It lives in memory only.
- In `VoidPhysics` (extending `stepStructuralSupport`), each tick, for damaged buildings:
  - **Lost ground:** if a column's footprint cell becomes Void, that column has no foundation.
  - **Cantilever rule:** an unsupported column can hang on if it touches supported columns orthogonally within `maxSpan = 1 + floor(remainingFloors / 8)` px. Otherwise it **detaches** and its floors spawn falling chunks (Phase 3).
  - **Spalling at the brink:** supported columns next to Void lose floors from the top at a seeded rate scaled by how much Void surrounds them. Upper floors crumble first, and the building gets shorter and ragged.
  - Each change marks the building's sprite dirty, plus nearby chunks for shadows.
- Keep the existing splinter→salvage rule. Under the new model it fires when a column reaches 0 floors with ground still under it, leaving rubble/salvage on the ground.
- **Gameplay neutrality:** income and integrity still use the footprint cells (`buildingAt`, `hp`). Column floors are presentation driven by the simulation. (Phase 5 can tie income to remaining floors if Seth wants that.)

### 4.2 Showing the inside
- When a column is shorter than the building's full elevation, or a neighbour column has gone, the sprite builder draws a **cutaway** for that column:
  - **Floor slabs:** a light concrete line every facade pixel (= every 2 floors).
  - **Rooms between slabs:** wall colour, a lit or unlit interior, and occasional furniture or neon sign pixels chosen by `hash(building.id, column, floor)`.
  - **Broken edges:** ragged, dark rebar-coloured pixels on the torn side, plus a faint violet rim light on edges that face the Void.
- The roof is drawn only over columns still at full height. Shorter columns show their own broken top (slab + rubble).

### 4.3 Acceptance
- Node tests: deterministic `columnFloors` evolution for a fixed seed; the cantilever rule (a 1-px overhang survives and a 4-px overhang falls); rendering leaves `columnFloors` untouched.
- A visual check: a frame sequence of one building being eaten shows its floors exposed progressively.

## 5. Phase 3: Lightweight falling physics ("down into the Void")

**Outcome:** Pieces of buildings, people, units and towers fall down into the Void instead of blinking out.

### 5.1 Coordinates
Everything falling has a ground-plane position `(x, y)` plus height `z` (world px above ground). Screen position is `(x, y − z)`.
- **Over solid ground:** falls until `z = 0`, then bounces once or twice and settles as rubble, salvage or a pixel decal.
- **Over Void:** keeps falling to `z < 0`. Screen y keeps increasing (it sinks "down" the screen into the Void). It darkens toward the Void palette, scales down at depth thresholds (whole-pixel sprite LODs, e.g. 6→4→2→1 px), and is clipped by the **front faces of ledges** (`ledge.ts` geometry) so it really drops behind the cutaway. It's removed at `z < −DEPTH_LIMIT` (≈24 px), with an optional prismatic spark from the existing `DebrisFragment` stream for continuity.

### 5.2 `FallingChunk` (new type in `model.ts`)
```ts
type FallingChunk = {
  x: number; y: number; z: number;        // ground position + height
  vx: number; vy: number; vz: number;
  rot: 0 | 1 | 2 | 3;                     // quarter turns: pixel art stays crisp
  spin: number;                           // turns per second (quantised when drawn)
  sprite: number;                         // index into a shared Uint32Array pixel atlas
  w: number; h: number;                   // ≤ 6×6 px
  life: number;
  settle: "rubble" | "salvage" | "none";  // what it becomes on landing
};
```
- A pooled fixed-capacity array in `VoidPhysics` (cap ~200 chunks; drop the oldest Void-bound chunks first). No allocation per tick.
- Integration: semi-implicit Euler at the 30 Hz tick, gravity `g ≈ 60 px/s²`, small random lateral `vx/vy` away from the building's centre, and slight air drag. No chunk-to-chunk collision. Collision with the ground is a single lookup of `world.material` under `(x, y)`.
- Sprites are cut from the building sprite at detachment (facade pixels plus the room pixels behind them), so a falling chunk looks like the part of the building it was.
- Landing on ground with `settle: "salvage"` deposits salvage through the existing `CellMaterial.SALVAGE` path (deterministic; this is the only part that touches the simulation).

### 5.3 People and units
- **Agents** (`towers.ts`, currently around the `underMat === CellMaterial.VOID` check): instead of instant death, switch to a `falling` state. Drawn as their 1×1 / 1×2 / 2×2 sprite tumbling and sinking with the same depth rules. Gameplay outcome (death, removal) happens on the same tick as today, so balance is identical. Only the visual lingers in a render-side list.
- **Civilians (new, cosmetic):** a small seeded crowd of 1-px pedestrians on streets near the frontier. They flee from the Void toward the nearest intact block. If the ground beneath them is consumed, they fall. Capped (~60 visible). Render-only, never saved, and Reduced Effects turns them off.
- **Towers:** if more than half of a tower's footprint becomes Void, it tips over (quarter-turn rotation) and falls as one chunk. Keep the sell/destroy logic as it is today.

### 5.4 Acceptance
- Node tests: chunk integration (lands on ground, sinks past Void, removed at depth limit); the pool never exceeds its cap; the same seed gives the same salvage cells.
- Browser check `tests/void-depth.mjs` (`npm run test:depth`): captures a building ringed by Void, a mid-collapse sequence and a falling agent, with desktop and phone screenshots in `test-results/void-depth/`. It also checks crisp pixels (no colours outside the palette on falling sprites) and no browser errors.

## 6. Phase 4: Polish

- **Dust puffs:** short-lived 1-px grey particles when a column loses floors.
- **Camera shake:** 1 device-pixel jitter when a large section (≥ 20 columns) falls, off under Reduce Motion.
- **Audio** (`src/void/audio.ts`): a low rumble scaled by the number of chunks falling per second.
- **Void reaction:** a brief brightness ripple in `interior.ts` where a large chunk disappears.
- Bound everything by the same caps, then re-run the performance benchmark.

## 7. Phase 5 (optional, ask Seth first): Gameplay tie-ins

- Income scales with the floors still standing, not only the footprint.
- Falling chunks landing on Void organisms deal damage.
- Masons (`engineer` agents) can shore up an overhang (add support) to slow collapse.

## 8. Files you'll touch

| File | Change |
|------|--------|
| `src/void/elevation.ts` (new) | Projection maths, building/facade sprite cache, cutaway painter |
| `src/void/render.ts` | Ground-only `paintCell` for buildings, new sorted structure pass, shadow change, fade, falling-object pass |
| `src/void/physics.ts` | Column model, cantilever/spalling, `FallingChunk` pool and integration |
| `src/void/world.ts` | `columnFloors` array, initialisation |
| `src/void/model.ts` | `FallingChunk`, civilian type, agent `falling` state |
| `src/void/towers.ts` | Agents/towers fall instead of vanishing |
| `src/void/ledge.ts` | Export front-face clip mask for sinking objects |
| `src/void/ui.ts` + settings | `buildingHeight` display preference |
| `tests/void-depth.test.ts`, `tests/void-depth.mjs` (new) | Node and browser checks |
| `package.json` | `test:depth` script |
| `docs/architecture/rendering.md`, `void-defense.md`, `commands.md`, `AGENTS.md`, `README.md`, `CONTEXT.md` | Docs and glossary (Elevation, Facade, Column, Cutaway, Falling chunk, Civilian) |

---

## 9. Prompt for Gemini Argon (High)

Copy everything in the block below.

```text
You are implementing a feature in the Void Defense repository (TypeScript + Vite, Canvas
rendering, no engine, no framework). Repository: sethrimer3/VoidDefense. Never push to
sethrimer3/TowerDefense.

READ FIRST, in this order, and follow them exactly:
1. AGENTS.md (commands, conventions, test setup, doc rules).
2. 3dPlan.md (this feature's full plan, invariants and acceptance criteria).
3. docs/architecture/rendering.md and docs/architecture/void-defense.md. Grep them for the
   modules you touch rather than reading everything.
4. The source you will change: src/void/render.ts (paintCell, computeShadowAt, the main
   draw pass and its lap() timings), src/void/physics.ts (consumeCellIntoVoid,
   stepStructuralSupport, debris), src/void/world.ts (addBuilding, MetroBuilding.height),
   src/void/model.ts, src/void/ledge.ts, src/void/towers.ts (agents over Void),
   src/void/pixel-painter.ts.

FEATURE
Give the top-down city a slight oblique view: buildings rise 1 world pixel per 2 floors
(MetroBuilding.height is 1-30 floors, so 1-15 px), showing their south facades, while the
ground and the Void stay top-down. Raised roofs must hide the Void behind (up-screen of)
a building. Then make buildings at the Void's edge crumble bit by bit, exposing floors and
rooms inside, and make building chunks, people, agents and towers fall DOWN into the Void
with lightweight physics (ground position + height z; sinking below ground over Void,
clipped by the ledge front faces, shrinking in whole-pixel steps, removed at a depth limit).

IMPLEMENT IN PHASES. Finish, test and commit each phase before starting the next:
  Phase 1  Elevated buildings and facades, sorted structure pass, shadows, roof picking,
           occlusion fade, buildingHeight setting (full/low/flat), camera clamp.
  Phase 2  Per-cell column floors (columnFloors), cantilever and spalling rules in the
           30 Hz sim, exposed floor slabs and rooms in the cutaway sprites.
  Phase 3  FallingChunk pool and integration, agents/towers/civilians falling into the Void,
           salvage on landing, tests/void-depth.test.ts + tests/void-depth.mjs
           (npm run test:depth).
  Phase 4  Polish (dust, shake, rumble, Void ripple), within performance caps.
  Do NOT implement Phase 5 (gameplay tie-ins). List it as a proposal in your final report.

NON-NEGOTIABLE CONSTRAINTS
- One world pixel per simulation cell. All new art is whole pixels via pixel-painter.ts;
  no antialiasing, blur, fractional rectangles or alpha-blurred fades (use pixel dither).
- Rendering never mutates simulation state; add tests that prove it for every new pass.
- Simulation-affecting logic (collapse, salvage, deaths) runs in the fixed 30 Hz tick with
  the seeded streams in src/random.ts / hash01 in src/void/grid.ts. Never call Math.random.
- Tower placement, collision, erosion, hit testing and scoring stay footprint-based.
  Balance and income must not change. Don't change the voiddefense.v1 save format.
- Reduced Effects / Reduce Motion: static facades and cutaways remain; falling motion,
  dust, shake and civilians are suppressed or made instant.
- Performance: measure with the existing lap() timings and the benchmarks in
  docs/PERFORMANCE.md. Render p50 on the busy-siege benchmark must not rise by more than
  ~15% after Phase 1, or ~25% total. Pool falling objects (no per-tick allocation) and cap
  them (~200 chunks, ~60 civilians).
- Imports use explicit .ts extensions. Use CONTEXT.md vocabulary and add the new terms
  (Elevation, Facade, Column, Cutaway, Falling chunk, Civilian).

VALIDATION (every phase)
- npm test (use the test-failures-only skill) and npm run build (use run-quiet).
- With the dev server running: npm run test:pixels, test:crisp, test:ledge, test:visuals,
  test:defense, and from Phase 3, test:depth. If an existing expectation must change because
  the look intentionally changed, change it narrowly and explain why in the commit message.
- Save desktop and phone screenshots for: a building completely ringed by Void (Void
  visible left, right and below; roof covering Void behind it), a mid-collapse sequence
  showing exposed floors, and a falling agent/chunk. Inspect them yourself before claiming
  success. If they don't look right, fix them; don't report success.

DOCS (same commit as the code)
Update docs/architecture/rendering.md, docs/architecture/void-defense.md,
docs/architecture/commands.md, the AGENTS.md command list, README "How it's built" and
CONTEXT.md. Tick off the phases in 3dPlan.md with the commit hash that completed each.

DELIVERY
Follow the AGENTS.md workflow: after each phase is implemented and fully validated, commit
and merge into main. In your final report, list per phase: what changed, test results
(pass/fail with output for failures), benchmark numbers before and after, screenshot paths,
anything skipped and why, and open questions for Seth. Never claim a phase is done without
the tests and screenshots to show it.
```

## 10. Progress tracker

| Phase | Done? | Commit / evidence |
|-------|-------|-------------------|
| 1. Elevated buildings and facades | - [ ] | |
| 2. Structural damage and exposed floors | - [ ] | |
| 3. Falling physics | - [ ] | |
| 4. Polish | - [ ] | |
| 5. Gameplay tie-ins (optional) | - [ ] | Needs Seth's go-ahead |
