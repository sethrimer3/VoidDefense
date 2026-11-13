/** Core domain types for Void Defense: world terrain, metropolitan buildings,
 * Void field state, towers, autonomous agents, strikes, and run results. */

import type { Flag } from "../profile/model.ts";

export type PlayStyleMode = "underSiege" | "buildAndWatch";

export type VoidProfile = {
  name: string;
  flag: Flag;
  mode: PlayStyleMode;
};

/** Cell-level terrain ownership and physical state. */
export const CellMaterial = {
  VOID: 0,
  UNCLAIMED: 1,
  STREET: 2,
  PARK: 3,
  RECLAIMED: 4,
  SALVAGE: 5,
  BUILDING: 6,
  SKYSCRAPER: 7,
  WALL: 8,
  BARRIER: 9,
} as const;

export type CellMaterialId = (typeof CellMaterial)[keyof typeof CellMaterial];

/** Render-only surface detail layered over a cell's material: the countryside between
 * the metropolis and the Void (grass, meadow, forest, crop fields, orchards, dirt roads,
 * rivers and bridges) plus rural props. `NONE` means the plain urban surface. */
export const LandCover = {
  NONE: 0,
  GRASS: 1,
  MEADOW: 2,
  FOREST: 3,
  FIELD_H: 4,
  FIELD_V: 5,
  DIRT_ROAD: 6,
  RIVER: 7,
  BRIDGE: 8,
  ORCHARD: 9,
  SILO: 10,
} as const;

export type LandCoverId = (typeof LandCover)[keyof typeof LandCover];

/** Zone class of a cell along the city-to-Void gradient. */
export const ZoneKind = {
  RURAL: 0,
  SUBURB: 1,
  URBAN: 2,
} as const;

export type ZoneKindId = (typeof ZoneKind)[keyof typeof ZoneKind];

export type DistrictKind =
  | "downtown"
  | "midtown"
  | "industrial"
  | "residential"
  | "plaza"
  | "breach"
  | "rural";

export type BuildingArchStyle =
  | "glassTower"
  | "artDecoSetback"
  | "cyberArcology"
  | "foundryComplex"
  | "solarTerrace"
  | "civicDome"
  | "homestead"
  | "barn";

export type RoofFeatureKind =
  | "helipad"
  | "spire"
  | "reactorDome"
  | "coolingTowers"
  | "skyGarden"
  | "solarArray"
  | "commsArray";

export type MetroBuilding = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  district: DistrictKind;
  isSkyscraper: boolean;
  /** Architectural style controlling material palette & setback tiers. */
  archStyle: BuildingArchStyle;
  /** Distinctive rooftop feature rendered at overview & close zoom. */
  roofFeature: RoofFeatureKind;
  /** Stylized height in stories (1 to 28) for top-down shadow length & rooftop detail. */
  height: number;
  /** Cells originally belonging to this building footprint. */
  cells: number[];
  /** Baseline scorable value when the player arrives on scene. */
  baselineValue: number;
  /** Base Supplies generated per income cycle at 100% integrity. */
  baseIncome: number;
  /** Current development multiplier (1.0 = original intact, up to 2.0 when upgraded by masons). */
  development: number;
  /** Palette variant seed. */
  variant: number;
};

export type VoidPortal = {
  id: number;
  x: number;
  y: number;
  radius: number;
  /** Tick at which this portal activates (0 = active at start; >0 = delayed collapse). */
  activateAtTick: number;
  active: boolean;
};

/** Crystalline Void Node / Tendril Spire that coalesces near the frontier,
 * accelerating local erosion until destroyed by infantry or towers. */
export type VoidNode = {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  canTargetAir?: boolean;
  lureUid?: number;
  lureUntilTick?: number;
  radius: number;
};

/** Late-game / escalating cosmic organisms. */
export type OrganismKind =
  | "nebulaWorm"
  | "constellationSpider"
  | "voidBloom"
  | "nebulaQueen"
  | "voidBee"
  | "honeycombCrystal"
  | "nexusCrystal";

export type VoidOrganism = {
  id: number;
  kind: OrganismKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  canTargetAir?: boolean;
  lureUid?: number;
  lureUntilTick?: number;
  targetX: number;
  targetY: number;
  cooldown: number;
  parentId?: number;
  trail?: { x: number; y: number }[];
};

/** Drifting detached building/terrain fragment pulled along curved streamlines into the Void. */
export type DebrisFragment = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  portalX: number;
  portalY: number;
  color: string;
  glowColor: string;
  size: number;
  life: number;
  maxLife: number;
};

/** Pooled 3D falling chunk (masonry, roof, tower, or unit) that falls under gravity (`vz -= g * dt`),
 * either bouncing and settling into salvageable rubble on solid ground or plunging below the ground plane
 * (`z < 0`, drawn at `screenY = y - z`) into the Void behind the subterranean ledge. */
export type FallingChunk = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  w: number;
  h: number;
  color: string;
  edgeColor: string;
  settle: "salvage" | "void" | "fade";
  age: number;
  bounces: number;
};

/** Cosmetic 1-pixel civilian on city streets near the Void frontier who flees away from Void
 * and falls into the abyss if the street beneath them is consumed. */
export type Civilian = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  falling: boolean;
};

/** Pooled 1-pixel grey dust puff rising from collapsing building columns. */
export type DustPuff = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vz: number;
  age: number;
  maxAge: number;
  color: string;
};

/** Pooled brightness ripple in the Void interior where a large chunk plunges into the abyss. */
export type VoidRipple = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  maxAge: number;
};

