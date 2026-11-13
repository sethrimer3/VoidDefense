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
      podium: "#2a3545",
      mid: "#364459",
      crown: "#475973",
      litEdge: "#6882a6",
      shadeEdge: "#171e29",
      neonEdge: "#c98038",
      neonCore: "#e8be72",
      roofAccent: "#566b8a",
    },
    {
      podium: "#253142",
      mid: "#314157",
      crown: "#415673",
      litEdge: "#617ea6",
      shadeEdge: "#141b26",
      neonEdge: "#c98642",
      neonCore: "#edd08c",
      roofAccent: "#50698a",
    },
  ],
  artDecoSetback: [
    {
      podium: "#3d342e",
      mid: "#4f433b",
      crown: "#63544a",
      litEdge: "#857265",
      shadeEdge: "#211c18",
      neonEdge: "#bf7839",
      neonCore: "#e6b86e",
      roofAccent: "#736256",
    },
    {
      podium: "#42382f",
      mid: "#54473c",
      crown: "#69594b",
      litEdge: "#8c7866",
      shadeEdge: "#241e19",
      neonEdge: "#c47e3d",
      neonCore: "#ecc47d",
      roofAccent: "#7a6858",
    },
  ],
  cyberArcology: [
    {
      podium: "#272d3b",
      mid: "#333b4d",
      crown: "#424d63",
      litEdge: "#5f6e8c",
      shadeEdge: "#141821",
      neonEdge: "#c47739",
      neonCore: "#e6b065",
      roofAccent: "#505d78",
    },
    {
      podium: "#2d2a3d",
      mid: "#3a374f",
      crown: "#4a4663",
      litEdge: "#69648a",
      shadeEdge: "#181621",
      neonEdge: "#bf6843",
      neonCore: "#e3a174",
      roofAccent: "#595475",
    },
  ],
  foundryComplex: [
    {
      podium: "#3d2924",
      mid: "#4f352e",
      crown: "#63433b",
      litEdge: "#825a4f",
      shadeEdge: "#211512",
      neonEdge: "#cf692d",
      neonCore: "#eb9f5b",
      roofAccent: "#734e44",
    },
    {
      podium: "#3b2c23",
      mid: "#4d392d",
      crown: "#614839",
      litEdge: "#80604d",
      shadeEdge: "#1f1712",
      neonEdge: "#c97434",
      neonCore: "#e8ac64",
      roofAccent: "#705342",
    },
  ],
  solarTerrace: [
    {
      podium: "#2c3740",
      mid: "#394752",
      crown: "#495b69",
      litEdge: "#688094",
      shadeEdge: "#171e24",
      neonEdge: "#c47e3d",
      neonCore: "#e6b86e",
      roofAccent: "#586d7d",
    },
    {
      podium: "#28333d",
      mid: "#34424f",
      crown: "#445666",
      litEdge: "#627b91",
      shadeEdge: "#151b21",
      neonEdge: "#c78642",
      neonCore: "#ebc37a",
      roofAccent: "#52687a",
    },
  ],
  civicDome: [
    {
      podium: "#363e47",
      mid: "#46505c",
      crown: "#596675",
      litEdge: "#7a8b9e",
      shadeEdge: "#1b2026",
      neonEdge: "#c98b3e",
      neonCore: "#edd084",
      roofAccent: "#69798a",
    },
  ],
  homestead: [
    { podium: "#8c3a2a", mid: "#a8432f", crown: "#c45a42", litEdge: "#d8765a", shadeEdge: "#3a1410", neonEdge: "#e09c48", neonCore: "#f2ca79", roofAccent: "#ffe9a8" },
    { podium: "#4a505d", mid: "#5b6372", crown: "#6f7889", litEdge: "#8d97a8", shadeEdge: "#1c2027", neonEdge: "#e09c48", neonCore: "#f2ca79", roofAccent: "#ffe9a8" },
    { podium: "#7a5436", mid: "#8f6442", crown: "#a87a52", litEdge: "#c49468", shadeEdge: "#2c1c10", neonEdge: "#e09c48", neonCore: "#f2ca79", roofAccent: "#ffe9a8" },
  ],
  barn: [
    { podium: "#8e2c22", mid: "#ad3528", crown: "#c64534", litEdge: "#f2e8d8", shadeEdge: "#3a100c", neonEdge: "#e09c48", neonCore: "#f2ca79", roofAccent: "#f2e8d8" },
  ],
};

/** Returns the elevation in world pixels for `floors` under `mode`. */
export function floorsToElevation(floors: number, mode: BuildingHeightMode = "full"): number {
  if (mode === "flat" || floors <= 0) return 0;
  const full = Math.min(MAX_ELEVATION_PX, Math.max(1, Math.ceil(floors / FLOORS_PER_PIXEL)));
  return mode === "low" ? Math.max(1, Math.ceil(full * 0.5)) : full;
}

