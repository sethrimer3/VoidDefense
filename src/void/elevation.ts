/** Oblique ¾-projection mathematics, per-building roof & south-facade sprite cache,
 * setback terrace tiering, and screen-to-structure hit testing for Void Defense. */

import { pixels } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import {
  CellMaterial,
  SurfaceMaterial,
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
      neonEdge: "#00c8ff",
      neonCore: "#7afcff",
      roofAccent: "#566b8a",
    },
    {
      podium: "#253142",
      mid: "#314157",
      crown: "#415673",
      litEdge: "#617ea6",
      shadeEdge: "#141b26",
      neonEdge: "#18d8ff",
      neonCore: "#8cf5ff",
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
      neonEdge: "#00c8ff",
      neonCore: "#7afcff",
      roofAccent: "#736256",
    },
    {
      podium: "#42382f",
      mid: "#54473c",
      crown: "#69594b",
      litEdge: "#8c7866",
      shadeEdge: "#241e19",
      neonEdge: "#18d8ff",
      neonCore: "#8cf5ff",
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
      neonEdge: "#00e5ff",
      neonCore: "#8cf5ff",
      roofAccent: "#505d78",
    },
    {
      podium: "#2d2a3d",
      mid: "#3a374f",
      crown: "#4a4663",
      litEdge: "#69648a",
      shadeEdge: "#181621",
      neonEdge: "#00d8ff",
      neonCore: "#7afcff",
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
      neonEdge: "#00c8ff",
      neonCore: "#7afcff",
      roofAccent: "#734e44",
    },
    {
      podium: "#3b2c23",
      mid: "#4d392d",
      crown: "#614839",
      litEdge: "#80604d",
      shadeEdge: "#1f1712",
      neonEdge: "#18d8ff",
      neonCore: "#8cf5ff",
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
      neonEdge: "#00c8ff",
      neonCore: "#7afcff",
      roofAccent: "#586d7d",
    },
    {
      podium: "#28333d",
      mid: "#34424f",
      crown: "#445666",
      litEdge: "#627b91",
      shadeEdge: "#151b21",
      neonEdge: "#18d8ff",
      neonCore: "#8cf5ff",
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
      neonEdge: "#00d8ff",
      neonCore: "#8cf5ff",
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

export type BuildingNeonTier = "landmark" | "lit" | "dark";

export type DistrictNeonAccent = {
  neonEdge: string;
  neonCore: string;
  lightRgb: readonly [number, number, number];
};

const landmarkIdsCache = new WeakMap<VoidWorld, Set<number>>();

/** Deterministically selects 3 hero landmark skyscrapers per map (well-spaced across the downtown/midtown skyline)
 * that receive the brightest, largest full-facade and crown neon signage. */
export function getLandmarkBuildingIds(world: VoidWorld): Set<number> {
  let cached = landmarkIdsCache.get(world);
  if (cached) return cached;
  const candidates = world.buildings
    .filter((b) => b.isSkyscraper && b.archStyle !== "homestead" && b.archStyle !== "barn" && b.w >= 8 && b.h >= 8 && b.cells.length > 0)
    .map((b) => ({
      b,
      score: b.height * 128 + b.w * 8 + (hash(world.seed, 911, b.id) & 63),
    }))
    .sort((a, b) => b.score - a.score || a.b.id - b.b.id);
  const chosen: MetroBuilding[] = [];
  for (const { b } of candidates) {
    if (chosen.some((o) => (o.x - b.x) ** 2 + (o.y - b.y) ** 2 < 46 ** 2)) continue;
    chosen.push(b);
    if (chosen.length >= 3) break;
  }
  cached = new Set(chosen.map((b) => b.id));
  landmarkIdsCache.set(world, cached);
  return cached;
}

/** Classifies a building's neon brightness tier for light restraint:
 * - `"landmark"`: 2–4 hero skyscrapers per map with the brightest, largest neon.
 * - `"lit"`: ~23% of urban buildings with active neon signage/strips (total ~25% lit with landmarks).
 * - `"dark"`: ~75% of urban buildings with calm, unlit facades and sparse window clusters. */
export function buildingNeonTier(world: VoidWorld, b: MetroBuilding): BuildingNeonTier {
  if (b.archStyle === "homestead" || b.archStyle === "barn") return "dark";
  if (getLandmarkBuildingIds(world).has(b.id)) return "landmark";
  if (b.development > 1.05) return "lit";
  return hash01(world.seed, 919, b.id) < 0.23 ? "lit" : "dark";
}

/** Returns the district neon accent color for building `b`:
 * mostly Tron cyan, with 1–2 district sectors using magenta, electric violet, or cool white-ice.
 * (Tower lights stay uniquely orange.) */
export function districtNeonAccentFor(world: VoidWorld, b: MetroBuilding, pal: ArchPalette): DistrictNeonAccent {
  if (b.archStyle === "homestead" || b.archStyle === "barn") {
    return { neonEdge: pal.neonEdge, neonCore: pal.neonCore, lightRgb: [1.1, 0.72, 0.32] };
  }
  const sectorX = Math.floor(b.x / Math.max(48, world.grid.w * 0.34));
  const sectorY = Math.floor(b.y / Math.max(48, world.grid.h * 0.34));
  const sectorRoll = (hash(world.seed, 923, sectorX, sectorY) + (b.district === "industrial" ? 2 : 0)) % 7;
  if (sectorRoll === 1) {
    // Cyber magenta district accent
    return {
      neonEdge: "#d838e8",
      neonCore: "#ff94f2",
      lightRgb: [1.26, 0.26, 1.38],
    };
  }
  if (sectorRoll === 2) {
    // Electric violet district accent
    return {
      neonEdge: "#7c4dff",
      neonCore: "#c8b8ff",
      lightRgb: [0.64, 0.40, 1.48],
    };
  }
  if (sectorRoll === 3 && (b.district === "plaza" || b.archStyle === "civicDome" || b.archStyle === "solarTerrace")) {
    // Cool white-ice civic accent
    return {
      neonEdge: "#8ce8ff",
      neonCore: "#eafaff",
      lightRgb: [0.86, 1.16, 1.42],
    };
  }
  return {
    neonEdge: pal.neonEdge,
    neonCore: pal.neonCore,
    lightRgb: [0.08, 0.92, 1.48],
  };
}

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
  /** Packed ABGR color buffer of size `w * (h + maxElev)` (0 where transparent). */
  colorU32: Uint32Array;
  /** 3D world height `z` (`0..15` px) at each sprite pixel. */
  elevMap: Uint8Array;
  /** Quantized 3D bump-mapped surface normal X (`-127..127`) at each sprite pixel. */
  nxMap: Int8Array;
  /** Quantized 3D bump-mapped surface normal Y (`-127..127`) at each sprite pixel. */
  nyMap: Int8Array;
  /** Quantized 3D bump-mapped surface normal Z (`-127..127`) at each sprite pixel. */
  nzMap: Int8Array;
  /** Specular reflectivity weight (`0..255`) at each sprite pixel. */
  specMap: Uint8Array;
  surfaceMap: Uint8Array;
};

