/** Resistance tower catalog, strike abilities, autonomous 1-pixel infantry,
 * 1x2 exosuit masons, Wall Serpents, and late-game cosmic Void organisms. */

import { pixels } from "./config.ts";
import { dist } from "../exact.ts";
import { hash01, ORTHO } from "./grid.ts";
import {
  CellMaterial,
  type CellMaterialId,
  type Agent,
  type AgentKind,
  type ChronoLossEvent,
  type ChronoRewindEffect,
  type LaserBeam,
  type MatterPellet,
  type OrganismKind,
  type PlacedTower,
  type PrismState,
  type SiphonState,
  type StrikeId,
  type TowerTypeId,
  type VoidOrganism,
  type WallBlueprint,
} from "./model.ts";
import { CHUNK_TOWER_DAMAGE_SCALE, type VoidPhysics } from "./physics.ts";
import type { EvaluatedTech } from "./tech/wallet.ts";
import type { VoidField } from "./void-field.ts";
import type { VoidWorld } from "./world.ts";

export type TowerSpec = {
  id: TowerTypeId;
  name: string;
  shortName: string;
  description: string;
  cost: number;
  w: number;
  h: number;
  maxHp: number;
  range: number;
  cooldownSeconds: number;
  color: string;
};

export const TOWER_SPECS: Record<TowerTypeId, TowerSpec> = {
  matterCannon: {
    id: "matterCannon",
    name: "Matter Cannon",
    shortName: "Matter",
    description: "Fires synthetic land pellets that displace Void and reinforce crumbling frontiers.",
    cost: 60,
    w: pixels(3),
    h: pixels(3),
    maxHp: 180,
    range: pixels(34),
    cooldownSeconds: 1.8,
    color: "#f28d35",
  },
  repairDepot: {
    id: "repairDepot",
    name: "Mason Depot",
    shortName: "Masons",
    description: "Deploys 1×2 engineers to haul salvage, repair skyscrapers, and upgrade city income.",
    cost: 55,
    w: pixels(3),
    h: pixels(3),
    maxHp: 170,
    range: pixels(38),
    cooldownSeconds: 3.0,
    color: "#e6b84d",
  },
  infantryBarracks: {
    id: "infantryBarracks",
    name: "Infantry Barracks",
    shortName: "Rifles",
    description: "Deploys 1-pixel riflemen that destroy Void Nodes, organisms, and ablate frontier pressure.",
    cost: 50,
    w: pixels(3),
    h: pixels(3),
    maxHp: 190,
    range: pixels(32),
    cooldownSeconds: 2.5,
    color: "#ff6b2b",
  },
  constructorHub: {
    id: "constructorHub",
    name: "Constructor Hub",
    shortName: "Builder",
    description: "Engineering teams execute user-drawn polyline wall blueprints and reinforce fortifications.",
    cost: 70,
    w: pixels(3),
    h: pixels(3),
    maxHp: 200,
    range: pixels(44),
    cooldownSeconds: 2.2,
    color: "#d49b35",
  },
  shieldProjector: {
    id: "shieldProjector",
    name: "Barrier Projector",
    shortName: "Shield",
    description: "Projects a regenerating phase barrier that absorbs Void frontier erosion within its arc.",
    cost: 75,
    w: pixels(3),
    h: pixels(3),
    maxHp: 210,
    range: pixels(14),
    cooldownSeconds: 1.0,
    color: "#45d1e6",
  },
  wallSerpent: {
    id: "wallSerpent",
    name: "Wall Serpent Bay",
    shortName: "Serpent",
    description: "Launches an autonomous construct that slithers along Void fronts leaving a ferrocrete wall trail.",
    cost: 95,
    w: pixels(3),
    h: pixels(3),
    maxHp: 220,
    range: pixels(48),
    cooldownSeconds: 8.0,
    color: "#7ad7f0",
  },
  gravityAnchor: {
    id: "gravityAnchor",
    name: "Gravity Anchor",
    shortName: "Anchor",
    description: "Locally stabilizes geometry, increasing the Void work required to erode nearby structures by 45%.",
    cost: 85,
    w: pixels(3),
    h: pixels(3),
    maxHp: 240,
    range: pixels(18),
    cooldownSeconds: 2.0,
    color: "#6d88ff",
  },
  rocketTeam: {
    id: "rocketTeam",
    name: "Rocket Battery",
    shortName: "Rockets",
    description: "Fires long-range micro-missiles that burst into ferrocrete wall & land particles on impact.",
    cost: 90,
    w: pixels(3),
    h: pixels(3),
    maxHp: 185,
    range: pixels(46),
    cooldownSeconds: 2.6,
    color: "#ff4f38",
  },
  heavyMechBay: {
    id: "heavyMechBay",
    name: "Heavy Mech Bay",
    shortName: "Mechs",
    description: "Deploys armored 2×2 exomechs with high-powered thermal beams and rapid fortification repair.",
    cost: 120,
    w: pixels(4),
    h: pixels(4),
    maxHp: 300,
    range: pixels(38),
    cooldownSeconds: 4.0,
    color: "#ffa630",
  },
  voidSiphon: {
    id: "voidSiphon",
    name: "Void Siphon",
    shortName: "Siphon",
    description: "Absorbs up to 25% of nearby erosion pressure into a finite tank, then enters a 4s vent cycle.",
    cost: 70,
    w: pixels(2),
    h: pixels(2),
    maxHp: 140,
    range: pixels(9),
    cooldownSeconds: 4.0,
    color: "#9a6bff",
  },
  boundaryPrism: {
    id: "boundaryPrism",
    name: "Boundary Prism",
    shortName: "Prism",
    description: "Directional crystal that bends up to 35% of approaching Void pressure sideways toward an adjacent flank.",
    cost: 75,
    w: pixels(2),
    h: pixels(2),
    maxHp: 130,
    range: pixels(12),
    cooldownSeconds: 0.5,
    color: "#5ce1e6",
  },
  chronoCannon: {
    id: "chronoCannon",
    name: "Chrono Cannon",
    shortName: "Chrono",
    description: "Rewinds up to 6s of recent Void-caused terrain, structure, and unit losses within a 5-cell radius.",
    cost: 95,
    w: pixels(2),
    h: pixels(2),
    maxHp: 150,
    range: pixels(18),
    cooldownSeconds: 12.0,
    color: "#f2c14e",
  },
  lanternBearer: {
    id: "lanternBearer",
    name: "Lantern Bearer",
    shortName: "Lantern",
    description: "Emits a warm amber lantern aura that stabilizes nearby frontier cells and slows local Void erosion.",
    cost: 55,
    w: pixels(2),
    h: pixels(2),
    maxHp: 120,
    range: pixels(8),
    cooldownSeconds: 2.0,
    color: "#ffcf66",
  },
  seamwalker: {
    id: "seamwalker",
    name: "Seamwalker Post",
    shortName: "Seamwalker",
    description: "Deploys Seamwalkers that patrol the Void frontier and stitch damaged terrain.",
    cost: 80,
    w: pixels(2),
    h: pixels(2),
    maxHp: 140,
    range: pixels(11),
    cooldownSeconds: 3.5,
    color: "#7be0ad",
  },
  echoMine: {
    id: "echoMine",
    name: "Echo Mine",
    shortName: "Echo Mine",
    description: "Low-cost decoy tower that draws Void pressure and detonates in a shockwave when destroyed.",
    cost: 25,
    w: pixels(2),
    h: pixels(2),
    maxHp: 60,
    range: pixels(6),
    cooldownSeconds: 1.0,
    color: "#e87ea1",
  },
  countervoidHeart: {
    id: "countervoidHeart",
    name: "Countervoid Heart",
    shortName: "Heart",
    description: "Ultimate anti-Void core that pulses suppression waves and empowers nearby Resistance towers.",
    cost: 160,
    w: pixels(2),
    h: pixels(2),
    maxHp: 240,
    range: pixels(16),
    cooldownSeconds: 6.0,
    color: "#ff5c8a",
  },
};

export type StrikeSpec = {
  id: StrikeId;
  name: string;
  shortName: string;
  description: string;
  supplyCost: number;
  cooldownSeconds: number;
  radius: number;
  color: string;
};

