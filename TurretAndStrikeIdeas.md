# Turret and strike designs: reusable implementation briefs

Status: proposed designs, not implemented behavior. Use each feature prompt independently with the shared contract below to keep implementation tasks concise. Numbers are starting balance values, not established game constants.

## Shared implementation prompt

> Implement the selected feature brief in `TurretAndStrikeIdeas.md`. Read `AGENTS.md` and inspect the current tower/strike catalogs, combat, Void propagation, terrain mutation, rendering, tech wallet, UI/localization, saves, and tests. The code may have evolved since this document was written; integrate with the current implementation, including any building collapse/falling systems. Implement working gameplay, distinct pixel art, targeting feedback, upgrades, deterministic tests, browser checks, and matching documentation. Use existing simulation timing, seeded randomness, terrain mutation APIs, and save conventions. Keep mobile controls, pause/speed behavior, Reduced Motion/Effects, relative asset URLs, and old saves working. Avoid new engines or dependencies unless justified. Measure the affected hot path, cap work and visual pools, and never let cosmetic settings change gameplay. Run relevant tests, the full Node suite, build, and representative browser gameplay checks; report actual results. Merge validated requested changes into main on sethrimer3/VoidDefense, preserving unrelated work. Do not implement the other briefs unless requested.

### Shared integration plan

1. Trace the actual ownership of damage, spreading, support loss, restoration, death, income, and scoring. Define each effect at its authoritative simulation hook before adding visuals.
2. Register tower/strike metadata and tech upgrades through existing catalogs. Add localized names, descriptions, tooltips, targeting previews, cooldown/cost feedback, and clear unavailable-target states.
3. Implement deterministic simulation first, then visual state driven by simulation events. Explicitly handle overlapping effects, edge-of-map casts, pause, speed changes, restart, and old saves.
4. Test meaningful behavior and failure cases, then capture a seeded browser demonstration. Document the final rules and commands. Tune provisional balance after comparisons with existing options.

### Distinct roles and visual language

| Feature | Form | Main verb | Shape and motion |
|---|---|---|---|
| Chrono Cannon | Tower | Recover recent losses | Clock rings; objects rise; shot returns to barrel |
| Boundary Prism | Tower | Redirect pressure | Triangular crystal; angled plane and sideways flow |
| Quarantine Bell | Strike spell | Isolate an area temporarily | Suspended bell apparition; closed circular seal |
| Void Siphon | Tower | Absorb pressure into finite storage | Round glass tank; inward streams and visible fill |
| Hearthseed | Strike spell | Create a small living island | Seed-like spark; rising earth, sprouts, little field rows |

Use shape, direction, and persistent state as well as color. Preserve readable silhouettes at native world resolution; avoid five similarly colored expanding circles. These defenses buy space and time in different ways; none should be an automatic permanent cure for the Void.

## 1. Chrono Cannon — tower

### Idea and behavior

A localized rewind retrieves what the Void recently took. Unlike material deposition, it can restore an actual lost building section or unit, including its identity and prior condition. It cannot manufacture an arbitrary historic city.

Initial balance experiment: target within normal long-range tower reach; radius 5 ground cells; recover up to 6 seconds of recent Void-caused loss; 12-second firing cooldown; fixed restoration budget per cycle. Choose final cost and budget relative to existing restoration towers. Prioritize recoverable units and valuable structure within the area, then ground. Explain targeting priority in the tooltip.

Automatic targeting chooses a recent recoverable-loss cluster. Reuse tower targeting controls if available; avoid adding a mandatory manual firing interface just for this tower. Show the recovery radius, eligible ghost silhouettes, remaining recovery window, and a brief reason when nothing can be recovered.

### Signature animation

A broken clock-ring forms at the destination before any outward projectile appears. Falling motion rewinds: people and chunks ascend from the Void, fragments rotate back, exposed floors stack into place, and the facade closes. A reverse flash contracts into a bright point. The point travels FROM the restored area BACK into the muzzle; cannon rings rotate backward and lock. No conventional outgoing bullet followed by a normal explosion. Keep the target tell readable before restoration resolves.

