/** Deterministic parcel-grid Void accretion fluid and short-lived flair sparks for Void Defense.
 *
 * Ground the Void eats tears loose in its own colors, stretches into irregular streams, and heats as it falls in:
 * 1. True Source Color: each parcel stores the real RGB (`colorR`, `colorG`, `colorB`) sampled from the tile or
 *    building sprite it came from (`sampleSourceCellColors`), plus `amount`, `material`, `heat` and a `grain`.
 * 2. Exact Parcels: each cell holds one parcel with a sub-cell position (`offX`, `offY`). Parcels move exactly along
 *    the inflow plus time-varying noise turbulence (curl eddies and strand-gathering slope), so matter never blurs
 *    into a disc. Converging parcels merge weighted by amount; each cell crossing leaves `TRAIL_SHARE` behind,
 *    which stretches clumps into tapering streams.
 * 3. Heat: rises with time in the flow, friction, and closeness to the hole over `fluidHeatSpan`, so a big Void
 *    keeps ground colors far out and only the last stretch glows red -> orange -> white-hot, turning violet at the
 *    horizon. Hot matter is self-emissive and feeds the half-resolution halo buffer.
 * 4. Render: a tent-smoothed density fuses neighbouring parcels into ribbons with hard pixel edges, lit top edges
 *    and shadowed undersides, per-clump grain and stepped alpha, in one `ImageData` blit.
 */

