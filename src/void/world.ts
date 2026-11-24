/** Seeded procedural world generator for Void Defense.
 * Generates a year-3000 metropolis that gives way to open country before the Void:
 * - A city-to-Void gradient (`zone`): dense urban blocks far from the portals, a leafy
 *   low-rise suburb band, then countryside around each portal with an organic,
 *   noise-jittered boundary.
 * - Hierarchical street network in the city: 3-cell arterial avenues, 2-cell cross
 *   streets, 1-cell service alleys, transit corridors, and green/civic plazas.
 * - Hundreds of distinct structures: stepped skyscrapers with stylized height (1 to 28
 *   stories), L-wings, U-courtyards, chamfered glass towers, art-deco setbacks,
 *   industrial foundries, and rooftop infrastructure.
 * - Countryside: grass and meadow, forest blobs, a meandering river with bridges,
 *   winding dirt roads continuing the avenues out of the city, crop fields and
 *   orchards along the roads, and homestead/barn hamlets with silos (`landCover`).
 * - Crisis-start breach zones around initial Void portals: organic multi-lobed
 *   rupture perimeter, pre-damaged edges, salvage debris, and the baseline scorable
 *   value present when the Resistance arrives on scene. */

import { dist } from "../exact.ts";
import { PARKING_STREET_TIER, PIXELS_PER_FORMER_CELL, TICK_HZ } from "./config.ts";
import { hash, hash01, VoidGrid } from "./grid.ts";
import {
  type BuildingArchStyle,
  CellMaterial,
  type DistrictKind,
  LandCover,
  type MetroBuilding,
  type RoofFeatureKind,
  type ScenarioConfig,
  type VoidPortal,
  ZoneKind,
} from "./model.ts";

/** Default countryside band (cells beyond each portal's radius). */
const DEFAULT_COUNTRYSIDE = { ruralCells: 30, suburbCells: 16 } as const;

