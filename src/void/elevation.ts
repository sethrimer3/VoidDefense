/** Oblique ¾-projection mathematics, per-building roof & south-facade sprite cache,
 * setback terrace tiering, and screen-to-structure hit testing for Void Defense. */

import { pixels } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import {
  CellMaterial,
  type MetroBuilding,
  type PlacedTower,
} from "./model.ts";
import type { VoidWorld } from "./world.ts";

export type BuildingHeightMode = "full" | "low" | "flat";

/** Two stories per world pixel of vertical rise. */
export const FLOORS_PER_PIXEL = 2;
/** Maximum elevation in world pixels (30 floors / 2 = 15 px). */
export const MAX_ELEVATION_PX = 15;
/** Elevation in world pixels for placed Resistance towers. */
export const TOWER_ELEVATION_PX = 2;

export type ArchPalette = {
  podium: string;
  mid: string;
  crown: string;
  litEdge: string;
  shadeEdge: string;
  neonEdge: string;
  neonCore: string;
  roofAccent: string;
};

export const ARCH_PALETTES: Record<MetroBuilding["archStyle"], readonly ArchPalette[]> = {
  glassTower: [
    {
      podium: "#0a0e14",
      mid: "#101622",
      crown: "#161f30",
      litEdge: "#1f304d",
      shadeEdge: "#04060a",
      neonEdge: "#ff7b1a",
      neonCore: "#ffbe55",
      roofAccent: "#ff8c29",
    },
    {
      podium: "#080c14",
      mid: "#0d1420",
      crown: "#131d2e",
      litEdge: "#1a2c47",
      shadeEdge: "#030508",
      neonEdge: "#ff922b",
      neonCore: "#ffd685",
      roofAccent: "#ffa94d",
    },
  ],
  artDecoSetback: [
    {
      podium: "#0c0a0c",
      mid: "#141014",
      crown: "#1c161d",
      litEdge: "#2b202c",
      shadeEdge: "#050305",
      neonEdge: "#ff5e1a",
      neonCore: "#ffaa4d",
      roofAccent: "#ff7426",
    },
    {
      podium: "#0d0b09",
      mid: "#16110d",
      crown: "#1f1813",
      litEdge: "#2e231b",
      shadeEdge: "#050403",
      neonEdge: "#ff6d1f",
      neonCore: "#ffbe55",
      roofAccent: "#ff8c33",
    },
  ],
  cyberArcology: [
    {
      podium: "#080a12",
      mid: "#0d111c",
      crown: "#141928",
      litEdge: "#1c253d",
      shadeEdge: "#030408",
      neonEdge: "#ff852b",
      neonCore: "#ffcf70",
      roofAccent: "#ff9933",
    },
    {
      podium: "#0a0812",
      mid: "#100d1c",
      crown: "#18142a",
      litEdge: "#221c3d",
      shadeEdge: "#040308",
      neonEdge: "#ff5424",
      neonCore: "#ffa066",
      roofAccent: "#ff6e38",
    },
  ],
  foundryComplex: [
    {
      podium: "#0f0806",
      mid: "#170c0a",
      crown: "#22110d",
      litEdge: "#331812",
      shadeEdge: "#050202",
      neonEdge: "#ff4d12",
      neonCore: "#ff9047",
      roofAccent: "#ff6122",
    },
    {
      podium: "#0e0906",
      mid: "#160e0a",
      crown: "#20140e",
      litEdge: "#2f1e14",
      shadeEdge: "#050302",
      neonEdge: "#ff5e1a",
      neonCore: "#ffaa4d",
      roofAccent: "#ff7426",
    },
  ],
  solarTerrace: [
    {
      podium: "#090d12",
      mid: "#0e141c",
      crown: "#141d28",
      litEdge: "#1b2838",
      shadeEdge: "#030508",
      neonEdge: "#ff7426",
      neonCore: "#ffbe55",
      roofAccent: "#ff8c33",
    },
    {
      podium: "#070b10",
      mid: "#0c111a",
      crown: "#121926",
      litEdge: "#182336",
      shadeEdge: "#020406",
      neonEdge: "#ff802b",
      neonCore: "#ffc96b",
      roofAccent: "#ff9938",
    },
  ],
  civicDome: [
    {
      podium: "#080c10",
      mid: "#0d131a",
      crown: "#131b24",
      litEdge: "#1a2533",
      shadeEdge: "#030406",
      neonEdge: "#ff8c2b",
      neonCore: "#ffd685",
      roofAccent: "#ffa242",
    },
  ],
  homestead: [
    { podium: "#8c3a2a", mid: "#a8432f", crown: "#c45a42", litEdge: "#d8765a", shadeEdge: "#3a1410", neonEdge: "#ffbe55", neonCore: "#ffbe55", roofAccent: "#ffe9a8" },
    { podium: "#4a505d", mid: "#5b6372", crown: "#6f7889", litEdge: "#8d97a8", shadeEdge: "#1c2027", neonEdge: "#ffbe55", neonCore: "#ffbe55", roofAccent: "#ffe9a8" },
    { podium: "#7a5436", mid: "#8f6442", crown: "#a87a52", litEdge: "#c49468", shadeEdge: "#2c1c10", neonEdge: "#ffbe55", neonCore: "#ffbe55", roofAccent: "#ffe9a8" },
  ],
  barn: [
    { podium: "#8e2c22", mid: "#ad3528", crown: "#c64534", litEdge: "#f2e8d8", shadeEdge: "#3a100c", neonEdge: "#ffbe55", neonCore: "#ffbe55", roofAccent: "#f2e8d8" },
  ],
};