/** Returns the elevation in world pixels of a metropolitan building under `mode`. */
export function elevationOf(b: Pick<MetroBuilding, "height"> & Partial<Pick<MetroBuilding, "archStyle">>, mode: BuildingHeightMode = "full"): number {
  const rustic = b.archStyle === "homestead" || b.archStyle === "barn";
  return rustic && mode !== "flat" ? Math.max(mode === "low" ? 1 : 2, floorsToElevation(b.height, mode)) : floorsToElevation(b.height, mode);
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
 * rebuilds only when footprint cells, columnFloors, HP damage tier, development, or height mode change. */
export function computeBuildingSignature(
  world: VoidWorld,
  b: MetroBuilding,
  mode: BuildingHeightMode,
): number {
  let h = hash(b.id, Math.round(b.development * 20), mode === "full" ? 2 : mode === "low" ? 1 : 0);
  const { material, buildingAt, hp, maxHp, columnFloors } = world;
  for (let i = 0; i < b.cells.length; i++) {
    const idx = b.cells[i];
    const floors = columnFloors ? columnFloors[idx] : b.height;
    const supported = buildingAt[idx] === b.id && material[idx] !== CellMaterial.VOID && hp[idx] > 0;
    if (!supported && floors === 0) {
      h = Math.imul(h ^ (i + 17), 0x01000193) >>> 0;
      continue;
    }
    const ratio = supported && maxHp[idx] > 0 ? hp[idx] / maxHp[idx] : 0.25;
    const dmg = ratio <= 0.3 ? 3 : ratio < 0.4 ? 2 : ratio < 0.75 ? 1 : 0;
    h = Math.imul(h ^ ((idx << 7) ^ (floors << 2) ^ dmg), 0x5bd1e995) >>> 0;
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
    if ((horizontal ? y : x) % 2 === 0) color = (horizontal ? y < cy : x < cx) ? pal.crown : pal.mid;
    if (horizontal ? y === cy : x === cx) color = pal.litEdge;
    if (right === 0 || bottom === 0) color = pal.shadeEdge;
    if (lx === 1 && ly === 1) color = "#3a3a3a";
    if (right === 1 && bottom === 1 && hp > 0.3) color = pal.neonCore;
  } else {
    color = inset >= pixels(2) ? pal.crown : inset >= pixels(1) ? pal.mid : pal.podium;
    const nEdge = y === 0 || world.buildingAt[idx - w] !== b.id;
    const wEdge = x === 0 || world.buildingAt[idx - 1] !== b.id;
    const sEdge = y + 1 === h || world.buildingAt[idx + w] !== b.id;
    const eEdge = x + 1 === w || world.buildingAt[idx + 1] !== b.id;

    // Sunlit north/west parapet bevel vs shaded south/east rim for crisp 2.5D massing
    if (sEdge || eEdge) color = pal.shadeEdge;
    else if (nEdge || wEdge) color = pal.litEdge;
    else if (inset === pixels(1) && Math.min(b.w, b.h) >= pixels(4)) color = pal.roofAccent;

    if (inset >= pixels(1)) {
      const dx = x - cx;
      const dy = y - cy;
      if (b.roofFeature === "helipad" && Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
        color = Math.abs(dx) === 2 || dy === 0 ? "#d9b252" : pal.mid;
      } else if (b.roofFeature === "skyGarden" && (lx + ly) % 3 !== 0) color = "#3b6e42";
      else if (b.roofFeature === "solarArray" && ly % 3 === 0) color = "#437ea6";
      else if (dx === 0 && dy === 0) color = pal.litEdge;
      else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (lx + ly) % 2 === 0) color = pal.roofAccent;
    }
    // Restrained rooftop beacon/mechanical accent on developed towers
    if (b.development > 1.05 && lx === 1 && ly === 1) color = pal.neonCore;
  }

  if (hp < 0.4) color = r < 0.18 ? "#8c38d4" : "#221a24";
  else if (hp < 0.75 && r < 0.22) color = "#4a3b30";
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
  if (hpRatio < 0.4 && hash01(world.seed, 962, x, yFoot, fRow) < 0.18) {
    return "#8c38d4";
  }
  // 1-px darker edge column on east/west sides suggests 3D volume
  if (isSideBorder) {
    return pal.shadeEdge;
  }
  if (b.archStyle === "homestead" || b.archStyle === "barn") {
    const lx = x - b.x;
    if (lx === Math.floor(b.w / 2) && fRow === 0) return "#503a2b";
    if (lx % 3 === 1) return hpRatio > 0.35 ? "#f7d58c" : "#4a3327";
    return b.archStyle === "barn" ? (lx % 2 === 0 ? "#a04b38" : "#803b2e") : "#ddc8a0";
  }
  // Base lobby / awning row at ground level
  if (fRow === 0) {
    return (x + b.variant) % 5 === 0 && hpRatio > 0.35 ? pal.neonEdge : pal.shadeEdge;
  }
  // Subtle cornice band right under a setback terrace or crown
  if (fRow === elev - 1 && (b.archStyle === "cyberArcology" || b.archStyle === "artDecoSetback")) {
    return pal.litEdge;
  }
  // Window columns every 2 px
  const lx = x - b.x;
  const isWindowCol = lx % 2 === 1;
  if (isWindowCol) {
    const litRoll = hash01(world.seed, 965, b.id, lx, fRow);
    if (litRoll < 0.24 && hpRatio > 0.3) {
      return litRoll < 0.08 ? pal.neonCore : pal.litEdge;
    }
    return pal.shadeEdge;
  }
  return fRow % 2 === 0 ? pal.mid : pal.podium;
}

