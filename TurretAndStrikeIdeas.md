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

## Gemini execution instructions for the additional roster

Use Gemini with High reasoning and the shared implementation prompt at the top of this document. The following five briefs extend the roster; they are implementation specifications rather than a request for another planning document. Implement a selected brief completely, including simulation, art, UI/tech, tests, and documentation. If asked to implement the additional roster, complete all five in the order suggested below. Inspect the current 2.5D collapse and falling implementation rather than assuming the earlier top-down architecture still applies. Do not use mock particles to substitute for authoritative terrain, targeting, or spreading behavior.

## 6. Lantern Bearers — non-attacking infantry, walking solid ground

### Required behavior

Lantern Bearers never attack. Wherever a living bearer stands, there is real, solid, usable ground beneath them, unconditionally—even deep inside purple Void, during maximum erosion pressure, or while nearby terrain collapses. This is an authoritative simulation invariant, not regeneration that can lose a race with damage. Do not add charges, fuel, pressure thresholds, intermittent uptime, or a cooldown that weakens that guarantee.

Each bearer carries a small protected footprint. Suggested initial footprint: the occupied ground cell plus a compact one-cell halo, adjusted for the actual agent scale. Upgrade the halo to escort nearby ground units. The bearer can deliberately walk into Void: destination footing must exist before normal movement/support checks reject the step. Their movement orders and pathfinding must support this, without letting every other ground unit walk across unsupported Void.

As the bearer moves away, former protected ground becomes vulnerable again. Track provenance: temporary footing created over Void returns to Void when no living lantern covers it, unless a legitimate permanent-land effect has replaced it. Pre-existing terrain is merely unprotected again, not deleted. Overlapping lanterns preserve coverage until the last one leaves. People and structures supported only by disappearing temporary footing obey normal support-loss/falling rules.

Enemies can attack and kill the bearer normally. Resolve death and coverage removal in a stable order, then re-evaluate support. The unconditional footing guarantee applies while alive, not invulnerability to attacks. Recalled bearers must reacquire coverage before support evaluation. Prevent permanent paving, score/salvage farming, accidental resurrection of building metadata, or a full terrain rebuild every tick.

### Visual and upgrades

A tall carried lantern is the distinguishing silhouette. A warm pool of light follows the bearer; small stones rise into a clearly outlined patch under their feet. Show a continuous safe footprint and its edge, including when other effects overlap it. Ground created by the lantern must look solid, distinct from amber frozen Void. Reduced Motion retains clear coverage with minimal rising particles.

Upgrade branches: escort radius, bearer survivability, and movement/escort utility. No weapon branch. Give selection/range previews and tooltips that explain temporary ground, guaranteed footing, and the risk of losing the bearer.

### Implementation plan and acceptance

1. Add a coverage/provenance layer through supported terrain APIs, with reference counts or equivalent stable overlap handling. Define effective terrain queries used by movement, erosion, construction, support, targeting, and rendering.
2. Integrate movement into Void and update coverage atomically before erosion/support. Reassert protected ground across every relevant destructive path; do not scatter inconsistent exceptions.
3. Integrate release, overlap, death, recall, permanent reclamation, and cleanup. Temporary coverage cannot produce permanent economic rewards.
4. Add lantern art, safe-ground edge, previews, upgrades, and localization.
5. Test maximum pressure, deliberate traversal into deep Void, paused movement, overlapping bearers, map edges, death under attack, dependent units falling, and permanent land creation beneath a lantern. Assert a living bearer never spends a simulation step unsupported, and never attacks.

### Feature prompt

> Implement Lantern Bearers using the shared contract and section 6. They are non-attacking infantry that ALWAYS create/protect solid ground wherever they stand, including inside the Void. Make movement, support, terrain provenance, overlapping coverage, and death correct at simulation level. Ground behind them becomes vulnerable again without deleting pre-existing or legitimately reclaimed terrain. Deliver escort-radius upgrades, unmistakable lantern/safe-footprint visuals, and invariant-focused tests.

## 7. Seamwalkers — infantry that arrest the Void frontier

### Required behavior

Seamwalkers fire short-range staple weapons at eligible Void frontier sections. Staples temporarily arrest local Void advancement, buying time without reclaiming land. Frozen Void remains Void: it is not walkable, buildable, or safe footing. The effect must genuinely affect propagation, not merely slow an animation.

Suggested initial behavior: staples hold a compact edge segment for 2 seconds, with a firing cadence that lets a small squad maintain one narrow breach under ordinary pressure. Set final dimensions/rate relative to the actual simulation scale. Use a finite effective duration and bounded overlap/refresh rules; many soldiers cannot bank unlimited future freeze time. Existing organisms, damage, and falling continue unless separately affected by another mechanic. Freeze is not universal invulnerability.

