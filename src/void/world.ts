/** Seeded procedural metropolitan city generator for Void Defense.
 * Generates a year-3000 New York-style dense urban grid:
 * - Hierarchical street network: 3-cell arterial avenues, 2-cell cross streets,
 *   1-cell service alleys, transit corridors, and green/civic plazas.
 * - Hundreds of distinct small and medium structures: stepped skyscrapers with
 *   stylized height (1 to 28 stories), L-wings, U-courtyards, chamfered glass
 *   towers, art-deco setbacks, industrial foundries, and rooftop infrastructure.
 * - Crisis-start breach zones around initial Void portals: organic multi-lobed
 *   rupture perimeter, pre-damaged building edges, salvage debris, and the
 *   baseline scorable city value present when the Resistance arrives on scene. */

import { dist } from "../exact.ts";
import { PIXELS_PER_FORMER_CELL, TICK_HZ } from "./config.ts";
import { hash, hash01, VoidGrid } from "./grid.ts";
import {
  type BuildingArchStyle,
  CellMaterial,
  type DistrictKind,
  type MetroBuilding,
  type RoofFeatureKind,
  type ScenarioConfig,
  type VoidPortal,
} from "./model.ts";

const ARCH_STYLES_BY_DISTRICT: Record<DistrictKind, readonly BuildingArchStyle[]> = {
  downtown: ["glassTower", "cyberArcology", "artDecoSetback"],
  midtown: ["artDecoSetback", "glassTower", "solarTerrace", "cyberArcology"],
  industrial: ["foundryComplex", "cyberArcology", "solarTerrace"],
  residential: ["solarTerrace", "artDecoSetback", "civicDome"],
  plaza: ["civicDome", "glassTower", "solarTerrace"],
  breach: ["foundryComplex", "artDecoSetback"],
};

const ROOF_FEATURES_SKY: readonly RoofFeatureKind[] = [
  "helipad",
  "spire",
  "commsArray",
  "skyGarden",
  "solarArray",
  "reactorDome",
];

const ROOF_FEATURES_LOW: readonly RoofFeatureKind[] = [
  "solarArray",
  "skyGarden",
  "coolingTowers",
  "commsArray",
  "reactorDome",
];

export class VoidWorld {
  readonly grid: VoidGrid;
  readonly seed: number;
  /** Current material per cell (`CellMaterialId`). */
  readonly material: Uint8Array;
  /** Current structural HP per cell (0..255). */
  readonly hp: Uint8Array;
  /** Maximum structural HP per cell (0..255). */
  readonly maxHp: Uint8Array;
  /** Building ID occupying each cell (`-1` if street/park/void/unclaimed). */
  readonly buildingAt: Int16Array;
  /** Original building ID at start of run (`-1` if not originally a building). */
  readonly originalBuildingAt: Int16Array;
  /** Original material at start of run (used to restore baseline city cells). */
  readonly originalMaterial: Uint8Array;
  /** `1` if this cell was part of the scorable city/land when the Resistance arrived.
   * Extra player-created land outside this mask can divert Void work but cannot
   * inflate the survival percentage above 100%. */
  readonly isBaselineCell: Uint8Array;
  /** Scorable value of each baseline cell (buildings worth more than streets/parks). */
  readonly baselineCellValue: Uint8Array;
  /** Whether a placed Resistance tower currently occupies this cell (`uid`, or `-1`). */
  readonly towerAt: Int16Array;
  /** Street hierarchy bitmask per cell: `1` = vertical arterial avenue, `2` = horizontal cross-street, `4` = internal service alley. */
  readonly streetTier: Uint8Array;

  readonly buildings: MetroBuilding[] = [];
  readonly portals: VoidPortal[] = [];
  /** Total baseline scorable value when gameplay control begins. */
  readonly totalBaselineValue: number;
  readonly totalBaselineWeightedHp: number;

  constructor(scenario: ScenarioConfig, layoutOnly = false) {
    this.grid = new VoidGrid(scenario.worldW, scenario.worldH);
    this.seed = scenario.seed;
    const n = this.grid.count;
    this.material = new Uint8Array(n);
    this.hp = new Uint8Array(n);
    this.maxHp = new Uint8Array(n);
    this.buildingAt = new Int16Array(n).fill(-1);
    this.originalBuildingAt = new Int16Array(n).fill(-1);
    this.originalMaterial = new Uint8Array(n);
    this.isBaselineCell = new Uint8Array(n);
    this.baselineCellValue = new Uint8Array(n);
    this.towerAt = new Int16Array(n).fill(-1);
    this.streetTier = new Uint8Array(n);

    if (layoutOnly) {
      this.generateMetropolis(scenario);
      this.applyInitialBreaches(scenario);
    } else {
      this.generatePixelMetropolis(scenario);
    }
    const totalValue = this.snapshotBaseline();
    let totalHp = 0;
    for (let i = 0; i < n; i++) {
      if (this.isBaselineCell[i]) totalHp += this.hp[i] * this.baselineCellValue[i];
    }
    this.totalBaselineValue = totalValue;
    this.totalBaselineWeightedHp = Math.max(1, totalHp);
  }