/** Paints an exposed interior cutaway pixel for column `(x, yFoot)` at elevation row `fRow`
 * when a column has lost upper stories (`columnFloors < b.height`) or its south neighbor collapsed:
 * - Concrete floor slab line (`#5c6574` / `#4a525e`) every 2nd vertical pixel
 * - Interior room bays (`#161b26` unlit, `#ffbe55` / `#ffd685` lit, `#48e5ff` furniture/conduit accent)
 * - Dark broken rebar edge (`#07090e`) on ragged perimeter columns
 * - Faint violet Void rim (`#b23fe6`) only on the lowest row (`fRow === 0`) facing Void */
export function cutawayColorAt(
  world: VoidWorld,
  b: MetroBuilding,
  x: number,
  yFoot: number,
  fRow: number,
  _elev: number,
  isBrokenEdge: boolean,
  adjVoid: boolean,
  pal: ArchPalette,
): string {
  if (adjVoid && fRow === 0 && ((x + yFoot) & 1) === 0) {
    return "#b23fe6";
  }
  if (isBrokenEdge) {
    return (fRow + x) % 3 === 0 ? "#3a414c" : "#07090e";
  }
  // Exposed horizontal concrete floor slab line every 2 elevation pixels
  if (fRow % 2 === 0) {
    return (x + yFoot) % 3 === 0 ? "#5c6574" : "#4a525e";
  }
  // Room interior between floor slabs (seeded by building id, column, and floor)
  const roomRoll = hash01(world.seed, 974, b.id, x - b.x, fRow);
  if (roomRoll < 0.28) {
    return roomRoll < 0.08 ? "#48e5ff" : pal.neonCore;
  }
  if (roomRoll < 0.56) {
    return "#2a3344";
  }
  return "#141923";
}

