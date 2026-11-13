/** Finite-energy, perimeter-budget Void field simulation for Void Defense.
 *
 * Key mechanics & invariants:
 * 1. Global Reservoir (`energyRemaining`) vs Instantaneous Tick Budget (`workAvailable`):
 *    Each fixed tick, the Void draws `workAvailable = min(energyRemaining, growthRate * dt)`
 *    and distributes it across ALL active frontier contact edges (`Void` orthogonally
 *    touching non-Void matter).
 * 2. Sacrificial Land Island Diversion:
 *    Because `workAvailable` is divided across all active frontier edges, casting a
 *    sacrificial land island inside the Void increases total perimeter and slows local
 *    erosion along the city boundary.
 * 3. Deterministic Fractional-Work Conservation:
 *    Uses integer micro-work (`WORK_SCALE = 1000`) and a remainder accumulator so
 *    even across a huge perimeter, zero work is lost to floating-point rounding and
 *    results are independent of chunk boundaries.
 * 4. Explicit Zero-Contact Resolution States:
 *    - `cityConsumedDefeat`: all scorable baseline city/land is gone (`preservedValue == 0`).
 *    - `reservoirDepletedVictory`: finite reservoir reaches 0 while scorable city survives.
 *    - `voidEradicatedVictory`: all Void cells are displaced (`voidCellCount == 0`) and
 *      no delayed portals remain pending.
 *    - `awaitingDelayedPortal`: current Void pocket is eradicated or isolated while a
 *      scheduled secondary portal is still counting down.
 *    - `isolatedPocketContainment`: Void exists and `energyRemaining > 0`, but has 0
 *      attackable matter edges (e.g., completely walled to map border); burns reservoir
 *      at `isolatedPocketBurnPerSecond` so the encounter cannot stall forever.
 * 5. Balanced Infantry Ablation:
 *    Rifle fire pushes back local accumulated erosion work and newly formed Void cells,
 *    and drains `energyRemaining` at a low efficiency (`infantryAblationEfficiency = 0.12`)
 *    down to a hard floor (`minReservoirFloorFraction = 0.15`), preventing cheap terrain
 *    or rifle loops from trivially exhausting the reservoir without surviving the siege. */

import { dist } from "../exact.ts";
import { MATERIAL_RESISTANCE, pixels, VOID_BALANCE, PIXEL_WORK_SCALE } from "./config.ts";
import { hash01, ORTHO } from "./grid.ts";
import {
  CellMaterial,
  type PrismState,
  type QuarantineSeal,
  type ScenarioConfig,
  type SiphonState,
  type VoidNode,
  type ZeroContactReason,
} from "./model.ts";
import type { VoidPhysics } from "./physics.ts";
import type { VoidWorld } from "./world.ts";

export class VoidField {
  readonly initialEnergy: number;
  energyRemaining: number;
  readonly minAblationEnergyFloor: number;
  /** Accumulated micro-work on each non-Void cell (`Uint32Array`). */
  readonly cellMicroWork: Uint32Array;
  /** Carry-over micro-work remainder from integer division across frontier edges. */
  private remainderMicroWork = 0;
  /** Active frontier non-Void cell indices that are orthogonally adjacent to at least one Void cell. */
  readonly frontierCells: number[] = [];
  /** Number of Void neighbors (1..4) for each cell in `frontierCells`. */
  readonly frontierContactCount: Uint8Array;
  /** Total Void cells currently on the map. */
  voidCellCount = 0;
  /** Total Void work resisted/absorbed by matter and barriers during this run. */
  totalWorkResisted = 0;
  /** Crystalline Void Nodes / Tendril Spires near the frontier. */
  readonly nodes: VoidNode[] = [];
  private nextNodeId = 1;
  /** Active Quarantine Bell boundary seals. */
  readonly quarantineSeals: QuarantineSeal[] = [];
  private nextSealId = 1;
  /** Seamwalker-frozen Void cells (cellIdx -> remaining hold seconds). */
  readonly frozenVoidCells = new Map<number, number>();
  /** Countervoid Heart friendly orange Void cells. */
  readonly countervoidCells = new Set<number>();
  private countervoidWorkAcc = 0;
  /** Reference count of living Lantern Bearers covering each cell. */
  readonly lanternRefCount: Uint16Array;
  /** 1 if cell was Void/UNCLAIMED when first covered by a Lantern Bearer (temporary footing). */
  readonly lanternCreatedTemp: Uint8Array;
  /** Temporary suppression timer (from Containment Pulse strike). */
  suppressedSeconds = 0;