  /** Preserve the authored city footprint and income, subdividing every layout
   * cell into four independent pixels. The coarse layout is discarded before play. */
  private generatePixelMetropolis(scenario: ScenarioConfig): void {
    const scale = PIXELS_PER_FORMER_CELL;
    const layout = new VoidWorld({
      ...scenario,
      worldW: Math.ceil(scenario.worldW / scale),
      worldH: Math.ceil(scenario.worldH / scale),
      portals: scenario.portals.map(p => ({ ...p, radius: p.radius / scale })),
    }, true);
    const expand = (cell: number): number[] => {
      const x = layout.grid.xOf(cell) * scale;
      const y = layout.grid.yOf(cell) * scale;
      const cells: number[] = [];
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        if (this.grid.inBounds(x + dx, y + dy)) cells.push(this.grid.index(x + dx, y + dy));
      }
      return cells;
    };
    for (let i = 0; i < layout.grid.count; i++) {
      for (const pixel of expand(i)) {
        this.material[pixel] = layout.material[i];
        this.hp[pixel] = layout.hp[i];
        this.maxHp[pixel] = layout.maxHp[i];
        this.buildingAt[pixel] = layout.buildingAt[i];
        this.streetTier[pixel] = layout.streetTier[i];
      }
    }
    for (const b of layout.buildings) {
      const cells = b.cells.flatMap(expand);
      this.buildings.push({ ...b, x: b.x * scale, y: b.y * scale,
        w: b.w * scale, h: b.h * scale, cells,
        baselineValue: cells.length * (b.isSkyscraper ? 5 : 3) });
    }
    for (const p of layout.portals) {
      this.portals.push({ ...p, x: p.x * scale, y: p.y * scale, radius: p.radius * scale });
    }
  }

  private generateMetropolis(scenario: ScenarioConfig): void {
    const { w, h } = this.grid;
    const seed = this.seed;

    // 1. Lay down base urban pavement & archipelago water/void channels if applicable.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (scenario.id === "archipelagoCity") {
          const river1 = Math.abs(y - Math.floor(h * 0.36) - Math.round(Math.sin(x * 0.08) * 3)) <= 3;
          const river2 = Math.abs(y - Math.floor(h * 0.68) - Math.round(Math.cos(x * 0.07) * 3)) <= 3;
          const bridgeX =
            Math.abs(x - Math.floor(w * 0.25)) <= 2 ||
            Math.abs(x - Math.floor(w * 0.5)) <= 3 ||
            Math.abs(x - Math.floor(w * 0.75)) <= 2;
          if ((river1 || river2) && !bridgeX) {
            this.material[idx] = CellMaterial.UNCLAIMED;
            this.hp[idx] = 12;
            this.maxHp[idx] = 12;
            continue;
          }
        }
        this.material[idx] = CellMaterial.STREET;
        this.hp[idx] = 16;
        this.maxHp[idx] = 16;
        this.streetTier[idx] = 1;
      }
    }

    // 2. Define hierarchical Manhattan avenues (vertical) and cross-streets (horizontal).
    const xBlocks: { x0: number; x1: number }[] = [];
    let cx = 4;
    let colIdx = 0;
    while (cx < w - 8) {
      const bw = 16 + (hash(seed, 101, colIdx) % 8); // 16..23 cells wide
      const x1 = Math.min(w - 4, cx + bw);
      if (x1 - cx >= 8) xBlocks.push({ x0: cx, x1 });
      const aveW = colIdx % 2 === 0 ? 3 : 2;
      cx = x1 + aveW;
      colIdx++;
    }

    const yBlocks: { y0: number; y1: number }[] = [];
    let cy = 4;
    let rowIdx = 0;
    while (cy < h - 8) {
      const bh = 11 + (hash(seed, 202, rowIdx) % 6); // 11..16 cells tall
      const y1 = Math.min(h - 4, cy + bh);
      if (y1 - cy >= 6) yBlocks.push({ y0: cy, y1 });
      const stW = rowIdx % 3 === 0 ? 3 : 2;
      cy = y1 + stW;
      rowIdx++;
    }

    // Mark cross-streets in `streetTier`
    for (let by = 0; by < yBlocks.length; by++) {
      for (let bx = 0; bx < xBlocks.length; bx++) {
        for (let py = yBlocks[by].y0; py < yBlocks[by].y1; py++) {
          for (let px = xBlocks[bx].x0; px < xBlocks[bx].x1; px++) {
            this.streetTier[py * w + px] = 4; // inside block (alley/sidewalk)
          }
        }
      }
    }

    // 3. Subdivide each city block into dense metropolitan parcels.
    const centerX = w * 0.5;
    const centerY = h * 0.5;

    for (let by = 0; by < yBlocks.length; by++) {
      for (let bx = 0; bx < xBlocks.length; bx++) {
        const blkX0 = xBlocks[bx].x0;
        const blkX1 = xBlocks[bx].x1;
        const blkY0 = yBlocks[by].y0;
        const blkY1 = yBlocks[by].y1;
        const blkW = blkX1 - blkX0;
        const blkH = blkY1 - blkY0;

        const distFromCenter =
          dist((blkX0 + blkX1) * 0.5 - centerX, (blkY0 + blkY1) * 0.5 - centerY) / Math.max(w, h);
        const blkRoll = hash01(seed, 303, bx, by);

        let district: DistrictKind = "midtown";
        if (distFromCenter < 0.25) district = "downtown";
        else if (blkRoll < 0.13) district = "plaza";
        else if (distFromCenter > 0.36 && blkRoll < 0.48) district = "industrial";
        else if (blkRoll > 0.7) district = "residential";

        if (district === "plaza") {
          for (let py = blkY0; py < blkY1; py++) {
            for (let px = blkX0; px < blkX1; px++) {
              const idx = py * w + px;
              if (this.material[idx] === CellMaterial.UNCLAIMED) continue;
              const border = px === blkX0 || px === blkX1 - 1 || py === blkY0 || py === blkY1 - 1;
              this.material[idx] = border ? CellMaterial.STREET : CellMaterial.PARK;
              this.hp[idx] = border ? 16 : 14;
              this.maxHp[idx] = this.hp[idx];
            }
          }
          if (blkW >= 10 && blkH >= 8) {
            this.addBuilding(
              blkX0 + Math.floor(blkW / 2) - 2,
              blkY0 + Math.floor(blkH / 2) - 2,
              5,
              5,
              "plaza",
              false,
              6,
              hash(seed, 399, bx, by),
            );
          }
          continue;
        }

        const hasHAlley = blkH >= 11 && hash01(seed, 401, bx, by) < 0.72;
        const alleyY = hasHAlley ? blkY0 + Math.floor(blkH / 2) : -1;

        const rowSlices: { y0: number; y1: number }[] = hasHAlley
          ? [
              { y0: blkY0, y1: alleyY },
              { y0: alleyY + 1, y1: blkY1 },
            ]
          : [{ y0: blkY0, y1: blkY1 }];

        for (let sIdx = 0; sIdx < rowSlices.length; sIdx++) {
          const sy0 = rowSlices[sIdx].y0;
          const sy1 = rowSlices[sIdx].y1;
          const sh = sy1 - sy0;
          if (sh < 3) continue;

          let px = blkX0;
          let lotIdx = 0;
          while (px < blkX1 - 2) {
            const maxLotW = blkX1 - px;
            if (maxLotW < 3) break;
            const wantW =
              district === "downtown"
                ? 5 + (hash(seed, 501, bx, by, sIdx, lotIdx) % 5) // 5..9
                : district === "industrial"
                  ? 5 + (hash(seed, 502, bx, by, sIdx, lotIdx) % 6) // 5..10
                  : 3 + (hash(seed, 503, bx, by, sIdx, lotIdx) % 5); // 3..7
            const lw = Math.min(maxLotW, wantW);
            const lh = Math.min(sh, 3 + (hash(seed, 504, bx, by, sIdx, lotIdx) % Math.max(1, sh - 2)));
            const ly0 = sy0 + (sIdx === 0 ? 0 : sh - lh);

            const skyRoll = hash01(seed, 505, bx, by, sIdx, lotIdx);
            const isSkyscraper =
              (district === "downtown" && skyRoll < 0.75 && lw >= 4 && lh >= 4) ||
              (district === "midtown" && skyRoll < 0.42 && lw >= 4 && lh >= 4);

            const height = isSkyscraper
              ? 14 + (hash(seed, 506, bx, by, sIdx, lotIdx) % 15) // 14..28 stories
              : district === "midtown"
                ? 6 + (hash(seed, 507, bx, by, sIdx, lotIdx) % 7) // 6..12 stories
                : 2 + (hash(seed, 508, bx, by, sIdx, lotIdx) % 5); // 2..6 stories

            this.addBuilding(
              px,
              ly0,
              lw,
              lh,
              district,
              isSkyscraper,
              height,
              hash(seed, 509, bx, by, sIdx, lotIdx),
            );

            const gap = hash01(seed, 510, bx, by, sIdx, lotIdx) < 0.65 ? 1 : 0;
            px += lw + gap;
            lotIdx++;
          }
        }
      }
    }
  }

  private addBuilding(
    x: number,
    y: number,
    w: number,
    h: number,
    district: DistrictKind,
    isSkyscraper: boolean,
    height: number,
    variant: number,
  ): void {
    // Sculpt diverse architectural footprints (L-shaped, U-courtyard, chamfered corners, twin-tower notches)
    const shapeKind = variant % 6;
    const cells: number[] = [];

    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (!this.grid.inBounds(px, py)) continue;
        const lx = px - x;
        const ly = py - y;

        if (w >= 5 && h >= 5) {
          if (shapeKind === 1 && lx >= Math.ceil(w * 0.6) && ly >= Math.ceil(h * 0.6)) {
            // L-shaped tower with corner plaza
            const cIdx = this.grid.index(px, py);
            if (this.material[cIdx] !== CellMaterial.UNCLAIMED) {
              this.material[cIdx] = CellMaterial.PARK;
              this.hp[cIdx] = 14;
              this.maxHp[cIdx] = 14;
            }
            continue;
          }
          if (
            shapeKind === 2 &&
            w >= 6 &&
            h >= 5 &&
            lx >= 2 &&
            lx <= w - 3 &&
            ly === h - 1
          ) {
            // U-shaped courtyard building
            continue;
          }
          if (
            shapeKind === 3 &&
            (lx === 0 || lx === w - 1) &&
            (ly === 0 || ly === h - 1)
          ) {
            // Octagonal / chamfered high-rise
            continue;
          }
          if (
            shapeKind === 4 &&
            w >= 7 &&
            lx === Math.floor(w / 2) &&
            (ly === 0 || ly === h - 1)
          ) {
            // Twin-tower skybridge notch
            continue;
          }
        }

        const idx = this.grid.index(px, py);
        if (this.material[idx] === CellMaterial.UNCLAIMED || this.buildingAt[idx] >= 0) continue;
        cells.push(idx);
      }
    }
    if (cells.length < 4) return;

    const id = this.buildings.length;
    const cellMat = isSkyscraper ? CellMaterial.SKYSCRAPER : CellMaterial.BUILDING;
    const cellHp = isSkyscraper ? Math.min(115, 42 + height * 2) : Math.min(64, 24 + height * 2);
    const perCellVal = isSkyscraper ? 5 : 3;

    for (const idx of cells) {
      this.material[idx] = cellMat;
      this.hp[idx] = cellHp;
      this.maxHp[idx] = cellHp;
      this.buildingAt[idx] = id;
    }

    const styles = ARCH_STYLES_BY_DISTRICT[district] ?? ARCH_STYLES_BY_DISTRICT.midtown;
    const archStyle = styles[variant % styles.length];
    const roofList = isSkyscraper ? ROOF_FEATURES_SKY : ROOF_FEATURES_LOW;
    const roofFeature =
      district === "industrial" && (variant >> 3) % 2 === 0
        ? "reactorDome"
        : district === "plaza"
          ? "skyGarden"
          : roofList[(variant >> 2) % roofList.length];

    const baselineValue = cells.length * perCellVal;
    const baseIncome = Math.max(
      1,
      Math.round(cells.length * (isSkyscraper ? 0.45 : 0.25) + height * 0.15),
    );

    this.buildings.push({
      id,
      x,
      y,
      w,
      h,
      district,
      isSkyscraper,
      archStyle,
      roofFeature,
      height,
      cells,
      baselineValue,
      baseIncome,
      development: 1.0,
      variant,
    });
  }

  /** Carves the initial teleporter disaster craters & active Void breaches
   * with organic multi-lobed tendril edges while staying inside `p.radius + 1.2`
   * so full-crater Landfall/Matter reclamation remains deterministic. */
  private applyInitialBreaches(scenario: ScenarioConfig): void {
    const { w, h } = this.grid;
    scenario.portals.forEach((p, idx) => {
      const px = Math.max(6, Math.min(w - 7, Math.round(p.xFrac * w)));
      const py = Math.max(6, Math.min(h - 7, Math.round(p.yFrac * h)));
      const activateAtTick = Math.round(p.activateAtSeconds * TICK_HZ);
      const active = activateAtTick <= 0;

      this.portals.push({
        id: idx,
        x: px,
        y: py,
        radius: p.radius,
        activateAtTick,
        active,
      });

      if (!active) return;

      const phase = hash01(this.seed, 881, idx) * Math.PI * 2;
      const outerR = p.radius + 5;
      for (let y = Math.max(0, py - outerR); y <= Math.min(h - 1, py + outerR); y++) {
        for (let x = Math.max(0, px - outerR); x <= Math.min(w - 1, px + outerR); x++) {
          const dx = x - px;
          const dy = y - py;
          const d = dist(dx, dy);
          const angle = Math.atan2(dy, dx);
          // Multi-lobed cosmic fracture contour bounded strictly <= p.radius + 1.1
          const lobeWave =
            Math.sin(angle * 5 + phase) * 0.18 +
            Math.cos(angle * 3 - phase * 0.7) * 0.14 +
            Math.sin(angle * 8 + phase * 1.3) * 0.08;
          const jitter = (hash01(this.seed, 888, idx, x, y) - 0.5) * 1.4;
          const effectiveR = Math.min(p.radius + 1.1, p.radius * (0.82 + lobeWave));
          const cellIdx = y * w + x;

          if (d + jitter * 0.5 <= effectiveR) {
            this.material[cellIdx] = CellMaterial.VOID;
            this.hp[cellIdx] = 0;
            this.buildingAt[cellIdx] = -1;
          } else if (d <= effectiveR + 3.2) {
            if (hash01(this.seed, 889, idx, x, y) < 0.48) {
              this.material[cellIdx] = CellMaterial.SALVAGE;
              this.hp[cellIdx] = 18;
              this.maxHp[cellIdx] = 24;
              this.buildingAt[cellIdx] = -1;
            } else {
              this.hp[cellIdx] = Math.max(6, Math.floor(this.hp[cellIdx] * 0.55));
            }
          }
        }
      }
    });

    for (const b of this.buildings) {
      b.cells = b.cells.filter(
        (c) => this.buildingAt[c] === b.id && this.material[c] !== CellMaterial.VOID,
      );
      const perCellVal = b.isSkyscraper ? 5 : 3;
      b.baselineValue = b.cells.length * perCellVal;
    }
  }

  /** Records the exact scorable baseline present when player control begins. */
  private snapshotBaseline(): number {
    let total = 0;
    const n = this.grid.count;
    for (let i = 0; i < n; i++) {
      const mat = this.material[i];
      this.originalMaterial[i] = mat;
      this.originalBuildingAt[i] = this.buildingAt[i];
      if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED) {
        this.isBaselineCell[i] = 0;
        this.baselineCellValue[i] = 0;
        continue;
      }
      this.isBaselineCell[i] = 1;
      const val =
        mat === CellMaterial.SKYSCRAPER
          ? 5
          : mat === CellMaterial.BUILDING
            ? 3
            : 1;
      this.baselineCellValue[i] = val;
      total += val;
    }
    return Math.max(1, total);
  }

  /** Calculates current preserved scorable baseline value (never exceeding `totalBaselineValue`). */
  computePreservedBaseline(): {
    preservedValue: number;
    preservedWeightedHp: number;
    preservedRatio: number;
    preservedPercent: number;
  } {
    let preserved = 0;
    let weightedHp = 0;
    const n = this.grid.count;
    for (let i = 0; i < n; i++) {
      if (!this.isBaselineCell[i]) continue;
      const mat = this.material[i];
      if (mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED && this.hp[i] > 0) {
        const val = this.baselineCellValue[i];
        preserved += val;
        weightedHp += Math.min(this.hp[i], this.maxHp[i]) * val;
      }
    }
    const capped = Math.min(this.totalBaselineValue, preserved);
    const cappedHp = Math.min(this.totalBaselineWeightedHp, weightedHp);
    const ratio =
      capped === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (capped / this.totalBaselineValue) * 0.7 +
                (cappedHp / this.totalBaselineWeightedHp) * 0.3,
            ),
          );
    return {
      preservedValue: capped,
      preservedWeightedHp: cappedHp,
      preservedRatio: ratio,
      preservedPercent: Math.round(ratio * 1000) / 10,
    };
  }
}
