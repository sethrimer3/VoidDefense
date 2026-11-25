/** Deterministic grid-based Void accretion fluid and short-lived flair sparks for Void Defense.
 *
 * Replaces long-lived debris particle piles with a calm, banded pixel-art accretion fluid:
 * 1. Fluid grid around active Void portals: typed arrays (`Float32Array amount`, `Uint8Array material`,
 *    plus precomputed flow-field vectors `flowVx`, `flowVy`, `flowDist`, `flowCore`, `flowPortal`),
 *    snapped to the whole-pixel grid (`cellSize = 1` world px on High/Medium (~3-4 screen px at default zoom),
 *    `cellSize = 2` world px on Low quality for a coarser grid).
 * 2. Precomputed flow field per active Void portal with inward radial pull and Keplerian accretion-disk
 *    spiral twist; rebuilt only when portals activate, move, or grow.
 * 3. Only simulates cells within the active dirty bounding box (`minX..maxX`, `minY..maxY`).
 * 4. Simple neighbor rules for advecting, spreading, and merging fluid amounts; cells reaching the
 *    event horizon (`dist <= coreRadius`) are consumed cleanly and counted in `consumedAmount`.
 * 5. Small fixed 7-band pixel-art palette per source material (`grass`, `dirt`, `stone`, `concrete`,
 *    `crops`, `water`): shifts from material color -> warm ember -> orange-hot -> violet/magenta near
 *    the event horizon, with density-modulated brightness/fade and a crisp surface edge highlight.
 * 6. Hot inner bands emit into the half-resolution emissive halo light buffer at low resolution.
 * 7. Optional deterministic spark layer (capped at 220 desktop/high, 140 medium, 60 low/mobile).
 */

import { dist } from "../exact.ts";
import { hash01 } from "./grid.ts";
import { looseMaterialLight, type TimeOfDayPreset, type VoidWeatherMode } from "./lighting.ts";
import { CellMaterial, LandCover } from "./model.ts";
import type { VoidWorld } from "./world.ts";

/** Source material IDs for Void fluid cells and melting chunks. */
export const FluidMaterial = {
  NONE: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  CONCRETE: 4,
  CROPS: 5,
  WATER: 6,
} as const;

export type FluidMaterialId = (typeof FluidMaterial)[keyof typeof FluidMaterial];

export const FLUID_MATERIAL_COUNT = 7;
export const FLUID_BAND_COUNT = 7;

/** Classifies a world cell into one of the 6 fluid source materials before Void consumption. */
export function classifyFluidMaterial(
  world: VoidWorld,
  idx: number,
  prevMat: number,
  prevCover: number,
  bId: number,
): FluidMaterialId {
  if (bId >= 0) {
    const b = world.buildings[bId];
    if (b && (b.archStyle === "homestead" || b.archStyle === "barn")) {
      return FluidMaterial.DIRT;
    }
    return FluidMaterial.CONCRETE;
  }
  if (prevMat === CellMaterial.UNCLAIMED || prevCover === LandCover.RIVER) {
    return FluidMaterial.WATER;
  }
  if (prevCover === LandCover.FIELD_H || prevCover === LandCover.FIELD_V) {
    return FluidMaterial.CROPS;
  }
  if (
    prevCover === LandCover.DIRT_ROAD ||
    prevCover === LandCover.BRIDGE ||
    prevMat === CellMaterial.RECLAIMED ||
    prevMat === CellMaterial.SALVAGE ||
    (prevMat === CellMaterial.STREET && world.streetTier[idx] === 8)
  ) {
    return FluidMaterial.DIRT;
  }
  if (
    prevMat === CellMaterial.WALL ||
    prevMat === CellMaterial.BARRIER ||
    prevCover === LandCover.SILO
  ) {
    return FluidMaterial.STONE;
  }
  if (
    prevMat === CellMaterial.BUILDING ||
    prevMat === CellMaterial.SKYSCRAPER ||
    prevMat === CellMaterial.STREET
  ) {
    return FluidMaterial.CONCRETE;
  }
  if (
    prevMat === CellMaterial.PARK ||
    prevCover === LandCover.GRASS ||
    prevCover === LandCover.MEADOW ||
    prevCover === LandCover.FOREST ||
    prevCover === LandCover.ORCHARD
  ) {
    return FluidMaterial.GRASS;
  }
  return FluidMaterial.STONE;
}

/** Fixed 7-stop pixel-art band palettes per material:
 * Band 0: Cool/shaded outer material
 * Band 1: Mid material tone
 * Band 2: Warmed material / scorched rim
 * Band 3: Glowing ember-red / terracotta
 * Band 4: Molten orange-hot accretion band
 * Band 5: Hot amber-magenta transition
 * Band 6: Luminous violet/magenta event-horizon band */