const IS_LITTLE_ENDIAN_ELEV = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
const elevHexCache = new Map<string, number>();

export function packElevAbgr(r: number, g: number, b: number): number {
  return IS_LITTLE_ENDIAN_ELEV
    ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}

export function hexToElevAbgr(hex: string): number {
  let v = elevHexCache.get(hex);
  if (v !== undefined) return v;
  const r = parseInt(hex.slice(1, 3), 16) & 0xff;
  const g = parseInt(hex.slice(3, 5), 16) & 0xff;
  const b = parseInt(hex.slice(5, 7), 16) & 0xff;
  v = packElevAbgr(r, g, b);
  elevHexCache.set(hex, v);
  return v;
}

function storeUnitNormal(
  nxMap: Int8Array,
  nyMap: Int8Array,
  nzMap: Int8Array,
  pIdx: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  const len = Math.hypot(nx, ny, nz) || 1;
  nxMap[pIdx] = Math.max(-127, Math.min(127, Math.round((nx / len) * 127)));
  nyMap[pIdx] = Math.max(-127, Math.min(127, Math.round((ny / len) * 127)));
  nzMap[pIdx] = Math.max(-127, Math.min(127, Math.round((nz / len) * 127)));
}

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
      } else if (b.roofFeature === "skyGarden" && inset >= pixels(2)) {
        color = "#284d30";
      } else if (b.roofFeature === "solarArray" && ly % 4 === 0 && inset >= pixels(2)) {
        color = "#356385";
      } else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        // Single clean rooftop HVAC unit / penthouse core instead of noisy checkerboard
        color = dx === 0 && dy === 0 ? pal.litEdge : pal.roofAccent;
      }
    }
    // Light restraint: only hero landmarks and ~12% of lit skyscrapers carry rooftop neon strips
    const neonTier = buildingNeonTier(world, b);
    const accent = districtNeonAccentFor(world, b, pal);
    const hasRoofNeonStrip =
      b.w >= 6 &&
      (neonTier === "landmark" || (neonTier === "lit" && b.isSkyscraper && (b.id & 1) === 0));
    if (hasRoofNeonStrip && ly === b.h - 2 && lx >= 1 && lx <= b.w - 2) {
      color = lx === 1 || lx === b.w - 2 ? accent.neonEdge : accent.neonCore;
    } else if (neonTier === "landmark" && b.h >= 6 && (lx === 1 || lx === b.w - 2) && ly >= 1 && ly <= b.h - 2) {
      color = ly === 1 || ly === b.h - 2 ? accent.neonEdge : accent.neonCore;
    }
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
    if (lx % 3 === 1 && fRow <= 1) return hpRatio > 0.35 ? "#ffd884" : "#4a3327";
    return b.archStyle === "barn" ? (lx % 2 === 0 ? "#a04b38" : "#803b2e") : "#ddc8a0";
  }
  const lx = x - b.x;
  const midX = Math.floor(b.w * 0.5);
  const feat = (b.id * 7 + b.variant * 3) & 3;
  const neonTier = buildingNeonTier(world, b);
  const accent = districtNeonAccentFor(world, b, pal);

  if (neonTier !== "dark" && hpRatio > 0.35) {
    // 1. Ground-floor storefront / lobby neon canopy (landmarks always; lit buildings when feat is 0 or 2)
    if (fRow === 0 && b.w >= 4 && (neonTier === "landmark" || feat === 0 || feat === 2)) {
      const span = neonTier === "landmark"
        ? Math.max(2, Math.min(4, Math.floor((b.w - 2) * 0.45)))
        : Math.max(1, Math.min(2, Math.floor((b.w - 2) * 0.34)));
      if (Math.abs(lx - midX) <= span) {
        return Math.abs(lx - midX) === span ? accent.neonEdge : accent.neonCore;
      }
      return pal.shadeEdge;
    }

    // 2. Crown / upper cornice neon strip on hero landmarks or selected lit skyscrapers
    if (
      fRow === elev - 1 &&
      (neonTier === "landmark" || (b.isSkyscraper && feat === 0)) &&
      lx >= 1 &&
      lx <= b.w - 2
    ) {
      return lx === 1 || lx === b.w - 2 ? accent.neonEdge : accent.neonCore;
    }

    // 3. Vertical neon sign / strip down primary facade column(s)
    if (
      elev >= 3 &&
      (neonTier === "landmark" || feat === 1) &&
      (lx === (b.id & 1 ? 1 : Math.max(1, b.w - 2)) || (neonTier === "landmark" && (lx === 1 || lx === b.w - 2))) &&
      fRow >= 1 &&
      fRow <= elev - 1
    ) {
      return fRow === 1 || fRow === elev - 1 ? accent.neonEdge : accent.neonCore;
    }

    // 4. Horizontal mid-facade neon sign on lit buildings with feat 2 or 3
    if (elev >= 4 && (feat === 2 || feat === 3)) {
      const signRow = Math.max(1, Math.min(elev - 2, Math.floor(elev * 0.55)));
      if (
        fRow === signRow &&
        lx >= 2 &&
        lx <= Math.min(b.w - 3, 5)
      ) {
        return lx === 2 ? accent.neonEdge : accent.neonCore;
      }
    }
  } else if (fRow === 0) {
    return pal.shadeEdge;
  }

  // 5. Recessed structural window columns: most windows dark; lit windows appear only in small clusters
  const isWindowCol = lx % 2 === 1;
  if (isWindowCol) {
    // Group window columns and floors into small 2-window x 1-band clusters so only a few rooms per building are lit
    const clusterX = lx >> 2;
    const clusterY = fRow >> 1;
    const clusterRoll = hash01(world.seed, 965, b.id, clusterX, clusterY);
    const threshold = neonTier === "landmark" ? 0.11 : neonTier === "lit" ? 0.075 : 0.045;
    if (clusterRoll < threshold && hpRatio > 0.35 && lx >= 1 && lx <= b.w - 2) {
      return pal.litEdge;
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
  const spriteSize = spriteW * spriteH;
  const colorBuf = new Array<string | null>(spriteSize).fill(null);
  const hitMask = new Uint8Array(spriteSize);
  const colorU32 = new Uint32Array(spriteSize);
  const elevMap = new Uint8Array(spriteSize);
  const nxMap = new Int8Array(spriteSize);
  const nyMap = new Int8Array(spriteSize);
  const nzMap = new Int8Array(spriteSize);
  const specMap = new Uint8Array(spriteSize);
  const surfaceMap = new Uint8Array(spriteSize);
  const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
  const pal = palettes[b.variant % palettes.length];
  const accent = districtNeonAccentFor(world, b, pal);
  const isNeonColor = (c: string): boolean =>
    c === pal.neonCore || c === pal.neonEdge || c === accent.neonCore || c === accent.neonEdge;
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
      colorU32,
      elevMap,
      nxMap,
      nyMap,
      nzMap,
      specMap,
      surfaceMap,
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

  const midX = b.x + b.w * 0.5;
  const midY = b.y + b.h * 0.5;
  const rustic = b.archStyle === "homestead" || b.archStyle === "barn";
  const isGlassStyle =
    b.archStyle === "glassTower" || b.archStyle === "cyberArcology" || b.archStyle === "solarTerrace";
  const microHeight = new Float32Array(spriteSize);
  const baseNx = new Float32Array(spriteSize);
  const baseNy = new Float32Array(spriteSize);
  const baseNz = new Float32Array(spriteSize);

  const luma01 = (abgr: number): number => {
    const r = IS_LITTLE_ENDIAN_ELEV ? abgr & 0xff : (abgr >>> 24) & 0xff;
    const g = IS_LITTLE_ENDIAN_ELEV ? (abgr >>> 8) & 0xff : (abgr >>> 16) & 0xff;
    const bl = IS_LITTLE_ENDIAN_ELEV ? (abgr >>> 16) & 0xff : (abgr >>> 8) & 0xff;
    return (r * 0.299 + g * 0.587 + bl * 0.114) * (1 / 255);
  };

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

      const northElev = ly > 0 ? cellElev[(ly - 1) * b.w + lx] : 0;
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
          const westBorder = f >= westElev;
          const eastBorder = f >= eastElev;
          const isSideBorder = westBorder || eastBorder;
          const fCol = isCutawayFace
            ? cutawayColorAt(world, b, cx, cy, f, elev, isSideBorder, adjVoid, pal)
            : facadeColorAt(world, b, cx, cy, f, elev, isSideBorder, hpRatio, pal);
          const pIdx = sy * spriteW + lx;
          colorBuf[pIdx] = fCol;
          const abgr = hexToElevAbgr(fCol);
          colorU32[pIdx] = abgr;
          hitMask[pIdx] = 1;
          elevMap[pIdx] = Math.max(0, Math.min(255, f));

          // 3D bump-mapped surface normal for south facade / cutaway
          let nx = 0;
          let ny = 0.86;
          let nz = 0.48;
          let spec = isGlassStyle ? 115 : 55;
          let partRelief = 0.35 + luma01(abgr) * 0.28;

          if (westBorder && !eastBorder) {
            nx -= 0.72;
            partRelief += 0.14;
          } else if (eastBorder && !westBorder) {
            nx += 0.72;
            partRelief += 0.14;
          }

          if (isCutawayFace) {
            if (f % 2 === 0) {
              // Projecting horizontal concrete floor slab shelf
              ny = 0.54;
              nz = 0.84;
              spec = 40;
              partRelief += 0.32;
            } else {
              // Recessed broken interior room with partition wall facets
              nx += ((cx * 7 + f * 13) & 2) === 0 ? -0.38 : 0.38;
              ny = 0.88;
              nz = 0.28;
              spec = fCol === "#48e5ff" || fCol === pal.neonCore ? 245 : 65;
              partRelief -= 0.22;
            }
          } else if (rustic) {
            // Timber & clapboard siding bevels
            ny += (f & 1) === 0 ? 0.08 : -0.08;
            nz += (f & 1) === 0 ? -0.06 : 0.14;
            spec = fCol === "#ffd884" ? 242 : lx % 3 === 1 ? 120 : 35;
            partRelief += (f & 1) === 0 ? 0.12 : -0.08;
          } else if (f === 0 || f === elev - 1) {
            // Ground lobby awning or upper cornice band
            ny = 0.62;
            nz = 0.78;
            spec = isNeonColor(fCol) ? 250 : 95;
            partRelief += 0.24;
          } else if (lx % 2 === 1) {
            // Window column: smooth recessed glass panes with horizontal floor spandrels
            if (f % 2 === 0) {
              ny = 0.76;
              nz = 0.65;
              spec = 110;
              partRelief += 0.08;
            } else {
              ny = 0.94;
              nz = 0.34;
              spec = isGlassStyle ? 200 : 155;
              partRelief -= 0.18;
            }
            if (isNeonColor(fCol)) spec = 250;
            else if (fCol === "#ffd166" || fCol === "#ff9e38") spec = 242;
          } else {
            // Vertical structural pilaster / mullion rib
            nx += lx < b.w * 0.5 ? -0.26 : 0.26;
            ny = 0.82;
            nz = 0.50;
            partRelief += 0.22;
            if (isNeonColor(fCol)) spec = 250;
            else if (fCol === "#ffd166" || fCol === "#ff9e38") spec = 242;
          }
          baseNx[pIdx] = nx;
          baseNy[pIdx] = ny;
          baseNz[pIdx] = nz;
          microHeight[pIdx] = f * 0.18 + partRelief;
          specMap[pIdx] = spec;
          surfaceMap[pIdx] = !isCutawayFace && !rustic && hpRatio >= 0.75 &&
            lx % 2 === 1 && f % 2 === 1 && f < elev - 1 && spec < 240
            ? SurfaceMaterial.GLASS : SurfaceMaterial.OPAQUE;
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
        const abgr = hexToElevAbgr(rCol);
        colorU32[pIdx] = abgr;
        hitMask[pIdx] = 1;
        elevMap[pIdx] = Math.max(0, Math.min(255, elev));

        // 3D bump-mapped surface normal for roof / setback terrace / spalled slab
        let nx = 0;
        let ny = 0;
        let nz = 1.0;
        let spec = isGlassStyle ? 110 : 60;
        let partRelief = 0.65 + luma01(abgr) * 0.25;

        if (spalledTop) {
          nx = (hash01(world.seed, 977, cx, cy) - 0.5) * 0.6;
          ny = (hash01(world.seed, 978, cx, cy) - 0.5) * 0.6;
          nz = 0.80;
          spec = 35;
        } else if (rustic) {
          // Pitched gable roof slopes
          const horizontal = b.w >= b.h;
          if (horizontal) {
            ny = cy + 0.5 < midY ? -0.56 : cy + 0.5 > midY ? 0.56 : 0;
            nx = ((lx & 1) === 0 ? -0.08 : 0.08);
            nz = 0.82;
            partRelief += (1 - Math.abs(cy + 0.5 - midY) / Math.max(1, b.h * 0.5)) * 0.35;
          } else {
            nx = cx + 0.5 < midX ? -0.56 : cx + 0.5 > midX ? 0.56 : 0;
            ny = ((ly & 1) === 0 ? -0.08 : 0.08);
            nz = 0.82;
            partRelief += (1 - Math.abs(cx + 0.5 - midX) / Math.max(1, b.w * 0.5)) * 0.35;
          }
          spec = 45;
        } else if (b.archStyle === "civicDome") {
          // Smooth spherical dome normal curving outward from roof center
          const dx = (cx + 0.5 - midX) / Math.max(1.5, b.w * 0.5);
          const dy = (cy + 0.5 - midY) / Math.max(1.5, b.h * 0.5);
          const r2 = Math.min(0.78, dx * dx + dy * dy);
          nx = dx * 0.75;
          ny = dy * 0.75;
          nz = Math.sqrt(Math.max(0.22, 1 - r2));
          spec = 155;
          partRelief += (1 - r2) * 0.45;
        } else {
          // Outer parapet and setback terrace bevels
          if (elev > northElev) { ny -= 0.62; partRelief += 0.16; }
          if (elev > southElev) { ny += 0.62; partRelief += 0.16; }
          if (elev > westElev) { nx -= 0.62; partRelief += 0.16; }
          if (elev > eastElev) { nx += 0.62; partRelief += 0.16; }

          // Interior rooftop feature bump mapping
          if (nx === 0 && ny === 0) {
            if (b.roofFeature === "solarArray" && ly % 3 === 0) {
              ny = 0.46;
              nz = 0.88;
              spec = 210;
              partRelief += 0.22;
            } else if (b.roofFeature === "helipad") {
              const hdx = cx - Math.floor(midX);
              const hdy = cy - Math.floor(midY);
              if (Math.abs(hdx) === 2 || Math.abs(hdy) === 2) {
                nx = hdx * 0.22;
                ny = hdy * 0.22;
                nz = 0.92;
                partRelief += 0.18;
              }
            } else if (b.roofFeature === "skyGarden") {
              nx = ((lx & 1) === 0 ? -0.22 : 0.22);
              ny = ((ly & 1) === 0 ? -0.22 : 0.22);
              nz = 0.94;
              spec = 35;
            } else if (b.archStyle === "foundryComplex") {
              // Sawtooth industrial roof skylight ridges
              ny = (ly & 1) === 0 ? -0.34 : 0.34;
              nz = 0.94;
            } else {
              // Subtle structural panel seams
              nx = lx % 3 === 0 ? -0.14 : 0.08;
              ny = ly % 3 === 0 ? -0.14 : 0.08;
              nz = 0.98;
            }
          }
        }
        baseNx[pIdx] = nx;
        baseNy[pIdx] = ny;
        baseNz[pIdx] = nz;
        microHeight[pIdx] = elev * 0.22 + partRelief;
        specMap[pIdx] = isNeonColor(rCol) ? 250 : spec;
        const hasGlassRoof = (isGlassStyle && (rCol === pal.crown || rCol === pal.mid || rCol === pal.roofAccent)) || spec === 210;
        const isFlatRoof = !spalledTop && !rustic && b.archStyle !== "civicDome" && specMap[pIdx] < 240 && nz >= 0.9;
        surfaceMap[pIdx] = !spalledTop && hpRatio >= 0.75 && hasGlassRoof && specMap[pIdx] < 240
          ? SurfaceMaterial.GLASS
          : isFlatRoof
            ? SurfaceMaterial.WET_ROOF
            : SurfaceMaterial.OPAQUE;
      }
    }
  }

  // Blend 3x3 Sobel micro-relief gradient from authored sprite part heights + pixel luminance into the structural normals
  const sampleH = (sx: number, sy: number, centerH: number): number => {
    if (sx < 0 || sx >= spriteW || sy < 0 || sy >= spriteH) return centerH;
    const qi = sy * spriteW + sx;
    return hitMask[qi] ? microHeight[qi] : centerH;
  };
  for (let sy = 0; sy < spriteH; sy++) {
    const row = sy * spriteW;
    for (let sx = 0; sx < spriteW; sx++) {
      const pIdx = row + sx;
      if (!hitMask[pIdx]) continue;
      const cH = microHeight[pIdx];
      const hNW = sampleH(sx - 1, sy - 1, cH);
      const hN = sampleH(sx, sy - 1, cH);
      const hNE = sampleH(sx + 1, sy - 1, cH);
      const hW = sampleH(sx - 1, sy, cH);
      const hE = sampleH(sx + 1, sy, cH);
      const hSW = sampleH(sx - 1, sy + 1, cH);
      const hS = sampleH(sx, sy + 1, cH);
      const hSE = sampleH(sx + 1, sy + 1, cH);
      const gx = (hNE + 2 * hE + hSE - (hNW + 2 * hW + hSW)) * 0.14;
      const gy = (hSW + 2 * hS + hSE - (hNW + 2 * hN + hNE)) * 0.14;
      storeUnitNormal(
        nxMap,
        nyMap,
        nzMap,
        pIdx,
        baseNx[pIdx] - gx,
        baseNy[pIdx] - gy,
        baseNz[pIdx],
      );
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
    colorU32,
    elevMap,
    nxMap,
    nyMap,
    nzMap,
    specMap,
    surfaceMap,
  };
}

