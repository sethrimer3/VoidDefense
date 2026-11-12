/** Declarative global technology network for Void Defense.
 * Replaces per-building specialization trees with a single continuous DAG across
 * 6 interconnected sectors. Supports logical AND/OR prerequisites while giving each
 * node a primary visual `parent` for `UpgradeGraph` spring physics, plus optional
 * secondary cross-links for multi-parent requirements. */

import type { StrikeId, TowerTypeId } from "../model.ts";

export type TechCurrency = "essence" | "sparks";
export type TechSector =
  | "foundation"
  | "reclamation"
  | "infantry"
  | "containment"
  | "strikes"
  | "breakthroughs";

export type TechNodeKind =
  | "unlockTower"
  | "unlockStrike"
  | "passive"
  | "logic"
  | "synergy"
  | "breakthrough";

export type TechNodeDef = {
  id: string;
  name: string;
  description: string;
  sector: TechSector;
  kind: TechNodeKind;
  currency: TechCurrency;
  /** Primary visual parent in UpgradeGraph (`undefined` for root). */
  parent?: string;
  /** Whether to place beside parent in standard tree layout. */
  side?: boolean;
  /** Additional logical prerequisite node IDs. */
  requires?: string[];
  /** Whether `requires` + `parent` are combined with AND (default) or OR. */
  requireMode?: "all" | "any";
  /** Cost per rank. Length of array defines `maxRank`. */
  costs: readonly number[];
  /** Colour class (`hue-ember`, `hue-steel`, `hue-storm`, `hue-verdant`). */
  hue: "ember" | "steel" | "storm" | "verdant";
  /** Icon key for rendering on the node face. */
  icon: string;
  unlocksTower?: TowerTypeId;
  unlocksStrike?: StrikeId;
};