export const FLUID_MATERIAL_PALETTES: Record<FluidMaterialId, readonly [number, number, number][]> = {
  [FluidMaterial.NONE]: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  [FluidMaterial.GRASS]: [
    [46, 98, 48],     // deep meadow green
    [76, 138, 56],    // bright grass green
    [132, 128, 48],   // parched olive-ochre
    [198, 86, 32],    // glowing ember orange-red
    [248, 128, 34],   // hot molten orange
    [232, 74, 158],   // hot magenta-amber
    [186, 68, 242],   // event-horizon violet-magenta
  ],
  [FluidMaterial.DIRT]: [
    [98, 68, 44],     // dark loam
    [142, 102, 64],   // warm soil
    [176, 108, 54],   // baked terracotta
    [212, 88, 34],    // ember rust
    [250, 134, 38],   // molten orange
    [234, 78, 162],   // hot magenta
    [184, 66, 240],   // horizon violet-magenta
  ],
  [FluidMaterial.STONE]: [
    [74, 86, 106],    // deep basalt-slate
    [110, 124, 148],  // weathered stone
    [148, 114, 96],   // heated granite
    [206, 82, 42],    // glowing crimson-ember
    [252, 136, 42],   // orange-hot
    [236, 82, 174],   // magenta-rose
    [192, 74, 248],   // horizon violet
  ],
  [FluidMaterial.CONCRETE]: [
    [58, 70, 88],     // dark urban asphalt/steel
    [92, 108, 132],   // city concrete slab
    [138, 112, 102],  // scorched ferrocrete
    [210, 84, 38],    // furnace ember
    [255, 142, 44],   // molten orange-gold
    [238, 84, 178],   // neon magenta
    [196, 78, 252],   // horizon violet-magenta
  ],
  [FluidMaterial.CROPS]: [
    [164, 124, 42],   // harvest wheat gold
    [216, 172, 62],   // bright grain yellow
    [232, 142, 44],   // toasted amber
    [236, 98, 32],    // fiery orange-red
    [255, 156, 48],   // incandescent orange-gold
    [242, 88, 172],   // hot magenta
    [198, 76, 248],   // horizon violet
  ],
  [FluidMaterial.WATER]: [
    [36, 88, 148],    // deep canal blue
    [68, 142, 206],   // bright river cyan-blue
    [112, 124, 188],  // vapor indigo
    [196, 92, 112],   // superheated rose-ember
    [246, 134, 58],   // plasma orange
    [232, 82, 188],   // electric magenta
    [182, 74, 250],   // horizon violet
  ],
};

/** Representative chunk hex color for each material so impact chunks match their fluid palette. */
export const FLUID_CHUNK_COLORS: Record<FluidMaterialId, { color: string; accent: string }> = {
  [FluidMaterial.NONE]: { color: "#4a5464", accent: "#7a869a" },
  [FluidMaterial.GRASS]: { color: "#4c8a38", accent: "#6fae46" },
  [FluidMaterial.DIRT]: { color: "#8e6640", accent: "#b08a5a" },
  [FluidMaterial.STONE]: { color: "#6e7c94", accent: "#94a6c2" },
  [FluidMaterial.CONCRETE]: { color: "#5c6c84", accent: "#889bb8" },
  [FluidMaterial.CROPS]: { color: "#d8ac3e", accent: "#f0cc62" },
  [FluidMaterial.WATER]: { color: "#448ece", accent: "#6ec0f2" },
};

export type FluidSpark = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  portalX: number;
  portalY: number;
  coreR: number;
  material: FluidMaterialId;
  band: number;
  life: number;
  maxLife: number;
};

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

