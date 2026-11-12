/** High-performance world renderer for Void Defense.
 *
 * Key architecture:
 * - Dirty-chunk offscreen canvas caching (`CHUNK_SIZE = 16` cells, rendered at
 *   one raster pixel per simulation cell). The cached layer holds everything static: warm
 *   graphite streets and stepped skyscraper rooftops with directional shadows, the
 *   countryside (grass, meadow, forest canopy, crop rows, orchards, dirt lanes, river and
 *   bridges, homesteads and barns), the anomaly's spiral nebula and star field composed
 *   around the nearest portal, and the corruption band: land within `CORRUPTION_REACH`
 *   of the Void stained violet, cracked with magenta veins and ending in a dark cliff
 *   with a glowing rim. Only chunks touched by erosion, debris or construction repaint.
 * - Dynamic passes each frame: frontier corona and lightning veins, the black hole's
 *   photon ring, layered event-horizon rings, counter-rotating accretion arcs, lensed
 *   light streaks and orbiting sparkles, twinkling stars, torn-off land slabs drifting
 *   inward with prismatic sparks, traffic, towers, 1x1 riflemen, 1x2 engineers, 2x2
 *   mechs, shells, shockwaves and lasers.
 * - Integer camera zoom/pan math and precision placement Loupe. */

import { dist } from "../exact.ts";
import {
  ARCH_PALETTES,
  type ArchPalette,
  type BuildingHeightMode,
  BuildingSpriteCache,
  type CachedBuildingSprite,
  elevationOf,
  MAX_ELEVATION_PX,
  TOWER_ELEVATION_PX,
} from "./elevation.ts";
import { paintVoidLedge } from "./ledge.ts";
import { computeOrganismContour, computeNodeContour } from "./contour.ts";
import {
  generateWispsForPortals,
  computeVoidInterior,
  paintVoidInterior,
  sampleStarNest,
  starNestColor,
  type SeededWisp,
} from "./interior.ts";
import { pixelPainter } from "./pixel-painter.ts";
import { Loupe } from "./loupe.ts";
import { CHUNK_SIZE, CORRUPTION_REACH, PIXEL_AREA, pixels } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import {
  CellMaterial,
  LandCover,
  type MetroBuilding,
  type PlacedTower,
  type StrikeId,
  type TowerTypeId,
  type VoidPortal,
} from "./model.ts";
import type { VoidSim } from "./sim.ts";
import { STRIKE_SPECS, TOWER_SPECS } from "./towers.ts";
import type { VoidWorld } from "./world.ts";

/** Side of the local window a chunk's distance-to-Void transform runs on (chunk plus margin). */
const DIST_WINDOW = CHUNK_SIZE + CORRUPTION_REACH * 2;
/** Chamfer 3-4 distance: orthogonal step 3, diagonal step 4, so `value / 3` approximates cells. */
const CHAMFER_INF = 0x7fff;

/** Quantized violet stain for the corruption band, indexed by chamfer distance (0..3*REACH). */
const CORRUPTION_TINTS: readonly string[] = (() => {
  const out: string[] = [];
  for (let k = 0; k <= CORRUPTION_REACH * 3 + 2; k++) {
    const dv = k / 3;
    const t = Math.pow(Math.max(0, 1 - dv / (CORRUPTION_REACH + 0.6)), 1.5);
    out.push(`rgba(58, 8, 96, ${(0.7 * t).toFixed(3)})`);
  }
  return out;
})();

/** Spiral-nebula colour ramp around a portal, from deep space to hot magenta. */
const NEBULA_RAMP: readonly string[] = [
  "#07041a",
  "#120a33",
  "#1f1050",
  "#2f176f",
  "#4a1f93",
  "#6e2bb4",
  "#9a36cf",
  "#c746dd",
  "#ff6ee8",
];

function nebulaColor(intensity: number): string {
  const i = Math.max(0, Math.min(NEBULA_RAMP.length - 1, Math.floor(intensity * (NEBULA_RAMP.length - 0.001))));
  return NEBULA_RAMP[i];
}

export type DragPreview =
  | { kind: "tower"; type: TowerTypeId; x: number; y: number; valid: boolean }
  | { kind: "strike"; strike: StrikeId; x: number; y: number; valid: boolean }
  | { kind: "reticle"; towerUid: number; x: number; y: number }
  | { kind: "blueprint"; points: { x: number; y: number }[] };

interface TronCorridor {
  fromBld: number;
  toBld: number;
  path: readonly { x: number; y: number }[];
}

interface TronCycle {
  corridorIdx: number;
  color: string;
  dist: number;
  speed: number;
}