/** Returns the elevation in world pixels for `floors` under `mode`. */
export function floorsToElevation(floors: number, mode: BuildingHeightMode = "full"): number {
  if (mode === "flat" || floors <= 0) return 0;
  const full = Math.min(MAX_ELEVATION_PX, Math.max(1, Math.ceil(floors / FLOORS_PER_PIXEL)));
  return mode === "low" ? Math.max(1, Math.ceil(full * 0.5)) : full;
}

/** Returns the elevation in world pixels of a metropolitan building under `mode`. */
export function elevationOf(b: Pick<MetroBuilding, "height">, mode: BuildingHeightMode = "full"): number {
  return floorsToElevation(b.height, mode);
}

/** Projects a footprint ground `y` coordinate upward by `elevation` world pixels. */
export function projectRoofY(y: number, elevation: number): number {
  return y - elevation;
}

/** Setback tier elevation for cell `(x, y)` inside building `b` with full elevation `baseElev`.
 * Stepped skyscrapers (`artDecoSetback`, `solarTerrace`, or tall skyscrapers) raise inner
 * setback rings higher than outer podiums so steps read as terraces. */
export function cellTierElevation(
  b: MetroBuilding,
  x: number,
  y: number,
  baseElev: number,
): number {
  if (baseElev <= 2) return baseElev;
  const lx = x - b.x;
  const ly = y - b.y;
  const right = b.x + b.w - 1 - x;
  const bottom = b.y + b.h - 1 - y;
  const inset = Math.min(lx, ly, right, bottom);
  const stepped =
    b.archStyle === "artDecoSetback" ||
    b.archStyle === "solarTerrace" ||
    (b.isSkyscraper && baseElev >= 6);
  if (!stepped) return baseElev;
  if (inset >= pixels(2)) return baseElev;
  if (inset >= pixels(1)) return Math.max(2, Math.ceil(baseElev * 0.78));
  return Math.max(1, Math.ceil(baseElev * 0.56));
}

export type BuildingPixelRun = {
  /** Offset from building `b.x` (`0 .. b.w - 1`). */
  dx: number;
  /** Offset from building `b.y - maxElev` (`0 .. b.h + maxElev - 1`). */
  dy: number;
  /** Horizontal run length in whole pixels (`1 .. b.w`). */
  w: number;
  color: string;
};