/** Builds the whole-pixel elevated sprite (south facades, setback terraces, cutaways, and roofs) for `b`. */
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
  const { w, h } = world.grid;
  const { columnFloors, buildingAt, material, hp, maxHp } = world;

  let intactCount = 0;
  let bottomY = b.y;

  // Include both ground-supported columns and cantilevered overhanging columns (`columnFloors[idx] > 0`)
  const activeCells: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const idx = b.cells[i];
    const supported = buildingAt[idx] === b.id && material[idx] !== CellMaterial.VOID && hp[idx] > 0;
    const floors = columnFloors ? columnFloors[idx] : supported ? b.height : 0;
    if (supported || (material[idx] === CellMaterial.VOID && floors > 0)) {
      activeCells.push(idx);
      const cy = (idx / w) | 0;
      if (cy + 1 > bottomY) bottomY = cy + 1;
    }
  }
  intactCount = activeCells.length;

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

  // Track per-footprint-cell current elevation and whether its original outer wall/roof was sheared off
  const cellElev = new Int8Array(b.w * b.h).fill(0);
  const cellFullElev = new Int8Array(b.w * b.h).fill(0);
  const cellIntactRoof = new Uint8Array(b.w * b.h);
  const cellPresent = new Uint8Array(b.w * b.h);

  for (let i = 0; i < b.cells.length; i++) {
    const idx = b.cells[i];
    const cx = idx % w;
    const cy = (idx / w) | 0;
    const lx = cx - b.x;
    const ly = cy - b.y;
    if (lx >= 0 && lx < b.w && ly >= 0 && ly < b.h) {
      cellFullElev[ly * b.w + lx] = cellTierElevation(b, cx, cy, maxElev);
    }
  }

  for (let i = 0; i < activeCells.length; i++) {
    const idx = activeCells[i];
    const cx = idx % w;
    const cy = (idx / w) | 0;
    const lx = cx - b.x;
    const ly = cy - b.y;
    if (lx >= 0 && lx < b.w && ly >= 0 && ly < b.h) {
      const fullTier = cellFullElev[ly * b.w + lx];
      const floors = columnFloors ? columnFloors[idx] : b.height;
      const curElev = Math.min(fullTier, elevationOf({ height: floors, archStyle: b.archStyle }, mode));
      cellElev[ly * b.w + lx] = curElev;
      cellPresent[ly * b.w + lx] = 1;
      if (floors >= b.height) {
        cellIntactRoof[ly * b.w + lx] = 1;
      }
    }
  }

  // Paint row by row from north (`ly = 0`) to south (`ly = b.h - 1`)
  for (let ly = 0; ly < b.h; ly++) {
    const cy = b.y + ly;
    for (let lx = 0; lx < b.w; lx++) {
      const localIdx = ly * b.w + lx;
      if (!cellPresent[localIdx]) continue;
      const elev = cellElev[localIdx];
      if (elev === 0 && mode !== "flat") continue;
      const cx = b.x + lx;
      const idx = cy * w + cx;

      const southElev = ly + 1 < b.h ? cellElev[(ly + 1) * b.w + lx] : 0;
      const southHadBuilding = ly + 1 < b.h && cellFullElev[(ly + 1) * b.w + lx] > 0;
      const southMissingOrSpalled =
        southHadBuilding && (ly + 1 < b.h ? cellElev[(ly + 1) * b.w + lx] < cellFullElev[(ly + 1) * b.w + lx] : false);
      const westElev = lx > 0 ? cellElev[ly * b.w + (lx - 1)] : 0;
      const eastElev = lx + 1 < b.w ? cellElev[ly * b.w + (lx + 1)] : 0;
      const hpRatio = maxHp[idx] > 0 ? hp[idx] / maxHp[idx] : 0.35;
      const spalledTop = !cellIntactRoof[localIdx];
      const isCutawayFace = spalledTop || southMissingOrSpalled || material[idx] === CellMaterial.VOID;
      const adjVoid =
        material[idx] === CellMaterial.VOID ||
        (cx > 0 && material[idx - 1] === CellMaterial.VOID) ||
        (cx + 1 < w && material[idx + 1] === CellMaterial.VOID) ||
        (cy > 0 && material[idx - w] === CellMaterial.VOID) ||
        (cy + 1 < h && material[idx + w] === CellMaterial.VOID);

      // 1. South facade or interior cutaway where this column is taller than the cell immediately south of it
      if (elev > southElev) {
        for (let f = southElev; f < elev; f++) {
          const sy = ly + maxElev - f;
          if (sy < 0 || sy >= spriteH) continue;
          const isSideBorder = f >= westElev || f >= eastElev;
          const fCol = isCutawayFace
            ? cutawayColorAt(world, b, cx, cy, f, elev, isSideBorder, adjVoid, pal)
            : facadeColorAt(world, b, cx, cy, f, elev, isSideBorder, hpRatio, pal);
          const pIdx = sy * spriteW + lx;
          colorBuf[pIdx] = fCol;
          hitMask[pIdx] = 1;
        }
      }

      // 2. Top pixel shifted up by `elev`: intact roof if unspalled, else exposed concrete floor slab / rubble cap
      const roofSy = ly + maxElev - elev;
      if (roofSy >= 0 && roofSy < spriteH) {
        const isOuterSpike =
          spalledTop &&
          (westElev === 0 || eastElev === 0) &&
          ((cx + cy) & 1) === 1;
        const rCol = spalledTop
          ? isOuterSpike
            ? "#07090e"
            : (cx + cy) % 3 === 0
              ? "#5c6574"
              : "#4a525e"
          : roofColorAt(world, b, cx, cy, idx, pal);
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

    const repaintRect = (rx0: number, ry0: number, rx1: number, ry1: number): void => {
      if (rx1 <= rx0 || ry1 <= ry0) return;
      ctx.save();
      if (rx0 > 0 || ry0 > 0 || rx1 < w || ry1 < h) {
        ctx.beginPath();
        ctx.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
        ctx.clip();
      }
      ctx.clearRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

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
    };

    // Incrementally repaint each dirty building's local region when <= 32 buildings changed
    // (avoids spanning a single giant bounding box across opposite sides of the board).
    if (!rebuildAll && this.dirtyIds.size <= 32) {
      for (const id of this.dirtyIds) {
        const sp = this.sprites.get(id);
        if (sp) {
          repaintRect(
            Math.max(0, sp.x),
            Math.max(0, sp.y),
            Math.min(w, sp.x + sp.w),
            Math.min(h, sp.y + sp.h),
          );
        }
      }
    } else {
      repaintRect(0, 0, w, h);
    }

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
