/** Deterministic grid-based Void accretion fluid and short-lived flair sparks for Void Defense.
 *
 * Matter sucked into the Void reads as itself first, then blends, heats up into trails, and glows:
 * 1. True Source Color per Cell: stores real RGB channels (`colorR`, `colorG`, `colorB` in `Float32Array`)
 *    alongside `amount`, `heat`, and `material`. When a cell or chunk dissolves, `sampleSourceCellColors`
 *    samples the actual rendered pixel colors of the tile or building sprite it came from (road asphalt
 *    and orange lane lines, sidewalks, crosswalks, grass, crops, water, building roofs, facades, and neon).
 * 2. Weighted Color & Heat Blending: when fluid moves between cells along the precomputed spiral flow field,
 *    incoming RGB and heat mix weighted by fluid `amount` so streams of different materials blend smoothly
 *    where they meet, with a subtle per-cell deterministic variation so blended streams never turn to flat mud.
 * 3. Advected Per-Cell Heat (`0..1`): rises with time spent in the flow, closeness to the Void, and faster
 *    flow (friction), and travels with the fluid along elongated flow-aligned streaks to form hot glowing
 *    trails rather than concentric distance rings.
 * 4. Continuous Heat Ramp & Smooth Halo Emission: interpolates continuously from the cell's true source
 *    color through dull red -> molten orange -> incandescent yellow-white -> event-horizon violet/magenta.
 *    Cool fluid is lit by the scene (`TimeOfDayPreset`, sun, rain); hot fluid is self-emissive and feeds
 *    the half-resolution (`1/2` res) halo buffer proportionally to `heat`.
 * 5. Ordered Bayer Dithering & Glossy Liquid Depth: uses continuous color/alpha with deterministic 4x4 Bayer
 *    dithering at pixel scale (skipped on Low quality), a sunward/outer-edge highlight, an inner-side shadow
 *    edge, and depth darkening on thick cores so streams read as thick, glossy liquid.
 */

import { dist } from "../exact.ts";
import { PARKING_STREET_TIER } from "./config.ts";
import { CITY_DETAIL_COLORS, cityDetailAt } from "./city-details.ts";
import {
  ARCH_PALETTES,
  facadeColorAt,
  floorsToElevation,
  roofColorAt,
} from "./elevation.ts";
import { farmSoilColor, isWheat } from "./farms.ts";
import { hash01 } from "./grid.ts";
import {
  isBoulevardOrAvenueLaneAt,
  isBoulevardStreetlightAt,
  looseMaterialLight,
  type TimeOfDayPreset,
  type VoidWeatherMode,
} from "./lighting.ts";
import { CellMaterial, LandCover } from "./model.ts";
import { valueNoise } from "./portal-noise.ts";
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

/** Fixed 7-stop reference palettes per material (kept for material fallbacks and tests). */
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
    [62, 114, 48],
    [76, 138, 56],
    [132, 128, 48],
    [198, 86, 32],
    [248, 128, 34],
    [232, 74, 158],
    [186, 68, 242],
  ],
  [FluidMaterial.DIRT]: [
    [138, 102, 64],
    [152, 114, 72],
    [176, 108, 54],
    [212, 88, 34],
    [250, 134, 38],
    [234, 78, 162],
    [184, 66, 240],
  ],
  [FluidMaterial.STONE]: [
    [94, 108, 130],
    [110, 124, 148],
    [148, 114, 96],
    [206, 82, 42],
    [252, 136, 42],
    [236, 82, 174],
    [192, 74, 248],
  ],
  [FluidMaterial.CONCRETE]: [
    [54, 66, 84],
    [82, 96, 118],
    [138, 112, 102],
    [210, 84, 38],
    [255, 142, 44],
    [238, 84, 178],
    [196, 78, 252],
  ],
  [FluidMaterial.CROPS]: [
    [196, 154, 58],
    [216, 172, 62],
    [232, 142, 44],
    [236, 98, 32],
    [255, 156, 48],
    [242, 88, 172],
    [198, 76, 248],
  ],
  [FluidMaterial.WATER]: [
    [46, 112, 178],
    [68, 142, 206],
    [112, 124, 188],
    [196, 92, 112],
    [246, 134, 58],
    [232, 82, 188],
    [182, 74, 250],
  ],
};

/** Representative chunk hex color for each material. */
export const FLUID_CHUNK_COLORS: Record<FluidMaterialId, { color: string; accent: string }> = {
  [FluidMaterial.NONE]: { color: "#364050", accent: "#6a788c" },
  [FluidMaterial.GRASS]: { color: "#4c8a38", accent: "#6fae46" },
  [FluidMaterial.DIRT]: { color: "#8e6640", accent: "#b08a5a" },
  [FluidMaterial.STONE]: { color: "#6e7c94", accent: "#94a6c2" },
  [FluidMaterial.CONCRETE]: { color: "#4a586e", accent: "#788ca6" },
  [FluidMaterial.CROPS]: { color: "#d8ac3e", accent: "#f0cc62" },
  [FluidMaterial.WATER]: { color: "#448ece", accent: "#6ec0f2" },
};

const hexRgbParseCache = new Map<string, [number, number, number]>();

/** Parses a `#rrggbb` hex string into an `[r, g, b]` tuple in `0..255`. */
export function parseHexRgb255(hex: string): [number, number, number] {
  let v = hexRgbParseCache.get(hex);
  if (v) return v;
  if (hex.startsWith("#") && hex.length >= 7) {
    v = [
      parseInt(hex.slice(1, 3), 16) & 0xff,
      parseInt(hex.slice(3, 5), 16) & 0xff,
      parseInt(hex.slice(5, 7), 16) & 0xff,
    ];
  } else {
    v = [84, 96, 114];
  }
  hexRgbParseCache.set(hex, v);
  return v;
}

