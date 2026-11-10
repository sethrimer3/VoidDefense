# Tower Defense

The domain glossary: the words the game, its code and its docs use. Terms only, no implementation.

## Language

**Combat mode**:
One of Defend, Ambush or Siege, selected through the shared combat tab.

**Ambush**:
A fixed-level tower-defense mode: enemies follow a track, while towers and infantry buildings stand beside it.

**Track**:
The marked road that ground enemies follow through an Ambush level.

**Lane**:
One of an Ambush track's ways in, from its own entry at the board's edge to the keep. Later levels have two or three; lanes may join on the way.

**Bridge**:
A plank deck where a road crosses water; the only way over a river on foot.

**Crowd wave**:
An Ambush wave of fifty to five hundred native enemies, their strength scaled to the level and wave.

**Siege**:
An assault mode: infantry trained by the player's buildings raid enemy castles and their guards.

**Entry arrow**:
The marker at the board edge showing where an Ambush level’s enemies arrive.

**Level select**:
The Ambush screen of thirty levels, arranged in three columns and ten zone rows, showing their best stars and unlocks.

**Star rating**:
An Ambush level's best result, from zero to three stars. Improving a best result adds only the difference to the earned total.

**Build grid**:
The quarter-tile grid used to place Ambush buildings, with a clear quarter between their footprints.

**Muster space**:
An entry point on the bottom edge where an owned infantry squad enters a Siege assault.

### The board

**Tile**:
The unit the player builds with: the board is 9 × 13 of them. The top row is the spawn lane.

**Cell**:
The unit the city, the walls, pathfinding and the battle work in: each tile is 8 × 8 cells, so a quarter tile is 2 × 2 cells.

**Layout**:
The player's design: the keep's tile, the city tiles and the placed structures. Saved; the city is regenerated from it.

**City**:
The procedural town generated from the layout and the save's seed: wall, streets, houses, parks and ponds around the structures.

**Outlying district**:
A group of city tiles standing apart from the keep's, walled and streeted on its own.

**Park**:
A small block of grass the city leaves unbuilt; larger ones hold a pond, many have trees and a fence.

**Structure**:
A placed building with a job: the keep, the guilds and the troop buildings upgraded from them, the watch tower and the towers upgraded from it.

**Basic building**:
One of the three buildings the shop sells: the **Watch tower**, the **Melee Guild** (training **brawlers**, who fight with their fists) and the **Ranged Guild** (training **stone throwers**). Every other tower and troop building is one of these upgraded.

**Line of sight**:
What the gunner line (pistols, muskets, machine guns, the Gatling, rockets, snipers and laser snipers) needs to shoot: no wall stone or building between it and its enemy, since guns shoot flat. Archers, stone throwers and javelineers arc over and need none.

**Perched**:
A gunner up in a watch tower: it shoots over every wall and building, and no enemy can pick it out until the tower falls. Two to a tower.