export const STRIKE_SPECS: Record<StrikeId, StrikeSpec> = {
  landfall: {
    id: "landfall",
    name: "Hearthseed",
    shortName: "Hearthseed",
    description: "Drops a warm seed into the Void, raising a living patch of earth and grass. Upgrades grow its radius, trees, and farmland.",
    supplyCost: 35,
    cooldownSeconds: 12,
    radius: pixels(4),
    color: "#86d96a",
  },
  quarantineBell: {
    id: "quarantineBell",
    name: "Quarantine Bell",
    shortName: "Bell",
    description: "Casts a temporary 6s closed seal that blocks Void propagation across its boundary in both directions. Interior Void remains active.",
    supplyCost: 40,
    cooldownSeconds: 35,
    radius: pixels(10),
    color: "#d4b45c",
  },
  containmentPulse: {
    id: "containmentPulse",
    name: "Containment Pulse",
    shortName: "Pulse",
    description: "EMP burst that shatters Void Nodes/organisms in radius and freezes Void expansion for 4.5s.",
    supplyCost: 45,
    cooldownSeconds: 18,
    radius: pixels(14),
    color: "#5ce1e6",
  },
  genesis: {
    id: "genesis",
    name: "Genesis Wave",
    shortName: "Genesis",
    description: "High-density terraform wave that reclaims a wide disc of Void and rings it with ferrocrete wall.",
    supplyCost: 65,
    cooldownSeconds: 22,
    radius: pixels(10.5),
    color: "#7ce88b",
  },
  orbitalReinforcement: {
    id: "orbitalReinforcement",
    name: "Orbital Drop Squad",
    shortName: "Drop Pod",
    description: "Drops a ferrocrete bunker pad and 4 elite thermal riflemen at the target point.",
    supplyCost: 50,
    cooldownSeconds: 20,
    radius: pixels(5),
    color: "#ff7338",
  },
  seismicFrame: {
    id: "seismicFrame",
    name: "Seismic Stiffener",
    shortName: "Seismic",
    description: "Reinforces all buildings and streets in radius to maximum structural HP and clears erosion work.",
    supplyCost: 40,
    cooldownSeconds: 16,
    radius: pixels(12),
    color: "#e6c85c",
  },
};

export class VoidCombatManager {
  readonly towers: PlacedTower[] = [];
  readonly agents: Agent[] = [];
  readonly pellets: MatterPellet[] = [];
  readonly lasers: LaserBeam[] = [];
  readonly blueprints: WallBlueprint[] = [];
  readonly organisms: VoidOrganism[] = [];
  readonly strikeCooldowns: Record<StrikeId, number> = {
    landfall: 0,
    quarantineBell: 0,
    containmentPulse: 0,
    genesis: 0,
    orbitalReinforcement: 0,
    seismicFrame: 0,
  };
  /** Per-tower shield pool for `shieldProjector` instances (`uid -> shieldEnergy`). */
  readonly shieldPools = new Map<number, number>();
  /** Cell mask covered by active `gravityAnchor` towers (`1` = stabilized). */
  readonly gravityAnchorMask: Uint8Array;
  /** Per-tower Void Siphon containment state (`uid -> SiphonState`). */
  readonly siphonStates = new Map<number, SiphonState>();
  /** Per-tower Boundary Prism directional state (`uid -> PrismState`). */
  readonly prismStates = new Map<number, PrismState>();
  /** Bounded recent-loss journal for Chrono Cannon recovery. */
  readonly chronoJournal: ChronoLossEvent[] = [];
  /** Visual rewind effects for Chrono Cannon upward reconstruction & returning shot. */
  readonly chronoEffects: ChronoRewindEffect[] = [];
  /** Temporary post-destruction Persistent Echo lures. */
  readonly persistentEchoes: { x: number; y: number; remaining: number; radius: number }[] = [];
  private nextChronoLossId = 1;

  private nextTowerUid = 1;
  private nextAgentId = 1;
  private nextBlueprintId = 1;
  private nextOrganismId = 1;

  constructor(worldCellCount: number) {
    this.gravityAnchorMask = new Uint8Array(worldCellCount);
  }

  /** Effective supply price for placing `type`. */
  towerPrice(type: TowerTypeId, tech: EvaluatedTech): number {
    return Math.max(15, Math.round((TOWER_SPECS[type].cost * tech.structureCostMultiplier) / 5) * 5);
  }

  /** Checks whether a tower of `type` can be placed with top-left cell `(x, y)`. */
  initTowerSpecialState(tower: PlacedTower, tech?: EvaluatedTech): void {
    const cx = tower.x + tower.w * 0.5;
    const cy = tower.y + tower.h * 0.5;
    if (tower.type === "voidSiphon") {
      const ventDur = Math.max(2.0, 4.0 - (tech?.siphonVentReduction ?? 0));
      this.siphonStates.set(tower.uid, {
        uid: tower.uid,
        x: cx,
        y: cy,
        radius: pixels(9),
        phase: "intake",
        stored: 0,
        maxStorage: Math.round(250 * (tech?.siphonCapacityMultiplier ?? 1)),
        ventRemaining: 0,
        ventDuration: ventDur,
      });
    } else if (tower.type === "boundaryPrism") {
      this.prismStates.set(tower.uid, {
        uid: tower.uid,
        x: cx,
        y: cy,
        angleRad: 0,
        planeLength: pixels(12 + (tech?.prismLengthBonus ?? 0)),
        bandWidth: pixels(3),
        redirectFraction: tech?.prismRedirectCap ?? 0.35,
      });
    }
  }

  clearTowerSpecialState(uid: number): void {
    this.siphonStates.delete(uid);
    this.prismStates.delete(uid);
  }

  rotatePrism(uid: number, deltaRad = Math.PI / 4): boolean {
    const p = this.prismStates.get(uid);
    if (!p) return false;
    p.angleRad = (p.angleRad + deltaRad) % (Math.PI * 2);
    return true;
  }

  recordChronoLoss(
    timeSeconds: number,
    kind: "terrain" | "unit",
    x: number,
    y: number,
    cellIdx: number,
    material: CellMaterialId,
    maxHp: number,
    buildingId = -1,
    columnFloors = 0,
    agentKind?: AgentKind,
    homeUid?: number,
    agentId?: number,
    unitHp?: number,
    unitMaxHp?: number,
  ): void {
    if (this.chronoJournal.length >= 512) {
      this.chronoJournal.shift();
    }
    this.chronoJournal.push({
      id: this.nextChronoLossId++,
      timeSeconds,
      kind,
      x,
      y,
      cellIdx,
      material,
      maxHp,
      buildingId,
      columnFloors,
      agentKind,
      homeUid,
      agentId,
      unitHp,
      unitMaxHp,
      claimed: false,
    });
  }

  stepSiphonTimers(dt: number): void {
    for (const s of this.siphonStates.values()) {
      if (s.phase === "venting") {
        s.ventRemaining = Math.max(0, s.ventRemaining - dt);
        s.stored = s.maxStorage * (s.ventRemaining / s.ventDuration);
        if (s.ventRemaining <= 0) {
          s.phase = "intake";
          s.stored = 0;
        }
      }
    }
  }