function rgbToHex255(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Samples the true rendered pixel colors of world cell `idx` (terrain tile or building roof/facade/neon sprite)
 * before Void consumption so chunks and fluid streams start with the exact visual colors of what was eaten. */
export function sampleSourceCellColors(
  world: VoidWorld,
  idx: number,
  prevMat: number,
  prevCover: number,
  bId: number,
  prevFloors = 0,
): { color: string; accent: string; rgb: [number, number, number]; accentRgb: [number, number, number] } {
  const { w, h } = world.grid;
  const x = idx % w;
  const y = (idx / w) | 0;
  const r = hash01(world.seed, 951, x, y);

  // 1. Building cell: sample actual rendered roofColorAt and facadeColorAt from elevation.ts (including neon signs/outlines/windows)
  // Temporarily sample at full structural HP so a cell whose HP just reached 0 on consumption still yields its true architectural roof/wall/neon color
  if (bId >= 0 && world.buildings[bId]) {
    const b = world.buildings[bId];
    const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
    const pal = palettes[b.variant % palettes.length];
    const savedHp = world.hp[idx];
    const savedMaxHp = world.maxHp[idx];
    const savedBld = world.buildingAt[idx];
    world.hp[idx] = Math.max(100, savedMaxHp);
    world.maxHp[idx] = Math.max(100, savedMaxHp);
    world.buildingAt[idx] = bId;
    const roofHex = roofColorAt(world, b, x, y, idx, pal);
    const floors = prevFloors > 0 ? prevFloors : b.height;
    const elev = Math.max(1, floorsToElevation(floors, "full"));
    const fRow = Math.min(elev - 1, ((x * 3 + y * 5) % Math.max(1, elev)));
    const isSideBorder = x === b.x || x === b.x + b.w - 1;
    const facadeHex = facadeColorAt(world, b, x, y, fRow, elev, isSideBorder, 1.0, pal);
    world.hp[idx] = savedHp;
    world.maxHp[idx] = savedMaxHp;
    world.buildingAt[idx] = savedBld;

    const pickFacade = (y === b.y + b.h - 1 || ((x + y) & 1) === 1) && facadeHex !== pal.podium;
    const primaryHex = pickFacade ? facadeHex : roofHex;
    const accentHex = pickFacade ? roofHex : facadeHex;
    return {
      color: primaryHex,
      accent: accentHex,
      rgb: parseHexRgb255(primaryHex),
      accentRgb: parseHexRgb255(accentHex),
    };
  }

  let color = "#303846";
  let accent = "#4a5668";

  // 2. Water / river / ocean
  if (prevMat === CellMaterial.UNCLAIMED) {
    color = prevCover === LandCover.RIVER ? (r < 0.2 ? "#4a9bd1" : "#2b6ca3") : "#153956";
    accent = "#58b0e6";
  } else if (prevMat === CellMaterial.WALL || prevMat === CellMaterial.BARRIER) {
    // 3. Fortified walls & barriers
    color = prevMat === CellMaterial.BARRIER ? "#48c9e0" : (x + y) % 4 === 0 ? "#788ca8" : "#5a6b82";
    accent = "#8fa4c2";
  } else if (prevMat === CellMaterial.RECLAIMED) {
    color = r < 0.3 ? "#9e7e4e" : "#7d623c";
    accent = "#b08e5a";
  } else if (prevMat === CellMaterial.SALVAGE) {
    color = r < 0.18 ? "#995c38" : r < 0.55 ? "#5e4334" : "#3d353a";
    accent = "#7a5844";
  } else if (prevMat === CellMaterial.STREET) {
    // 4. Streets: sample actual rendered asphalt, orange lane lines, sidewalks, medians, parking bays, dirt roads, and bridges
    const stTier = world.streetTier[idx];
    if (stTier === PARKING_STREET_TIER) {
      const row = y & 7;
      const bay = x % 5;
      const occupied = hash01(world.seed, 1208, Math.floor(x / 5), y >> 3) < 0.37;
      if (row === 0 || (bay === 0 && row < 4)) color = "#78828a";
      else if (occupied && bay >= 2 && bay <= 3 && row >= 1 && row <= 3) {
        color = row === 1 ? "#7a96a6" : row === 2 ? "#476277" : "#a25743";
      } else color = row >= 5 ? "#323c48" : "#3d4654";
      accent = "#78828a";
    } else if (stTier === 8 || prevCover === LandCover.DIRT_ROAD || prevCover === LandCover.BRIDGE) {
      color = prevCover === LandCover.BRIDGE
        ? (x + y) % 3 === 0 ? "#523b28" : "#876948"
        : valueNoise(x * 0.25, y * 0.25) > 0.55 ? "#a38152" : "#8c6d45";
      accent = "#b08a5a";
    } else if (stTier === 3) {
      if (isBoulevardStreetlightAt(world, x, y)) {
        color = "#a8e6ff";
        accent = "#526278";
      } else {
        color = (x + y) % 3 === 0 ? "#384656" : "#2f3b4a";
        accent = "#4e5e72";
      }
    } else {
      const detail = cityDetailAt(world, idx);
      const kerb =
        (x > 0 && world.buildingAt[idx - 1] >= 0) ||
        (x + 1 < w && world.buildingAt[idx + 1] >= 0) ||
        (y > 0 && world.buildingAt[idx - w] >= 0) ||
        (y + 1 < h && world.buildingAt[idx + w] >= 0);
      if (detail !== 0 && CITY_DETAIL_COLORS[detail]) {
        color = CITY_DETAIL_COLORS[detail];
        accent = "#384252";
      } else if (kerb) {
        // Sidewalk kerb slab
        color = "#546072";
        accent = "#6a788c";
      } else if (isBoulevardOrAvenueLaneAt(world, x, y)) {
        // Glowing orange boulevard/avenue curb lane line
        color = "#c46224";
        accent = "#3c4759";
      } else {
        // Road asphalt (readable broken asphalt tones #3c4759 / #4a576c against the pitch-black Void)
        color = stTier === 4 ? "#3c4759" : r < 0.25 ? "#4a576c" : "#3c4759";
        accent = isBoulevardOrAvenueLaneAt(world, x + 1, y) || isBoulevardOrAvenueLaneAt(world, x - 1, y) ||
          isBoulevardOrAvenueLaneAt(world, x, y + 1) || isBoulevardOrAvenueLaneAt(world, x, y - 1)
          ? "#c46224"
          : "#56647a";
      }
    }
  } else if (prevMat === CellMaterial.PARK || prevCover !== LandCover.NONE) {
    // 5. Countryside & parks: sample actual paintCell grass, forest canopy, wheat/crops, orchards, and silos
    const patch = valueNoise(x * 0.14 + (world.seed & 255), y * 0.14);
    switch (prevCover) {
      case LandCover.NONE:
        color = patch > 0.55 ? "#294a33" : "#223d2b";
        accent = "#3a6647";
        break;
      case LandCover.FOREST: {
        const canopy = valueNoise(x * 0.38 + (world.seed & 127), y * 0.38);
        color = canopy > 0.64 ? "#3a6e3b" : canopy > 0.36 ? "#29542e" : "#1c3d22";
        accent = "#4b874c";
        break;
      }
      case LandCover.FIELD_H:
        color = y % 3 === 0 ? farmSoilColor(x, y, prevCover, 0) : "#d4ad4c";
        accent = "#e6c86e";
        break;
      case LandCover.FIELD_V:
        color = x % 3 === 0 ? farmSoilColor(x, y, prevCover, 0) : "#b8c24e";
        accent = "#dce376";
        break;
      case LandCover.ORCHARD: {
        const gx = Math.floor(x / 4);
        const gy = Math.floor(y / 4);
        const jx = (gx * 73 + gy * 37 + world.seed) & 1;
        const jy = (gx * 29 + gy * 83 + world.seed) & 1;
        const cx = gx * 4 + 1 + jx;
        const cy = gy * 4 + 1 + jy;
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1.3) {
          const fleck = (x * 31 + y * 17 + world.seed) & 15;
          color = fleck === 0 ? "#d97a3e" : fleck === 1 ? "#e6ad4c" : dx + dy <= 0 ? "#4a8c42" : "#346e38";
        } else if (d2 <= 2.6) {
          color = dx + dy <= 0 ? "#38733b" : "#26522b";
        } else {
          color = patch > 0.55 ? "#466e30" : "#3b5e28";
        }
        accent = "#588f46";
        break;
      }
      case LandCover.SILO: {
        const leftSilo = x > 0 && world.landCover[idx - 1] === LandCover.SILO;
        const rightSilo = x + 1 < w && world.landCover[idx + 1] === LandCover.SILO;
        color = !leftSilo ? "#cfd8e3" : !rightSilo ? "#55606d" : "#8b96a6";
        accent = "#cfd8e3";
        break;
      }
      case LandCover.RIVER:
        color = r < 0.2 ? "#4a9bd1" : "#2b6ca3";
        accent = "#58b0e6";
        break;
      default:
        color = patch > 0.65 ? "#507d39" : patch > 0.35 ? "#467032" : "#3d632b";
        accent = "#639649";
        break;
    }
  } else if (prevMat === CellMaterial.BUILDING || prevMat === CellMaterial.SKYSCRAPER) {
    color = prevMat === CellMaterial.SKYSCRAPER ? "#48688c" : "#64584e";
    accent = "#7a94b8";
  }

  return {
    color,
    accent,
    rgb: parseHexRgb255(color),
    accentRgb: parseHexRgb255(accent),
  };
}