export class VoidRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrainLayer: HTMLCanvasElement;
  private readonly sceneLayer: HTMLCanvasElement;
  private readonly sceneCtx: CanvasRenderingContext2D;
  private readonly pixelCtx: CanvasRenderingContext2D;
  private readonly tctx: CanvasRenderingContext2D;
  private renderedWorld: VoidWorld | null = null;
  private renderedHeightMode: BuildingHeightMode = "full";
  /** Last painted state of each world pixel, including neighboring corrosion/shadow. */
  private paintedPixels = new Float64Array(0);
  private paintedNeighbors = new Float64Array(0);
  /** Cached deep-space backdrop (stars and a faint nebula wash) behind the board. */
  private backdrop: HTMLCanvasElement | null = null;
  /** Scratch chamfer distance-to-Void window for the chunk being painted (tenths of cells ×3). */
  private readonly distWindow = new Int16Array(DIST_WINDOW * DIST_WINDOW);
  /** Origin of `distWindow` in cell coordinates for the chunk being painted. */
  private distOx = 0;
  private distOy = 0;
  /** Milliseconds spent in each pass of the last `draw` (`voidFrameTimes()` in the console). */
  readonly lastTimings: Record<string, number> = {};
  readonly loupe = new Loupe();
  /** When true, suppresses dynamic shimmer/lensing overlays for reduced-motion accessibility & comparison. */
  reduceEffects = false;
  /** Oblique building height projection (`full`, `low`, or `flat`). */
  buildingHeight: BuildingHeightMode = "full";
  /** Per-building elevated roof & south-facade sprite cache. */
  readonly spriteCache = new BuildingSpriteCache();

  // Tron light cycle trails along streets connecting buildings
  private corridors: TronCorridor[] = [];
  private cycles: TronCycle[] = [];
  private corridorsWorld: VoidWorld | null = null;
  private lastTimeMs = 0;

  // Cached seeded spiral wisps for living Void interior
  private interiorWisps: SeededWisp[] = [];
  private wispsWorld: VoidWorld | null = null;

  /** Camera state: `s` = zoom multiplier (1 = fit board), `x, y` = canvas pixel pan. */
  readonly cam = { s: 1, x: 0, y: 0 };
  px = 4; // device pixels per cell at zoom 1
  static readonly MAX_ZOOM = 7;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sceneLayer = document.createElement("canvas");
    this.sceneCtx = this.sceneLayer.getContext("2d", { alpha: false })!;
    this.pixelCtx = pixelPainter(this.sceneCtx);
    this.terrainLayer = document.createElement("canvas");
    this.tctx = this.terrainLayer.getContext("2d", { alpha: false })!;
  }

  resize(worldW: number, worldH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round((this.canvas.clientWidth || 800) * dpr));
    const ch = Math.max(1, Math.round((this.canvas.clientHeight || 600) * dpr));
    const fit = Math.min(cw / worldW, ch / worldH);
    if (
      this.canvas.width !== cw ||
      this.canvas.height !== ch ||
      Math.abs(this.px - fit) > 0.01
    ) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.px = fit;
      this.clampCam(worldW, worldH);
    }
  }

  private pixelScale(zoom = this.cam.s): number {
    const scale = zoom * this.px;
    // Keep the full-city overview fitted; close zoom uses uniform device-pixel blocks.
    return zoom > 1 && scale >= 1 ? Math.max(1, Math.round(scale)) : scale;
  }

  toCell(clientX: number, clientY: number): { fx: number; fy: number; cx: number; cy: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * this.canvas.width;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * this.canvas.height;
    const fx = (x - this.cam.x) / this.pixelScale();
    const fy = (y - this.cam.y) / this.pixelScale();
    return { fx, fy, cx: Math.floor(fx), cy: Math.floor(fy) };
  }

  toClient(fx: number, fy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = fx * this.pixelScale() + this.cam.x;
    const y = fy * this.pixelScale() + this.cam.y;
    return {
      x: r.left + (x / Math.max(1, this.canvas.width)) * r.width,
      y: r.top + (y / Math.max(1, this.canvas.height)) * r.height,
    };
  }

  panBy(dxClient: number, dyClient: number, worldW: number, worldH: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.cam.x += (dxClient / Math.max(1, r.width)) * this.canvas.width;
    this.cam.y += (dyClient / Math.max(1, r.height)) * this.canvas.height;
    this.clampCam(worldW, worldH);
  }

  zoomAt(clientX: number, clientY: number, factor: number, worldW: number, worldH: number): void {
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / Math.max(1, r.width)) * this.canvas.width;
    const py = ((clientY - r.top) / Math.max(1, r.height)) * this.canvas.height;
    const nextS = Math.max(0.85, Math.min(VoidRenderer.MAX_ZOOM, this.cam.s * factor));
    const k = this.pixelScale(nextS) / this.pixelScale();
    this.cam.x = px - (px - this.cam.x) * k;
    this.cam.y = py - (py - this.cam.y) * k;
    this.cam.s = nextS;
    this.clampCam(worldW, worldH);
  }

  resetCam(worldW: number, worldH: number): void {
    this.cam.s = 1;
    this.cam.x = 0;
    this.cam.y = 0;
    this.clampCam(worldW, worldH);
  }

  private clampCam(worldW: number, worldH: number): void {
    const scale = this.pixelScale();
    const bw = worldW * scale;
    const bh = worldH * scale;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const roofMargin = Math.ceil(MAX_ELEVATION_PX * scale);
    this.cam.x = bw <= cw ? (cw - bw) * 0.5 : Math.min(60, Math.max(cw - bw - 60, this.cam.x));
    this.cam.y =
      bh + roofMargin <= ch
        ? (ch - bh + roofMargin) * 0.5
        : Math.min(60 + roofMargin, Math.max(ch - bh - 60, this.cam.y));
    this.cam.x = Math.round(this.cam.x);
    this.cam.y = Math.round(this.cam.y);
  }

  /** Picks the topmost visible structure (tower or elevated building roof/facade) at client coordinates. */
  pickStructureAt(
    world: VoidWorld,
    towers: readonly PlacedTower[],
    clientX: number,
    clientY: number,
  ): { kind: "tower"; uid: number } | { kind: "building"; id: number } | null {
    const { fx, fy } = this.toCell(clientX, clientY);
    return this.spriteCache.pickStructureAt(world, towers, fx, fy, this.buildingHeight);
  }

  /** Builds orthogonal street circuit corridors connecting nearby buildings for Tron light trails. */
  private syncCorridors(world: VoidWorld): void {
    if (this.corridorsWorld === world && this.corridors.length > 0) return;
    this.corridorsWorld = world;
    this.corridors = [];
    this.cycles = [];

    const { w, h } = world.grid;
    const isStreet = (x: number, y: number) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      const i = world.grid.index(x, y);
      // Light cycles ride city streets only, never the countryside's dirt lanes
      return world.material[i] === CellMaterial.STREET && world.streetTier[i] !== 8;
    };

    const findDoor = (b: MetroBuilding) => {
      const cx = b.x + Math.floor(b.w / 2);
      const cy = b.y + Math.floor(b.h / 2);
      if (b.y > 0 && isStreet(cx, b.y - 1)) return { x: cx, y: b.y - 1 };
      if (b.y + b.h < h && isStreet(cx, b.y + b.h)) return { x: cx, y: b.y + b.h };
      if (b.x > 0 && isStreet(b.x - 1, cy)) return { x: b.x - 1, y: cy };
      if (b.x + b.w < w && isStreet(b.x + b.w, cy)) return { x: b.x + b.w, y: cy };
      for (let x = b.x; x < b.x + b.w; x++) {
        if (b.y > 0 && isStreet(x, b.y - 1)) return { x, y: b.y - 1 };
        if (b.y + b.h < h && isStreet(x, b.y + b.h)) return { x, y: b.y + b.h };
      }
      for (let y = b.y; y < b.y + b.h; y++) {
        if (b.x > 0 && isStreet(b.x - 1, y)) return { x: b.x - 1, y };
        if (b.x + b.w < w && isStreet(b.x + b.w, y)) return { x: b.x + b.w, y };
      }
      return null;
    };

    const visited = new Uint8Array(w * h);
    const bldCount = world.buildings.length;

    for (let i = 0; i < bldCount; i++) {
      const bA = world.buildings[i];
      const dA = findDoor(bA);
      if (!dA) continue;

      let bestB = -1;
      let bestDist = 26;
      for (let j = Math.max(0, i - 12); j < Math.min(bldCount, i + 12); j++) {
        if (i === j) continue;
        const bB = world.buildings[j];
        const d = Math.abs(bB.x - bA.x) + Math.abs(bB.y - bA.y);
        if (d > 2 && d < bestDist) {
          bestDist = d;
          bestB = j;
        }
      }
      if (bestB === -1) continue;
      const dB = findDoor(world.buildings[bestB]);
      if (!dB) continue;

      visited.fill(0);
      visited[dA.y * w + dA.x] = 1;
      const queue: { x: number; y: number; pts: { x: number; y: number }[] }[] = [
        { x: dA.x, y: dA.y, pts: [dA] },
      ];
      let path: { x: number; y: number }[] | null = null;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.x === dB.x && cur.y === dB.y) {
          path = cur.pts;
          break;
        }
        if (cur.pts.length >= pixels(28)) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (!isStreet(nx, ny)) continue;
          const idx = ny * w + nx;
          if (visited[idx]) continue;
          visited[idx] = 1;
          queue.push({ x: nx, y: ny, pts: [...cur.pts, { x: nx, y: ny }] });
        }
      }

      if (path && path.length >= 4) {
        this.corridors.push({ fromBld: i, toBld: bestB, path });
      }
    }

    // Populate active Tron cycles along the network
    const cycleCount = Math.min(64, Math.floor(this.corridors.length * 0.45));
    const colors = ["#ff9e38", "#ff7426", "#ffd166", "#48e5ff", "#ff8c33"];
    for (let c = 0; c < cycleCount; c++) {
      const corridorIdx = (c * 7 + (world.seed & 31)) % Math.max(1, this.corridors.length);
      const corr = this.corridors[corridorIdx];
      this.cycles.push({
        corridorIdx,
        color: colors[c % colors.length],
        dist: ((c * 13) % Math.max(1, corr.path.length)),
        speed: pixels(5.5 + (c % 4) * 1.5),
      });
    }
  }

  /** Repaints only dirtied 16x16 cell chunks into `this.terrainLayer`. */
  private syncDirtyChunks(world: VoidWorld): void {
    const { w, h, chunksW, chunksH, dirtyChunks } = world.grid;
    const targetW = w;
    const targetH = h;

    if (
      this.renderedWorld !== world ||
      this.renderedHeightMode !== this.buildingHeight ||
      this.terrainLayer.width !== targetW ||
      this.terrainLayer.height !== targetH
    ) {
      this.renderedWorld = world;
      this.renderedHeightMode = this.buildingHeight;
      this.paintedPixels = new Float64Array(world.grid.count).fill(-1);
      this.paintedNeighbors = new Float64Array(world.grid.count).fill(-1);
      this.terrainLayer.width = targetW;
      this.terrainLayer.height = targetH;
      world.grid.markAllDirty();
    }

    if (!world.grid.hasDirtyChunks()) return;

    const c = this.tctx;
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);

    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        const chunkIdx = cy * chunksW + cx;
        if (!dirtyChunks[chunkIdx]) continue;
        this.paintChunk(c, world, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      }
    }

    world.grid.clearDirtyFlags();
  }

  /** Computes elevation-based directional shadow darkness (0..0.68) cast onto `(x, y)` toward the SE
   * up to `ceil(E * 0.6)` world pixels away. */
  private computeShadowAt(world: VoidWorld, x: number, y: number, selfHeight: number): number {
    const { w } = world.grid;
    const mode = this.buildingHeight === "flat" ? "full" : this.buildingHeight;
    const selfElev = selfHeight > 0 ? elevationOf({ height: selfHeight }, mode) : 0;
    let maxShade = 0;
    // Maximum elevation is 15 px -> ceil(15 * 0.6) = 9 px reach
    for (let step = 1; step <= 9; step++) {
      const nx = x - step;
      const ny = y - step;
      if (nx >= 0 && ny >= 0) {
        const bId = world.buildingAt[ny * w + nx];
        if (bId >= 0) {
          const b = world.buildings[bId];
          if (b) {
            const bElev = elevationOf(b, mode);
            const deltaE = bElev - selfElev;
            const reach = Math.ceil(deltaE * 0.6);
            if (deltaE > 0 && step <= reach) {
              maxShade = Math.max(maxShade, 0.62 - (step - 1) * (0.42 / Math.max(1, reach)));
            }
          }
        }
      }
      if (step === 1) {
        if (x > 0) {
          const wbId = world.buildingAt[y * w + (x - 1)];
          if (wbId >= 0 && (world.buildings[wbId]?.height ?? 0) > selfHeight + 2) {
            maxShade = Math.max(maxShade, 0.42);
          }
        }
        if (y > 0) {
          const nbId = world.buildingAt[(y - 1) * w + x];
          if (nbId >= 0 && (world.buildings[nbId]?.height ?? 0) > selfHeight + 2) {
            maxShade = Math.max(maxShade, 0.38);
          }
        }
      }
    }
    return maxShade;
  }

  /** Result of `nearestPortal` (reused to avoid an allocation per Void cell). */
  private readonly np: { p: VoidPortal | null; d: number; ang: number } = { p: null, d: 0, ang: 0 };

  /** Nearest portal (preferring active ones) to cell `(x, y)` with distance and angle;
   * the black hole's spiral nebula and the frontier's lightning are oriented around it. */
  private nearestPortal(world: VoidWorld, x: number, y: number): { p: VoidPortal | null; d: number; ang: number } {
    let best: VoidPortal | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    let bestActive = false;
    const px = x + 0.5;
    const py = y + 0.5;
    for (const p of world.portals) {
      const d = dist(px - p.x, py - p.y);
      const better = p.active && !bestActive ? true : p.active === bestActive ? d < bestD : false;
      if (better) {
        best = p;
        bestD = d;
        bestActive = p.active;
      }
    }
    const np = this.np;
    if (!best) {
      const cx = world.grid.w * 0.5;
      const cy = world.grid.h * 0.5;
      np.p = null;
      np.d = dist(px - cx, py - cy);
      np.ang = Math.atan2(py - cy, px - cx);
      return np;
    }
    np.p = best;
    np.d = bestD;
    np.ang = Math.atan2(py - best.y, px - best.x);
    return np;
  }

  private paintChunk(c: CanvasRenderingContext2D, world: VoidWorld, x0: number, y0: number): void {
    const { w, h } = world.grid;
    const x1 = Math.min(w, x0 + CHUNK_SIZE);
    const y1 = Math.min(h, y0 + CHUNK_SIZE);

    // Distance to the nearest Void cell for every cell of the chunk (plus margin), as a
    // two-pass chamfer transform over a small local window. Skipped when no Void is near.
    const nearVoid = this.buildDistanceWindow(world, x0, y0);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = y * w + x;
        const mat = world.material[idx];
        const bId = world.buildingAt[idx];
        const b = bId >= 0 ? world.buildings[bId] : undefined;
        const hp = world.maxHp[idx] > 0 ? world.hp[idx] / world.maxHp[idx] : 1;
        const damage = hp <= 0.3 ? 3 : hp < 0.4 ? 2 : hp < 0.75 ? 1 : 0;
        const shadow = mat !== CellMaterial.VOID
          ? Math.round(this.computeShadowAt(world, x, y, b?.height ?? 0) * 100) : 0;
        const distance = nearVoid
          ? Math.min(127, this.distWindow[(y - this.distOy) * DIST_WINDOW + x - this.distOx]) : 127;
        const edges = (x > 0 && world.material[idx - 1] === CellMaterial.VOID ? 1 : 0)
          + (x + 1 < w && world.material[idx + 1] === CellMaterial.VOID ? 2 : 0)
          + (y > 0 && world.material[idx - w] === CellMaterial.VOID ? 4 : 0)
          + (y + 1 < h && world.material[idx + w] === CellMaterial.VOID ? 8 : 0);
        // Exact integer packing below 2^53: all inputs used by static cell painting.
        const signature = mat + world.landCover[idx] * 16 + damage * 256
          + (b && b.development > 1.05 ? 1024 : 0) + shadow * 2048
          + distance * 262144 + edges * 33554432
          + world.isBaselineCell[idx] * 536870912 + (bId + 1) * 1073741824;
        // Bridges, grass verges and building bevels also depend on adjacent surfaces.
        let neighbors = world.streetTier[idx];
        let factor = 16;
        let sameBuilding = 0;
        const adjacent = [x > 0 ? idx - 1 : -1, x + 1 < w ? idx + 1 : -1,
          y > 0 ? idx - w : -1, y + 1 < h ? idx + w : -1];
        for (let side = 0; side < adjacent.length; side++) {
          const n = adjacent[side];
          neighbors += (n < 0 ? 255 : world.material[n] + world.landCover[n] * 16) * factor;
          if (n >= 0 && world.buildingAt[n] === bId) sameBuilding += 2 ** side;
          factor *= 256;
        }
        neighbors += sameBuilding * factor;
        if (this.paintedPixels[idx] === signature && this.paintedNeighbors[idx] === neighbors) continue;
        this.paintCell(c, world, x, y, nearVoid);
        this.paintedPixels[idx] = signature;
        this.paintedNeighbors[idx] = neighbors;
      }
    }
  }

  /** Fills `distWindow` with chamfer 3-4 distances to the nearest Void cell for the window
   * around chunk `(x0, y0)`. Returns false (and skips the work) when the window holds no Void. */
  private buildDistanceWindow(world: VoidWorld, x0: number, y0: number): boolean {
    const { w, h } = world.grid;
    const mat = world.material;
    const ox = x0 - CORRUPTION_REACH;
    const oy = y0 - CORRUPTION_REACH;
    this.distOx = ox;
    this.distOy = oy;
    const D = this.distWindow;
    const N = DIST_WINDOW;
    let any = false;
    for (let ly = 0; ly < N; ly++) {
      const y = oy + ly;
      const inY = y >= 0 && y < h;
      const row = y * w;
      for (let lx = 0; lx < N; lx++) {
        const x = ox + lx;
        let v = CHAMFER_INF;
        if (inY && x >= 0 && x < w && mat[row + x] === CellMaterial.VOID) {
          v = 0;
          any = true;
        }
        D[ly * N + lx] = v;
      }
    }
    if (!any) return false;
    // Forward pass
    for (let ly = 0; ly < N; ly++) {
      for (let lx = 0; lx < N; lx++) {
        const i = ly * N + lx;
        let v = D[i];
        if (v === 0) continue;
        if (lx > 0) v = Math.min(v, D[i - 1] + 3);
        if (ly > 0) {
          v = Math.min(v, D[i - N] + 3);
          if (lx > 0) v = Math.min(v, D[i - N - 1] + 4);
          if (lx + 1 < N) v = Math.min(v, D[i - N + 1] + 4);
        }
        D[i] = v;
      }
    }
    // Backward pass
    for (let ly = N - 1; ly >= 0; ly--) {
      for (let lx = N - 1; lx >= 0; lx--) {
        const i = ly * N + lx;
        let v = D[i];
        if (v === 0) continue;
        if (lx + 1 < N) v = Math.min(v, D[i + 1] + 3);
        if (ly + 1 < N) {
          v = Math.min(v, D[i + N] + 3);
          if (lx + 1 < N) v = Math.min(v, D[i + N + 1] + 4);
          if (lx > 0) v = Math.min(v, D[i + N - 1] + 4);
        }
        D[i] = v;
      }
    }
    return true;
  }

  /** Native world-pixel art: every detail selects a whole simulation cell. */
  private paintCell(c: CanvasRenderingContext2D, world: VoidWorld, x: number, y: number, nearVoid: boolean): void {
    const { w, h } = world.grid;
    const idx = y * w + x;
    const mat = world.material[idx], cover = world.landCover[idx];
    const bId = world.buildingAt[idx];
    const b = bId >= 0 ? world.buildings[bId] : undefined;
    const r = hash01(world.seed, 951, x, y);
    const hp = world.maxHp[idx] ? world.hp[idx] / world.maxHp[idx] : 1;
    let color = "#040507";
    if (mat === CellMaterial.VOID) {
      const np = this.nearestPortal(world, x, y);
      const radius = np.p?.radius ?? 12;
      const core = Math.max(3.6, radius * 0.42);
      if (np.d < core) color = "#000000";
      else if (np.d < core + 1) color = "#ff4fd8";
      else {
        // Sample the recolored Star Nest volumetric fractal field
        const logR = Math.log(np.d + 1.0);
        const u = ((np.ang / (Math.PI * 2)) * 2.0 + logR * 0.35) % 1;
        const v = (np.d * 0.045) % 1;
        const intensity = sampleStarNest(u, v);

        // Blended with radial falloff
        const fall = Math.max(0, 1 - ((np.d - core) / (radius * 3.8)) ** 2);
        const arm = 0.5 + 0.5 * Math.sin(np.ang * 2 + Math.log(np.d + 1) * 5.2);
        const compositeIntensity = Math.min(1, intensity * (0.5 + fall * 0.5) + arm * 0.25 * fall);
        color = starNestColor(compositeIntensity, (x * 7 + y * 13) & 15);
      }
    } else if (mat === CellMaterial.UNCLAIMED) {
      color = cover === LandCover.RIVER ? (r < 0.2 ? "#58b0e6" : "#2f78b8") : "#0f2c44";
    } else if (mat === CellMaterial.WALL || mat === CellMaterial.BARRIER) {
      color = mat === CellMaterial.BARRIER ? "#48e5ff" : (x + y) % 3 === 0 ? "#ff922b" : "#5c6d85";
    } else if (mat === CellMaterial.RECLAIMED) {
      color = r < 0.3 ? "#b08b54" : "#80643e";
    } else if (mat === CellMaterial.SALVAGE) {
      color = r < 0.25 ? "#ff8c29" : r < 0.6 ? "#6e472b" : "#463b43";
    } else if (b) {
      // In oblique view, paintCell paints only the building's ground footprint
      // (foundation slab, plaza paving, or dark base). Roofs, roof features, and south
      // facades are drawn in the sorted structure pass.
      const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
      const pal = palettes[b.variant % palettes.length];
      const edge =
        x === 0 ||
        y === 0 ||
        x + 1 === w ||
        y + 1 === h ||
        world.buildingAt[idx - 1] !== bId ||
        world.buildingAt[idx + 1] !== bId ||
        world.buildingAt[idx - w] !== bId ||
        world.buildingAt[idx + w] !== bId;
      color = edge ? pal.podium : pal.shadeEdge;
      if (hp < 0.4) color = r < 0.3 ? "#ff42b8" : "#12091c";
      else if (hp < 0.75 && r < 0.35) color = "#ff8c29";
    } else if (mat === CellMaterial.STREET) {
      if (world.streetTier[idx] === 8) color = cover === LandCover.BRIDGE
        ? (x + y) % 3 === 0 ? "#4a3422" : "#8a6a48"
        : r < 0.25 ? "#c9a66f" : "#9a7549";
      else color = world.streetTier[idx] === 4 ? "#050608" : "#040507";
    } else if (mat === CellMaterial.PARK) {
      switch (cover) {
        case LandCover.NONE: color = (x + y) % 4 === 0 ? "#1b332b" : "#090d12"; break;
        case LandCover.FOREST: color = r < 0.2 ? "#5fae5a" : r < 0.7 ? "#2f6b36" : "#1a3d22"; break;
        case LandCover.FIELD_H: color = y % 3 === 0 ? "#8c6a3a" : "#dfab3c"; break;
        case LandCover.FIELD_V: color = x % 3 === 0 ? "#8c6a3a" : "#b7c24a"; break;
        case LandCover.ORCHARD: color = x % 3 === 0 && y % 3 === 0 ? "#ff7a3a" : "#3d8a48"; break;
        case LandCover.SILO: color = x % 3 === 0 ? "#e2e8f0" : "#6b7684"; break;
        default: color = r < 0.2 ? "#639c3f" : r < 0.6 ? "#4b7f2f" : "#467a2c";
      }
    }
    c.fillStyle = color;
    c.fillRect(x, y, 1, 1);
    if (mat === CellMaterial.VOID) return;
    const shade = this.computeShadowAt(world, x, y, b?.height ?? 0);
    if (shade > 0) {
      c.fillStyle = `rgba(2, 3, 5, ${shade * 0.75})`;
      c.fillRect(x, y, 1, 1);
    }
    if (!nearVoid) return;
    const distance = this.distWindow[(y - this.distOy) * DIST_WINDOW + x - this.distOx];
    if (distance <= CORRUPTION_REACH * 3 && mat !== CellMaterial.WALL && mat !== CellMaterial.BARRIER) {
      c.fillStyle = CORRUPTION_TINTS[distance];
      c.fillRect(x, y, 1, 1);
    }
    if (distance <= 3) {
      c.fillStyle = r < 0.15 ? "#ffd6ff" : r < 0.5 ? "#b23fe6" : "#6a1fb0";
      c.fillRect(x, y, 1, 1);
    }
  }

  /** The space behind the board: near-black indigo with sparse crisp stars and a faint
   * violet wash, so the margins around a portrait board read as the same cosmos the
   * anomaly opens onto rather than a blank panel. Rebuilt only when the canvas resizes. */
  private backdropFor(cw: number, ch: number, seed: number): HTMLCanvasElement {
    if (this.backdrop && this.backdrop.width === cw && this.backdrop.height === ch) return this.backdrop;
    const bd = this.backdrop ?? document.createElement("canvas");
    bd.width = cw;
    bd.height = ch;
    const b = bd.getContext("2d")!;
    b.fillStyle = "#05060e";
    b.fillRect(0, 0, cw, ch);
    const wash = b.createRadialGradient(cw * 0.5, ch * 0.5, Math.min(cw, ch) * 0.2, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.75);
    wash.addColorStop(0, "rgba(40, 14, 70, 0.35)");
    wash.addColorStop(1, "rgba(5, 6, 14, 0)");
    b.fillStyle = wash;
    b.fillRect(0, 0, cw, ch);
    const stars = Math.floor((cw * ch) / 2600);
    for (let i = 0; i < stars; i++) {
      const sx = Math.floor(hash01(seed, 870, i) * cw);
      const sy = Math.floor(hash01(seed, 871, i) * ch);
      const r = hash01(seed, 872, i);
      b.fillStyle = r < 0.08 ? "#7afcff" : r < 0.16 ? "#ff94e8" : r < 0.3 ? "#8a68d6" : r < 0.6 ? "#c9d3e6" : "#f4f6ff";
      b.globalAlpha = 0.35 + 0.65 * hash01(seed, 873, i);
      b.fillRect(sx, sy, r > 0.96 ? 2 : 1, r > 0.96 ? 2 : 1);
    }
    b.globalAlpha = 1;
    this.backdrop = bd;
    return bd;
  }

  /** Renders the complete metropolitan board, active Void frontier, portals,
   * ambient traffic, towers, 1-pixel soldiers, 1x2 engineers, projectiles, and overlays. */
  draw(
    sim: VoidSim,
    nowMs: number,
    selectedTowerUid: number | null,
    preview: DragPreview | null,
    pointerForLoupe: { clientX: number; clientY: number; cellX: number; cellY: number } | null,
    showMagnifier: boolean,
  ): void {
    const { world, voidField, combat, physics } = sim;
    const T = this.lastTimings;
    let tMark = performance.now();
    const lap = (name: string): void => {
      const now = performance.now();
      T[name] = now - tMark;
      tMark = now;
    };
    this.resize(world.grid.w, world.grid.h);
    this.syncDirtyChunks(world);
    lap("chunks");

    if (this.sceneLayer.width !== world.grid.w || this.sceneLayer.height !== world.grid.h) {
      this.sceneLayer.width = world.grid.w;
      this.sceneLayer.height = world.grid.h;
    }
    const c = this.pixelCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;

    // 1. Draw cached metropolitan terrain layer
    c.drawImage(this.terrainLayer, 0, 0, world.grid.w, world.grid.h);

    const animTime = this.reduceEffects ? 0 : nowMs * 0.001;
    const pulse = this.reduceEffects ? 0.75 : 0.65 + 0.35 * Math.sin(animTime * 5.2);

    lap("terrain");

    // 2. Tron Light Cycles & Stream Trails running along street corridors from building to building
    this.syncCorridors(world);
    const dt = this.lastTimeMs > 0 ? Math.min(0.08, (nowMs - this.lastTimeMs) * 0.001) : 0.016;
    this.lastTimeMs = nowMs;

    const TRAIL_LEN = pixels(16);
    for (const cyc of this.cycles) {
      if (cyc.corridorIdx >= this.corridors.length) continue;
      const corr = this.corridors[cyc.corridorIdx];
      const pLen = corr.path.length;
      if (pLen < 2) continue;

      cyc.dist = (cyc.dist + cyc.speed * dt) % pLen;
      const headIdx = Math.floor(cyc.dist);

      // Draw fading Tron tail along corridor path
      for (let t = TRAIL_LEN; t >= 0; t--) {
        const segIdx = ((headIdx - t) % pLen + pLen) % pLen;
        const pt = corr.path[segIdx];
        if (!pt) continue;
        if (world.material[world.grid.index(pt.x, pt.y)] !== CellMaterial.STREET) continue;

        const age = t / TRAIL_LEN;
        if (t === 0) {
          // Brilliant white quantum head with orange halo
          c.fillStyle = "#ffffff";
          c.fillRect(pt.x + 0.1, pt.y + 0.1, 0.8, 0.8);
        } else if (age < 0.25) {
          c.fillStyle = "#ffe49e";
          c.fillRect(pt.x + 0.2, pt.y + 0.2, 0.6, 0.6);
        } else if (age < 0.55) {
          c.fillStyle = cyc.color;
          c.fillRect(pt.x + 0.25, pt.y + 0.25, 0.5, 0.5);
        } else if (age < 0.8) {
          c.fillStyle = "#cc440a";
          c.fillRect(pt.x + 0.35, pt.y + 0.35, 0.3, 0.3);
        } else {
          c.fillStyle = "#661e05";
          c.fillRect(pt.x + 0.4, pt.y + 0.4, 0.2, 0.2);
        }
      }
    }

    const { w, h } = world.grid;
    lap("traffic");

    // 3. Living frontier: a soft violet corona on threatened cells, matter sparks, and
    //    flickering lightning veins reaching from the land into the anomaly
    const activePortals = world.portals.filter((p) => p.active);
    let vx0 = w;
    let vy0 = h;
    let vx1 = 0;
    let vy1 = 0;
    for (let i = 0; i < voidField.frontierCells.length; i++) {
      const cIdx = voidField.frontierCells[i];
      const fx = world.grid.xOf(cIdx);
      const fy = world.grid.yOf(cIdx);
      if (fx < vx0) vx0 = fx;
      if (fy < vy0) vy0 = fy;
      if (fx > vx1) vx1 = fx;
      if (fy > vy1) vy1 = fy;
      const micro = voidField.cellMicroWork[cIdx];
      const intensity = Math.min(1, 0.25 + micro * PIXEL_AREA / 450);

      c.fillStyle = `rgba(200, 60, 255, ${(0.08 + 0.26 * intensity * pulse).toFixed(3)})`;
      c.fillRect(fx - 0.2, fy - 0.2, 1.4, 1.4);

      // Matter-annihilation spark glints (warm orange & cyan & hot pink)
      if (((fx * 7 + fy * 13 + Math.floor(animTime * 12)) & 7) === 0) {
        c.fillStyle = ((fx + fy) & 1) === 0 ? "#ff9e38" : ((fx * 3 + fy) & 1) === 0 ? "#48e5ff" : "#ff5ce1";
        c.fillRect(fx + 0.25, fy + 0.25, 0.5, 0.5);
      }
    }

    if (!this.reduceEffects && voidField.frontierCells.length > 0) {
      const slot = Math.floor(animTime * 9);
      const boltCount = Math.min(12, 2 + ((voidField.frontierCells.length / 90) | 0));
      for (let b = 0; b < boltCount; b++) {
        const cIdx = voidField.frontierCells[hash(world.seed, 760, slot, b) % voidField.frontierCells.length];
        const sx = world.grid.xOf(cIdx) + 0.5;
        const sy = world.grid.yOf(cIdx) + 0.5;
        // Head into the Void: toward the nearest active portal, else away from the land
        let dx = 0;
        let dy = 0;
        let best = Number.POSITIVE_INFINITY;
        for (const p of activePortals) {
          const d = dist(p.x - sx, p.y - sy);
          if (d < best) {
            best = d;
            dx = (p.x - sx) / d;
            dy = (p.y - sy) / d;
          }
        }
        if (!Number.isFinite(best)) {
          if (cIdx > 0 && world.material[cIdx - 1] === CellMaterial.VOID) dx = -1;
          else if (world.material[cIdx + 1] === CellMaterial.VOID) dx = 1;
          else if (cIdx >= w && world.material[cIdx - w] === CellMaterial.VOID) dy = -1;
          else dy = 1;
        }
        const len = 3 + hash01(world.seed, 761, slot, b) * 4.5;
        const segs = 4;
        const flick = 0.55 + 0.45 * hash01(world.seed, 762, slot, b);
        for (let pass = 0; pass < 2; pass++) {
          c.strokeStyle = pass === 0 ? `rgba(255, 90, 230, ${(0.85 * flick).toFixed(3)})` : `rgba(255, 235, 255, ${(0.9 * flick).toFixed(3)})`;
          c.lineWidth = pass === 0 ? 0.34 : 0.13;
          c.beginPath();
          c.moveTo(sx, sy);
          for (let k = 1; k <= segs; k++) {
            const t = k / segs;
            const jit = (hash01(world.seed, 763, slot, b, k) - 0.5) * 1.6;
            c.lineTo(sx + dx * len * t - dy * jit, sy + dy * len * t + dx * jit);
          }
          c.stroke();
        }
        c.fillStyle = "#ffffff";
        c.fillRect(sx + dx * len - 0.3, sy + dy * len - 0.3, 0.6, 0.6);
      }

      // Twinkling stars inside the anomaly (sampled within the Void's bounding box)
      if (vx1 >= vx0 && vy1 >= vy0) {
        const slow = Math.floor(animTime * 0.5);
        for (let i = 0; i < 40; i++) {
          const tx = vx0 + Math.floor(hash01(world.seed, 770, slow, i) * (vx1 - vx0 + 1));
          const ty = vy0 + Math.floor(hash01(world.seed, 771, slow, i) * (vy1 - vy0 + 1));
          if (!world.grid.inBounds(tx, ty) || world.material[ty * w + tx] !== CellMaterial.VOID) continue;
          const tw = Math.abs(Math.sin(animTime * (2 + hash01(world.seed, 772, i) * 3) + i));
          const tint = i % 3 === 0 ? "122, 252, 255" : i % 3 === 1 ? "255, 148, 232" : "255, 255, 255";
          c.fillStyle = `rgba(${tint}, ${(0.25 + 0.75 * tw).toFixed(3)})`;
          const sz = 0.35 + 0.3 * tw;
          c.fillRect(tx + 0.5 - sz * 0.5, ty + 0.5 - sz * 0.5, sz, sz);
        }
      }
    }

    lap("frontier");

    // 4. The black hole: lightless core, photon ring, layered event-horizon rings, tilted
    //    accretion arcs, lensed light streaks and orbiting sparkles around each portal
    for (const p of world.portals) {
      if (p.active) {
        const coreR = Math.max(3.6, p.radius * 0.42);
        const reach = p.radius * 1.9;

        if (!this.reduceEffects) {
          // Soft layered halo rings fading outward, breathing slowly
          const halo = [2.4, 4.3, 6.8, 10.2];
          for (let k = 0; k < halo.length; k++) {
            const r = coreR + halo[k] * (1 + 0.025 * Math.sin(animTime * 1.1 + k * 1.9));
            c.strokeStyle = `rgba(165, 80, 255, ${(0.3 - k * 0.055).toFixed(3)})`;
            c.lineWidth = 0.35 + k * 0.12;
            c.beginPath();
            c.arc(p.x, p.y, r, 0, Math.PI * 2);
            c.stroke();
          }

          // Lensed light streaks: short arcs orbiting at different radii and speeds
          for (let sIdx = 0; sIdx < 18; sIdx++) {
            const r = coreR + 1.6 + hash01(world.seed, 781, p.id, sIdx) * reach;
            const speed = (0.12 + hash01(world.seed, 782, p.id, sIdx) * 0.35) * (sIdx % 2 === 0 ? 1 : -1);
            const a0 = hash01(world.seed, 783, p.id, sIdx) * Math.PI * 2 + animTime * speed;
            const span = 0.25 + hash01(world.seed, 784, p.id, sIdx) * 0.7;
            const hue = sIdx % 4;
            c.strokeStyle =
              hue === 0
                ? "rgba(122, 252, 255, 0.55)"
                : hue === 1
                  ? "rgba(255, 92, 225, 0.55)"
                  : hue === 2
                    ? "rgba(176, 102, 255, 0.5)"
                    : "rgba(255, 240, 255, 0.45)";
            c.lineWidth = 0.22 + hash01(world.seed, 785, p.id, sIdx) * 0.2;
            c.beginPath();
            c.arc(p.x, p.y, r, a0, a0 + span);
            c.stroke();
          }
        }

        // Lightless core
        c.fillStyle = "#000000";
        c.beginPath();
        c.arc(p.x, p.y, coreR, 0, Math.PI * 2);
        c.fill();

        // Photon ring, magenta event horizon, violet glow ring
        c.strokeStyle = "#fff0ff";
        c.lineWidth = 0.32;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 0.05, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "#ff3fd0";
        c.lineWidth = 0.6;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 0.55 + 0.1 * pulse, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "rgba(170, 60, 255, 0.65)";
        c.lineWidth = 0.9;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 1.35, 0, Math.PI * 2);
        c.stroke();

        // Tilted accretion arcs: cyan and gold, counter-rotating
        c.save();
        c.translate(p.x, p.y);
        c.rotate(animTime * 0.5 + p.id);
        c.strokeStyle = "#5ee7ff";
        c.lineWidth = 0.45;
        c.beginPath();
        c.ellipse(0, 0, coreR + 2.1, coreR * 0.72, 0, Math.PI * 0.1, Math.PI * 1.55);
        c.stroke();
        c.rotate(-animTime * 0.95);
        c.strokeStyle = "#ffb347";
        c.lineWidth = 0.4;
        c.beginPath();
        c.ellipse(0, 0, coreR + 1.4, coreR * 0.9, 0.6, Math.PI * 0.5, Math.PI * 1.9);
        c.stroke();
        c.restore();

        if (!this.reduceEffects) {
          // Orbiting sparkles removed in favor of clean fractal Star Nest field
        }
      } else {
        // Telegraphed warning ring for delayed secondary portal
        c.strokeStyle = `rgba(255, 120, 45, ${0.45 + 0.4 * pulse})`;
        c.lineWidth = 0.5;
        c.setLineDash([1.5, 1.5]);
        c.beginPath();
        c.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }

    lap("portals");

    // Living, moving Void interior: inward-flowing spiral wisps & traveling bands
    if (this.wispsWorld !== world) {
      this.wispsWorld = world;
      this.interiorWisps = generateWispsForPortals(world);
    }
    const interiorWisps = computeVoidInterior(world, this.interiorWisps, animTime, this.reduceEffects);
    paintVoidInterior(c, interiorWisps);
    lap("interior");

    // Exposed strata and undercuts sit in front of the nebula and interior wisps, below the ground lip.
    paintVoidLedge(c, world, voidField.frontierCells);
    lap("ledge");

    // 5. Draw crystalline Void Nodes (Phase 6+ infantry targets) with organic nebula contours
    for (const node of voidField.nodes) {
      const contour = computeNodeContour(node, animTime, this.reduceEffects);
      for (const pt of contour) {
        c.fillStyle = pt.color;
        c.fillRect(pt.x, pt.y, 1, 1);
      }
      c.fillStyle = "#59127a";
      c.fillRect(node.x - 1.2, node.y - 1.2, 2.4, 2.4);
      c.fillStyle = "#e056fd";
      c.fillRect(node.x - 0.85, node.y - 0.85, 1.7, 1.7);
      c.fillStyle = "#7afcff";
      c.fillRect(node.x - 0.4, node.y - 0.4, 0.8, 0.8);
    }

    // 6. Draw user-drawn wall blueprints
    for (const bp of combat.blueprints) {
      c.fillStyle = "rgba(255, 168, 52, 0.42)";
      for (const cIdx of bp.cells) {
        if (world.material[cIdx] !== CellMaterial.WALL) {
          c.fillRect(world.grid.xOf(cIdx), world.grid.yOf(cIdx), 1, 1);
        }
      }
    }

    // 7. Draw Shield Projector arcs & Gravity Anchor fields on the ground plane
    for (const t of combat.towers) {
      const cx = t.x + t.w * 0.5;
      const cy = t.y + t.h * 0.5;
      if (t.type === "shieldProjector") {
        const pool = combat.shieldPools.get(t.uid) ?? 0;
        if (pool > 5) {
          const r = TOWER_SPECS.shieldProjector.range + sim.tech.shieldExtraRadius;
          c.strokeStyle = `rgba(72, 229, 255, ${Math.min(0.75, pool / 160)})`;
          c.lineWidth = 0.55;
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (t.type === "gravityAnchor") {
        c.strokeStyle = "rgba(116, 148, 255, 0.38)";
        c.lineWidth = 0.42;
        c.beginPath();
        c.arc(cx, cy, TOWER_SPECS.gravityAnchor.range, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // 8. Sorted Structure Pass: buildings (roof + south facade), placed towers (elevated 2 px),
    //    and autonomous agents (0-1 px) sorted back-to-front by footprint bottom `y` (tie-break `x`).
    const tElev =
      this.buildingHeight === "flat" ? 0 : this.buildingHeight === "low" ? 1 : TOWER_ELEVATION_PX;

    type SortedDrawable =
      | { kind: "building"; bottomY: number; sortX: number; sprite: CachedBuildingSprite }
      | { kind: "tower"; bottomY: number; sortX: number; tower: (typeof combat.towers)[number] }
      | { kind: "agent"; bottomY: number; sortX: number; agent: (typeof combat.agents)[number] };

    const drawables: SortedDrawable[] = [];
    for (let i = 0; i < world.buildings.length; i++) {
      const sp = this.spriteCache.getSprite(world, world.buildings[i], this.buildingHeight);
      if (sp.intactCount > 0) {
        drawables.push({ kind: "building", bottomY: sp.bottomY, sortX: sp.x, sprite: sp });
      }
    }
    for (let i = 0; i < combat.towers.length; i++) {
      const t = combat.towers[i];
      drawables.push({ kind: "tower", bottomY: t.y + t.h, sortX: t.x, tower: t });
    }
    for (let i = 0; i < combat.agents.length; i++) {
      const a = combat.agents[i];
      drawables.push({ kind: "agent", bottomY: Math.floor(a.y) + 1, sortX: Math.floor(a.x), agent: a });
    }

    drawables.sort((a, b) => a.bottomY - b.bottomY || a.sortX - b.sortX);

    // Precompute preview/selection bounding box on the ground behind tall buildings for occlusion fade
    const occluders: { x0: number; y0: number; x1: number; y1: number; footY: number }[] = [];
    if (preview) {
      if (preview.kind === "tower") {
        const spec = TOWER_SPECS[preview.type];
        occluders.push({
          x0: preview.x - 1,
          y0: preview.y - 1,
          x1: preview.x + spec.w + 1,
          y1: preview.y + spec.h + 1,
          footY: preview.y + spec.h,
        });
      } else if (preview.kind === "strike") {
        const r = Math.min(8, STRIKE_SPECS[preview.strike].radius);
        occluders.push({
          x0: preview.x - r,
          y0: preview.y - r,
          x1: preview.x + r,
          y1: preview.y + r,
          footY: preview.y,
        });
      } else if (preview.kind === "reticle") {
        occluders.push({
          x0: preview.x - 2,
          y0: preview.y - 2,
          x1: preview.x + 2,
          y1: preview.y + 2,
          footY: preview.y + 1,
        });
      } else if (preview.kind === "blueprint") {
        for (let i = 0; i < preview.points.length; i++) {
          const pt = preview.points[i];
          occluders.push({ x0: pt.x - 1, y0: pt.y - 1, x1: pt.x + 2, y1: pt.y + 2, footY: pt.y + 1 });
        }
      }
    }
    for (let i = 0; i < combat.towers.length; i++) {
      const t = combat.towers[i];
      occluders.push({ x0: t.x, y0: t.y - tElev, x1: t.x + t.w, y1: t.y + t.h, footY: t.y + t.h });
    }
    for (let i = 0; i < combat.agents.length; i++) {
      const a = combat.agents[i];
      const ax = Math.floor(a.x);
      const ay = Math.floor(a.y);
      occluders.push({ x0: ax - 1, y0: ay - 1, x1: ax + 2, y1: ay + 2, footY: ay + 1 });
    }

    const rawScene = this.sceneCtx;
    for (let i = 0; i < drawables.length; i++) {
      const item = drawables[i];
      if (item.kind === "building") {
        const sp = item.sprite;
        let occluded = false;
        if (sp.maxElev > 0) {
          const sx0 = sp.x;
          const sy0 = sp.y;
          const sx1 = sp.x + sp.w;
          const sy1 = sp.bottomY;
          for (let j = 0; j < occluders.length; j++) {
            const occ = occluders[j];
            if (
              occ.footY <= sp.bottomY - 1 &&
              occ.x1 > sx0 &&
              occ.x0 < sx1 &&
              occ.y1 > sy0 &&
              occ.y0 < sy1
            ) {
              occluded = true;
              break;
            }
          }
        }

        if (occluded) {
          // Whole-pixel checkerboard dither fade (no alpha blur) so obscured ground stays readable
          for (let k = 0; k < sp.ops.length; k++) {
            const op = sp.ops[k];
            const wx = sp.x + op.dx;
            const wy = sp.y + op.dy;
            if (((wx + wy) & 1) === 0) {
              c.fillStyle = op.color;
              c.fillRect(wx, wy, 1, 1);
            }
          }
        } else if (sp.canvas) {
          rawScene.drawImage(sp.canvas, sp.x, sp.y);
        } else {
          for (let k = 0; k < sp.runs.length; k++) {
            const r = sp.runs[k];
            c.fillStyle = r.color;
            c.fillRect(sp.x + r.dx, sp.y + r.dy, r.w, 1);
          }
        }
      } else if (item.kind === "tower") {
        const t = item.tower;
        const spec = TOWER_SPECS[t.type];
        const topY = t.y - tElev;
        // Armored shadow & south base facade (2 px tall)
        c.fillStyle = "#0d1118";
        c.fillRect(t.x, topY, t.w, t.h + tElev);
        if (tElev > 0) {
          c.fillStyle = "#18202c";
          c.fillRect(t.x, t.y + t.h - tElev, t.w, tElev);
        }
        c.fillStyle = "#242c3a";
        c.fillRect(t.x, topY, t.w, t.h);
        // Corner rivets / mounting brackets
        c.fillStyle = "#5c6b82";
        c.fillRect(t.x, topY, 1, 1);
        c.fillRect(t.x + t.w - 1, topY, 1, 1);
        c.fillRect(t.x, topY + t.h - 1, 1, 1);
        c.fillRect(t.x + t.w - 1, topY + t.h - 1, 1, 1);
        // Primary colored turret housing
        c.fillStyle = spec.color;
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        // Glowing energy core / barrel mount
        c.fillStyle = "#fff3d1";
        c.fillRect(t.x + t.w * 0.5 - 0.45, topY + t.h * 0.5 - 0.45, 0.9, 0.9);

        if (t.uid === selectedTowerUid) {
          c.strokeStyle = "#ffbe3b";
          c.lineWidth = 0.4;
          c.strokeRect(t.x - 0.35, topY - 0.35, t.w + 0.7, t.h + tElev + 0.7);
          c.strokeStyle = "rgba(255, 190, 59, 0.42)";
          c.lineWidth = 0.35;
          c.beginPath();
          c.arc(t.x + t.w * 0.5, t.y + t.h * 0.5, spec.range, 0, Math.PI * 2);
          c.stroke();
        }

        if (t.focus) {
          c.strokeStyle = "rgba(255, 145, 45, 0.65)";
          c.lineWidth = 0.28;
          c.beginPath();
          c.moveTo(t.x + t.w * 0.5, topY + t.h * 0.5);
          c.lineTo(t.focus.x, t.focus.y);
          c.stroke();
          c.strokeRect(t.focus.x - 1.1, t.focus.y - 1.1, 2.2, 2.2);
        }
      } else {
        const a = item.agent;
        const ax = Math.floor(a.x);
        const ay = Math.floor(a.y);
        if (a.kind === "rifleman") {
          c.fillStyle = "#ff7b24";
          c.fillRect(ax, ay, 1, 1);
        } else if (a.kind === "engineer") {
          c.fillStyle = a.carryingMatter > 0 ? "#48e5ff" : "#ffd15c";
          c.fillRect(ax, ay - 1, 1, 1);
          c.fillStyle = "#d9822b";
          c.fillRect(ax, ay, 1, 1);
        } else if (a.kind === "heavyMech") {
          c.fillStyle = "#ff9e30";
          c.fillRect(ax - 1, ay - 1, 2, 2);
          c.fillStyle = "#7afcff";
          c.fillRect(ax, ay - 1, 1, 1);
        } else if (a.kind === "wallSerpent") {
          c.fillStyle = "#0c1420";
          c.fillRect(a.x - 1.1, a.y - 1.1, 2.2, 2.2);
          c.fillStyle = "#48e5ff";
          c.fillRect(a.x - 0.9, a.y - 0.9, 1.8, 1.8);
          c.fillStyle = "#ffd166";
          c.fillRect(a.x - 0.4, a.y - 0.4, 0.8, 0.8);
        }
      }
    }

    lap("towers");

    // 10. Draw cosmic Void organisms with nebula contours
    for (const o of combat.organisms) {
      // Nebula-colored organic contour around organism silhouette
      const contour = computeOrganismContour(o, animTime, this.reduceEffects);
      for (const pt of contour) {
        c.fillStyle = pt.color;
        c.fillRect(pt.x, pt.y, 1, 1);
      }

      if (o.trail) {
        c.fillStyle = "rgba(195, 92, 255, 0.55)";
        for (const pt of o.trail) {
          c.fillRect(pt.x - 0.65, pt.y - 0.65, 1.3, 1.3);
        }
      }
      if (o.kind === "nebulaWorm") {
        c.fillStyle = "#e066ff";
        c.fillRect(o.x - 1.2, o.y - 1.2, 2.4, 2.4);
        c.fillStyle = "#ffffff";
        c.fillRect(o.x - 0.5, o.y - 0.5, 1.0, 1.0);
      } else if (o.kind === "constellationSpider") {
        c.strokeStyle = "#7afcff";
        c.lineWidth = 0.28;
        for (let leg = 0; leg < 6; leg++) {
          const ang = (leg / 6) * Math.PI * 2 + animTime * 2.5;
          c.beginPath();
          c.moveTo(o.x, o.y);
          c.lineTo(o.x + Math.cos(ang) * 2.4, o.y + Math.sin(ang) * 2.4);
          c.stroke();
        }
        c.fillStyle = "#c88aff";
        c.fillRect(o.x - 0.8, o.y - 0.8, 1.6, 1.6);
      } else if (o.kind === "voidBloom") {
        c.fillStyle = "#ff66c4";
        c.fillRect(o.x - 1.3, o.y - 1.3, 2.6, 2.6);
        c.fillStyle = "#6ef3ff";
        c.fillRect(o.x - 0.5, o.y - 0.5, 1.0, 1.0);
      } else if (o.kind === "nebulaQueen") {
        const cx = Math.round(o.x), cy = Math.round(o.y);
        c.fillStyle = "#9d4edd";
        c.fillRect(cx - 2, cy - 2, 4, 4);
        c.fillStyle = "#7afcff";
        c.fillRect(cx - 1, cy - 1, 2, 2);
      } else if (o.kind === "honeycombCrystal") {
        const cx = Math.round(o.x), cy = Math.round(o.y);
        c.fillStyle = "#c77dff";
        c.fillRect(cx - 1, cy - 1, 3, 3);
        c.fillStyle = "#ff9ebb";
        c.fillRect(cx, cy, 1, 1);
      } else if (o.kind === "nexusCrystal") {
        const cx = Math.round(o.x), cy = Math.round(o.y);
        c.strokeStyle = "#48cae4";
        c.lineWidth = 1;
        c.strokeRect(cx - 2, cy - 2, 4, 4);
        c.fillStyle = "#7209b7";
        c.fillRect(cx - 1, cy - 1, 2, 2);
        c.fillStyle = "#90e0ef";
        c.fillRect(cx, cy, 1, 1);
      } else {
        // 1-pixel Void bee
        const cx = Math.round(o.x), cy = Math.round(o.y);
        c.fillStyle = "#e0aaff";
        c.fillRect(cx, cy, 1, 1);
      }
    }

    lap("units");

    // 11. Draw Matter Cannon & Rocket Team parabolic shells with glowing pixel trails
    for (const p of combat.pellets) {
      const arcLift = Math.sin(p.progress * Math.PI) * 3.8;
      const px = p.x + (p.tx - p.x) * p.progress;
      const py = p.y + (p.ty - p.y) * p.progress - arcLift;

      // Parabolic trail ribbon
      for (let step = 1; step <= 5; step++) {
        const tp = Math.max(0, p.progress - step * 0.045);
        const tLift = Math.sin(tp * Math.PI) * 3.8;
        const tx = p.x + (p.tx - p.x) * tp;
        const ty = p.y + (p.ty - p.y) * tp - tLift;
        c.fillStyle = p.wallPayload ? "rgba(72, 229, 255, 0.45)" : "rgba(255, 158, 56, 0.48)";
        const sz = Math.max(0.4, 1.2 - step * 0.16);
        c.fillRect(tx - sz * 0.5, ty - sz * 0.5, sz, sz);
      }

      // Target impact ring preview on ground
      c.strokeStyle = p.wallPayload ? "rgba(72, 229, 255, 0.32)" : "rgba(255, 174, 66, 0.32)";
      c.lineWidth = 0.25;
      c.beginPath();
      c.arc(p.tx, p.ty, p.radius, 0, Math.PI * 2);
      c.stroke();

      // Shell head
      c.fillStyle = p.wallPayload ? "#48e5ff" : "#ff9e38";
      c.fillRect(px - 0.85, py - 0.85, 1.7, 1.7);
      c.fillStyle = "#ffffff";
      c.fillRect(px - 0.4, py - 0.4, 0.8, 0.8);
    }

    // 12. Draw expanding impact & strike shockwaves
    for (const s of physics.shockwaves) {
      const t = s.life / Math.max(0.01, s.maxLife);
      const r = Math.max(0.5, s.maxRadius * t);
      c.strokeStyle = s.color;
      c.lineWidth = Math.max(0.25, (1 - t) * 0.9);
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.stroke();

      if (r > 1.2) {
        c.strokeStyle = s.secondaryColor;
        c.lineWidth = Math.max(0.2, (1 - t) * 0.5);
        c.beginPath();
        c.arc(s.x, s.y, r * 0.72, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // 13. Draw riflemen & mech laser beams with muzzle & impact flashes
    for (const b of combat.lasers) {
      c.strokeStyle = b.color;
      c.lineWidth = 0.55;
      c.beginPath();
      c.moveTo(b.x0, b.y0);
      c.lineTo(b.x1, b.y1);
      c.stroke();

      c.strokeStyle = "#fff3b0";
      c.lineWidth = 0.22;
      c.beginPath();
      c.moveTo(b.x0, b.y0);
      c.lineTo(b.x1, b.y1);
      c.stroke();

      // Impact spark at target
      c.fillStyle = "#ffbe3b";
      c.fillRect(b.x1 - 0.55, b.y1 - 0.55, 1.1, 1.1);
      c.fillStyle = "#ffffff";
      c.fillRect(b.x1 - 0.25, b.y1 - 0.25, 0.5, 0.5);
    }

    lap("shots");

    // 14. Torn-off land drifting into the anomaly: heavy slabs keep their terrain colour
    //     (grass, crops, pavement, lit masonry) with a dark underside and violet rim; small
    //     prismatic sparks streak along curved streamlines
    for (const d of physics.debris) {
      const slab = d.size >= 1.0 && d.maxLife > 1.5;
      if (slab) {
        const sz = d.size * Math.max(0.35, 1 - (d.life / d.maxLife) * 0.6);
        const half = sz * 0.5;
        c.fillStyle = "rgba(150, 50, 230, 0.4)";
        c.fillRect(d.x - half - 0.18, d.y - half - 0.18, sz + 0.36, sz + 0.36);
        c.fillStyle = d.color;
        c.fillRect(d.x - half, d.y - half, sz, sz);
        c.fillStyle = "rgba(0, 0, 0, 0.5)";
        c.fillRect(d.x - half, d.y + half - 0.24, sz, 0.24);
        c.fillRect(d.x + half - 0.24, d.y - half, 0.24, sz);
        if (!this.reduceEffects && ((Math.floor(animTime * 10) + ((d.x * 7) | 0)) & 3) === 0) {
          c.fillStyle = "#ff8df0";
          c.fillRect(d.x - 0.15, d.y - 0.15, 0.3, 0.3);
        }
      } else {
        if (!this.reduceEffects) {
          c.strokeStyle = d.glowColor;
          c.lineWidth = d.size * 0.95;
          c.beginPath();
          c.moveTo(d.px, d.py);
          c.lineTo(d.x, d.y);
          c.stroke();
        }
        c.fillStyle = d.color;
        c.fillRect(d.x - d.size * 0.5, d.y - d.size * 0.5, d.size, d.size);
      }
    }

    lap("debris");

    // 15. Draw interactive drag preview (tower footprint, strike radius, reticle, or wall blueprint)
    if (preview) {
      if (preview.kind === "tower") {
        const spec = TOWER_SPECS[preview.type];
        c.fillStyle = preview.valid ? "rgba(255, 174, 56, 0.48)" : "rgba(255, 68, 68, 0.48)";
        c.fillRect(preview.x, preview.y, spec.w, spec.h);
        c.strokeStyle = preview.valid ? "#ffbe3b" : "#ff4444";
        c.lineWidth = 0.35;
        c.strokeRect(preview.x, preview.y, spec.w, spec.h);
        c.beginPath();
        c.arc(
          preview.x + spec.w * 0.5,
          preview.y + spec.h * 0.5,
          spec.range,
          0,
          Math.PI * 2,
        );
        c.stroke();
      } else if (preview.kind === "strike") {
        const spec = STRIKE_SPECS[preview.strike];
        c.fillStyle = preview.valid ? "rgba(72, 229, 255, 0.26)" : "rgba(255, 68, 68, 0.28)";
        c.strokeStyle = preview.valid ? "#48e5ff" : "#ff4444";
        c.lineWidth = 0.45;
        c.beginPath();
        c.arc(preview.x, preview.y, spec.radius, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      } else if (preview.kind === "reticle") {
        c.strokeStyle = "#ff9933";
        c.lineWidth = 0.38;
        c.strokeRect(preview.x - 1.5, preview.y - 1.5, 3, 3);
      } else if (preview.kind === "blueprint" && preview.points.length > 0) {
        c.strokeStyle = "#ffbe3b";
        c.lineWidth = 0.55;
        c.beginPath();
        c.moveTo(preview.points[0].x, preview.points[0].y);
        for (let i = 1; i < preview.points.length; i++) {
          c.lineTo(preview.points[i].x, preview.points[i].y);
        }
        c.stroke();
      }
    }

    // Magnify the same world-pixel raster; camera zoom reveals no sub-cell detail.
    const output = this.ctx;
    output.setTransform(1, 0, 0, 1, 0, 0);
    output.drawImage(this.backdropFor(this.canvas.width, this.canvas.height, world.seed), 0, 0);
    const scale = this.pixelScale();
    output.imageSmoothingEnabled = false;
    output.setTransform(scale, 0, 0, scale, this.cam.x, this.cam.y);
    output.drawImage(this.sceneLayer, 0, 0);
    output.setTransform(1, 0, 0, 1, 0, 0);

    // 16. Touch/drag magnifying glass (`Loupe`)
    if (showMagnifier && pointerForLoupe) {
      const pt = { x: pointerForLoupe.clientX, y: pointerForLoupe.clientY };
      this.loupe.show(pt, pt);
      this.loupe.draw(this.canvas);
    } else {
      this.loupe.hide();
    }
  }
}