  stepChronoCannons(world: VoidWorld, voidField: VoidField, dt: number, timeSeconds: number, tech?: EvaluatedTech): number {
    let restoredTotal = 0;
    const windowSec = 6.0 + (tech?.chronoWindowBonus ?? 0);
    const recRadius = pixels(5 + (tech?.chronoRadiusBonus ?? 0));
    const recRadiusSq = recRadius * recRadius;
    const maxBudget = 24 + (tech?.chronoBudgetBonus ?? 0);

    for (const t of this.towers) {
      if (t.type !== "chronoCannon") continue;
      if (t.cooldown > 0) {
        t.cooldown = Math.max(0, t.cooldown - dt);
        continue;
      }
      const tx = t.x + t.w * 0.5;
      const ty = t.y + t.h * 0.5;
      const rangeSq = TOWER_SPECS.chronoCannon.range * TOWER_SPECS.chronoCannon.range;

      // Find an unclaimed eligible loss within tower range and 6s window
      let targetLoss: ChronoLossEvent | null = null;
      for (let i = this.chronoJournal.length - 1; i >= 0; i--) {
        const ev = this.chronoJournal[i];
        if (ev.claimed || timeSeconds - ev.timeSeconds > windowSec) continue;
        const dSq = (ev.x - tx) * (ev.x - tx) + (ev.y - ty) * (ev.y - ty);
        if (dSq <= rangeSq) {
          targetLoss = ev;
          break;
        }
      }
      if (!targetLoss) continue;

      let budget = maxBudget;
      let restoredAny = false;
      // Pass 1: Restore terrain and building support/floors first
      for (let i = this.chronoJournal.length - 1; i >= 0 && budget > 0; i--) {
        const ev = this.chronoJournal[i];
        if (ev.claimed || ev.kind !== "terrain" || timeSeconds - ev.timeSeconds > windowSec) continue;
        const dSq = (ev.x - targetLoss.x) * (ev.x - targetLoss.x) + (ev.y - targetLoss.y) * (ev.y - targetLoss.y);
        if (dSq > recRadiusSq) continue;

        if (world.material[ev.cellIdx] === CellMaterial.VOID) {
          ev.claimed = true;
          world.material[ev.cellIdx] = ev.material === CellMaterial.VOID ? CellMaterial.RECLAIMED : ev.material;
          world.hp[ev.cellIdx] = ev.maxHp;
          world.maxHp[ev.cellIdx] = Math.max(world.maxHp[ev.cellIdx], ev.maxHp);
          if (ev.buildingId !== undefined && ev.buildingId >= 0) {
            world.buildingAt[ev.cellIdx] = ev.buildingId;
            world.columnFloors[ev.cellIdx] = Math.max(1, ev.columnFloors ?? 1);
          } else {
            world.buildingAt[ev.cellIdx] = -1;
          }
          world.grid.markIndexDirty(ev.cellIdx);
          budget--;
          restoredTotal++;
          restoredAny = true;
        }
      }

      // Pass 2: Restore Void-fallen units onto safe valid ground without duplicate IDs
      for (let i = this.chronoJournal.length - 1; i >= 0 && budget > 0; i--) {
        const ev = this.chronoJournal[i];
        if (ev.claimed || ev.kind !== "unit" || !ev.agentKind || timeSeconds - ev.timeSeconds > windowSec) continue;
        const dSq = (ev.x - targetLoss.x) * (ev.x - targetLoss.x) + (ev.y - targetLoss.y) * (ev.y - targetLoss.y);
        if (dSq > recRadiusSq) continue;
        if (ev.agentId !== undefined && this.agents.some((ag) => ag.id === ev.agentId)) continue;

        // Bounded local safe-ground check
        const gx = Math.floor(ev.x);
        const gy = Math.floor(ev.y);
        let safeX = -1;
        let safeY = -1;
        for (let oy = -2; oy <= 2 && safeX < 0; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const sx = gx + ox;
            const sy = gy + oy;
            if (world.grid.inBounds(sx, sy) && world.material[world.grid.index(sx, sy)] !== CellMaterial.VOID) {
              safeX = sx + 0.5;
              safeY = sy + 0.5;
              break;
            }
          }
        }
        if (safeX < 0) continue;

        ev.claimed = true;
        const maxHp = ev.unitMaxHp ?? 60;
        const hp = Math.min(maxHp, Math.max(1, ev.unitHp ?? maxHp * 0.6));
        this.agents.push({
          id: ev.agentId ?? this.nextAgentId++,
          kind: ev.agentKind,
          homeUid: ev.homeUid ?? -1,
          x: safeX,
          y: safeY,
          vx: 0,
          vy: 0,
          hp,
          maxHp,
          cooldown: 0.4,
          carryingMatter: 0,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          layer: ev.agentKind === "jetpack" ? "air" : "ground",
        });
        budget--;
        restoredTotal++;
        restoredAny = true;
      }

      if (restoredAny) {
        t.cooldown = TOWER_SPECS.chronoCannon.cooldownSeconds;
        voidField.rebuildFrontier(world);
        if (this.chronoEffects.length < 24) {
          this.chronoEffects.push({
            sx: targetLoss.x,
            sy: targetLoss.y,
            tx,
            ty,
            radius: recRadius,
            life: 0,
            maxLife: 0.75,
          });
        }
      }
    }
    return restoredTotal;
  }

  canPlaceTower(world: VoidWorld, type: TowerTypeId, x: number, y: number, ignoreUid = -1): boolean {
    const spec = TOWER_SPECS[type];
    if (x < 1 || y < 1 || x + spec.w > world.grid.w - 1 || y + spec.h > world.grid.h - 1) {
      return false;
    }
    for (let py = y; py < y + spec.h; py++) {
      for (let px = x; px < x + spec.w; px++) {
        const idx = world.grid.index(px, py);
        const mat = world.material[idx];
        if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED) return false;
        const occ = world.towerAt[idx];
        if (occ >= 0 && occ !== ignoreUid) return false;
      }
    }
    return true;
  }

  placeTower(
    world: VoidWorld,
    type: TowerTypeId,
    x: number,
    y: number,
    paid: number,
    tick: number,
    tech: EvaluatedTech,
  ): PlacedTower | null {
    if (!this.canPlaceTower(world, type, x, y)) return null;
    const spec = TOWER_SPECS[type];
    const uid = this.nextTowerUid++;
    const tower: PlacedTower = {
      uid,
      type,
      x,
      y,
      w: spec.w,
      h: spec.h,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      paid,
      placedAtTick: tick,
      cooldown: 0.2,
    };
    for (let py = y; py < y + spec.h; py++) {
      for (let px = x; px < x + spec.w; px++) {
        world.towerAt[world.grid.index(px, py)] = uid;
      }
    }
    this.towers.push(tower);
    if (type === "shieldProjector") {
      this.shieldPools.set(uid, 120);
    }
    this.initTowerSpecialState(tower, tech);
    this.rebuildGravityMask(world);
    this.spawnInitialAgentsForTower(world, tower, tech);
    world.grid.markRectDirty({ x, y, w: spec.w, h: spec.h });
    return tower;
  }

  moveTower(world: VoidWorld, uid: number, newX: number, newY: number): boolean {
    const t = this.towers.find((tw) => tw.uid === uid);
    if (!t || !this.canPlaceTower(world, t.type, newX, newY, uid)) return false;
    for (let py = t.y; py < t.y + t.h; py++) {
      for (let px = t.x; px < t.x + t.w; px++) {
        world.towerAt[world.grid.index(px, py)] = -1;
      }
    }
    world.grid.markRectDirty({ x: t.x, y: t.y, w: t.w, h: t.h });
    t.x = newX;
    t.y = newY;
    const ncx = newX + t.w * 0.5;
    const ncy = newY + t.h * 0.5;
    const s = this.siphonStates.get(uid);
    if (s) { s.x = ncx; s.y = ncy; }
    const p = this.prismStates.get(uid);
    if (p) { p.x = ncx; p.y = ncy; }
    for (let py = t.y; py < t.y + t.h; py++) {
      for (let px = t.x; px < t.x + t.w; px++) {
        world.towerAt[world.grid.index(px, py)] = uid;
      }
    }
    this.rebuildGravityMask(world);
    world.grid.markRectDirty({ x: t.x, y: t.y, w: t.w, h: t.h });
    return true;
  }

  removeTower(world: VoidWorld, uid: number): PlacedTower | null {
    const idx = this.towers.findIndex((tw) => tw.uid === uid);
    if (idx < 0) return null;
    const [t] = this.towers.splice(idx, 1);
    for (let py = t.y; py < t.y + t.h; py++) {
      for (let px = t.x; px < t.x + t.w; px++) {
        if (world.towerAt[world.grid.index(px, py)] === uid) {
          world.towerAt[world.grid.index(px, py)] = -1;
        }
      }
    }
    this.shieldPools.delete(uid);
    this.clearTowerSpecialState(uid);
    // Remove agents belonging to this tower
    for (let i = this.agents.length - 1; i >= 0; i--) {
      if (this.agents[i].homeUid === uid) this.agents.splice(i, 1);
    }
    this.rebuildGravityMask(world);
    world.grid.markRectDirty({ x: t.x, y: t.y, w: t.w, h: t.h });
    return t;
  }

  private rebuildGravityMask(world: VoidWorld): void {
    this.gravityAnchorMask.fill(0);
    for (const t of this.towers) {
      if (t.type !== "gravityAnchor") continue;
      const cx = t.x + t.w * 0.5;
      const cy = t.y + t.h * 0.5;
      const r = TOWER_SPECS.gravityAnchor.range;
      const rCeil = Math.ceil(r);
      for (let y = Math.max(0, Math.floor(cy - rCeil)); y <= Math.min(world.grid.h - 1, Math.ceil(cy + rCeil)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rCeil)); x <= Math.min(world.grid.w - 1, Math.ceil(cx + rCeil)); x++) {
          if (dist(x - cx, y - cy) <= r) {
            this.gravityAnchorMask[world.grid.index(x, y)] = 1;
          }
        }
      }
    }
  }

  private spawnInitialAgentsForTower(world: VoidWorld, tower: PlacedTower, tech: EvaluatedTech): void {
    const cx = tower.x + tower.w * 0.5;
    const cy = tower.y + tower.h * 0.5;
    if (tower.type === "repairDepot" || tower.type === "constructorHub") {
      const count = tower.type === "constructorHub" ? 4 : 3;
      for (let i = 0; i < count; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "engineer",
          homeUid: tower.uid,
          x: cx + (i - 1) * 1.2,
          y: cy + 1.5,
          vx: 0,
          vy: 0,
          hp: 45,
          maxHp: 45,
          carryingMatter: 1,
          state: "idle",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: 0,
        });
      }
    } else if (tower.type === "infantryBarracks") {
      const count = 4 + tech.extraSquadSize;
      for (let i = 0; i < count; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "rifleman",
          layer: "ground",
          homeUid: tower.uid,
          x: cx + ((i % 3) - 1) * 1.3,
          y: cy + Math.floor(i / 3) * 1.3,
          vx: 0,
          vy: 0,
          hp: 40,
          maxHp: 40,
          carryingMatter: 0,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: (i * 0.15) % 0.6,
        });
      }
      if (tech.unlockedJetpack) {
        for (let i = 0; i < 2; i++) {
          this.agents.push({
            id: this.nextAgentId++,
            kind: "jetpack",
            layer: "air",
            homeUid: tower.uid,
            x: cx + (i === 0 ? -1.2 : 1.2),
            y: cy - 1.0,
            vx: 0,
            vy: 0,
            hp: 36,
            maxHp: 36,
            carryingMatter: 0,
            state: "patrol",
            targetCell: -1,
            targetNodeId: -1,
            cooldown: 0.2 * i,
          });
        }
      }
    } else if (tower.type === "lanternBearer") {
      for (let i = 0; i < 2; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "lanternBearer",
          layer: "ground",
          homeUid: tower.uid,
          x: cx + (i === 0 ? -1.0 : 1.0),
          y: cy + 1.0,
          vx: 0,
          vy: 0,
          hp: 65,
          maxHp: 65,
          carryingMatter: 0,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: 0,
        });
      }
    } else if (tower.type === "seamwalker") {
      for (let i = 0; i < 2; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "seamwalker",
          layer: "ground",
          homeUid: tower.uid,
          x: cx + (i === 0 ? -1.0 : 1.0),
          y: cy + 1.0,
          vx: 0,
          vy: 0,
          hp: 55,
          maxHp: 55,
          carryingMatter: 0,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: 0.3 * i,
        });
      }
    } else if (tower.type === "heavyMechBay") {
      const count = 2 + tech.extraMechCount;
      for (let i = 0; i < count; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "heavyMech",
          homeUid: tower.uid,
          x: cx + (i - 0.5) * 1.4,
          y: cy + 1.5,
          vx: 0,
          vy: 0,
          hp: 160,
          maxHp: 160,
          carryingMatter: 2,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: 0,
        });
      }
    } else if (tower.type === "wallSerpent") {
      this.agents.push({
        id: this.nextAgentId++,
        kind: "wallSerpent",
        homeUid: tower.uid,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        hp: 140,
        maxHp: 140,
        carryingMatter: 10,
        state: "patrol",
        targetCell: -1,
        targetNodeId: -1,
        cooldown: 0,
      });
    }
  }

  /** Adds a user-drawn polyline or closed-loop wall blueprint. */
  addWallBlueprint(world: VoidWorld, points: { x: number; y: number }[], loop = false): WallBlueprint | null {
    if (points.length < 2) return null;
    const cells: number[] = [];
    const seen = new Set<number>();
    const segCount = loop ? points.length : points.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const steps = Math.max(1, Math.ceil(dist(b.x - a.x, b.y - a.y) * 2));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
        const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
        if (!world.grid.inBounds(x, y)) continue;
        const idx = world.grid.index(x, y);
        if (!seen.has(idx)) {
          seen.add(idx);
          cells.push(idx);
        }
      }
    }
    if (cells.length === 0) return null;
    const bp: WallBlueprint = { id: this.nextBlueprintId++, points, loop, cells };
    this.blueprints.push(bp);
    return bp;
  }

  /** Casts a Strike ability at world coordinates `(tx, ty)`. */
  castStrike(
    world: VoidWorld,
    physics: VoidPhysics,
    voidField: VoidField,
    strike: StrikeId,
    tx: number,
    ty: number,
    tech: EvaluatedTech,
  ): boolean {
    if (!tech.unlockedStrikes.has(strike)) return false;
    if (this.strikeCooldowns[strike] > 0) return false;
    if (!world.grid.inBounds(Math.floor(tx), Math.floor(ty))) return false;

    const spec = STRIKE_SPECS[strike];

    if (strike === "landfall") {
      const res = physics.depositHearthseedIsland(world, tx, ty, tech.hearthseedRank, 1.15);
      if (res.createdCells === 0) return false;
      const r = pixels(4 + tech.hearthseedRank);
      const rCeil = Math.ceil(r) + 1;
      const { w, h } = world.grid;
      for (let y = Math.max(0, Math.floor(ty - rCeil)); y <= Math.min(h - 1, Math.ceil(ty + rCeil)); y++) {
        for (let x = Math.max(0, Math.floor(tx - rCeil)); x <= Math.min(w - 1, Math.ceil(tx + rCeil)); x++) {
          const idx = y * w + x;
          if (world.material[idx] !== CellMaterial.VOID) {
            voidField.lanternCreatedTemp[idx] = 0;
          }
        }
      }
      this.strikeCooldowns[strike] = spec.cooldownSeconds * tech.strikeCooldownMultiplier;
      voidField.rebuildFrontier(world);
      return true;
    }

    this.strikeCooldowns[strike] = spec.cooldownSeconds * tech.strikeCooldownMultiplier;

    if (strike === "quarantineBell") {
      voidField.addQuarantineSeal(
        world,
        tx,
        ty,
        spec.radius + pixels(tech.quarantineRadiusBonus),
        6.0 + tech.quarantineDurationBonus,
      );
      return true;
    }

    if (strike === "genesis") {
      const r = spec.radius;
      physics.depositMatterDisc(world, tx, ty, r, false, 1.3);
      // Outer ferrocrete ring
      const rCeil = Math.ceil(r);
      for (let y = Math.max(0, Math.floor(ty - rCeil)); y <= Math.min(world.grid.h - 1, Math.ceil(ty + rCeil)); y++) {
        for (let x = Math.max(0, Math.floor(tx - rCeil)); x <= Math.min(world.grid.w - 1, Math.ceil(tx + rCeil)); x++) {
          const d = dist(x - tx, y - ty);
          if (d >= r - 1.6 && d <= r) {
            const idx = world.grid.index(x, y);
            world.material[idx] = CellMaterial.WALL;
            world.hp[idx] = 180;
            world.maxHp[idx] = 180;
            world.grid.markIndexDirty(idx);
          }
        }
      }
      voidField.rebuildFrontier(world);
      return true;
    }

    if (strike === "containmentPulse") {
      const r = spec.radius;
      voidField.suppressedSeconds = Math.max(voidField.suppressedSeconds, 4.5);
      for (let i = voidField.nodes.length - 1; i >= 0; i--) {
        const n = voidField.nodes[i];
        if (dist(n.x - tx, n.y - ty) <= r) {
          voidField.nodes.splice(i, 1);
        }
      }
      for (let i = this.organisms.length - 1; i >= 0; i--) {
        const o = this.organisms[i];
        if (dist(o.x - tx, o.y - ty) <= r) {
          o.hp -= 120;
          if (o.hp <= 0) this.organisms.splice(i, 1);
        }
      }
      return true;
    }

    if (strike === "orbitalReinforcement") {
      physics.depositMatterDisc(world, tx, ty, spec.radius, true, 1.4);
      for (let i = 0; i < 4; i++) {
        this.agents.push({
          id: this.nextAgentId++,
          kind: "rifleman",
          homeUid: -1,
          x: tx + (i - 1.5) * 1.1,
          y: ty,
          vx: 0,
          vy: 0,
          hp: 65,
          maxHp: 65,
          carryingMatter: 0,
          state: "patrol",
          targetCell: -1,
          targetNodeId: -1,
          cooldown: 0,
        });
      }
      voidField.rebuildFrontier(world);
      return true;
    }

    if (strike === "seismicFrame") {
      const r = spec.radius;
      const rCeil = Math.ceil(r);
      for (let y = Math.max(0, Math.floor(ty - rCeil)); y <= Math.min(world.grid.h - 1, Math.ceil(ty + rCeil)); y++) {
        for (let x = Math.max(0, Math.floor(tx - rCeil)); x <= Math.min(world.grid.w - 1, Math.ceil(tx + rCeil)); x++) {
          if (dist(x - tx, y - ty) > r) continue;
          const idx = world.grid.index(x, y);
          if (world.material[idx] !== CellMaterial.VOID) {
            world.hp[idx] = world.maxHp[idx];
            voidField.cellMicroWork[idx] = 0;
            world.grid.markIndexDirty(idx);
          }
        }
      }
      return true;
    }

    return false;
  }

  /** Absorbs Void erosion work using nearby active `shieldProjector` pools. */
  absorbWorkWithShields(world: VoidWorld, cellIdx: number, workAmount: number, tech: EvaluatedTech): number {
    const cx = world.grid.xOf(cellIdx) + 0.5;
    const cy = world.grid.yOf(cellIdx) + 0.5;
    let absorbed = 0;
    const maxR = TOWER_SPECS.shieldProjector.range + pixels(tech.shieldExtraRadius);

    for (const t of this.towers) {
      if (t.type !== "shieldProjector") continue;
      const pool = this.shieldPools.get(t.uid) ?? 0;
      if (pool <= 0.1) continue;
      const tx = t.x + t.w * 0.5;
      const ty = t.y + t.h * 0.5;
      if (dist(cx - tx, cy - ty) <= maxR) {
        const take = Math.min(pool, workAmount - absorbed);
        this.shieldPools.set(t.uid, pool - take);
        absorbed += take;
        if (absorbed >= workAmount) break;
      }
    }
    return absorbed;
  }

  /** Steps towers, projectiles, autonomous agents, and cosmic organisms for one fixed tick. */
  step(
    world: VoidWorld,
    physics: VoidPhysics,
    voidField: VoidField,
    tick: number,
    dt: number,
    tech: EvaluatedTech,
    allowOrganisms: boolean,
  ): void {
    // 1. Cooldown strike timers
    for (const k of Object.keys(this.strikeCooldowns) as StrikeId[]) {
      if (this.strikeCooldowns[k] > 0) {
        this.strikeCooldowns[k] = Math.max(0, this.strikeCooldowns[k] - dt);
      }
    }

    // 1b. Apply falling-chunk impact damage to turrets, friendly units, and Void organisms
    if (physics.pendingImpacts.length > 0) {
      for (let k = 0; k < physics.pendingImpacts.length; k++) {
        const imp = physics.pendingImpacts[k];
        for (let i = 0; i < this.towers.length; i++) {
          const t = this.towers[i];
          const nx = Math.max(t.x, Math.min(imp.x, t.x + t.w));
          const ny = Math.max(t.y, Math.min(imp.y, t.y + t.h));
          if (dist(imp.x - nx, imp.y - ny) <= imp.radius) {
            t.hp -= Math.round(imp.damage * CHUNK_TOWER_DAMAGE_SCALE);
          }
        }
        for (let i = this.agents.length - 1; i >= 0; i--) {
          const a = this.agents[i];
          if (a.layer === "air") continue; // Ground-only chunk impact ignores airborne jetpack troops
          if (dist(a.x - imp.x, a.y - imp.y) <= imp.radius + 1.0) {
            a.hp -= imp.damage;
            if (a.hp <= 0) {
              if (a.kind === "lanternBearer") {
                voidField.releaseLanternCoverage(world, a.x, a.y, pixels(2));
              }
              this.agents.splice(i, 1);
            }
          }
        }
        for (let i = this.organisms.length - 1; i >= 0; i--) {
          const o = this.organisms[i];
          if (dist(o.x - imp.x, o.y - imp.y) <= imp.radius + 2.5) {
            o.hp -= imp.damage;
            if (o.hp <= 0) {
              this.organisms.splice(i, 1);
            }
          }
        }
      }
      physics.pendingImpacts.length = 0;
    }

    // 2. Check if any tower sits on Void and destroy it (spawning a falling tower chunk into the abyss)
    for (let i = this.towers.length - 1; i >= 0; i--) {
      const t = this.towers[i];
      let voided = 0;
      let vxSum = 0;
      let vySum = 0;
      const cx = t.x + t.w * 0.5;
      const cy = t.y + t.h * 0.5;
      for (let py = t.y; py < t.y + t.h; py++) {
        for (let px = t.x; px < t.x + t.w; px++) {
          if (world.material[world.grid.index(px, py)] === CellMaterial.VOID) {
            voided++;
            vxSum += px + 0.5 - cx;
            vySum += py + 0.5 - cy;
          }
        }
      }
      if (voided > (t.w * t.h) / 2 || t.hp <= 0) {
        const spec = TOWER_SPECS[t.type];
        const enemyCaused = t.hp <= 0;
        // Echo Mine: enemy-caused destruction triggers one telegraphed blast (selling/void-collapse without enemy does not)
        if (t.type === "echoMine" && enemyCaused) {
          const blastRadius = pixels(6 + tech.echoBlastRadiusBonus);
          const blastDamage = 95 * tech.echoBlastDamageMult;
          for (let oi = this.organisms.length - 1; oi >= 0; oi--) {
            const org = this.organisms[oi];
            if (dist(org.x - cx, org.y - cy) <= blastRadius) {
              org.hp -= blastDamage;
              if (org.hp <= 0) this.organisms.splice(oi, 1);
            }
          }
          if (tech.echoPersistent) {
            this.persistentEchoes.push({
              x: cx,
              y: cy,
              remaining: 3.0,
              radius: pixels(10 + tech.echoLureRadiusBonus),
            });
          }
          if (physics.shockwaves.length < 48) {
            physics.shockwaves.push({
              x: cx,
              y: cy,
              maxRadius: blastRadius,
              color: "#e87ea1",
              secondaryColor: "#ffd166",
              life: 0,
              maxLife: 0.45,
            });
          }
        }
        const vLen = Math.max(0.5, dist(vxSum, vySum));
        physics.spawnFallingChunk(
          Math.floor(cx),
          Math.floor(cy),
          2,
          (vxSum / vLen) * 3.5,
          (vySum / vLen) * 3.5,
          0,
          t.w,
          t.h,
          spec.color,
          "#242c3a",
          "void",
        );
        for (const ag of this.agents) {
          if (ag.homeUid === t.uid && ag.kind === "lanternBearer") {
            voidField.releaseLanternCoverage(world, ag.x, ag.y, pixels(2));
          }
        }
        this.removeTower(world, t.uid);
      }
    }

    // 3. Step towers (Matter Cannon, Rocket Team, Shield Projector regeneration)
    for (const t of this.towers) {
      if (t.type === "shieldProjector") {
        const cur = this.shieldPools.get(t.uid) ?? 0;
        this.shieldPools.set(t.uid, Math.min(180, cur + 14 * tech.shieldRegenMultiplier * dt));
        continue;
      }

      if (t.type === "matterCannon" || t.type === "rocketTeam") {
        t.cooldown -= dt * (t.type === "matterCannon" ? tech.matterCannonSpeedMultiplier : 1);
        if (t.cooldown <= 0) {
          const spec = TOWER_SPECS[t.type];
          t.cooldown = spec.cooldownSeconds;
          const cx = t.x + t.w * 0.5;
          const cy = t.y + t.h * 0.5;
          const target = this.pickFrontierTargetNear(
            world,
            voidField,
            t.focus?.x ?? cx,
            t.focus?.y ?? cy,
            spec.range,
            tick + t.uid,
          );
          if (target) {
            this.pellets.push({
              x: cx,
              y: cy,
              tx: target.x,
              ty: target.y,
              progress: 0,
              duration: Math.max(0.25, dist(target.x - cx, target.y - cy) / pixels(48)),
              radius: pixels(t.type === "rocketTeam" ? 3.2 : 2.3 * tech.matterCannonDensityMultiplier),
              wallPayload: t.type === "rocketTeam",
              strength: tech.matterCannonDensityMultiplier,
            });
          }
        }
      }
    }

    // 4. Advance matter pellets in flight
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      p.progress += dt / p.duration;
      if (p.progress >= 1) {
        physics.depositMatterDisc(world, p.tx, p.ty, p.radius, p.wallPayload, p.strength);
        this.pellets.splice(i, 1);
      }
    }

    // 5. Decay short-lived laser beams
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      this.lasers[i].ttl -= dt;
      if (this.lasers[i].ttl <= 0) this.lasers.splice(i, 1);
    }

    // 6. Step autonomous agents (engineers, riflemen, mechs, wall serpents)
    this.stepAgents(world, physics, voidField, tick, dt, tech);

    // 6b. Step Void Siphon vent cycles and Chrono Cannon rewind
    this.stepSiphonTimers(dt);
    this.stepChronoCannons(world, voidField, dt, tick * dt, tech);
    for (let i = this.chronoEffects.length - 1; i >= 0; i--) {
      this.chronoEffects[i].life += dt;
      if (this.chronoEffects[i].life >= this.chronoEffects[i].maxLife) {
        this.chronoEffects.splice(i, 1);
      }
    }

    // 7. Step cosmic Void organisms (Worms, Spiders, Blooms, Queen/Bees)
    for (let i = this.persistentEchoes.length - 1; i >= 0; i--) {
      this.persistentEchoes[i].remaining -= dt;
      if (this.persistentEchoes[i].remaining <= 0) this.persistentEchoes.splice(i, 1);
    }
    if (allowOrganisms || this.organisms.length > 0) {
      this.stepOrganisms(world, physics, voidField, tick, dt, tech);
    }
  }

  private pickFrontierTargetNear(
    world: VoidWorld,
    voidField: VoidField,
    cx: number,
    cy: number,
    maxRange: number,
    salt: number,
  ): { x: number; y: number; cellIdx: number } | null {
    if (voidField.frontierCells.length === 0) return null;
    let bestCell = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    const step = Math.max(1, Math.floor(voidField.frontierCells.length / pixels(48)));
    const offset = salt % step;

    for (let i = offset; i < voidField.frontierCells.length; i += step) {
      const cIdx = voidField.frontierCells[i];
      const fx = world.grid.xOf(cIdx) + 0.5;
      const fy = world.grid.yOf(cIdx) + 0.5;
      const d = dist(fx - cx, fy - cy);
      if (d <= maxRange && d < bestScore) {
        bestScore = d;
        bestCell = cIdx;
      }
    }
    if (bestCell < 0) return null;
    return {
      x: world.grid.xOf(bestCell) + 0.5,
      y: world.grid.yOf(bestCell) + 0.5,
      cellIdx: bestCell,
    };
  }

  private stepAgents(
    world: VoidWorld,
    physics: VoidPhysics,
    voidField: VoidField,
    tick: number,
    dt: number,
    tech: EvaluatedTech,
  ): void {
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      if (a.hp <= 0) {
        if (a.kind === "lanternBearer") voidField.releaseLanternCoverage(world, a.x, a.y, pixels(2));
        this.agents.splice(i, 1);
        continue;
      }
      const cellX = Math.floor(a.x);
      const cellY = Math.floor(a.y);
      if (!world.grid.inBounds(cellX, cellY)) {
        this.agents.splice(i, 1);
        continue;
      }
      const underMat = world.material[world.grid.index(cellX, cellY)];
      if (underMat === CellMaterial.VOID && a.kind !== "wallSerpent" && a.layer !== "air" && a.kind !== "lanternBearer") {
        // Tactical retreat if unlocked, else take Void damage
        if (tech.tacticalRetreat) {
          const home = this.towers.find((t) => t.uid === a.homeUid);
          if (home) {
            const dx = home.x + TOWER_SPECS[home.type].w / 2 - a.x;
            const dy = home.y + TOWER_SPECS[home.type].h / 2 - a.y;
            const d = Math.max(0.1, dist(dx, dy));
            a.x += (dx / d) * pixels(12) * dt;
            a.y += (dy / d) * pixels(12) * dt;
          }
        }
        a.hp -= 18 * dt;
        if (a.hp <= 0) {
          const aColor =
            a.kind === "engineer"
              ? "#ffd15c"
              : a.kind === "heavyMech"
                ? "#7afcff"
                : "#ff7b24";
          physics.spawnFallingChunk(
            cellX,
            cellY,
            1,
            a.vx * 0.25,
            a.vy * 0.25,
            0,
            a.kind === "heavyMech" ? 2 : 1,
            a.kind === "engineer" || a.kind === "heavyMech" ? 2 : 1,
            aColor,
            "#ff42b8",
            "void",
          );
          this.recordChronoLoss(
            tick * dt,
            "unit",
            a.x,
            a.y,
            world.grid.index(cellX, cellY),
            CellMaterial.VOID,
            0,
            -1,
            0,
            a.kind,
            a.homeUid,
            a.id,
            a.maxHp * 0.65,
            a.maxHp,
          );
          this.agents.splice(i, 1);
          continue;
        }
      }

      if (a.kind === "wallSerpent") {
        this.stepWallSerpent(world, physics, voidField, a, tick, dt, tech);
      } else if (a.kind === "engineer") {
        this.stepEngineer(world, physics, a, tick, dt, tech);
      } else if (a.kind === "lanternBearer") {
        this.stepLanternBearer(world, voidField, a, tick, dt);
      } else if (a.kind === "seamwalker") {
        this.stepSeamwalker(world, voidField, a, tick, dt);
      } else {
        this.stepCombatAgent(world, voidField, a, tick, dt, tech);
      }
    }
  }

  private stepWallSerpent(
    world: VoidWorld,
    physics: VoidPhysics,
    voidField: VoidField,
    a: Agent,
    tick: number,
    dt: number,
    tech: EvaluatedTech,
  ): void {
    const target = this.pickFrontierTargetNear(world, voidField, a.x, a.y, pixels(60), tick + a.id);
    if (target) {
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const d = Math.max(0.1, dist(dx, dy));
      // Orbit/slither along frontier tangent when close
      const ux = d < pixels(3.5) ? -dy / d : dx / d;
      const uy = d < pixels(3.5) ? dx / d : dy / d;
      const spd = pixels(9.5) * tech.serpentSpeedMultiplier;
      a.x = Math.max(2, Math.min(world.grid.w - 3, a.x + ux * spd * dt));
      a.y = Math.max(2, Math.min(world.grid.h - 3, a.y + uy * spd * dt));
    }
    a.cooldown -= dt;
    if (a.cooldown <= 0) {
      a.cooldown = 0.22;
      physics.depositMatterDisc(world, a.x, a.y, pixels(1.35) * tech.serpentSpeedMultiplier, true, 1.2);
    }
  }

  private stepEngineer(
    world: VoidWorld,
    physics: VoidPhysics,
    a: Agent,
    tick: number,
    dt: number,
    tech: EvaluatedTech,
  ): void {
    const speed = pixels(10.5) * tech.masonSpeedMultiplier;
    const home = this.towers.find((t) => t.uid === a.homeUid);
    const anchorX = home?.focus?.x ?? (home ? home.x + TOWER_SPECS[home.type].w / 2 : a.x);
    const anchorY = home?.focus?.y ?? (home ? home.y + TOWER_SPECS[home.type].h / 2 : a.y);

    if (a.carryingMatter <= 0 && !tech.matterSynthesis) {
      // Return to home depot or salvage cell to pick up matter
      if (home) {
        const hx = home.x + TOWER_SPECS[home.type].w / 2;
        const hy = home.y + TOWER_SPECS[home.type].h / 2;
        const d = dist(hx - a.x, hy - a.y);
        if (d <= pixels(2.2)) {
          a.carryingMatter = 1;
        } else {
          a.x += ((hx - a.x) / d) * speed * dt;
          a.y += ((hy - a.y) / d) * speed * dt;
        }
      } else {
        a.carryingMatter = 1;
      }
      return;
    }

    // 1. Check user-drawn wall blueprints needing construction first
    for (const bp of this.blueprints) {
      for (const cIdx of bp.cells) {
        if (world.material[cIdx] !== CellMaterial.WALL || world.hp[cIdx] < 120) {
          const tx = world.grid.xOf(cIdx) + 0.5;
          const ty = world.grid.yOf(cIdx) + 0.5;
          const d = dist(tx - a.x, ty - a.y);
          if (d <= pixels(1.8)) {
            physics.depositMatterDisc(world, tx, ty, pixels(1.1), true, tech.masonRepairMultiplier);
            if (!tech.matterSynthesis) a.carryingMatter = 0;
            return;
          }
          if (d <= pixels(48)) {
            a.x += ((tx - a.x) / d) * speed * dt;
            a.y += ((ty - a.y) / d) * speed * dt;
            return;
          }
        }
      }
    }

    // 2. Find a damaged cell or an intact building to develop near anchor
    if (a.targetCell < 0 || tick % 30 === 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      const r = pixels(28);
      for (let sample = 0; sample < 24; sample++) {
        const ox = Math.round((hash01(world.seed, a.id, tick, sample) - 0.5) * r * 2);
        const oy = Math.round((hash01(world.seed, a.id + 99, tick, sample) - 0.5) * r * 2);
        const cx = Math.floor(anchorX + ox);
        const cy = Math.floor(anchorY + oy);
        if (!world.grid.inBounds(cx, cy)) continue;
        const idx = world.grid.index(cx, cy);
        const mat = world.material[idx];
        if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED) continue;
        const hpDeficit = world.maxHp[idx] - world.hp[idx];
        let score = hpDeficit * 2;
        const bId = world.buildingAt[idx];
        if (bId >= 0) {
          const b = world.buildings[bId];
          if (physics.isBrinkBuilding(bId)) score += 90;
          if (tech.strategicMasonry && b?.isSkyscraper) score += 60;
          if (hpDeficit === 0 && b && b.development < tech.maxDevelopmentCeiling) {
            score += 25;
          }
        }
        if (score > 0 && score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
      a.targetCell = bestIdx;
    }

    if (a.targetCell >= 0) {
      const tx = world.grid.xOf(a.targetCell) + 0.5;
      const ty = world.grid.yOf(a.targetCell) + 0.5;
      const d = dist(tx - a.x, ty - a.y);
      if (d <= pixels(1.8)) {
        const idx = a.targetCell;
        const bId = world.buildingAt[idx];
        if (bId >= 0) {
          // Shore up the building to slow brink spalling and extend cantilever support
          physics.shoreBuilding(bId, tick + 180);
        }
        if (world.hp[idx] < world.maxHp[idx]) {
          world.hp[idx] = Math.min(world.maxHp[idx], world.hp[idx] + Math.round(45 * tech.masonRepairMultiplier));
          world.grid.markIndexDirty(idx);
        } else if (bId >= 0) {
          const b = world.buildings[bId];
          if (b && b.development < tech.maxDevelopmentCeiling) {
            b.development = Math.min(tech.maxDevelopmentCeiling, b.development + 0.08 * tech.masonRepairMultiplier);
            world.grid.markIndexDirty(idx);
          }
        }
        if (!tech.matterSynthesis) a.carryingMatter = 0;
        a.targetCell = -1;
      } else {
        a.x += ((tx - a.x) / d) * speed * dt;
        a.y += ((ty - a.y) / d) * speed * dt;
      }
    }
  }

  private stepLanternBearer(
    world: VoidWorld,
    voidField: VoidField,
    a: Agent,
    tick: number,
    dt: number,
  ): void {
    const covR = pixels(2);
    // Release previous footing, move toward focus or frontier (including into Void), then re-apply atomically
    voidField.releaseLanternCoverage(world, a.x, a.y, covR);
    const home = this.towers.find((t) => t.uid === a.homeUid);
    const tx = home?.focus?.x ?? (home ? home.x + TOWER_SPECS[home.type].w * 0.5 : a.x);
    const ty = home?.focus?.y ?? (home ? home.y + TOWER_SPECS[home.type].h * 0.5 : a.y);
    const dx = tx - a.x;
    const dy = ty - a.y;
    const d = dist(dx, dy);
    if (d > 1.2) {
      const spd = pixels(8.5);
      a.x = Math.max(2, Math.min(world.grid.w - 3, a.x + (dx / d) * spd * dt));
      a.y = Math.max(2, Math.min(world.grid.h - 3, a.y + (dy / d) * spd * dt));
    } else if (voidField.frontierCells.length > 0 && tick % 2 === 0) {
      const target = this.pickFrontierTargetNear(world, voidField, a.x, a.y, pixels(16), tick + a.id);
      if (target) {
        const fdx = target.x - a.x;
        const fdy = target.y - a.y;
        const fd = Math.max(0.1, dist(fdx, fdy));
        const spd = pixels(6.0);
        a.x = Math.max(2, Math.min(world.grid.w - 3, a.x + (fdx / fd) * spd * dt));
        a.y = Math.max(2, Math.min(world.grid.h - 3, a.y + (fdy / fd) * spd * dt));
      }
    }
    voidField.applyLanternCoverage(world, a.x, a.y, covR);
    // Lantern Bearers never attack.
  }

  private stepSeamwalker(
    world: VoidWorld,
    voidField: VoidField,
    a: Agent,
    tick: number,
    dt: number,
  ): void {
    const home = this.towers.find((t) => t.uid === a.homeUid);
    const focusX = home?.focus?.x ?? (home ? home.x + TOWER_SPECS[home.type].w * 0.5 : a.x);
    const focusY = home?.focus?.y ?? (home ? home.y + TOWER_SPECS[home.type].h * 0.5 : a.y);
    const range = pixels(11);
    const target = this.pickFrontierTargetNear(world, voidField, focusX, focusY, pixels(28), tick + a.id);
    a.cooldown = Math.max(0, a.cooldown - dt);

    if (target) {
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const d = Math.max(0.1, dist(dx, dy));
      if (d > range * 0.75) {
        const spd = pixels(9.5);
        const nx = Math.max(2, Math.min(world.grid.w - 3, a.x + (dx / d) * spd * dt));
        const ny = Math.max(2, Math.min(world.grid.h - 3, a.y + (dy / d) * spd * dt));
        if (world.material[world.grid.index(Math.floor(nx), Math.floor(ny))] !== CellMaterial.VOID) {
          a.x = nx;
          a.y = ny;
        }
      }
      if (d <= range && a.cooldown <= 0) {
        a.cooldown = 0.75;
        // Find adjacent Void neighbor of this frontier cell to staple/freeze
        const fx = world.grid.xOf(target.cellIdx);
        const fy = world.grid.yOf(target.cellIdx);
        let frozenAny = false;
        for (const [ox, oy] of ORTHO) {
          const vx = fx + ox;
          const vy = fy + oy;
          if (!world.grid.inBounds(vx, vy)) continue;
          const vIdx = world.grid.index(vx, vy);
          if (world.material[vIdx] === CellMaterial.VOID) {
            voidField.freezeVoidCell(vIdx, 2.0);
            frozenAny = true;
          }
        }
        if (frozenAny) {
          voidField.rebuildFrontier(world);
          if (this.lasers.length < 180) {
            this.lasers.push({
              x0: a.x,
              y0: a.y,
              x1: target.x,
              y1: target.y,
              ttl: 0.16,
              color: "#f29d38",
            });
          }
        }
      }
    }
  }

  private stepCombatAgent(
    world: VoidWorld,
    voidField: VoidField,
    a: Agent,
    tick: number,
    dt: number,
    tech: EvaluatedTech,
  ): void {
    const isMech = a.kind === "heavyMech";
    const isJetpack = a.kind === "jetpack";
    const speed = pixels(isMech ? 8.5 : isJetpack ? 14.5 : 11.5);
    const range = pixels(isMech ? 16 : isJetpack ? 14 : 13) * tech.rifleRangeMultiplier;
    const damage = (isMech ? 28 * tech.mechDamageMultiplier : isJetpack ? 16 : 11) * tech.rifleDamageMultiplier;

    const home = this.towers.find((t) => t.uid === a.homeUid);
    const focusX = home?.focus?.x ?? (home ? home.x + TOWER_SPECS[home.type].w / 2 : a.x);
    const focusY = home?.focus?.y ?? (home ? home.y + TOWER_SPECS[home.type].h / 2 : a.y);

    a.cooldown = Math.max(0, a.cooldown - dt);

    // 1. Prioritize cosmic organisms or crystalline Void Nodes in range
    let targetX = -1;
    let targetY = -1;
    let hitOrganism: VoidOrganism | undefined;
    let hitNodeIdx = -1;

    for (const org of this.organisms) {
      const d = dist(org.x - a.x, org.y - a.y);
      if (d <= range) {
        hitOrganism = org;
        targetX = org.x;
        targetY = org.y;
        break;
      }
    }

    if (!hitOrganism && !isJetpack) {
      for (let nIdx = 0; nIdx < voidField.nodes.length; nIdx++) {
        const node = voidField.nodes[nIdx];
        const d = dist(node.x - a.x, node.y - a.y);
        if (d <= range) {
          hitNodeIdx = nIdx;
          targetX = node.x;
          targetY = node.y;
          break;
        }
      }
    }

    // 2. Otherwise target nearest active Void frontier cell (Jetpack troops attack organisms only!)
    let frontierTarget: { x: number; y: number; cellIdx: number } | null = null;
    if (!hitOrganism && hitNodeIdx < 0 && !isJetpack) {
      frontierTarget = this.pickFrontierTargetNear(world, voidField, focusX, focusY, pixels(36), tick + a.id);
      if (frontierTarget) {
        targetX = frontierTarget.x;
        targetY = frontierTarget.y;
      }
    } else if (!hitOrganism && isJetpack && this.organisms.length > 0) {
      // Jetpack flies directly toward nearest organism over any Void/holes
      let bestOrg = this.organisms[0];
      let bestD = dist(bestOrg.x - a.x, bestOrg.y - a.y);
      for (let oi = 1; oi < this.organisms.length; oi++) {
        const od = dist(this.organisms[oi].x - a.x, this.organisms[oi].y - a.y);
        if (od < bestD) {
          bestD = od;
          bestOrg = this.organisms[oi];
        }
      }
      targetX = bestOrg.x;
      targetY = bestOrg.y;
    }

    if (targetX >= 0) {
      const d = dist(targetX - a.x, targetY - a.y);
      if (d <= range && a.cooldown <= 0) {
        a.cooldown = isMech ? 0.45 : 0.55;
        if (this.lasers.length < 180) {
          this.lasers.push({
            x0: a.x,
            y0: a.y,
            x1: targetX,
            y1: targetY,
            ttl: 0.14,
            color: isMech ? "#ffaa33" : "#ff6b2b",
            energy: true,
          });
        }
        if (hitOrganism) {
          hitOrganism.hp -= damage;
          if (hitOrganism.hp <= 0) {
            const oIdx = this.organisms.indexOf(hitOrganism);
            if (oIdx >= 0) this.organisms.splice(oIdx, 1);
            voidField.totalWorkResisted += 45;
          }
        } else if (hitNodeIdx >= 0) {
          const node = voidField.nodes[hitNodeIdx];
          node.hp -= damage;
          if (node.hp <= 0) {
            voidField.nodes.splice(hitNodeIdx, 1);
            voidField.totalWorkResisted += 35;
          }
        } else if (frontierTarget) {
          voidField.applyAntiVoidAblation(world, frontierTarget.cellIdx, damage);
        }
      } else if (d > range * 0.8) {
        a.x = Math.max(1, Math.min(world.grid.w - 2, a.x + ((targetX - a.x) / d) * speed * dt));
        a.y = Math.max(1, Math.min(world.grid.h - 2, a.y + ((targetY - a.y) / d) * speed * dt));
      } else if (tech.tacticalRetreat && d < pixels(3.5)) {
        // Kite away from immediate Void edge while firing
        a.x = Math.max(1, Math.min(world.grid.w - 2, a.x - ((targetX - a.x) / d) * speed * 0.7 * dt));
        a.y = Math.max(1, Math.min(world.grid.h - 2, a.y - ((targetY - a.y) / d) * speed * 0.7 * dt));
      }
    } else {
      // Move toward focus point
      const d = dist(focusX - a.x, focusY - a.y);
      if (d > pixels(3.0)) {
        a.x += ((focusX - a.x) / d) * speed * 0.65 * dt;
        a.y += ((focusY - a.y) / d) * speed * 0.65 * dt;
      }
    }
  }

  /** Spawns and steps Phase 14 cosmic Void organisms (Worms, Spiders, Blooms, Queen/Bees),
   * funded directly out of the Void's finite energy reservoir. */
  private stepOrganisms(
    world: VoidWorld,
    physics: VoidPhysics,
    voidField: VoidField,
    tick: number,
    dt: number,
    tech?: EvaluatedTech,
  ): void {
    // Spawn schedule every 12 seconds if energy permits
    if (tick > 0 && tick % 360 === 0 && this.organisms.length < 24 && voidField.energyRemaining > 350) {
      const activePortals = world.portals.filter((p) => p.active);
      if (activePortals.length > 0) {
        const p = activePortals[tick % activePortals.length];
        const kinds: OrganismKind[] = [
          "nebulaWorm",
          "constellationSpider",
          "voidBloom",
          "nebulaQueen",
          "honeycombCrystal",
          ...(tick >= 1080 ? (["nexusCrystal"] as OrganismKind[]) : []),
        ];
        const kind = kinds[Math.floor(hash01(world.seed, 909, tick) * kinds.length)];
        const maxHp =
          kind === "nebulaQueen"
            ? 260
            : kind === "nexusCrystal"
              ? 220
              : kind === "honeycombCrystal"
                ? 170
                : kind === "nebulaWorm"
                  ? 150
                  : 110;
        const ox =
          kind === "honeycombCrystal" || kind === "nexusCrystal"
            ? Math.max(4, Math.min(world.grid.w - 5, p.x + Math.round((hash01(world.seed, 910, tick) - 0.5) * 14)))
            : p.x;
        const oy =
          kind === "honeycombCrystal" || kind === "nexusCrystal"
            ? Math.max(4, Math.min(world.grid.h - 5, p.y + Math.round((hash01(world.seed, 911, tick) - 0.5) * 14)))
            : p.y;
        this.organisms.push({
          id: this.nextOrganismId++,
          kind,
          x: ox,
          y: oy,
          vx: 0,
          vy: 0,
          hp: maxHp,
          maxHp,
          targetX: world.grid.w * 0.5,
          targetY: world.grid.h * 0.5,
          cooldown: 1.5,
          ...(kind === "nebulaWorm" ? { trail: [{ x: ox, y: oy }] } : {}),
        });
        voidField.energyRemaining = Math.max(0, voidField.energyRemaining - 120);
      }
    }

    // Check if an active Nexus Crystal exists to coordinate organism targeting toward observed towers
    const activeNexus = this.organisms.find((org) => org.kind === "nexusCrystal");

    for (let i = this.organisms.length - 1; i >= 0; i--) {
      const o = this.organisms[i];
      const isStationaryCrystal = o.kind === "honeycombCrystal" || o.kind === "nexusCrystal";

      // Retarget: Echo Mine lure (bounded simultaneous target budget, short re-evaluation) -> tower -> frontier
      if (!isStationaryCrystal && tick % 15 === 0) {
        let lured = false;
        const lureRadius = pixels(10 + (tech?.echoLureRadiusBonus ?? 0));
        const maxTargets = 5 + (tech?.echoTargetCapBonus ?? 0);
        for (const t of this.towers) {
          if (t.type !== "echoMine") continue;
          const ecx = t.x + t.w * 0.5;
          const ecy = t.y + t.h * 0.5;
          if (dist(o.x - ecx, o.y - ecy) <= lureRadius) {
            // Count how many organisms are already lured to this mine
            let curLured = 0;
            for (const other of this.organisms) {
              if (other.lureUid === t.uid && other.id !== o.id) curLured++;
            }
            if (curLured < maxTargets) {
              o.lureUid = t.uid;
              o.lureUntilTick = tick + (o.kind === "nebulaQueen" ? 30 : 90);
              o.targetX = ecx;
              o.targetY = ecy;
              lured = true;
              break;
            }
          }
        }
        if (!lured && this.persistentEchoes.length > 0) {
          for (const pe of this.persistentEchoes) {
            if (dist(o.x - pe.x, o.y - pe.y) <= pe.radius) {
              o.targetX = pe.x;
              o.targetY = pe.y;
              lured = true;
              break;
            }
          }
        }
        if (!lured && tick % 45 === 0) {
          if ((o.kind === "constellationSpider" || activeNexus) && this.towers.length > 0) {
            // Spiders and Nexus-coordinated organisms hunt observed Repair Depots and towers within 70 cells of Void
            let bestT: PlacedTower | null = null;
            let bestD = Infinity;
            for (const t of this.towers) {
              const d = dist(t.x - o.x, t.y - o.y);
              if (d > pixels(85)) continue;
              const weight = t.type === "repairDepot" ? 0.5 : 1.0;
              if (d * weight < bestD) {
                bestD = d * weight;
                bestT = t;
              }
            }
            if (bestT) {
              o.targetX = bestT.x + TOWER_SPECS[bestT.type].w / 2;
              o.targetY = bestT.y + TOWER_SPECS[bestT.type].h / 2;
            }
          } else if (voidField.frontierCells.length > 0) {
            const pick = voidField.frontierCells[(tick + o.id * 17) % voidField.frontierCells.length];
            o.targetX = world.grid.xOf(pick) + 0.5;
            o.targetY = world.grid.yOf(pick) + 0.5;
          }
        }
      }

      if (!isStationaryCrystal) {
        const dx = o.targetX - o.x;
        const dy = o.targetY - o.y;
        const d = Math.max(0.1, dist(dx, dy));
        const speed = pixels(o.kind === "voidBee" ? 15 : o.kind === "constellationSpider" ? 9 : o.kind === "nebulaWorm" ? 7.5 : 4.5);
        o.x = Math.max(2, Math.min(world.grid.w - 3, o.x + (dx / d) * speed * dt));
        o.y = Math.max(2, Math.min(world.grid.h - 3, o.y + (dy / d) * speed * dt));
      }

      if (o.trail && tick % 4 === 0) {
        o.trail.unshift({ x: o.x, y: o.y });
        if (o.trail.length > 8) o.trail.pop();
      }

      o.cooldown -= dt;
      if (o.cooldown <= 0) {
        o.cooldown =
          o.kind === "nebulaQueen"
            ? 4.5
            : o.kind === "honeycombCrystal"
              ? 6.0
              : o.kind === "nexusCrystal"
                ? 3.0
                : 1.2;
        if ((o.kind === "nebulaQueen" || o.kind === "honeycombCrystal") && this.organisms.length < 32) {
          // Queen or Honeycomb Crystal spawns swarming 1-pixel Void Bees
          const beeCount = o.kind === "nebulaQueen" ? 2 : 1;
          for (let b = 0; b < beeCount; b++) {
            this.organisms.push({
              id: this.nextOrganismId++,
              kind: "voidBee",
              x: o.x + (b === 0 ? -1 : 1),
              y: o.y,
              vx: 0,
              vy: 0,
              hp: 25,
              maxHp: 25,
              targetX: o.targetX,
              targetY: o.targetY,
              cooldown: 0.6,
              parentId: o.id,
            });
          }
          // Queen also establishes a Honeycomb Crystal occasionally if few exist
          if (
            o.kind === "nebulaQueen" &&
            this.organisms.filter((x) => x.kind === "honeycombCrystal").length < 3 &&
            hash01(world.seed, o.id, tick) < 0.35
          ) {
            this.organisms.push({
              id: this.nextOrganismId++,
              kind: "honeycombCrystal",
              x: o.x,
              y: o.y,
              vx: 0,
              vy: 0,
              hp: 160,
              maxHp: 160,
              targetX: o.targetX,
              targetY: o.targetY,
              cooldown: 5.0,
              parentId: o.id,
            });
          }
        } else if (o.kind !== "nexusCrystal") {
          // Flying organisms (voidBee, nebulaQueen) can attack airborne jetpack soldiers; ground organisms cannot
          const canHitAir = o.kind === "voidBee" || o.kind === "nebulaQueen" || o.canTargetAir === true;
          let hitAir = false;
          if (canHitAir) {
            for (let ai = this.agents.length - 1; ai >= 0; ai--) {
              const ag = this.agents[ai];
              if (ag.layer !== "air") continue;
              if (dist(ag.x - o.x, ag.y - o.y) <= pixels(4.5)) {
                ag.hp -= 12;
                hitAir = true;
                if (ag.hp <= 0) this.agents.splice(ai, 1);
                break;
              }
            }
          }
          if (!hitAir) {
            // Erode cell under organism or damage adjacent tower
            const cx = Math.floor(o.x);
            const cy = Math.floor(o.y);
            if (world.grid.inBounds(cx, cy)) {
              const idx = world.grid.index(cx, cy);
              const tUid = world.towerAt[idx];
              if (tUid >= 0) {
                const tw = this.towers.find((t) => t.uid === tUid);
                if (tw) tw.hp -= 22;
              } else if (world.material[idx] !== CellMaterial.VOID && voidField.lanternRefCount[idx] === 0) {
                if (world.hp[idx] <= 35) {
                  physics.consumeCellIntoVoid(world, idx, true);
                } else {
                  world.hp[idx] -= 35;
                  world.grid.markIndexDirty(idx);
                }
              }
            }
          }
        }
      }
    }
  }
}