export type CachedBuildingSprite = {
  id: number;
  signature: number;
  x: number;
  y: number;
  w: number;
  h: number;
  maxElev: number;
  bottomY: number;
  intactCount: number;
  /** Offscreen canvas holding the whole-pixel roof and south facade (drawn in 1 `drawImage` call). */
  canvas: HTMLCanvasElement | null;
  /** Horizontal pixel runs for non-DOM unit tests and dithered occlusion fade. */
  runs: BuildingPixelRun[];
  /** Individual pixel coords for whole-pixel dithered occlusion fade. */
  ops: { dx: number; dy: number; color: string }[];
  /** Occupied pixel mask of size `w * (h + maxElev)` for instant roof/facade hit-testing. */
  hitMask: Uint8Array;
};

/** Computes a deterministic version signature for building `b` so its cached sprite
 * rebuilds only when footprint cells, HP damage tier, development, or height mode change. */
export function computeBuildingSignature(
  world: VoidWorld,
  b: MetroBuilding,
  mode: BuildingHeightMode,
): number {
  let h = hash(b.id, Math.round(b.development * 20), mode === "full" ? 2 : mode === "low" ? 1 : 0);
  const { material, buildingAt, hp, maxHp } = world;
  for (let i = 0; i < b.cells.length; i++) {
    const idx = b.cells[i];
    if (buildingAt[idx] !== b.id || material[idx] === CellMaterial.VOID) {
      h = Math.imul(h ^ (i + 17), 0x01000193) >>> 0;
      continue;
    }
    const ratio = maxHp[idx] > 0 ? hp[idx] / maxHp[idx] : 1;
    const dmg = ratio <= 0.3 ? 3 : ratio < 0.4 ? 2 : ratio < 0.75 ? 1 : 0;
    h = Math.imul(h ^ ((idx << 2) | dmg), 0x5bd1e995) >>> 0;
  }
  return h >>> 0;
}

/** Paints the roof pixel color for cell `(x, y)` of building `b` (matches native roof palette). */
export function roofColorAt(
  world: VoidWorld,
  b: MetroBuilding,
  x: number,
  y: number,
  idx: number,
  pal: ArchPalette,
): string {
  const { w, h } = world.grid;
  const r = hash01(world.seed, 951, x, y);
  const hp = world.maxHp[idx] ? world.hp[idx] / world.maxHp[idx] : 1;
  const lx = x - b.x;
  const ly = y - b.y;
  const right = b.x + b.w - 1 - x;
  const bottom = b.y + b.h - 1 - y;
  const inset = Math.min(lx, ly, right, bottom);
  const cx = Math.floor(b.x + b.w / 2);
  const cy = Math.floor(b.y + b.h / 2);
  let color: string;

  if (b.archStyle === "homestead" || b.archStyle === "barn") {
    const horizontal = b.w >= b.h;
    color = (horizontal ? y < cy : x < cx) ? pal.crown : pal.podium;
    if (horizontal ? y === cy : x === cx) color = pal.litEdge;
    if (right === 0 || bottom === 0) color = pal.shadeEdge;
    if (lx === 1 && ly === 1) color = "#3a3a3a";
    if (right === 1 && bottom === 1 && hp > 0.3) color = pal.neonCore;
  } else {
    color = inset >= pixels(2) ? pal.crown : inset >= pixels(1) ? pal.mid : pal.podium;
    const edge =
      x === 0 ||
      y === 0 ||
      x + 1 === w ||
      y + 1 === h ||
      world.buildingAt[idx - 1] !== b.id ||
      world.buildingAt[idx + 1] !== b.id ||
      world.buildingAt[idx - w] !== b.id ||
      world.buildingAt[idx + w] !== b.id;
    if (edge) color = (x + y) % 4 === 0 ? pal.neonCore : pal.neonEdge;
    else if (inset === pixels(1) && Math.min(b.w, b.h) >= pixels(4)) color = pal.neonEdge;
    else if (x === cx || y === cy) color = pal.roofAccent;

    if (inset >= pixels(1)) {
      const dx = x - cx;
      const dy = y - cy;
      if (b.roofFeature === "helipad" && Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
        color = Math.abs(dx) === 2 || dy === 0 ? "#ffd166" : pal.crown;
      } else if (b.roofFeature === "skyGarden" && (lx + ly) % 3 !== 0) color = "#357542";
      else if (b.roofFeature === "solarArray" && ly % 3 === 0) color = "#48a8dc";
      else if (dx === 0 && dy === 0) color = "#ffffff";
    }
    if (b.development > 1.05 && inset === 0 && (x + y) % 3 === 0) color = pal.neonCore;
  }

  if (hp < 0.4) color = r < 0.3 ? "#ff42b8" : "#12091c";
  else if (hp < 0.75 && r < 0.35) color = "#ff8c29";
  return color;
}