**Upgrade** (of a building):
One step a single placed building takes with Knowledge, chosen by tapping it in Defend while building: becoming another building (a Watch tower an archer, cannon or wizard tower; a Melee Guild a barracks, an **assassins' den** or a **spearmen hall**, and a spearmen hall a **phalanx** (shielded **hoplites**), a **javelin camp** (**javelineers**) or a **lancer stable** (mounted **lancers**, whose first thrust at each enemy is a **charge**); a Ranged Guild an archer barracks, Mage Guild or **gunner hall** (pistols), and a gunner hall a **musket hall**, **machine-gun nest** or **rocket battery**, whose **rocketeers** fire bursting rockets), a branch's next rank, or a **merge**. The other buildings of its kind are untouched.

**Attuned building**:
What a basic building becomes first (an archer, cannon or wizard tower; a barracks, assassins' den or spearmen hall; an archer barracks, Mage Guild or gunner hall). It takes one of three **branches**.

**Branch**:
One of an attuned building's three exclusive upgrade lines of three ranks; some make it another building at their first rank.

**Ultimate**:
The building at the top of an attuned line, made by a **merge**: three buildings of the line, each maxed on a different branch, become one.

**Upgrade tree**:
A building's own upgrades, opened by tapping it in Defend while building, or by pressing and holding it there or its tile in the palette (a copy in the palette is upgraded on its own): the buildings it has been, then every branch still open to it, as nodes on branches that can be dragged about and spring back. Choosing one branch makes the ones beside it wither away and opens the upgrades only that branch leads to. Its corner box shows the Knowledge **allocated** to the building.

**Upgrade map**:
The web of every upgrade a basic building's whole line can reach, opened by the **Map** button on a building's upgrade tree: the basic building in the middle, each branch out along its own spoke. It shows only the **discovered** upgrades, those any building of the line has ever reached, shared by them all (Developer mode shows every one); this building's own are gold. Read only: upgrades are bought in the tree.

**Keep branch**:
One of the keep's own upgrade lines, **Bastions** (more HP), **Arrow loops** (the keep shoots) and **Boiling oil** (it scalds whatever reaches its walls). Unlike a building's paths, the keep climbs all of them side by side.

**Wall section**:
A piece of stone wall a quarter of a tile across, placed on its own on the board's grid of quarter tiles (the same grid buildings are placed on), anywhere outside the city and, with **Town walls**, inside it. Every wall section shares one upgrade tree, the **wall branches**: **Stonework** (more HP, then mending), **Trapped walls** (each stone bursts once as it breaks, then wider and burning) and **Town walls** (inside the city, then posterns that let your own people through), climbed side by side like the keep's.

**Respec**:
Turning one building back into its basic building with no path, free, with every Knowledge point allocated to it given back.

**Undo**:
Taking one upgrade a building has, and every upgrade after it, back off, free, with their Knowledge given back: the building steps back down its tree to the node that upgrade grew from.

**Selling down**:
Tapping an owned node of an upgrade tree a second time: every upgrade after it is undone, free, and the building stands on that node. A second tap on a node not yet owned buys it.

**Kept copy**:
A building on a path taken back to the palette: it keeps its path and rank, waits under its own palette entry, and wears them again when placed.

### A defense

**Defense** (or run):
One battle from the layout, wave after wave until the keep falls or the player abandons it. Never saved.

**Wave**:
One group of enemies. Every 10th is a boss wave, fought at night, with warlords.

**Unit tester**:
A developer defense with manually summoned enemies and no automatic waves or progression rewards.

**Mother**:
A black enemy that splits into three broodlings when she dies.

**Broodling**:
A small, quick enemy hatched only from a fallen Mother.

**Walking fortress**:
An enemy castle on legs (Walking Watchpost, Walking Outpost, Walking Fortlet, Walking Stronghold, Walking Bastion, Living Fortress, Walking Citadel, Dread Colossus). Its legs are ground-and-air targets and its rooftop weapons are always air targets. Small walkers have six legs, medium ones eight (two per side) and massive ones twelve (three per side). With three or more legs its body is invulnerable; at two it crashes down in dust. Once grounded, a body hit deals the same damage to each surviving turret. One leg still pulls it along, leaving temporary crumbled rock; no legs immobilize it. Destroying every turret destroys the whole walker; its body has no independent life.

**Briarling**, **Moss Boar** and **Root Treant**:
Mossbound creatures: a quick thorn sprout, a sturdy tusked raider and a slow walking tree that releases three briarlings when felled.

**Dune Scorpion**, **Sun Scarab** and **Sand Vulture**:
Amber Desert creatures: a scorpion with close-reaching venom, a scarab shielding its swarm and a vulture that flies past walls.

**Sporeling**, **Fungal Brute** and **Spore Moth**:
Fungal Hollow creatures: a small poisonous mushroom, a heavy fungus that releases three sporelings and a flying moth carrying a spore cloud.

**Brine Crab**, **Lantern Jelly** and **Coral Guardian**:
Drowned Temple creatures: a tough clawed crawler, a floating jellyfish with a stinging cloud and a coral-covered guardian shielding the creatures around it.

**Shardling**, **Crystal Sentinel** and **Prism Ray**:
Violet Geode creatures: a swift living crystal, a shield-bearing guardian and a hovering ray with a smaller shield.

**Star Wisp**, **Comet Hound** and **Astral Warden**:
Astral Sanctuary creatures: a flying star spirit, a swift celestial hunter and a slow guardian shielding its escort.

**Fern Mantis**, **Moss Troll** and **Lantern Hornet**:
Mossbound creatures: a swift clawed hunter, a troll that regenerates lost health and a flying hornet carrying venom.

**Glass Jackal**, **Dune Tortoise** and **Dust Djinn**:
Amber Desert creatures: a swift jackal, a tortoise whose shell resists physical attacks but is vulnerable to explosions and a flying sand spirit shielding its companions.

**Cinder Imp**, **Slag Golem** and **Ember Moth**:
Ember Forge creatures: a fire-resistant imp, a heavy golem immune to fire but vulnerable to explosions and a flying moth resistant to fire.

**Kelp Stalker**:
A Drowned Temple hunter wrapped in kelp that regenerates lost health.

**Cap Crawler**, **Mycelium Hulk** and **Rot Mite**:
Fungal Hollow creatures: a crawler trailing spores, a heavy fungus that regenerates lost health and a quick venomous mite.

**Geode Crab**, **Prism Moth** and **Shard Brood**:
Violet Geode creatures: a crab whose crystal shell resists physical attacks but is vulnerable to explosions, a swift flying moth and a brood that releases three shardlings when destroyed.

**Crypt Hound** and **Grave Wisp**:
Obsidian Crypt creatures: a swift ground hunter and a flying spirit that regenerates lost health.

**Nova Moth**:
A luminous Astral Sanctuary flier that releases two star wisps when destroyed.

**Siege engine**:
An enemy machine with no crew (rolling cannon, ballista, firework launcher, trebuchet, great bombard, dragonfire battery): it drives itself toward the keep and stops to shoot what blocks its way, or the keep, from range.

**Magic boat**:
An enemy ship (Runed Dinghy, Charmbound Sailboat, Mystic Cutter, Arcane Cog, Enchanted Skiff, Spellbound Sloop, Arcane Galleon, Deluge Ark) that sails straight through the ground toward the keep in a pool of conjured water, which dries up in a trail behind it.

**Flood**:
A magic boat's water. The four small boats have decorative water that dries behind them without affecting combat. Larger boats' water sinks the buildings it reaches (the larger boats also wall stones and the keep), leaving their rubble when it dries; it hurts only fire mages, puts out fires and stops splash damage.

**War banner**:
A reusable Skill: planted anywhere on the board mid-defense, it rallies every mobile troop (swordsmen, archers, fire mages, valkyries, the dark wizard) to fight round it. Planting it again moves it; a tap takes it down.

**Rally flag**:
A free blue flag planted by double-tapping the board mid-defense. Troops march to it as to the war banner, but it lends them nothing; the flag and the war banner replace each other, and a double tap on the flag takes it away (a triple tap with that Gameplay setting on).

**Deployment range**:
How far a troop building's troops may go from it, a circle round the building: stronger troops deploy further, and the Smithy's Deployment range takes every troop further. Troops never leave it, and answer the war banner or a rally flag only inside it.

**Rally point**:
Where a troop building's troops go when they have nothing to fight, set in battle by selecting the building and dragging a flag from it; kept inside its deployment range. Snapped onto a watch tower, the gunner line climbs it.

**Strike spell**:
A reusable Skill cast onto the board mid-defense, with its own Smithy and Study topic under Spells. It casts with one researched path at a time, chosen in the Study.

**Necromancy**:
The first strike spell: every enemy that fell near where it is cast (a **grave**, raisable for 30 seconds) rises as a friendly **risen** warrior for a minute, then the spell waits 30 seconds.

**Frost nova**:
The third strike spell: ice bursts out where it is cast, freezing every enemy within its reach solid, and leaves a patch of **rime** that slows and bites whatever walks through it until it melts; then the spell waits 35 seconds. Its paths make the frozen **Shatter**, set the rime hunting as a **Wandering blizzard**, or make it a **Rime ward** over the city's own people and walls.

**Reinforcements**:
The fourth strike spell: a squad of soldiers drops out of the sky where it is cast and holds that ground, their **post**, for 30 seconds before marching off (not counted as lost troops); then the spell waits 45 seconds. Its paths land them with **Hammerfall** shockwaves and a champion, **Muster the levy** for more soldiers with bowmen and reserves, or bind them as **Oathsworn** into a shield wall that kills keep longer and that makes a last stand.

**Meteor strike**:
The second strike spell: a meteor falls where it is cast a moment later and blasts every enemy within its reach, sparing the city's own people, then the spell waits 40 seconds. Its paths break it into a shower (**Starfall**), leave a burning crater (**Molten core**) or make it a **Frost comet** that chills and freezes.

**Best wave**:
The highest wave the player has held.

**Bonuses**:
The multipliers the Smithy and the skill trees lay over a defense (troops, towers, walls, the keep, rebuilding, bombs).

### Progress

**Armory**:
The levels for every building of a type, and the city elements and battle speed, now sold in the Smithy below the Mine for the mine's metal; `UPGRADES` in code.

**Gold**:
The Mine's rarest spendable metal, displayed with an ingot and named Gold. Every ten gold bars worked by smiths make one unit; spent on advanced purchases and Smithy upgrades. There is no separate battle coin currency.

**Copper** and **silver**:
The mine's metal, as Smithy points: every ten bars the smiths work make a point. Spent on Smithy upgrades, tiles, bombs, Mine hires and buildings, and Library shelves, staff and lab expansions. (They were once battle coins, and before that iron and steel bars.)

**Time away** (welcome back):
The time since the game was last saved, up to a day, banked for each of the Mine and Library. On returning, both automatically fast-forward their work, earning gains as they go. Remaining idle time survives closing the game, and the welcome-back screen shows the running gains.

**Knowledge**:
Earned by the Library, an hour's worth being its built bookshelves times its professors (idle too); spent on the skill trees. Once called Valor.

**Freak accident** (Library):
A table's candle catching it alight: a small chance each minute, lowered by Fireproof Wood. The fire burns whatever it reaches until it burns out or the librarians put it out (Fire Training).

**Night watch** (Library):
Librarians detecting fires earlier and fetching and throwing buckets faster during the night. It protects the same fires that can happen while fast-forwarding.

**Charred book** (Library):
A book ruined by heat, kept as debris until a shelver carries it outside. Intact books remain usable.

**Shelf repair** (Library):
Shelvers filling the burned holes in a purchased bookshelf with new planks, keeping its surviving wood and books.

**Upgrade point**:
One for every new best wave held in Defend, shown in the currency bar; banked for what the meta game brings later. (It replaced the Commander level and its experience.)

**Subject** and **topic**:
How every upgrade is filed: by subject (Realm, City, Towers, Infantry, Mine, Library) and within it by topic (one tower, one unit building…). The Smithy and the Study each show the topics they have something for. (They were once the Upgrades tab's, each topic with a Forge and a Study.)

**Smithy** (the room):
The workshop below the Mine, reached by its ⚒ Smithy button: a topic's permanent upgrades paid with the mine's metal, its Armory levels and its Smithy rows.

**Study**:
The vault beneath the Library, reached by its ✦ Study button: what Knowledge buys for a topic: its skills, and a strike spell's **paths**, drawn as a tree. Buildings are not researched there; each is **upgraded** on its own.

**Descent**:
The way down from the Mine or the Library to the room below it: the scene slides up, the earth and a ladder rush past, and the room rises into place.

**Tile**:
Anything owned to put into a defense: a City tile or a piece of the wall (City), a unit building (Infantry), a tower (Towers), or a **consumable** (a bomb, used up when it goes off, or the war banner, never used up). Shown in the **Tiles tab**, the keep's hall.

**Stack**:
Tiles that are alike, shown as one tile marked with its quantity (×4). A **universal** kind (City tiles, the wall's pieces, skills), whose upgrades every copy shares or which has none, is always one stack. A building upgraded one at a time is spread, a tile a copy, unless the player stacks them, when copies with the same upgrades share a stack. Opened, a kind shows its copies and each set of upgrades they carry.

**Upgrade marks**:
The Knowledge upgrades a tile carries, in the order taken, on its face in the Tiles tab: a brass diamond for each building it became, a pip in its path's colour for each path rank, and its path's badge; the walls' marks are their shared tree's ranks. Written out, they read "Watch tower → Archer tower → Fire arrows II".

**Higher tier**:
What a building can be upgraded into, and the basic building it grows from: a Wizard tower from a Watch tower, and into a Dark wizard keep by its crown.

**Path**:
One way a building can grow, in ranks it climbs one at a time with Knowledge: the Wizard tower's Pyromancy (flames only), Rime (ice only, then freezing solid) or Stormcalling (lightning in place of flames), the Barracks' Crusaders (hearty, healing), Berserkers (quick strokes, healing kills, **cleave**) or Halberdiers (long reach, hooking blows, heavy on big enemies), the Sniper lodge's Marksmen (further, toughest first, a **headshot**), Ricochet (bullets that **glance** on to the next enemy) or Suppressing fire (hits that slow and **pin**), Deadeye (only a **clear sight**) or Piercing rounds (through the whole file), the Assassins' den's Bloodletters (huge criticals, frail), Shadowcloak (**cloaked** until they strike, then an **ambush**), Venomblades (**venom**: the enemy takes more damage from everything) or Headhunters (the toughest enemy first, with a **bounty** of its HP), the Musket hall's Sharpshooters (crowned into a **sniper lodge**), Grenadiers (bursting balls leaving **burning ground**, then **bomblets**), Volley fire (extra balls, quicker reloads in ranks) or Bayonets (a **thrust** at close quarters, then a citywide charge), the Gunner hall's Quickdraw or Duelists, the Machine-gun nest's Belt feed (crowned into a **Gatling emplacement**) or Tripod, the Gatling emplacement's Gun shield, Overdrive or Stopping power (**knockback**), the Rocket battery's Cluster rockets (with **bomblets**) or Salvo racks, the Archer tower's Fire arrows (setting enemies **burning**), Hawk focus (sustained shots at the strongest enemy) or Wisp Arrow, the Cannon tower's Gun crews (with **grapeshot**) or Siege shot, the Archer barracks' Javelin Bowmen, Skirmishers or Skyranger, the Watch tower's Spotters or Signal fires, the Mage Guild's Pyroclasm or Cinders, Monster bait's Oil-soaked or Fortified crates, Wall spikes' Blasting stakes (blowing up on contact), Spring stakes (the whole row shooting out) or Rimed stakes (chilling). Each building climbs its own path (its **specialization**), so different paths and ranks fight together in one city. (A strike spell's paths are still researched in the Study.)

**Evolution**:
A path's crown, past its last rank, turns that one building into a greater form (Stormcalling's Wizard tower into the Dark wizard keep, Winged lancers' Lancer stable into the Valkyrie palace, the spearmen's ultimate, Sharpshooters' Musket hall into the Sniper lodge, Belt feed's Machine-gun nest into the Gatling emplacement), paid with Knowledge. If it no longer fits its tile it goes to the palette.

**Shadow**:
The assassins' ultimate building, merged from three Assassins' dens: a shrine for one **shade**, a see-through cloaked figure whose **knives** loop out through crowds. Every enemy a knife hits makes its later hits harder (its **edge**, compounding). Its upgrades are a **shared tree**: more knives, armor piercing, **bleeding** (only enemies with blood in them) and faster compounding.

**C4 nanobots**:
The cannon tower's ultimate building, merged from cannon towers maxed on different branches: very slowly, from very far, it fires a harmless shell that bursts into a **nanobot cloud**. Every enemy in the cloud is **infected** and explodes when it dies, hurting the enemies round it, so a crowd can go up in a chain. Its upgrades are a **shared tree**: a bigger blast, a bigger cloud and **replication** (a chance, 1% to 5%, that a dying host sets free a new cloud).

**Revolutionary**:
What a plain Sniper lodge (the archer barracks' ultimate) can still become: a high-tech hall of **laser snipers**. Its upgrades are not a path but a **shared tree** of five branches climbed side by side by every Revolutionary at once: the squad (one, two, then three snipers), the **chain laser** (the laser leaps from enemy to enemy, impossibly, and the bullet follows it through 3, 5, then 7), a **critical** chance, what a critical multiplies, and a burst round the last enemy the bullet strikes.

**Hero**:
The swordsmen's ultimate building, which a plain Barracks becomes: a gilded hall of one hero, who fights in a **combo** of sweeping slashes and a **spin** that strikes everything round it. Its paths are Whirlwind (more, wider spins), Blade dance (a **flurry** of slashes, **dashing** from enemy to enemy) and Legend (a hero who, at its last rank, rises once when it falls: **Undying**).

**Lock-on laser**:
The thin laser every sniper holds on whom it will shoot, brightening as it reloads and locks on; the shot flashes along it.

**Specialization**:
The path a building has climbed and the rank it has reached, bought in its **upgrade tree**, kept when it moves, across saves, and as a **kept copy** when it goes back to the palette. A path is for good: a building can't change it. Recruits share their home building's specialization; a battle keeps the specializations it started with.

**Research unlock**:
A strike spell's path rank learned once with Knowledge in the Study. (Building paths were once research unlocks; saves from then keep the paths their buildings wore and refund the rest.)

**Smithy rows** (in the Smithy; Training in code):
Ranks of a few percent each on one row (troop HP, tower damage, rebuild speed…). A rank costs a quadratic bill of metal and is worked by the mine's smiths: one smith takes its whole time, more smiths share it. A smith on a rank stays at the smithy until it's done; taking the last one off cancels the rank and returns its paid metal.

**Smithy point**:
Copper, silver or gold: every ten bars of a metal the mine's smiths work make a point of it. A row's first ten ranks cost copper, the next fifteen silver, the rest gold.

**Smith**:
A miner put to the smithy. The smiths are the Smithy's hands: how many ranks can be worked at once, and how fast.

**Skill tree**:
Command and Stewardship (for Defend), Mine and Library: ranked skills researched with Knowledge, each needing the skills above it and timed work in the Library's alchemy lab.

**Research project**:
One skill rank or spell path rank being worked in the Study. Knowledge is paid at the start; all researchers share the work. It pauses without researchers, applies its effect on completion, and returns its paid Knowledge when cancelled.

### Presentation

**Pixel Art**:
The setting, on by default, that draws the pieces with hand-drawn sprites (shared with Tower Delve) in place of their drawn art; off, every piece looks as it was drawn before.

**Forest**:
The grass, trees (large, larger and huge, seen from above), small berry bushes, rocks, dirt pads and lakes filling the open ground outside Mossbound Ruins' walls, never part of the battle but for its boulders: the trees and grass sway in the wind, any attack strikes the smaller trees apart into a stump, blasts blow any up into a crater, fire burns any down to a pile of ash, and blasts and burning ground bare the grass to dirt, until the next run.

**Boulder**:
A great stone, alone, in a cluster or heaped into a small mountain, in the forest outside Mossbound Ruins' walls: unlike the rest of the forest it blocks everyone on foot in the battle, though shots fly over it.

**Park life**:
The city's live dressing, never part of the battle: grass swaying and parting around walkers, and on the ponds rain rings, reflections and ducks.

**Wizard tower**:
A structure alternating a flamethrower (a cone of fire) and an ice wave (a fan of shards that chills what it crosses).

**Chill**:
A wizard's ice slowing an enemy for a few seconds.

**Mage Guild**:
A structure inside the city that trains fire mages, as a barracks trains swordsmen.

**Fire mage**:
A red-robed troop who roams the streets and hurls fireballs: each bursts with splash damage that spares your own people and leaves a blaze.

**Blaze**:
Burning ground a fireball (or bursting monster bait) leaves, hurting every ground enemy inside it each second until it dies down.

**Monster bait**:
A stack of crates of bait, a structure for anywhere: while any stands, every enemy goes for the nearest one before the keep.

**City gate**:
A gatehouse set into the city wall on the edge of a city tile: it opens for the city's own people (troops and civilians) and stays shut to the enemy, who must batter it down; but while it stands open for your people, the enemy can slip through too, until a portcullis bars it.

**Outpost gate**:
In Ambush, the gate where the road meets an outpost's fence (a wooden gate) or, after Palisades III, its stone wall (a stone gatehouse), and where it meets the keep's wall. Units come and go only by the gates; the enemy batters them rather than the wall beside them.

**Portcullis**:
The city gates' first upgrade branch: an iron grate that keeps the enemy out while the gate is open for your people, then murder holes and boiling pitch over the way in.

**Gate ballista**:
A small crossbow on a city gate's gatehouse (the Gate towers branch), one or two to a gate, shooting light bolts.

**Wall spikes**:
A row of iron-shod stakes along the outside of one city tile's stretch of wall, cutting every enemy on foot that presses against it.

**Wall ballista**:
A great crossbow on a bastion at a corner of the city wall, where the wall turns through a right angle; its bolts pierce a file of enemies.

**Wall corner**:
A tile corner where the city wall turns through a right angle: one of the four tiles round it is city (an outer corner), or three are (an inner bend).

**Palette category**:
Which kind of building the build palette shows: All, Towers (they shoot), Units (they train troops) or City (city tiles, gates, wall spikes, wall ballistas and monster bait).

**Restock**:
Civilians rebuilding fallen monster bait, which only Restocking allows, a set number of times a defense for each stack.

**Quarter tile**:
A quarter of a tile each way, 2 × 2 cells: the grid buildings and wall sections are placed on. A building takes a fixed block of quarter tiles (its **footprint**, never rotated) and, unless it is monster bait, needs a clear quarter between it and any other building.

**Valkyrie palace**:
A heavenly marble palace inside the city that takes a whole tile (half with Folded halls) and trains valkyries: the spearmen line's ultimate, a Lancer stable's crowned Winged lancers.

**Cloudborne**:
The Valkyrie palace's path: the palace floats on clouds, drifting west across the sky and coming round from the east, out of every enemy's reach, its valkyries dropping from wherever it floats.

**Valkyrie**:
An armoured angel with a spear who hunts enemies through the city and makes charge stabs.

**Charge stab**:
A valkyrie's attack: she blinks along a line toward an enemy, as far as her reach or until a building, the wall or a pond stops her, hurting every enemy on the line; nothing can hurt her for a second after.

**Dark wizard keep**:
A vast keep of obsidian and rubies inside the city that fills a 2 × 2 block of city tiles (one tile with Folded sanctum), with a lightning turret at each corner; it summons the dark wizard.

**Dark wizard**:
The ultimate unit, one to a dark wizard keep: a hooded figure in dark robes who hunts enemies through the city and casts black lightning.

**Black lightning**:
A bolt that strikes an enemy and leaps on to the nearest enemy it hasn't struck within its chain length, up to its chain count, hurting every enemy it strikes.

**Chain length**:
How far black lightning can leap from one enemy to the next.

**Chain count**:
How many enemies one bolt of black lightning can strike.

**Ground relief**:
The flagstones' bump map outside the city: lights brighten the stone edges facing them and darken the far ones.

**Torch light**:
A flame's flickering, swaying, occlusion-aware glow: lanterns, braziers, tower fires and hand torches.

**Townsfolk**:
Noncombat residents making errands between city buildings while the streets are safe, carrying torches after dusk.

**Watchmen**:
Noncombat patrols inside the city and, at night when a stone gate permits, just outside its walls. Monsters send them to a building indoors or fleeing away outside.

### The mine

**Work lamp**, **torch** and **lantern**:
A miner sets a small temporary work lamp beside a dark face. Torches also burn out; lasting lanterns hang from the cave ceiling by a narrow chain. The crew place lighting as the workings expand.

**Stone**, **hard stone** and **dense stone**:
Three increasingly difficult layers of the mine, with hard stone around a third of the way down and dense stone around three fifths. Softer seams let miners find easier routes.

**Rail incline**:
A gentle rise or dip in the track through an uneven tunnel, followed by loaded and empty carts alike.

**Mine**:
The idle side view of the ground under the city, worked by miners whatever tab is open and while the game is closed. Its world comes from a seed.

**Prospect**:
One world the mine works, with only so much ore in it. Once less than a fifth of its ore is left (or the shaft is at the bottom and the work there is done, **worked out**) the player can move the crew, the buildings and the stock to a **new prospect**: fresh ground from a new seed.

**Miner**:
A worker the player hires with the Mine's metals and puts to one of three **trades**: the face (digging, shoring, laying track, hanging torches and lamps, building carts, carrying ore up), the forge, or the smithy. A miner at the face wears a yellow hat, a forge hand a grey welder's mask, a smith a brown leather apron. Each miner has a name for life.

**Temperament** and **habits** (Mine):
What a miner does with itself while it waits: looking about, stretching, sitting down, whistling, yawning, tapping a foot or sifting the ground. Its temperament is the two habits it falls into most, from its name, so each miner idles in its own way. Two miners waiting side by side chat instead.

**Crew list**:
The miners by name in a box for each trade, opened beside the mine's view: a name dragged to another box changes that miner's trade, and one tapped is followed by the camera. A miner lost stays in the list crossed out under a skull until tapped away or replaced by the next hire.

**Shaft**, **level** and **tunnel**:
The laddered shaft is sunk through the dirt into the stone; at every level a tunnel with track and torches runs out either side.

**Cave**:
Open ground the world leaves in the stone: winding passages and wide caverns, hung with stalactites and grown with stalagmites. When a dig breaks into one the crew learn its extent, hang torches along its floors, go after the ore on its walls and drive drifts on from its ends and its lowest point.

**Drift**:
A short side tunnel driven off a level's tunnel or a cave, level or slanting up or down after the ore, lit as it goes and ending in a small chamber. Off a tunnel it is reached by a few rungs of ladder through the roof or floor.

**Winze**:
A ladder sunk from one level down to the next, away from the shaft.

**Scaffolding** and **trestle**:
A ladder standing free in a cave is braced as scaffolding; where a tunnel's track crosses a cave it runs on a trestle of beams.

**Shoring**:
Timber a miner sets into loose dirt beside a hole so it doesn't slide in.

**Spoil**:
Dirt and rubble carried up and tipped onto the heap.

**Cart** and **hoist**:
A level's mine cart takes miners' ore to the shaft, where the hoist lets its bucket down for the load and winds it up to the surface.

**Yard**:
The ground by the shaft house where ore brought up is tipped, until the forge's hands carry it into the forge.

**Copper**, **silver** and **gold ore**:
What the miners dig: copper near the top of the stone, silver lower, gold deepest. Brought up, it waits in the yard, then in heaps and on shelves in the forge.

**Buildings**:
Along the surface: the **shaft house** over the shaft's mouth, with a lantern by its door; the **barracks**, where the crew sleeps in bunks (a bay of six a level) and sits in the **lounge** to eat or wait out a storm; the **warehouse** of supplies; the **forge**; and the **smithy**. A building's front wall fades to show whoever is inside.

**Building level**:
Each building has five, bought with the Mine's metals, and grows wider with each: the barracks bunks five more of the crew a level, the forge makes room for two more hands, the smithy for another smith, the shaft house keeps out more rain, and the warehouse holds and brings in more supplies. No other building rises more than one level past the warehouse.

**Rebuild**:
An upgraded building is rebuilt, and so is any it pushes along: taken down where it stood, then raised in its new place, inside scaffolding. It is shut while the work goes on, and the work uses supplies.

**Supplies**:
Timber, rails and lights the warehouse brings in over time, up to what it holds. A miner fetches them before fitting out the workings or shoring them, and rebuilds use them too; with none, the shaft can't be sunk further.

**Forge** and **smithy**:
Forge hands smelt the ore piles into copper, silver and gold bars (four copper ore, two silver or one gold to a bar); smiths work the bars, and every ten bars of a metal make a Smithy point of it. Too few at the forge leaves a backlog of ore; too few smiths leaves bars waiting. A trade nobody is put to still gets done, slowly.

**Night shift**:
The share of the crew who work through the night (a fifth, more with Coffee); the rest sleep in the barracks.

**Waterproofing**:
How much of the rain running off the ground the shaft house keeps out of the shaft.

**Weather**:
The mine's sky: clear, cloudy, rain or storm, in spells that turn with its days and nights. Storms bring lightning, which the buildings' roofs take; miners at the surface sit a storm out in the lounge.

**Flood** and **bailing**:
Rainwater that runs down the shaft and fills the workings; miners bail it out with buckets.

**Gravel** and **loose dirt**:
Ground that slides at the slightest drop and can bury the shaft, crushing ladders and timber.

**Lava**:
Molten rock in pools deep down. It creeps, burns miners and wood, and turns to stone where water meets it.

**Lost miner** and **grave**:
A miner killed by a fall of ground, drowning, starvation, lava, fire or lightning. Losses are rare and spaced out, the last miner always survives, and each lost miner gets a grave beyond the smithy.

### The library

**Library**:
A dark cathedral nave the player fills with bookshelves and librarians, earning Knowledge, with the alchemy lab below it.

**Bookshelf**:
A unit of two rows of books; units stack bay by bay up the nave to just under the stained-glass window.

**Librarian**:
A scholar the player hires with the Mine's metals, put to one of three **roles** in the Staff list, each with a name for life.

**Shelver**:
A librarian who keeps the stacks: builds shelves and ladders, wheels the carts, shelves and sorts the books, fights fires, refills the water butts and sweeps up. With no shelvers, the professors do it.

**Professor**:
A librarian who reads. Each book can be read once; a book read has had its knowledge used up and goes on the **return shelf**. Knowledge an hour is built shelves times professors.

**Winter ice**:
Frozen water that makes those on foot slide. A boat's frozen wake blocks rebuilding and stays until fire or explosions melt it into water, which then dries away.

**Return shelf**:
A low stand on the nave's floor for the books the professors have read. When it fills, a shelver loads them into the cart and wheels them out, bringing back fresh books for the gaps.

**Researcher**:
A librarian who works the **alchemy lab**, a vaulted cellar under the nave reached by a ladder from a trapdoor: stoking the athanor, brewing at the cauldron, distilling, studying, chanting at the transmutation circle. Researchers share the Study's timed Knowledge project; with none, it cannot start and existing work pauses.

**Enchanted book**:
A book on the library's shelves that has taken on glowing runes along its spine. With the Enchanted ink skill each shelved book has a small chance a minute of becoming one; a professor who reads it gains a burst of Knowledge.
_Avoid_: magic book, rune book

**Lab level**:
How far the alchemy lab has been dug out, 1 to 5, raised with the Mine's metals. The lab has room for one researcher a level. Level 2 opens the west **annex** (a mandrake garden and a lectern), level 3 the east annex (a crucible that casts gold and an orrery), level 4 adds a salamander in its cage and level 5 a scrying orb.

**Skills**:
The battle's bomb, reusable war banner and strike spells, placed by the player from the side panel.

**Banner influence**:
The circle around a planted war banner where researched damage, life, defense and regeneration bonuses apply. Troops marching toward the banner can receive its researched speed bonus before entering the circle.

### Javelin Bowmen

The Archer Barracks attunement replacing Rangers. Bowmen fire massive arrows that impale and carry a file of susceptible enemies straight backwards. Their upgrades extend the push and piercing, then add an explosion growing with the enemies pierced. Separate from the spear line's javelineers.

### Skyranger

An Archer Barracks attunement with unlimited battlefield range. Arrows rise out of sight and fall vertically over their targets. Upgrades add **arrow rain**.

### Arrow rain

A Skyranger's extra volley after a number of ordinary attacks. Early tiers scatter over an area; the last divides its arrows evenly among enemies there. Rain arrows do not trigger further rain.


### Grapeshot

The Gun Battery's shell impact plus four smaller surrounding explosions. Present as soon as the Cannon Tower attunes to Gun Battery.

### Minelayer

A Cannon Tower attunement that continually lays proximity mines within half the ordinary cannon's range. Directed laying aims future mines; dragging the crosshair home restores random coverage.

### Smart charges

The Minelayer's final upgrade: fifty mines per tower, with little walking charges that approach nearby ground enemies before detonating.


### Stormcallers

The Mage Guild's long-distance chain-lightning troop attunement. Bolts jump between distinct enemies and can critically strike for double damage.

### Pyromancers

The Mage Guild's fire troop attunement, trained at Inferno Hall. Larger area blasts leave burning ground and fire that clings to victims.

### Cryomancers

The Mage Guild's cold troop attunement, trained at Frost Hall. Area impacts briefly freeze enemies, then leave them slowed. Frost Hall replaces the former Cinder Hall while retaining its purchased tiers.


### Furthest wave reached

The highest wave the player has entered, whether or not they cleared it. A new reached record selects the preceding wave as the next starting wave, with a minimum of wave 1. Separate from the highest cleared wave used for rewards.

**Hawk focus**:
An Archer Tower attunement that locks the enemy with the most current life. Consecutive shots build damage and, at its final rank, fire rate; a new lock resets both.

**Wisp Arrow**:
A living blue arrow belonging to one Wisp Tower. It drifts around the tower with six quiet tassels tracing its flight path and constantly slices through nearby enemies in broad arcs. The tassels lengthen during attacks, linger for a second afterward, then slowly shorten. Each arrow has 30 enemy hits before dissolving into blue sparks. A tower restores one arrow every three seconds while below capacity.

**Triple arrows**:
The first Wisp Arrow upgrade. Raises the Wisp Tower’s capacity from one living arrow to three; all can attack together.


**Wisp Fire arrows**:
The second Wisp Arrow upgrade. Adds two fire arrows, 25% larger than blue arrows, alongside the three blue arrows, restoring one fire arrow every six seconds below capacity. Flaming passes leave a fiery trail for two seconds. Each fire arrow disintegrates after ten direct enemy hits and explodes; direct hits, trails and the explosion all deal fire damage.


**Wisp Lightning arrow**:
The third and final Wisp Arrow upgrade. Adds one larger purple arrow alongside blue and fire arrows. On locking a nearby enemy, it flies straight through the captured aim to the edge of the map. Its purple lightning trail lasts five seconds at each point, dealing 300% attack per second to all enemies touching it. The tower regenerates the arrow nine seconds after it exits.

**Ultimate Archer Tower**:
The Archer Tower ultimate formed from its fully upgraded Fire, Hawk and Wisp attunements; holds allied shots outside time and releases them at enemies.

**Divine Arrow**:
The Ultimate Archer Tower’s piercing golden shot, charged by incompatible incoming attacks and emptied on firing.

**Attack MMR**:
The player's Siege rating, based on rated raid wins and losses.

**Castle defense rating**:
The estimated or learned difficulty of raiding a specific castle revision, separate from its owner's attack rating.

**Castle snapshot**:
A fixed revision of a castle and its defenses used for a raid.

**Rated raid**:
A Siege assault that can change attack MMR once. Replaying its completed target is practice.

**Player profile**:
The player's chosen name and custom flag, displayed in Siege.

**Flag stamp**:
A colored pixel pattern layered over a flag's background or earlier stamps.

**Ambush gold**:
The level's deployment budget, spent on buildings and earned by killing enemies. Separate from persistent Mine Gold.

**Kill bounty**:
The Ambush gold paid once for defeating an enemy, based on that enemy's combat difficulty.

- **Outpost breach**: the first ground enemy body entering a fenced outpost. Its health then follows the fraction of its original houses still standing.
- **Flier warning**: a red dotted route from the track entrance to the keep, with a ring and exclamation mark, warning that an upcoming wave includes flying enemies.

- **Auto-send**: an optional Ambush control that sends the next wave after the field is clear and the break ends. Sending early awards no bonus.
- **Strike quick bar**: round spell icons on the board; choose a spell, then tap its target. Choosing it again cancels.

- **Ambush investment**: the gold paid for a building and its local upgrades, including buildings consumed by a merge. Selling returns all of it until wave 2 starts, then a fraction rounded down to tens.

- **Ambush star pool**: the sum of best level ratings minus stars invested in the Ambush star tree. Upgrades, undo and respec affect Ambush alone.
- **Head start**: an Ambush star-tree branch that places one or two free Archer Towers at level start; selling a free tower returns no purchase gold.

- **Ambush boss wave**: wave 10 or 20, containing the strongest native enemy kind its zone budget can afford.

**Rank**:
A named Siege skill band, from Bronze through Grandmaster.

**Division**:
One of five tiers within a Siege rank, V through I.

**Find Match**:
The Siege action that reveals an opponent and castle preview before the player commits to an attack.

- **Defensive DPS**: estimated sustained castle damage against a weighted single-target/crowd benchmark.
- **Castle ceiling**: the strongest legal castle found by the bounded footprint search; the Grandmaster generation anchor.

- **Castle blueprint**: the native city layout and upgrades saved with a Siege opponent.
- **Muster rows**: the entry rows below the invaded castle where the player’s troops arrive.
- **Staging home**: an unseen infantry home that trains and replenishes a squad entering a Siege assault from the bottom edge.

**Reference army**:
A reproducible infantry roster representing an assumed stage of progression for offline Siege difficulty trials.

**Matched raid**:
A difficulty trial in which the reference army and target castle share an MMR.

**Mana**:
A temporary Siege battle resource earned by defeating enemy troops and spent on strike spells.

- **Flagpole:** decorative Siege scenery carrying the defender’s banner; one nearby impact snaps it, leaving a stump.

- **Flag-bearer:** one of three non-combat defenders carrying the castle’s banner. Area or passing attacks can kill one for two mana; ordinary troops never aim at one.

- **Collapse wave:** the Siege victory presentation expanding from the fallen keep, turning walls and selected buildings to visual rubble while replacing the defender’s flags.

- **Squad:** a Siege command group of staging homes sharing a troop role, or one hero/ultimate family. Its flag redirects those homes’ troops; clearing it resumes the keep assault.


**Dark One**:
The source of the main hostile forces; independent enemy factions are story exceptions.

**Mini Darkling**:
A weak Dark One enemy consisting of one dark pixel.

**Darkling**:
A Dark One enemy consisting of a two-by-two black pixel square, splitting into two Mini Darklings when defeated.

**Color drain**:
The gradual loss of color, with tonal contrast preserved, around a dense group of Dark One enemies, strongest at the group's center and fading toward the edges.

**Large Darkling**:
A Dark One enemy consisting of a three-by-three black pixel square, splitting into two Darklings when defeated.

**Major Darkling**:
A Dark One enemy consisting of a four-by-four black pixel square, splitting into three Large Darklings when defeated. Like all Dark One enemies, its outline is a portal contour.

**Portal contour**:
A unit outline that shows a burning dimension through it, as if that dimension filled the whole screen unseen and the outline were a cut into it.

**Art pixel**:
The world-art unit: one eighth of a board cell, scaled to screen pixels by camera zoom and display density.

**Visibility contour**:
A perimeter around a combined group of unit bodies, without seams through overlapping bodies. Dark One enemies use a burning portal contour: half an art pixel for Mini Darklings, three quarters for Darklings and one for larger bodies; player troops use a half-art-pixel dark navy contour. Siege opponents keep crimson, and neutral units black, gold while marked or brood violet.


**Contact damage**:
Damage dealt by an enemy pressing against a structure, with its visibility contour touching the structure’s perimeter.

**Artist sprite**:
A PNG, one pixel an art pixel and without an outline, that replaces the game's own drawn art for one piece of the city; the game still paints its damage, rubble and outline.


**Blight night glow**:
The dim, deep neon orange halo around Dark One enemies at night, brighter and wider where they gather and fading with distance. It is absent during day, sunset, dusk, twilight and dawn.


**Blight**:
The Dark One’s enemy forces, including Mini Darklings, Darklings and Large Darklings.

**Front line**:
Enemies directly contacting the structure or unit their crowd is attacking.

**Attack transfer**:
A rear Blight member’s own attack reaching the front line’s target through an uninterrupted chain of touching living Blight bodies.


**Significant Darkling**:
A Dark One enemy consisting of a five-by-five black art-pixel square with a portal contour. Defeating it releases two Major Darklings and forty-four descendant bodies.

**Blight Worm**:
A Dark One boss of fifty touching five-by-five art-pixel segments. It wanders and bounces on the surface, turning back toward the city more often when far away, each segment striking in turn, then burrows as an immune shadow straight toward a random standing building. It bounces at the playing-field edges and emerges after reaching that target and spending one uninterrupted second outside placed building tiles. Dirt sprays heavily from each head and lightly from the body; underground damage is one quarter of its former strength. Heads take four times damage; cuts create independent worms, and each destroyed segment releases three Significant Darklings. Pieces of three segments or fewer die and release their offspring.

**Surface spell**:
The time a worm head spends wandering above ground before its next dive.

**Worm trail**:
The path a worm head has passed through, followed by every segment at one body width of distance, including its turns, dives and surfacing points.


**Burrow clear time**:
The uninterrupted second a burrowing worm head must spend fully outside placed building tiles after reaching its chosen target, before it can surface on open ground. Entering another tile resets the count.

**Blight infill**:
The black visual joining narrow spaces inside packed Darkling groups. It blends back into the portal outline as bodies separate; it does not change their physical bodies or attack connections.

**Blight Dart**:
A small flying Blight shaped like a black paper airplane between an equilateral triangle and a chevron, with a burning perimeter. Small groups escort the late Mossbound Darkling hordes. Darts released by a fallen prism scatter in three directions before attacking.

**Blight Prism**:
A very slow flying Blight shaped like a black equilateral triangle with nested spinning triangles inside it, first accompanying the last Mossbound horde before the Blight Worm. Their fractional rotation speeds periodically align. Its death releases three Blight Darts one hundred and twenty degrees apart.

**Greater Blight Prism**:
A larger, tougher and slower Blight Prism with four nested spinning triangles. Releases the same three Blight Darts when destroyed.


**Blight trail**:
Dead grass and withered vegetation left where the Blight has walked. Repeated passage and stronger Blight kill larger plants; the damage lasts for the current battle run.


**Play-time sky**:
The shared visible day and night, turning once in five minutes of foreground play. It pauses while the game is hidden or closed and can be fixed to Day, Sunset, Dusk, Twilight, Night or Dawn. Faster sun during catch-up optionally runs this shared cycle at five times normal speed while the Mine or Library processes queued idle work.

### Repair shop
A workshop whose masons leave to repair the city. It begins with two masons and Mending; its skills teach wall masonry, larger crews, critical-job priorities and retreating bow shots.

### Mason
A Repair shop's worker. Masons repair damaged buildings and towers and rebuild destroyed ones; Wall masonry lets them mend walls, gates and wall ballistas.

### Mending
The Repair shop's initial skill: masons repair and rebuild every building and tower, and repair the keep while it stands. It replaced Carpentry and Advanced carpentry.

**Blight Cannon**:
A small solid-black walking fortress with a burning noise perimeter, orange right-angle particle trails inside its square body, and a turret firing orange energy cannonballs.

**Blight Lance**:
A small Blight walker whose deep-orange laser pierces people and structures along its firing line.

**Blight Fortress**:
A medium Blight walker carrying one energy-cannon turret and one piercing-laser turret. Its weapons, legs and armor can be destroyed independently.


**Blight ships**:
The Dark One's counterparts of the eight magic boats: Blight Dinghy, Sailboat, Cutter, Cog, Skiff, Sloop, Galleon and Ark. Their hulls are black, sails orange and rails, runes and bow crystals red. Each retains its original ship's size, strength and water effects.


**Blight Plasma Fortress**:
A large twelve-legged Blight fortress with one centered rooftop plasma turret. It charges an orange ball for fifteen seconds until the ball is three quarters of the body's width, then lobs it in an arc. Impact produces a huge sphere that repeatedly damages units and structures on both sides, and leaves dense glowing cracks that slowly cool. Destroying its turret stops an unfinished charge; a fired ball remains dangerous.

**Small Blight Worm**:
A seven-segment Blight Worm made of touching two-by-two art-pixel squares. It wanders, bounces and tunnels like the boss, spending four times as long above ground between dives. Each segment releases three Darklings on death.

**Medium Blight Worm**:
A fourteen-segment Blight Worm made of touching three-by-three art-pixel squares. It spends four times as long above ground between dives as the boss. Each segment releases three Large Darklings on death.

**Worm piece**:
A connected run of living worm segments after a cut. A piece needs at least four segments to survive; shorter pieces die and release their young. This applies to every Blight Worm size, including the original head piece.

- **Realm:** the upgrade collection containing the Keep, city infrastructure, Mine and Library; replaces the City and shared combat upgrade sections.
- **Individual equipment:** Smithy armour and power ranks belonging to one combat building copy, retained through lifting, placement and evolution.
- **Economy building:** the placeable Mine or Library that unlocks its corresponding production tab while in the city.

**City return**:
A surfaced worm head's chance to turn back toward the nearest city edge when it strays beyond a few city tiles. The chance increases with distance; a little angular variation remains, and the body follows the head's trail.


**Building menu**: The square set of controls around one selected placed building, distinct from the build palette.

**Targeting mode**: A building's rule for choosing eligible enemies: Closest, First, Strongest, Weakest or Groups.

**Crosshairs**: A shooting building's chosen aim point. Enemies within the clipped four-by-four-cell nearby square take priority, using that building's targeting mode.

### Void Defense

**Void**:
An expanding cosmic expanse of darkness with a finite energy reservoir and a fixed expansion work budget per second, divided evenly across its exposed contact perimeter.

**Void portal**:
A rift that feeds the Void field; some open at the start of a scenario, while delayed portals warn on the metropolis map before rupturing.

**Void Node**:
A crystalline coalesced mass of Void energy near the active frontier that infantry riflemen and mechs can attack to slow local erosion and ablate a bounded share of the Void reservoir.

**Supplies**:
The in-battle currency generated periodically by surviving metropolis buildings (plus a baseline trickle) and spent to deploy Resistance towers and strikes.

**Void Essence**:
The common persistent currency earned from every meaningful run (victory or qualifying defeat) based on Void work resisted and preserved city fraction, spent on standard nodes in the Resistance Tech Tree.

**Sparks of Defiance**:
The rare milestone currency earned from first clears and high-preservation thresholds (50%, 75% and 90% preserved city value, shared across modes per scenario), spent on major breakthroughs and ultimate doctrines.

**Build Under Siege**:
The live real-time defense mode where the Void expands while the player deploys, relocates and sells towers and triggers tactical strikes.

**Build & Watch**:
The planning defense mode where the player lays out initial towers and wall blueprints while paused, then locks controls and watches the simulation play out hands-off (except optional emergency strikes).

**Matter Cannon**:
A Resistance reclamation tower that fires matter pellets into the Void, cooling into solid reclaimed bedrock discs on impact.

**Landfall**:
A tactical orbital strike that drops a large disc of sacrificial bedrock directly inside the Void to expand its contact perimeter and divert expansion work away from the city front.

**Wall Serpent**:
A multi-segment autonomous mechanical worm that patrols the Void frontier, absorbing erosion and depositing reclaimed matter behind its tail.

**Resistance Operations**:
The non-economic, non-idle cosmetic flavor view showing the Engineering Bay (a giant experimental turret prototype with autonomous welders) and Research Lab (captured Void specimens and researchers) growing alongside tech progression.

**Void pixel**:
The smallest unit of Void Defense terrain and simulation: one simulation cell. Four Void pixels occupy the area of one former cell; each has half its width and height. Camera zoom changes its display size, not its simulation size.