Visual recovery must correspond to the authoritative restored entities. If the original visual fragment has already been culled, reconstruct a short seeded reverse sequence from recorded loss metadata. Pause/speed and reduced-motion presentation must still complete cleanly.

### Rules that prevent exploits

- Keep a bounded recent-loss journal or compact snapshots/deltas, not full-world snapshots every tick. Record stable identities, prior supported state, loss time/cause, and whether recovery has been consumed. Retain enough history to recover entities after cosmetic debris disappears.
- Recover only Void consumption/collapse losses within the window, not sold towers, spent ammunition, expired summons, voluntary actions, or arbitrary combat deaths. A unit lost because its ground fell away qualifies.
- Restore required support before structure/units. A unit needs a safe valid placement; use a bounded local fallback search, otherwise skip it without consuming its recovery budget. Never create intersecting buildings or duplicate IDs.
- Overlapping cannons claim a recovery record once. A restored entity may be lost again later, creating a new loss event; prevent same-event replay and resource farming.
- Do not rewind wallet, cooldowns, global clock, tech, total earned rewards, or unrelated entities. Account for already awarded salvage/loss rewards through the existing ledger: recovery must not duplicate value or silently create negative resources. Define exact accounting before implementation.
- Restored units retain identity and appropriate prior state; cap recovered health to recorded health. Restoring buildings must synchronize floors, support, footprint ownership, integrity, income, and dirty regions. Immediately re-evaluate support so recalled objects cannot float indefinitely.

### Implementation plan

1. Add loss journal hooks to terrain, structural detachment, and Void-caused unit removal; establish memory bounds and deterministic eviction.
2. Build a transactional recovery selection/resolution API with dependency ordering and single-use event claims.
3. Register cannon, autonomous targeting, range preview, cooldown, and bounded rewind events.
4. Add rising entities, rebuilding floor layers, reverse flash, and returning projectile.
5. Upgrade branches: longer recovery window, larger restoration budget, then modest area. Keep these independent so a wider radius does not imply unlimited history or mass resurrection.

### Acceptance checks

Recover a fallen unit and partially collapsed building; reject old/ineligible loss; test overlapping cannons, unsafe placement, repeated loss, journal eviction, reclaimed ground, destroyed cannon, pause/speed, and restart. Assert unique IDs and resource accounting. Browser evidence must show upward reconstruction and a projectile returning to the gun.

### Feature prompt

> Implement the Chrono Cannon brief using the shared contract. Its essential behavior is bounded recent-loss recovery of terrain, structures, and Void-fallen units, with real upward reconstruction and a reverse projectile returning into the barrel. Resolve journal ownership, dependency ordering, and anti-duplication accounting before rendering. Deliver all plan steps and acceptance checks.

## 2. Boundary Prism — tower

### Idea and behavior

A directional crystal bends an advancing Void front sideways rather than rebuilding terrain or dealing ordinary damage. It protects a chosen corridor by routing pressure toward adjacent exposed frontier. It is useful near a valuable block, but the redirected threat still needs somewhere to go.

Initial experiment: a 12-cell-long boundary plane, 3-cell influence band, and at most 35% local pressure redirection. Use a small set of snapped orientations selected with the existing placement/rotate interaction; show the plane and receiving flanks before placement. Mobile users must be able to orient it without keyboard shortcuts.

### Signature animation

A tall triangular crystal projects a thin, sharply angled faceted plane. Void tendrils approaching it visibly kink along the boundary. A few directional chevrons or pulses indicate the destination flank; active segments brighten under load. An overloaded prism develops branching cracks. Do not render it as a circular shield.

### Simulation rules and plan