### Frozen-Void visual contract

Use DARK purple interior with ORANGE/AMBER rigid seams, angular plates, and embedded U-shaped staple marks. Freeze local flow animation while retaining visible surface detail. A stressed boundary pulses or cracks, then resumes normal purple movement on release. The visual coverage must match the simulation coverage, not a misleading large glow.

Countervoid also uses orange, so color cannot carry the distinction: frozen Void is stationary, angular, dark, and stapled; friendly Countervoid is luminous, flowing, and visibly advancing. Add accessible shape/pattern cues and inspect both adjacent at native pixel scale. Reduced Motion keeps frozen markings and a readable expiry cue.

### Implementation plan and acceptance

1. Register infantry, recruitment/tech, target selection, and deterministic staple impacts. Reuse the current unit system; inspect whether ordinary infantry are individually controlled or squad-managed.
2. Add bounded timed frontier holds at the authoritative propagation hook. Define behavior with Quarantine Bell, redirected pressure, and later Countervoid contests; freezing must not erase or accumulate erosion pressure into an expiry burst.
3. Add staple projectiles, embedded marks, frozen surface mask, expiry feedback, and upgrades for segment width, hold duration, and rate within hard caps.
4. Test real suppression, expiry, stacked shots, dead/sold sources, no frozen-ground walking, diagonal frontier paths, pause/speed, and identical simulation under Reduced Effects. Capture freeze and thaw beside active purple and friendly orange Void.

### Feature prompt

> Implement Seamwalker infantry using the shared contract and section 7. Their staple weapons arrest local Void propagation without restoring land. Make frozen Void clearly readable through rigid amber-orange seams, dark motionless interior, and staple marks; keep it unmistakably different from flowing friendly Countervoid. Deliver bounded refresh rules, upgrades, real propagation tests, and browser freeze/thaw evidence.

## 8. Jetpack infantry — airborne organism hunters

### Required behavior

Jetpack soldiers attack enemy organisms only. They do not shoot terrain/the Void field, repair ground, or provide a restoration aura. They can traverse Void, water, holes, and collapsing ground without falling into it. Their airborne safety is unconditional while alive; no fuel system or mandatory landing in the initial implementation.

They can be attacked by flying enemies or enemies explicitly equipped to target air. Establish explicit target-layer/capability metadata, and audit existing enemies rather than inferring capability from a sprite. Ground-only attacks cannot damage them indirectly through an overly broad target query. Area attacks need an explicit affected-layer rule. Flying enemies that can attack units must be able to engage jetpack troops; a harmless flying decoration does not gain an attack merely from flight.

Use higher cost, modest health, and specialist anti-organism damage as initial tradeoffs, not invented crash risk. Ordinary ground units must retain existing falling behavior. A killed jetpack soldier may have a short falling death visual, but is already dead and untargetable; this is distinct from a living soldier losing ground support.

### Visual, upgrades, and implementation

Use a compact twin-nozzle backpack, separated exhaust points, a visible hovering offset, and a small projected ground shadow where a surface exists. Show position over Void without painting a fake safe-ground circle. Keep gunfire aimed at organisms and visuals crisp with the existing depth/occlusion system. Reduced Motion removes bobbing and noisy exhaust but preserves airborne identity.

1. Add movement/target layers and explicit enemy air-targeting capabilities through the existing combat system; cover selection, projectiles, area damage, and target reacquisition.
2. Add jetpack recruitment, movement over unsupported cells, anti-organism weapon, and tech upgrades for weapon specialization, armor, and flight speed. Avoid upgrading them into ground attackers.
3. Integrate depth sorting, hovering art, death cleanup, pause/speed, restart, and compatible unit serialization if applicable.
4. Test traversal through deep Void and newly collapsed buildings without support loss; ground-only immunity; flying/anti-air damage; target-layer-correct AoE; no terrain attack; and cleanup of killed airborne targets. Browser evidence must include a real anti-air engagement over Void.

### Feature prompt

> Implement jetpack infantry using the shared contract and section 8. Living jetpack troops never fall because ground disappears and can travel over Void. They attack enemy organisms only, and are vulnerable to flying attackers or explicit air-targeting attacks. Implement explicit movement/target layers, audit AoE and projectile filtering, and deliver distinct flight art, upgrades, and ground-versus-air combat tests. Do not add fuel or forced landing.

## 9. Echo Mine — decoy tower with a destruction explosion

### Required behavior