  constructor(world: VoidWorld, scenario: ScenarioConfig) {
    this.initialEnergy = scenario.initialVoidEnergy;
    this.energyRemaining = scenario.initialVoidEnergy;
    this.minAblationEnergyFloor = Number.isFinite(scenario.initialVoidEnergy)
      ? scenario.initialVoidEnergy * VOID_BALANCE.minReservoirFloorFraction
      : Number.POSITIVE_INFINITY;
    this.cellMicroWork = new Uint32Array(world.grid.count);
    this.frontierContactCount = new Uint8Array(world.grid.count);
    this.lanternRefCount = new Uint16Array(world.grid.count);
    this.lanternCreatedTemp = new Uint8Array(world.grid.count);
    this.rebuildFrontier(world);
  }

  /** Applies Lantern Bearer solid-ground coverage in `radius`, tracking temporary Void provenance. */
  applyLanternCoverage(world: VoidWorld, cx: number, cy: number, radius: number): void {
    const { w, h } = world.grid;
    const rCeil = Math.ceil(radius);
    const rSq = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - rCeil)); y <= Math.min(h - 1, Math.ceil(cy + rCeil)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rCeil)); x <= Math.min(w - 1, Math.ceil(cx + rCeil)); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rSq) continue;
        const idx = y * w + x;
        this.lanternRefCount[idx]++;
        if (world.material[idx] === CellMaterial.VOID || world.material[idx] === CellMaterial.UNCLAIMED) {
          this.lanternCreatedTemp[idx] = 1;
          world.material[idx] = CellMaterial.RECLAIMED;
          world.hp[idx] = 100;
          world.maxHp[idx] = 100;
          world.buildingAt[idx] = -1;
          world.grid.markIndexDirty(idx);
        }
      }
    }
  }

  /** Releases Lantern Bearer coverage; reverts temporary Void footing when last bearer leaves. */
  releaseLanternCoverage(world: VoidWorld, cx: number, cy: number, radius: number): void {
    const { w, h } = world.grid;
    const rCeil = Math.ceil(radius);
    const rSq = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - rCeil)); y <= Math.min(h - 1, Math.ceil(cy + rCeil)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rCeil)); x <= Math.min(w - 1, Math.ceil(cx + rCeil)); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rSq) continue;
        const idx = y * w + x;
        if (this.lanternRefCount[idx] > 0) this.lanternRefCount[idx]--;
        if (this.lanternRefCount[idx] === 0 && this.lanternCreatedTemp[idx] === 1) {
          this.lanternCreatedTemp[idx] = 0;
          world.material[idx] = CellMaterial.VOID;
          world.hp[idx] = 0;
          world.grid.markIndexDirty(idx);
        }
      }
    }
  }

  /** Freezes a Void cell's propagation for `duration` seconds (bounded Seamwalker staple hold). */
  freezeVoidCell(cellIdx: number, duration = 2.0): void {
    const prev = this.frozenVoidCells.get(cellIdx) ?? 0;
    this.frozenVoidCells.set(cellIdx, Math.min(4.0, Math.max(prev, duration)));
  }

  /** Advances Seamwalker frozen-Void holds and the finite-budget Countervoid Heart opposing frontier. */
  stepCountervoidField(
    world: VoidWorld,
    dt: number,
    hearts: { x: number; y: number; range: number }[],
    tech?: { countervoidOutputMult: number; countervoidPressureMult: number; countervoidLandHpBonus: number },
  ): void {
    let needsRebuild = false;
    for (const [idx, rem] of this.frozenVoidCells) {
      if (rem - dt <= 0) {
        this.frozenVoidCells.delete(idx);
        needsRebuild = true;
      } else {
        this.frozenVoidCells.set(idx, rem - dt);
      }
    }

    // Prune Countervoid cells that were eroded back into purple Void
    for (const idx of this.countervoidCells) {
      if (world.material[idx] !== CellMaterial.RECLAIMED) {
        this.countervoidCells.delete(idx);
      }
    }

    const landHpBonus = tech?.countervoidLandHpBonus ?? 0;

    // When no living Countervoid Heart remains, unstabilized Countervoid decays back to Void
    if (hearts.length === 0) {
      if (this.countervoidCells.size > 0) {
        if (landHpBonus > 0) {
          this.countervoidCells.clear();
        } else {
          let decayBudget = Math.max(1, Math.ceil(dt * 24));
          for (const idx of this.countervoidCells) {
            if (decayBudget <= 0) break;
            this.countervoidCells.delete(idx);
            if (world.material[idx] === CellMaterial.RECLAIMED && this.lanternRefCount[idx] === 0) {
              world.material[idx] = CellMaterial.VOID;
              world.hp[idx] = 0;
              world.buildingAt[idx] = -1;
              world.grid.markIndexDirty(idx);
              needsRebuild = true;
            }
            decayBudget--;
          }
        }
      }
      if (needsRebuild) this.rebuildFrontier(world);
      return;
    }

    const { w } = world.grid;
    const outputMult = tech?.countervoidOutputMult ?? 1;
    const pressureMult = tech?.countervoidPressureMult ?? 1;
    const cellHp = 90 + landHpBonus;

    // Seed each living heart's anchor cell into the Countervoid field
    for (const hp of hearts) {
      const cx = Math.floor(hp.x);
      const cy = Math.floor(hp.y);
      if (world.grid.inBounds(cx, cy)) {
        const idx = world.grid.index(cx, cy);
        this.countervoidCells.add(idx);
        if (world.material[idx] === CellMaterial.VOID || world.material[idx] === CellMaterial.UNCLAIMED) {
          world.material[idx] = CellMaterial.RECLAIMED;
          world.hp[idx] = cellHp;
          world.maxHp[idx] = cellHp;
          world.buildingAt[idx] = -1;
          this.lanternCreatedTemp[idx] = 0;
          world.grid.markIndexDirty(idx);
          needsRebuild = true;
        }
      }
    }

    // Finite output budget shared across active hearts
    this.countervoidWorkAcc += hearts.length * 24 * outputMult * dt;
    let budget = Math.floor(this.countervoidWorkAcc);
    if (budget <= 0) {
      if (needsRebuild) this.rebuildFrontier(world);
      return;
    }
    this.countervoidWorkAcc -= budget;

    const nextAdd: number[] = [];
    for (const idx of this.countervoidCells) {
      if (budget <= 0) break;
      const x = idx % w;
      const y = (idx / w) | 0;

      // Reinforce contested Countervoid cells under purple Void pressure
      if (world.hp[idx] < world.maxHp[idx]) {
        world.hp[idx] = Math.min(world.maxHp[idx], world.hp[idx] + 20 * pressureMult * dt);
      }

      // Check if within range of at least one living heart
      let inHeartRange = false;
      for (let hi = 0; hi < hearts.length; hi++) {
        const hpos = hearts[hi];
        const dxH = x + 0.5 - hpos.x;
        const dyH = y + 0.5 - hpos.y;
        if (dxH * dxH + dyH * dyH <= hpos.range * hpos.range) {
          inHeartRange = true;
          break;
        }
      }
      if (!inHeartRange) continue;

      for (const [dx, dy] of ORTHO) {
        if (budget <= 0) break;
        const nx = x + dx;
        const ny = y + dy;
        if (!world.grid.inBounds(nx, ny)) continue;
        const nIdx = ny * w + nx;
        if (this.countervoidCells.has(nIdx)) continue;
        if (world.material[nIdx] === CellMaterial.VOID && !this.frozenVoidCells.has(nIdx)) {
          if (this.quarantineSeals.length > 0 && this.isEdgeBlockedBySeal(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) {
            continue;
          }
          world.material[nIdx] = CellMaterial.RECLAIMED;
          world.hp[nIdx] = cellHp;
          world.maxHp[nIdx] = cellHp;
          world.buildingAt[nIdx] = -1;
          this.lanternCreatedTemp[nIdx] = 0;
          world.grid.markIndexDirty(nIdx);
          nextAdd.push(nIdx);
          budget--;
          needsRebuild = true;
          break;
        }
      }
    }
    for (const nIdx of nextAdd) this.countervoidCells.add(nIdx);
    if (needsRebuild) this.rebuildFrontier(world);
  }

  /** Registers a temporary Quarantine Bell seal and immediately updates the frontier. */
  addQuarantineSeal(world: VoidWorld, x: number, y: number, radius: number, duration: number): QuarantineSeal {
    const seal: QuarantineSeal = {
      id: this.nextSealId++,
      x,
      y,
      radius,
      remaining: duration,
      duration,
    };
    this.quarantineSeals.push(seal);
    this.rebuildFrontier(world);
    return seal;
  }

  /** Returns true if the edge between `(ax, ay)` and `(bx, by)` crosses any active Quarantine Bell boundary. */
  isEdgeBlockedBySeal(ax: number, ay: number, bx: number, by: number): boolean {
    for (let i = 0; i < this.quarantineSeals.length; i++) {
      const s = this.quarantineSeals[i];
      if (s.remaining <= 0) continue;
      const rSq = s.radius * s.radius;
      const aIn = (ax - s.x) * (ax - s.x) + (ay - s.y) * (ay - s.y) <= rSq;
      const bIn = (bx - s.x) * (bx - s.x) + (by - s.y) * (by - s.y) <= rSq;
      if (aIn !== bIn) return true;
    }
    return false;
  }

  /** Scans the grid to rebuild `frontierCells`, `frontierContactCount`, and `voidCellCount`. */
  rebuildFrontier(world: VoidWorld): void {
    this.frontierCells.length = 0;
    this.frontierContactCount.fill(0);
    let vCount = 0;
    const { w, h, count } = world.grid;
    const mat = world.material;
    const hasSeals = this.quarantineSeals.length > 0;
    const hasFrozen = this.frozenVoidCells.size > 0;

    for (let i = 0; i < count; i++) {
      if (mat[i] === CellMaterial.VOID) {
        vCount++;
        continue;
      }
      const x = i % w;
      const y = (i / w) | 0;
      const cx = x + 0.5;
      const cy = y + 0.5;
      let contacts = 0;
      if (x > 0 && mat[i - 1] === CellMaterial.VOID && (!hasFrozen || !this.frozenVoidCells.has(i - 1)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx - 1, cy))) contacts++;
      if (x + 1 < w && mat[i + 1] === CellMaterial.VOID && (!hasFrozen || !this.frozenVoidCells.has(i + 1)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx + 1, cy))) contacts++;
      if (y > 0 && mat[i - w] === CellMaterial.VOID && (!hasFrozen || !this.frozenVoidCells.has(i - w)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx, cy - 1))) contacts++;
      if (y + 1 < h && mat[i + w] === CellMaterial.VOID && (!hasFrozen || !this.frozenVoidCells.has(i + w)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx, cy + 1))) contacts++;

      if (contacts > 0) {
        this.frontierContactCount[i] = contacts;
        this.frontierCells.push(i);
      }
    }
    this.voidCellCount = vCount;
  }

  /** Total exposed contact edges across the entire map. */
  totalContactEdges(): number {
    let edges = 0;
    for (const cIdx of this.frontierCells) {
      edges += this.frontierContactCount[cIdx];
    }
    return edges;
  }

  /** Resistance micro-work required to remove 1 HP from cell `idx`. */
  private microWorkPerHp(
    world: VoidWorld,
    idx: number,
    wallResistanceMult: number,
    gravityAnchorCells?: Uint8Array,
  ): number {
    const m = world.material[idx];
    let base: number = MATERIAL_RESISTANCE.street;
    switch (m) {
      case CellMaterial.UNCLAIMED:
        base = MATERIAL_RESISTANCE.unclaimed;
        break;
      case CellMaterial.STREET:
        base = MATERIAL_RESISTANCE.street;
        break;
      case CellMaterial.PARK:
        base = MATERIAL_RESISTANCE.park;
        break;
      case CellMaterial.RECLAIMED:
        base = MATERIAL_RESISTANCE.reclaimed;
        break;
      case CellMaterial.SALVAGE:
        base = MATERIAL_RESISTANCE.salvage;
        break;
      case CellMaterial.BUILDING:
        base = MATERIAL_RESISTANCE.building;
        break;
      case CellMaterial.SKYSCRAPER:
        base = MATERIAL_RESISTANCE.skyscraper;
        break;
      case CellMaterial.WALL:
        base = Math.round(MATERIAL_RESISTANCE.wall * wallResistanceMult);
        break;
      case CellMaterial.BARRIER:
        base = Math.round(MATERIAL_RESISTANCE.barrier * wallResistanceMult);
        break;
    }
    if (gravityAnchorCells && gravityAnchorCells[idx]) {
      base = Math.round(base * 1.45);
    }
    // Four pixels occupy one former cell. Scaling work precision by four
    // gives each pixel exactly one quarter of the former erosion cost.
    return Math.max(10, base);
  }

  /** Advances Void expansion, delayed portals, and Void Node spawns for one fixed tick. */
  step(
    world: VoidWorld,
    physics: VoidPhysics,
    scenario: ScenarioConfig,
    tick: number,
    dt: number,
    opts: {
      wallResistanceMultiplier: number;
      perimeterResonanceBonus: number;
      gravityAnchorMask?: Uint8Array;
      shieldAbsorptionAt?: (cellIdx: number, workAmount: number) => number;
      prisms?: Iterable<PrismState>;
      siphons?: Iterable<SiphonState>;
      siphonIntakeCap?: number;
    },
  ): ZeroContactReason {
    // 1. Check delayed portals activating on this tick
    let portalOpened = false;
    for (const p of world.portals) {
      if (!p.active && tick >= p.activateAtTick) {
        p.active = true;
        portalOpened = true;
        const { w, h } = world.grid;
        for (let y = Math.max(0, p.y - p.radius); y <= Math.min(h - 1, p.y + p.radius); y++) {
          for (let x = Math.max(0, p.x - p.radius); x <= Math.min(w - 1, p.x + p.radius); x++) {
            if (dist(x - p.x, y - p.y) <= p.radius) {
              const cIdx = y * w + x;
              if (this.lanternRefCount[cIdx] === 0) {
                physics.consumeCellIntoVoid(world, cIdx, true);
              }
            }
          }
        }
      }
    }

    this.rebuildFrontier(world);

    // 2. Check immediate victory/defeat or zero-contact conditions
    const preserved = world.computePreservedBaseline();
    if (preserved.preservedValue <= 0) {
      return "cityConsumedDefeat";
    }

    const hasPendingPortal = world.portals.some((p) => !p.active);

    if (this.voidCellCount === 0 && !hasPendingPortal) {
      return "voidEradicatedVictory";
    }

    if (this.energyRemaining <= 0 && !hasPendingPortal) {
      return "reservoirDepletedVictory";
    }

    // Advance Quarantine Bell seal timers
    if (this.quarantineSeals.length > 0) {
      let expiredAny = false;
      for (let i = this.quarantineSeals.length - 1; i >= 0; i--) {
        this.quarantineSeals[i].remaining -= dt;
        if (this.quarantineSeals[i].remaining <= 0) {
          this.quarantineSeals.splice(i, 1);
          expiredAny = true;
        }
      }
      if (expiredAny) {
        this.rebuildFrontier(world);
      }
    }

    if (this.suppressedSeconds > 0) {
      this.suppressedSeconds = Math.max(0, this.suppressedSeconds - dt);
      return "active";
    }

    // 3. Handle zero exposed frontier edges when city still survives
    if (this.frontierCells.length === 0) {
      if (hasPendingPortal) {
        return "awaitingDelayedPortal";
      }
      // Isolated/contained pocket with no attackable edges: burn containment energy so it never stalls
      const burn = Math.min(this.energyRemaining, VOID_BALANCE.isolatedPocketBurnPerSecond * dt);
      this.energyRemaining = Math.max(0, this.energyRemaining - burn);
      this.totalWorkResisted += burn;
      if (this.energyRemaining <= 0) {
        return "reservoirDepletedVictory";
      }
      return "isolatedPocketContainment";
    }

    // 4. Periodically coalesce a crystalline Void Node near the frontier (gives infantry targets in Phase 6+)
    if (
      tick > 0 &&
      tick % VOID_BALANCE.nodeSpawnIntervalTicks === 0 &&
      this.nodes.length < VOID_BALANCE.nodeMaxCount &&
      this.energyRemaining > VOID_BALANCE.nodeSpawnEnergyCost * 2 &&
      this.frontierCells.length > 0
    ) {
      const pickIdx = Math.floor(hash01(world.seed, 777, tick) * this.frontierCells.length);
      const fCell = this.frontierCells[pickIdx];
      const fx = world.grid.xOf(fCell);
      const fy = world.grid.yOf(fCell);
      // Place node 1 cell inside the Void side of this frontier cell
      for (const [dx, dy] of ORTHO) {
        const vx = fx + dx;
        const vy = fy + dy;
        if (world.grid.inBounds(vx, vy) && world.material[world.grid.index(vx, vy)] === CellMaterial.VOID) {
          this.nodes.push({
            id: this.nextNodeId++,
            x: vx + 0.5,
            y: vy + 0.5,
            hp: 90,
            maxHp: 90,
            radius: pixels(1.4),
          });
          this.energyRemaining = Math.max(0, this.energyRemaining - VOID_BALANCE.nodeSpawnEnergyCost);
          break;
        }
      }
    }

    // 5. Compute instantaneous tick work budget and distribute across ALL frontier contact edges
    const elapsedMinutes = (tick * dt) / 60;
    const growthRate = scenario.baseGrowthRate + scenario.rampPerMinute * elapsedMinutes;
    const workAvailable = Math.min(this.energyRemaining, growthRate * dt);
    if (workAvailable <= 0) {
      return portalOpened ? "active" : "reservoirDepletedVictory";
    }

    // Calculate weighted perimeter so sacrificial land islands with `perimeterResonanceBonus`
    // or cells near Void Nodes draw proportional shares of the fixed `workAvailable` budget.
    let totalWeightedEdges = 0;
    const weights = new Float64Array(this.frontierCells.length);

    for (let i = 0; i < this.frontierCells.length; i++) {
      const cIdx = this.frontierCells[i];
      let wEdge = this.frontierContactCount[cIdx];
      const cellX = world.grid.xOf(cIdx);
      const cellY = world.grid.yOf(cIdx);
      const mat = world.material[cIdx];

      // Organic disease-like cosmic veins: deterministic spatial ridges + street conduit channeling
      const veinWave =
        0.5 +
        0.5 *
          Math.sin(cellX / pixels(1) * 0.23 + cellY / pixels(1) * 0.17 + (world.seed & 0xff)) *
          Math.cos(cellX / pixels(1) * 0.14 - cellY / pixels(1) * 0.29 + ((tick >> 6) * 0.35));
      wEdge *= 0.45 + 1.15 * veinWave;

      if (mat === CellMaterial.STREET || mat === CellMaterial.PARK) {
        wEdge *= 1.38;
      }

      // Sacrificial non-baseline reclaimed islands draw concentrated Void pressure away from the city
      if (!world.isBaselineCell[cIdx] && mat === CellMaterial.RECLAIMED) {
        wEdge *= 2.2 * (1 + opts.perimeterResonanceBonus);
      }
      // Nearby Void Nodes locally amplify pressure weight
      if (this.nodes.length > 0) {
        const cx = cellX + 0.5;
        const cy = cellY + 0.5;
        for (const node of this.nodes) {
          if (dist(cx - node.x, cy - node.y) <= pixels(10)) {
            wEdge *= VOID_BALANCE.nodeErosionBoost;
            break;
          }
        }
      }
      weights[i] = wEdge;
      totalWeightedEdges += wEdge;
    }

    if (totalWeightedEdges <= 0) return "active";

    const totalMicroWork = Math.round(workAvailable * PIXEL_WORK_SCALE) + this.remainderMicroWork;
    let spentMicroWork = 0;
    const nFront = this.frontierCells.length;
    const cellMicroShares = new Float64Array(nFront);
    const cellIndexToSlot = new Map<number, number>();

    for (let i = 0; i < nFront; i++) {
      const cIdx = this.frontierCells[i];
      cellIndexToSlot.set(cIdx, i);
      const share = Math.floor((totalMicroWork * weights[i]) / totalWeightedEdges);
      cellMicroShares[i] = share;
      spentMicroWork += share;
    }

    // 5a. Boundary Prism conservative directional pressure redirection (pre-step stable state, no ping-pong)
    if (opts.prisms) {
      const redirectedAdd = new Float64Array(nFront);
      for (const prism of opts.prisms) {
        const cosA = Math.cos(prism.angleRad);
        const sinA = Math.sin(prism.angleRad);
        // Normal pointing toward receiving flank (+n), protected side is (-n)
        const nx = -sinA;
        const ny = cosA;
        const halfLen = prism.planeLength * 0.5;
        const receivers: number[] = [];

        for (let i = 0; i < nFront; i++) {
          const cIdx = this.frontierCells[i];
          const dx = world.grid.xOf(cIdx) + 0.5 - prism.x;
          const dy = world.grid.yOf(cIdx) + 0.5 - prism.y;
          const along = dx * cosA + dy * sinA;
          const perp = dx * nx + dy * ny;
          if (Math.abs(along) <= halfLen && perp > 0 && perp <= prism.bandWidth * 1.5) {
            if (!this.isEdgeBlockedBySeal(prism.x, prism.y, world.grid.xOf(cIdx) + 0.5, world.grid.yOf(cIdx) + 0.5)) {
              receivers.push(i);
            }
          }
        }

        if (receivers.length === 0) continue; // No valid receiving frontier -> keep normal local erosion

        let poolRedirected = 0;
        for (let i = 0; i < nFront; i++) {
          const baseShare = cellMicroShares[i];
          if (baseShare <= 0) continue;
          const cIdx = this.frontierCells[i];
          const dx = world.grid.xOf(cIdx) + 0.5 - prism.x;
          const dy = world.grid.yOf(cIdx) + 0.5 - prism.y;
          const along = dx * cosA + dy * sinA;
          const perp = dx * nx + dy * ny;
          // Protected side (-bandWidth .. 0)
          if (Math.abs(along) <= halfLen && perp <= 0 && perp >= -prism.bandWidth) {
            const redir = Math.floor(baseShare * Math.min(0.45, prism.redirectFraction));
            if (redir > 0) {
              cellMicroShares[i] -= redir;
              poolRedirected += redir;
            }
          }
        }

        if (poolRedirected > 0) {
          const perRec = Math.floor(poolRedirected / receivers.length);
          let rem = poolRedirected - perRec * receivers.length;
          for (let r = 0; r < receivers.length; r++) {
            const add = perRec + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
            redirectedAdd[receivers[r]] += add;
          }
        }
      }
      for (let i = 0; i < nFront; i++) {
        cellMicroShares[i] += redirectedAdd[i];
      }
    }

    // 5b. Void Siphon interception into finite storage (no double-counting across overlapping siphons)
    if (opts.siphons) {
      const intakeCap = opts.siphonIntakeCap ?? 0.25;
      for (const siphon of opts.siphons) {
        if (siphon.phase !== "intake" || siphon.stored >= siphon.maxStorage) continue;
        const rSq = siphon.radius * siphon.radius;
        for (let i = 0; i < nFront; i++) {
          if (siphon.stored >= siphon.maxStorage) break;
          const curMicro = cellMicroShares[i];
          if (curMicro <= 0) continue;
          const cIdx = this.frontierCells[i];
          const dx = world.grid.xOf(cIdx) + 0.5 - siphon.x;
          const dy = world.grid.yOf(cIdx) + 0.5 - siphon.y;
          if (dx * dx + dy * dy > rSq) continue;

          const maxInterceptWork = (curMicro / PIXEL_WORK_SCALE) * intakeCap;
          const room = siphon.maxStorage - siphon.stored;
          const interceptedWork = Math.min(room, maxInterceptWork);
          if (interceptedWork > 0) {
            const interceptedMicro = Math.min(curMicro, Math.round(interceptedWork * PIXEL_WORK_SCALE));
            cellMicroShares[i] -= interceptedMicro;
            siphon.stored += interceptedMicro / PIXEL_WORK_SCALE;
            if (siphon.stored >= siphon.maxStorage) {
              siphon.stored = siphon.maxStorage;
              siphon.phase = "venting";
              siphon.ventRemaining = siphon.ventDuration;
            }
          }
        }
      }
    }

    for (let i = 0; i < nFront; i++) {
      const cIdx = this.frontierCells[i];
      const shareMicro = cellMicroShares[i];
      if (shareMicro <= 0) continue;

      // Optional shield projector absorption before terrain takes damage
      let effectiveMicro = shareMicro;
      if (opts.shieldAbsorptionAt) {
        const absorbedWork = opts.shieldAbsorptionAt(cIdx, shareMicro / PIXEL_WORK_SCALE);
        if (absorbedWork > 0) {
          const absorbedMicro = Math.min(effectiveMicro, Math.round(absorbedWork * PIXEL_WORK_SCALE));
          effectiveMicro -= absorbedMicro;
        }
      }

      if (effectiveMicro <= 0) continue;

      const totalCellMicro = this.cellMicroWork[cIdx] + effectiveMicro;
      const costPerHp = this.microWorkPerHp(
        world,
        cIdx,
        opts.wallResistanceMultiplier,
        opts.gravityAnchorMask,
      );

      if (totalCellMicro >= costPerHp) {
        const hpLoss = Math.floor(totalCellMicro / costPerHp);
        this.cellMicroWork[cIdx] = totalCellMicro % costPerHp;
        const curHp = world.hp[cIdx];
        if (hpLoss >= curHp && this.lanternRefCount[cIdx] === 0) {
          this.cellMicroWork[cIdx] = 0;
          physics.consumeCellIntoVoid(world, cIdx, true);
        } else {
          const maxHp = Math.max(1, world.maxHp[cIdx]);
          const nextHp = Math.max(this.lanternRefCount[cIdx] > 0 ? 1 : 0, curHp - hpLoss);
          world.hp[cIdx] = nextHp;
          const prevStage = curHp / maxHp < 0.4 ? 2 : curHp / maxHp < 0.75 ? 1 : 0;
          const nextStage = nextHp / maxHp < 0.4 ? 2 : nextHp / maxHp < 0.75 ? 1 : 0;
          if (prevStage !== nextStage) {
            world.grid.markIndexDirty(cIdx);
          }
        }
      } else {
        this.cellMicroWork[cIdx] = totalCellMicro;
      }
    }

    this.remainderMicroWork = Math.max(0, totalMicroWork - spentMicroWork);
    const actualEnergySpent = spentMicroWork / PIXEL_WORK_SCALE;
    this.energyRemaining = Math.max(0, this.energyRemaining - actualEnergySpent);
    this.totalWorkResisted += actualEnergySpent;

    if (this.energyRemaining <= 0 && !hasPendingPortal) {
      return "reservoirDepletedVictory";
    }
    return "active";
  }

  /** Applies infantry laser or tower anti-Void ablation at frontier cell `cellIdx` or Void cell `voidIdx`.
   * - Reduces accumulated micro-work on frontier cells.
   * - Can reclaim freshly formed Void edge cells back to `UNCLAIMED` / `RECLAIMED` if intense.
   * - Depletes `energyRemaining` at a strictly bounded efficiency (`infantryAblationEfficiency = 0.12`)
   *   and never below `minAblationEnergyFloor`, ensuring players cannot cheese the reservoir
   *   with cheap terrain/infantry loops. */
  applyAntiVoidAblation(world: VoidWorld, targetCellIdx: number, rawDamage: number): void {
    if (targetCellIdx < 0 || targetCellIdx >= world.grid.count) return;
    const ablatedMicro = Math.round(rawDamage * PIXEL_WORK_SCALE);
    if (this.cellMicroWork[targetCellIdx] > 0) {
      this.cellMicroWork[targetCellIdx] = Math.max(0, this.cellMicroWork[targetCellIdx] - ablatedMicro);
    }
    this.totalWorkResisted += rawDamage * 0.5;

    if (this.energyRemaining > this.minAblationEnergyFloor) {
      const drain = rawDamage * VOID_BALANCE.infantryAblationEfficiency;
      this.energyRemaining = Math.max(this.minAblationEnergyFloor, this.energyRemaining - drain);
    }
  }
}