/** Continuous thermal color ramp (`heat` in `0..1`):
 * Blends the cell's true source color `(sr, sg, sb)` smoothly through:
 * - `0.00 .. 0.18`: 100% -> 82% true source color warming slightly toward dull glowing ember
 * - `0.18 .. 0.44`: dull dark red (`168, 34, 18`) -> glowing crimson-orange (`232, 84, 24`)
 * - `0.44 .. 0.70`: molten orange (`252, 134, 32`) -> incandescent yellow-white (`255, 224, 132`)
 * - `0.70 .. 1.00`: shifts into the Void's event-horizon magenta-violet (`218, 68, 224` -> `156, 48, 236`).
 * When `cheap === true` (Low quality tier), uses a fast 3-segment piecewise linear ramp. */
export function evaluateFluidHeatColor(
  sr: number,
  sg: number,
  sb: number,
  heat: number,
  cheap = false,
): [number, number, number] {
  if (heat <= 0.02) return [sr, sg, sb];
  const h = Math.min(1, Math.max(0, heat));

  if (cheap) {
    if (h < 0.45) {
      const t = h / 0.45;
      return [
        sr + (235 - sr) * t,
        sg + (92 - sg) * t,
        sb + (24 - sb) * t,
      ];
    }
    if (h < 0.76) {
      const t = (h - 0.45) / 0.31;
      return [
        235 + (255 - 235) * t,
        92 + (208 - 92) * t,
        24 + (112 - 24) * t,
      ];
    }
    const t = (h - 0.76) / 0.24;
    return [
      255 + (174 - 255) * t,
      208 + (56 - 208) * t,
      112 + (236 - 112) * t,
    ];
  }

  // Smooth multi-stop blackbody-to-Void-violet ramp while preserving source color in the cool/warm transition
  let hr: number;
  let hg: number;
  let hb: number;
  if (h < 0.36) {
    // Dull dark red (156, 28, 16) -> ember red-orange (234, 78, 22)
    const u = h / 0.36;
    hr = 156 + (234 - 156) * u;
    hg = 28 + (78 - 28) * u;
    hb = 16 + (22 - 16) * u;
  } else if (h < 0.64) {
    // Ember red-orange (234, 78, 22) -> molten orange (255, 148, 36) -> yellow-white (255, 232, 148)
    const u = (h - 0.36) / 0.28;
    if (u < 0.58) {
      const v = u / 0.58;
      hr = 234 + (255 - 234) * v;
      hg = 78 + (148 - 78) * v;
      hb = 22 + (36 - 22) * v;
    } else {
      const v = (u - 0.58) / 0.42;
      hr = 255;
      hg = 148 + (232 - 148) * v;
      hb = 36 + (148 - 36) * v;
    }
  } else if (h < 0.84) {
    // Yellow-white (255, 232, 148) -> hot neon magenta-rose (238, 76, 198)
    const u = (h - 0.64) / 0.20;
    hr = 255 + (238 - 255) * u;
    hg = 232 + (76 - 232) * u;
    hb = 148 + (198 - 148) * u;
  } else {
    // Hot magenta-rose (238, 76, 198) -> deep Void horizon violet (162, 52, 238)
    const u = (h - 0.84) / 0.16;
    hr = 238 + (162 - 238) * u;
    hg = 76 + (52 - 76) * u;
    hb = 198 + (238 - 198) * u;
  }

  // Blend weight from true source color to thermal ramp:
  // Below h = 0.22, true source color dominates (> 85%); between 0.22 and 0.56 it heats into glowing dark red -> orange -> yellow-white trails
  const rawMix = Math.min(1, Math.max(0, (h - 0.14) / 0.36));
  const mix = rawMix * rawMix * (3 - 2 * rawMix);
  return [
    sr + (hr - sr) * mix,
    sg + (hg - sg) * mix,
    sb + (hb - sb) * mix,
  ];
}