export const TECH_NODES: readonly TechNodeDef[] = [
  // ── Root: Resistance Command ──────────────────────────────────────────
  {
    id: "commandCore",
    name: "Emergency Response Protocol",
    description: "United Resistance command network online. Unlocks Matter Cannon, Repair Depot, Infantry Barracks, and Hearthseed drops.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    costs: [0],
    hue: "ember",
    icon: "keep",
  },

  // ── Sector 1: Foundation & Economy ────────────────────────────────────
  {
    id: "supplyDrop",
    name: "Emergency Supply Drops",
    description: "+35 starting Supplies per rank at the start of every deployment.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    parent: "commandCore",
    costs: [10, 20, 35, 55],
    hue: "ember",
    icon: "oath",
  },
  {
    id: "civicGrid",
    name: "Civic Power Grid",
    description: "Surviving civilian skyscrapers and blocks generate +15% Supplies per rank.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    parent: "supplyDrop",
    costs: [15, 30, 50],
    hue: "ember",
    icon: "oath",
  },
  {
    id: "verticalArcology",
    name: "Vertical Arcology Retrofits",
    description: "Engineers can develop intact skyscrapers up to +25% higher ceiling per rank, increasing city income without inflating baseline score.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    parent: "civicGrid",
    costs: [25, 45, 75],
    hue: "ember",
    icon: "helm",
  },
  {
    id: "rapidDeconstruct",
    name: "Modular Deconstruction",
    description: "Selling towers during active siege refunds +8% more Supplies per rank.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    parent: "supplyDrop",
    side: true,
    costs: [15, 30],
    hue: "steel",
    icon: "mail",
  },
  {
    id: "prefabFoundations",
    name: "Prefabricated Foundations",
    description: "All Resistance structures cost 6% fewer Supplies per rank.",
    sector: "foundation",
    kind: "passive",
    currency: "essence",
    parent: "rapidDeconstruct",
    costs: [20, 40, 65],
    hue: "steel",
    icon: "mail",
  },

  // ── Sector 2: Reclamation & Construction ──────────────────────────────
  {
    id: "matterCannonOutput",
    name: "High-Density Matter Pellets",
    description: "Matter Cannons fire +20% faster and create +20% denser reclaimed land per rank.",
    sector: "reclamation",
    kind: "passive",
    currency: "essence",
    parent: "commandCore",
    costs: [12, 24, 42, 65],
    hue: "steel",
    icon: "arrow",
  },
  {
    id: "masonThroughput",
    name: "Automated Exosuit Masons",
    description: "1×2 Engineers move 18% faster and repair/build +25% more structural integrity per trip.",
    sector: "reclamation",
    kind: "passive",
    currency: "essence",
    parent: "matterCannonOutput",
    costs: [12, 25, 45],
    hue: "steel",
    icon: "mail",
  },
  {
    id: "unlockConstructorHub",
    name: "Constructor Hub",
    description: "Unlocks Constructor Hub: deploys dedicated engineering teams that execute user-drawn polyline wall blueprints.",
    sector: "reclamation",
    kind: "unlockTower",
    currency: "sparks",
    parent: "masonThroughput",
    costs: [1],
    hue: "steel",
    icon: "helm",
    unlocksTower: "constructorHub",
  },
  {
    id: "ferrocreteWalls",
    name: "Ferrocrete Composite Walls",
    description: "Constructed walls and Matter Cannon barriers require +25% more Void work to erode per rank.",
    sector: "reclamation",
    kind: "passive",
    currency: "essence",
    parent: "unlockConstructorHub",
    costs: [20, 40, 70],
    hue: "steel",
    icon: "helm",
  },
  {
    id: "strategicMasonry",
    name: "AI Logic: Structural Triage",
    description: "Engineers prioritize high-value skyscrapers and load-bearing pixels before minor street damage.",
    sector: "reclamation",
    kind: "logic",
    currency: "essence",
    parent: "masonThroughput",
    side: true,
    costs: [30],
    hue: "verdant",
    icon: "oath",
  },

  // ── Sector 3: Infantry & Automation ───────────────────────────────────
  {
    id: "thermalLasers",
    name: "Focused Thermal Carbine",
    description: "1-pixel Riflemen deal +25% anti-Void ablation damage and +15% range per rank.",
    sector: "infantry",
    kind: "passive",
    currency: "essence",
    parent: "commandCore",
    costs: [12, 24, 40, 60],
    hue: "ember",
    icon: "dagger",
  },
  {
    id: "squadExpansion",
    name: "Rapid Muster Bays",
    description: "Infantry Barracks deploy +2 additional Riflemen per squad per rank.",
    sector: "infantry",
    kind: "passive",
    currency: "essence",
    parent: "thermalLasers",
    costs: [18, 36, 60],
    hue: "ember",
    icon: "dagger",
  },
  {
    id: "priorityTargeting",
    name: "AI Logic: Node & Threat Priority",
    description: "Riflemen automatically prioritize crystalline Void Nodes and cosmic organisms over dormant edges.",
    sector: "infantry",
    kind: "logic",
    currency: "essence",
    parent: "thermalLasers",
    side: true,
    costs: [25],
    hue: "ember",
    icon: "bow",
  },
  {
    id: "tacticalRetreat",
    name: "AI Logic: Perimeter Kiting",
    description: "Infantry automatically step back from advancing Void frontiers while maintaining suppressive fire.",
    sector: "infantry",
    kind: "logic",
    currency: "essence",
    parent: "priorityTargeting",
    costs: [35],
    hue: "ember",
    icon: "bow",
  },
  {
    id: "unlockRocketTeam",
    name: "Particulate Rocket Team",
    description: "Unlocks Rocket Team: launches micro-missiles that burst into reclaimable land particles on impact.",
    sector: "infantry",
    kind: "unlockTower",
    currency: "sparks",
    parent: "squadExpansion",
    costs: [2],
    hue: "ember",
    icon: "arrow",
    unlocksTower: "rocketTeam",
  },
  {
    id: "unlockHeavyMech",
    name: "Heavy Exomech Bay",
    description: "Unlocks Heavy Mech Bay: deploys armored 2×2/3×3 frames capable of high-volume hauling and heavy Void suppression.",
    sector: "infantry",
    kind: "unlockTower",
    currency: "sparks",
    parent: "unlockRocketTeam",
    requires: ["unlockConstructorHub"],
    costs: [3],
    hue: "ember",
    icon: "helm",
    unlocksTower: "heavyMechBay",
  },

  // ── Sector 4: Containment Engineering ─────────────────────────────────
  {
    id: "unlockShieldProjector",
    name: "Phase Barrier Projector",
    description: "Unlocks Barrier Projector: projects a regenerating hard-light containment arc that absorbs Void erosion work.",
    sector: "containment",
    kind: "unlockTower",
    currency: "sparks",
    parent: "commandCore",
    costs: [1],
    hue: "storm",
    icon: "bolt",
    unlocksTower: "shieldProjector",
  },
  {
    id: "harmonicShields",
    name: "Harmonic Capacitor Array",
    description: "Barrier Projectors regenerate +25% faster and project +1 cell wider containment arcs per rank.",
    sector: "containment",
    kind: "passive",
    currency: "essence",
    parent: "unlockShieldProjector",
    costs: [18, 35, 60],
    hue: "storm",
    icon: "bolt",
  },
  {
    id: "unlockGravityAnchor",
    name: "Gravity Containment Anchor",
    description: "Unlocks Gravity Anchor: stabilizes local building geometry against crumbling and increases Void erosion cost in its radius.",
    sector: "containment",
    kind: "unlockTower",
    currency: "sparks",
    parent: "harmonicShields",
    costs: [2],
    hue: "storm",
    icon: "bolt",
    unlocksTower: "gravityAnchor",
  },
  {
    id: "unlockWallSerpent",
    name: "Autonomous Wall Serpent",
    description: "Unlocks Wall Serpent Emitter: launches a mobile construct that slithers along exposed frontiers, leaving a continuous ferrocrete wall trail.",
    sector: "containment",
    kind: "unlockTower",
    currency: "sparks",
    parent: "unlockGravityAnchor",
    requires: ["ferrocreteWalls"],
    costs: [3],
    hue: "storm",
    icon: "helm",
    unlocksTower: "wallSerpent",
  },

  // ── Sector 5: Strike Command ──────────────────────────────────────────
  {
    id: "landfallPayload",
    name: "Fertile Hearthseed",
    description: "Expands Hearthseed radius (+1 cell per rank) and grows trees and farmland on newly raised islands.",
    sector: "strikes",
    kind: "passive",
    currency: "essence",
    parent: "commandCore",
    costs: [15, 30, 50],
    hue: "verdant",
    icon: "bolt",
  },
  {
    id: "orbitalCooldowns",
    name: "Rapid Orbital Telemetry",
    description: "All Strike abilities recharge 12% faster per rank.",
    sector: "strikes",
    kind: "passive",
    currency: "essence",
    parent: "landfallPayload",
    costs: [20, 40, 65],
    hue: "verdant",
    icon: "bolt",
  },
  {
    id: "unlockContainmentPulse",
    name: "Containment Pulse Strike",
    description: "Unlocks Containment Pulse: electromagnetic orbital discharge that destroys Void Nodes and freezes frontier erosion briefly.",
    sector: "strikes",
    kind: "unlockStrike",
    currency: "sparks",
    parent: "orbitalCooldowns",
    costs: [1],
    hue: "storm",
    icon: "bolt",
    unlocksStrike: "containmentPulse",
  },
  {
    id: "unlockGenesis",
    name: "Genesis Terraform Wave",
    description: "Unlocks Genesis Strike: an expanding ring of synthetic bedrock that reclaims a wide swath of Void.",
    sector: "strikes",
    kind: "unlockStrike",
    currency: "sparks",
    parent: "unlockContainmentPulse",
    requires: ["matterCannonOutput"],
    costs: [2],
    hue: "verdant",
    icon: "oath",
    unlocksStrike: "genesis",
  },
  {
    id: "unlockOrbitalReinforcement",
    name: "Orbital Drop Pod Squad",
    description: "Unlocks Orbital Reinforcement: drops a prefab ferrocrete bunker and an elite rifle squad directly at the target.",
    sector: "strikes",
    kind: "unlockStrike",
    currency: "sparks",
    parent: "orbitalCooldowns",
    side: true,
    requires: ["squadExpansion"],
    costs: [2],
    hue: "ember",
    icon: "dagger",
    unlocksStrike: "orbitalReinforcement",
  },
  {
    id: "unlockSeismicFrame",
    name: "Seismic Stiffener Strike",
    description: "Unlocks Seismic Stiffener: reinforces all buildings and streets in its radius to maximum structural HP and clears accumulated erosion work.",
    sector: "strikes",
    kind: "unlockStrike",
    currency: "sparks",
    parent: "landfallPayload",
    side: true,
    requires: ["masonThroughput"],
    costs: [1],
    hue: "steel",
    icon: "helm",
    unlocksStrike: "seismicFrame",
  },
  {
    id: "strikeCapacitors",
    name: "Orbital Capacitor Banks",
    description: "Reduces the Supplies cost of all orbital strikes by 10% per rank.",
    sector: "strikes",
    kind: "passive",
    currency: "essence",
    parent: "unlockSeismicFrame",
    costs: [20, 40],
    hue: "steel",
    icon: "bolt",
  },

  // ── Sector 6: Research Breakthroughs (Cross-Sector Synergies) ─────────
  {
    id: "matterSynthesis",
    name: "Breakthrough: On-Site Matter Synthesis",
    description: "Engineers can synthesize construction matter directly at repair/blueprint sites without hauling salvage (salvage remains 50% cheaper).",
    sector: "breakthroughs",
    kind: "breakthrough",
    currency: "sparks",
    parent: "ferrocreteWalls",
    requires: ["harmonicShields", "civicGrid"],
    costs: [3],
    hue: "verdant",
    icon: "oath",
  },
  {
    id: "synthesisEfficiency",
    name: "Zero-Point Synthesis Conduits",
    description: "Reduces the energy delay of On-Site Matter Synthesis by 20% per rank.",
    sector: "breakthroughs",
    kind: "synergy",
    currency: "essence",
    parent: "matterSynthesis",
    costs: [40, 75, 120],
    hue: "verdant",
    icon: "oath",
  },
  {
    id: "perimeterResonance",
    name: "Breakthrough: Perimeter Resonance",
    description: "Sacrificial land islands inside the Void exert +35% higher frontier diversion weight, drawing even more pressure away from city blocks.",
    sector: "breakthroughs",
    kind: "breakthrough",
    currency: "sparks",
    parent: "unlockGenesis",
    requires: ["unlockGravityAnchor"],
    costs: [2],
    hue: "storm",
    icon: "bolt",
  },
  {
    id: "serpentConduits",
    name: "Breakthrough: Serpent Matter Conduits",
    description: "Wall Serpents move 25% faster and deposit wider ferrocrete walls per rank.",
    sector: "breakthroughs",
    kind: "synergy",
    currency: "essence",
    parent: "unlockWallSerpent",
    requires: ["matterCannonOutput"],
    costs: [35, 70],
    hue: "storm",
    icon: "helm",
  },
  {
    id: "mechOverdrive",
    name: "Breakthrough: Exomech Fusion Cores",
    description: "Heavy Mechs deal +30% thermal beam damage and deploy +1 extra mech per bay.",
    sector: "breakthroughs",
    kind: "synergy",
    currency: "essence",
    parent: "unlockHeavyMech",
    requires: ["harmonicShields"],
    costs: [45, 90],
    hue: "ember",
    icon: "helm",
  },
];

export const TECH_BY_ID: ReadonlyMap<string, TechNodeDef> = new Map(TECH_NODES.map((n) => [n.id, n]));