const ARCH_STYLES_BY_DISTRICT: Record<DistrictKind, readonly BuildingArchStyle[]> = {
  downtown: ["glassTower", "cyberArcology", "artDecoSetback"],
  midtown: ["artDecoSetback", "glassTower", "solarTerrace", "cyberArcology"],
  industrial: ["foundryComplex", "cyberArcology", "solarTerrace"],
  residential: ["solarTerrace", "artDecoSetback", "civicDome"],
  plaza: ["civicDome", "glassTower", "solarTerrace"],
  breach: ["foundryComplex", "artDecoSetback"],
  rural: ["homestead", "homestead", "barn"],
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

/** Street corridor widths in coarse layout cells (each becomes 2x2 world pixels). Horizontal
 * corridors are one cell wider than vertical ones so they read the same width under the
 * oblique building faces. */
export const V_AVENUE_W = 5;
export const H_AVENUE_W = 6;
export const V_BOULEVARD_W = 9;
export const H_BOULEVARD_W = 10;

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
  /** Street hierarchy bitmask per cell: `1` = vertical arterial avenue, `2` = horizontal cross-street, `4` = internal service alley, `8` = winding country road. */
  readonly streetTier: Uint8Array;
  /** Render-only surface detail (`LandCoverId`): grass, forest, fields, dirt roads, river, bridges, silos. */
  readonly landCover: Uint8Array;
  /** Sparse crop index used by the living wheat pass, including created islands. */
  readonly wheatCells = new Set<number>();
  readonly farmScorch: Uint8Array;
  /** City-to-Void gradient class per cell (`ZoneKindId`): rural near portals, suburb, then urban. */
  readonly zone: Uint8Array;
  /** Continuous urbanity 0 (deep countryside) .. 255 (city core) used to bias building heights. */
  readonly urbanity: Uint8Array;
  /** Remaining vertical stories per building footprint column (`0..30`, or `0` for non-building cells). */
  readonly columnFloors: Uint8Array;

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
    this.landCover = new Uint8Array(n);
    this.farmScorch = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.urbanity = new Uint8Array(n);
    this.columnFloors = new Uint8Array(n);

    if (layoutOnly) {
      this.computeZones(scenario);
      this.generateMetropolis(scenario);
      this.generateCountryside(scenario);
      this.applyInitialBreaches(scenario);
    } else {
      this.generatePixelMetropolis(scenario);
    }
    for (let i = 0; i < n; i++) {
      if (this.landCover[i] === LandCover.FIELD_H || this.landCover[i] === LandCover.FIELD_V) this.wheatCells.add(i);
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
      countryside: scenario.countryside && { ruralCells: scenario.countryside.ruralCells / scale,
        suburbCells: scenario.countryside.suburbCells / scale },
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
        this.landCover[pixel] = layout.landCover[i];
        this.zone[pixel] = layout.zone[i];
        this.urbanity[pixel] = layout.urbanity[i];
        this.columnFloors[pixel] = layout.columnFloors[i];
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

  /** Classifies every cell along the city-to-Void gradient. Distance to the nearest
   * portal rim (active or delayed), warped by low-frequency noise so the countryside
   * boundary meanders and forest fingers reach into the suburbs. */
  private computeZones(scenario: ScenarioConfig): void {
    const { w, h } = this.grid;
    const band = scenario.countryside ?? DEFAULT_COUNTRYSIDE;
    const ruralR = band.ruralCells;
    const suburbR = band.ruralCells + band.suburbCells;
    const ph1 = hash01(this.seed, 71) * Math.PI * 2;
    const ph2 = hash01(this.seed, 72) * Math.PI * 2;
    const portals = scenario.portals.map((p) => ({
      x: Math.max(6, Math.min(w - 7, Math.round(p.xFrac * w))),
      y: Math.max(6, Math.min(h - 7, Math.round(p.yFrac * h))),
      r: p.radius,
    }));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let d = Number.POSITIVE_INFINITY;
        for (const p of portals) {
          d = Math.min(d, dist(x - p.x, y - p.y) - p.r);
        }
        const noise =
          Math.sin(x * 0.085 + ph1) * Math.cos(y * 0.067 - ph2) * 5.5 +
          Math.sin(x * 0.031 + y * 0.044 + ph2) * 4.5 +
          (hash01(this.seed, 73, x >> 2, y >> 2) - 0.5) * 3;
        const dd = d + noise;
        const idx = y * w + x;
        const u = Math.max(0, Math.min(1, (dd - ruralR) / Math.max(1, suburbR - ruralR)));
        this.urbanity[idx] = Math.round(u * 255);
        this.zone[idx] = dd < ruralR ? ZoneKind.RURAL : dd < suburbR ? ZoneKind.SUBURB : ZoneKind.URBAN;
      }
    }
  }

  private zoneAtBlock(x0: number, x1: number, y0: number, y1: number): number {
    const cx = Math.min(this.grid.w - 1, (x0 + x1) >> 1);
    const cy = Math.min(this.grid.h - 1, (y0 + y1) >> 1);
    return this.zone[cy * this.grid.w + cx];
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

    // 2. Define 3-tier street hierarchy:
    //    Tier 1: Wide boulevards (vertical 9 coarse cells = 18 world px with a 2 px central median `streetTier = 3`;
    //            horizontal 10 coarse cells = 20 world px with a 4 px median)
    //    Tier 2: Medium avenues (vertical 5 coarse cells = 10 world px, horizontal 6 = 12 world px, `streetTier = 2`)
    //    Horizontal streets are one coarse cell (2 world px) wider than vertical streets of the same tier, because
    //    the oblique building faces overhang the street to their south and would otherwise make them look narrower.
    //    Tier 3: Narrow alleys inside blocks (1 coarse cell = 2 world px wide, `streetTier = 4`, used sparingly)
    const xBlocks: { x0: number; x1: number; afterTier: 1 | 2; afterW: number }[] = [];
    let cx = 4;
    let colIdx = 0;
    while (cx < w - 10) {
      const bw =
        colIdx === 0
          ? 19
          : colIdx === 1
            ? 21
            : 20 + (hash(seed, 101, colIdx) % 7); // 19..26 coarse cells (38..52 world px)
      const x1 = Math.min(w - 4, cx + bw);
      const isBlvd = colIdx % 2 === 1;
      const afterW = isBlvd ? V_BOULEVARD_W : V_AVENUE_W;
      if (x1 - cx >= 10) xBlocks.push({ x0: cx, x1, afterTier: isBlvd ? 1 : 2, afterW });
      cx = x1 + afterW;
      colIdx++;
    }

    const yBlocks: { y0: number; y1: number; afterTier: 1 | 2; afterW: number }[] = [];
    let cy = 3;
    let rowIdx = 0;
    while (cy < h - 10) {
      const bh =
        rowIdx === 0
          ? 12
          : rowIdx === 1
            ? 15
            : rowIdx === 2
              ? 16
              : 15 + (hash(seed, 202, rowIdx) % 6); // 15..20 coarse cells (30..40 world px)
      const y1 = Math.min(h - 4, cy + bh);
      const isBlvd = rowIdx >= 2 && rowIdx % 2 === 0;
      const afterW = isBlvd ? H_BOULEVARD_W : H_AVENUE_W;
      if (y1 - cy >= 8) yBlocks.push({ y0: cy, y1, afterTier: isBlvd ? 1 : 2, afterW });
      cy = y1 + afterW;
      rowIdx++;
    }

    // Default all street corridors to medium avenue (`streetTier = 2`), then paint wide boulevards (`streetTier = 1`)
    // and their raised central medians (`streetTier = 3`, interrupted at cross-street intersections).
    for (let i = 0; i < this.grid.count; i++) {
      if (this.material[i] === CellMaterial.STREET) {
        this.streetTier[i] = 2;
      }
    }

    const inXBlock = (x: number): boolean => {
      for (let i = 0; i < xBlocks.length; i++) {
        if (x >= xBlocks[i].x0 && x < xBlocks[i].x1) return true;
      }
      return false;
    };
    const inYBlock = (y: number): boolean => {
      for (let i = 0; i < yBlocks.length; i++) {
        if (y >= yBlocks[i].y0 && y < yBlocks[i].y1) return true;
      }
      return false;
    };

    for (let bx = 0; bx < xBlocks.length; bx++) {
      const blk = xBlocks[bx];
      if (blk.afterTier !== 1) continue;
      const sx0 = blk.x1;
      const sx1 = Math.min(w, sx0 + blk.afterW);
      const midX = sx0 + (blk.afterW >> 1);
      for (let y = 0; y < h; y++) {
        const isSegmentBetweenCrossStreets = inYBlock(y);
        for (let x = sx0; x < sx1; x++) {
          const idx = y * w + x;
          if (this.material[idx] !== CellMaterial.STREET) continue;
          this.streetTier[idx] = x === midX && isSegmentBetweenCrossStreets && (y & 7) !== 0 ? 3 : 1;
        }
      }
    }

    for (let by = 0; by < yBlocks.length; by++) {
      const blk = yBlocks[by];
      if (blk.afterTier !== 1) continue;
      const sy0 = blk.y1;
      const sy1 = Math.min(h, sy0 + blk.afterW);
      // Even-width horizontal boulevards get a two-cell median so both carriageways match.
      const midY = sy0 + (blk.afterW >> 1);
      const isMedianRow = (y: number): boolean => y === midY || ((blk.afterW & 1) === 0 && y === midY - 1);
      for (let y = sy0; y < sy1; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (this.material[idx] !== CellMaterial.STREET) continue;
          const isSegmentBetweenAvenues = inXBlock(x);
          if (isMedianRow(y) && isSegmentBetweenAvenues && (x & 7) !== 0) {
            this.streetTier[idx] = 3;
          } else if (this.streetTier[idx] !== 3) {
            this.streetTier[idx] = 1;
          }
        }
      }
    }

    // Mark block interiors as tier 4 (sidewalk / setback / alley)
    for (let by = 0; by < yBlocks.length; by++) {
      for (let bx = 0; bx < xBlocks.length; bx++) {
        for (let py = yBlocks[by].y0; py < yBlocks[by].y1; py++) {
          for (let px = xBlocks[bx].x0; px < xBlocks[bx].x1; px++) {
            const idx = py * w + px;
            if (this.material[idx] === CellMaterial.STREET) {
              this.streetTier[idx] = 4;
            }
          }
        }
      }
    }

    // Crosstown canal / drainage channel cutting across the lower city (with wide bridges on boulevards and avenues)
    if (scenario.id !== "archipelagoCity" && yBlocks.length >= 4) {
      const canalBlk = yBlocks[Math.min(yBlocks.length - 2, Math.floor(yBlocks.length * 0.78))];
      const canalY = canalBlk.y0 + Math.floor((canalBlk.y1 - canalBlk.y0) * 0.5);
      for (let y = Math.max(2, canalY - 1); y <= Math.min(h - 3, canalY + 1); y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (this.zone[idx] !== ZoneKind.URBAN) continue;
          if (!inXBlock(x)) continue;
          if (y === canalY) {
            this.material[idx] = CellMaterial.UNCLAIMED;
            this.hp[idx] = 14;
            this.maxHp[idx] = 14;
            this.landCover[idx] = LandCover.NONE;
          } else {
            this.material[idx] = CellMaterial.STREET;
            this.streetTier[idx] = 4;
            this.hp[idx] = 16;
            this.maxHp[idx] = 16;
          }
        }
      }
    }

    // 3. Subdivide each city superblock into larger, calmer metropolitan footprints with open lots & setbacks.
    const centerX = w * 0.5;
    const centerY = h * 0.52;
    const portalCenters = scenario.portals.map((p) => ({
      x: Math.round(p.xFrac * w),
      y: Math.round(p.yFrac * h),
      r: p.radius,
    }));

    for (let by = 0; by < yBlocks.length; by++) {
      for (let bx = 0; bx < xBlocks.length; bx++) {
        const blkX0 = xBlocks[bx].x0;
        const blkX1 = xBlocks[bx].x1;
        const blkY0 = yBlocks[by].y0;
        const blkY1 = yBlocks[by].y1;
        const blkW = blkX1 - blkX0;
        const blkH = blkY1 - blkY0;

        const blockZone = this.zoneAtBlock(blkX0, blkX1, blkY0, blkY1);
        const isSuburb = blockZone !== ZoneKind.URBAN;

        const blkCx = (blkX0 + blkX1) * 0.5;
        const blkCy = (blkY0 + blkY1) * 0.5;
        const distFromCore = dist(blkCx - centerX, blkCy - centerY) / Math.max(w, h);
        const blkRoll = hash01(seed, 303, bx, by);
        const blkUrbanity = this.urbanity[Math.min(h - 1, (blkY0 + blkY1) >> 1) * w + Math.min(w - 1, (blkX0 + blkX1) >> 1)] / 255;

        let minPortalClearance = Number.POSITIVE_INFINITY;
        for (let pi = 0; pi < portalCenters.length; pi++) {
          const p = portalCenters[pi];
          const d = dist(blkCx - p.x, blkCy - p.y) - p.r;
          if (d < minPortalClearance) minPortalClearance = d;
        }
        const nearBreach = minPortalClearance < 4;

        let district: DistrictKind = "midtown";
        if (isSuburb) district = blkRoll < 0.22 ? "plaza" : "residential";
        else if (distFromCore < 0.25 && blkUrbanity > 0.78) district = "downtown";
        else if (blkRoll < 0.11 && !(bx <= 1 && by <= 2)) district = "plaza";
        else if (distFromCore > 0.36 && blkRoll < 0.45 && blkUrbanity > 0.58) district = "industrial";
        else if (blkRoll > 0.74 || blkUrbanity < 0.45) district = "residential";

        if (district === "plaza") {
          const openKind = hash(seed, 311, bx, by) % 3; // 0 = green park, 1 = civic plaza + pavilion, 2 = parking/rubble commons
          for (let py = blkY0; py < blkY1; py++) {
            for (let px = blkX0; px < blkX1; px++) {
              const idx = py * w + px;
              if (this.material[idx] === CellMaterial.UNCLAIMED) continue;
              const border = px === blkX0 || px === blkX1 - 1 || py === blkY0 || py === blkY1 - 1;
              if (openKind === 2 && !isSuburb && !border) {
                this.material[idx] = CellMaterial.STREET;
                this.streetTier[idx] = PARKING_STREET_TIER;
                this.hp[idx] = 16;
                this.maxHp[idx] = 16;
              } else {
                this.material[idx] = border ? CellMaterial.STREET : CellMaterial.PARK;
                this.hp[idx] = border ? 16 : 14;
                this.maxHp[idx] = this.hp[idx];
                if (!border && isSuburb) {
                  this.landCover[idx] = hash01(seed, 304, px, py) < 0.3 ? LandCover.FOREST : LandCover.GRASS;
                }
              }
            }
          }
          if (openKind !== 0 && blkW >= 10 && blkH >= 8 && !isSuburb) {
            this.addBuilding(
              blkX0 + Math.floor(blkW / 2) - 3,
              blkY0 + Math.floor(blkH / 2) - 2,
              6,
              5,
              "plaza",
              false,
              6,
              hash(seed, 399, bx, by),
            );
          }
          continue;
        }

        // Use narrow interior alleys sparingly (~35% of tall blocks) so blocks hold larger, calmer footprints
        const hasHAlley = blkH >= 13 && hash01(seed, 401, bx, by) < 0.35;
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
          if (sh < 4) continue;

          let px = blkX0;
          let lotIdx = 0;
          while (px < blkX1 - 3) {
            const maxLotW = blkX1 - px;
            if (maxLotW < 4) break;
            const wantW =
              district === "downtown"
                ? 6 + (hash(seed, 501, bx, by, sIdx, lotIdx) % 5) // 6..10 coarse (12..20 world px)
                : district === "industrial"
                  ? 6 + (hash(seed, 502, bx, by, sIdx, lotIdx) % 6) // 6..11 coarse (12..22 world px)
                  : isSuburb
                    ? 3 + (hash(seed, 503, bx, by, sIdx, lotIdx) % 3) // 3..5 leafy lots
                    : 5 + (hash(seed, 503, bx, by, sIdx, lotIdx) % 5); // 5..9 coarse (10..18 world px)
            const lw = Math.min(maxLotW, wantW);

            // Breathing room: ~14% of urban parcels become calm open lots (pocket parks, parking lots, or rubble lots)
            const openLotRoll = hash01(seed, 515, bx, by, sIdx, lotIdx);
            if (!isSuburb && !(bx <= 1 && by <= 2 && sIdx === 0) && openLotRoll < (district === "downtown" ? 0.08 : 0.15)) {
              const openType = hash(seed, 516, bx, by, sIdx, lotIdx) % 3;
              for (let py = sy0; py < sy1; py++) {
                for (let lx = px; lx < px + lw; lx++) {
                  const i = py * w + lx;
                  if (this.material[i] === CellMaterial.UNCLAIMED || this.zone[i] === ZoneKind.RURAL) continue;
                  if (openType === 0) {
                    this.material[i] = CellMaterial.PARK;
                    this.hp[i] = 14;
                    this.maxHp[i] = 14;
                    this.landCover[i] = LandCover.NONE;
                  } else if (openType === 1) {
                    this.material[i] = CellMaterial.STREET;
                    this.streetTier[i] = PARKING_STREET_TIER;
                    this.hp[i] = 16;
                    this.maxHp[i] = 16;
                  } else {
                    const isRubble = hash01(seed, 517, lx, py) < 0.22;
                    this.material[i] = isRubble ? CellMaterial.SALVAGE : CellMaterial.STREET;
                    this.streetTier[i] = 4;
                    this.hp[i] = 16;
                    this.maxHp[i] = 16;
                  }
                }
              }
              px += lw + 1;
              lotIdx++;
              continue;
            }

            const lh = Math.min(
              isSuburb ? Math.min(sh, 4) : sh,
              (isSuburb ? 3 : 4) + (hash(seed, 504, bx, by, sIdx, lotIdx) % Math.max(1, sh - (isSuburb ? 2 : 3))),
            );
            const ly0 = sy0 + (sIdx === 0 ? 0 : sh - lh);

            const skyRoll = hash01(seed, 505, bx, by, sIdx, lotIdx);
            const isSkyscraper =
              !isSuburb &&
              !nearBreach &&
              lw >= 4 &&
              lh >= 4 &&
              ((district === "downtown" && skyRoll < 0.80) ||
                (district === "midtown" && skyRoll < 0.45));

            // Strong downtown-to-edge height gradient: tall downtown core fading to lower, sparser outer edges
            const coreFactor = Math.max(0, Math.min(1, (1 - distFromCore * 1.6) * 0.6 + blkUrbanity * 0.45));
            const heightBias = Math.round(coreFactor * 7);
            let height = isSkyscraper
              ? Math.min(30, 15 + heightBias + (hash(seed, 506, bx, by, sIdx, lotIdx) % 11)) // 15..30 stories
              : district === "downtown" || district === "midtown"
                ? 7 + Math.round(coreFactor * 4) + (hash(seed, 507, bx, by, sIdx, lotIdx) % 7) // 7..17 stories
                : isSuburb
                  ? 1 + (hash(seed, 508, bx, by, sIdx, lotIdx) % 3) // 1..3 stories
                  : 2 + (hash(seed, 508, bx, by, sIdx, lotIdx) % 5); // 2..6 stories at edges
            if (nearBreach) {
              height = Math.min(height, 6);
            }

            const gap = isSuburb ? 1 + (hash(seed, 510, bx, by, sIdx, lotIdx) % 2) : 1;
            let variant = hash(seed, 509, bx, by, sIdx, lotIdx);
            if (isSkyscraper && bx === (xBlocks.length >> 1) && lotIdx === 0) {
              district = "downtown";
              variant = variant - (variant % 3);
              height = Math.max(22, height);
            }
            // Leave a 1-cell setback on wider parcels so buildings don't pack edge-to-edge
            const buildingWidth = !isSuburb && lw >= 7 ? lw - 1 : lw;
            this.addBuilding(
              px, ly0, buildingWidth, lh, district, isSkyscraper, height, variant,
            );

            const parkingY = sIdx === 0 ? ly0 + lh : sy0;
            const parkingEnd = sIdx === 0 ? sy1 : ly0;
            if (!isSuburb && lw >= 4 && parkingEnd - parkingY >= 2) {
              for (let py = parkingY; py < parkingEnd; py++) {
                for (let lx = px; lx < px + lw; lx++) {
                  const i = py * w + lx;
                  if (this.material[i] === CellMaterial.STREET && this.zone[i] !== ZoneKind.RURAL) {
                    this.streetTier[i] = PARKING_STREET_TIER;
                  }
                }
              }
            }

            px += buildingWidth + gap;
            lotIdx++;
          }
        }

        // Suburban blocks: gaps between lots become lawns and garden trees
        if (isSuburb) {
          for (let py = blkY0; py < blkY1; py++) {
            for (let px = blkX0; px < blkX1; px++) {
              const idx = py * w + px;
              if (this.material[idx] === CellMaterial.STREET && this.streetTier[idx] === 4) {
                if (hash01(seed, 511, px, py) < 0.85) {
                  this.material[idx] = CellMaterial.PARK;
                  this.hp[idx] = 20;
                  this.maxHp[idx] = 20;
                  this.landCover[idx] = hash01(seed, 512, px, py) < 0.28 ? LandCover.FOREST : LandCover.GRASS;
                }
              }
            }
          }
        }
      }
    }
  }

  /** Paints the countryside around each portal: grass and meadow, forest blobs, a
   * meandering river, dirt roads continuing the avenues toward the anomaly, crop
   * fields and orchards beside the roads, and homestead hamlets with silos. */
  private generateCountryside(scenario: ScenarioConfig): void {
    const { w, h } = this.grid;
    const seed = this.seed;
    const ph1 = hash01(seed, 81) * Math.PI * 2;
    const ph2 = hash01(seed, 82) * Math.PI * 2;
    const ph3 = hash01(seed, 83) * Math.PI * 2;

    const isRural = (x: number, y: number): boolean =>
      this.grid.inBounds(x, y) && this.zone[y * w + x] === ZoneKind.RURAL;

    // 1. Base cover: open grass with meadow patches and forest blobs
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (this.zone[idx] !== ZoneKind.RURAL) continue;
        if (this.material[idx] === CellMaterial.UNCLAIMED) continue; // archipelago water stays water
        this.material[idx] = CellMaterial.PARK;
        this.hp[idx] = 14;
        this.maxHp[idx] = 14;
        this.buildingAt[idx] = -1;
        this.streetTier[idx] = 0;
        const f =
          Math.sin(x * 0.17 + ph1) * Math.cos(y * 0.15 + ph2) * 0.5 +
          Math.sin((x + y) * 0.09 + ph3) * 0.3 +
          Math.cos((x - y * 1.7) * 0.06 - ph1) * 0.2 +
          (hash01(seed, 84, x, y) - 0.5) * 0.35;
        this.landCover[idx] =
          f > 0.38 ? LandCover.FOREST : f < -0.45 ? LandCover.MEADOW : LandCover.GRASS;
        this.hp[idx] = f > 0.38 ? 58 : f < -0.45 ? 38 : 46;
        this.maxHp[idx] = this.hp[idx];
      }
    }

    // 2. Meandering river(s) along the long axis, only where the land is countryside
    const portals = scenario.portals.map((p) => ({
      x: Math.max(6, Math.min(w - 7, Math.round(p.xFrac * w))),
      y: Math.max(6, Math.min(h - 7, Math.round(p.yFrac * h))),
      r: p.radius,
    }));
    const vertical = h >= w;
    const riverCount = Math.max(1, Math.min(2, portals.length));
    for (let ri = 0; ri < riverCount; ri++) {
      const p = portals[ri % portals.length];
      const side = hash01(seed, 85, ri) < 0.5 ? -1 : 1;
      const offset = side * (p.r + 6 + Math.round(hash01(seed, 86, ri) * 9));
      const len = vertical ? h : w;
      for (let t = 0; t < len; t++) {
        const wobble =
          Math.sin(t * 0.055 + ph1 + ri) * 7 + Math.sin(t * 0.017 + ph2) * 5 + Math.cos(t * 0.11 + ph3) * 1.5;
        const c = Math.round((vertical ? p.x : p.y) + offset + wobble);
        const width = hash01(seed, 87, ri, t >> 3) < 0.3 ? 3 : 2;
        for (let k = -1; k < width - 1; k++) {
          const x = vertical ? c + k : t;
          const y = vertical ? t : c + k;
          if (!isRural(x, y)) continue;
          const idx = y * w + x;
          if (this.buildingAt[idx] >= 0) continue;
          this.material[idx] = CellMaterial.UNCLAIMED;
          this.hp[idx] = 26;
          this.maxHp[idx] = 26;
          this.landCover[idx] = LandCover.RIVER;
        }
        // Sandy / reedy banks
        for (const k of [-2, width - 1]) {
          const x = vertical ? c + k : t;
          const y = vertical ? t : c + k;
          if (!isRural(x, y)) continue;
          const idx = y * w + x;
          if (this.material[idx] === CellMaterial.PARK && this.landCover[idx] !== LandCover.FOREST) {
            this.landCover[idx] = LandCover.MEADOW;
          }
        }
      }
    }

    // 3. Winding dirt roads: every avenue / cross-street that leaves the city keeps going
    //    as a country lane toward the nearest anomaly, wobbling across the fields.
    const roads: { x: number; y: number }[][] = [];
    const tryRoad = (sx: number, sy: number, dirX: number, dirY: number, id: number): void => {
      if (roads.length >= 5) return;
      // Walk from the city edge into the countryside until the first rural cell
      let x = sx;
      let y = sy;
      let guard = 0;
      while (guard++ < Math.max(w, h) && this.grid.inBounds(x, y) && !isRural(x, y)) {
        x += dirX;
        y += dirY;
      }
      if (!isRural(x, y)) return;
      // Nearest portal from the exit point decides where the lane heads
      let target = portals[0];
      let best = Number.POSITIVE_INFINITY;
      for (const p of portals) {
        const d = dist(p.x - x, p.y - y);
        if (d < best) {
          best = d;
          target = p;
        }
      }
      const path: { x: number; y: number }[] = [];
      let fx = x;
      let fy = y;
      let t = 0;
      while (t++ < 400) {
        const dx = target.x - fx;
        const dy = target.y - fy;
        const d = dist(dx, dy);
        if (d <= target.r + 2.5) break;
        const nx = dx / d;
        const ny = dy / d;
        // Lateral wobble perpendicular to the heading
        const wob = Math.sin(t * 0.09 + id * 1.7 + ph2) * 0.75 + Math.sin(t * 0.023 + id) * 0.45;
        fx += nx * 0.92 - ny * wob;
        fy += ny * 0.92 + nx * wob;
        const cx = Math.round(fx);
        const cy = Math.round(fy);
        if (!this.grid.inBounds(cx, cy)) break;
        if (!isRural(cx, cy)) continue;
        const last = path[path.length - 1];
        if (last && last.x === cx && last.y === cy) continue;
        // Keep the lane 4-connected so it reads as one ribbon
        if (last && Math.abs(last.x - cx) + Math.abs(last.y - cy) > 1) {
          path.push({ x: last.x, y: cy });
        }
        path.push({ x: cx, y: cy });
      }
      if (path.length < 12) return;
      roads.push(path);
      for (const pt of path) {
        const idx = pt.y * w + pt.x;
        if (this.buildingAt[idx] >= 0) continue;
        const wasRiver = this.material[idx] === CellMaterial.UNCLAIMED;
        this.material[idx] = CellMaterial.STREET;
        this.hp[idx] = 34;
        this.maxHp[idx] = 34;
        this.streetTier[idx] = 8;
        this.landCover[idx] = wasRiver ? LandCover.BRIDGE : LandCover.DIRT_ROAD;
      }
    };

    // Avenue exits: scan straight columns/rows of arterial street (tier 1 or 2, outside blocks)
    let roadId = 0;
    const avenueXs: number[] = [];
    for (let x = 1; x < w - 1; x++) {
      let streetRun = 0;
      for (let y = 0; y < h; y++) {
        const idx = y * w + x;
        if (this.zone[idx] !== ZoneKind.RURAL && this.material[idx] === CellMaterial.STREET && (this.streetTier[idx] === 1 || this.streetTier[idx] === 2)) streetRun++;
      }
      if (streetRun > h * 0.25 && (avenueXs.length === 0 || x - avenueXs[avenueXs.length - 1] > 12)) avenueXs.push(x);
    }
    const avenueYs: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      let streetRun = 0;
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (this.zone[idx] !== ZoneKind.RURAL && this.material[idx] === CellMaterial.STREET && (this.streetTier[idx] === 1 || this.streetTier[idx] === 2)) streetRun++;
      }
      if (streetRun > w * 0.25 && (avenueYs.length === 0 || y - avenueYs[avenueYs.length - 1] > 10)) avenueYs.push(y);
    }
    for (let i = 1; i < avenueXs.length; i += 2) {
      const x = avenueXs[i];
      tryRoad(x, 0, 0, 1, roadId++);
      tryRoad(x, h - 1, 0, -1, roadId++);
    }
    for (let i = 1; i < avenueYs.length; i += 2) {
      const y = avenueYs[i];
      tryRoad(0, y, 1, 0, roadId++);
      tryRoad(w - 1, y, -1, 0, roadId++);
    }

    // 4. Crop fields, orchards and hamlets along the lanes
    const clearRect = (x0: number, y0: number, rw: number, rh: number): boolean => {
      for (let y = y0; y < y0 + rh; y++) {
        for (let x = x0; x < x0 + rw; x++) {
          if (!isRural(x, y)) return false;
          const idx = y * w + x;
          if (this.material[idx] !== CellMaterial.PARK) return false;
          const lc = this.landCover[idx];
          if (lc !== LandCover.GRASS && lc !== LandCover.MEADOW) return false;
          if (this.buildingAt[idx] >= 0) return false;
        }
      }
      return true;
    };

    const placeHamlet = (bx: number, by: number, bw: number, variant: number): void => {
      const bh = 2;
      if (!clearRect(bx - 1, by - 1, bw + 2, bh + 2)) return;
      this.addBuilding(bx, by, bw, bh, "rural", false, 1 + (variant % 2), variant);
      const sx = bx + bw + 1;
      if (hash01(seed, 98, bx, by) < 0.55 && clearRect(sx, by, 3, 2)) {
        this.addBuilding(sx, by, 3, 2, "rural", false, 1, 2 + hash(seed, 99, bx, by) * 3);
        if (isRural(sx + 3, by + 1) && this.material[(by + 1) * w + sx + 3] === CellMaterial.PARK) {
          this.landCover[(by + 1) * w + sx + 3] = LandCover.SILO;
        }
      }
    };

    roads.forEach((path, rIdx) => {
      for (let i = 6; i < path.length - 6; i += 7) {
        const pt = path[i];
        const nxt = path[Math.min(path.length - 1, i + 3)];
        const prv = path[Math.max(0, i - 3)];
        // Perpendicular to the lane's local heading
        const hx = nxt.x - prv.x;
        const hy = nxt.y - prv.y;
        const sideSign = hash01(seed, 90, rIdx, i) < 0.5 ? -1 : 1;
        const px = Math.sign(-hy) * sideSign;
        const py = Math.sign(hx) * sideSign;
        const roll = hash01(seed, 91, rIdx, i);
        if (roll < 0.42) {
          // Field: rectangle 5..9 x 4..7 one cell off the lane
          const fw = 5 + (hash(seed, 92, rIdx, i) % 5);
          const fh = 4 + (hash(seed, 93, rIdx, i) % 4);
          const fx = pt.x + px * 2 + (px < 0 ? -fw + 1 : 0) + (px === 0 ? -(fw >> 1) : 0);
          const fy = pt.y + py * 2 + (py < 0 ? -fh + 1 : 0) + (py === 0 ? -(fh >> 1) : 0);
          if (clearRect(fx, fy, fw, fh)) {
            const cover =
              hash01(seed, 94, rIdx, i) < 0.22
                ? LandCover.ORCHARD
                : Math.abs(hx) >= Math.abs(hy)
                  ? LandCover.FIELD_V
                  : LandCover.FIELD_H;
            for (let y = fy; y < fy + fh; y++) {
              for (let x = fx; x < fx + fw; x++) {
                const onEdgeX = x === fx || x === fx + fw - 1;
                const onEdgeY = y === fy || y === fy + fh - 1;
                if (onEdgeX && onEdgeY && hash01(seed, 95, x, y) < 0.72) continue;
                if ((onEdgeX || onEdgeY) && hash01(seed, 96, x, y) < 0.16) continue;
                this.landCover[y * w + x] = cover;
              }
            }
          }
        } else if (roll < 0.78) {
          // Hamlet: homestead (2x2 / 3x2) plus optional barn and silo
          const bw = 2 + (hash(seed, 95, rIdx, i) % 2);
          const bh = 2;
          const bx = pt.x + px * 2 + (px < 0 ? -bw + 1 : 0) + (px === 0 ? -1 : 0);
          const by = pt.y + py * 2 + (py < 0 ? -bh + 1 : 0) + (py === 0 ? -1 : 0);
          placeHamlet(bx, by, bw, hash(seed, 97, rIdx, i));
        }
      }
    });

    // 5. Scattered farmsteads and fields across the open country, away from the lanes
    for (let gy = 3; gy < h - 6; gy += 9) {
      for (let gx = 3; gx < w - 6; gx += 9) {
        const jx = gx + (hash(seed, 100, gx, gy) % 5);
        const jy = gy + (hash(seed, 101, gx, gy) % 5);
        if (!isRural(jx, jy)) continue;
        const roll = hash01(seed, 102, gx, gy);
        if (roll < 0.16) {
          const fw = 4 + (hash(seed, 103, gx, gy) % 5);
          const fh = 3 + (hash(seed, 104, gx, gy) % 4);
          if (clearRect(jx, jy, fw, fh)) {
            const cover =
              roll < 0.035 ? LandCover.ORCHARD : roll < 0.1 ? LandCover.FIELD_H : LandCover.FIELD_V;
            for (let y = jy; y < jy + fh; y++) {
              for (let x = jx; x < jx + fw; x++) {
                const onEdgeX = x === jx || x === jx + fw - 1;
                const onEdgeY = y === jy || y === jy + fh - 1;
                if (onEdgeX && onEdgeY && hash01(seed, 107, x, y) < 0.72) continue;
                if ((onEdgeX || onEdgeY) && hash01(seed, 108, x, y) < 0.18) continue;
                this.landCover[y * w + x] = cover;
              }
            }
          }
        } else if (roll < 0.3) {
          placeHamlet(jx, jy, 2 + (hash(seed, 105, gx, gy) % 2), hash(seed, 106, gx, gy));
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
            !isSkyscraper &&
            (lx === 0 || lx === w - 1) &&
            (ly === 0 || ly === h - 1)
          ) {
            // Octagonal / chamfered mid-rise
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
        if (district !== "rural" && this.zone[idx] === ZoneKind.RURAL) continue;
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
      this.landCover[idx] = LandCover.NONE;
      this.columnFloors[idx] = height;
      this.streetTier[idx] = 4;
    }

    const styles = ARCH_STYLES_BY_DISTRICT[district] ?? ARCH_STYLES_BY_DISTRICT.midtown;
    const archStyle = styles[variant % styles.length];
    const roofList = isSkyscraper ? ROOF_FEATURES_SKY : ROOF_FEATURES_LOW;
    const roofFeature =
      district === "industrial" && (variant >> 3) % 2 === 0
        ? "reactorDome"
        : district === "plaza"
          ? "skyGarden"
          : district === "rural"
            ? (variant >> 3) % 5 === 0
              ? "commsArray"
              : "solarArray"
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
            this.columnFloors[cellIdx] = 0;
            this.streetTier[cellIdx] = 0;
          } else if (d <= effectiveR + 3.2) {
            if (hash01(this.seed, 889, idx, x, y) < 0.48) {
              this.material[cellIdx] = CellMaterial.SALVAGE;
              this.hp[cellIdx] = 18;
              this.maxHp[cellIdx] = 24;
              this.buildingAt[cellIdx] = -1;
              this.columnFloors[cellIdx] = 0;
              this.streetTier[cellIdx] = 0;
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

  /** The loss check only needs one surviving baseline cell. */
  hasPreservedBaseline(): boolean {
    const { material, hp, isBaselineCell, baselineCellValue } = this;
    for (let i = 0; i < material.length; i++) {
      const mat = material[i];
      if (isBaselineCell[i] && baselineCellValue[i] > 0 && hp[i] > 0 &&
          mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED && mat !== CellMaterial.EMPTY) return true;
    }
    return false;
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
      if (mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED && mat !== CellMaterial.EMPTY && this.hp[i] > 0) {
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