1. Identify the authoritative frontier/erosion budget hook. Redirect a bounded portion of local eligible pressure to nearby eligible Void-front cells on the selected flank; do not move arbitrary filled Void cells or convert pressure directly into free land.
2. Preserve the redirected quantity through accumulation and rounding; keep a defined unredirected remainder. If no valid receiving frontier exists, use normal local erosion rather than deleting pressure.
3. Evaluate contributions from a stable pre-step state. Cap the total redirect fraction from all prisms and prevent same-tick ping-pong or loops. A redirected contribution is not redirected repeatedly that tick.
4. Define overload from excess incoming pressure; initially let excess pass normally. Destruction or sale removes the influence immediately.
5. Add previews, directional art, overload tell, and upgrades for plane length, steering efficiency with a hard ceiling, and overload tolerance. Quantities and radius must stay bounded.

### Acceptance checks

Compare identical seeded worlds with/without the prism: the protected side erodes less while the receiving flank gets corresponding pressure. Test no receiving cells, world edges, crossing prisms, opposing prisms, rotation, sale, and high load. Verify conservation, stable iteration, and a visually legible redirected front.

### Feature prompt

> Implement Boundary Prism using the shared contract and its brief. Build a directional, pressure-conserving frontier redirector with explicit flank targeting and bounded overlapping influence. It must visibly bend the front sideways and must not become a land-restoration beam or an infinite shield. Include conservation and overlap tests plus browser placement/rotation evidence.

## 3. Quarantine Bell — strike spell, NOT a tower

### Idea and behavior

Cast a temporary closed seal around an area to stop the Void crossing its boundary. It buys time to repair, recall units, or evacuate. Existing Void inside the seal remains active; the spell does not clean its interior or freeze all combat.

Initial experiment: radius 10 cells, duration 6 simulation seconds, cooldown 35 seconds. The seal blocks terrain-consumption propagation across its circumference in both directions. It does not prevent ordinary actor/projectile movement or exempt structures from damage already occurring inside. Keep these rules explicit in the targeting tooltip.

### Signature animation

A translucent bell briefly appears above the target and swings once. Its descending chime traces a closed ring with regularly spaced seal marks. Boundary contacts flash as the Void presses against them. Marks fade in a clear countdown; one final soft crack releases the seal. Sound is optional and follows existing audio settings. Reduced Motion uses a static bell and seal.

### Implementation plan and rules

1. Register a strike and timed simulation effect; no placeable tower, tower footprint, or permanent bell entity.
2. Apply a boundary-crossing predicate at the Void propagation hook, using source and destination ground cells. Cover diagonal/long-step paths if the spread algorithm permits them; avoid gaps caused by rasterization.
3. Block cross-boundary propagation without collecting a deferred super-wave for expiry. Define how this composes with prism redistribution: redirected pressure must obey the seal too, and blocked contributions must not be repeatedly rerouted in a loop.
4. Existing internal erosion, organisms, attacks, and collapse keep their own normal rules. Make blocked scope precise; do not accidentally make the whole disk invulnerable.
5. Overlapping seals use independent timers and block a crossing while any applicable seal blocks it. They do not multiply damage or lengthen each other's duration. Add cost, cooldown, targeting preview, effect radius, and remaining-time feedback.
6. Upgrades increase duration and radius in separate capped branches; evaluate combined coverage/cooldown to avoid permanent cheap lockdown.

### Acceptance checks

Verify outside-to-inside and inside-to-outside spread is blocked; internal spread still works; ordinary movement and attacks continue. Test expiry without burst backlog, overlapping seals, diagonal boundaries, prism interaction, map edge casts, and pause/speed. Browser evidence shows one complete ring, contact reactions, countdown, and release.

### Feature prompt

> Implement Quarantine Bell as a strike spell using the shared contract. It temporarily blocks Void propagation across a circular boundary in both directions, while existing interior threats remain active. Do not add a bell tower. Implement robust boundary tests, expiry/overlap behavior, targeting and countdown feedback, and the bell-and-seal visual sequence.

## 4. Void Siphon — tower

### Idea and behavior

A finite containment tank intercepts nearby erosion pressure and stores it. It suppresses a local advance until the tank fills; it does not resurrect lost land or eliminate the entire Void. Place it where you can survive its vulnerable vent cycle.