/** Paints a whole-pixel south facade pixel for column `x` at facade row `fRow` (`0` = ground lobby, `elev - 1` = top floor under roof). */
export function facadeColorAt(
  world: VoidWorld,
  b: MetroBuilding,
  x: number,
  yFoot: number,
  fRow: number,
  elev: number,
  isSideBorder: boolean,
  hpRatio: number,
  pal: ArchPalette,
): string {
  if (hpRatio < 0.4 && hash01(world.seed, 962, x, yFoot, fRow) < 0.28) {
    return "#ff42b8";
  }
  // 1-px darker edge column on east/west sides suggests 3D volume
  if (isSideBorder) {
    return pal.shadeEdge;
  }
  // Base lobby / awning row at ground level
  if (fRow === 0) {
    return (x + b.variant) % 4 === 0 && hpRatio > 0.35 ? pal.neonEdge : pal.shadeEdge;
  }
  if (b.archStyle === "homestead" || b.archStyle === "barn") {
    return (x + fRow) % 3 === 0 && hpRatio > 0.3 ? pal.neonCore : pal.podium;
  }
  // Neon cornice band right under a setback terrace or crown
  if (fRow === elev - 1 && (b.archStyle === "cyberArcology" || b.archStyle === "artDecoSetback")) {
    return (x + b.id) % 3 === 0 ? pal.neonCore : pal.neonEdge;
  }
  // Window columns every 2 px
  const lx = x - b.x;
  const isWindowCol = lx % 2 === 1;
  if (isWindowCol) {
    const litRoll = hash01(world.seed, 965, b.id, lx, fRow);
    if (litRoll < 0.42 && hpRatio > 0.3) {
      return litRoll < 0.14 ? pal.neonCore : pal.litEdge;
    }
    return pal.podium;
  }
  return fRow % 2 === 0 ? pal.mid : pal.podium;
}