A short-range decoy tower broadcasts an attractive false signal. Nearby eligible organisms switch attention to it, approach, and attack. Enemy-caused destruction triggers a clearly telegraphed explosion that damages nearby enemies. This is an actual change in enemy targeting/pathing, not an idle visual beacon.

Suggested initial radius: 10 ground cells, adjusted after comparison with normal tower ranges. Use a finite simultaneous-target budget and a short re-evaluation interval. Organisms must have a reachable/attackable way to engage the decoy under their movement rules; do not lock them into impossible paths. Give elites reduced lure duration or resistance through explicit metadata. Lure cannot silently override scripted critical behaviors indefinitely.

Attraction ends immediately when the tower dies. A brief dying-core tell then resolves one blast; do not require enemies to continue targeting a removed tower. Keep the delay short enough to catch nearby attackers. A separately unlocked Persistent Echo may retain a temporary lure target at the blast location, without reviving the tower.

### Visual and skill tree

An exposed pulsing core sits inside a spindly beacon frame. Nearby lured enemies gain a small matching signal mark or a clear turn/approach response. The core pulses faster as enemies gather; a contracting warning ring shows the explosion radius before a sharp outward blast. Distinguish its continuous attracting pulses from the Bell's closed quarantine seal.

- **Stronger Signal:** Increase short lure radius and simultaneous-target budget with explicit caps.
- **Volatile Core:** Increase blast damage and radius; show final blast area in preview.
- **Persistent Echo:** A short post-destruction signal keeps eligible enemies near the detonation site. It uses its own bounded timer and target identity.

Use the existing tech DAG conventions, ranks, prerequisite checks, refunds, and descriptions. Do not create a separate upgrade UI for this tower.

### Implementation plan and acceptance

1. Add decoy candidates and deterministic enemy retargeting with hysteresis, eligibility, resistance, and tie-breaking across multiple towers. Avoid frame-by-frame target thrashing and scanning every enemy against every tower without spatial bounds.
2. Register the tower, signal/blast previews, and tech branches. Store relevant ranks/effect values at the correct existing lifecycle point.
3. Add a single authoritative detonation event. Selling, refunding, loading a save, scenario cleanup, and despawning cannot trigger it. Define enemy-caused terrain/support destruction consistently; make unsupported destruction without an enemy source non-explosive initially.
4. Resolve damage and kill rewards once, remove stale target references, and make Persistent Echo an explicit temporary target that expires cleanly. Decide and document whether other friendly decoys can be damaged by the blast; default to enemy-only damage.
5. Test lure reachability, short radius upgrades, elites, multiple decoys, loss of target, exact-once blast, sale suppression, persistent echo expiry, and no reward duplication. Capture enemies visibly gathering followed by enemy-caused destruction and detonation.

### Feature prompt

> Implement Echo Mine, a short-range decoy tower, using the shared contract and section 9. It must actually lure eligible organisms, then explode once when enemies destroy it. Integrate Stronger Signal, Volatile Core, and Persistent Echo into the existing skill tree. Deliver readable targeting/blast feedback, bounded retargeting, safe sale/death handling, and a browser lure-to-detonation demonstration.

## 10. Countervoid Heart — ultimate tower, friendly orange Void

### Required behavior

The ultimate tower contains an orange Countervoid seed. Once activated, it releases a friendly field that grows organically using a frontier process comparable to purple Void. Its advancing front fights purple Void for territory. This is a persistent simulated territorial conflict, not an orange explosion, a recolored turret beam, or a sequence of arbitrary reclamation disks.

It preserves friendly ground, units, and structures. It does not devour the player's city. Where it defeats purple Void, it leaves real reclaimed ground through existing mutation/support hooks. It does not resurrect lost buildings or people; that remains Chrono's role. Clearly distinguish active orange field, reclaimed ground, and remaining purple territory.

Suggested balance: expensive late-game unlock, slow initial expansion, fixed heart output distributed across its active contested frontier. A longer perimeter dilutes local strength, so expansion has a natural limit and concentrated purple pressure can push it back. Use capped per-tick work and explicit units; tune constants from seeded small/large-world comparisons rather than promising a universal win rate. Do not add uncontrolled exponential growth or effectively infinite output when multiple hearts overlap.

### Ownership and conflict model

