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
import { CellMaterial, type ScenarioConfig, type VoidNode, type ZeroContactReason } from "./model.ts";
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
    this.rebuildFrontier(world);
  }

  /** Scans the grid to rebuild `frontierCells`, `frontierContactCount`, and `voidCellCount`. */
  rebuildFrontier(world: VoidWorld): void {
    this.frontierCells.length = 0;
    this.frontierContactCount.fill(0);
    let vCount = 0;
    const { w, h, count } = world.grid;
    const mat = world.material;

    for (let i = 0; i < count; i++) {
      if (mat[i] === CellMaterial.VOID) {
        vCount++;
        continue;
      }
      const x = i % w;
      const y = (i / w) | 0;
      let contacts = 0;
      if (x > 0 && mat[i - 1] === CellMaterial.VOID) contacts++;
      if (x + 1 < w && mat[i + 1] === CellMaterial.VOID) contacts++;
      if (y > 0 && mat[i - w] === CellMaterial.VOID) contacts++;
      if (y + 1 < h && mat[i + w] === CellMaterial.VOID) contacts++;

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
              physics.consumeCellIntoVoid(world, y * w + x, true);
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

    for (let i = 0; i < this.frontierCells.length; i++) {
      const cIdx = this.frontierCells[i];
      const shareMicro = Math.floor((totalMicroWork * weights[i]) / totalWeightedEdges);
      if (shareMicro <= 0) continue;
      spentMicroWork += shareMicro;

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
        if (hpLoss >= curHp) {
          this.cellMicroWork[cIdx] = 0;
          physics.consumeCellIntoVoid(world, cIdx, true);
        } else {
          const maxHp = Math.max(1, world.maxHp[cIdx]);
          const nextHp = curHp - hpLoss;
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