Initial experiment: 9-cell intake radius, interception capped at 25% of eligible local erosion pressure per tick, storage equivalent to roughly 5 seconds of intake at its rated limit. At full storage, enter a 4-second vent/cooling cycle: no intake, stored energy dissipates visibly, then resume. Choose a bounded local visual vent rather than damaging unexplained distant terrain. Selling/destruction clears storage without rewards or an untelegraphed explosion in the first implementation.

### Signature animation

A round glass reservoir sits in a heavy frame. Thin dark streams enter visible ports from threatened frontier segments. The tank's swirling fill level rises, with a clearly visible maximum line and pulsing warning bands. At capacity, shutters close and a vertical plume vents upward; the empty tank cools and reopens. Distinguish it from the Chrono Cannon: no returning bullet, rising buildings, or clock rings.

### Implementation plan and rules

1. Integrate interception at the erosion-budget stage. Each intercepted amount reduces eligible erosion and adds the same quantity to storage, using consistent units; apply capacity before reducing erosion.
2. Share eligible pressure deterministically among overlapping siphons so it cannot be counted twice. Restrict intake to reachable/valid local frontier contributions, and define interaction order with prisms and quarantine seals.
3. Use explicit intake → full → venting → intake state. Timers advance on simulation time, including offscreen. No intake during venting. Unused intake capacity must not accumulate into an unbounded burst.
4. Add capacity meter, range preview, phase feedback, and upgrades for tank capacity, capped intake rate, and shorter vent duration with a nonzero minimum.
5. Keep particle streams capped and driven by real intercepted contributions; show idle ports when no eligible pressure exists.

### Acceptance checks

Assert pressure/storage accounting, exact capacity clamping, no double intake, full-tank phase transition, no intake while venting, and restart/sale/destruction cleanup. Compare normal and Reduced Effects outcomes. Browser evidence must show filling, warning, venting, and resumption without terrain restoration.

### Feature prompt

> Implement Void Siphon using the shared contract. It absorbs a bounded amount of eligible erosion pressure into finite storage, then stops intake for a visible vent cycle. Preserve accounting with overlapping siphons and other frontier modifiers. Deliver a distinctive filling glass tank, readable phase UI, deterministic tests, and a complete browser cycle.

## 5. Hearthseed — land-creation strike spell

### Idea and behavior

A small seed-like spark lands in the Void and creates a little patch of solid land. Area upgrades make it a larger, cuter island, with trees and tiny farmland plots appearing as space permits. This creates NEW land; it does not rewind a destroyed building or resurrect units.

Suggested player-facing name: **Hearthseed**. The spell should feel like a small gift of countryside amid the cosmic disaster: a warm patch of earth, a few trees, tidy crop rows, perhaps a tiny fence at the highest rank. Avoid introducing an entire farming economy.

### Existing-feature decision

The inspected catalog already contains `landfall`, an area/durability upgrade, and `genesis`, described as synthetic bedrock reclamation. Inspect their current behavior before implementing. Prefer evolving the existing small land-placement strike into Hearthseed, keeping its stable ID and save compatibility, if it already fills this role. Keep Genesis distinct as broad engineered reclamation. Do not ship two mechanically identical small land spells with different names. Document the chosen mapping and update every UI reference.

### Upgrade progression

| Rank | Initial radius | Approximate area relative to base | Landscape |
|---|---:|---:|---|
| Base | 4 cells | 1× | Earth/grass island, a few sprouts |
| 1 | 5 cells | 1.56× | One or two small trees if space permits |
| 2 | 6 cells | 2.25× | Small farmland patch, trees on margins |
| 3 | 7 cells | 3.06× | Several crop rows, clustered trees, optional tiny fence |

These are provisional world-cell radii. Radius increases area quadratically; UI descriptions must distinguish radius from area. Balance supplies/cooldown against the actual eligible cells created. Use a stable, slightly irregular nested footprint: higher ranks include the lower-rank footprint for an equal center/seed, with monotonically increasing eligible area. At small scale, recognizable crop rows matter more than many decorative objects.

