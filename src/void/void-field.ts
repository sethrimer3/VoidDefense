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
import {
  CORRUPTION_REACH,
  MATERIAL_RESISTANCE,
  PIXEL_AREA,
  PIXEL_WORK_SCALE,
  TICK_HZ,
  VOID_BALANCE,
  VOID_CONTEST_COSTS,
  contestHoldTicksForDifficulty,
  pixels,
} from "./config.ts";
import { floorsToElevation } from "./elevation.ts";
import { hash01, ORTHO } from "./grid.ts";
import {
  CellMaterial,
  LandCover,
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
  /** Changes when the row-major set of exposed cells changes. */
  frontierRevision = 0;
  private frontierWeights = new Float64Array(0);
  private frontierShares = new Float64Array(0);
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
  /** Contested/removed cells temporarily holding back the Void (cellIdx -> remaining 30 Hz ticks). */
  readonly contestedCells = new Map<number, number>();
  /** Countervoid Heart active orange influence cells. */
  readonly countervoidCells = new Set<number>();
  /** 1 if cell was converted from VOID/UNCLAIMED by Countervoid (vs pre-existing land). */
  readonly countervoidCreated: Uint8Array;
  private countervoidWorkAcc = 0;
  /** Reference count of living Lantern Bearers covering each cell. */
  readonly lanternRefCount: Uint16Array;
  /** 1 if cell was Void/UNCLAIMED when first covered by a Lantern Bearer (temporary footing). */
  readonly lanternCreatedTemp: Uint8Array;
  /** Void difficulty level (1..10) and integer 30 Hz contest holdback duration (`1s / voidDifficulty`). */
  readonly voidDifficulty: number;
  readonly contestHoldTicks: number;
  /** Temporary suppression timer (from Containment Pulse strike). */
  suppressedSeconds = 0;

  constructor(world: VoidWorld, scenario: ScenarioConfig) {
    this.initialEnergy = scenario.initialVoidEnergy;
    this.energyRemaining = scenario.initialVoidEnergy;
    this.minAblationEnergyFloor = Number.isFinite(scenario.initialVoidEnergy)
      ? scenario.initialVoidEnergy * VOID_BALANCE.minReservoirFloorFraction
      : Number.POSITIVE_INFINITY;
    this.voidDifficulty = Math.max(
      VOID_CONTEST_COSTS.MIN_VOID_DIFFICULTY,
      Math.min(VOID_CONTEST_COSTS.MAX_VOID_DIFFICULTY, Math.round(scenario.voidDifficulty ?? 1)),
    );
    this.contestHoldTicks = contestHoldTicksForDifficulty(this.voidDifficulty);
    this.cellMicroWork = new Uint32Array(world.grid.count);
    this.frontierContactCount = new Uint8Array(world.grid.count);
    this.lanternRefCount = new Uint16Array(world.grid.count);
    this.lanternCreatedTemp = new Uint8Array(world.grid.count);
    this.countervoidCreated = new Uint8Array(world.grid.count);
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
        if (
          world.material[idx] === CellMaterial.VOID ||
          world.material[idx] === CellMaterial.UNCLAIMED ||
          world.material[idx] === CellMaterial.EMPTY
        ) {
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
      if (
        world.material[idx] === CellMaterial.VOID ||
        world.material[idx] === CellMaterial.UNCLAIMED ||
        world.material[idx] === CellMaterial.EMPTY
      ) {
        this.countervoidCells.delete(idx);
      }
    }

    const landHpBonus = tech?.countervoidLandHpBonus ?? 0;

    // When no living Countervoid Heart remains, orange influence decays and only Countervoid-created
    // cells (without Lasting Ground) revert to Void; pre-existing reclaimed/city land is never deleted.
    if (hearts.length === 0) {
      if (this.countervoidCells.size > 0) {
        let decayBudget = Math.max(1, Math.ceil(dt * 90));
        for (const idx of this.countervoidCells) {
          if (decayBudget <= 0) break;
          this.countervoidCells.delete(idx);
          if (
            landHpBonus === 0 &&
            this.countervoidCreated[idx] === 1 &&
            world.material[idx] === CellMaterial.RECLAIMED &&
            this.lanternRefCount[idx] === 0
          ) {
            this.countervoidCreated[idx] = 0;
            world.material[idx] = CellMaterial.VOID;
            world.hp[idx] = 0;
            world.buildingAt[idx] = -1;
            world.grid.markIndexDirty(idx);
            needsRebuild = true;
          } else if (landHpBonus > 0) {
            // Stabilized permanent land: clear temporary provenance
            this.countervoidCreated[idx] = 0;
          }
          decayBudget--;
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
        if (
          world.material[idx] === CellMaterial.VOID ||
          world.material[idx] === CellMaterial.UNCLAIMED ||
          world.material[idx] === CellMaterial.EMPTY
        ) {
          world.material[idx] = CellMaterial.RECLAIMED;
          world.hp[idx] = cellHp;
          world.maxHp[idx] = cellHp;
          world.buildingAt[idx] = -1;
          this.lanternCreatedTemp[idx] = 0;
          this.countervoidCreated[idx] = 1;
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
        if (this.quarantineSeals.length > 0 && this.isEdgeBlockedBySeal(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) {
          continue;
        }
        if (world.material[nIdx] === CellMaterial.VOID && !this.frozenVoidCells.has(nIdx)) {
          world.material[nIdx] = CellMaterial.RECLAIMED;
          world.hp[nIdx] = cellHp;
          world.maxHp[nIdx] = cellHp;
          world.buildingAt[nIdx] = -1;
          this.lanternCreatedTemp[nIdx] = 0;
          this.countervoidCreated[nIdx] = 1;
          world.grid.markIndexDirty(nIdx);
          nextAdd.push(nIdx);
          budget--;
          needsRebuild = true;
          break;
        } else if (
          world.material[nIdx] !== CellMaterial.VOID &&
          world.material[nIdx] !== CellMaterial.UNCLAIMED &&
          world.material[nIdx] !== CellMaterial.EMPTY
        ) {
          // Radiate Countervoid conduit across solid land within heart range to reach the Void frontier
          nextAdd.push(nIdx);
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
    const frontier = this.frontierCells;
    const previousLength = frontier.length;
    let nextLength = 0;
    let changed = false;
    this.frontierContactCount.fill(0);
    let vCount = 0;
    const { w, h } = world.grid;
    const mat = world.material;
    const hasSeals = this.quarantineSeals.length > 0;
    const hasFrozen = this.frozenVoidCells.size > 0;
    const hasRestrictions = hasSeals || hasFrozen;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (mat[i] === CellMaterial.VOID) {
          vCount++;
          continue;
        }
        const west = x > 0 && mat[i - 1] === CellMaterial.VOID;
        const east = x + 1 < w && mat[i + 1] === CellMaterial.VOID;
        const north = y > 0 && mat[i - w] === CellMaterial.VOID;
        const south = y + 1 < h && mat[i + w] === CellMaterial.VOID;
        if (!west && !east && !north && !south) continue;
        let contacts = 0;
        if (hasRestrictions) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          if (west && (!hasFrozen || !this.frozenVoidCells.has(i - 1)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx - 1, cy))) contacts++;
          if (east && (!hasFrozen || !this.frozenVoidCells.has(i + 1)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx + 1, cy))) contacts++;
          if (north && (!hasFrozen || !this.frozenVoidCells.has(i - w)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx, cy - 1))) contacts++;
          if (south && (!hasFrozen || !this.frozenVoidCells.has(i + w)) && (!hasSeals || !this.isEdgeBlockedBySeal(cx, cy, cx, cy + 1))) contacts++;
        } else {
          contacts = Number(west) + Number(east) + Number(north) + Number(south);
        }
        if (contacts === 0) continue;
        this.frontierContactCount[i] = contacts;
        if (frontier[nextLength] !== i) {
          changed = true;
          frontier[nextLength] = i;
        }
        nextLength++;
      }
    }
    frontier.length = nextLength;
    if (changed || nextLength !== previousLength) this.frontierRevision++;
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

  /** Void power cost to consume cell `idx` into Void:
   * - Empty space: `EMPTY_COST` (1)
   * - Land: `LAND_COST_PER_PIXEL` (2)
   * - Land + building: `LAND_COST_PER_PIXEL + buildingHeightPx * BUILDING_COST_PER_PIXEL` */
  voidPowerCost(world: VoidWorld, idx: number): number {
    const mat = world.material[idx];
    if (mat === CellMaterial.VOID) return 0;
    if (mat === CellMaterial.EMPTY) return VOID_CONTEST_COSTS.EMPTY_COST;
    const floors = world.columnFloors[idx];
    const buildingHeightPx = floors > 0 ? floorsToElevation(floors, "full") : 0;
    return (
      VOID_CONTEST_COSTS.LAND_COST_PER_PIXEL +
      buildingHeightPx * VOID_CONTEST_COSTS.BUILDING_COST_PER_PIXEL
    );
  }

  /** Integer micro-work required to consume cell `idx` into Void.
   * Uses `voidPowerCost * MICRO_WORK_PER_VOID_POWER`, scaled for player fortifications
   * (walls, barriers, reclaimed bedrock) and Gravity Anchors. */
  private totalCellMicroCost(
    world: VoidWorld,
    idx: number,
    wallResistanceMult: number,
    gravityAnchorCells?: Uint8Array,
  ): number {
    const powerCost = this.voidPowerCost(world, idx);
    if (powerCost <= 0) return 0;
    let microCost = powerCost * VOID_CONTEST_COSTS.MICRO_WORK_PER_VOID_POWER;
    const m = world.material[idx];
    if (m === CellMaterial.WALL) {
      microCost = Math.round(
        microCost * (MATERIAL_RESISTANCE.wall / MATERIAL_RESISTANCE.street) * wallResistanceMult,
      );
    } else if (m === CellMaterial.BARRIER) {
      microCost = Math.round(
        microCost * (MATERIAL_RESISTANCE.barrier / MATERIAL_RESISTANCE.street) * wallResistanceMult,
      );
    } else if (m === CellMaterial.RECLAIMED) {
      microCost = Math.round(
        microCost * (MATERIAL_RESISTANCE.reclaimed / MATERIAL_RESISTANCE.street),
      );
    }
    if (gravityAnchorCells && gravityAnchorCells[idx]) {
      microCost = Math.round(microCost * 1.45);
    }
    return Math.max(1, microCost);
  }

  /** Spends `voidPowerAmount` of Void power on cell `idx` pixel by pixel.
   * Partially paid pixels carry progress over in `cellMicroWork[idx]` deterministically
   * until the full cost is paid, then convert into `CellMaterial.VOID`.
   * Returns true if the cell was consumed into Void. */
  spendVoidPowerOnCell(
    world: VoidWorld,
    physics: VoidPhysics,
    idx: number,
    voidPowerAmount: number,
    rebuild = true,
  ): boolean {
    if (idx < 0 || idx >= world.grid.count || voidPowerAmount <= 0) return false;
    if (world.material[idx] === CellMaterial.VOID) return false;
    if (this.contestedCells.has(idx)) return false;
    const totalMicroCost = this.totalCellMicroCost(world, idx, 1);
    const addedMicro = Math.round(voidPowerAmount * VOID_CONTEST_COSTS.MICRO_WORK_PER_VOID_POWER);
    const nextMicro = this.cellMicroWork[idx] + addedMicro;

    if (nextMicro >= totalMicroCost && this.lanternRefCount[idx] === 0) {
      this.cellMicroWork[idx] = 0;
      physics.consumeCellIntoVoid(world, idx, true);
      if (rebuild) this.rebuildFrontier(world);
      return true;
    }

    this.cellMicroWork[idx] = Math.min(nextMicro, Math.max(0, totalMicroCost - 1));
    if (world.maxHp[idx] > 0) {
      const remainingMicro = Math.max(0, totalMicroCost - this.cellMicroWork[idx]);
      const nextHp = Math.max(1, Math.ceil((world.maxHp[idx] * remainingMicro) / totalMicroCost));
      if (nextHp < world.hp[idx]) {
        world.hp[idx] = nextHp;
        world.grid.markIndexDirty(idx);
      }
    }
    return false;
  }

  /** Marks cell `cellIdx` as contested so the Void holds back for `durationTicks` (default `1s / voidDifficulty`)
   * (turning it neon orange and fading back to Void color as it uncontests). */
  markContested(cellIdx: number, durationTicks = this.contestHoldTicks): void {
    if (durationTicks <= 0) return;
    const prev = this.contestedCells.get(cellIdx) ?? 0;
    if (durationTicks > prev) {
      this.contestedCells.set(cellIdx, durationTicks);
    }
  }

  /** Destroys a single `CellMaterial.VOID` pixel, turning it into `CellMaterial.EMPTY`.
   * Void removal never restores land or buildings; the empty space left behind costs
   * only `EMPTY_COST` (1) void power for the Void to reclaim after the contest holdback expires. */
  removeVoidPixel(world: VoidWorld, voidIdx: number, rebuild = true): boolean {
    if (voidIdx < 0 || voidIdx >= world.grid.count) return false;
    if (world.material[voidIdx] !== CellMaterial.VOID) return false;
    world.material[voidIdx] = CellMaterial.EMPTY;
    world.hp[voidIdx] = 0;
    world.maxHp[voidIdx] = 0;
    world.buildingAt[voidIdx] = -1;
    world.columnFloors[voidIdx] = 0;
    world.landCover[voidIdx] = LandCover.NONE;
    this.cellMicroWork[voidIdx] = 0;
    this.frozenVoidCells.delete(voidIdx);
    this.markContested(voidIdx);
    this.voidCellCount = Math.max(0, this.voidCellCount - 1);
    world.grid.markRadiusDirty(voidIdx, CORRUPTION_REACH);
    if (rebuild) this.rebuildFrontier(world);
    return true;
  }

  /** Removes all `CellMaterial.VOID` pixels within `radius` world pixels of `centerIdx`
   * (centered on an adjacent Void cell if `centerIdx` itself is non-Void). */
  removeVoidArea(
    world: VoidWorld,
    centerIdx: number,
    radius: number,
    rebuild = true,
  ): { removed: number; firstVoidIdx: number } {
    if (radius < 0 || centerIdx < 0 || centerIdx >= world.grid.count) {
      return { removed: 0, firstVoidIdx: -1 };
    }
    const { w } = world.grid;
    let cx = centerIdx % w;
    let cy = (centerIdx / w) | 0;
    if (world.material[centerIdx] !== CellMaterial.VOID) {
      for (const [dx, dy] of ORTHO) {
        const vx = cx + dx;
        const vy = cy + dy;
        if (world.grid.inBounds(vx, vy) && world.material[vy * w + vx] === CellMaterial.VOID) {
          cx = vx;
          cy = vy;
          break;
        }
      }
    }
    const rCeil = Math.ceil(radius);
    const rSq = radius * radius;
    let removed = 0;
    let firstVoidIdx = -1;
    for (let dy = -rCeil; dy <= rCeil; dy++) {
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        if (dx * dx + dy * dy > rSq) continue;
        const vx = cx + dx;
        const vy = cy + dy;
        if (!world.grid.inBounds(vx, vy)) continue;
        const vIdx = vy * w + vx;
        if (this.removeVoidPixel(world, vIdx, false)) {
          if (firstVoidIdx < 0) firstVoidIdx = vIdx;
          removed++;
        }
      }
    }
    if (removed > 0 && rebuild) {
      this.rebuildFrontier(world);
    }
    return { removed, firstVoidIdx };
  }

  /** Removes up to `count` adjacent `CellMaterial.VOID` pixels bordering frontier cell `cellIdx`.
   * Returns `{ removed, firstVoidIdx }`. */
  removeVoidPixelsNear(
    world: VoidWorld,
    cellIdx: number,
    count: number,
    rebuild = true,
  ): { removed: number; firstVoidIdx: number } {
    if (count <= 0 || cellIdx < 0 || cellIdx >= world.grid.count) {
      return { removed: 0, firstVoidIdx: -1 };
    }
    const { w } = world.grid;
    const cx = cellIdx % w;
    const cy = (cellIdx / w) | 0;
    let removed = 0;
    let firstVoidIdx = -1;
    for (const [dx, dy] of ORTHO) {
      if (removed >= count) break;
      const vx = cx + dx;
      const vy = cy + dy;
      if (!world.grid.inBounds(vx, vy)) continue;
      const vIdx = vy * w + vx;
      if (this.removeVoidPixel(world, vIdx, false)) {
        if (firstVoidIdx < 0) firstVoidIdx = vIdx;
        removed++;
      }
    }
    if (removed > 0 && rebuild) {
      this.rebuildFrontier(world);
    }
    return { removed, firstVoidIdx };
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
    // 0. Advance contested holdback timers (integer 30 Hz ticks)
    if (this.contestedCells.size > 0) {
      const stepTicks = Math.max(1, Math.round(dt * TICK_HZ));
      for (const [idx, rem] of this.contestedCells) {
        const next = rem - stepTicks;
        if (next <= 0) {
          this.contestedCells.delete(idx);
        } else {
          this.contestedCells.set(idx, next);
        }
      }
    }

    // 1. Check delayed portals activating on this tick
    let portalOpened = false;
    for (const p of world.portals) {
      if (!p.active && tick >= p.activateAtTick) {
        p.active = true;
        portalOpened = true;
        const { w, h } = world.grid;
        for (let y = Math.max(0, Math.ceil(p.y - p.radius)); y <= Math.min(h - 1, p.y + p.radius); y++) {
          for (let x = Math.max(0, Math.ceil(p.x - p.radius)); x <= Math.min(w - 1, p.x + p.radius); x++) {
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
    if (!world.hasPreservedBaseline()) {
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
    const area = this.voidCellCount * PIXEL_AREA;
    const areaMultiplier = 1 - VOID_BALANCE.maxGrowthSlowdown * area / (area + VOID_BALANCE.growthSlowdownArea);
    const workAvailable = Math.min(this.energyRemaining, growthRate * areaMultiplier * dt);
    if (workAvailable <= 0) {
      return portalOpened ? "active" : "reservoirDepletedVictory";
    }

    // Calculate weighted perimeter so sacrificial land islands with `perimeterResonanceBonus`
    // or cells near Void Nodes draw proportional shares of the fixed `workAvailable` budget.
    let totalWeightedEdges = 0;
    const nFront = this.frontierCells.length;
    if (this.frontierWeights.length < nFront) {
      const capacity = Math.max(nFront, this.frontierWeights.length * 2);
      this.frontierWeights = new Float64Array(capacity);
      this.frontierShares = new Float64Array(capacity);
    }
    const weights = this.frontierWeights;

    for (let i = 0; i < this.frontierCells.length; i++) {
      const cIdx = this.frontierCells[i];
      if (this.contestedCells.has(cIdx)) {
        weights[i] = 0;
        continue;
      }
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
    const cellMicroShares = this.frontierShares;

    for (let i = 0; i < nFront; i++) {
      const share = Math.floor((totalMicroWork * weights[i]) / totalWeightedEdges);
      cellMicroShares[i] = share;
      spentMicroWork += share;
    }

    // 5a. Boundary Prism conservative directional pressure redirection (order-independent, combined per-source cap)
    if (opts.prisms) {
      const COMBINED_PRISM_REDIRECT_CAP = 0.45;
      const origShares = new Int32Array(cellMicroShares.subarray(0, nFront));
      const totalWant = new Int32Array(nFront);
      const redirectedAdd = new Int32Array(nFront);
      const prismEntries: { receivers: number[]; wantByCell: Map<number, number> }[] = [];

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

        const wantByCell = new Map<number, number>();
        const frac = Math.min(COMBINED_PRISM_REDIRECT_CAP, prism.redirectFraction);
        for (let i = 0; i < nFront; i++) {
          const baseShare = origShares[i];
          if (baseShare <= 0) continue;
          const cIdx = this.frontierCells[i];
          const dx = world.grid.xOf(cIdx) + 0.5 - prism.x;
          const dy = world.grid.yOf(cIdx) + 0.5 - prism.y;
          const along = dx * cosA + dy * sinA;
          const perp = dx * nx + dy * ny;
          // Protected side (-bandWidth .. 0)
          if (Math.abs(along) <= halfLen && perp <= 0 && perp >= -prism.bandWidth) {
            const want = Math.floor(baseShare * frac);
            if (want > 0) {
              wantByCell.set(i, want);
              totalWant[i] += want;
            }
          }
        }
        if (wantByCell.size > 0) {
          prismEntries.push({ receivers, wantByCell });
        }
      }

      for (const entry of prismEntries) {
        let poolRedirected = 0;
        for (const [i, want] of entry.wantByCell) {
          const maxCap = Math.min(origShares[i], Math.floor(origShares[i] * COMBINED_PRISM_REDIRECT_CAP));
          const tot = totalWant[i];
          const actual = tot <= maxCap ? want : Math.floor((want * maxCap) / tot);
          const safeActual = Math.min(actual, cellMicroShares[i]);
          if (safeActual > 0) {
            cellMicroShares[i] -= safeActual;
            poolRedirected += safeActual;
          }
        }
        if (poolRedirected > 0) {
          const perRec = Math.floor(poolRedirected / entry.receivers.length);
          let rem = poolRedirected - perRec * entry.receivers.length;
          for (let r = 0; r < entry.receivers.length; r++) {
            const add = perRec + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
            redirectedAdd[entry.receivers[r]] += add;
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

      const totalMicroCost = this.totalCellMicroCost(
        world,
        cIdx,
        opts.wallResistanceMultiplier,
        opts.gravityAnchorMask,
      );
      if (totalMicroCost <= 0) continue;

      const nextMicro = this.cellMicroWork[cIdx] + effectiveMicro;
      if (nextMicro >= totalMicroCost) {
        if (this.lanternRefCount[cIdx] === 0) {
          this.cellMicroWork[cIdx] = 0;
          physics.consumeCellIntoVoid(world, cIdx, true);
        } else {
          this.cellMicroWork[cIdx] = totalMicroCost - 1;
          world.hp[cIdx] = Math.max(1, world.hp[cIdx]);
        }
      } else {
        this.cellMicroWork[cIdx] = nextMicro;
        const maxHp = world.maxHp[cIdx];
        if (maxHp > 0) {
          const curHp = world.hp[cIdx];
          const remainingMicro = totalMicroCost - nextMicro;
          const nextHp = Math.max(
            this.lanternRefCount[cIdx] > 0 ? 1 : 1,
            Math.ceil((maxHp * remainingMicro) / totalMicroCost),
          );
          if (nextHp < curHp) {
            world.hp[cIdx] = nextHp;
            const prevStage = curHp / maxHp < 0.4 ? 2 : curHp / maxHp < 0.75 ? 1 : 0;
            const nextStage = nextHp / maxHp < 0.4 ? 2 : nextHp / maxHp < 0.75 ? 1 : 0;
            if (prevStage !== nextStage) {
              world.grid.markIndexDirty(cIdx);
            }
          }
        }
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
    this.markContested(targetCellIdx);
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
