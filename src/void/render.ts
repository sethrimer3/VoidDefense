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

import { farmSoilColor, isWheat, wheatLean } from "./farms.ts";
import { dist } from "../exact.ts";
import {
  ARCH_PALETTES,
  type ArchPalette,
  type BuildingHeightMode,
  BuildingSpriteCache,
  type CachedBuildingSprite,
  cellTierElevation,
  elevationOf,
  MAX_ELEVATION_PX,
  TOWER_ELEVATION_PX,
} from "./elevation.ts";
import { collectSceneLights, LightingEngine } from "./lighting.ts";
import { isOccludedByLedge, paintVoidLedge } from "./ledge.ts";
import { valueNoise } from "./portal-noise.ts";
import { computeOrganismContour, computeNodeContour, paintOrganismContour, paintNodeContour } from "./contour.ts";
import {
  generateWispsForPortals,
  computeVoidInterior,
  paintVoidInterior,
  paintVoidInteriorDirect,
  paintVoidRipples,
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
  type Civilian,
  type FallingChunk,
  LandCover,
  type MetroBuilding,
  type PlacedTower,
  type StrikeId,
  type TowerTypeId,
  type VoidPortal,
} from "./model.ts";
import {
  computeDebrisGlowAlpha,
  computeDebrisHeat,
  FALL_GRAVITY_PX,
  moltenColorAtHeat,
  moltenGlowColorAtHeat,
  VOID_ABYSS_Z,
} from "./physics.ts";
import type { VoidSim } from "./sim.ts";
import { STRIKE_SPECS, TOWER_SPECS } from "./towers.ts";
import type { VoidWorld } from "./world.ts";

/** Side of the local window a chunk's distance-to-Void transform runs on (chunk plus margin). */
const DIST_WINDOW = CHUNK_SIZE + CORRUPTION_REACH * 2;
/** Padded stride (1-cell CHAMFER_INF border on all sides so inner loops need no bounds checks). */
const DIST_STRIDE = DIST_WINDOW + 2;
/** Chamfer 3-4 distance: orthogonal step 3, diagonal step 4, so `value / 3` approximates cells. */
const CHAMFER_INF = 0x7fff;

/** Quantized violet stain for the corruption band, indexed by chamfer distance (0..3*REACH). */
const CORRUPTION_ALPHAS: readonly number[] = (() => {
  const out: number[] = [];
  for (let k = 0; k <= CORRUPTION_REACH * 3 + 2; k++) {
    const dv = k / 3;
    const t = Math.pow(Math.max(0, 1 - dv / (CORRUPTION_REACH + 0.6)), 1.5);
    out.push(Math.round(0.7 * t * 256));
  }
  return out;
})();

/** Quantized frontier corona tints (32 steps from alpha 0.10 to 0.38). */
const FRONTIER_TINTS: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) {
    out.push(`rgba(178, 62, 232, ${(0.1 + 0.28 * (i / 31)).toFixed(3)})`);
  }
  return out;
})();

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
const hexAbgrCache = new Map<string, number>();

function packAbgr(r: number, g: number, b: number): number {
  return IS_LITTLE_ENDIAN
    ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}

function hexToAbgr(hex: string): number {
  let v = hexAbgrCache.get(hex);
  if (v !== undefined) return v;
  const r = parseInt(hex.slice(1, 3), 16) & 0xff;
  const g = parseInt(hex.slice(3, 5), 16) & 0xff;
  const b = parseInt(hex.slice(5, 7), 16) & 0xff;
  v = packAbgr(r, g, b);
  hexAbgrCache.set(hex, v);
  return v;
}