/** Builds the whole-pixel elevated sprite (south facades, setback terraces, and roofs) for `b`. */
export function buildBuildingSprite(
  world: VoidWorld,
  b: MetroBuilding,
  mode: BuildingHeightMode,
  signature: number,
): CachedBuildingSprite {
  const maxElev = elevationOf(b, mode);
  const spriteW = b.w;
  const spriteH = b.h + maxElev;
  const colorBuf = new Array<string | null>(spriteW * spriteH).fill(null);
  const hitMask = new Uint8Array(spriteW * spriteH);
  const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
  const pal = palettes[b.variant % palettes.length];
  const { w } = world.grid;

  let intactCount = 0;
  let bottomY = b.y;

  // Sort cells top-to-bottom (`y` ascending) so painter's order inside a multi-tier building
  // naturally lets southern (lower-screen) columns and facades paint over northern ones.
  const intactCells: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const idx = b.cells[i];
    if (world.buildingAt[idx] === b.id && world.material[idx] !== CellMaterial.VOID && world.hp[idx] > 0) {
      intactCells.push(idx);
      const cy = (idx / w) | 0;
      if (cy + 1 > bottomY) bottomY = cy + 1;
    }
  }
  intactCount = intactCells.length;

  if (intactCount === 0) {
    return {
      id: b.id,
      signature,
      x: b.x,
      y: b.y - maxElev,
      w: spriteW,
      h: spriteH,
      maxElev,
      bottomY: b.y + b.h,
      intactCount: 0,
      canvas: null,
      runs: [],
      ops: [],
      hitMask,
    };
  }

  // Track per-footprint-cell tier elevation so we know where a south face or setback step is exposed
  const cellElev = new Int8Array(b.w * b.h).fill(0);
  for (let i = 0; i < intactCells.length; i++) {
    const idx = intactCells[i];
    const cx = idx % w;
    const cy = (idx / w) | 0;
    const lx = cx - b.x;
    const ly = cy - b.y;
    if (lx >= 0 && lx < b.w && ly >= 0 && ly < b.h) {
      cellElev[ly * b.w + lx] = cellTierElevation(b, cx, cy, maxElev);
    }
  }

  // Paint row by row from north (`ly = 0`) to south (`ly = b.h - 1`)
  for (let ly = 0; ly < b.h; ly++) {
    const cy = b.y + ly;
    for (let lx = 0; lx < b.w; lx++) {
      const elev = cellElev[ly * b.w + lx];
      if (elev === 0 && mode !== "flat") continue;
      const cx = b.x + lx;
      const idx = cy * w + cx;
      if (world.buildingAt[idx] !== b.id || world.material[idx] === CellMaterial.VOID || world.hp[idx] <= 0) {
        continue;
      }

      const southElev = ly + 1 < b.h ? cellElev[(ly + 1) * b.w + lx] : 0;
      const westElev = lx > 0 ? cellElev[ly * b.w + (lx - 1)] : 0;
      const eastElev = lx + 1 < b.w ? cellElev[ly * b.w + (lx + 1)] : 0;
      const hpRatio = world.maxHp[idx] > 0 ? world.hp[idx] / world.maxHp[idx] : 1;

      // 1. South facade where this column is taller than the cell immediately south of it
      if (elev > southElev) {
        for (let f = southElev; f < elev; f++) {
          const sy = ly + maxElev - f;
          if (sy < 0 || sy >= spriteH) continue;
          const isSideBorder = f >= westElev || f >= eastElev;
          const fCol = facadeColorAt(world, b, cx, cy, f, elev, isSideBorder, hpRatio, pal);
          const pIdx = sy * spriteW + lx;
          colorBuf[pIdx] = fCol;
          hitMask[pIdx] = 1;
        }
      }

      // 2. Roof pixel shifted up by `elev`
      const roofSy = ly + maxElev - elev;
      if (roofSy >= 0 && roofSy < spriteH) {
        const rCol = roofColorAt(world, b, cx, cy, idx, pal);
        const pIdx = roofSy * spriteW + lx;
        colorBuf[pIdx] = rCol;
        hitMask[pIdx] = 1;
      }
    }
  }

  const runs: BuildingPixelRun[] = [];
  const ops: { dx: number; dy: number; color: string }[] = [];
  for (let dy = 0; dy < spriteH; dy++) {
    let runStart = -1;
    let runColor = "";
    for (let dx = 0; dx < spriteW; dx++) {
      const col = colorBuf[dy * spriteW + dx];
      if (col !== null) {
        ops.push({ dx, dy, color: col });
        if (col === runColor) {
          continue;
        }
        if (runStart >= 0) {
          runs.push({ dx: runStart, dy, w: dx - runStart, color: runColor });
        }
        runStart = dx;
        runColor = col;
      } else if (runStart >= 0) {
        runs.push({ dx: runStart, dy, w: dx - runStart, color: runColor });
        runStart = -1;
        runColor = "";
      }
    }
    if (runStart >= 0) {
      runs.push({ dx: runStart, dy, w: spriteW - runStart, color: runColor });
    }
  }

  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const el = document.createElement("canvas");
    el.width = spriteW;
    el.height = spriteH;
    const ctx = el.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        ctx.fillStyle = r.color;
        ctx.fillRect(r.dx, r.dy, r.w, 1);
      }
      canvas = el;
    }
  }

  return {
    id: b.id,
    signature,
    x: b.x,
    y: b.y - maxElev,
    w: spriteW,
    h: spriteH,
    maxElev,
    bottomY,
    intactCount,
    canvas,
    runs,
    ops,
    hitMask,
  };
}