### Placement and world rules

- Target a small disk on the ground plane with a preview of actual eligible cells, clipped to map boundaries. Permit isolated islands in Void as well as extensions of surviving banks, subject to existing strike targeting restrictions.
- Convert only eligible Void cells through the supported terrain mutation/reclamation API. Preserve intact land, water rules, occupied structures, scenario exclusions, and original-building metadata. Invalid/no-op casts should not spend supplies or trigger cooldown.
- Create stable ground, not a paper-thin visual overlay. Re-evaluate support and navigation through normal hooks, so it can support legal units and construction and can be eroded again normally.
- Do not restore original buildings just because terrain reclamation tracks original ownership. Use an explicit new-land mode where needed; never duplicate baseline score, income, or salvage.
- Place trees and farmland deterministically on newly created surviving cells only. They must not overlap active structures, obstruct required paths, or spawn off the island. Keep a compact planting margin from its edge.
- Treat planted features as visual terrain decoration by default. They grant no automatic supplies, unit spawns, income, or score. If current farmland is mechanically valuable, separate decorative crops from economy-bearing land explicitly.
- Newly created mass must interact with existing perimeter budgets and terrain durability honestly. Trees/crops disappear or fall according to current destruction rules when their support is consumed.

### Signature animation and implementation plan

1. Decide reuse/rename mapping for Landfall and tech ranks; preserve saved unlocks and investment/refunds.
2. Implement deterministic nested footprint generation and mutation with actual affected-cell feedback.
3. Animate a warm seed descending, compact ground rising from below, then grass, trees, and crop rows appearing in order. Unlike Chrono, nothing reconstructs a historical state. Keep settlement brief; define the exact tick at which cells become usable.
4. Generate landscape patterns from center/seed/rank; use native pixel shapes and existing terrain palettes. No large art asset requirement.
5. Integrate targeting, cost/cooldown, rank descriptions, localization, support/pathfinding invalidation, and decoration cleanup.

### Acceptance checks

Verify monotonic area upgrades, deterministic planting, valid terrain ownership, map-edge clipping, isolated islands, casts beside structures, no-op cost handling, correct save/tech migration, no free economic rewards, erosion/recast cleanup, and valid unit/construction support. Browser captures show all four ranks, with trees and cute recognizable farmland on upgraded islands.

### Feature prompt

> Implement Hearthseed using the shared contract and brief. First inspect Landfall/Genesis and evolve the existing small land-placement spell when appropriate rather than duplicating it; preserve stable IDs, saves, and tech investments. Create a small real island, upgrade its area monotonically, and add charming seeded trees and farmland at larger ranks. This is new terrain, not historical resurrection. Deliver rank previews, distinct animation, safe terrain mutation, economic isolation, and deterministic/browser validation.

## Cross-feature composition and suggested delivery order

Implement Hearthseed first to establish safe new-land mutation and support invalidation; Quarantine Bell next for temporary boundary effects; Void Siphon next for erosion accounting; Boundary Prism after that for conservative routing; Chrono Cannon last because it needs a loss journal and transactional resurrection. Each feature must still work if shipped independently.

Before multiple frontier features coexist, define one explicit evaluation order: collect normal pressure from a stable state → apply boundary crossing constraints → redirect eligible pressure once, validating destination seals → allocate eligible siphon intake once → apply remaining erosion → resolve support/collapse/loss events. Adapt this order to the actual solver while preserving the stated invariants. Do not accumulate blocked bell pressure or let prism loops amplify it.

Chrono restoration and Hearthseed casts resolve through ordered simulation commands, followed by normal support evaluation. Define stable same-tick ordering for restoration versus destruction so results cannot depend on rendering or collection insertion order.

Combined regression scene: protect a damaged block with a Bell, redirect approaching pressure with a Prism, fill and vent a Siphon, grow an upgraded Hearthseed island, then recover a recently fallen unit/building with Chrono. Assert stable identities, accounting, bounded effects, and identical gameplay with reduced visual settings.