function blendAbgr(dst: number, or: number, og: number, ob: number, alpha256: number): number {
  if (alpha256 <= 0) return dst;
  const inv = 256 - alpha256;
  if (IS_LITTLE_ENDIAN) {
    const r = ((dst & 0xff) * inv + or * alpha256) >> 8;
    const g = (((dst >>> 8) & 0xff) * inv + og * alpha256) >> 8;
    const b = (((dst >>> 16) & 0xff) * inv + ob * alpha256) >> 8;
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  const r = (((dst >>> 24) & 0xff) * inv + or * alpha256) >> 8;
  const g = (((dst >>> 16) & 0xff) * inv + og * alpha256) >> 8;
  const b = (((dst >>> 8) & 0xff) * inv + ob * alpha256) >> 8;
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}

const RIM_ABGR_INNER = packAbgr(0x4b, 0x21, 0x70);
const RIM_ABGR_OUTER = packAbgr(0x34, 0x18, 0x4f);

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
  private readonly ledgeLayer: HTMLCanvasElement;
  private readonly ledgeCtx: CanvasRenderingContext2D;
  private ledgeDirty = true;
  private lastFrontierLen = -1;
  private terrainImageData: ImageData | null = null;
  private terrainU32 = new Uint32Array(0);
  private shadowMap = new Uint8Array(0);
  private prevBuildingAt = new Int32Array(0);
  private prevColumnFloors = new Uint8Array(0);
  private buildingElevs = new Uint8Array(0);
  private livestockWorld: VoidWorld | null = null;
  private livestockList: { x: number; y: number; idx: number; isCow: boolean }[] = [];
  private wheatWorld: VoidWorld | null = null;
  private evenWheatCells: number[] = [];
  private walkerBuckets: { x: number; y: number }[][] = [];
  private walkerBucketW = 0;
  private readonly dirtyWalkerBuckets: number[] = [];
  private readonly nearbyWalkers: { x: number; y: number }[] = [];
  private farmScorch: Uint8Array = new Uint8Array(0);
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
  private readonly distWindow = new Int16Array(DIST_STRIDE * DIST_STRIDE).fill(CHAMFER_INF);
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
  /** Tiled 2.5D bump-mapped surface lighting, dynamic building shadow casting, and bloom engine. */
  readonly lighting = new LightingEngine();
  private lastDirtyChunks = new Uint8Array(0);
  private placementPulses: { x: number; y: number; ageMs: number }[] = [];
  private incomePopups: { x: number; y: number; text: string; ageMs: number }[] = [];
  private outcomeFlashMs = 0;
  private outcomeFlashWon = true;

  triggerPlacementPulse(wx: number, wy: number): void {
    if (this.reduceEffects) return;
    if (this.placementPulses.length >= 12) this.placementPulses.shift();
    this.placementPulses.push({ x: wx, y: wy, ageMs: 0 });
  }

  triggerIncomePopup(wx: number, wy: number, amount: number): void {
    if (this.reduceEffects || amount <= 0) return;
    if (this.incomePopups.length >= 8) this.incomePopups.shift();
    this.incomePopups.push({ x: wx, y: wy, text: `+${amount}`, ageMs: 0 });
  }

  triggerOutcomeFlash(won: boolean): void {
    if (this.reduceEffects) return;
    this.outcomeFlashMs = 280;
    this.outcomeFlashWon = won;
  }

  // Tron light cycle trails along streets connecting buildings
  private corridors: TronCorridor[] = [];
  private cycles: TronCycle[] = [];
  private corridorsWorld: VoidWorld | null = null;
  private lastTimeMs = 0;

  // Cached seeded spiral wisps for living Void interior
  private interiorWisps: SeededWisp[] = [];
  private wispsWorld: VoidWorld | null = null;

  /** Pre-allocated pool of 60 cosmetic street civilians who flee encroaching Void and fall if their street becomes Void. */
  readonly civilians: Civilian[] = Array.from({ length: 60 }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    color: "#ffe49e",
    falling: false,
  }));
  private civiliansWorld: VoidWorld | null = null;
  private civilianSpawnSlot = 0;
  private lastSeenCollapseTick = 0;
  private shakeMs = 0;
  private shakeCooldownUntil = 0;

  /** Camera state: `s` = zoom multiplier (1 = fit board), `x, y` = canvas pixel pan. */
  readonly cam = { s: 1, x: 0, y: 0 };
  px = 4; // device pixels per cell at zoom 1
  static readonly MAX_ZOOM = 7;
  /** Camera zoom at or above which a large building collapse may shake the view. */
  static readonly SHAKE_MIN_ZOOM = 2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sceneLayer = document.createElement("canvas");
    this.sceneCtx = this.sceneLayer.getContext("2d", { alpha: false })!;
    this.pixelCtx = pixelPainter(this.sceneCtx);
    this.terrainLayer = document.createElement("canvas");
    this.tctx = this.terrainLayer.getContext("2d", { alpha: false })!;
    this.ledgeLayer = document.createElement("canvas");
    this.ledgeCtx = this.ledgeLayer.getContext("2d")!;
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

  /** True when world pixel (`fx`, `fy`) is inside the visible canvas. */
  private isWorldPointOnScreen(fx: number, fy: number): boolean {
    const scale = this.pixelScale();
    const x = fx * scale + this.cam.x;
    const y = fy * scale + this.cam.y;
    return x >= 0 && y >= 0 && x <= this.canvas.width && y <= this.canvas.height;
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

  /** Steps cosmetic street civilians near the active Void frontier and draws a whole-pixel
   * falling chunk (shrinking `6 -> 4 -> 2 -> 1` px and darkening as `z < 0` sinks into the abyss). */
  private stepCivilians(world: VoidWorld, frontierCells: readonly number[], dt: number): void {
    if (this.civiliansWorld !== world) {
      this.civiliansWorld = world;
      this.civilianSpawnSlot = 0;
      for (let i = 0; i < this.civilians.length; i++) {
        this.civilians[i].active = false;
      }
    }
    if (this.reduceEffects) return;

    const { w, h } = world.grid;
    const { material } = world;
    const civColors = ["#ffe49e", "#7afcff", "#ffd166", "#f4f6ff"];

    // Spawn up to 2 fleeing civilians per frame on streets near the Void frontier when slots are free
    if (frontierCells.length > 0) {
      let spawned = 0;
      for (let i = 0; i < this.civilians.length && spawned < 2; i++) {
        const civ = this.civilians[i];
        if (civ.active) continue;
        this.civilianSpawnSlot++;
        const fIdx =
          frontierCells[hash(world.seed, 981, this.civilianSpawnSlot, i) % frontierCells.length];
        const fx = fIdx % w;
        const fy = (fIdx / w) | 0;
        const ox = (hash(world.seed, 982, this.civilianSpawnSlot, i) % 9) - 4;
        const oy = (hash(world.seed, 983, this.civilianSpawnSlot, i) % 9) - 4;
        const sx = fx + ox;
        const sy = fy + oy;
        if (sx < 1 || sx >= w - 1 || sy < 1 || sy >= h - 1) continue;
        if (material[sy * w + sx] !== CellMaterial.STREET) continue;

        // Flee away from the nearest portal or Void neighbor
        const np = this.nearestPortal(world, sx, sy);
        const ang = np.p ? Math.atan2(sy - np.p.y, sx - np.p.x) : 0;
        const spd = 4.2 + hash01(world.seed, 984, this.civilianSpawnSlot, i) * 3.0;
        civ.active = true;
        civ.x = sx + 0.5;
        civ.y = sy + 0.5;
        civ.z = 0;
        civ.vx = Math.cos(ang) * spd;
        civ.vy = Math.sin(ang) * spd;
        civ.vz = 0;
        civ.color = civColors[i % civColors.length];
        civ.falling = false;
        spawned++;
      }
    }

    for (let i = 0; i < this.civilians.length; i++) {
      const civ = this.civilians[i];
      if (!civ.active) continue;
      const gx = Math.floor(civ.x);
      const gy = Math.floor(civ.y);
      if (gx < 0 || gx >= w || gy < 0 || gy >= h) {
        civ.active = false;
        continue;
      }
      const mat = material[gy * w + gx];
      if (!civ.falling) {
        if (mat === CellMaterial.VOID) {
          civ.falling = true;
          civ.vz = 0;
        } else {
          const nx = civ.x + civ.vx * dt;
          const ny = civ.y + civ.vy * dt;
          const ngx = Math.floor(nx);
          const ngy = Math.floor(ny);
          if (ngx >= 0 && ngx < w && ngy >= 0 && ngy < h) {
            const nMat = material[ngy * w + ngx];
            if (nMat === CellMaterial.STREET || nMat === CellMaterial.PARK || nMat === CellMaterial.VOID) {
              civ.x = nx;
              civ.y = ny;
            } else {
              civ.vx = -civ.vx;
              civ.vy = -civ.vy;
            }
          } else {
            civ.active = false;
          }
        }
      }
      if (civ.falling) {
        civ.vz -= FALL_GRAVITY_PX * dt;
        civ.x += civ.vx * 0.35 * dt;
        civ.y += civ.vy * 0.35 * dt;
        civ.z += civ.vz * dt;
        if (civ.z < VOID_ABYSS_Z) {
          civ.active = false;
        }
      }
    }
  }

  /** Draws a single 3D falling chunk at `(round(x), round(y - z))` with whole-pixel LOD shrinking
   * (`6 -> 4 -> 2 -> 1` px) and Void darkening when `z < 0`. When `underVoid` is true, clips pixels
   * hidden behind the subterranean ledge front face (`src/void/ledge.ts`). */
  private paintFallingChunk(
    c: CanvasRenderingContext2D,
    world: VoidWorld,
    ch: FallingChunk,
    underVoid: boolean,
  ): void {
    const px = Math.round(ch.x);
    const py = Math.round(ch.y - ch.z);
    const { w, h } = world.grid;
    if (px < 0 || px >= w || py < 0 || py >= h) return;

    // Whole-pixel size reduction and molten heating as chunk plunges below ground level into the Void abyss
    let cw = ch.w;
    let chH = ch.h;
    let fill = ch.color;
    let edge = ch.edgeColor;
    if (ch.z < 0) {
      const depth = -ch.z;
      const heatRaw = Math.min(1, Math.max(0, (depth - 2) / 18));
      const heat = heatRaw * heatRaw * (3 - 2 * heatRaw);
      fill = moltenColorAtHeat(ch.color, heat);
      edge = heat > 0.05 ? moltenColorAtHeat(ch.edgeColor, Math.min(1, heat + 0.18)) : ch.edgeColor;
      if (depth > 16) {
        cw = 1;
        chH = 1;
      } else if (depth > 9) {
        cw = Math.max(1, Math.min(2, cw));
        chH = Math.max(1, Math.min(2, chH));
      } else if (depth > 3) {
        cw = Math.max(1, Math.min(4, cw));
        chH = Math.max(1, Math.min(4, chH));
      }
    }

    for (let dy = 0; dy < chH; dy++) {
      const sy = py + dy;
      if (sy < 0 || sy >= h) continue;
      for (let dx = 0; dx < cw; dx++) {
        const sx = px + dx;
        if (sx < 0 || sx >= w) continue;
        if (underVoid) {
          // Beneath-ground chunks only render inside Void space and behind northern ledge front faces
          if (world.material[sy * w + sx] !== CellMaterial.VOID) continue;
          if (isOccludedByLedge(world, sx, sy)) continue;
        }
        const isRim = (cw > 1 || chH > 1) && (dx === 0 || dy === 0);
        c.fillStyle = isRim ? edge : fill;
        c.fillRect(sx, sy, 1, 1);
      }
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
      this.terrainLayer.height !== targetH ||
      !this.terrainImageData
    ) {
      this.renderedWorld = world;
      this.renderedHeightMode = this.buildingHeight;
      this.paintedPixels = new Float64Array(world.grid.count).fill(-1);
      this.paintedNeighbors = new Float64Array(world.grid.count).fill(-1);
      this.terrainLayer.width = targetW;
      this.terrainLayer.height = targetH;
      this.terrainImageData = this.tctx.createImageData(targetW, targetH);
      this.terrainU32 = new Uint32Array(this.terrainImageData.data.buffer);
      this.initShadowCache(world);
      this.ledgeDirty = true;
      world.grid.markAllDirty();
    }

    if (!world.grid.hasDirtyChunks()) {
      this.lastDirtyChunks.fill(0);
      return;
    }

    // Incrementally update shadowMap when building footprints or columnFloors change in dirty chunks
    const { buildingAt, columnFloors } = world;
    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        if (!dirtyChunks[cy * chunksW + cx]) continue;
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const x1 = Math.min(targetW, x0 + CHUNK_SIZE);
        const y1 = Math.min(targetH, y0 + CHUNK_SIZE);
        for (let y = y0; y < y1; y++) {
          const row = y * targetW;
          for (let x = x0; x < x1; x++) {
            const idx = row + x;
            const cur = buildingAt[idx];
            const curFloors = columnFloors ? columnFloors[idx] : 0;
            if (cur !== this.prevBuildingAt[idx] || curFloors !== this.prevColumnFloors[idx]) {
              this.prevBuildingAt[idx] = cur;
              this.prevColumnFloors[idx] = curFloors;
              this.refreshShadowAround(world, x, y, dirtyChunks, chunksW);
            }
          }
        }
      }
    }

    if (this.lastDirtyChunks.length !== dirtyChunks.length) {
      this.lastDirtyChunks = new Uint8Array(dirtyChunks.length);
    }
    this.lastDirtyChunks.set(dirtyChunks);
    this.lighting.syncChunks(world, this.buildingHeight, this.lastDirtyChunks);

    let minX = targetW;
    let minY = targetH;
    let maxX = 0;
    let maxY = 0;

    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        const chunkIdx = cy * chunksW + cx;
        if (!dirtyChunks[chunkIdx]) continue;
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const x1 = Math.min(targetW, x0 + CHUNK_SIZE);
        const y1 = Math.min(targetH, y0 + CHUNK_SIZE);
        if (this.paintChunk(world, x0, y0, x1, y1)) {
          if (x0 < minX) minX = x0;
          if (y0 < minY) minY = y0;
          if (x1 > maxX) maxX = x1;
          if (y1 > maxY) maxY = y1;
        }
      }
    }

    if (maxX > minX && maxY > minY) {
      this.tctx.putImageData(this.terrainImageData, 0, 0, minX, minY, maxX - minX, maxY - minY);
      this.ledgeDirty = true;
    }

    world.grid.clearDirtyFlags();
  }

  private initShadowCache(world: VoidWorld): void {
    const { w, h, count } = world.grid;
    const mode = this.buildingHeight === "flat" ? "full" : this.buildingHeight;
    this.buildingElevs = new Uint8Array(world.buildings.length);
    for (let i = 0; i < world.buildings.length; i++) {
      this.buildingElevs[i] = elevationOf(world.buildings[i], mode);
    }
    this.shadowMap = new Uint8Array(count);
    this.prevBuildingAt = new Int32Array(world.buildingAt);
    this.prevColumnFloors = world.columnFloors
      ? new Uint8Array(world.columnFloors)
      : new Uint8Array(count);
    const { buildingAt, buildings, material } = world;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        if (material[idx] === CellMaterial.VOID) continue;
        const bId = buildingAt[idx];
        const selfHeight = bId >= 0 ? (buildings[bId]?.height ?? 0) : 0;
        const selfElev = bId >= 0 ? (this.buildingElevs[bId] ?? 0) : 0;
        this.shadowMap[idx] = Math.round(this.computeShadowAt(world, x, y, selfHeight, selfElev) * 100);
      }
    }
  }

  private refreshShadowAround(
    world: VoidWorld,
    x: number,
    y: number,
    dirtyChunks: Uint8Array,
    chunksW: number,
  ): void {
    const { w, h } = world.grid;
    const { buildingAt, buildings } = world;
    const updateAt = (tx: number, ty: number): void => {
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) return;
      const idx = ty * w + tx;
      const bId = buildingAt[idx];
      const selfHeight = bId >= 0 ? (buildings[bId]?.height ?? 0) : 0;
      const selfElev = bId >= 0 ? (this.buildingElevs[bId] ?? 0) : 0;
      const next = Math.round(this.computeShadowAt(world, tx, ty, selfHeight, selfElev) * 100);
      if (this.shadowMap[idx] !== next) {
        this.shadowMap[idx] = next;
        dirtyChunks[((ty / CHUNK_SIZE) | 0) * chunksW + ((tx / CHUNK_SIZE) | 0)] = 1;
      }
    };
    updateAt(x, y);
    updateAt(x + 1, y);
    updateAt(x, y + 1);
    for (let step = 1; step <= 10; step++) {
      updateAt(x + step, y + step);
      if (step >= 2) {
        updateAt(x + step, y + step - 1);
        updateAt(x + step - 1, y + step);
      }
    }
  }

  /** Computes elevation-based directional 2.5D volume shadow darkness (0..0.68) cast onto `(x, y)`
   * toward the SE (umbra along `(-step, -step)` + soft penumbra flanks), respecting surviving `columnFloors`. */
  private computeShadowAt(
    world: VoidWorld,
    x: number,
    y: number,
    selfHeight: number,
    selfElevOverride?: number,
  ): number {
    const { w, h } = world.grid;
    const mode = this.buildingHeight === "flat" ? "full" : this.buildingHeight;
    const selfElev = selfElevOverride !== undefined
      ? selfElevOverride
      : (selfHeight > 0 ? elevationOf({ height: selfHeight }, mode) : 0);
    const { buildingAt, buildings, columnFloors } = world;
    let maxShade = 0;

    const sampleCasterElev = (cx: number, cy: number): number => {
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) return 0;
      const cIdx = cy * w + cx;
      const bId = buildingAt[cIdx];
      if (bId < 0) return 0;
      const b = buildings[bId];
      if (!b) return 0;
      const floors = columnFloors ? columnFloors[cIdx] : b.height;
      if (floors <= 0) return 0;
      const fullElev = elevationOf({ height: floors, archStyle: b.archStyle }, mode);
      return cellTierElevation(b, cx, cy, fullElev);
    };

    for (let step = 1; step <= 10; step++) {
      const nx = x - step;
      const ny = y - step;
      const bElev = sampleCasterElev(nx, ny);
      if (bElev > selfElev) {
        const deltaE = bElev - selfElev;
        const reach = Math.ceil(deltaE * 0.65);
        if (step <= reach) {
          maxShade = Math.max(maxShade, 0.64 - (step - 1) * (0.42 / Math.max(1, reach)));
        }
      }
      if (step >= 2) {
        const pElev1 = sampleCasterElev(nx, ny + 1);
        if (pElev1 > selfElev) {
          const deltaE = pElev1 - selfElev;
          const reach = Math.ceil(deltaE * 0.6);
          if (step <= reach) {
            maxShade = Math.max(maxShade, 0.36 - (step - 1) * (0.24 / Math.max(1, reach)));
          }
        }
        const pElev2 = sampleCasterElev(nx + 1, ny);
        if (pElev2 > selfElev) {
          const deltaE = pElev2 - selfElev;
          const reach = Math.ceil(deltaE * 0.6);
          if (step <= reach) {
            maxShade = Math.max(maxShade, 0.36 - (step - 1) * (0.24 / Math.max(1, reach)));
          }
        }
      }
      if (step === 1) {
        if (x > 0) {
          const wbId = buildingAt[y * w + (x - 1)];
          if (wbId >= 0 && (buildings[wbId]?.height ?? 0) > selfHeight + 2) {
            maxShade = Math.max(maxShade, 0.42);
          }
        }
        if (y > 0) {
          const nbId = buildingAt[(y - 1) * w + x];
          if (nbId >= 0 && (buildings[nbId]?.height ?? 0) > selfHeight + 2) {
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

  private paintChunk(world: VoidWorld, x0: number, y0: number, x1: number, y1: number): boolean {
    const { w, h } = world.grid;
    const { material, landCover, buildingAt, streetTier, hp: hpArr, maxHp: maxHpArr, isBaselineCell, buildings } = world;

    // Distance to the nearest Void cell for every cell of the chunk (plus margin), as a
    // two-pass chamfer transform over a small local window. Skipped when no Void is near.
    const nearVoid = this.buildDistanceWindow(world, x0, y0);
    let changed = false;

    for (let y = y0; y < y1; y++) {
      const row = y * w;
      const distRow = (y - this.distOy + 1) * DIST_STRIDE - this.distOx + 1;
      for (let x = x0; x < x1; x++) {
        const idx = row + x;
        const mat = material[idx];
        const bId = buildingAt[idx];
        const b = bId >= 0 ? buildings[bId] : undefined;
        const hp = maxHpArr[idx] > 0 ? hpArr[idx] / maxHpArr[idx] : 1;
        const damage = hp <= 0.3 ? 3 : hp < 0.4 ? 2 : hp < 0.75 ? 1 : 0;
        const shadow = mat !== CellMaterial.VOID ? this.shadowMap[idx] : 0;
        const shadowRaw = shadow * 0.01;
        const distance = nearVoid
          ? Math.min(127, this.distWindow[distRow + x]) : 127;
        const edges = nearVoid
          ? (x > 0 && material[idx - 1] === CellMaterial.VOID ? 1 : 0)
            + (x + 1 < w && material[idx + 1] === CellMaterial.VOID ? 2 : 0)
            + (y > 0 && material[idx - w] === CellMaterial.VOID ? 4 : 0)
            + (y + 1 < h && material[idx + w] === CellMaterial.VOID ? 8 : 0)
          : 0;
        // Exact integer packing below 2^53: all inputs used by static cell painting.
        const signature = mat + landCover[idx] * 16 + damage * 256
          + (b && b.development > 1.05 ? 1024 : 0) + shadow * 2048
          + distance * 262144 + edges * 33554432
          + isBaselineCell[idx] * 536870912 + (bId + 1) * 1073741824;
        // Bridges, grass verges and building bevels also depend on adjacent surfaces.
        let neighbors = streetTier[idx];
        let factor = 16;
        let sameBuilding = 0;
        const n0 = x > 0 ? idx - 1 : -1;
        const n1 = x + 1 < w ? idx + 1 : -1;
        const n2 = y > 0 ? idx - w : -1;
        const n3 = y + 1 < h ? idx + w : -1;
        neighbors += (n0 < 0 ? 255 : material[n0] + landCover[n0] * 16) * factor;
        if (n0 >= 0 && buildingAt[n0] === bId) sameBuilding += 1;
        factor *= 256;
        neighbors += (n1 < 0 ? 255 : material[n1] + landCover[n1] * 16) * factor;
        if (n1 >= 0 && buildingAt[n1] === bId) sameBuilding += 2;
        factor *= 256;
        neighbors += (n2 < 0 ? 255 : material[n2] + landCover[n2] * 16) * factor;
        if (n2 >= 0 && buildingAt[n2] === bId) sameBuilding += 4;
        factor *= 256;
        neighbors += (n3 < 0 ? 255 : material[n3] + landCover[n3] * 16) * factor;
        if (n3 >= 0 && buildingAt[n3] === bId) sameBuilding += 8;
        factor *= 256;
        neighbors += sameBuilding * factor;
        if (this.paintedPixels[idx] === signature && this.paintedNeighbors[idx] === neighbors) continue;
        this.paintCell(world, x, y, nearVoid, shadowRaw);
        this.paintedPixels[idx] = signature;
        this.paintedNeighbors[idx] = neighbors;
        changed = true;
      }
    }
    return changed;
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
    const S = DIST_STRIDE;
    let any = false;
    if (ox >= 0 && oy >= 0 && ox + N <= w && oy + N <= h) {
      for (let ly = 0; ly < N; ly++) {
        const row = (oy + ly) * w + ox;
        const dRow = (ly + 1) * S + 1;
        for (let lx = 0; lx < N; lx++) {
          if (mat[row + lx] === CellMaterial.VOID) {
            D[dRow + lx] = 0;
            any = true;
          } else {
            D[dRow + lx] = CHAMFER_INF;
          }
        }
      }
    } else {
      for (let ly = 0; ly < N; ly++) {
        const y = oy + ly;
        const inY = y >= 0 && y < h;
        const row = y * w;
        const dRow = (ly + 1) * S + 1;
        for (let lx = 0; lx < N; lx++) {
          const x = ox + lx;
          if (inY && x >= 0 && x < w && mat[row + x] === CellMaterial.VOID) {
            D[dRow + lx] = 0;
            any = true;
          } else {
            D[dRow + lx] = CHAMFER_INF;
          }
        }
      }
    }
    if (!any) return false;
    // Forward pass (1-cell CHAMFER_INF border means zero bounds checks; only rows up to CORRUPTION_REACH + CHUNK_SIZE can reach chunk)
    const fwdMaxY = CORRUPTION_REACH + CHUNK_SIZE;
    for (let ly = 1; ly <= fwdMaxY; ly++) {
      const row = ly * S;
      for (let lx = 1; lx <= N; lx++) {
        const i = row + lx;
        let v = D[i];
        if (v === 0) continue;
        const t1 = D[i - 1] + 3;
        const t2 = D[i - S] + 3;
        const t3 = D[i - S - 1] + 4;
        const t4 = D[i - S + 1] + 4;
        if (t1 < v) v = t1;
        if (t2 < v) v = t2;
        if (t3 < v) v = t3;
        if (t4 < v) v = t4;
        D[i] = v;
      }
    }
    // Backward pass (only rows down to CORRUPTION_REACH + 1 can propagate NW/NE into chunk)
    for (let ly = N; ly >= CORRUPTION_REACH + 1; ly--) {
      const row = ly * S;
      for (let lx = N; lx >= 1; lx--) {
        const i = row + lx;
        let v = D[i];
        if (v === 0) continue;
        const t1 = D[i + 1] + 3;
        const t2 = D[i + S] + 3;
        const t3 = D[i + S + 1] + 4;
        const t4 = D[i + S - 1] + 4;
        if (t1 < v) v = t1;
        if (t2 < v) v = t2;
        if (t3 < v) v = t3;
        if (t4 < v) v = t4;
        D[i] = v;
      }
    }
    return true;
  }

  /** Native world-pixel art: every detail selects a whole simulation cell. */
  private paintCell(world: VoidWorld, x: number, y: number, nearVoid: boolean, shade: number): void {
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
      else if (np.d < core + 1) color = "#5e2194";
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
      this.terrainU32[idx] = hexToAbgr(color);
      return;
    } else if (mat === CellMaterial.UNCLAIMED) {
      color = cover === LandCover.RIVER ? (r < 0.2 ? "#4a9bd1" : "#2b6ca3") : "#11293d";
    } else if (mat === CellMaterial.WALL || mat === CellMaterial.BARRIER) {
      color = mat === CellMaterial.BARRIER ? "#48c9e0" : (x + y) % 4 === 0 ? "#788ca8" : "#5a6b82";
    } else if (mat === CellMaterial.RECLAIMED) {
      color = r < 0.3 ? "#9e7e4e" : "#7d623c";
    } else if (mat === CellMaterial.SALVAGE) {
      color = r < 0.18 ? "#995c38" : r < 0.55 ? "#5e4334" : "#3d353a";
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
      if (hp < 0.4) color = r < 0.2 ? "#7a2fb8" : "#221a24";
      else if (hp < 0.75 && r < 0.22) color = "#4a3b30";
    } else if (mat === CellMaterial.STREET) {
      if (hp < 0.85 && (x + y) % 2 === 0) {
        color = "#252b38";
      } else if (world.streetTier[idx] === 8) {
        color = cover === LandCover.BRIDGE
          ? (x + y) % 3 === 0 ? "#523b28" : "#876948"
          : valueNoise(x * 0.25, y * 0.25) > 0.55 ? "#a38152" : "#8c6d45";
      } else {
        color = world.streetTier[idx] === 4 ? "#171c26" : "#131720";
      }
    } else if (mat === CellMaterial.PARK) {
      const patch = valueNoise(x * 0.14 + (world.seed & 255), y * 0.14);
      switch (cover) {
        case LandCover.NONE:
          color = patch > 0.55 ? "#294a33" : "#223d2b";
          break;
        case LandCover.FOREST: {
          const canopy = valueNoise(x * 0.38 + (world.seed & 127), y * 0.38);
          color = canopy > 0.64 ? "#3a6e3b" : canopy > 0.36 ? "#29542e" : "#1c3d22";
          break;
        }
        case LandCover.FIELD_H: color = y % 3 === 0 ? "#695238" : "#c99b3c"; break;
        case LandCover.FIELD_V: color = x % 3 === 0 ? "#695238" : "#a8b347"; break;
        case LandCover.ORCHARD: {
          const gx = Math.floor(x / 4);
          const gy = Math.floor(y / 4);
          const jx = ((gx * 73 + gy * 37 + world.seed) & 1);
          const jy = ((gx * 29 + gy * 83 + world.seed) & 1);
          const cx = gx * 4 + 1 + jx;
          const cy = gy * 4 + 1 + jy;
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 1.3) {
            const fleck = ((x * 31 + y * 17 + world.seed) & 15);
            if (fleck === 0) color = "#d97a3e";
            else if (fleck === 1) color = "#e6ad4c";
            else color = dx + dy <= 0 ? "#4a8c42" : "#346e38";
          } else if (d2 <= 2.6) {
            color = dx + dy <= 0 ? "#38733b" : "#26522b";
          } else {
            color = patch > 0.55 ? "#466e30" : "#3b5e28";
          }
          break;
        }
        case LandCover.SILO: {
          const leftSilo = x > 0 && world.landCover[idx - 1] === LandCover.SILO;
          const rightSilo = x + 1 < w && world.landCover[idx + 1] === LandCover.SILO;
          color = !leftSilo ? "#cfd8e3" : !rightSilo ? "#55606d" : "#8b96a6";
          break;
        }
        default:
          color = patch > 0.65 ? "#507d39" : patch > 0.35 ? "#467032" : "#3d632b";
      }
    }
    if (isWheat(cover) && bId < 0) color = farmSoilColor(x, y, cover, this.farmScorch[idx]);
    let abgr = hexToAbgr(color);
    if (shade > 0) {
      abgr = blendAbgr(abgr, 2, 3, 5, Math.round(shade * 0.75 * 256));
    }
    if (nearVoid) {
      const distance = this.distWindow[(y - this.distOy + 1) * DIST_STRIDE + x - this.distOx + 1];
      if (distance <= 3) {
        abgr = distance <= 1 ? RIM_ABGR_INNER : RIM_ABGR_OUTER;
      } else if (distance <= CORRUPTION_REACH * 3 && mat !== CellMaterial.WALL && mat !== CellMaterial.BARRIER) {
        abgr = blendAbgr(abgr, 58, 8, 96, CORRUPTION_ALPHAS[distance]);
      }
    }
    this.terrainU32[idx] = abgr;
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
    this.farmScorch = sim.farms.scorch;
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
    const rawScene = this.sceneCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;

    // 1. Draw cached metropolitan terrain layer + tiled 2.5D bump lighting & dynamic cast shadows
    const animTime = this.reduceEffects ? 0 : nowMs * 0.001;
    const pulse = this.reduceEffects ? 0.75 : 0.65 + 0.35 * Math.sin(animTime * 5.2);
    const atlas = this.spriteCache.getBoardAtlas(world, this.buildingHeight, this.lastDirtyChunks);
    const sceneLights = collectSceneLights(sim, animTime, this.reduceEffects, this.buildingHeight);
    this.lighting.renderLighting(world, this.terrainU32, this.spriteCache, sceneLights);
    lap("lighting");

    rawScene.drawImage(this.terrainLayer, 0, 0, world.grid.w, world.grid.h);
    const lBounds = this.lighting.dirtyBounds;
    if (lBounds.hasTerrain && this.lighting.terrainCanvas && lBounds.x1 > lBounds.x0 && lBounds.y1 > lBounds.y0) {
      const dw = lBounds.x1 - lBounds.x0;
      const dh = lBounds.y1 - lBounds.y0;
      rawScene.drawImage(this.lighting.terrainCanvas, lBounds.x0, lBounds.y0, dw, dh, lBounds.x0, lBounds.y0, dw, dh);
    }

    lap("terrain");

    // 2. Tron Light Cycles & Stream Trails running along street corridors from building to building
    this.syncCorridors(world);
    const dt = this.lastTimeMs > 0 ? Math.min(0.08, (nowMs - this.lastTimeMs) * 0.001) : 0.016;
    this.lastTimeMs = nowMs;

    const closeZoom = this.cam.s >= 2.0;
    const TRAIL_LEN = closeZoom ? pixels(4) : pixels(2);
    for (const cyc of this.cycles) {
      if (cyc.corridorIdx >= this.corridors.length) continue;
      const corr = this.corridors[cyc.corridorIdx];
      const pLen = corr.path.length;
      if (pLen < 2) continue;

      cyc.dist = (cyc.dist + cyc.speed * dt) % pLen;
      const headIdx = Math.floor(cyc.dist);

      // Subtle commuter headlights along avenues (richer tail at close zoom)
      for (let t = TRAIL_LEN; t >= 0; t--) {
        const segIdx = ((headIdx - t) % pLen + pLen) % pLen;
        const pt = corr.path[segIdx];
        if (!pt) continue;
        if (world.material[world.grid.index(pt.x, pt.y)] !== CellMaterial.STREET) continue;

        if (t === 0) {
          c.fillStyle = closeZoom ? "#e6d2a2" : "rgba(215, 195, 150, 0.72)";
          c.fillRect(pt.x, pt.y, 1, 1);
        } else if (closeZoom) {
          c.fillStyle = "rgba(175, 130, 75, 0.35)";
          c.fillRect(pt.x + 0.25, pt.y + 0.25, 0.5, 0.5);
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

      rawScene.fillStyle = FRONTIER_TINTS[Math.min(31, (intensity * pulse * 31) | 0)];
      rawScene.fillRect(fx, fy, 1, 1);

      // Subtle localized purple frontier spark on actively eroding cells
      if (intensity > 0.55 && ((fx * 7 + fy * 13 + Math.floor(animTime * 6)) & 15) === 0) {
        rawScene.fillStyle = "#e08aff";
        rawScene.fillRect(fx, fy, 1, 1);
      }
    }

    if (!this.reduceEffects && voidField.frontierCells.length > 0) {
      // Short crackling purple Void tendrils at the active frontier
      const slot = Math.floor(animTime * 4);
      const boltCount = Math.min(5, Math.max(1, Math.floor(voidField.frontierCells.length / 45)));
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
        const len = 2.5 + hash01(world.seed, 761, slot, b) * 3.5;
        const segs = 4;
        const flick = 0.45 + 0.35 * hash01(world.seed, 762, slot, b);
        c.strokeStyle = `rgba(186, 78, 240, ${(0.75 * flick).toFixed(3)})`;
        c.lineWidth = 0.28;
        c.beginPath();
        c.moveTo(sx, sy);
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const jit = (hash01(world.seed, 763, slot, b, k) - 0.5) * 1.4;
          c.lineTo(sx + dx * len * t - dy * jit, sy + dy * len * t + dx * jit);
        }
        c.stroke();
      }

      // Sparse, dim cosmic stars inside the calm Void interior
      if (vx1 >= vx0 && vy1 >= vy0) {
        const slow = Math.floor(animTime * 0.4);
        for (let i = 0; i < 12; i++) {
          const tx = vx0 + Math.floor(hash01(world.seed, 770, slow, i) * (vx1 - vx0 + 1));
          const ty = vy0 + Math.floor(hash01(world.seed, 771, slow, i) * (vy1 - vy0 + 1));
          if (!world.grid.inBounds(tx, ty) || world.material[ty * w + tx] !== CellMaterial.VOID) continue;
          const tw = Math.abs(Math.sin(animTime * (1.5 + hash01(world.seed, 772, i) * 2) + i));
          const tint = i % 2 === 0 ? "180, 140, 235" : "220, 195, 255";
          c.fillStyle = `rgba(${tint}, ${(0.15 + 0.35 * tw).toFixed(3)})`;
          c.fillRect(tx, ty, 1, 1);
        }
      }
    }

    lap("frontier");

    // Living, moving Void interior: subtle inward-flowing nebula wisps behind the portal silhouette
    if (this.wispsWorld !== world) {
      this.wispsWorld = world;
      this.interiorWisps = generateWispsForPortals(world);
    }
    paintVoidInteriorDirect(rawScene, world, animTime, this.reduceEffects);
    paintVoidRipples(rawScene, world, physics.voidRipples, this.reduceEffects);
    lap("interior");

    // 4. The black hole: strong lightless core, crisp photon rim, and a single restrained accretion arc
    for (const p of world.portals) {
      if (p.active) {
        const coreR = Math.max(3.6, p.radius * 0.42);

        // Lightless core
        c.fillStyle = "#000000";
        c.beginPath();
        c.arc(p.x, p.y, coreR, 0, Math.PI * 2);
        c.fill();

        // Crisp photon rim & restrained violet-magenta event horizon
        c.strokeStyle = "rgba(230, 185, 255, 0.78)";
        c.lineWidth = 0.32;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 0.05, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "rgba(195, 62, 190, 0.65)";
        c.lineWidth = 0.55;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 0.65 + 0.08 * pulse, 0, Math.PI * 2);
        c.stroke();

        // Single restrained tilted accretion arc
        if (!this.reduceEffects) {
          c.save();
          c.translate(p.x, p.y);
          c.rotate(animTime * 0.42 + p.id);
          c.strokeStyle = "rgba(110, 215, 240, 0.5)";
          c.lineWidth = 0.4;
          c.beginPath();
          c.ellipse(0, 0, coreR + 1.9, coreR * 0.72, 0, Math.PI * 0.15, Math.PI * 1.45);
          c.stroke();
          c.restore();
        }
      } else {
        // Telegraphed warning ring for delayed secondary portal
        c.strokeStyle = `rgba(195, 85, 235, ${0.4 + 0.35 * pulse})`;
        c.lineWidth = 0.5;
        c.setLineDash([1.5, 1.5]);
        c.beginPath();
        c.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }

    lap("portals");

    // Exposed strata and undercuts sit in front of the nebula and interior wisps, below the ground lip.
    if (
      this.ledgeDirty ||
      this.lastFrontierLen !== voidField.frontierCells.length ||
      this.ledgeLayer.width !== w ||
      this.ledgeLayer.height !== h
    ) {
      if (this.ledgeLayer.width !== w || this.ledgeLayer.height !== h) {
        this.ledgeLayer.width = w;
        this.ledgeLayer.height = h;
      } else {
        this.ledgeCtx.clearRect(0, 0, w, h);
      }
      paintVoidLedge(this.ledgeCtx, world, voidField.frontierCells);
      this.ledgeDirty = false;
      this.lastFrontierLen = voidField.frontierCells.length;
    }
    rawScene.drawImage(this.ledgeLayer, 0, 0);

    // Step cosmetic fleeing civilians and draw beneath-ground falling chunks/civilians (`z < 0`),
    // clipped behind northern ledge front faces.
    this.stepCivilians(world, voidField.frontierCells, dt);
    if (!this.reduceEffects) {
      for (let i = 0; i < physics.fallingChunks.length; i++) {
        const ch = physics.fallingChunks[i];
        if (ch.active && ch.z < 0) {
          this.paintFallingChunk(c, world, ch, true);
        }
      }
      for (let i = 0; i < this.civilians.length; i++) {
        const civ = this.civilians[i];
        if (civ.active && civ.z < 0) {
          const sx = Math.round(civ.x);
          const sy = Math.round(civ.y - civ.z);
          if (
            sx >= 0 &&
            sx < w &&
            sy >= 0 &&
            sy < h &&
            world.material[sy * w + sx] === CellMaterial.VOID &&
            !isOccludedByLedge(world, sx, sy)
          ) {
            c.fillStyle = civ.z < -10 ? "#6e2bb4" : "#df42d1";
            c.fillRect(sx, sy, 1, 1);
          }
        }
      }
    }
    lap("ledge");

    // 5. Draw crystalline Void Nodes (Phase 6+ infantry targets) with organic nebula contours
    for (const node of voidField.nodes) {
      paintNodeContour(rawScene, node, animTime, this.reduceEffects);
      c.fillStyle = "#59127a";
      c.fillRect(node.x - 1.2, node.y - 1.2, 2.4, 2.4);
      c.fillStyle = "#e056fd";
      c.fillRect(node.x - 0.85, node.y - 0.85, 1.7, 1.7);
      c.fillStyle = "#7afcff";
      c.fillRect(node.x - 0.4, node.y - 0.4, 0.8, 0.8);
    }

    // 6. Draw user-drawn wall blueprints
    for (const bp of combat.blueprints) {
      rawScene.fillStyle = "rgba(255, 168, 52, 0.42)";
      for (const cIdx of bp.cells) {
        if (world.material[cIdx] !== CellMaterial.WALL) {
          rawScene.fillRect(world.grid.xOf(cIdx), world.grid.yOf(cIdx), 1, 1);
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
      } else if (t.type === "voidSiphon") {
        const s = combat.siphonStates.get(t.uid);
        const r = TOWER_SPECS.voidSiphon.range;
        if (s?.phase === "venting") {
          const pulse = 0.35 + 0.25 * Math.sin((sim.tick * 0.05) * 10);
          c.strokeStyle = `rgba(255, 176, 82, ${pulse})`;
          c.lineWidth = 0.55;
          c.beginPath();
          c.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
          c.stroke();
        } else {
          c.strokeStyle = "rgba(154, 107, 255, 0.36)";
          c.lineWidth = 0.4;
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
          // Inward-flowing dark-violet streams
          for (let k = 0; k < 4; k++) {
            const ang = (k * Math.PI) / 2 + (sim.tick * 0.05) * 0.8;
            const prog = ((sim.tick * 0.05) * 0.9 + k * 0.25) % 1;
            const distR = r * (1 - prog);
            c.fillStyle = "rgba(180, 140, 255, 0.75)";
            c.fillRect(cx + Math.cos(ang) * distR - 0.3, cy + Math.sin(ang) * distR - 0.3, 0.6, 0.6);
          }
        }
      } else if (t.type === "boundaryPrism") {
        const p = combat.prismStates.get(t.uid);
        const ang = p?.angleRad ?? 0;
        const halfLen = (p?.planeLength ?? TOWER_SPECS.boundaryPrism.range) * 0.5;
        const dx = Math.cos(ang) * halfLen;
        const dy = Math.sin(ang) * halfLen;
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        c.strokeStyle = "rgba(92, 225, 230, 0.72)";
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(cx - dx, cy - dy);
        c.lineTo(cx + dx, cy + dy);
        c.stroke();
        // Directional chevrons toward receiving flank (animated)
        const pulseOff = ((sim.tick * 0.08) % 1) * 1.2;
        c.strokeStyle = "rgba(184, 244, 255, 0.88)";
        c.lineWidth = 0.5;
        for (const sgn of [-0.5, 0, 0.5]) {
          const px = cx + dx * sgn;
          const py = cy + dy * sgn;
          c.beginPath();
          c.moveTo(px + nx * (1.2 + pulseOff), py + ny * (1.2 + pulseOff));
          c.lineTo(px + nx * (2.6 + pulseOff) + Math.cos(ang) * 0.8, py + ny * (2.6 + pulseOff) + Math.sin(ang) * 0.8);
          c.stroke();
        }
      } else if (t.type === "chronoCannon") {
        c.strokeStyle = "rgba(242, 193, 78, 0.42)";
        c.lineWidth = 0.45;
        c.setLineDash([2.2, 1.8]);
        c.beginPath();
        c.arc(cx, cy, TOWER_SPECS.chronoCannon.range, -(sim.tick * 0.05) * 0.5, -(sim.tick * 0.05) * 0.5 + Math.PI * 1.75);
        c.stroke();
        c.setLineDash([]);
      }
    }

    // Living wheat: sparse crop index, spatial buckets for ground-unit parting.
    // Use simulation time so pause and speed apply; reduced motion retains parted paths.
    const farmTime = this.reduceEffects ? 0 : sim.elapsedSeconds;
    const bucketW = Math.ceil(world.grid.w / 8);
    const bucketH = Math.ceil(world.grid.h / 8);
    const totalBuckets = bucketW * bucketH;
    if (this.walkerBuckets.length < totalBuckets) {
      while (this.walkerBuckets.length < totalBuckets) this.walkerBuckets.push([]);
    }
    this.walkerBucketW = bucketW;
    for (let i = 0; i < this.dirtyWalkerBuckets.length; i++) {
      this.walkerBuckets[this.dirtyWalkerBuckets[i]].length = 0;
    }
    this.dirtyWalkerBuckets.length = 0;
    const pushWalker = (a: { x: number; y: number }): void => {
      const bx = Math.floor(a.x / 8);
      const by = Math.floor(a.y / 8);
      if (bx < 0 || bx >= bucketW || by < 0 || by >= bucketH) return;
      const key = by * bucketW + bx;
      const bucket = this.walkerBuckets[key];
      if (bucket.length === 0) this.dirtyWalkerBuckets.push(key);
      bucket.push(a);
    };
    for (let i = 0; i < combat.agents.length; i++) {
      const a = combat.agents[i];
      if (a.layer !== "air") pushWalker(a);
    }
    for (let i = 0; i < combat.organisms.length; i++) {
      const a = combat.organisms[i];
      if (a.kind !== "voidBee" && a.kind !== "nebulaQueen") pushWalker(a);
    }
    for (let i = 0; i < this.civilians.length; i++) {
      const a = this.civilians[i];
      if (a.active && a.z === 0) pushWalker(a);
    }
    if (this.wheatWorld !== world) {
      this.wheatWorld = world;
      this.evenWheatCells = [];
      for (const idx of world.wheatCells) {
        const wx = idx % world.grid.w;
        const wy = (idx / world.grid.w) | 0;
        if (((wx + (wy & 1)) & 1) === 0 && ((wx * 7 + wy * 13) & 7) !== 0) {
          this.evenWheatCells.push(idx);
        }
      }
    }
    const hasWalkers = this.dirtyWalkerBuckets.length > 0;
    const nearby = this.nearbyWalkers;
    for (let wi = 0; wi < this.evenWheatCells.length; wi++) {
      const idx = this.evenWheatCells[wi];
      const x = idx % world.grid.w, y = (idx / world.grid.w) | 0;
      if (world.material[idx] === CellMaterial.VOID ||
          world.material[idx] === CellMaterial.SALVAGE || world.buildingAt[idx] >= 0 ||
          !isWheat(world.landCover[idx]) || sim.farms.scorch[idx]) continue;
      nearby.length = 0;
      if (hasWalkers) {
        const bx = x >> 3, by = y >> 3;
        const oyMin = by > 0 ? -1 : 0;
        const oyMax = by + 1 < bucketH ? 1 : 0;
        const oxMin = bx > 0 ? -1 : 0;
        const oxMax = bx + 1 < bucketW ? 1 : 0;
        for (let oy = oyMin; oy <= oyMax; oy++) {
          const row = (by + oy) * this.walkerBucketW;
          for (let ox = oxMin; ox <= oxMax; ox++) {
            const bucket = this.walkerBuckets[row + bx + ox];
            for (let k = 0; k < bucket.length; k++) nearby.push(bucket[k]);
          }
        }
      }
      const lean = Math.round(wheatLean(x, y, farmTime, nearby));
      let close = false;
      for (let k = 0; k < nearby.length; k++) {
        const a = nearby[k];
        const dx = a.x - x, dy = a.y - y;
        if (dx * dx + dy * dy < 1.69) { close = true; break; }
      }
      const tipX = x + lean, tipY = y - (close ? 0 : 1);
      if (tipX < 0 || tipX >= w || tipY < 0 || tipY >= h) continue;
      const tipIdx = tipY * w + tipX;
      if (!isWheat(world.landCover[tipIdx]) ||
          world.material[tipIdx] === CellMaterial.VOID || world.buildingAt[tipIdx] >= 0) continue;
      rawScene.fillStyle = ((x + y) & 1) === 0 ? "#6c7137" : "#787c3d";
      rawScene.fillRect(x, y, 1, 1);
      const grainTone = (x * 11 + y * 17) & 3;
      rawScene.fillStyle =
        grainTone === 0 ? "#e6c86e" : grainTone === 1 ? "#d4ad4c" : grainTone === 2 ? "#c2963b" : "#edd585";
      rawScene.fillRect(tipX, tipY, 1, 1);
      if (closeZoom && !close && ((x + y) & 3) === 0) {
        rawScene.fillStyle = "#edd585";
        rawScene.fillRect(tipX, tipY - 1, 1, 1);
      }
    }

    // 7a. Farmland livestock: pre-indexed sparse pixel-art sheep and cows on intact meadow/farmland
    const { w: gw, h: gh } = world.grid;
    if (this.livestockWorld !== world) {
      this.livestockWorld = world;
      this.livestockList = [];
      for (let gy = 0; gy < gh; gy += 2) {
        const row = gy * gw;
        for (let gx = 0; gx < gw; gx += 2) {
          const idx = row + gx;
          const lc = world.landCover[idx];
          if (lc !== LandCover.FIELD_H && lc !== LandCover.FIELD_V && lc !== LandCover.MEADOW) continue;
          const hVal = ((gx * 73856093) ^ (gy * 19349663) ^ (world.seed * 83492791)) >>> 0;
          const threshold = lc === LandCover.MEADOW ? 0.025 : 0.015;
          if ((hVal % 1000) / 1000 >= threshold) continue;
          this.livestockList.push({ x: gx, y: gy, idx, isCow: ((hVal >>> 10) & 1) === 1 });
        }
      }
    }
    for (let i = 0; i < this.livestockList.length; i++) {
      const lv = this.livestockList[i];
      const idx = lv.idx;
      if (world.material[idx] === CellMaterial.VOID || sim.farms.scorch[idx]) continue;
      if (!closeZoom) {
        rawScene.fillStyle = lv.isCow ? "#d8d0c0" : "#e3ded3";
        rawScene.fillRect(lv.x, lv.y, 1, 1);
      } else if (lv.isCow) {
        const ax = lv.x + 0.25;
        const ay = lv.y + 0.25;
        // 0.5-px pixel-art cow (4x2 half-pixels = 2.0 x 1.0 world px)
        c.fillStyle = "#e8e2d5";
        c.fillRect(ax, ay, 1.5, 1.0);
        c.fillStyle = "#3b281c";
        c.fillRect(ax + 0.5, ay, 0.5, 0.5); // spot
        c.fillRect(ax + 1.5, ay, 0.5, 0.5); // head
        c.fillRect(ax, ay + 1.0, 0.5, 0.5); // back leg
        c.fillRect(ax + 1.0, ay + 1.0, 0.5, 0.5); // front leg
      } else {
        const ax = lv.x + 0.25;
        const ay = lv.y + 0.25;
        // 0.5-px pixel-art sheep (3x2 half-pixels = 1.5 x 1.0 world px)
        c.fillStyle = "#edeae2";
        c.fillRect(ax, ay, 1.5, 1.0);
        c.fillStyle = "#2c2623";
        c.fillRect(ax + 1.5, ay + 0.25, 0.5, 0.5); // head
        c.fillRect(ax, ay + 1.0, 0.5, 0.5); // back leg
        c.fillRect(ax + 1.0, ay + 1.0, 0.5, 0.5); // front leg
      }
    }

    // 7a0. Seamwalker frozen-Void cells (dark stationary purple interior with angular amber staples)
    if (sim.voidField.frozenVoidCells.size > 0) {
      for (const [idx, rem] of sim.voidField.frozenVoidCells) {
        if (world.material[idx] !== CellMaterial.VOID) continue;
        const cx = idx % gw;
        const cy = (idx / gw) | 0;
        const expiring = rem < 0.6 && !this.reduceEffects && ((sim.tick >> 2) & 1) === 1;
        // Dark motionless interior
        rawScene.fillStyle = expiring ? "#26123d" : "#160b26";
        rawScene.fillRect(cx, cy, 1, 1);
        // Whole-pixel angular amber staple marks on alternating 2x2 grid
        if ((cx & 1) === 0 && (cy & 1) === 0) {
          rawScene.fillStyle = expiring ? "#ffcf70" : "#e09132";
          rawScene.fillRect(cx, cy, 1, 1);
        }
      }
    }

    // 7a1. Countervoid Heart luminous flowing orange field (distinct from dark stapled frozen Void)
    if (sim.voidField.countervoidCells.size > 0) {
      const phase = this.reduceEffects ? 0 : sim.tick * 0.14;
      for (const idx of sim.voidField.countervoidCells) {
        const cx = idx % gw;
        const cy = (idx / gw) | 0;
        const wave = this.reduceEffects ? 0.5 : 0.5 + 0.5 * Math.sin(phase + cx * 0.7 + cy * 0.5);
        rawScene.fillStyle = wave > 0.65 ? "#ffa238" : wave > 0.35 ? "#eb7a1e" : "#c75914";
        rawScene.fillRect(cx, cy, 1, 1);
        // Frontier contact sparks against purple Void
        const touchesVoid =
          (cx > 0 && world.material[idx - 1] === CellMaterial.VOID) ||
          (cx + 1 < gw && world.material[idx + 1] === CellMaterial.VOID) ||
          (cy > 0 && world.material[idx - gw] === CellMaterial.VOID) ||
          (cy + 1 < gh && world.material[idx + gw] === CellMaterial.VOID);
        if (touchesVoid) {
          rawScene.fillStyle = "#ffe6a3";
          rawScene.fillRect(cx, cy, 1, 1);
        }
      }
    }

    // 7a2. Chrono Cannon upward reconstruction & returning projectile
    for (const ef of combat.chronoEffects) {
      const p = Math.min(1, ef.life / Math.max(0.05, ef.maxLife));
      // Broken clock-ring at target
      c.strokeStyle = `rgba(242, 193, 78, ${1 - p * 0.7})`;
      c.lineWidth = 0.55;
      c.setLineDash([2.0, 1.4]);
      c.beginPath();
      c.arc(ef.sx, ef.sy, ef.radius * (1 - p * 0.3), -p * 4, -p * 4 + Math.PI * 1.65);
      c.stroke();
      c.setLineDash([]);
      // Upward reconstruction of real restored objects (buildings, units, terrain)
      const riseScale = this.reduceEffects ? 0 : 1 - p;
      const alpha = Math.max(0.2, 1 - p * 0.75);
      if (ef.items && ef.items.length > 0) {
        for (const item of ef.items) {
          if (item.kind === "building") {
            const floors = Math.max(1, item.floors ?? 1);
            const h = Math.min(4.5, 1 + floors * 0.85);
            const iy = item.y + riseScale * 5.0 - h + 1;
            c.fillStyle = `rgba(196, 168, 118, ${alpha})`;
            c.fillRect(item.x - 0.15, iy, 1.3, h);
            c.fillStyle = `rgba(255, 226, 138, ${alpha})`;
            c.fillRect(item.x - 0.15, iy, 1.3, 0.45);
          } else if (item.kind === "unit") {
            const iy = item.y + riseScale * 4.0;
            const unitColor =
              item.agentKind === "engineer"
                ? `rgba(255, 209, 92, ${alpha})`
                : item.agentKind === "heavyMech"
                  ? `rgba(122, 252, 255, ${alpha})`
                  : item.agentKind === "lanternBearer"
                    ? `rgba(255, 226, 138, ${alpha})`
                    : item.agentKind === "seamwalker"
                      ? `rgba(242, 157, 56, ${alpha})`
                      : `rgba(255, 123, 36, ${alpha})`;
            c.fillStyle = unitColor;
            c.fillRect(item.x - 0.5, iy - 0.8, 1.0, 1.2);
          } else {
            const iy = item.y + riseScale * 3.0;
            c.fillStyle = `rgba(212, 180, 92, ${alpha * 0.85})`;
            c.fillRect(item.x, iy, 1.0, 1.0);
          }
        }
      } else {
        c.fillStyle = `rgba(255, 226, 138, ${1 - p})`;
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + p * 1.5;
          const rx = ef.sx + Math.cos(ang) * ef.radius * 0.45;
          const ry = ef.sy + Math.sin(ang) * ef.radius * 0.45 + riseScale * 3.5;
          c.fillRect(rx - 0.35, ry - 0.35, 0.7, 0.7);
        }
      }
      // Contracting reverse flash -> projectile returning FROM restored area BACK INTO barrel
      if (!this.reduceEffects) {
        if (p < 0.35) {
          const fp = 1 - p / 0.35;
          c.strokeStyle = "rgba(255, 243, 209, 0.85)";
          c.lineWidth = 0.45;
          c.beginPath();
          c.arc(ef.sx, ef.sy, Math.max(0.4, ef.radius * 0.5 * fp), 0, Math.PI * 2);
          c.stroke();
        } else {
          const rp = (p - 0.35) / 0.65;
          const px = ef.sx + (ef.tx - ef.sx) * rp;
          const py = ef.sy + (ef.ty - ef.sy) * rp;
          c.fillStyle = "#fff3d1";
          c.beginPath();
          c.arc(px, py, 0.9, 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    // 7b. Quarantine Bell closed circular seals
    for (const seal of sim.voidField.quarantineSeals) {
      const alpha = Math.max(0.2, Math.min(0.85, seal.remaining / Math.max(0.1, seal.duration)));
      c.strokeStyle = `rgba(212, 180, 92, ${alpha})`;
      c.lineWidth = 0.65;
      c.beginPath();
      c.arc(seal.x, seal.y, seal.radius, 0, Math.PI * 2);
      c.stroke();
      const marks = 12;
      c.fillStyle = `rgba(255, 226, 138, ${alpha})`;
      for (let m = 0; m < marks; m++) {
        const a = (m / marks) * Math.PI * 2;
        c.fillRect(seal.x + Math.cos(a) * seal.radius - 0.35, seal.y + Math.sin(a) * seal.radius - 0.35, 0.7, 0.7);
      }
      // Translucent swinging bell apparition on cast
      const age = seal.duration - seal.remaining;
      if (age < 1.2) {
        const bellAlpha = (1 - age / 1.2) * 0.85;
        const swing = Math.sin(age * 10) * 0.8;
        c.fillStyle = `rgba(255, 232, 160, ${bellAlpha})`;
        c.beginPath();
        c.moveTo(seal.x + swing, seal.y - 4.2);
        c.lineTo(seal.x + 2.0 + swing, seal.y - 0.8);
        c.lineTo(seal.x - 2.0 + swing, seal.y - 0.8);
        c.closePath();
        c.fill();
      }
    }

    // 8. Sorted Structure Pass: placed towers (elevated 2 px), autonomous agents (0-1 px),
    //    and elevated building roofs/south facades sorted back-to-front by footprint bottom `y`.
    const tElev =
      this.buildingHeight === "flat" ? 0 : this.buildingHeight === "low" ? 1 : TOWER_ELEVATION_PX;

    const drawTower = (t: (typeof combat.towers)[number]): void => {
      const spec = TOWER_SPECS[t.type];
      const topY = t.y - tElev;
      // Armored shadow & south base facade (2 px tall)
      rawScene.fillStyle = "#0d1118";
      rawScene.fillRect(t.x, topY, t.w, t.h + tElev);
      if (tElev > 0) {
        rawScene.fillStyle = "#18202c";
        rawScene.fillRect(t.x, t.y + t.h - tElev, t.w, tElev);
      }
      rawScene.fillStyle = "#242c3a";
      rawScene.fillRect(t.x, topY, t.w, t.h);
      // Corner rivets / mounting brackets
      rawScene.fillStyle = "#5c6b82";
      rawScene.fillRect(t.x, topY, 1, 1);
      rawScene.fillRect(t.x + t.w - 1, topY, 1, 1);
      rawScene.fillRect(t.x, topY + t.h - 1, 1, 1);
      rawScene.fillRect(t.x + t.w - 1, topY + t.h - 1, 1, 1);
      // Primary colored turret housing
      if (t.type === "voidSiphon") {
        const s = combat.siphonStates.get(t.uid);
        const fillFrac = s ? Math.min(1, s.stored / Math.max(1, s.maxStorage)) : 0;
        // Round glass reservoir
        c.fillStyle = "#1a1426";
        c.beginPath();
        c.arc(t.x + t.w * 0.5, topY + t.h * 0.5, t.w * 0.42, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = s?.phase === "venting" ? "#ffb052" : "#9a6bff";
        const fillH = Math.max(0.4, (t.h * 0.72) * fillFrac);
        c.fillRect(t.x + t.w * 0.2, topY + t.h * 0.86 - fillH, t.w * 0.6, fillH);
        c.strokeStyle = "#d8c4ff";
        c.lineWidth = 0.25;
        c.beginPath();
        c.arc(t.x + t.w * 0.5, topY + t.h * 0.5, t.w * 0.42, 0, Math.PI * 2);
        c.stroke();
        // Vertical venting plume
        if (s?.phase === "venting") {
          const plumeH = 2.0 + Math.sin(sim.tick * 0.35) * 0.8;
          c.fillStyle = "rgba(255, 176, 82, 0.78)";
          c.fillRect(t.x + t.w * 0.5 - 0.5, topY - plumeH, 1.0, plumeH);
        }
      } else if (t.type === "boundaryPrism") {
        // Tall triangular faceted crystal
        c.fillStyle = "#5ce1e6";
        c.beginPath();
        c.moveTo(t.x + t.w * 0.5, topY - 0.6);
        c.lineTo(t.x + t.w - 0.2, topY + t.h - 0.2);
        c.lineTo(t.x + 0.2, topY + t.h - 0.2);
        c.closePath();
        c.fill();
        c.fillStyle = "#d4fcff";
        c.beginPath();
        c.moveTo(t.x + t.w * 0.5, topY - 0.6);
        c.lineTo(t.x + t.w * 0.5, topY + t.h - 0.2);
        c.lineTo(t.x + 0.2, topY + t.h - 0.2);
        c.closePath();
        c.fill();
      } else if (t.type === "chronoCannon") {
        // Golden clock-ring and reverse barrel
        c.fillStyle = "#3a2e18";
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        c.strokeStyle = "#f2c14e";
        c.lineWidth = 0.35;
        c.beginPath();
        c.arc(t.x + t.w * 0.5, topY + t.h * 0.5, t.w * 0.38, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = "#fff3d1";
        c.fillRect(t.x + t.w * 0.5 - 0.4, topY + t.h * 0.5 - 0.4, 0.8, 0.8);
        // Counter-rotating clock hand
        const handAng = -(sim.tick * 0.12);
        c.strokeStyle = "#ffe599";
        c.lineWidth = 0.3;
        c.beginPath();
        c.moveTo(t.x + t.w * 0.5, topY + t.h * 0.5);
        c.lineTo(
          t.x + t.w * 0.5 + Math.cos(handAng) * (t.w * 0.32),
          topY + t.h * 0.5 + Math.sin(handAng) * (t.h * 0.32),
        );
        c.stroke();
      } else if (t.type === "echoMine") {
        c.fillStyle = "#2b2530";
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        const pulse = this.reduceEffects ? 0.65 : 0.45 + 0.55 * Math.abs(Math.sin(sim.tick * 0.12 + t.uid));
        c.fillStyle = `rgba(255, 136, 48, ${pulse.toFixed(2)})`;
        c.fillRect(t.x + t.w * 0.5 - 0.55, topY + t.h * 0.5 - 0.55, 1.1, 1.1);
        c.strokeStyle = "rgba(255, 178, 82, 0.45)";
        c.lineWidth = 0.25;
        c.beginPath();
        c.arc(t.x + t.w * 0.5, topY + t.h * 0.5, t.w * 0.55, 0, Math.PI * 2);
        c.stroke();
      } else if (t.type === "countervoidHeart") {
        c.fillStyle = "#1f1528";
        c.fillRect(t.x + 0.2, topY + 0.2, t.w - 0.4, t.h - 0.4);
        c.strokeStyle = "#ff9a34";
        c.lineWidth = 0.35;
        c.strokeRect(t.x + 0.2, topY + 0.2, t.w - 0.4, t.h - 0.4);
        const beat = this.reduceEffects ? 0.8 : 0.65 + 0.35 * Math.sin(sim.tick * 0.16);
        c.fillStyle = beat > 0.75 ? "#ffe39c" : "#ff8c24";
        c.fillRect(t.x + t.w * 0.5 - 0.75, topY + t.h * 0.5 - 0.75, 1.5, 1.5);
      } else if (t.type === "lanternBearer") {
        c.fillStyle = "#4d3822";
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        c.fillStyle = "#ffd875";
        c.fillRect(t.x + t.w * 0.5 - 0.4, topY + t.h * 0.5 - 0.5, 0.8, 1.0);
      } else if (t.type === "seamwalker") {
        c.fillStyle = "#3c324a";
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        c.fillStyle = "#f29d38";
        c.fillRect(t.x + t.w * 0.5 - 0.45, topY + t.h * 0.5 - 0.3, 0.9, 0.6);
      } else {
        c.fillStyle = spec.color;
        c.fillRect(t.x + 0.35, topY + 0.35, t.w - 0.7, t.h - 0.7);
        // Glowing energy core / barrel mount
        c.fillStyle = "#fff3d1";
        c.fillRect(t.x + t.w * 0.5 - 0.45, topY + t.h * 0.5 - 0.45, 0.9, 0.9);
      }

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
    };

    const drawAgent = (a: (typeof combat.agents)[number]): void => {
      const ax = Math.floor(a.x);
      const ay = Math.floor(a.y);
      if (a.kind === "rifleman") {
        rawScene.fillStyle = "rgba(10, 12, 16, 0.65)";
        rawScene.fillRect(ax, ay + 1, 1, 1);
        rawScene.fillStyle = "#ff8b33";
        rawScene.fillRect(ax, ay, 1, 1);
        rawScene.fillStyle = "#ffe4b5";
        rawScene.fillRect(ax, ay - 1, 1, 1);
      } else if (a.kind === "engineer") {
        rawScene.fillStyle = "rgba(10, 12, 16, 0.65)";
        rawScene.fillRect(ax, ay + 1, 1, 1);
        rawScene.fillStyle = a.carryingMatter > 0 ? "#48e5ff" : "#ffd15c";
        rawScene.fillRect(ax, ay - 1, 1, 1);
        rawScene.fillStyle = "#d9822b";
        rawScene.fillRect(ax, ay, 1, 1);
      } else if (a.kind === "heavyMech") {
        rawScene.fillStyle = "#161b24";
        rawScene.fillRect(ax - 1, ay, 2, 2);
        rawScene.fillStyle = "#ff9e30";
        rawScene.fillRect(ax - 1, ay - 1, 2, 2);
        rawScene.fillStyle = "#7afcff";
        rawScene.fillRect(ax, ay - 1, 1, 1);
      } else if (a.kind === "wallSerpent") {
        c.fillStyle = "#0c1420";
        c.fillRect(a.x - 1.1, a.y - 1.1, 2.2, 2.2);
        c.fillStyle = "#48e5ff";
        c.fillRect(a.x - 0.9, a.y - 0.9, 1.8, 1.8);
        c.fillStyle = "#ffd166";
        c.fillRect(a.x - 0.4, a.y - 0.4, 0.8, 0.8);
      } else if (a.kind === "lanternBearer") {
        // Warm safe-ground footprint halo + tall carried lantern
        const haloR = a.coverageRadius ?? pixels(2 + sim.tech.lanternRadiusBonus);
        c.strokeStyle = "rgba(255, 214, 112, 0.36)";
        c.lineWidth = 0.25;
        c.beginPath();
        c.arc(a.x, a.y, haloR, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = "rgba(255, 200, 92, 0.10)";
        c.fill();
        c.fillStyle = "#593e22";
        c.fillRect(ax, ay, 1, 1);
        c.fillStyle = "#ffe599";
        c.fillRect(ax, ay - 1, 1, 1);
      } else if (a.kind === "seamwalker") {
        c.fillStyle = "#3e2f52";
        c.fillRect(ax, ay, 1, 1);
        c.fillStyle = "#f29d38";
        c.fillRect(ax, ay - 1, 1, 1);
      } else if (a.kind === "jetpack") {
        // Ground shadow if over land, airborne silhouette offset upward
        const gIdx = world.grid.inBounds(ax, ay) ? world.grid.index(ax, ay) : -1;
        if (gIdx >= 0 && world.material[gIdx] !== CellMaterial.VOID) {
          c.fillStyle = "rgba(0, 0, 0, 0.45)";
          c.fillRect(a.x - 0.5, a.y + 0.4, 1.0, 0.4);
        }
        const flyY = a.y - 1.6;
        c.fillStyle = "#6ad8ff";
        c.fillRect(a.x - 0.6, flyY - 0.5, 1.2, 1.0);
        c.fillStyle = "#ff9a3c";
        c.fillRect(a.x - 0.65, flyY + 0.45, 0.45, 0.55);
        c.fillRect(a.x + 0.2, flyY + 0.45, 0.45, 0.55);
      }
    };

    // Draw placed Resistance towers and agents before the building atlas so north-of-building
    // towers/agents are naturally occluded by southern building roofs.
    for (let i = 0; i < combat.towers.length; i++) drawTower(combat.towers[i]);
    for (let i = 0; i < combat.agents.length; i++) drawAgent(combat.agents[i]);

    // Composite the sorted building structure atlas + bump-mapped 2.5D lighting & dynamic shadows
    if (atlas) {
      rawScene.drawImage(atlas, 0, 0);
    }
    if (lBounds.hasBuilding && this.lighting.buildingCanvas && lBounds.x1 > lBounds.x0 && lBounds.y1 > lBounds.y0) {
      const dw = lBounds.x1 - lBounds.x0;
      const dh = lBounds.y1 - lBounds.y0;
      rawScene.drawImage(this.lighting.buildingCanvas, lBounds.x0, lBounds.y0, dw, dh, lBounds.x0, lBounds.y0, dw, dh);
    }

    // Fire is authoritative; flames/smoke are bounded visual witnesses, including elevated farm roofs.
    for (const [idx, fire] of sim.farms.active) {
      const x = world.grid.xOf(idx), y = world.grid.yOf(idx);
      if (world.material[idx] === CellMaterial.VOID) continue;
      const b = world.buildings[world.buildingAt[idx]];
      const rise = b ? elevationOf(b, this.buildingHeight) : 0;
      const fy = y - rise;
      const flicker = this.reduceEffects ? 0 : (Math.floor(sim.elapsedSeconds * 9) + idx) % 3;
      rawScene.fillStyle = "#d55b28"; rawScene.fillRect(x, fy - 1, 1, 2);
      rawScene.fillStyle = "#ffe1a0"; rawScene.fillRect(x, fy - 1 - (flicker === 0 ? 1 : 0), 1, 1);
      if (!this.reduceEffects && idx % 3 === 0) {
        rawScene.fillStyle = "#635b56"; rawScene.fillRect(x + flicker - 1, fy - 3 - Math.floor(fire.age % 2), 1, 1);
      }
    }

    // Draw above-ground falling chunks (`z >= 0`) and fleeing street civilians (`z >= 0`)
    if (!this.reduceEffects) {
      for (let i = 0; i < physics.fallingChunks.length; i++) {
        const ch = physics.fallingChunks[i];
        if (ch.active && ch.z >= 0) {
          this.paintFallingChunk(c, world, ch, false);
        }
      }
      for (let i = 0; i < this.civilians.length; i++) {
        const civ = this.civilians[i];
        if (civ.active && civ.z >= 0) {
          const sx = Math.round(civ.x);
          const sy = Math.round(civ.y - civ.z);
          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            rawScene.fillStyle = civ.color;
            rawScene.fillRect(sx, sy, 1, 1);
          }
        }
      }
      for (let i = 0; i < physics.dustPuffs.length; i++) {
        const p = physics.dustPuffs[i];
        if (!p.active) continue;
        const sx = Math.round(p.x);
        const sy = Math.round(p.y - p.z);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          rawScene.fillStyle = p.color;
          rawScene.fillRect(sx, sy, 1, 1);
        }
      }
    }

    // Re-draw any tower or agent whose footprint bottom is south of an overlapping northern building's
    // footprint bottom so southern units stand in front of northern building facades.
    for (let i = 0; i < combat.towers.length; i++) {
      const t = combat.towers[i];
      const ty0 = Math.max(0, t.y - tElev);
      const ty1 = Math.min(h - 1, t.y + t.h - 1);
      let needsFront = false;
      for (let py = ty0; py <= ty1 && !needsFront; py++) {
        for (let px = Math.max(0, t.x); px < Math.min(w, t.x + t.w); px++) {
          const bId = world.buildingAt[py * w + px];
          if (bId >= 0 && world.buildings[bId] && world.buildings[bId].y + world.buildings[bId].h <= t.y + t.h) {
            needsFront = true;
            break;
          }
        }
      }
      if (needsFront) drawTower(t);
    }
    if (this.buildingHeight !== "flat") {
      for (let i = 0; i < combat.agents.length; i++) {
        const a = combat.agents[i];
        const ax = Math.floor(a.x);
        const ay = Math.floor(a.y);
        if (ax >= 0 && ax < w && ay + 1 < h) {
          // If a building cell lies within 15 px south of the agent, that building is in front of the agent;
          // otherwise draw the agent in front of any northern building's facade.
          let occludedBySouthernBuilding = false;
          let lastBId = -1;
          for (let dy = 1; dy <= MAX_ELEVATION_PX && ay + dy < h; dy++) {
            const bId = world.buildingAt[(ay + dy) * w + ax];
            if (bId >= 0 && bId !== lastBId) {
              lastBId = bId;
              const sp = this.spriteCache.getSprite(world, world.buildings[bId], this.buildingHeight, false);
              if (sp.intactCount > 0 && ay >= sp.y && ay < sp.bottomY) {
                occludedBySouthernBuilding = true;
                break;
              }
            }
          }
          if (!occludedBySouthernBuilding) drawAgent(a);
        }
      }
    }

    // Occlusion fade: when a placement preview or selected tower lies north of a tall building
    // whose raised roof overlaps it, punch a whole-pixel checkerboard dither through that building
    // and re-stamp any towers/agents that sit in front of (south of) that building.
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
    if (selectedTowerUid !== null) {
      const st = combat.towers.find((tw) => tw.uid === selectedTowerUid);
      if (st) {
        occluders.push({ x0: st.x, y0: st.y - tElev, x1: st.x + st.w, y1: st.y + st.h, footY: st.y + st.h });
      }
    }

    if (occluders.length > 0) {
      for (let i = 0; i < world.buildings.length; i++) {
        const sp = this.spriteCache.getSprite(world, world.buildings[i], this.buildingHeight, false);
        if (sp.intactCount === 0 || sp.maxElev === 0) continue;
        let occluded = false;
        for (let j = 0; j < occluders.length; j++) {
          const occ = occluders[j];
          if (
            occ.footY <= sp.bottomY - 1 &&
            occ.x1 > sp.x &&
            occ.x0 < sp.x + sp.w &&
            occ.y1 > sp.y &&
            occ.y0 < sp.bottomY
          ) {
            occluded = true;
            break;
          }
        }
        if (occluded) {
          // Punch whole-pixel checkerboard dither holes revealing the terrain/preview behind the roof
          for (let k = 0; k < sp.ops.length; k++) {
            const op = sp.ops[k];
            const wx = sp.x + op.dx;
            const wy = sp.y + op.dy;
            if (((wx + wy) & 1) === 1 && wy < sp.bottomY - sp.maxElev) {
              rawScene.drawImage(this.terrainLayer, wx, wy, 1, 1, wx, wy, 1, 1);
            }
          }
        }
      }
    }

    lap("towers");

    // 10. Draw cosmic Void organisms with nebula contours
    for (const o of combat.organisms) {
      // Nebula-colored organic contour around organism silhouette
      paintOrganismContour(rawScene, o, animTime, this.reduceEffects);

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
      // Hearthseed ("landfall") seed-drop -> rising earth -> sprouting sequence
      if (s.color === "#58c443") {
        if (t < 0.35 && !this.reduceEffects) {
          const dropY = s.y - (1 - t / 0.35) * 6;
          c.fillStyle = "#f2c14e";
          c.fillRect(s.x - 0.4, dropY - 0.4, 0.8, 0.8);
        } else if (t < 0.7) {
          c.strokeStyle = "#b8844c";
          c.lineWidth = 0.45;
          c.beginPath();
          c.arc(s.x, s.y, Math.max(0.6, s.maxRadius * (t - 0.2)), 0, Math.PI * 2);
          c.stroke();
        } else {
          c.fillStyle = "#76e05b";
          c.fillRect(s.x - 1.0, s.y - 1.0, 0.7, 0.7);
          c.fillRect(s.x + 0.4, s.y - 0.6, 0.7, 0.7);
          c.fillRect(s.x - 0.2, s.y + 0.5, 0.7, 0.7);
        }
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

    // 14. Torn-off land drifting into the anomaly: fragments retain their original terrain or building
    //     color when detached, then smoothly heat up into molten ember, orange, gold, and white-hot
    //     incandescence with a smooth transition from no glow to a slight glow near the Void's core.
    const swallowPortals = activePortals.map((p) => {
      const coreR = Math.max(3.6, p.radius * 0.42);
      const r = coreR * 0.92;
      return { x: p.x, y: p.y, r2: r * r, coreR };
    });
    const swallowCount = swallowPortals.length;
    let lastRawFill = "";

    for (let i = 0; i < physics.debris.length; i++) {
      const d = physics.debris[i];
      let swallowed = false;
      for (let j = 0; j < swallowCount; j++) {
        const sp = swallowPortals[j];
        const dx = d.x - sp.x;
        const dy = d.y - sp.y;
        if (dx * dx + dy * dy < sp.r2) {
          swallowed = true;
          break;
        }
      }
      if (swallowed) continue;

      const distToPortal = dist(d.portalX - d.x, d.portalY - d.y);
      const lifeRatio = d.life / Math.max(0.01, d.maxLife);
      const heat = computeDebrisHeat(
        distToPortal,
        d.startDist ?? 24,
        d.coreRadius ?? 5,
        lifeRatio,
      );
      const bodyColor = moltenColorAtHeat(d.color, heat);
      const glowAlpha = this.reduceEffects ? 0 : computeDebrisGlowAlpha(heat);

      const slab = d.size >= 1.0 && d.maxLife > 1.5;
      if (slab) {
        const sz = d.size * Math.max(0.35, 1 - lifeRatio * 0.6);
        const half = sz * 0.5;
        if (glowAlpha > 0.005) {
          c.fillStyle = moltenGlowColorAtHeat(heat);
          const pad = 0.16 + heat * 0.24;
          c.fillRect(d.x - half - pad, d.y - half - pad, sz + pad * 2, sz + pad * 2);
        }
        c.fillStyle = bodyColor;
        c.fillRect(d.x - half, d.y - half, sz, sz);
        const shadowAlpha = 0.5 * (1 - heat * 0.75);
        if (shadowAlpha > 0.05) {
          c.fillStyle = `rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`;
          c.fillRect(d.x - half, d.y + half - 0.24, sz, 0.24);
          c.fillRect(d.x + half - 0.24, d.y - half, 0.24, sz);
        }
        lastRawFill = "";
      } else {
        // Smooth glow buildup only when heated near the Void core (strictly 0 glow when detached)
        if (glowAlpha > 0.005) {
          const glowCol = moltenGlowColorAtHeat(heat);
          if (lastRawFill !== glowCol) {
            rawScene.fillStyle = glowCol;
            lastRawFill = glowCol;
          }
          let x0 = Math.round(d.px);
          let y0 = Math.round(d.py);
          const x1 = Math.round(d.x);
          const y1 = Math.round(d.y);
          const dxAbs = x1 >= x0 ? x1 - x0 : x0 - x1;
          const dyAbs = y1 >= y0 ? y1 - y0 : y0 - y1;
          if (dxAbs <= 1 && dyAbs <= 1) {
            rawScene.fillRect(x0, y0, 1, 1);
          } else {
            const dy = -dyAbs;
            const sx = x0 < x1 ? 1 : -1;
            const sy = y0 < y1 ? 1 : -1;
            let err = dxAbs + dy;
            for (;;) {
              rawScene.fillRect(x0, y0, 1, 1);
              if (x0 === x1 && y0 === y1) break;
              const e2 = 2 * err;
              if (e2 >= dy) { err += dy; x0 += sx; }
              if (e2 <= dxAbs) { err += dxAbs; y0 += sy; }
            }
          }
          if (heat > 0.45) {
            // Slight 1-px molten halo around the heated pixel near the core
            const gx = Math.floor(d.x);
            const gy = Math.floor(d.y);
            rawScene.fillRect(gx - 1, gy, 3, 1);
            rawScene.fillRect(gx, gy - 1, 1, 3);
          }
        }
        if (lastRawFill !== bodyColor) {
          rawScene.fillStyle = bodyColor;
          lastRawFill = bodyColor;
        }
        const sz = Math.max(1, Math.round(d.size * 0.8));
        rawScene.fillRect(Math.floor(d.x - d.size * 0.4), Math.floor(d.y - d.size * 0.4), sz, sz);
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
        if (preview.type === "boundaryPrism") {
          const px = preview.x + spec.w * 0.5;
          const py = preview.y + spec.h * 0.5;
          const len = spec.range + (sim.tech.prismLengthBonus ?? 0);
          c.strokeStyle = "#8bf6ff";
          c.lineWidth = 0.45;
          c.beginPath();
          c.moveTo(px - len * 0.5, py);
          c.lineTo(px + len * 0.5, py);
          c.stroke();
        }
      } else if (preview.kind === "strike") {
        const spec = STRIKE_SPECS[preview.strike];
        const previewRadius =
          preview.strike === "landfall"
            ? pixels(4 + sim.tech.hearthseedRank)
            : preview.strike === "quarantineBell"
              ? spec.radius + pixels(sim.tech.quarantineRadiusBonus)
              : spec.radius;
        c.fillStyle = preview.valid ? "rgba(72, 229, 255, 0.26)" : "rgba(255, 68, 68, 0.28)";
        c.strokeStyle = preview.valid ? "#48e5ff" : "#ff4444";
        c.lineWidth = 0.45;
        c.beginPath();
        c.arc(preview.x, preview.y, previewRadius, 0, Math.PI * 2);
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

    // Slight 1 device-pixel camera shake, only when the player is zoomed in close and a
    // significant share of an on-screen building collapses at once (disabled under reduceEffects).
    if (physics.lastLargeCollapseTick > this.lastSeenCollapseTick) {
      this.lastSeenCollapseTick = physics.lastLargeCollapseTick;
      if (
        !this.reduceEffects &&
        this.cam.s >= VoidRenderer.SHAKE_MIN_ZOOM &&
        nowMs >= this.shakeCooldownUntil &&
        this.isWorldPointOnScreen(physics.lastLargeCollapseX, physics.lastLargeCollapseY)
      ) {
        this.shakeMs = 90;
        this.shakeCooldownUntil = nowMs + 900;
      }
    }
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeMs > 0) {
      this.shakeMs = Math.max(0, this.shakeMs - dt * 1000);
      if (!this.reduceEffects && this.shakeMs > 0) {
        // One axis at a time, 45 ms per step: a soft rumble rather than a diagonal jitter.
        const phase = Math.floor(nowMs / 45) & 3;
        if (phase === 0) shakeX = 1;
        else if (phase === 1) shakeY = 1;
        else if (phase === 2) shakeX = -1;
        else shakeY = -1;
      }
    }

    // Magnify the same world-pixel raster; camera zoom reveals no sub-cell detail.
    const output = this.ctx;
    output.setTransform(1, 0, 0, 1, 0, 0);
    output.drawImage(this.backdropFor(this.canvas.width, this.canvas.height, world.seed), 0, 0);
    const scale = this.pixelScale();
    output.imageSmoothingEnabled = false;
    output.setTransform(scale, 0, 0, scale, this.cam.x + shakeX, this.cam.y + shakeY);
    output.drawImage(this.sceneLayer, 0, 0);
    output.setTransform(1, 0, 0, 1, 0, 0);

    // 15a. Screen-space additive bloom halos (explosions, Void portals, frontier surges, shells, lasers, fires, towers, beacons, molten core debris)
    this.lighting.drawBloom(
      output,
      this.cam.x + shakeX,
      this.cam.y + shakeY,
      scale,
      world,
      sceneLights,
      this.reduceEffects,
      physics.debris,
    );
    lap("bloom");

    // 15b. Pooled whole-pixel placement pulses, income popups & outcome flash
    if (!this.reduceEffects) {
      const dtMs = dt * 1000;
      for (let i = this.placementPulses.length - 1; i >= 0; i--) {
        const p = this.placementPulses[i];
        p.ageMs += dtMs;
        if (p.ageMs >= 320) {
          this.placementPulses.splice(i, 1);
          continue;
        }
        const t = p.ageMs / 320;
        const sx = Math.round(this.cam.x + p.x * scale);
        const sy = Math.round(this.cam.y + p.y * scale);
        const rad = Math.round((3 + t * 9) * scale);
        output.save();
        output.globalAlpha = (1 - t) * 0.85;
        output.strokeStyle = "#ffb84d";
        output.lineWidth = Math.max(1, Math.round(scale * 0.5));
        output.beginPath();
        output.arc(sx, sy, rad, 0, Math.PI * 2);
        output.stroke();
        output.fillStyle = "#d8c9a8";
        for (let k = 0; k < 4; k++) {
          const ang = k * Math.PI * 0.5 + 0.4;
          const dx = Math.round(sx + Math.cos(ang) * rad * 0.85);
          const dy = Math.round(sy + Math.sin(ang) * rad * 0.85);
          output.fillRect(dx, dy, Math.max(2, Math.round(scale)), Math.max(2, Math.round(scale)));
        }
        output.restore();
      }

      for (let i = this.incomePopups.length - 1; i >= 0; i--) {
        const pop = this.incomePopups[i];
        pop.ageMs += dtMs;
        if (pop.ageMs >= 900) {
          this.incomePopups.splice(i, 1);
          continue;
        }
        const t = pop.ageMs / 900;
        const sx = Math.round(this.cam.x + pop.x * scale);
        const sy = Math.round(this.cam.y + pop.y * scale - t * 20);
        output.save();
        output.globalAlpha = 1 - t;
        output.font = "bold 11px monospace";
        output.textAlign = "center";
        output.fillStyle = "#000000";
        output.fillText(pop.text, sx + 1, sy + 1);
        output.fillStyle = "#ffb833";
        output.fillText(pop.text, sx, sy);
        output.restore();
      }

      if (this.outcomeFlashMs > 0) {
        this.outcomeFlashMs = Math.max(0, this.outcomeFlashMs - dtMs);
        output.save();
        output.globalAlpha = (this.outcomeFlashMs / 280) * 0.32;
        output.fillStyle = this.outcomeFlashWon ? "#48e5ff" : "#ff334b";
        output.fillRect(0, 0, this.canvas.width, this.canvas.height);
        output.restore();
      }
    }

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