export class BuildingSpriteCache {
  private cachedWorld: VoidWorld | null = null;
  private cachedMode: BuildingHeightMode = "full";
  private readonly sprites = new Map<number, CachedBuildingSprite>();
  private atlasCanvas: HTMLCanvasElement | null = null;
  private atlasCtx: CanvasRenderingContext2D | null = null;
  private readonly dirtyIds = new Set<number>();

  getSprite(
    world: VoidWorld,
    b: MetroBuilding,
    mode: BuildingHeightMode,
    forceCheck = true,
  ): CachedBuildingSprite {
    if (this.cachedWorld !== world || this.cachedMode !== mode) {
      this.cachedWorld = world;
      this.cachedMode = mode;
      this.sprites.clear();
      this.atlasCanvas = null;
      this.atlasCtx = null;
      this.dirtyIds.clear();
    }
    const existing = this.sprites.get(b.id);
    if (existing && !forceCheck) {
      return existing;
    }
    const sig = computeBuildingSignature(world, b, mode);
    if (existing && existing.signature === sig) {
      return existing;
    }
    const built = buildBuildingSprite(world, b, mode, sig);
    this.sprites.set(b.id, built);
    this.dirtyIds.add(b.id);
    return built;
  }

  /** Returns a full-board cached canvas containing all buildings sorted back-to-front.
   * Re-checks signatures only for buildings overlapping dirtied 16x16 terrain chunks. */
  getBoardAtlas(
    world: VoidWorld,
    mode: BuildingHeightMode,
    dirtyChunkFlags?: Uint8Array,
  ): HTMLCanvasElement | null {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    const { w, h, chunksW } = world.grid;
    let rebuildAll = false;
    if (
      this.cachedWorld !== world ||
      this.cachedMode !== mode ||
      !this.atlasCanvas ||
      this.atlasCanvas.width !== w ||
      this.atlasCanvas.height !== h
    ) {
      this.cachedWorld = world;
      this.cachedMode = mode;
      this.sprites.clear();
      this.dirtyIds.clear();
      const el = this.atlasCanvas ?? document.createElement("canvas");
      el.width = w;
      el.height = h;
      this.atlasCanvas = el;
      this.atlasCtx = el.getContext("2d");
      rebuildAll = true;
    }

    const CHUNK = 16;
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i];
      let needsCheck = rebuildAll || !this.sprites.has(b.id);
      if (!needsCheck && dirtyChunkFlags) {
        const cx0 = (b.x / CHUNK) | 0;
        const cx1 = ((b.x + b.w - 1) / CHUNK) | 0;
        const cy0 = (b.y / CHUNK) | 0;
        const cy1 = ((b.y + b.h - 1) / CHUNK) | 0;
        outer: for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            if (dirtyChunkFlags[cy * chunksW + cx]) {
              needsCheck = true;
              break outer;
            }
          }
        }
      } else if (!dirtyChunkFlags) {
        needsCheck = true;
      }
      if (needsCheck) {
        this.getSprite(world, b, mode, true);
      }
    }

    if (!rebuildAll && this.dirtyIds.size === 0) {
      return this.atlasCanvas;
    }

    const ctx = this.atlasCtx;
    if (!ctx || !this.atlasCanvas) return null;
    ctx.imageSmoothingEnabled = false;
    // Incrementally repaint only the bounding box of dirty sprites when < 24 buildings changed
    let rx0 = 0;
    let ry0 = 0;
    let rx1 = w;
    let ry1 = h;
    if (!rebuildAll && this.dirtyIds.size <= 24) {
      rx0 = w;
      ry0 = h;
      rx1 = 0;
      ry1 = 0;
      for (const id of this.dirtyIds) {
        const sp = this.sprites.get(id);
        if (sp) {
          if (sp.x < rx0) rx0 = Math.max(0, sp.x);
          if (sp.y < ry0) ry0 = Math.max(0, sp.y);
          if (sp.x + sp.w > rx1) rx1 = Math.min(w, sp.x + sp.w);
          if (sp.y + sp.h > ry1) ry1 = Math.min(h, sp.y + sp.h);
        }
      }
      if (rx1 <= rx0 || ry1 <= ry0) {
        this.dirtyIds.clear();
        return this.atlasCanvas;
      }
    }

    ctx.save();
    if (rx0 > 0 || ry0 > 0 || rx1 < w || ry1 < h) {
      ctx.beginPath();
      ctx.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.clip();
    }
    ctx.clearRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

    // Sort intact sprites overlapping `[rx0..rx1, ry0..ry1]` back-to-front by bottomY then x
    const sorted: CachedBuildingSprite[] = [];
    for (let i = 0; i < world.buildings.length; i++) {
      const sp = this.sprites.get(world.buildings[i].id);
      if (
        sp &&
        sp.intactCount > 0 &&
        sp.x + sp.w > rx0 &&
        sp.x < rx1 &&
        sp.y + sp.h > ry0 &&
        sp.y < ry1
      ) {
        sorted.push(sp);
      }
    }
    sorted.sort((a, b) => a.bottomY - b.bottomY || a.x - b.x);

    for (let i = 0; i < sorted.length; i++) {
      const sp = sorted[i];
      if (sp.canvas) {
        ctx.drawImage(sp.canvas, sp.x, sp.y);
      } else {
        for (let k = 0; k < sp.runs.length; k++) {
          const r = sp.runs[k];
          ctx.fillStyle = r.color;
          ctx.fillRect(sp.x + r.dx, sp.y + r.dy, r.w, 1);
        }
      }
    }
    ctx.restore();

    this.dirtyIds.clear();
    return this.atlasCanvas;
  }

  /** Picks the topmost visible structure (tower or elevated building roof/facade) at world pixel `(wx, wy)`.
   * Checks front-to-back (highest `bottomY` first) so overlapping roofs resolve accurately. */
  pickStructureAt(
    world: VoidWorld,
    towers: readonly PlacedTower[],
    wx: number,
    wy: number,
    mode: BuildingHeightMode,
  ): { kind: "tower"; uid: number } | { kind: "building"; id: number } | null {
    const px = Math.floor(wx);
    const py = Math.floor(wy);
    const tElev = mode === "flat" ? 0 : mode === "low" ? 1 : TOWER_ELEVATION_PX;

    // Gather candidate towers and buildings sorted front-to-back (descending bottomY, then descending x)
    let bestTower: PlacedTower | null = null;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (px >= t.x && px < t.x + t.w && py >= t.y - tElev && py < t.y + t.h) {
        if (!bestTower || t.y + t.h >= bestTower.y + bestTower.h) {
          bestTower = t;
        }
      }
    }
    if (bestTower) {
      return { kind: "tower", uid: bestTower.uid };
    }

    let bestBuilding: CachedBuildingSprite | null = null;
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i];
      const sp = this.getSprite(world, b, mode);
      if (sp.intactCount === 0) continue;
      const dx = px - sp.x;
      const dy = py - sp.y;
      if (dx < 0 || dx >= sp.w || dy < 0 || dy >= sp.h) continue;
      if (sp.hitMask[dy * sp.w + dx]) {
        if (
          !bestBuilding ||
          sp.bottomY > bestBuilding.bottomY ||
          (sp.bottomY === bestBuilding.bottomY && sp.x > bestBuilding.x)
        ) {
          bestBuilding = sp;
        }
      }
    }
    if (bestBuilding) {
      return { kind: "building", id: bestBuilding.id };
    }
    return null;
  }
}