1. Keep authoritative field ownership/strength distinct from terrain material and original-building ownership. A ground cell must have one resolved terrain result; render blending must not hide contradictory ownership.
2. Generate candidate expansion and conflict contributions from a stable pre-step state. Resolve each contested location once in stable order. Use local orange-versus-purple pressure to advance, hold, or retreat; no iteration-order advantage or same-tick recursive expansion.
3. Multiple hearts contribute through bounded shared rules, with ownership attribution that survives one heart's removal. Avoid duplicate reclamation/rewards and pressure multiplication. Show the relevant operational limits in UI.
4. Activation requires a legal tower placement, including Lantern-supported ground if existing construction rules allow it. If the bearer leaves or dies before permanent support exists, normal tower support rules apply; do not grant a secret permanent foundation.
5. On heart destruction, stop its output and let unsupported orange influence decay over a short bounded interval. Overlap can sustain influence from other hearts. Already reclaimed permanent terrain remains ordinary vulnerable terrain; do not abruptly delete rescued cities.
6. Define water, scenario exclusions, portals, nodes, and organisms explicitly. Initially contest eligible purple terrain/frontier; do not automatically kill every organism, erase protected portal objectives, or farm rewards from orange-purple oscillation.

### Visual and skill tree

The heart is a dark containment structure with a brilliant orange living core and root-like outlet arms. Friendly field has luminous amber/orange filaments, moving cells, advancing tendrils, and outward-traveling pulses. At its clash with purple Void, show a bright jagged contact line and local sparks proportional to actual contested activity. Reveal earthy reclaimed ground behind the active front.

Frozen Void remains dark, stationary, angular, and staple-marked. Countervoid is flowing and advancing. Preserve this distinction in grayscale, at native scale, and under Reduced Motion; static textures, ownership outlines, and directional markers must still convey allegiance.

Upgrade branches: **Expansion** improves reach/growth within the output budget; **Frontier Strength** increases sustainable contested pressure; **Lasting Ground** improves durability of newly reclaimed land. Keep growth and strength tradeoffs meaningful, use existing tech prerequisites, and inspect existing ultimate/gravity/land-restoration options for role overlap.

### Implementation plan and acceptance

1. Inspect purple field representation, budget solver, frontier queues, terrain mutations, and scenario victory conditions. Specify the smallest additional field layer and make output/perimeter accounting testable.
2. Implement seeded growth, local contests, pressure conservation/caps, deterministic ownership resolution, reclaimed terrain, overlap, retreat, and heart destruction.
3. Register ultimate tower, activation/release feedback, tech tree, range/coverage information, and clear displays for current spread versus sustainable frontier.
4. Add moving orange field, contact-line combat, heart pulse, decay, and reclaimed-ground transitions through existing caches. Bound active work, memory, and visual effects on both world sizes.
5. Test growth from a seed, actual contested victory and retreat, strong purple resistance, deterministic ties, water/exclusions, overlap, heart death, no friendly damage, no resurrection, and no economic farming. Benchmark simultaneous large opposing frontiers. Browser evidence must show organic expansion, a sustained orange-purple battle line, reclamation, and a pushed-back front.

### Feature prompt

> Implement Countervoid Heart using the shared contract and section 10. This ultimate tower seeds a real friendly ORANGE Void field that grows organically and fights purple Void at a persistent contested frontier. Preserve friendly terrain/units, reclaim defeated purple territory, and distribute finite heart output across the frontier so expansion can stall or retreat. Deliver deterministic ownership/conflict resolution, clear flowing-orange versus frozen-amber visuals, late-game upgrades, destruction/overlap rules, and measured large-world performance. A recolored blast or cosmetic field is insufficient.

## Additional roster delivery order and interaction checks

Suggested order: jetpack target layers → Lantern coverage → Seamwalker frontier holds → Echo Mine lure/death events → Countervoid ownership/conflict. Reconcile this with the actual implementation state; reuse any already completed feature instead of replacing it blindly.

Extend the shared frontier pipeline deliberately. Lantern effective-ground protection takes precedence over destructive terrain outcomes; it is never subject to pressure caps. Bell crossing constraints and Seamwalker holds constrain eligible propagation without storing deferred burst pressure. Prisms reroute pressure once and respect those constraints; siphons intercept eligible pressure once. Resolve orange-purple contests and final terrain changes with a documented stable ordering before normal support evaluation. Do not make frozen purple land traversable or let orange influence consume a living bearer's guaranteed footing.

Additional combined fixture: a Lantern Bearer crosses deep purple Void with jetpack escort; Seamwalkers pin the approach; an Echo Mine draws nearby organisms away; a Countervoid Heart activates on legal supported ground and establishes a contested front. Kill the bearer before and after permanent reclamation and verify the different support results. Include flying/anti-air enemies attacking jetpack infantry, a Chrono recall of the bearer if available, and adjacent frozen/active orange regions. Assert no duplicate loss/reward events, bounded queues and pools, deterministic outcomes, and identical gameplay under visual accessibility settings.