export class BuildingSpriteCache {
  private cachedWorld: VoidWorld | null = null;
  private cachedMode: BuildingHeightMode = "full";
  private readonly sprites = new Map<number, CachedBuildingSprite>();
  private atlasCanvas: HTMLCanvasElement | null = null;
  private atlasCtx: CanvasRenderingContext2D | null = null;
  private readonly dirtyIds = new Set<number>();

  /** Full-board structure G-buffer for per-pixel 2.5D bump lighting & shadow casting. */
  atlasColorU32 = new Uint32Array(0);
  atlasElev = new Uint8Array(0);
  atlasNx = new Int8Array(0);
  atlasNy = new Int8Array(0);
  atlasNz = new Int8Array(0);
  atlasSpec = new Uint8Array(0);
  atlasSurface = new Uint8Array(0);
  atlasBldId = new Int16Array(0);
  private gbufferW = 0;
  private gbufferH = 0;

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
      this.gbufferW = 0;
      this.gbufferH = 0;
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

  /** Synchronizes the full-board structure G-buffer (works in both browser and headless Node tests). */
  syncAtlasGbuffer(
    world: VoidWorld,
    mode: BuildingHeightMode,
    dirtyChunkFlags?: Uint8Array,
  ): { rebuildAll: boolean; sortedSprites: CachedBuildingSprite[]; dirtyRects: [number, number, number, number][] } {
    const { w, h, chunksW, count } = world.grid;
    let rebuildAll = false;
    if (
      this.cachedWorld !== world ||
      this.cachedMode !== mode ||
      this.gbufferW !== w ||
      this.gbufferH !== h ||
      this.atlasColorU32.length !== count
    ) {
      this.cachedWorld = world;
      this.cachedMode = mode;
      this.sprites.clear();
      this.dirtyIds.clear();
      this.gbufferW = w;
      this.gbufferH = h;
      this.atlasColorU32 = new Uint32Array(count);
      this.atlasElev = new Uint8Array(count);
      this.atlasNx = new Int8Array(count);
      this.atlasNy = new Int8Array(count);
      this.atlasNz = new Int8Array(count);
      this.atlasSpec = new Uint8Array(count);
      this.atlasSurface = new Uint8Array(count);
      this.atlasBldId = new Int16Array(count).fill(-1);
      rebuildAll = true;
    }

    if (!rebuildAll && dirtyChunkFlags && this.sprites.size === world.buildings.length) {
      let anyDirty = false;
      for (let k = 0; k < dirtyChunkFlags.length; k++) {
        if (dirtyChunkFlags[k]) {
          anyDirty = true;
          break;
        }
      }
      if (!anyDirty && this.dirtyIds.size === 0) {
        return { rebuildAll: false, sortedSprites: [], dirtyRects: [] };
      }
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
      return { rebuildAll: false, sortedSprites: [], dirtyRects: [] };
    }

    const sortedSprites: CachedBuildingSprite[] = [];
    for (let i = 0; i < world.buildings.length; i++) {
      const sp = this.sprites.get(world.buildings[i].id);
      if (sp && sp.intactCount > 0) sortedSprites.push(sp);
    }
    sortedSprites.sort((a, b) => a.bottomY - b.bottomY || a.x - b.x);

    const dirtyRects: [number, number, number, number][] = [];
    if (!rebuildAll && this.dirtyIds.size <= 32) {
      for (const id of this.dirtyIds) {
        const sp = this.sprites.get(id);
        if (sp) {
          dirtyRects.push([
            Math.max(0, sp.x),
            Math.max(0, sp.y),
            Math.min(w, sp.x + sp.w),
            Math.min(h, sp.y + sp.h),
          ]);
        }
      }
    } else {
      dirtyRects.push([0, 0, w, h]);
    }

    const { atlasColorU32, atlasElev, atlasNx, atlasNy, atlasNz, atlasSpec, atlasSurface, atlasBldId } = this;
    for (let r = 0; r < dirtyRects.length; r++) {
      const [rx0, ry0, rx1, ry1] = dirtyRects[r];
      if (rx1 <= rx0 || ry1 <= ry0) continue;
      for (let y = ry0; y < ry1; y++) {
        const row = y * w;
        atlasColorU32.fill(0, row + rx0, row + rx1);
        atlasElev.fill(0, row + rx0, row + rx1);
        atlasNx.fill(0, row + rx0, row + rx1);
        atlasNy.fill(0, row + rx0, row + rx1);
        atlasNz.fill(0, row + rx0, row + rx1);
        atlasSpec.fill(0, row + rx0, row + rx1);
        atlasSurface.fill(0, row + rx0, row + rx1);
        atlasBldId.fill(-1, row + rx0, row + rx1);
      }
      for (let i = 0; i < sortedSprites.length; i++) {
        const sp = sortedSprites[i];
        if (sp.x + sp.w <= rx0 || sp.x >= rx1 || sp.y + sp.h <= ry0 || sp.y >= ry1) continue;
        const sx0 = Math.max(rx0, sp.x);
        const sx1 = Math.min(rx1, sp.x + sp.w);
        const sy0 = Math.max(ry0, sp.y);
        const sy1 = Math.min(ry1, sp.y + sp.h);
        const spW = sp.w;
        for (let sy = sy0; sy < sy1; sy++) {
          const dy = sy - sp.y;
          const spRow = dy * spW;
          const bRow = sy * w;
          for (let sx = sx0; sx < sx1; sx++) {
            const pIdx = spRow + (sx - sp.x);
            const c = sp.colorU32[pIdx];
            if (c !== 0) {
              const bIdx = bRow + sx;
              atlasColorU32[bIdx] = c;
              atlasElev[bIdx] = sp.elevMap[pIdx];
              atlasNx[bIdx] = sp.nxMap[pIdx];
              atlasNy[bIdx] = sp.nyMap[pIdx];
              atlasNz[bIdx] = sp.nzMap[pIdx];
              atlasSpec[bIdx] = sp.specMap[pIdx];
              atlasSurface[bIdx] = sp.surfaceMap[pIdx];
              atlasBldId[bIdx] = sp.id;
            }
          }
        }
      }
    }

    this.dirtyIds.clear();
    return { rebuildAll, sortedSprites, dirtyRects };
  }