/** Deterministic 4x4 Bayer ordered dither matrix normalized to `[-0.5, +0.4375]`. */
const BAYER_4X4: readonly number[] = [
  0 / 16 - 0.5,  8 / 16 - 0.5,  2 / 16 - 0.5, 10 / 16 - 0.5,
  12 / 16 - 0.5, 4 / 16 - 0.5, 14 / 16 - 0.5,  6 / 16 - 0.5,
  3 / 16 - 0.5, 11 / 16 - 0.5,  1 / 16 - 0.5,  9 / 16 - 0.5,
  15 / 16 - 0.5, 7 / 16 - 0.5, 13 / 16 - 0.5,  5 / 16 - 0.5,
];

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
  r: number;
  g: number;
  b: number;
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
  /** True source RGB color channels (`0..255`) per cell, blended weighted by amount when streams merge. */
  colorR = new Float32Array(0);
  colorG = new Float32Array(0);
  colorB = new Float32Array(0);
  private nextColorR = new Float32Array(0);
  private nextColorG = new Float32Array(0);
  private nextColorB = new Float32Array(0);
  /** Advected per-cell thermal heat (`0..1`) that rises with dwell time, flow friction, and Void proximity. */
  heat = new Float32Array(0);
  private nextHeat = new Float32Array(0);
  /** Distance from detachment origin (`Float32Array`). */
  startDist = new Float32Array(0);
  private nextStartDist = new Float32Array(0);

  /** Precomputed flow field arrays (rebuilt only when active portals move, grow, or change). */
  flowVx = new Float32Array(0);
  flowVy = new Float32Array(0);
  flowSpeed = new Float32Array(0);
  flowDist = new Float32Array(0);
  flowAngle = new Float32Array(0);
  flowCoreR = new Float32Array(0);
  flowReachR = new Float32Array(0);
  flowSpiralPhase = new Float32Array(0);
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
    r: 255,
    g: 150,
    b: 50,
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

    // Preserve existing fluid cells (including RGB and heat) across grid resolution changes
    const oldCs = this.cellSize || 1;
    const oldGw = this.gridW;
    const oldGh = this.gridH;
    const oldMinX = Math.max(0, this.minX);
    const oldMaxX = Math.min(oldGw - 1, this.maxX);
    const oldMinY = Math.max(0, this.minY);
    const oldMaxY = Math.min(oldGh - 1, this.maxY);
    const savedCells: {
      wx: number;
      wy: number;
      amt: number;
      mat: FluidMaterialId;
      r: number;
      g: number;
      b: number;
      heat: number;
      sDist: number;
    }[] = [];
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
            r: this.colorR[oi],
            g: this.colorG[oi],
            b: this.colorB[oi],
            heat: this.heat[oi],
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
    this.colorR = new Float32Array(count);
    this.colorG = new Float32Array(count);
    this.colorB = new Float32Array(count);
    this.nextColorR = new Float32Array(count);
    this.nextColorG = new Float32Array(count);
    this.nextColorB = new Float32Array(count);
    this.heat = new Float32Array(count);
    this.nextHeat = new Float32Array(count);
    this.startDist = new Float32Array(count);
    this.nextStartDist = new Float32Array(count);

    this.flowVx = new Float32Array(count);
    this.flowVy = new Float32Array(count);
    this.flowSpeed = new Float32Array(count);
    this.flowDist = new Float32Array(count);
    this.flowAngle = new Float32Array(count);
    this.flowCoreR = new Float32Array(count);
    this.flowReachR = new Float32Array(count);
    this.flowSpiralPhase = new Float32Array(count);
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
              this.colorR[idx] = sc.r;
              this.colorG[idx] = sc.g;
              this.colorB[idx] = sc.b;
              this.heat[idx] = sc.heat;
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
          const prev = this.amount[idx];
          const next = Math.min(3.6, prev + sc.amt * 0.35);
          const wNew = (next - prev) / Math.max(0.001, next);
          this.amount[idx] = next;
          this.material[idx] = sc.mat;
          this.colorR[idx] = this.colorR[idx] * (1 - wNew) + sc.r * wNew;
          this.colorG[idx] = this.colorG[idx] * (1 - wNew) + sc.g * wNew;
          this.colorB[idx] = this.colorB[idx] * (1 - wNew) + sc.b * wNew;
          this.heat[idx] = Math.max(this.heat[idx], sc.heat);
          this.startDist[idx] = Math.max(this.startDist[idx], sc.sDist);
          if (gx < this.minX) this.minX = gx;
          if (gx > this.maxX) this.maxX = gx;
          if (gy < this.minY) this.minY = gy;
          if (gy > this.maxY) this.maxY = gy;
          if (prev <= 0.022) this.activeCellCount++;
        }
      }
    }
  }

  /** Clears all fluid cells and sparks. */
  clear(): void {
    this.amount.fill(0);
    this.material.fill(0);
    this.colorR.fill(0);
    this.colorG.fill(0);
    this.colorB.fill(0);
    this.heat.fill(0);
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

  /** Returns the current source RGB color `[r, g, b]` (`0..255`) stored at cell index `idx`. */
  getCellSourceRgb(idx: number): [number, number, number] {
    return [this.colorR[idx], this.colorG[idx], this.colorB[idx]];
  }

  /** Returns the current rendered thermal RGB color `[r, g, b]` (`0..255`) at cell index `idx` (blending source RGB with heat). */
  getCellRenderedRgb(idx: number, cheap = false): [number, number, number] {
    return evaluateFluidHeatColor(this.colorR[idx], this.colorG[idx], this.colorB[idx], this.heat[idx], cheap);
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
    const { flowVx, flowVy, flowSpeed, flowDist, flowAngle, flowCoreR, flowReachR, flowSpiralPhase } = this;

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
          const ang = Math.atan2(-dy, -dx);
          flowDist[idx] = d;
          flowAngle[idx] = ang;
          flowCoreR[idx] = 4.0;
          flowReachR[idx] = 28.0;
          flowSpiralPhase[idx] = Math.sin(ang * 4 + (d - 4.0) * 0.34);
          const nx = dx / d;
          const ny = dy / d;
          flowVx[idx] = nx * 8 - ny * 10;
          flowVy[idx] = ny * 8 + nx * 10;
          flowSpeed[idx] = Math.hypot(flowVx[idx], flowVy[idx]);
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
        const prox = Math.min(1, Math.max(0, 1 - (d - coreR) / Math.max(4, reachR - coreR)));
        const p2 = prox * prox;
        const radialSpeed = 5.5 + 9.5 * prox + 11.0 * p2;
        const tangentialSpeed = 7.4 + 14.0 * prox + 15.5 * p2;

        const rx = wx - bestP.x;
        const ry = wy - bestP.y;
        const inX = -rx / d;
        const inY = -ry / d;
        const tanX = -inY;
        const tanY = inX;

        const vx = inX * radialSpeed + tanX * tangentialSpeed;
        const vy = inY * radialSpeed + tanY * tangentialSpeed;
        const ang = Math.atan2(ry, rx);
        flowVx[idx] = vx;
        flowVy[idx] = vy;
        flowSpeed[idx] = Math.hypot(vx, vy);
        flowDist[idx] = bestD;
        flowAngle[idx] = ang;
        flowCoreR[idx] = coreR;
        flowReachR[idx] = reachR;
        flowSpiralPhase[idx] = Math.sin(ang * 4 + (bestD - coreR) * 0.34);
      }
    }
  }

  /** Deposits fluid amount at world coordinates `(wx, wy)` with source material `mat`, initial detachment
   * radius `sDist`, optional true source RGB (`sourceColor`: `#rrggbb` or `[r, g, b]`), and initial `initialHeat`. */
  depositAtWorld(
    wx: number,
    wy: number,
    addedAmount: number,
    mat: FluidMaterialId,
    sDist = 0,
    sourceColor?: string | readonly [number, number, number],
    initialHeat?: number,
  ): void {
    if (addedAmount <= 0 || mat === FluidMaterial.NONE) return;
    const { gridW, gridH, cellSize } = this;
    if (gridW === 0 || gridH === 0) return;
    // A coarse Low-quality cell covers 4 world pixels and catches 4x the deposits; unscaled it
    // saturates and fills the whole Void with an opaque disc. Dividing by 3 (not 4) offsets the
    // coarse grid's extra evaporation so Low keeps the same spiral arms as High.
    if (cellSize > 1) addedAmount /= 3;
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

    // Resolve true RGB from sourceColor or material default
    let sr: number;
    let sg: number;
    let sb: number;
    if (typeof sourceColor === "string") {
      [sr, sg, sb] = parseHexRgb255(sourceColor);
    } else if (sourceColor && sourceColor.length >= 3) {
      sr = sourceColor[0];
      sg = sourceColor[1];
      sb = sourceColor[2];
    } else {
      const def = FLUID_MATERIAL_PALETTES[mat]?.[0] ?? [92, 108, 132];
      sr = def[0];
      sg = def[1];
      sb = def[2];
    }

    const effStart = sDist > coreR + 2 ? sDist : Math.max(d, coreR + 6);
    const span = Math.max(4, effStart - coreR);
    // If initialHeat is not explicitly given, compute a realistic baseline from proximity so deposits near the core start hot
    // while deposits near the outer edge start cool (`heat = 0`) and preserve their true source color
    const uProx = Math.min(1, Math.max(0, 1 - (d - coreR) / span));
    const baseHeat =
      initialHeat !== undefined
        ? Math.min(1, Math.max(0, initialHeat))
        : uProx <= 0.16
          ? 0
          : Math.min(1, Math.pow((uProx - 0.16) / 0.84, 1.25) * 0.92);

    const stampCell = (cx: number, cy: number, amt: number, heatOffset = 0): void => {
      if (amt <= 0.005 || cx < 0 || cx >= gridW || cy < 0 || cy >= gridH) return;
      const cIdx = cy * gridW + cx;
      const cd = this.flowDist[cIdx] || d;
      const cCore = this.flowCoreR[cIdx] || coreR;
      if (cd <= cCore) return;
      const prev = this.amount[cIdx];
      if (prev <= 0.022 && prev + amt > 0.022) {
        this.activeCellCount++;
      }
      const total = prev + amt;
      const next = Math.min(3.6, total);
      const wNew = amt / Math.max(0.001, total);

      // Subtle deterministic per-cell variation (+/- 4 RGB) so a wide stream of one material keeps organic pixel texture
      const jitter = (((cx * 73 + cy * 37) & 7) - 3.5) * 1.1;
      const jr = Math.max(0, Math.min(255, sr + jitter));
      const jg = Math.max(0, Math.min(255, sg + jitter));
      const jb = Math.max(0, Math.min(255, sb + jitter));

      if (prev <= 0.01) {
        this.colorR[cIdx] = jr;
        this.colorG[cIdx] = jg;
        this.colorB[cIdx] = jb;
        this.heat[cIdx] = Math.min(1, Math.max(0, baseHeat + heatOffset));
      } else {
        this.colorR[cIdx] = this.colorR[cIdx] * (1 - wNew) + jr * wNew;
        this.colorG[cIdx] = this.colorG[cIdx] * (1 - wNew) + jg * wNew;
        this.colorB[cIdx] = this.colorB[cIdx] * (1 - wNew) + jb * wNew;
        this.heat[cIdx] = Math.min(1, this.heat[cIdx] * (1 - wNew) + Math.max(0, baseHeat + heatOffset) * wNew);
      }

      this.amount[cIdx] = next;
      if (prev < 0.05 || amt >= prev * 0.35) {
        this.material[cIdx] = mat;
      }
      this.startDist[cIdx] = prev > 0.05 ? Math.max(this.startDist[cIdx], effStart) : effStart;

      if (cx < this.minX) this.minX = cx;
      if (cx > this.maxX) this.maxX = cx;
      if (cy < this.minY) this.minY = cy;
      if (cy > this.maxY) this.maxY = cy;
    };

    if (addedAmount >= 0.45 && cellSize === 1) {
      // Stretch deposit slightly along the local spiral flow vector so dissolving chunks form elongated stream trails
      const vx = this.flowVx[idx];
      const vy = this.flowVy[idx];
      const vLen = this.flowSpeed[idx] || 1;
      const dirX = Math.round(vx / vLen);
      const dirY = Math.round(vy / vLen);
      stampCell(gx, gy, addedAmount * 0.72, 0);
      if (dirX !== 0 || dirY !== 0) {
        stampCell(gx + dirX, gy + dirY, addedAmount * 0.28, 0.02);
      }
    } else {
      stampCell(gx, gy, addedAmount, 0);
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
    sourceColor?: string | readonly [number, number, number],
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
    if (typeof sourceColor === "string") {
      [s.r, s.g, s.b] = parseHexRgb255(sourceColor);
    } else if (sourceColor && sourceColor.length >= 3) {
      s.r = sourceColor[0];
      s.g = sourceColor[1];
      s.b = sourceColor[2];
    } else {
      const pal = FLUID_MATERIAL_PALETTES[material] ?? FLUID_MATERIAL_PALETTES[FluidMaterial.CONCRETE];
      const rgb = pal[Math.min(FLUID_BAND_COUNT - 1, Math.max(3, band))];
      s.r = rgb[0];
      s.g = rgb[1];
      s.b = rgb[2];
    }
    s.life = 0;
    s.maxLife = maxLife;
  }

  /** Advances the fluid grid (amount, weighted RGB color, advected heat) and short-lived sparks by `dt` seconds
   * inside the active dirty bounding box. */
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
      colorR,
      colorG,
      colorB,
      nextColorR,
      nextColorG,
      nextColorB,
      heat,
      nextHeat,
      startDist,
      nextStartDist,
      flowVx,
      flowVy,
      flowSpeed,
      flowDist,
      flowCoreR,
    } = this;

    // Clear target window in scratch buffers (nextColorR/G/B and nextHeat accumulate mass-weighted sums: sum(amt * val))
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      nextAmount.fill(0, row + x0, row + x1 + 1);
      nextMaterial.fill(0, row + x0, row + x1 + 1);
      nextColorR.fill(0, row + x0, row + x1 + 1);
      nextColorG.fill(0, row + x0, row + x1 + 1);
      nextColorB.fill(0, row + x0, row + x1 + 1);
      nextHeat.fill(0, row + x0, row + x1 + 1);
      nextStartDist.fill(0, row + x0, row + x1 + 1);
    }

    const invCell = 1 / cellSize;
    const retention = Math.max(0.92, 1 - dt * 0.14);
    const activeCutoff = 0.022;

    const depositCell = (
      tx: number,
      ty: number,
      amt: number,
      mat: number,
      cr: number,
      cg: number,
      cb: number,
      hVal: number,
      sDist: number,
    ): void => {
      if (amt <= 0.004 || tx < 0 || tx >= gridW || ty < 0 || ty >= gridH) return;
      const tIdx = ty * gridW + tx;
      const d = flowDist[tIdx];
      const coreR = flowCoreR[tIdx];
      if (d <= coreR + 0.35) {
        this.consumedAmount += amt;
        this.consumedCells++;
        return;
      }
      const prev = nextAmount[tIdx];
      nextColorR[tIdx] += cr * amt;
      nextColorG[tIdx] += cg * amt;
      nextColorB[tIdx] += cb * amt;
      nextHeat[tIdx] += hVal * amt;
      nextAmount[tIdx] = prev + amt;
      if (prev < amt || nextMaterial[tIdx] === 0) {
        nextMaterial[tIdx] = mat;
      }
      if (sDist > nextStartDist[tIdx]) {
        nextStartDist[tIdx] = sDist;
      }
    };

    // Forward semi-Lagrangian advection + flow-aligned streak trail
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const amt = amount[idx];
        if (amt <= activeCutoff) continue;

        const d = flowDist[idx];
        const coreR = flowCoreR[idx];
        if (d <= coreR + 0.35) {
          this.consumedAmount += amt;
          this.consumedCells++;
          continue;
        }

        const mat = material[idx];
        const cr = colorR[idx];
        const cg = colorG[idx];
        const cb = colorB[idx];
        const sDist = Math.max(coreR + 5, startDist[idx] || d);
        const keptAmt = amt * retention;

        // Per-cell heat evolution:
        // 1. Time spent in the flow (dwell heating)
        // 2. Friction from faster flow speed (flowSpeed in 9..42 px/s)
        // 3. Proximity to the Void event horizon
        const spd = flowSpeed[idx];
        const prox = Math.min(1, Math.max(0, 1 - (d - coreR) / Math.max(4, sDist - coreR)));
        const frictionRate = Math.max(0, (spd - 10.0) * 0.016);
        const proxRate = prox * prox * 0.72;
        const dwellRate = 0.12;
        const pFloor = prox > 0.32 ? (prox - 0.32) * (1 / 0.68) : 0;
        const targetFloor = pFloor * pFloor * 0.86;
        let curHeat = heat[idx] + (dwellRate + frictionRate + proxRate) * dt;
        if (curHeat < targetFloor) curHeat = targetFloor;
        if (curHeat > 1) curHeat = 1;

        // Flow displacement in grid cells
        const vx = flowVx[idx] * dt * invCell * 0.85;
        const vy = flowVy[idx] * dt * invCell * 0.85;
        const magSq = vx * vx + vy * vy;
        const clampScale = magSq > 1.5625 ? 1.25 / Math.sqrt(magSq) : 1.0;
        const fx = gx + vx * clampScale;
        const fy = gy + vy * clampScale;

        const bx = Math.floor(fx);
        const by = Math.floor(fy);
        const tx = fx - bx;
        const ty = fy - by;

        // Stretch a trailing streak back to the origin cell (gx, gy) on denser stream filaments
        const hasTrail = keptAmt > 0.36;
        const trailShare = hasTrail ? 0.14 : 0;
        const coreMass = keptAmt * (1 - trailShare);
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        depositCell(bx, by, coreMass * w00, mat, cr, cg, cb, curHeat, sDist);
        depositCell(bx + 1, by, coreMass * w10, mat, cr, cg, cb, curHeat, sDist);
        depositCell(bx, by + 1, coreMass * w01, mat, cr, cg, cb, curHeat, sDist);
        depositCell(bx + 1, by + 1, coreMass * w11, mat, cr, cg, cb, curHeat, sDist);
        if (hasTrail) {
          depositCell(gx, gy, keptAmt * trailShare, mat, cr, cg, cb, curHeat * 0.96, sDist);
        }
      }
    }

    // Normalize weighted color & heat sums and compute tight active dirty bounding box
    let newMinX = gridW;
    let newMinY = gridH;
    let newMaxX = -1;
    let newMaxY = -1;
    let activeCount = 0;

    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const rawA = nextAmount[idx];
        if (rawA > activeCutoff) {
          const invA = 1 / rawA;
          amount[idx] = rawA > 3.6 ? 3.6 : rawA;
          material[idx] = nextMaterial[idx];
          const mixVar = (((gx * 29 + gy * 53) & 3) - 1.5) * 0.75;
          const r = nextColorR[idx] * invA + mixVar;
          const g = nextColorG[idx] * invA + mixVar;
          const b = nextColorB[idx] * invA + mixVar;
          colorR[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
          colorG[idx] = g < 0 ? 0 : g > 255 ? 255 : g;
          colorB[idx] = b < 0 ? 0 : b > 255 ? 255 : b;
          const h = nextHeat[idx] * invA;
          heat[idx] = h < 0 ? 0 : h > 1 ? 1 : h;
          startDist[idx] = nextStartDist[idx];
          activeCount++;
          if (gx < newMinX) newMinX = gx;
          if (gx > newMaxX) newMaxX = gx;
          if (gy < newMinY) newMinY = gy;
          if (gy > newMaxY) newMaxY = gy;
        } else {
          amount[idx] = 0;
          material[idx] = 0;
          colorR[idx] = 0;
          colorG[idx] = 0;
          colorB[idx] = 0;
          heat[idx] = 0;
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

  /** Computes the effective thermal heat (`0..1`) at cell `idx`, combining advected per-cell `heat[idx]`
   * with precomputed spiral flow filament modulation (no per-cell `Math.sin` or `Math.log`). */
  computeCellHeat(idx: number, animTime = 0): number {
    const hAdv = this.heat[idx];
    const d = this.flowDist[idx];
    const coreR = this.flowCoreR[idx] || 4.0;
    const sDist = Math.max(coreR + 5, this.startDist[idx] || this.flowReachR[idx] || 22);
    const span = Math.max(3.5, sDist - coreR);
    const uRaw = Math.min(1, Math.max(0, 1 - (d - coreR) / span));
    const uPos = uRaw * (0.45 + 0.55 * uRaw);
    const baseH = hAdv > 0.001 ? hAdv * 0.72 + uPos * 0.28 : uPos;
    const waveScale = 0.13 * (1 - uRaw * 0.55) * Math.min(1, uRaw * 2.6);
    const spiralWave = this.flowSpiralPhase[idx] * waveScale;
    const res = baseH + spiralWave;
    return res < 0 ? 0 : res > 1 ? 1 : res;
  }

  /** Backwards-compatible discrete band index (`0..6`) derived from continuous cell heat (`computeCellHeat`). */
  computeCellBand(idx: number, animTime = 0): number {
    const h = this.computeCellHeat(idx, animTime);
    return Math.min(FLUID_BAND_COUNT - 1, Math.floor(h * FLUID_BAND_COUNT));
  }

  /** Feeds emissive light from heated fluid trails into the half-resolution halo buffer
   * by strided low-res sampling (never per world cell), scaling smoothly with `heat`. */
  contributeToHalo(
    halo: Float32Array,
    haloW: number,
    haloH: number,
    neonIntensity = 1.0,
  ): number {
    if (this.maxX < this.minX || this.maxY < this.minY || haloW <= 0 || haloH <= 0) return 0;
    const { gridW, cellSize, amount, colorR, colorG, colorB } = this;
    const step = cellSize >= 2 ? 1 : 2;
    let samplesEmitted = 0;
    const gain = Math.min(1.45, 0.72 + neonIntensity * 0.38);
    const cheap = cellSize >= 2;

    for (let gy = this.minY; gy <= this.maxY; gy += step) {
      const wy = Math.floor((gy + 0.5) * cellSize);
      const hy = Math.max(0, Math.min(haloH - 1, wy >> 1));
      const row = gy * gridW;
      for (let gx = this.minX; gx <= this.maxX; gx += step) {
        const idx = row + gx;
        const amt = amount[idx];
        if (amt < 0.12) continue;
        const h = this.computeCellHeat(idx, 0);
        if (h <= 0.22) continue;

        const [r, g, b] = evaluateFluidHeatColor(colorR[idx], colorG[idx], colorB[idx], h, cheap);
        const heatNorm = (h - 0.22) / 0.78;
        const heatWeight = heatNorm * heatNorm * Math.min(1.25, amt * 0.95) * gain;

        const wx = Math.floor((gx + 0.5) * cellSize);
        const hx = Math.max(0, Math.min(haloW - 1, wx >> 1));
        const hi = (hy * haloW + hx) * 3;
        halo[hi] = Math.min(255, halo[hi] + r * heatWeight);
        halo[hi + 1] = Math.min(255, halo[hi + 1] + g * heatWeight);
        halo[hi + 2] = Math.min(255, halo[hi + 2] + b * heatWeight);
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
    const { gridW, gridH, cellSize, amount, colorR, colorG, colorB, flowDist, flowCoreR } = this;
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

    // Scene lighting for cool fluid (Time of Day ambient + sun + wet rain sheen)
    const sky = looseMaterialLight(preset);
    const isRain = weather === "rain" || wetness > 0.05;
    const wetSheen = isRain ? 1 + wetness * 0.14 : 1.0;
    const lowTier = cellSize >= 2;
    const effTime = reduceEffects ? 0 : animTime;

    let drawMinX = gridW;
    let drawMinY = gridH;
    let drawMaxX = -1;
    let drawMaxY = -1;
    let drawnCells = 0;

    if (hasFluid && bx1 >= bx0 && by1 >= by0) {
      this.syncFlowField(world);
      for (let gy = by0; gy <= by1; gy++) {
        const row = gy * gridW;
        const bayerRow = (gy & 3) << 2;
        for (let gx = bx0; gx <= bx1; gx++) {
          const idx = row + gx;
          const amt = amount[idx];
          if (amt <= 0.025) {
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

          // 1. Continuous heat & thermal ramp from true source color
          const h = this.computeCellHeat(idx, effTime);
          let baseR: number;
          let baseG: number;
          let baseB: number;
          if (h <= 0.02) {
            baseR = colorR[idx];
            baseG = colorG[idx];
            baseB = colorB[idx];
          } else if (lowTier) {
            if (h < 0.45) {
              const t = h * (1 / 0.45);
              baseR = colorR[idx] + (235 - colorR[idx]) * t;
              baseG = colorG[idx] + (92 - colorG[idx]) * t;
              baseB = colorB[idx] + (24 - colorB[idx]) * t;
            } else if (h < 0.76) {
              const t = (h - 0.45) * (1 / 0.31);
              baseR = 235 + 20 * t;
              baseG = 92 + 116 * t;
              baseB = 24 + 88 * t;
            } else {
              const t = (h - 0.76) * (1 / 0.24);
              baseR = 255 - 81 * t;
              baseG = 208 - 152 * t;
              baseB = 112 + 124 * t;
            }
          } else {
            let hr: number;
            let hg: number;
            let hb: number;
            if (h < 0.36) {
              const u = h * (1 / 0.36);
              hr = 156 + 78 * u;
              hg = 28 + 50 * u;
              hb = 16 + 6 * u;
            } else if (h < 0.64) {
              const u = (h - 0.36) * (1 / 0.28);
              if (u < 0.58) {
                const v = u * (1 / 0.58);
                hr = 234 + 21 * v;
                hg = 78 + 70 * v;
                hb = 22 + 14 * v;
              } else {
                const v = (u - 0.58) * (1 / 0.42);
                hr = 255;
                hg = 148 + 84 * v;
                hb = 36 + 112 * v;
              }
            } else if (h < 0.84) {
              const u = (h - 0.64) * 5;
              hr = 255 - 17 * u;
              hg = 232 - 156 * u;
              hb = 148 + 50 * u;
            } else {
              const u = (h - 0.84) * (1 / 0.16);
              hr = 238 - 76 * u;
              hg = 76 - 24 * u;
              hb = 198 + 40 * u;
            }
            const rawMix = h <= 0.14 ? 0 : h >= 0.50 ? 1 : (h - 0.14) * (1 / 0.36);
            const mix = rawMix * rawMix * (3 - 2 * rawMix);
            const sr = colorR[idx];
            const sg = colorG[idx];
            const sb = colorB[idx];
            baseR = sr + (hr - sr) * mix;
            baseG = sg + (hg - sg) * mix;
            baseB = sb + (hb - sb) * mix;
          }

          // 2. Smooth emissive transition: cool fluid is lit by scene sky/sun; hot fluid glows with self-emission
          const emission = h <= 0.05 ? 0 : Math.min(1, h * h * 1.1);
          let litR = baseR * (sky[0] + (1 - sky[0]) * emission);
          let litG = baseG * (sky[1] + (1 - sky[1]) * emission);
          let litB = baseB * (sky[2] + (1 - sky[2]) * emission);

          // 3. Liquid depth, sunward/outer highlight, and inner-side shadow edge
          const nAmt = gy > 0 ? amount[idx - gridW] : 0;
          const wAmt = gx > 0 ? amount[idx - 1] : 0;
          const sAmt = gy + 1 < gridH ? amount[idx + gridW] : 0;
          const eAmt = gx + 1 < gridW ? amount[idx + 1] : 0;

          const isSunwardEdge = amt >= 0.12 && (nAmt < amt * 0.58 || wAmt < amt * 0.58);
          const isInnerShadowEdge = !isSunwardEdge && amt >= 0.12 && (sAmt < amt * 0.52 || eAmt < amt * 0.52);

          // Slight depth darkening as cool/warm fluid gets deeper (`amt > 0.85`) so streams feel like thick glossy liquid
          const deepDarken = amt > 0.85 ? Math.max(0.76, 1 - (amt - 0.85) * 0.14 * (1 - emission * 0.7)) : 1.0;
          let shadeScale = (0.85 + 0.24 * Math.min(1, amt * 1.1)) * deepDarken * wetSheen;
          let specularAdd = 0;

          if (isSunwardEdge) {
            shadeScale *= 1.14;
            specularAdd = isRain ? 24 : 18;
          } else if (isInnerShadowEdge) {
            shadeScale *= 0.80;
          }

          // Hot core incandescence boost so hot trails visibly glow at night and read crisply in daylight
          const hotBoost = h > 0.45 ? (h - 0.45) * 48 : 0;
          litR = litR * shadeScale + specularAdd + hotBoost;
          litG = litG * shadeScale + specularAdd * 0.92 + hotBoost * 0.65;
          litB = litB * shadeScale + specularAdd * 1.08 + hotBoost * (h > 0.74 ? 1.15 : 0.35);

          // 4. Deterministic 4x4 Bayer ordered dithering on color and continuous alpha (skipped on Low quality)
          const bayer = lowTier ? 0 : BAYER_4X4[bayerRow + (gx & 3)];
          const colorDither = bayer * 10;

          // Continuous alpha by amount with ordered Bayer dither at thin edges so trails taper without hard steps
          const rawAlpha = amt >= 0.58 ? 1.0 : amt >= 0.20 ? 0.62 + (amt - 0.20) * 1.0 : amt * 3.1;
          const ditheredAlpha = Math.max(0, Math.min(255, ((rawAlpha + bayer * 0.15) * 255) | 0));
          if (ditheredAlpha <= 18) {
            rasterU32[idx] = 0;
            continue;
          }

          const r = Math.min(255, Math.max(0, (litR + colorDither + 0.5) | 0));
          const g = Math.min(255, Math.max(0, (litG + colorDither + 0.5) | 0));
          const b = Math.min(255, Math.max(0, (litB + colorDither + 0.5) | 0));

          rasterU32[idx] = packAbgr(r, g, b, ditheredAlpha);
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
        const lifeRatio = s.life / Math.max(0.05, s.maxLife);
        const [sr, sg, sb] = evaluateFluidHeatColor(s.r, s.g, s.b, Math.min(1, 0.45 + lifeRatio * 0.5), lowTier);
        const fade = Math.max(40, Math.min(250, Math.round((1 - lifeRatio * 0.65) * 250)));
        rasterU32[idx] = packAbgr(
          Math.min(255, Math.round(sr + 36)),
          Math.min(255, Math.round(sg + 28)),
          Math.min(255, Math.round(sb + 38)),
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

      // Wipe the blitted rect so pixels from cells that drained or sparks that moved never reappear as ghosts
      for (let gy = drawMinY; gy <= drawMaxY; gy++) {
        const row = gy * gridW;
        rasterU32.fill(0, row + drawMinX, row + drawMaxX + 1);
      }
    } else {
      for (let i = 0; i < touchedSparks.length; i++) rasterU32[touchedSparks[i]] = 0;
    }

    return { drawnCells, drawnSparks };
  }
}

/** Deterministic helper to pick a crack count (2..4) for a melting chunk. */
export function chunkCrackCount(seed: number, cellIdx: number, size: number): number {
  const h = hash01(seed, 619, cellIdx, Math.round(size * 10));
  return size >= 2.5 ? (h < 0.45 ? 3 : 4) : h < 0.55 ? 2 : 3;
}
