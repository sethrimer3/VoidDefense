# Test and tool commands

Per-feature browser checks (`.mjs`, need `npm run dev` running unless noted), focused Node tests, benchmarks and tools. Moved from `AGENTS.md`; the topic docs in this folder name the checks for each feature too.

```sh
node tests/void-ledge.mjs # Exposed earth/rock cutaways, Void-space clipping, reduced effects and desktop/phone close-ups (needs dev server)
node tests/void-crisp.mjs # Void native pixel art, non-antialiased shapes, close zoom and camera input at desktop/phone DPR (needs dev server)
node tests/void-pixels.mjs # Void Defense: one raster pixel per simulation cell, independent destruction, desktop/phone camera hit tests (needs dev server)
node tests/blight-performance.mjs # Paired Blight worm lookup, portal raster area and packed contour benchmark (needs dev server; PLAYWRIGHT_EXECUTABLE supported)
node tests/scenery-performance.mjs # Frozen-reference forest/lighting pixels, cache invalidation, allocation bounds and paired timings (needs dev server)
node --experimental-transform-types --import ./tests/pin-random.ts tests/simulation-performance.ts # Paired simulation-only moving hordes, worm contacts and cleanup; no dev server
node --experimental-transform-types --import ./tests/pin-random.ts tests/simulation-targeting-performance.ts # Frozen-reference combat, target selection and terrain checks; no dev server
node tests/pixel-art.mjs # Legacy art stays visible with no PNG requests, Settings toggle saved (needs dev server)
node tests/defend-rally-flag.mjs # Double tap in battle plants the free blue rally flag in the war banner's place, a double tap on it takes it away, desktop and touch (needs dev server)
node tests/defend-rally-aim.mjs # Select a troop building in battle, press it again and drag its rally flag (raised on touch), range edge, clearing, watch tower snapping (needs dev server)
node tests/tree-motes.mjs # Golden motes in three sizes round the keep's living tree and a spell's path tree, moving, bursting, panning held to the tree and a fifth beyond, zooming out held a quarter past the fit with motes in every corner, none under Reduce Motion, desktop and phone (needs dev server)
node tests/siege-sky.mjs # Siege day/sunset/dusk/night, pause and translucent troop HUD on desktop/phone (needs dev server)
node tests/siege-staging.mjs # Two-minute Siege, hidden homes, troop entry, pause, inspection and camera framing on desktop/phone (needs dev server)
node tests/defend-controls.mjs # Header placement, speed persistence and compact explicit-close defeat reports (needs dev server)
node tests/defend-small-boats.mjs # Compact boats, visual water and heading sprites (needs dev server)
node tests/defend-small-fortress.mjs # Compact walkers, damage states and body cache dimensions (needs dev server)
node tests/library-idle.mjs # Library/Mine catch-up, fire pixels and mobile countdowns (needs dev server)
node tests/defend-upgrade.mjs # Basic-only palette, living upgrade tree (withering, sprouting, dragging, layout, fading branch lines, undo, tapping a node again to buy or sell down), press-and-hold on buildings and palette tiles, respec, guild troops in battle, reload and Tiles, desktop and touch (needs dev server)
node tests/defend-quarters.mjs # Buildings dragged onto quarter tiles: the footprint preview, the clear-quarter rule, bait huddling and moving a placed building, desktop and touch (needs dev server)
node tests/defend-walls.mjs # Walls dragged onto the quarter-tile grid outside the city, moved, their tree, inner walls and battle, desktop and touch (needs dev server)
node tests/defend-assassins.mjs # The Melee Guild's tree offering the Assassins' den, its four paths, dens on each path and their assassins in battle, desktop and touch (needs dev server)
node tests/defend-muskets.mjs # The Musket hall's tree offering Grenadiers, Volley fire and Bayonets, halls on each path and their musketmen in battle, desktop and touch (needs dev server)
node tests/defend-revolutionary.mjs # The Revolutionary: its tree grafting the shared branches onto its node, its laser snipers' zigzag chain, the lock-on lasers and flashes, desktop and touch (needs dev server)
node tests/defend-gunners.mjs # The Gunner hall's tree offering muskets, machine guns, rockets and its own paths, the line's halls wearing paths and their gunners in battle, desktop and touch (needs dev server)
node tests/wisp-storm.mjs # The Wisp tower's 30 stored arrows wandering round it, its 30-degree spray and the Reduce Motion ring, desktop and phone (needs dev server)
node tests/defend-garrison.mjs # Gunners up in a watch tower drawn as badges over it, gone when it falls, desktop and touch (needs dev server)
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/defend-snipers.test.ts tests/defend-barracks-paths.test.ts # The Sniper lodge's and the Barracks' Berserkers/Halberdiers paths: tree, looks and battle
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/defend-spears.test.ts # The spearmen line: Spearmen hall, Phalanx, Javelin camp, Lancer stable, their paths, and the Valkyrie palace they merge into
node tests/defend-spears.mjs # The spearmen line's halls on each path, the Melee Guild's tree and their troops in battle, desktop and touch (needs dev server)
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/defend-hero.test.ts # The Hero: a Barracks become one, its slash-slash-spin combo, Whirlwind, Blade dance and Legend
node tests/defend-hero.mjs # The Barracks' tree offering the Hero, its paths, the halls in each look and the heroes cutting through a crowd, desktop and touch (needs dev server)
node tests/melee-capes.mjs # All melee families' capes, path/tier gallery, motion/settings/opacity/merged outlines and bounded crowd work (needs dev server)
node tests/archer-attunements.mjs # Three Archer Barracks attunements, carrying/sky rain, legacy art and desktop/phone tree purchases (needs dev server)
node tests/melee-facing.mjs # All melee families' walking/combat/idle directions, procedural views, toggles and Simple/merged outlines (needs dev server)
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/defend-shadow.test.ts # The Shadow: three Assassins' dens merged, its knives' loops, compounding, armor piercing, bleeding and its shared tree
node tests/defend-shadow.mjs # The den's tree offering the Shadow, the Shadow's shared branches, the shrines and their shades' knives in battle, desktop and touch (needs dev server)
node tests/defend-gate-ballista.mjs # The city gate's and the wall ballistas' trees opened by a tap, bought, and their ranks in battle, desktop and touch (needs dev server)
node tests/defend-sky-palace.mjs # A Cloudborne Valkyrie palace hovering while building, drifting, fading over the city and coming round from the east in battle, desktop and touch (needs dev server)
node tests/building-menu.mjs # The building menu gallery: square menu over a real build board and building sprites, icons, square ranges, crosshairs' nearby square, slider steps and the palette's opening flash, desktop and phone (needs dev server)
node tests/menu-sizing.mjs # Settings' Building menu size in Ambush: the camera framing a tower's range inside the menu and gliding back, the menu shrinking gently zoomed out, and the fixed size, desktop and phone (needs dev server)
node tests/defend-upgrade-map.mjs # A building tree's Map button: the web of its line's discovered upgrades, every one in Developer mode, desktop and touch (needs dev server)
node tests/defend-shimmer.mjs # The gold line hugging a placed guild's sprite while building, on street dirt: part way, closed, fading and gone, and an L of placed wall sections traced as one, desktop and phone (needs dev server)
node tests/defend-dunes.mjs # The Amber Desert's gentle one-colour dunes at day, sunset and night and HD Sand's, trails, craters, a clear wall, no flagstone light and tumbleweeds in a real battle page, desktop and phone (needs dev server)
node tests/river-life.mjs # Ambush river drawn like the lakes, its current, fish fleeing a walker and birds startled from a tree, Reduce Motion, desktop and phone (needs dev server)
node tests/defend-forest.mjs # The forest outside Mossbound Ruins' walls while building and in battle: close-ups of a huge tree, a lake, a berry bush, a small mountain and a rock cluster on grass, swaying, blasts felling trees into craters and baring the grass, arrows striking trees into stumps and burning ground burning a huge tree down to ash, desktop and phone (needs dev server)
node tests/defend-magnifier.mjs # The Magnifying glass setting: the zoomed box above a drag, its board pixels, the `magnify` hook and the setting off, desktop and touch (needs dev server)
node tests/defend-damage-repaint.mjs # A building's damage stage changing repaints only boxes round it: city layer and lighting masks match a whole repaint (exact with Crisp pixel zoom), desktop and phone DPR (needs dev server)
node tests/structure-churn.mjs # Manual: frame times while many buildings are struck, fall and are rebuilt at once (CHURN_HITS, CHURN_PHASE, CHURN_PROFILE; needs dev server)
node tests/wave-profile.mjs # Manual: a real Defend battle in the full app at PROFILE_WAVE (21) for PROFILE_SECONDS (20), PROFILE_KILL damage a second standing in for a strong city; frame gaps, hitches and a CPU profile in test-results/ (needs dev server)
node tests/defend-tile-hold.mjs # City tiles lifted only by a half-second hold (a gold square growing over the tile), quick drags panning instead, desktop and touch (needs dev server)
node tests/city-watch.mjs # 2 × 2 watchmen and 1 × 1 townsfolk gliding while building, the City watch mustering where they walked and spearing an orc in battle, desktop and phone (needs dev server)
node tests/defend-keep.mjs # The keep dragged with its tile, its tree (side-by-side branches, respec, tapping again, hold), and its arrows and oil in battle, desktop and touch (needs dev server)
node tests/tiles-marks.mjs # Tiles tab upgrade marks, spread-by-default copies, Stacked groups, always-stacked city tiles and walls, an opened tile's stats and coloured abilities, holding a tile to open its tree in Defend, desktop and phone (needs dev server)
node tests/upgrade-work.mjs # Timed Study/Forge purchases, shared staff, refunds, reload completion and mobile fit
node tests/hold-repeat.mjs # Accelerating purchase holds, mouse/touch, cancellation and Mine/Library persistence (needs dev server)
node tests/tab-icons.mjs # Selected procedural combat/Settings icons, review studies, live navigation and visual-setting refresh on desktop/phone (needs dev server)
node tests/defend-necromancy.mjs # Necromancy palette, aim, cast, risen art, cooldown and Study setup (needs dev server)
node tests/defend-meteor.mjs # Meteor strike palette, aim, fall, landing, cooldown and Study setup (needs dev server)
node tests/defend-frost-nova.mjs # Frost nova palette, aim, burst, rime, blizzard and Study setup (needs dev server)
node tests/defend-reinforcements.mjs # Reinforcements palette, aim, drop, landing, champion and Study setup (needs dev server)
node tests/library-navigation.mjs # Whole-room Lab/Nave framing, Mine building picker and research/back transitions (needs dev server)
node --experimental-transform-types --import ./tests/pin-random.ts tools/measure-upgrade-production.ts # Bounded 1x Mine/Library scenarios, no player saves
node --experimental-transform-types --import ./tests/pin-random.ts tools/estimate-upgrades.ts # Catalog costs, rank CSV and docs/UPGRADE_TIMING.md (uses measured JSON)
``node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-defense.test.ts # Void Defense unit & integration suite
node tests/void-defense.mjs # Void Defense desktop/mobile QA screenshots and 192x256 & 256x384 simulation/render benchmarks (needs dev server)
`