  /** Returns a full-board cached canvas containing all buildings sorted back-to-front.
   * Re-checks signatures only for buildings overlapping dirtied 16x16 terrain chunks. */
  getBoardAtlas(
    world: VoidWorld,
    mode: BuildingHeightMode,
    dirtyChunkFlags?: Uint8Array,
  ): HTMLCanvasElement | null {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      this.syncAtlasGbuffer(world, mode, dirtyChunkFlags);
      return null;
    }
    const { w, h } = world.grid;
    let forceCanvasRebuild = false;
    if (!this.atlasCanvas || this.atlasCanvas.width !== w || this.atlasCanvas.height !== h) {
      const el = this.atlasCanvas ?? document.createElement("canvas");
      el.width = w;
      el.height = h;
      this.atlasCanvas = el;
      this.atlasCtx = el.getContext("2d");
      this.gbufferW = 0; // trigger full gbuffer + canvas sync
      forceCanvasRebuild = true;
    }

    const { sortedSprites, dirtyRects } = this.syncAtlasGbuffer(world, mode, dirtyChunkFlags);
    if (!forceCanvasRebuild && dirtyRects.length === 0) {
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

      for (let i = 0; i < sortedSprites.length; i++) {
        const sp = sortedSprites[i];
        if (sp.x + sp.w <= rx0 || sp.x >= rx1 || sp.y + sp.h <= ry0 || sp.y >= ry1) continue;
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

    for (let r = 0; r < dirtyRects.length; r++) {
      const [rx0, ry0, rx1, ry1] = dirtyRects[r];
      repaintRect(rx0, ry0, rx1, ry1);
    }

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