/** Impact event emitted when a falling chunk strikes solid ground with sufficient velocity. */
export type ChunkImpact = {
  x: number;
  y: number;
  radius: number;
  damage: number;
};

/** Expanding shockwave or energy ring from Matter Cannon impacts, Landfall, or Containment Pulse. */
export type ShockwaveEffect = {
  x: number;
  y: number;
  maxRadius: number;
  color: string;
  secondaryColor: string;
  life: number;
  maxLife: number;
};

export type TowerTypeId =
  | "matterCannon"
  | "repairDepot"
  | "infantryBarracks"
  | "constructorHub"
  | "shieldProjector"
  | "wallSerpent"
  | "gravityAnchor"
  | "rocketTeam"
  | "heavyMechBay"
  | "voidSiphon"
  | "boundaryPrism"
  | "chronoCannon"
  | "lanternBearer"
  | "seamwalker"
  | "echoMine"
  | "countervoidHeart";

export type PlacedTower = {
  uid: number;
  type: TowerTypeId;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  canTargetAir?: boolean;
  lureUid?: number;
  lureUntilTick?: number;
  paid: number;
  placedAtTick: number;
  cooldown: number;
  /** Optional world-space focus/rally reticle set by the player. */
  focus?: { x: number; y: number };
};

export type WallBlueprint = {
  id: number;
  points: { x: number; y: number }[];
  loop: boolean;
  cells: number[];
};

export type AgentKind =
  | "engineer"
  | "rifleman"
  | "rocketeer"
  | "heavyMech"
  | "wallSerpent"
  | "lanternBearer"
  | "seamwalker"
  | "jetpack";

export type Agent = {
  id: number;
  kind: AgentKind;
  layer?: "ground" | "air";
  homeUid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  canTargetAir?: boolean;
  lureUid?: number;
  lureUntilTick?: number;
  carryingMatter: number;
  state: "idle" | "seekSalvage" | "haulToBuild" | "repair" | "patrol" | "attack" | "retreat";
  targetCell: number;
  targetNodeId: number;
  cooldown: number;
};

export type MatterPellet = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  progress: number;
  duration: number;
  radius: number;
  wallPayload: boolean;
  /** Whether this pellet restores/creates non-baseline land or hardened wall. */
  strength: number;
};

export type LaserBeam = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ttl: number;
  color: string;
};

export type StrikeId = "landfall" | "quarantineBell" | "genesis" | "orbitalReinforcement" | "containmentPulse" | "seismicFrame";

/** Temporary closed boundary seal cast by Quarantine Bell. */
export type QuarantineSeal = {
  id: number;
  x: number;
  y: number;
  radius: number;
  remaining: number;
  duration: number;
};

/** Finite-storage containment state for a Void Siphon tower. */
export type SiphonState = {
  uid: number;
  x: number;
  y: number;
  radius: number;
  phase: "intake" | "venting";
  stored: number;
  maxStorage: number;
  ventRemaining: number;
  ventDuration: number;
};

/** Directional pressure-redirection state for a Boundary Prism tower. */
export type PrismState = {
  uid: number;
  x: number;
  y: number;
  angleRad: number;
  planeLength: number;
  bandWidth: number;
  redirectFraction: number;
};

/** Bounded recent-loss journal entry for Chrono Cannon recovery. */
export type ChronoLossEvent = {
  id: number;
  timeSeconds: number;
  kind: "terrain" | "unit";
  x: number;
  y: number;
  cellIdx: number;
  material: CellMaterialId;
  maxHp: number;
  buildingId?: number;
  columnFloors?: number;
  agentKind?: AgentKind;
  homeUid?: number;
  agentId?: number;
  unitHp?: number;
  unitMaxHp?: number;
  claimed: boolean;
};

/** Visual sequence for Chrono Cannon upward reconstruction and reverse projectile. */
export type ChronoRewindEffect = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  radius: number;
  life: number;
  maxLife: number;
};

export type ScenarioId =
  | "tutorialBreach"
  | "edgeAdvance"
  | "centralRupture"
  | "twinBreaches"
  | "delayedCollapse"
  | "archipelagoCity"
  | "organismEscalation"
  | "endless";

export type ScenarioConfig = {
  id: ScenarioId;
  name: string;
  subtitle: string;
  seed: number;
  worldW: number;
  worldH: number;
  initialVoidEnergy: number; // Infinity for endless
  baseGrowthRate: number;
  rampPerMinute: number;
  startingSuppliesSiege: number;
  startingSuppliesWatch: number;
  portals: { xFrac: number; yFrac: number; radius: number; activateAtSeconds: number }[];
  /** Countryside band between each portal and the metropolis, in cells beyond the portal
   * radius: `ruralCells` of farmland, forest and country roads, then `suburbCells` of
   * leafy low-rise blocks before the dense city. Defaults apply when omitted. */
  countryside?: { ruralCells: number; suburbCells: number };
  endless?: boolean;
};

export type ZeroContactReason =
  | "active"
  | "cityConsumedDefeat"
  | "reservoirDepletedVictory"
  | "voidEradicatedVictory"
  | "awaitingDelayedPortal"
  | "isolatedPocketContainment";

export type RunOutcome = {
  scenarioId: ScenarioId;
  mode: PlayStyleMode;
  status: "won" | "lost";
  reason: ZeroContactReason;
  elapsedSeconds: number;
  preservedRatio: number;
  preservedPercent: number;
  sparksTier: 0 | 1 | 2 | 3;
  sparksAwarded: number;
  voidEssenceAwarded: number;
  workResisted: number;
  participated: boolean;
};