function packAbgr(r: number, g: number, b: number, a = 255): number {
  return IS_LITTLE_ENDIAN
    ? (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0
    : (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

export const MAX_SPARKS_HIGH = 200;
export const MAX_SPARKS_MEDIUM = 120;
export const MAX_SPARKS_LOW = 48;

export class VoidFluidGrid {
  w = 0;
  h = 0;
  /** Fluid cell size in world pixels (`1` on High/Medium = 3-4 screen px at default zoom; `2` on Low). */
  cellSize = 1;
  gridW = 0;
  gridH = 0;

  /** Fluid density amount per cell (`0..4`). */
  amount = new Float32Array(0);
  private nextAmount = new Float32Array(0);
  /** Dominant source material index (`FluidMaterialId`, `0..6`) per cell. */
  material = new Uint8Array(0);
  private nextMaterial = new Uint8Array(0);
  /** Distance from detachment origin for smooth band heating (`Float32Array`). */
  startDist = new Float32Array(0);
  private nextStartDist = new Float32Array(0);

  /** Precomputed flow field arrays (rebuilt only when active portals move, grow, or change). */
  flowVx = new Float32Array(0);
  flowVy = new Float32Array(0);
  flowDist = new Float32Array(0);
  flowAngle = new Float32Array(0);
  flowCoreR = new Float32Array(0);
  flowReachR = new Float32Array(0);
  private flowSignature = "";
  flowRebuilds = 0;

  /** Active dirty bounding box in fluid grid coordinates (`[minX..maxX, minY..maxY]`, inclusive). */
  minX = 0;
  minY = 0;
  maxX = -1;
  maxY = -1;
  activeCellCount = 0;

  /** Total fluid mass consumed at the event horizon (feeds the same sink as legacy debris). */
  consumedAmount = 0;
  consumedCells = 0;

  /** Short-lived tiny 1-px sparks for flair only. */
  readonly sparks: FluidSpark[] = Array.from({ length: MAX_SPARKS_HIGH }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    portalX: 0,
    portalY: 0,
    coreR: 5,
    material: FluidMaterial.CONCRETE,
    band: 4,
    life: 0,
    maxLife: 0.35,
  }));
  private sparkCursor = 0;
  sparkCap = MAX_SPARKS_HIGH;
  private stepTick = 0;

  /** Offscreen buffer for single-call rendering (`one putImageData + drawImage`). */
  rasterU32 = new Uint32Array(0);
  private imageData: ImageData | null = null;
  readonly canvas: HTMLCanvasElement | null =
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("canvas")
      : null;
  private readonly ctx: CanvasRenderingContext2D | null =
    this.canvas ? this.canvas.getContext("2d") : null;

  /** Ensures typed arrays match world dimensions and quality cell size (`1` or `2`). */
  ensureSize(worldW: number, worldH: number, cellSize = 1): void {
    const cs = cellSize >= 2 ? 2 : 1;
    const gw = Math.ceil(worldW / cs);
    const gh = Math.ceil(worldH / cs);
    if (this.w === worldW && this.h === worldH && this.cellSize === cs && this.amount.length === gw * gh) {
      return;
    }

    // Preserve existing fluid cells across grid resolution changes (e.g. Low <-> High quality switch)
    const oldCs = this.cellSize || 1;
    const oldGw = this.gridW;
    const oldGh = this.gridH;
    const oldMinX = Math.max(0, this.minX);
    const oldMaxX = Math.min(oldGw - 1, this.maxX);
    const oldMinY = Math.max(0, this.minY);
    const oldMaxY = Math.min(oldGh - 1, this.maxY);
    const savedCells: { wx: number; wy: number; amt: number; mat: FluidMaterialId; sDist: number }[] = [];
    if (this.w === worldW && this.h === worldH && this.amount.length > 0 && oldMaxX >= oldMinX && oldMaxY >= oldMinY) {
      for (let oy = oldMinY; oy <= oldMaxY; oy++) {
        const row = oy * oldGw;
        for (let ox = oldMinX; ox <= oldMaxX; ox++) {
          const oi = row + ox;
          const a = this.amount[oi];
          if (a <= 0.015) continue;
          savedCells.push({
            wx: (ox + 0.5) * oldCs,
            wy: (oy + 0.5) * oldCs,
            amt: a,
            mat: this.material[oi] as FluidMaterialId,
            sDist: this.startDist[oi],
          });
        }
      }
    }

    this.w = worldW;
    this.h = worldH;
    this.cellSize = cs;
    this.gridW = gw;
    this.gridH = gh;
    const count = gw * gh;

    this.amount = new Float32Array(count);
    this.nextAmount = new Float32Array(count);
    this.material = new Uint8Array(count);
    this.nextMaterial = new Uint8Array(count);
    this.startDist = new Float32Array(count);
    this.nextStartDist = new Float32Array(count);

    this.flowVx = new Float32Array(count);
    this.flowVy = new Float32Array(count);
    this.flowDist = new Float32Array(count);
    this.flowAngle = new Float32Array(count);
    this.flowCoreR = new Float32Array(count);
    this.flowReachR = new Float32Array(count);
    this.flowSignature = "";

    this.rasterU32 = new Uint32Array(count);
    if (this.canvas && this.ctx) {
      this.canvas.width = gw;
      this.canvas.height = gh;
      this.imageData = this.ctx.createImageData(gw, gh);
      this.rasterU32 = new Uint32Array(this.imageData.data.buffer);
    }

    this.minX = gw;
    this.minY = gh;
    this.maxX = -1;
    this.maxY = -1;
    this.activeCellCount = 0;

    if (savedCells.length > 0) {
      for (let i = 0; i < savedCells.length; i++) {
        const sc = savedCells[i];
        if (cs === 1 && oldCs === 2) {
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const gx = Math.floor(sc.wx) - 1 + dx;
              const gy = Math.floor(sc.wy) - 1 + dy;
              if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
              const idx = gy * gw + gx;
              this.amount[idx] = sc.amt;
              this.material[idx] = sc.mat;
              this.startDist[idx] = sc.sDist;
              if (gx < this.minX) this.minX = gx;
              if (gx > this.maxX) this.maxX = gx;
              if (gy < this.minY) this.minY = gy;
              if (gy > this.maxY) this.maxY = gy;
              this.activeCellCount++;
            }
          }
        } else {
          const gx = Math.floor(sc.wx / cs);
          const gy = Math.floor(sc.wy / cs);
          if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
          const idx = gy * gw + gx;
          this.amount[idx] = Math.min(3.6, Math.max(this.amount[idx], sc.amt));
          this.material[idx] = sc.mat;
          this.startDist[idx] = Math.max(this.startDist[idx], sc.sDist);
          if (gx < this.minX) this.minX = gx;
          if (gx > this.maxX) this.maxX = gx;
          if (gy < this.minY) this.minY = gy;
          if (gy > this.maxY) this.maxY = gy;
          this.activeCellCount++;
        }
      }
    }
  }

  /** Clears all fluid cells and sparks. */
  clear(): void {
    this.amount.fill(0);
    this.material.fill(0);
    this.startDist.fill(0);
    this.minX = this.gridW;
    this.minY = this.gridH;
    this.maxX = -1;
    this.maxY = -1;
    this.activeCellCount = 0;
    for (let i = 0; i < this.sparks.length; i++) {
      this.sparks[i].active = false;
    }
  }

  /** Rebuilds the precomputed spiral accretion flow field ONLY when active portals move, grow, or activate. */
  syncFlowField(world: VoidWorld): void {
    this.ensureSize(world.grid.w, world.grid.h, this.cellSize || 1);
    const active = world.portals.filter((p) => p.active);
    const portals = active.length > 0 ? active : world.portals;
    let sig = `${this.cellSize}:${active.length}:`;
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      sig += `${p.id}@${Math.round(p.x * 10)},${Math.round(p.y * 10)},${Math.round(p.radius * 10)};`;
    }
    if (sig === this.flowSignature) return;
    this.flowSignature = sig;
    this.flowRebuilds++;

    const { gridW, gridH, cellSize } = this;
    const { flowVx, flowVy, flowDist, flowAngle, flowCoreR, flowReachR } = this;

    if (portals.length === 0) {
      const cx = world.grid.w * 0.5;
      const cy = world.grid.h * 0.5;
      for (let gy = 0; gy < gridH; gy++) {
        const wy = (gy + 0.5) * cellSize;
        const row = gy * gridW;
        for (let gx = 0; gx < gridW; gx++) {
          const wx = (gx + 0.5) * cellSize;
          const idx = row + gx;
          const dx = cx - wx;
          const dy = cy - wy;
          const d = Math.max(0.5, dist(dx, dy));
          flowDist[idx] = d;
          flowAngle[idx] = Math.atan2(-dy, -dx);
          flowCoreR[idx] = 4.0;
          flowReachR[idx] = 28.0;
          const nx = dx / d;
          const ny = dy / d;
          flowVx[idx] = nx * 8 - ny * 10;
          flowVy[idx] = ny * 8 + nx * 10;
        }
      }
      return;
    }

    for (let gy = 0; gy < gridH; gy++) {
      const wy = (gy + 0.5) * cellSize;
      const row = gy * gridW;
      for (let gx = 0; gx < gridW; gx++) {
        const wx = (gx + 0.5) * cellSize;
        const idx = row + gx;

        let bestP = portals[0];
        let bestD = dist(wx - bestP.x, wy - bestP.y);
        for (let i = 1; i < portals.length; i++) {
          const p = portals[i];
          const d = dist(wx - p.x, wy - p.y);
          if (d < bestD) {
            bestD = d;
            bestP = p;
          }
        }

        const coreR = Math.max(3.6, bestP.radius * 0.42);
        const reachR = Math.max(coreR + 18, bestP.radius * 3.1);
        const d = Math.max(0.25, bestD);
        // Use polar incremental step to compute exact chord toward (r - radialStep, theta + angularStep)
        // so bilinear grid stepping always spirals strictly inward toward the portal center
        const prox = Math.min(1, Math.max(0, 1 - (d - coreR) / Math.max(4, reachR - coreR)));
        const p2 = prox * prox;
        const radialSpeed = 5.5 + 9.5 * prox + 11.0 * p2;
        const tangentialSpeed = 7.0 + 13.5 * prox + 15.0 * p2;

        const rx = wx - bestP.x;
        const ry = wy - bestP.y;
        const inX = -rx / d;
        const inY = -ry / d;
        const tanX = -inY;
        const tanY = inX;

        flowVx[idx] = inX * radialSpeed + tanX * tangentialSpeed;
        flowVy[idx] = inY * radialSpeed + tanY * tangentialSpeed;
        flowDist[idx] = bestD;
        flowAngle[idx] = Math.atan2(ry, rx);
        flowCoreR[idx] = coreR;
        flowReachR[idx] = reachR;
      }
    }
  }

  /** Deposits fluid amount at world coordinates `(wx, wy)` with source material `mat` and initial detachment radius `sDist`. */
  depositAtWorld(
    wx: number,
    wy: number,
    addedAmount: number,
    mat: FluidMaterialId,
    sDist = 0,
  ): void {
    if (addedAmount <= 0 || mat === FluidMaterial.NONE) return;
    const { gridW, gridH, cellSize } = this;
    if (gridW === 0 || gridH === 0) return;
    const gx = Math.floor(wx / cellSize);
    const gy = Math.floor(wy / cellSize);
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return;

    const idx = gy * gridW + gx;
    const coreR = this.flowCoreR[idx] || 4.0;
    const d = this.flowDist[idx] || sDist || 16;
    if (d <= coreR) {
      this.consumedAmount += addedAmount;
      this.consumedCells++;
      return;
    }

    const stampCell = (cx: number, cy: number, amt: number): void => {
      if (amt <= 0.005 || cx < 0 || cx >= gridW || cy < 0 || cy >= gridH) return;
      const cIdx = cy * gridW + cx;
      const cd = this.flowDist[cIdx] || d;
      const cCore = this.flowCoreR[cIdx] || coreR;
      if (cd <= cCore) return;
      const prev = this.amount[cIdx];
      if (prev <= 0.022 && prev + amt > 0.022) {
        this.activeCellCount++;
      }
      const next = Math.min(3.6, prev + amt);
      this.amount[cIdx] = next;
      if (prev < 0.05 || amt >= prev * 0.35) {
        this.material[cIdx] = mat;
      }
      const effStart = sDist > cCore + 2 ? sDist : Math.max(cd, cCore + 6);
      this.startDist[cIdx] = prev > 0.05 ? Math.max(this.startDist[cIdx], effStart) : effStart;

      if (cx < this.minX) this.minX = cx;
      if (cx > this.maxX) this.maxX = cx;
      if (cy < this.minY) this.minY = cy;
      if (cy > this.maxY) this.maxY = cy;
    };

    if (addedAmount >= 0.32 && cellSize === 1) {
      stampCell(gx, gy, addedAmount * 0.56);
      const side = addedAmount * 0.11;
      stampCell(gx - 1, gy, side);
      stampCell(gx + 1, gy, side);
      stampCell(gx, gy - 1, side);
      stampCell(gx, gy + 1, side);
    } else {
      stampCell(gx, gy, addedAmount);
    }
  }

  /** Spawns a tiny short-lived 1-px spark for visual flair near chunk cracks or active rims. */
  spawnSpark(
    wx: number,
    wy: number,
    vx: number,
    vy: number,
    portalX: number,
    portalY: number,
    coreR: number,
    material: FluidMaterialId,
    band = 4,
    maxLife = 0.34,
  ): void {
    if (this.sparkCap <= 0) return;
    const idx = this.sparkCursor % this.sparkCap;
    this.sparkCursor = (idx + 1) % this.sparkCap;
    const s = this.sparks[idx];
    s.active = true;
    s.x = wx;
    s.y = wy;
    s.vx = vx;
    s.vy = vy;
    s.portalX = portalX;
    s.portalY = portalY;
    s.coreR = coreR;
    s.material = material;
    s.band = band;
    s.life = 0;
    s.maxLife = maxLife;
  }

  /** Advances the fluid grid and short-lived sparks by `dt` seconds inside the active dirty bounding box. */
  step(world: VoidWorld, dt: number): void {
    this.stepTick++;
    this.syncFlowField(world);
    const { gridW, gridH, cellSize } = this;

    // 1. Step tiny flair sparks
    for (let i = 0; i < this.sparkCap; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;
      s.life += dt;
      if (s.life >= s.maxLife) {
        s.active = false;
        continue;
      }
      // Pull spark gently toward its portal with spiral twist
      const dx = s.portalX - s.x;
      const dy = s.portalY - s.y;
      const d = dist(dx, dy);
      if (d <= s.coreR + 0.4) {
        s.active = false;
        continue;
      }
      const nx = dx / d;
      const ny = dy / d;
      s.vx = s.vx * 0.86 + (nx * 14 - ny * 18) * 0.14;
      s.vy = s.vy * 0.86 + (ny * 14 + nx * 18) * 0.14;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    if (this.maxX < this.minX || this.maxY < this.minY) {
      this.activeCellCount = 0;
      return;
    }

    // Expand simulation window by 2 cells around current dirty bounding box
    const x0 = Math.max(0, this.minX - 2);
    const y0 = Math.max(0, this.minY - 2);
    const x1 = Math.min(gridW - 1, this.maxX + 2);
    const y1 = Math.min(gridH - 1, this.maxY + 2);

    const {
      amount,
      nextAmount,
      material,
      nextMaterial,
      startDist,
      nextStartDist,
      flowVx,
      flowVy,
      flowDist,
      flowCoreR,
    } = this;

    // Clear target window in scratch buffers
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      nextAmount.fill(0, row + x0, row + x1 + 1);
      nextMaterial.fill(0, row + x0, row + x1 + 1);
      nextStartDist.fill(0, row + x0, row + x1 + 1);
    }

    const invCell = 1 / cellSize;
    const stepScale = Math.min(1.35, dt * 30) * invCell;
    // Slight decay per frame so thin wisps evaporate cleanly while streams reach the event horizon
    const retention = Math.max(0.92, 1 - dt * 0.16);

    const depositCell = (tx: number, ty: number, amt: number, mat: number, sDist: number): void => {
      if (amt <= 0.002 || tx < 0 || tx >= gridW || ty < 0 || ty >= gridH) return;
      const tIdx = ty * gridW + tx;
      const d = flowDist[tIdx];
      const coreR = flowCoreR[tIdx];
      if (d <= coreR + 0.35) {
        // Reached event horizon: consume into the Void
        this.consumedAmount += amt;
        this.consumedCells++;
        return;
      }
      const prev = nextAmount[tIdx];
      const combined = Math.min(3.6, prev + amt);
      nextAmount[tIdx] = combined;
      if (prev < amt || nextMaterial[tIdx] === 0) {
        nextMaterial[tIdx] = mat;
      }
      if (sDist > nextStartDist[tIdx]) {
        nextStartDist[tIdx] = sDist;
      }
    };

    // Forward semi-Lagrangian advection + neighbor spreading along the precomputed spiral flow field
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const amt = amount[idx];
        if (amt <= 0.018) continue;

        const d = flowDist[idx];
        const coreR = flowCoreR[idx];
        if (d <= coreR + 0.35) {
          this.consumedAmount += amt;
          this.consumedCells++;
          continue;
        }

        const mat = material[idx];
        const sDist = startDist[idx] || d;
        const keptAmt = amt * retention;

        // Flow displacement in grid cells (clamped to <= 1.25 cells per tick so bands stay coherent)
        const vx = flowVx[idx] * dt * invCell * 0.85;
        const vy = flowVy[idx] * dt * invCell * 0.85;
        const mag = Math.hypot(vx, vy);
        const clampScale = mag > 1.25 ? 1.25 / mag : 1.0;
        const fx = gx + vx * clampScale;
        const fy = gy + vy * clampScale;

        const bx = Math.floor(fx);
        const by = Math.floor(fy);
        const tx = fx - bx;
        const ty = fy - by;

        // Primary advected mass (88%) + gentle orthogonal neighbor diffusion/spreading (12%) when dense
        const spreadShare = keptAmt > 0.55 ? 0.12 * Math.min(1, stepScale) : 0.04;
        const coreMass = keptAmt * (1 - spreadShare);

        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;

        depositCell(bx, by, coreMass * w00, mat, sDist);
        depositCell(bx + 1, by, coreMass * w10, mat, sDist);
        depositCell(bx, by + 1, coreMass * w01, mat, sDist);
        depositCell(bx + 1, by + 1, coreMass * w11, mat, sDist);

        if (spreadShare > 0) {
          const side = (keptAmt * spreadShare) * 0.25;
          depositCell(gx - 1, gy, side, mat, sDist);
          depositCell(gx + 1, gy, side, mat, sDist);
          depositCell(gx, gy - 1, side, mat, sDist);
          depositCell(gx, gy + 1, side, mat, sDist);
        }
      }
    }

    // Copy updated window back and compute tight active dirty bounding box
    let newMinX = gridW;
    let newMinY = gridH;
    let newMaxX = -1;
    let newMaxY = -1;
    let activeCount = 0;

    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const a = nextAmount[idx];
        if (a > 0.022) {
          amount[idx] = a;
          material[idx] = nextMaterial[idx];
          startDist[idx] = nextStartDist[idx];
          activeCount++;
          if (gx < newMinX) newMinX = gx;
          if (gx > newMaxX) newMaxX = gx;
          if (gy < newMinY) newMinY = gy;
          if (gy > newMaxY) newMaxY = gy;
        } else {
          amount[idx] = 0;
          material[idx] = 0;
          startDist[idx] = 0;
        }
      }
    }

    this.minX = newMinX;
    this.minY = newMinY;
    this.maxX = newMaxX;
    this.maxY = newMaxY;
    this.activeCellCount = activeCount;
  }

  /** Computes the discrete pixel-art heat band (`0..6`) for a fluid cell at `distToPortal`.
   * Band shifts cleanly from material color (0..2) -> orange-hot (3..4) -> violet/magenta (5..6)
   * near the event horizon, with a spiral arm modulation for swirling accretion bands. */
  computeCellBand(idx: number, animTime = 0): number {
    const d = this.flowDist[idx];
    const coreR = this.flowCoreR[idx] || 4.0;
    const sDist = Math.max(coreR + 5, this.startDist[idx] || this.flowReachR[idx] || 22);
    const span = Math.max(3.5, sDist - coreR);
    // Normalized inward progress u in [0, 1] (0 at outer edge, 1 at event horizon)
    const uRaw = Math.min(1, Math.max(0, 1 - (d - coreR) / span));
    // Ease-in so outer/mid rings preserve distinct material colors (grass, dirt, stone, concrete, crops, water)
    // before heating into orange-hot and violet/magenta near the event horizon
    const u = Math.pow(uRaw, 1.15);
    // Spiral arm wave so bands visibly swirl around the accretion disk like pixel art (fades right at the core rim)
    const ang = this.flowAngle[idx];
    const waveScale = 0.13 * (1 - uRaw * 0.72);
    const spiralWave = Math.sin(ang * 3 + Math.log(Math.max(1, d - coreR + 1)) * 5.2 - animTime * 2.2) * waveScale;
    const bandRaw = Math.min(0.999, Math.max(0, u + spiralWave));
    return Math.min(FLUID_BAND_COUNT - 1, Math.floor(bandRaw * FLUID_BAND_COUNT));
  }

  /** Feeds emissive light from hot inner fluid bands (`band >= 3`) into the half-resolution halo buffer
   * by strided low-res sampling (never per world cell). */
  contributeToHalo(
    halo: Float32Array,
    haloW: number,
    haloH: number,
    neonIntensity = 1.0,
  ): number {
    if (this.maxX < this.minX || this.maxY < this.minY || haloW <= 0 || haloH <= 0) return 0;
    const { gridW, cellSize, amount, material } = this;
    // Sample every 2 half-res texels (every 4 world pixels) inside the dirty fluid bounding box
    const step = cellSize >= 2 ? 1 : 2;
    let samplesEmitted = 0;
    const gain = Math.min(1.35, 0.65 + neonIntensity * 0.35);

    for (let gy = this.minY; gy <= this.minY + (this.maxY - this.minY); gy += step) {
      const wy = Math.floor((gy + 0.5) * cellSize);
      const hy = Math.max(0, Math.min(haloH - 1, wy >> 1));
      const row = gy * gridW;
      for (let gx = this.minX; gx <= this.maxX; gx += step) {
        const idx = row + gx;
        const amt = amount[idx];
        if (amt < 0.14) continue;
        const band = this.computeCellBand(idx, 0);
        if (band < 3) continue;

        const mat = (material[idx] || FluidMaterial.CONCRETE) as FluidMaterialId;
        const pal = FLUID_MATERIAL_PALETTES[mat] ?? FLUID_MATERIAL_PALETTES[FluidMaterial.CONCRETE];
        const rgb = pal[band];
        const heatWeight = (band - 2) * 0.25 * Math.min(1.2, amt * 0.9) * gain;

        const wx = Math.floor((gx + 0.5) * cellSize);
        const hx = Math.max(0, Math.min(haloW - 1, wx >> 1));
        const hi = (hy * haloW + hx) * 3;
        halo[hi] = Math.min(255, halo[hi] + rgb[0] * heatWeight);
        halo[hi + 1] = Math.min(255, halo[hi + 1] + rgb[1] * heatWeight);
        halo[hi + 2] = Math.min(255, halo[hi + 2] + rgb[2] * heatWeight);
        samplesEmitted++;
      }
    }
    return samplesEmitted;
  }

  /** Renders the entire active fluid grid and optional spark layer into one `ImageData` buffer
   * and blits it to `targetCtx` with a single `putImageData` + `drawImage` call. */
  render(
    targetCtx: CanvasRenderingContext2D,
    world: VoidWorld,
    preset: TimeOfDayPreset,
    weather: VoidWeatherMode,
    wetness: number,
    animTime: number,
    reduceEffects: boolean,
    viewBounds?: { x0: number; y0: number; x1: number; y1: number },
  ): { drawnCells: number; drawnSparks: number } {
    this.ensureSize(world.grid.w, world.grid.h, this.cellSize || 1);
    const { gridW, gridH, cellSize, amount, material, flowDist, flowCoreR } = this;
    // Ensure canvas and ImageData exist if DOM became available after construction
    if (!this.imageData && this.ctx && this.canvas) {
      this.canvas.width = gridW;
      this.canvas.height = gridH;
      this.imageData = this.ctx.createImageData(gridW, gridH);
      this.rasterU32 = new Uint32Array(this.imageData.data.buffer);
    }
    const rasterU32 = this.rasterU32;
    const hasFluid = this.maxX >= this.minX && this.maxY >= this.minY;

    let vx0 = 0;
    let vy0 = 0;
    let vx1 = gridW - 1;
    let vy1 = gridH - 1;
    if (viewBounds) {
      vx0 = Math.max(0, Math.floor((viewBounds.x0 - 4) / cellSize));
      vy0 = Math.max(0, Math.floor((viewBounds.y0 - 4) / cellSize));
      vx1 = Math.min(gridW - 1, Math.ceil((viewBounds.x1 + 4) / cellSize));
      vy1 = Math.min(gridH - 1, Math.ceil((viewBounds.y1 + 4) / cellSize));
    }

    const bx0 = hasFluid ? Math.max(vx0, this.minX - 1) : vx0;
    const by0 = hasFluid ? Math.max(vy0, this.minY - 1) : vy0;
    const bx1 = hasFluid ? Math.min(vx1, this.maxX + 1) : vx1;
    const by1 = hasFluid ? Math.min(vy1, this.maxY + 1) : vy1;

    // Sky/Time-of-Day lighting gain for outer material bands; hot inner bands are self-emissive
    const sky = looseMaterialLight(preset);
    const wetSheen = weather === "rain" || wetness > 0.05 ? 1 + wetness * 0.12 : 1.0;

    let drawMinX = gridW;
    let drawMinY = gridH;
    let drawMaxX = -1;
    let drawMaxY = -1;
    let drawnCells = 0;

    if (hasFluid && bx1 >= bx0 && by1 >= by0) {
      this.syncFlowField(world);
      for (let gy = by0; gy <= by1; gy++) {
        const row = gy * gridW;
        for (let gx = bx0; gx <= bx1; gx++) {
          const idx = row + gx;
          const amt = amount[idx];
          if (amt <= 0.03) {
            rasterU32[idx] = 0;
            continue;
          }
          const d = flowDist[idx];
          const coreR = flowCoreR[idx] || 4.0;
          if (d <= coreR + 0.15) {
            rasterU32[idx] = 0;
            continue;
          }

          // Only render inside Void or EMPTY space
          const wx = Math.min(world.grid.w - 1, Math.floor((gx + 0.5) * cellSize));
          const wy = Math.min(world.grid.h - 1, Math.floor((gy + 0.5) * cellSize));
          const wIdx = wy * world.grid.w + wx;
          if (world.material[wIdx] !== CellMaterial.VOID && world.material[wIdx] !== CellMaterial.EMPTY) {
            rasterU32[idx] = 0;
            continue;
          }

          const mat = (material[idx] || FluidMaterial.CONCRETE) as FluidMaterialId;
          const pal = FLUID_MATERIAL_PALETTES[mat] ?? FLUID_MATERIAL_PALETTES[FluidMaterial.CONCRETE];
          const band = this.computeCellBand(idx, reduceEffects ? 0 : animTime);
          const baseRgb = pal[band];

          // Emissive blend: bands 0..2 take Time-of-Day sky lighting; bands 3..6 glow with self-emission
          const emission = band <= 1 ? 0.12 : band === 2 ? 0.35 : band === 3 ? 0.68 : 0.94;
          const litR = baseRgb[0] * (sky[0] + (1 - sky[0]) * emission);
          const litG = baseRgb[1] * (sky[1] + (1 - sky[1]) * emission);
          const litB = baseRgb[2] * (sky[2] + (1 - sky[2]) * emission);

          // Density modulation: denser cells look brighter and more saturated; thin cells fade out
          const densityNorm = Math.min(1, amt / 1.15);
          // Stepped pixel-art alpha and brightness levels (no smooth blurry gradients)
          const alphaStep = amt < 0.12 ? 128 : amt < 0.28 ? 186 : amt < 0.55 ? 228 : 255;
          let brightScale = (0.76 + 0.32 * densityNorm) * wetSheen;

          // Faint surface edge highlight where fluid borders empty/thin Void on the sunward (N/W) side
          const nAmt = gy > 0 ? amount[idx - gridW] : 0;
          const wAmt = gx > 0 ? amount[idx - 1] : 0;
          const isSurfaceEdge = amt >= 0.18 && (nAmt < 0.05 || wAmt < 0.05);
          const edgeBoost = isSurfaceEdge ? 26 : 0;
          if (isSurfaceEdge) brightScale *= 1.08;

          const r = Math.min(255, Math.max(0, Math.round(litR * brightScale + edgeBoost)));
          const g = Math.min(255, Math.max(0, Math.round(litG * brightScale + edgeBoost * 0.85)));
          const b = Math.min(255, Math.max(0, Math.round(litB * brightScale + edgeBoost * 1.1)));

          rasterU32[idx] = packAbgr(r, g, b, alphaStep);
          drawnCells++;
          if (gx < drawMinX) drawMinX = gx;
          if (gx > drawMaxX) drawMaxX = gx;
          if (gy < drawMinY) drawMinY = gy;
          if (gy > drawMaxY) drawMaxY = gy;
        }
      }
    }

    // Stamp optional short-lived flair sparks into the same offscreen buffer
    let drawnSparks = 0;
    const touchedSparks: number[] = [];
    if (!reduceEffects) {
      for (let i = 0; i < this.sparkCap; i++) {
        const s = this.sparks[i];
        if (!s.active) continue;
        const gx = Math.floor(s.x / cellSize);
        const gy = Math.floor(s.y / cellSize);
        if (gx < vx0 || gx > vx1 || gy < vy0 || gy > vy1) continue;
        const idx = gy * gridW + gx;
        const pal = FLUID_MATERIAL_PALETTES[s.material] ?? FLUID_MATERIAL_PALETTES[FluidMaterial.CONCRETE];
        const rgb = pal[Math.min(FLUID_BAND_COUNT - 1, Math.max(3, s.band))];
        const fade = s.life > s.maxLife * 0.7 ? 185 : 245;
        rasterU32[idx] = packAbgr(
          Math.min(255, rgb[0] + 38),
          Math.min(255, rgb[1] + 32),
          Math.min(255, rgb[2] + 42),
          fade,
        );
        touchedSparks.push(idx);
        drawnSparks++;
        if (gx < drawMinX) drawMinX = gx;
        if (gx > drawMaxX) drawMaxX = gx;
        if (gy < drawMinY) drawMinY = gy;
        if (gy > drawMaxY) drawMaxY = gy;
      }
    }

    if (drawMaxX >= drawMinX && drawMaxY >= drawMinY && this.ctx && this.canvas && this.imageData) {
      const dw = drawMaxX - drawMinX + 1;
      const dh = drawMaxY - drawMinY + 1;
      this.ctx.putImageData(this.imageData, 0, 0, drawMinX, drawMinY, dw, dh);
      const prevSmooth = targetCtx.imageSmoothingEnabled;
      targetCtx.imageSmoothingEnabled = false;
      targetCtx.drawImage(
        this.canvas,
        drawMinX,
        drawMinY,
        dw,
        dh,
        drawMinX * cellSize,
        drawMinY * cellSize,
        dw * cellSize,
        dh * cellSize,
      );
      targetCtx.imageSmoothingEnabled = prevSmooth;

      // Clean up spark-only pixels outside the fluid dirty box so next frame doesn't leave ghost trails
      for (let i = 0; i < touchedSparks.length; i++) {
        const sIdx = touchedSparks[i];
        if (amount[sIdx] <= 0.03) rasterU32[sIdx] = 0;
      }
    }

    return { drawnCells, drawnSparks };
  }
}

/** Deterministic helper to pick a crack count (2..4) for a melting chunk. */
export function chunkCrackCount(seed: number, cellIdx: number, size: number): number {
  const h = hash01(seed, 619, cellIdx, Math.round(size * 10));
  return size >= 2.5 ? (h < 0.45 ? 3 : 4) : h < 0.55 ? 2 : 3;
}