import { dist } from "../exact.ts";
import { PARKING_STREET_TIER } from "./config.ts";
import {
  ARCH_PALETTES,
  facadeColorAt,
  floorsToElevation,
  roofColorAt,
} from "./elevation.ts";
import { farmSoilColor, isWheat } from "./farms.ts";
import { hash01 } from "./grid.ts";
import { isOccludedByLedge } from "./ledge.ts";
import {
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
      color = (x + y) % 3 === 0 ? "#384656" : "#2f3b4a";
      accent = "#4e5e72";
    } else {
      const kerb =
        (x > 0 && world.buildingAt[idx - 1] >= 0) ||
        (x + 1 < w && world.buildingAt[idx + 1] >= 0) ||
        (y > 0 && world.buildingAt[idx - w] >= 0) ||
        (y + 1 < h && world.buildingAt[idx + w] >= 0);
      if (kerb) {
        // Sidewalk kerb slab
        color = "#546072";
        accent = "#6a788c";
      } else {
        // Road asphalt (readable broken asphalt tones #3c4759 / #4a576c against the pitch-black Void)
        color = stTier === 4 ? "#3c4759" : r < 0.25 ? "#4a576c" : "#3c4759";
        accent = "#56647a";
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
  const out = new Float32Array(3);
  heatColorInto(out, sr, sg, sb, heat, cheap);
  return [out[0], out[1], out[2]];
}

/** Allocation-free `evaluateFluidHeatColor`: writes `[r, g, b]` into `out`. */
export function heatColorInto(
  out: Float32Array,
  sr: number,
  sg: number,
  sb: number,
  heat: number,
  cheap = false,
): void {
  if (heat <= 0.02) {
    out[0] = sr;
    out[1] = sg;
    out[2] = sb;
    return;
  }
  const h = Math.min(1, Math.max(0, heat));

  if (cheap) {
    if (h < 0.45) {
      const t = h / 0.45;
      out[0] = sr + (235 - sr) * t;
      out[1] = sg + (92 - sg) * t;
      out[2] = sb + (24 - sb) * t;
    } else if (h < 0.76) {
      const t = (h - 0.45) / 0.31;
      out[0] = 235 + (255 - 235) * t;
      out[1] = 92 + (208 - 92) * t;
      out[2] = 24 + (112 - 24) * t;
    } else {
      const t = (h - 0.76) / 0.24;
      out[0] = 255 + (174 - 255) * t;
      out[1] = 208 + (56 - 208) * t;
      out[2] = 112 + (236 - 112) * t;
    }
    return;
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
  out[0] = sr + (hr - sr) * mix;
  out[1] = sg + (hg - sg) * mix;
  out[2] = sb + (hb - sb) * mix;
}

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

/** Smallest `amount` a cell keeps; anything thinner drains away. */
const ACTIVE_CUTOFF = 0.02;
/** Densest a cell gets; converging parcels past this feed the Void sink. */
const MAX_CELL_AMOUNT = 4;
/** Share of a parcel left in its old cell when it crosses into a new one. Repeated every crossing, this
 * stretches each torn clump into a tapering stream behind it instead of smearing it into a disc. */
const TRAIL_SHARE = 0.17;
/** Turbulence noise scale: converts the potential's per-pixel slope into roughly unit flow speed. */
const TURB_GAIN = 8;
/** Smoothed density a pixel needs before it is drawn: lone dust grains stay invisible, strands fuse. */
const DRAW_DENSITY = 0.26;

/** Distance over which fluid heats from its source color to white-hot: the distance it was torn from, capped
 * so matter in a huge Void stays its own color until it nears the black hole. */
export function fluidHeatSpan(coreR: number, startDist: number): number {
  return Math.max(4, Math.min(startDist - coreR, 14 + coreR * 1.7));
}

/** Writes the continuous thermal ramp (see `evaluateFluidHeatColor`) into `out` without allocating. */
const heatScratch = new Float32Array(3);

export class VoidFluidGrid {
  w = 0;
  h = 0;
  /** Fluid cell size in world pixels (`1` on High/Medium; `2` on Low). */
  cellSize = 1;
  gridW = 0;
  gridH = 0;

  /** Fluid density amount per cell (`0..4`). */
  amount = new Float32Array(0);
  private nextAmount = new Float32Array(0);
  /** Dominant source material index (`FluidMaterialId`, `0..6`) per cell. */
  material = new Uint8Array(0);
  private nextMaterial = new Uint8Array(0);
  /** True source RGB color channels (`0..255`) per cell, blended weighted by amount when parcels merge. */
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
  /** Sub-cell position (`0..1`) of the parcel each cell holds. Parcels move exactly and never blur. */
  offX = new Float32Array(0);
  offY = new Float32Array(0);
  private nextOffX = new Float32Array(0);
  private nextOffY = new Float32Array(0);
  /** Per-parcel brightness grain (`0..255`) that travels with the matter, so torn clumps keep a lumpy texture. */
  grain = new Uint8Array(0);
  private nextGrain = new Uint8Array(0);

  /** Precomputed base inflow (rebuilt only when active portals move, grow, or change). */
  flowVx = new Float32Array(0);
  flowVy = new Float32Array(0);
  flowSpeed = new Float32Array(0);
  flowDist = new Float32Array(0);
  flowCoreR = new Float32Array(0);
  /** Turbulence speed (px/s) per cell: strong at the rim where ground tears loose, calmer near the core. */
  flowTurb = new Float32Array(0);
  /** Two world-space turbulence fields (curl + converging slope of a noise potential), blended over time. */
  private turbAx = new Float32Array(0);
  private turbAy = new Float32Array(0);
  private turbBx = new Float32Array(0);
  private turbBy = new Float32Array(0);
  private turbBuilt = false;
  private flowSignature = "";
  flowRebuilds = 0;
  /** Seconds of simulated flow, which drives the turbulence blend deterministically. */
  simTime = 0;

  /** Active dirty bounding box in fluid grid coordinates (`[minX..maxX, minY..maxY]`, inclusive). */
  minX = 0;
  minY = 0;
  maxX = -1;
  maxY = -1;
  activeCellCount = 0;

  /** Total fluid mass consumed at the event horizon (feeds the same sink as legacy debris). */
  consumedAmount = 0;
  consumedCells = 0;

  /** Short-lived bright flashes where fluid streams cross the event horizon ring. */
  readonly horizonFlashes: { active: boolean; x: number; y: number; life: number; maxLife: number }[] =
    Array.from({ length: 48 }, () => ({ active: false, x: 0, y: 0, life: 0, maxLife: 0.16 }));
  private flashCursor = 0;

  private spawnHorizonFlash(wx: number, wy: number): void {
    const f = this.horizonFlashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.horizonFlashes.length;
    f.active = true;
    f.x = wx;
    f.y = wy;
    f.life = 0;
    f.maxLife = 0.16;
  }

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
  /** Horizontal pass of the render's smoothed density. */
  private densH = new Float32Array(0);
  private imageData: ImageData | null = null;
  private readonly touchedSparks: number[] = [];
  /** Per-16x16-chunk mask of tiles with hot emissive fluid (including 4 px blur margin). */
  private hotTiles = new Uint8Array(0);
  private hotTilesW = 0;
  private hotTilesH = 0;
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
      grain: number;
    }[] = [];
    if (this.w === worldW && this.h === worldH && this.amount.length > 0 && oldMaxX >= oldMinX && oldMaxY >= oldMinY) {
      for (let oy = oldMinY; oy <= oldMaxY; oy++) {
        const row = oy * oldGw;
        for (let ox = oldMinX; ox <= oldMaxX; ox++) {
          const oi = row + ox;
          const a = this.amount[oi];
          if (a <= 0.015) continue;
          savedCells.push({
            wx: (ox + this.offX[oi]) * oldCs,
            wy: (oy + this.offY[oi]) * oldCs,
            amt: a,
            mat: this.material[oi] as FluidMaterialId,
            r: this.colorR[oi],
            g: this.colorG[oi],
            b: this.colorB[oi],
            heat: this.heat[oi],
            sDist: this.startDist[oi],
            grain: this.grain[oi],
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
    this.offX = new Float32Array(count);
    this.offY = new Float32Array(count);
    this.nextOffX = new Float32Array(count);
    this.nextOffY = new Float32Array(count);
    this.grain = new Uint8Array(count);
    this.nextGrain = new Uint8Array(count);

    this.flowVx = new Float32Array(count);
    this.flowVy = new Float32Array(count);
    this.flowSpeed = new Float32Array(count);
    this.flowDist = new Float32Array(count);
    this.flowCoreR = new Float32Array(count);
    this.flowTurb = new Float32Array(count);
    this.turbAx = new Float32Array(count);
    this.turbAy = new Float32Array(count);
    this.turbBx = new Float32Array(count);
    this.turbBy = new Float32Array(count);
    this.turbBuilt = false;
    this.flowSignature = "";

    this.rasterU32 = new Uint32Array(count);
    this.densH = new Float32Array(count);
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
    this.hotTilesW = Math.ceil(worldW / 16);
    this.hotTilesH = Math.ceil(worldH / 16);
    this.hotTiles = new Uint8Array(this.hotTilesW * this.hotTilesH);

    for (let i = 0; i < savedCells.length; i++) {
      const sc = savedCells[i];
      const fx = sc.wx / cs;
      const fy = sc.wy / cs;
      const gx = Math.floor(fx);
      const gy = Math.floor(fy);
      if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
      // A finer grid holds each coarse parcel in one cell; a coarser grid merges up to four parcels
      const amt = cs < oldCs ? sc.amt : sc.amt * 0.35;
      this.mergeParcel(gy * gw + gx, gx, gy, amt, sc.mat, sc.r, sc.g, sc.b, sc.heat, sc.sDist, fx - gx, fy - gy, sc.grain);
    }
  }

  /** Adds a parcel into the live arrays (outside `step`), blending color, heat and sub-cell position by amount. */
  private mergeParcel(
    idx: number,
    gx: number,
    gy: number,
    amt: number,
    mat: number,
    r: number,
    g: number,
    b: number,
    heat: number,
    sDist: number,
    ox: number,
    oy: number,
    grain: number,
  ): void {
    const prev = this.amount[idx];
    if (prev <= ACTIVE_CUTOFF && prev + amt > ACTIVE_CUTOFF) this.activeCellCount++;
    const total = prev + amt;
    const wNew = amt / Math.max(0.001, total);
    if (prev <= 0.01) {
      this.colorR[idx] = r;
      this.colorG[idx] = g;
      this.colorB[idx] = b;
      this.heat[idx] = heat;
      this.offX[idx] = ox;
      this.offY[idx] = oy;
      this.grain[idx] = grain;
      this.startDist[idx] = sDist;
    } else {
      this.colorR[idx] += (r - this.colorR[idx]) * wNew;
      this.colorG[idx] += (g - this.colorG[idx]) * wNew;
      this.colorB[idx] += (b - this.colorB[idx]) * wNew;
      this.heat[idx] += (heat - this.heat[idx]) * wNew;
      this.offX[idx] += (ox - this.offX[idx]) * wNew;
      this.offY[idx] += (oy - this.offY[idx]) * wNew;
      if (wNew > 0.5) this.grain[idx] = grain;
      if (sDist > this.startDist[idx]) this.startDist[idx] = sDist;
    }
    if (total > MAX_CELL_AMOUNT) {
      this.consumedAmount += total - MAX_CELL_AMOUNT;
      this.amount[idx] = MAX_CELL_AMOUNT;
    } else {
      this.amount[idx] = total;
    }
    if (prev < 0.05 || amt >= prev * 0.35) this.material[idx] = mat;
    if (gx < this.minX) this.minX = gx;
    if (gx > this.maxX) this.maxX = gx;
    if (gy < this.minY) this.minY = gy;
    if (gy > this.maxY) this.maxY = gy;
    if (this.amount[idx] >= 0.16 && this.heat[idx] > 0.34) this.markHotTile(gx, gy);
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
    this.offX.fill(0);
    this.offY.fill(0);
    this.grain.fill(0);
    this.minX = this.gridW;
    this.minY = this.gridH;
    this.maxX = -1;
    this.maxY = -1;
    this.activeCellCount = 0;
    this.hotTiles.fill(0);
    for (let i = 0; i < this.sparks.length; i++) {
      this.sparks[i].active = false;
    }
    for (let i = 0; i < this.horizonFlashes.length; i++) {
      this.horizonFlashes[i].active = false;
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

  /** Builds the two world-space turbulence fields once per grid size. Each is the curl of a two-octave value
   * noise potential (swirling eddies) plus some of its slope (which gathers matter into ragged filaments). */
  private buildTurbulence(): void {
    if (this.turbBuilt) return;
    this.turbBuilt = true;
    const { gridW, gridH, cellSize } = this;
    const count = gridW * gridH;
    const potential = new Float32Array(count);
    const fields: [Float32Array, Float32Array, number, number][] = [
      [this.turbAx, this.turbAy, 37.1, 11.3],
      [this.turbBx, this.turbBy, 191.7, 73.9],
    ];
    const inv2 = TURB_GAIN / (2 * cellSize);
    for (const [outX, outY, ox, oy] of fields) {
      for (let gy = 0; gy < gridH; gy++) {
        const wy = (gy + 0.5) * cellSize;
        for (let gx = 0; gx < gridW; gx++) {
          const wx = (gx + 0.5) * cellSize;
          potential[gy * gridW + gx] =
            valueNoise(wx / 15 + ox, wy / 15 + oy) + 0.5 * valueNoise(wx / 6.5 + oy, wy / 6.5 + ox);
        }
      }
      for (let gy = 0; gy < gridH; gy++) {
        const up = Math.max(0, gy - 1) * gridW;
        const dn = Math.min(gridH - 1, gy + 1) * gridW;
        const row = gy * gridW;
        for (let gx = 0; gx < gridW; gx++) {
          const l = Math.max(0, gx - 1);
          const r = Math.min(gridW - 1, gx + 1);
          const dPx = (potential[row + r] - potential[row + l]) * inv2;
          const dPy = (potential[dn + gx] - potential[up + gx]) * inv2;
          // Curl (dPy, -dPx) swirls; the slope term (gradient) pulls matter together into strands and clumps.
          outX[row + gx] = dPy * 0.85 + dPx * 0.9;
          outY[row + gx] = -dPx * 0.85 + dPy * 0.9;
        }
      }
    }
  }

  /** Rebuilds the precomputed accretion inflow ONLY when active portals move, grow, or activate. */
  syncFlowField(world: VoidWorld): void {
    this.ensureSize(world.grid.w, world.grid.h, this.cellSize || 1);
    this.buildTurbulence();
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

    const { gridW, gridH, cellSize, flowVx, flowVy, flowSpeed, flowDist, flowCoreR, flowTurb } = this;
    const fallback = { x: world.grid.w * 0.5, y: world.grid.h * 0.5, radius: 9.5 };

    for (let gy = 0; gy < gridH; gy++) {
      const wy = (gy + 0.5) * cellSize;
      const row = gy * gridW;
      for (let gx = 0; gx < gridW; gx++) {
        const wx = (gx + 0.5) * cellSize;
        const idx = row + gx;

        let best: { x: number; y: number; radius: number } = portals[0] ?? fallback;
        let bestD = dist(wx - best.x, wy - best.y);
        for (let i = 1; i < portals.length; i++) {
          const p = portals[i];
          const d = dist(wx - p.x, wy - p.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }

        const coreR = Math.max(3.6, best.radius * 0.42);
        const reachR = Math.max(coreR + 22, best.radius * 3.1);
        const d = Math.max(0.25, bestD);
        const prox = Math.min(1, Math.max(0, 1 - (d - coreR) / Math.max(4, reachR - coreR)));
        const p2 = prox * prox;
        // Matter falls steadily from the rim and only whips into orbit close to the hole, so it spirals in
        // about one turn instead of circling forever as rings.
        const radialSpeed = 9 + 9 * prox + 14 * p2;
        const tangentialSpeed = 5 + 13 * prox + 26 * p2;

        const inX = (best.x - wx) / d;
        const inY = (best.y - wy) / d;
        const vx = inX * radialSpeed - inY * tangentialSpeed;
        const vy = inY * radialSpeed + inX * tangentialSpeed;
        flowVx[idx] = vx;
        flowVy[idx] = vy;
        flowSpeed[idx] = Math.hypot(vx, vy);
        flowDist[idx] = bestD;
        flowCoreR[idx] = coreR;
        // Turbulence is strongest where ground tears loose and fades as the orbit takes over near the core
        const nearCore = Math.min(1, Math.max(0, (d - coreR) / 3));
        flowTurb[idx] = (8 + 10 * (1 - prox)) * nearCore;
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
    // saturates and fills the whole Void with an opaque disc.
    if (cellSize > 1) addedAmount /= 4;
    const fx = wx / cellSize;
    const fy = wy / cellSize;
    const gx = Math.floor(fx);
    const gy = Math.floor(fy);
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return;

    const idx = gy * gridW + gx;
    const coreR = this.flowCoreR[idx] || 4.0;
    const d = this.flowDist[idx] || sDist || 16;
    if (d <= coreR) {
      this.consumedAmount += addedAmount;
      this.consumedCells++;
      return;
    }

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
    const span = fluidHeatSpan(coreR, effStart);
    // Torn ground keeps its true color until it has fallen most of the way in, then heats toward the horizon
    const uProx = Math.min(1, Math.max(0, 1 - (d - coreR) / span));
    const baseHeat =
      initialHeat !== undefined
        ? Math.min(1, Math.max(0, initialHeat))
        : uProx <= 0.33
          ? 0
          : Math.min(1, Math.pow((uProx - 0.33) / 0.67, 1.18) * 0.94);

    // Each deposit is its own clump: its grain and a little color jitter travel with it
    const g = hash01(gx, gy, this.stepTick, Math.round(addedAmount * 64));
    const grain = (g * 255) | 0;
    const jitter = (g - 0.5) * 9;
    const jr = Math.max(0, Math.min(255, sr + jitter));
    const jg = Math.max(0, Math.min(255, sg + jitter));
    const jb = Math.max(0, Math.min(255, sb + jitter));

    const stamp = (cx: number, cy: number, amt: number, ox: number, oy: number, heatOffset: number): void => {
      if (amt <= 0.005 || cx < 0 || cx >= gridW || cy < 0 || cy >= gridH) return;
      const cIdx = cy * gridW + cx;
      if ((this.flowDist[cIdx] || d) <= (this.flowCoreR[cIdx] || coreR)) return;
      this.mergeParcel(cIdx, cx, cy, amt, mat, jr, jg, jb, Math.min(1, baseHeat + heatOffset), effStart, ox, oy, grain);
    };

    if (addedAmount >= 0.45 && cellSize === 1) {
      // A big deposit tears into a short smear along the inflow, the first stretch of a stream
      const vLen = this.flowSpeed[idx] || 1;
      const dirX = Math.round(this.flowVx[idx] / vLen);
      const dirY = Math.round(this.flowVy[idx] / vLen);
      stamp(gx, gy, addedAmount * 0.72, fx - gx, fy - gy, 0);
      if (dirX !== 0 || dirY !== 0) stamp(gx + dirX, gy + dirY, addedAmount * 0.28, 0.5, 0.5, 0.02);
    } else {
      stamp(gx, gy, addedAmount, fx - gx, fy - gy, 0);
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

  /** Advances the fluid by `dt` seconds inside the active dirty bounding box. Each cell holds one parcel with an
   * exact sub-cell position; parcels ride the inflow plus time-varying turbulence, merge where they converge,
   * and leave a share behind whenever they cross a cell, so clumps stretch into irregular tapering streams. */
  step(world: VoidWorld, dt: number): void {
    this.stepTick++;
    this.simTime += dt;
    this.syncFlowField(world);
    const { gridW, gridH, cellSize } = this;

    // 1. Step tiny flair sparks & horizon crossing flashes
    for (let i = 0; i < this.horizonFlashes.length; i++) {
      const f = this.horizonFlashes[i];
      if (!f.active) continue;
      f.life += dt;
      if (f.life >= f.maxLife) f.active = false;
    }
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

    const x0 = Math.max(0, this.minX - 2);
    const y0 = Math.max(0, this.minY - 2);
    const x1 = Math.min(gridW - 1, this.maxX + 2);
    const y1 = Math.min(gridH - 1, this.maxY + 2);

    const {
      amount, nextAmount, material, nextMaterial, colorR, colorG, colorB, nextColorR, nextColorG, nextColorB,
      heat, nextHeat, startDist, nextStartDist, offX, offY, nextOffX, nextOffY, grain, nextGrain,
      flowVx, flowVy, flowSpeed, flowDist, flowCoreR, flowTurb, turbAx, turbAy, turbBx, turbBy,
    } = this;

    // Scratch buffers accumulate mass-weighted sums: sum(amt * val)
    for (let gy = y0; gy <= y1; gy++) {
      const a = gy * gridW + x0;
      const b = gy * gridW + x1 + 1;
      nextAmount.fill(0, a, b);
      nextMaterial.fill(0, a, b);
      nextColorR.fill(0, a, b);
      nextColorG.fill(0, a, b);
      nextColorB.fill(0, a, b);
      nextHeat.fill(0, a, b);
      nextStartDist.fill(0, a, b);
      nextOffX.fill(0, a, b);
      nextOffY.fill(0, a, b);
    }

    const invCell = 1 / cellSize;
    // Matter barely thins on its way in: it is swallowed at the horizon, not evaporated
    const retention = 1 - dt * 0.07;
    // The two turbulence fields trade places slowly, so eddies and strands keep reshaping
    const phase = this.simTime * 0.21;
    const wA = Math.cos(phase);
    const wB = Math.sin(phase);

    const depositCell = (
      tx: number, ty: number, amt: number, mat: number, cr: number, cg: number, cb: number,
      hVal: number, sDist: number, ox: number, oy: number, gr: number,
    ): void => {
      if (amt <= 0.004 || tx < 0 || tx >= gridW || ty < 0 || ty >= gridH) return;
      const tIdx = ty * gridW + tx;
      if (flowDist[tIdx] <= flowCoreR[tIdx] + 0.35) {
        this.consumedAmount += amt;
        this.consumedCells++;
        if (amt >= 0.04) this.spawnHorizonFlash((tx + 0.5) * cellSize, (ty + 0.5) * cellSize);
        return;
      }
      const prev = nextAmount[tIdx];
      nextColorR[tIdx] += cr * amt;
      nextColorG[tIdx] += cg * amt;
      nextColorB[tIdx] += cb * amt;
      nextHeat[tIdx] += hVal * amt;
      nextOffX[tIdx] += ox * amt;
      nextOffY[tIdx] += oy * amt;
      nextAmount[tIdx] = prev + amt;
      if (prev < amt || nextMaterial[tIdx] === 0) {
        nextMaterial[tIdx] = mat;
        nextGrain[tIdx] = gr;
      }
      if (sDist > nextStartDist[tIdx]) nextStartDist[tIdx] = sDist;
    };

    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const amt = amount[idx];
        if (amt <= ACTIVE_CUTOFF) continue;

        const d = flowDist[idx];
        const coreR = flowCoreR[idx];
        if (d <= coreR + 0.35) {
          this.consumedAmount += amt;
          this.consumedCells++;
          if (amt >= 0.08) this.spawnHorizonFlash((gx + 0.5) * cellSize, (gy + 0.5) * cellSize);
          continue;
        }

        const mat = material[idx];
        const cr = colorR[idx];
        const cg = colorG[idx];
        const cb = colorB[idx];
        const sDist = Math.max(coreR + 5, startDist[idx] || d);
        const kept = amt * retention;

        // Heat rises with time in the flow, flow friction, and closeness to the hole
        const spd = flowSpeed[idx];
        const prox = Math.min(1, Math.max(0, 1 - (d - coreR) / fluidHeatSpan(coreR, sDist)));
        const frictionRate = prox > 0.25 ? Math.max(0, (spd - 10.0) * 0.018) : Math.max(0, (spd - 10.0) * 0.004);
        const proxRate = prox > 0.3 ? ((prox - 0.3) * (1 / 0.7)) ** 1.4 * 0.95 : 0;
        const dwellRate = prox > 0.3 ? 0.14 : 0.02;
        const pFloor = prox > 0.33 ? (prox - 0.33) * (1 / 0.67) : 0;
        const targetFloor = pFloor * pFloor * 0.92;
        let curHeat = heat[idx] + (dwellRate + frictionRate + proxRate) * dt;
        if (curHeat < targetFloor) curHeat = targetFloor;
        if (curHeat > 1) curHeat = 1;

        // Inflow plus blended turbulence, in cells this step (capped so a parcel never skips a cell)
        const turb = flowTurb[idx];
        let vx = (flowVx[idx] + turb * (wA * turbAx[idx] + wB * turbBx[idx])) * dt * invCell;
        let vy = (flowVy[idx] + turb * (wA * turbAy[idx] + wB * turbBy[idx])) * dt * invCell;
        const magSq = vx * vx + vy * vy;
        if (magSq > 1.5625) {
          const s = 1.25 / Math.sqrt(magSq);
          vx *= s;
          vy *= s;
        }
        const ox = offX[idx];
        const oy = offY[idx];
        const px = gx + ox + vx;
        const py = gy + oy + vy;
        const tx = Math.floor(px);
        const ty = Math.floor(py);
        const gr = grain[idx];
        if (tx === gx && ty === gy) {
          depositCell(gx, gy, kept, mat, cr, cg, cb, curHeat, sDist, px - tx, py - ty, gr);
        } else {
          const trail = kept * TRAIL_SHARE >= 0.03 ? kept * TRAIL_SHARE : 0;
          depositCell(tx, ty, kept - trail, mat, cr, cg, cb, curHeat, sDist, px - tx, py - ty, gr);
          if (trail > 0) depositCell(gx, gy, trail, mat, cr, cg, cb, curHeat * 0.97, sDist, ox, oy, gr);
        }
      }
    }

    // Normalize weighted sums and compute the tight active bounding box
    let newMinX = gridW;
    let newMinY = gridH;
    let newMaxX = -1;
    let newMaxY = -1;
    let activeCount = 0;
    this.hotTiles.fill(0);

    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * gridW;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        const rawA = nextAmount[idx];
        if (rawA > ACTIVE_CUTOFF) {
          const invA = 1 / rawA;
          let clampedA = rawA;
          if (rawA > MAX_CELL_AMOUNT) {
            this.consumedAmount += rawA - MAX_CELL_AMOUNT;
            clampedA = MAX_CELL_AMOUNT;
          }
          amount[idx] = clampedA;
          material[idx] = nextMaterial[idx];
          grain[idx] = nextGrain[idx];
          colorR[idx] = nextColorR[idx] * invA;
          colorG[idx] = nextColorG[idx] * invA;
          colorB[idx] = nextColorB[idx] * invA;
          const h = nextHeat[idx] * invA;
          const clampedH = h < 0 ? 0 : h > 1 ? 1 : h;
          heat[idx] = clampedH;
          startDist[idx] = nextStartDist[idx];
          const ox = nextOffX[idx] * invA;
          const oy = nextOffY[idx] * invA;
          offX[idx] = ox < 0 ? 0 : ox > 0.999 ? 0.999 : ox;
          offY[idx] = oy < 0 ? 0 : oy > 0.999 ? 0.999 : oy;
          activeCount++;
          if (gx < newMinX) newMinX = gx;
          if (gx > newMaxX) newMaxX = gx;
          if (gy < newMinY) newMinY = gy;
          if (gy > newMaxY) newMaxY = gy;
          if (clampedA >= 0.16 && clampedH > 0.34) this.markHotTile(gx, gy);
        } else {
          amount[idx] = 0;
          material[idx] = 0;
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

  private markHotTile(gx: number, gy: number): void {
    const cs = this.cellSize;
    const wx = gx * cs;
    const wy = gy * cs;
    const tx0 = Math.max(0, (wx - 4) >> 4);
    const tx1 = Math.min(this.hotTilesW - 1, (wx + cs + 4) >> 4);
    const ty0 = Math.max(0, (wy - 4) >> 4);
    const ty1 = Math.min(this.hotTilesH - 1, (wy + cs + 4) >> 4);
    for (let ty = ty0; ty <= ty1; ty++) {
      const row = ty * this.hotTilesW;
      for (let tx = tx0; tx <= tx1; tx++) {
        this.hotTiles[row + tx] = 1;
      }
    }
  }

  /** Fast O(1) check whether a 16x16 world tile (including 4 px halo blur margin) contains hot emissive fluid. */
  hasHotFluidInTile(tx: number, ty: number): boolean {
    if (this.maxX < this.minX || tx < 0 || ty < 0 || tx >= this.hotTilesW || ty >= this.hotTilesH) return false;
    return this.hotTiles[ty * this.hotTilesW + tx] === 1;
  }

  /** Effective thermal heat (`0..1`) at cell `idx`: the parcel's advected heat, eased toward how far it has fallen.
   * Keeps source color while matter is still far out, then ramps red -> orange -> yellow-white -> violet. */
  computeCellHeat(idx: number, _animTime = 0): number {
    const hAdv = this.heat[idx];
    const d = this.flowDist[idx];
    const coreR = this.flowCoreR[idx] || 4.0;
    const sDist = Math.max(coreR + 5, this.startDist[idx] || 22);
    const uRaw = Math.min(1, Math.max(0, 1 - (d - coreR) / fluidHeatSpan(coreR, sDist)));
    const uThird = uRaw <= 0.3 ? uRaw * 0.45 : 0.135 + (uRaw - 0.3) * (1 / 0.7) * 0.865;
    let res = hAdv > 0.001 ? hAdv * 0.68 + uThird * 0.32 : uThird;
    // White-hot is as far as matter gets until the last few pixels, where it turns Void violet and vanishes
    const rim = d - coreR;
    const cap = rim >= 5 ? 0.66 : 0.66 + (1 - rim / 5) * 0.34;
    if (res > cap) res = cap;
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
    const out = heatScratch;

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

        heatColorInto(out, colorR[idx], colorG[idx], colorB[idx], h, cheap);
        const heatNorm = (h - 0.22) / 0.78;
        const heatWeight = heatNorm * heatNorm * Math.min(1.25, amt * 0.95) * gain;

        const wx = Math.floor((gx + 0.5) * cellSize);
        const hx = Math.max(0, Math.min(haloW - 1, wx >> 1));
        const hi = (hy * haloW + hx) * 3;
        halo[hi] = Math.min(255, halo[hi] + out[0] * heatWeight);
        halo[hi + 1] = Math.min(255, halo[hi + 1] + out[1] * heatWeight);
        halo[hi + 2] = Math.min(255, halo[hi + 2] + out[2] * heatWeight);
        samplesEmitted++;
      }
    }
    return samplesEmitted;
  }

  /** Renders the active fluid and optional spark layer into one `ImageData` buffer and blits it to `targetCtx`
   * with a single `putImageData` + `drawImage` call. Each parcel is shaded as a clump of torn ground: its own
   * grain, a lit top edge and a shadowed underside where the stream thins, stepped pixel-art alpha for thin
   * tails, and self-emission once it heats near the hole. */
  render(
    targetCtx: CanvasRenderingContext2D,
    world: VoidWorld,
    preset: TimeOfDayPreset,
    weather: VoidWeatherMode,
    wetness: number,
    _animTime: number,
    reduceEffects: boolean,
    viewBounds?: { x0: number; y0: number; x1: number; y1: number },
  ): { drawnCells: number; drawnSparks: number } {
    this.ensureSize(world.grid.w, world.grid.h, this.cellSize || 1);
    const { gridW, gridH, cellSize, amount, colorR, colorG, colorB, flowDist, flowCoreR, grain } = this;
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

    // Scene lighting for cool matter (Time of Day ambient + wet rain sheen)
    const sky = looseMaterialLight(preset);
    const isRain = weather === "rain" || wetness > 0.05;
    const wetSheen = isRain ? 1 + wetness * 0.12 : 1.0;
    const lowTier = cellSize >= 2;
    // A coarse Low cell's tent spans four times the ground, so it needs more matter before it shows
    const drawDensity = lowTier ? DRAW_DENSITY * 2.2 : DRAW_DENSITY;
    const out = heatScratch;
    const worldW = world.grid.w;
    const worldH = world.grid.h;
    const mats = world.material;

    let drawMinX = gridW;
    let drawMinY = gridH;
    let drawMaxX = -1;
    let drawMaxY = -1;
    let drawnCells = 0;

    if (hasFluid && bx1 >= bx0 && by1 >= by0) {
      this.syncFlowField(world);
      // Smoothed density: a separable [1/2, 1, 1/2] tent over `amount`, so neighbouring parcels fuse into solid
      // ribbons with clean pixel edges, while a lone grain of dust stays below the draw threshold.
      const sx0 = Math.max(0, bx0 - 1);
      const sx1 = Math.min(gridW - 1, bx1 + 1);
      const sy0 = Math.max(0, by0 - 1);
      const sy1 = Math.min(gridH - 1, by1 + 1);
      const densH = this.densH;
      for (let gy = sy0; gy <= sy1; gy++) {
        const row = gy * gridW;
        for (let gx = sx0; gx <= sx1; gx++) {
          const i = row + gx;
          densH[i] = amount[i] + 0.5 * ((gx > 0 ? amount[i - 1] : 0) + (gx + 1 < gridW ? amount[i + 1] : 0));
        }
      }
      const densAt = (i: number, gy: number): number =>
        densH[i] + 0.5 * ((gy > sy0 ? densH[i - gridW] : 0) + (gy < sy1 ? densH[i + gridW] : 0));

      for (let gy = by0; gy <= by1; gy++) {
        const row = gy * gridW;
        const wy = Math.min(worldH - 1, Math.floor((gy + 0.5) * cellSize));
        for (let gx = bx0; gx <= bx1; gx++) {
          const idx = row + gx;
          if (densH[idx] <= 0.02 && (gy <= sy0 || densH[idx - gridW] <= 0.02) && (gy >= sy1 || densH[idx + gridW] <= 0.02)) {
            continue;
          }
          const dens = densAt(idx, gy);
          if (dens < drawDensity) continue;
          const d = flowDist[idx];
          const coreR = flowCoreR[idx] || 4.0;
          if (d <= coreR + 0.15) continue;

          // Only inside the Void (or open space), and hidden behind northern cliff walls
          const wx = Math.min(worldW - 1, Math.floor((gx + 0.5) * cellSize));
          const m = mats[wy * worldW + wx];
          if (m !== CellMaterial.VOID && m !== CellMaterial.EMPTY) continue;
          if (wy >= 1 && isOccludedByLedge(world, wx, wy)) continue;

          // Color comes from this cell's parcel, or the densest neighbour when this pixel only bridges a gap
          let src = idx;
          if (amount[idx] <= 0.03) {
            let best = 0;
            for (let oy = -1; oy <= 1; oy++) {
              const ny = gy + oy;
              if (ny < 0 || ny >= gridH) continue;
              for (let ox = -1; ox <= 1; ox++) {
                const nx = gx + ox;
                if (nx < 0 || nx >= gridW) continue;
                const a = amount[ny * gridW + nx];
                if (a > best) {
                  best = a;
                  src = ny * gridW + nx;
                }
              }
            }
          }

          // 1. Source color heated along the thermal ramp
          // Each clump heats a little unevenly, so molten streams flicker between orange and white-hot
          const hc = this.computeCellHeat(src, 0);
          let h = hc > 0.2 ? Math.min(1, hc + (grain[src] - 128) * (0.07 / 128)) : hc;
          // Away from the last few pixels of the horizon, hot matter holds in the molten-orange band
          // (only the hottest clumps flick toward yellow) instead of washing out to pale white
          if (h > 0.4 && h < 0.7) h = 0.4 + (h - 0.4) * 0.55 + (grain[src] - 128) * (0.025 / 128);
          // ...and stays molten right up to the horizon, skipping the pale yellow-white stretch of the ramp
          else if (h >= 0.7 && h < 0.84) h = 0.56;
          heatColorInto(out, colorR[src], colorG[src], colorB[src], h, lowTier);

          // 2. Cool matter is lit by the scene; hot matter lights itself
          const emission = h <= 0.05 ? 0 : h < 0.25 ? h * h * 1.15 : Math.min(1, 0.072 + (h - 0.25) * 3.2);
          // Clump grain: +/-12% on cool ground, fading as heat melts it into a glowing stream
          const grainMul = 1 + ((grain[src] - 128) / 128) * 0.12 * (1 - emission * 0.4);
          let shade = grainMul * wetSheen * (0.86 + 0.14 * Math.min(1, dens));
          let lift = 0;

          // 3. Pixel-art clump relief: a lit top edge where the stream ends to the north, shadow on its underside
          const nDens = gy > sy0 ? densAt(idx - gridW, gy - 1) : 0;
          const sDens = gy < sy1 ? densAt(idx + gridW, gy + 1) : 0;
          if (nDens < drawDensity) {
            shade *= 1.18;
            lift = isRain ? 22 : 14;
          } else if (sDens < drawDensity) {
            shade *= 0.68;
          }

          const hotBoost = h > 0.3 ? (h - 0.3) * 70 : 0;
          const r = (out[0] * (sky[0] + (1 - sky[0]) * emission) * shade + lift + hotBoost + 0.5) | 0;
          const g = (out[1] * (sky[1] + (1 - sky[1]) * emission) * shade + lift * 0.94 + hotBoost * 0.28 + 0.5) | 0;
          const b = (out[2] * (sky[2] + (1 - sky[2]) * emission) * shade + lift * 1.06 +
            hotBoost * (h > 0.72 ? 1.2 : 0.02) + 0.5) | 0;

          // 4. Stepped alpha: dense streams are solid, thinning tails fall off in hard pixel-art steps
          const alpha = dens >= 0.9 || h > 0.5 ? 255 : dens >= 0.55 ? 225 : dens >= 0.36 ? 175 : 120;

          rasterU32[idx] = packAbgr(
            r < 0 ? 0 : r > 255 ? 255 : r,
            g < 0 ? 0 : g > 255 ? 255 : g,
            b < 0 ? 0 : b > 255 ? 255 : b,
            alpha,
          );
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
    const touchedSparks = this.touchedSparks;
    touchedSparks.length = 0;
    if (!reduceEffects) {
      for (let i = 0; i < this.sparkCap; i++) {
        const s = this.sparks[i];
        if (!s.active) continue;
        const gx = Math.floor(s.x / cellSize);
        const gy = Math.floor(s.y / cellSize);
        if (gx < vx0 || gx > vx1 || gy < vy0 || gy > vy1) continue;
        const wx = Math.min(worldW - 1, Math.floor((gx + 0.5) * cellSize));
        const wy = Math.min(worldH - 1, Math.floor((gy + 0.5) * cellSize));
        if (isOccludedByLedge(world, wx, wy)) continue;
        const idx = gy * gridW + gx;
        const lifeRatio = s.life / Math.max(0.05, s.maxLife);
        heatColorInto(out, s.r, s.g, s.b, Math.min(1, 0.45 + lifeRatio * 0.5), lowTier);
        const fade = Math.max(40, Math.min(250, Math.round((1 - lifeRatio * 0.65) * 250)));
        rasterU32[idx] = packAbgr(
          Math.min(255, Math.round(out[0] + 36)),
          Math.min(255, Math.round(out[1] + 28)),
          Math.min(255, Math.round(out[2] + 38)),
          fade,
        );
        touchedSparks.push(idx);
        drawnSparks++;
        if (gx < drawMinX) drawMinX = gx;
        if (gx > drawMaxX) drawMaxX = gx;
        if (gy < drawMinY) drawMinY = gy;
        if (gy > drawMaxY) drawMaxY = gy;
      }

      // Small bright flashes where streams cross the event horizon
      for (let i = 0; i < this.horizonFlashes.length; i++) {
        const f = this.horizonFlashes[i];
        if (!f.active) continue;
        const gx = Math.floor(f.x / cellSize);
        const gy = Math.floor(f.y / cellSize);
        if (gx < vx0 || gx > vx1 || gy < vy0 || gy > vy1) continue;
        const idx = gy * gridW + gx;
        const t = f.life / Math.max(0.02, f.maxLife);
        const fa = Math.max(90, Math.min(255, Math.round((1 - t * 0.65) * 255)));
        rasterU32[idx] = t < 0.45 ? packAbgr(255, 246, 228, fa) : packAbgr(255, 170, 120, fa);
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
    }
    // Wipe the blitted rect so drained cells or moved sparks never reappear as ghosts
    if (drawMaxX >= drawMinX && drawMaxY >= drawMinY) {
      for (let gy = drawMinY; gy <= drawMaxY; gy++) {
        const row = gy * gridW;
        rasterU32.fill(0, row + drawMinX, row + drawMaxX + 1);
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
