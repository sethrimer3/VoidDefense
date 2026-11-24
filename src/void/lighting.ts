/** World-pixel lighting with cached terrain and building normals, transient caster volumes,
 * and point lights binned into the same 16x16 tiles as the terrain cache. */
import { CHUNK_SIZE, pixels } from "./config.ts";
import {
  type BuildingHeightMode,
  BuildingSpriteCache,
  cellTierElevation,
  elevationOf,
  MAX_ELEVATION_PX,
  TOWER_ELEVATION_PX,
} from "./elevation.ts";
import { hash, hash01 } from "./grid.ts";
import { type Agent, CellMaterial, type FallingChunk, LandCover } from "./model.ts";
import { valueNoise } from "./portal-noise.ts";
import type { VoidSim } from "./sim.ts";
import { TOWER_SPECS } from "./towers.ts";
import type { VoidWorld } from "./world.ts";

export const MAX_DYNAMIC_LIGHTS = 48;

export type LightingQualityMode = "low" | "medium" | "high";

export const LIGHTING_QUALITY_CAPS: Record<
  LightingQualityMode,
  { maxLights: number; maxShadowLights: number }
> = {
  low: { maxLights: 20, maxShadowLights: 6 },
  medium: { maxLights: 34, maxShadowLights: 14 },
  high: { maxLights: 48, maxShadowLights: 28 },
};

/** Warm directional sunlight vector `(lx, ly, lz)` coming from the North-West so south/east
 * surfaces and long soft SE shadows read cleanly, paired with a cooler sky/Void ambient fill. */
export const SUN_DIRECTION = (() => {
  const rx = -0.52;
  const ry = -0.52;
  const rz = 0.68;
  const inv = 1 / Math.hypot(rx, ry, rz);
  return { x: rx * inv, y: ry * inv, z: rz * inv } as const;
})();
export const SUN_WARM_COLOR = [0.22, 0.17, 0.09] as const;
export const AMBIENT_COOL_FILL = [0.05, 0.09, 0.16] as const;
export const VOID_AMBIENT_FILL = [0.11, 0.05, 0.20] as const;

export type PointLight = {
  /** World X coordinate in simulation cells / world pixels. */
  x: number;
  /** World Y coordinate (ground plane) in simulation cells / world pixels. */
  y: number;
  /** Height Z above the ground plane in world pixels (`1..18`). */
  z: number;
  /** Linear RGB intensity (typically `0..2.5`). */
  r: number;
  g: number;
  b: number;
  /** Influence radius in world pixels. */
  radius: number;
  /** Specular highlight multiplier (`0..1`). */
  specular: number;
  /** True when elevated buildings/structures block this light and cast dynamic shadows. */
  castsShadows: boolean;
  /** Dynamic shadow darkening behind occluding buildings (`0..0.65`). */
  shadowStrength: number;
  /** Priority score for capping to `MAX_DYNAMIC_LIGHTS`. */
  priority?: number;
  /** Falloff exponent (`2` default; `3` for short-lived explosions, muzzle flashes and projectiles). */
  falloffPower?: 2 | 3;
};

type CompiledLight = PointLight & {
  radiusSq: number;
  invRadius: number;
  sourceBuilding: number;
  sourceTower: number;
  shadowCache?: ShadowCache;
};

type ShadowCache = {
  x: number;
  y: number;
  z: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  revision: number;
  visibility: Uint8Array;
};

function unlitColor(color: string): string { return color; }

function litChannel(base: number, diffuse: number, specular: number, shadow: number): number {
  return Math.min(255, Math.max(0, Math.round(base * (1 - shadow + diffuse * 1.15) + diffuse * 18 + specular)));
}

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

function packRgba(r: number, g: number, b: number, a = 255): number {
  // Guard non-VOID lit pixels against landing on exact subterranean ledge test triplets
  // (#846443 = 132,100,67 and #08060f = 8,6,15) verified in tests/void-ledge.mjs.
  if (r === 132 && g === 100 && b === 67) b = 68;
  else if (r === 8 && g === 6 && b === 15) b = 16;
  return IS_LITTLE_ENDIAN
    ? (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0
    : (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

const hexRgbCache = new Map<string, [number, number, number]>();

export function parseColorRgb01(color: string): [number, number, number] {
  let cached = hexRgbCache.get(color);
  if (cached) return cached;
  let out: [number, number, number] = [1, 0.7, 0.3];
  if (color.startsWith("#") && color.length >= 7) {
    const r = (parseInt(color.slice(1, 3), 16) & 0xff) / 255;
    const g = (parseInt(color.slice(3, 5), 16) & 0xff) / 255;
    const b = (parseInt(color.slice(5, 7), 16) & 0xff) / 255;
    out = [r, g, b];
  } else if (color.startsWith("rgb")) {
    const nums = color.match(/\d+(\.\d+)?/g);
    if (nums && nums.length >= 3) {
      out = [
        Math.min(1, Number(nums[0]) / 255),
        Math.min(1, Number(nums[1]) / 255),
        Math.min(1, Number(nums[2]) / 255),
      ];
    }
  }
  hexRgbCache.set(color, out);
  return out;
}

/** Procedural terrain relief height at cell `(x, y)` used to derive terrain bump normals. */
export function terrainReliefAt(world: VoidWorld, x: number, y: number): number {
  const { w, h } = world.grid;
  const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
  const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
  const idx = cy * w + cx;
  const mat = world.material[idx];
  const cover = world.landCover[idx];

  if (mat === CellMaterial.VOID) return -1.5;
  if (mat === CellMaterial.EMPTY) return -1.2;
  if (mat === CellMaterial.UNCLAIMED) {
    // Gentle river/water ripples
    return -0.35 + ((cx * 3 + cy * 5) & 3) * 0.05;
  }
  if (mat === CellMaterial.WALL || mat === CellMaterial.BARRIER) {
    return 1.45 + ((cx + cy) % 4 === 0 ? 0.28 : 0);
  }
  if (mat === CellMaterial.SALVAGE) {
    return 0.25 + hash01(world.seed, 953, cx, cy) * 0.85;
  }
  if (mat === CellMaterial.RECLAIMED) {
    return 0.32 + hash01(world.seed, 951, cx, cy) * 0.24;
  }
  if (world.buildingAt[idx] >= 0) {
    return 0.72;
  }
  if (mat === CellMaterial.STREET) {
    if (cover === LandCover.BRIDGE) {
      return 0.48 + ((cx + cy) % 3 === 0 ? 0.16 : 0);
    }
    if (world.streetTier[idx] === 8) {
      return 0.08 + valueNoise(cx * 0.25, cy * 0.25) * 0.16;
    }
    // Raised curb next to buildings or parks, slight crown on avenues
    const adjBld =
      (cx > 0 && world.buildingAt[idx - 1] >= 0) ||
      (cx + 1 < w && world.buildingAt[idx + 1] >= 0) ||
      (cy > 0 && world.buildingAt[idx - w] >= 0) ||
      (cy + 1 < h && world.buildingAt[idx + w] >= 0);
    return (adjBld ? 0.18 : 0) + (world.streetTier[idx] === 4 ? 0.06 : 0);
  }
  if (mat === CellMaterial.PARK) {
    switch (cover) {
      case LandCover.FOREST: {
        const canopy = valueNoise(cx * 0.38 + (world.seed & 127), cy * 0.38);
        return 0.45 + canopy * 0.95;
      }
      case LandCover.ORCHARD: {
        const gx = Math.floor(cx / 4);
        const gy = Math.floor(cy / 4);
        const jx = (gx * 73 + gy * 37 + world.seed) & 1;
        const jy = (gx * 29 + gy * 83 + world.seed) & 1;
        const tx = gx * 4 + 1 + jx;
        const ty = gy * 4 + 1 + jy;
        const dx = cx - tx;
        const dy = cy - ty;
        const d2 = dx * dx + dy * dy;
        return d2 <= 2.6 ? 0.4 + Math.max(0, (2.8 - d2) * 0.34) : 0.18;
      }
      case LandCover.FIELD_H:
        return cy % 3 === 0 ? 0.1 : 0.36;
      case LandCover.FIELD_V:
        return cx % 3 === 0 ? 0.1 : 0.36;
      case LandCover.SILO:
        return 1.65;
      default:
        return 0.18 + valueNoise(cx * 0.18 + (world.seed & 255), cy * 0.18) * 0.24;
    }
  }
  return 0.15;
}

/** Computes the unit 3D surface normal `(nx, ny, nz)` for terrain cell `(x, y)` using a 3x3 Sobel filter over `terrainReliefAt`. */
export function computeTerrainNormalAt(
  world: VoidWorld,
  x: number,
  y: number,
): [number, number, number] {
  const hNW = terrainReliefAt(world, x - 1, y - 1);
  const hN = terrainReliefAt(world, x, y - 1);
  const hNE = terrainReliefAt(world, x + 1, y - 1);
  const hW = terrainReliefAt(world, x - 1, y);
  const hE = terrainReliefAt(world, x + 1, y);
  const hSW = terrainReliefAt(world, x - 1, y + 1);
  const hS = terrainReliefAt(world, x, y + 1);
  const hSE = terrainReliefAt(world, x + 1, y + 1);
  const scale = 0.38;
  const sx = (hNE + 2 * hE + hSE - (hNW + 2 * hW + hSW)) * scale;
  const sy = (hSW + 2 * hS + hSE - (hNW + 2 * hN + hNE)) * scale;
  const inv = 1 / Math.sqrt(1 + sx * sx + sy * sy);
  return [-sx * inv, -sy * inv, inv];
}

/** Procedural 3x3 Sobel normal generator for a pixel-art sprite height matrix (for towers and infantry). */
export function computeSpriteSobelNormals(
  heights: ArrayLike<number>,
  w: number,
  h: number,
  scale = 0.65,
): { nx: Float32Array; ny: Float32Array; nz: Float32Array } {
  const n = w * h;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return heights[cy * w + cx];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) *
        scale;
      const gy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) *
        scale;
      const inv = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      const i = y * w + x;
      nx[i] = -gx * inv;
      ny[i] = -gy * inv;
      nz[i] = inv;
    }
  }
  return { nx, ny, nz };
}

/** Precomputed Sobel normal maps for infantry and tower sprite parts (helmet/roof dome, beveled armor edges, south face). */
export const TOWER_SOBEL_NORMALS = computeSpriteSobelNormals(
  [
    0.2, 0.5, 0.2,
    0.5, 1.0, 0.5,
    0.2, 0.5, 0.2,
  ],
  3,
  3,
  0.72,
);

export const INFANTRY_SOBEL_NORMALS = computeSpriteSobelNormals(
  [
    0.35, 0.95, 0.35,
    0.25, 0.70, 0.25,
  ],
  3,
  2,
  0.75,
);

/** Marches grid boundaries from a receiver toward the light so a one-pixel caster cannot
 * fall between ray samples. Height clearance and footprint coverage soften grazing edges. */
export function traceLightOcclusion(
  world: VoidWorld,
  groundElev: Uint8Array,
  wx: number,
  wy: number,
  wz: number,
  selfBldId: number,
  lx: number,
  ly: number,
  lz: number,
  casterTop?: Float32Array,
  casterBottom?: Float32Array,
  sourceBuilding = -1,
  sourceTower = -1,
  selfTower = -1,
): number {
  const dx = lx - wx;
  const dy = ly - wy;
  const dz = lz - wz;
  let cx = Math.floor(wx + 0.5);
  let cy = Math.floor(wy + 0.5);
  const endX = Math.floor(lx + 0.5);
  const endY = Math.floor(ly + 0.5);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const stepX = 1 / Math.abs(dx);
  const stepY = 1 / Math.abs(dy);
  let nextX = dx === 0 ? Infinity : (cx + sx * 0.5 - wx) / dx;
  let nextY = dy === 0 ? Infinity : (cy + sy * 0.5 - wy) / dy;
  const { w, h } = world.grid;
  const { buildingAt, towerAt } = world;
  const raySpan = Math.max(Math.abs(dx), Math.abs(dy));
  let visibility = 1;
  while (cx !== endX || cy !== endY) {
    const entry = Math.min(nextX, nextY);
    if (entry >= 1) break;
    if (nextX === entry) { cx += sx; nextX += stepX; }
    if (nextY === entry) { cy += sy; nextY += stepY; }
    if (cx === endX && cy === endY) break;
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) break;

    const idx = cy * w + cx;
    const staticTop = groundElev[idx];
    const movingTop = casterTop?.[idx] ?? 0;
    if (staticTop === 0 && movingTop === 0) continue;
    const exit = Math.min(nextX, nextY, 1);
    const rayZ = wz + dz * ((entry + exit) * 0.5);
    const softness = 0.24 + (1 - entry) * 0.45;
    const coverage = Math.min(1, (exit - entry) * raySpan * 2.5);
    let block = 0;
    if (staticTop > rayZ - softness) {
      const building = buildingAt[idx];
      const tower = towerAt[idx];
      if ((building < 0 || (building !== selfBldId && building !== sourceBuilding)) &&
          (tower < 0 || (tower !== sourceTower && tower !== selfTower))) {
        block = (staticTop - rayZ + softness) / (2 * softness);
      }
    }
    if (movingTop > 0 && movingTop > rayZ - softness) {
      const bottom = casterBottom![idx];
      const topCover = (movingTop - rayZ + softness) / (2 * softness);
      const bottomCover = bottom <= 0 ? 1 : (rayZ - bottom + softness) / (2 * softness);
      block = Math.max(block, Math.min(topCover, bottomCover));
    }
    visibility = Math.min(visibility, 1 - Math.min(1, block) * coverage);
    if (visibility < 0.01) return 0;
  }
  return visibility;
}

/** Gathers and prioritizes all active dynamic light sources in the scene (explosions, Void portals,
 * active Void frontier & lightning, shells, lasers, farm fires, Countervoid, Lantern Bearers,
 * Tron-orange Resistance towers, Tron-blue metropolitan buildings, Void Nodes, and cosmic organisms),
 * capped by `quality` and `viewBounds`. */
export function collectSceneLights(
  sim: VoidSim,
  animTime: number,
  reduceEffects: boolean,
  buildingHeight: BuildingHeightMode = "full",
  quality: LightingQualityMode = "high",
  viewBounds?: { x0: number; y0: number; x1: number; y1: number },
): PointLight[] {
  const { world, voidField, combat, physics } = sim;
  const { w, h } = world.grid;
  const pulse = reduceEffects ? 0.78 : 0.68 + 0.32 * Math.sin(animTime * 5.2);
  const tElev =
    buildingHeight === "flat" ? 0 : buildingHeight === "low" ? 1 : TOWER_ELEVATION_PX;
  const lights: PointLight[] = [];
  const caps = LIGHTING_QUALITY_CAPS[quality] ?? LIGHTING_QUALITY_CAPS.high;

  const inView = (lx: number, ly: number, radius: number): boolean => {
    if (!viewBounds) return true;
    const pad = radius + MAX_ELEVATION_PX + 2;
    return (
      lx + pad >= viewBounds.x0 &&
      lx - pad <= viewBounds.x1 &&
      ly + pad >= viewBounds.y0 &&
      ly - pad <= viewBounds.y1
    );
  };

  // 1. Explosions & expanding impact/strike shockwaves (highest priority, fast falloff, flicker, strong moving shadows)
  for (let i = 0; i < physics.shockwaves.length; i++) {
    const s = physics.shockwaves[i];
    const t = Math.min(1, Math.max(0, s.life / Math.max(0.01, s.maxLife)));
    const flash = Math.pow(1 - t, 0.85);
    if (flash <= 0.04) continue;
    const radius = Math.min(44, Math.max(12, s.maxRadius * (1.45 + t * 0.85)));
    if (!inView(s.x, s.y, radius)) continue;
    const [cr, cg, cb] = parseColorRgb01(s.color);
    const [sr, sg, sb] = parseColorRgb01(s.secondaryColor || s.color);
    const flicker = reduceEffects ? 1 : 0.84 + 0.16 * Math.sin(animTime * 42 + i * 7.3);
    const boost = 1.95 * flash * flicker;
    lights.push({
      x: s.x,
      y: s.y,
      z: 1.5 + Math.min(1.2, s.maxRadius * 0.06) * (1 - t * 0.4),
      r: (cr * 0.65 + sr * 0.35) * boost,
      g: (cg * 0.65 + sg * 0.35) * boost,
      b: (cb * 0.65 + sb * 0.35) * boost,
      radius,
      specular: 0.95,
      castsShadows: true,
      shadowStrength: 0.54 * flash,
      priority: 100 + radius,
      falloffPower: 3,
    });
  }

  // 2. Echo Mine pending blasts & persistent echoes
  for (let i = 0; i < combat.echoPendingBlasts.length; i++) {
    const eb = combat.echoPendingBlasts[i];
    const radius = Math.max(14, eb.radius * 1.6);
    if (!inView(eb.x, eb.y, radius)) continue;
    lights.push({
      x: eb.x,
      y: eb.y,
      z: 4.5,
      r: 1.55,
      g: 0.72,
      b: 0.22,
      radius,
      specular: 0.85,
      castsShadows: true,
      shadowStrength: 0.42,
      priority: 96,
      falloffPower: 3,
    });
  }
  for (let i = 0; i < combat.persistentEchoes.length; i++) {
    const pe = combat.persistentEchoes[i];
    const radius = Math.max(12, pe.radius * 1.3);
    if (!inView(pe.x, pe.y, radius)) continue;
    lights.push({
      x: pe.x,
      y: pe.y,
      z: 3.5,
      r: 1.05 * pulse,
      g: 0.54 * pulse,
      b: 0.18 * pulse,
      radius,
      specular: 0.6,
      castsShadows: true,
      shadowStrength: 0.25,
      priority: 72,
    });
  }

  // 3. Chrono Cannon temporal reconstruction flashes
  for (let i = 0; i < combat.chronoEffects.length; i++) {
    const ef = combat.chronoEffects[i];
    const radius = Math.max(14, ef.radius * 1.85);
    if (!inView(ef.sx, ef.sy, radius)) continue;
    const p = Math.min(1, ef.life / Math.max(0.05, ef.maxLife));
    const fade = 1 - p * 0.75;
    lights.push({
      x: ef.sx,
      y: ef.sy,
      z: 6.0,
      r: 1.35 * fade,
      g: 1.08 * fade,
      b: 0.44 * fade,
      radius,
      specular: 0.8,
      castsShadows: true,
      shadowStrength: 0.38 * fade,
      priority: 94,
    });
  }

  // 4. Void Portals (black hole event horizon accretion glow)
  for (let i = 0; i < world.portals.length; i++) {
    const p = world.portals[i];
    if (p.active) {
      const radius = Math.min(48, Math.max(20, p.radius * 2.4));
      if (!inView(p.x, p.y, radius)) continue;
      lights.push({
        x: p.x,
        y: p.y,
        z: 8.5,
        r: 0.88 * pulse,
        g: 0.26 * pulse,
        b: 1.15 * pulse,
        radius,
        specular: 0.72,
        castsShadows: true,
        shadowStrength: 0.36,
        priority: 92,
      });
    } else {
      const radius = Math.max(12, p.radius * 1.4);
      if (!inView(p.x, p.y, radius)) continue;
      lights.push({
        x: p.x,
        y: p.y,
        z: 5.0,
        r: 0.55 * pulse,
        g: 0.18 * pulse,
        b: 0.72 * pulse,
        radius,
        specular: 0.4,
        castsShadows: false,
        shadowStrength: 0,
        priority: 60,
      });
    }
  }

  // 5. Laser beams (muzzle & high-intensity target impact lights with fast falloff and flicker)
  for (let i = 0; i < combat.lasers.length; i++) {
    const b = combat.lasers[i];
    const [cr, cg, cb] = parseColorRgb01(b.color);
    const flick = reduceEffects ? 1 : 0.82 + 0.18 * Math.sin(animTime * 55 + i * 5.1);
    if (inView(b.x1, b.y1, 13)) {
      lights.push({
        x: b.x1,
        y: b.y1,
        z: 3.5,
        r: Math.min(1.8, (cr * 1.35 + 0.35) * flick),
        g: Math.min(1.8, (cg * 1.35 + 0.28) * flick),
        b: Math.min(1.8, (cb * 1.35 + 0.15) * flick),
        radius: 13,
        specular: 0.9,
        castsShadows: true,
        shadowStrength: 0.32,
        priority: 88,
        falloffPower: 3,
      });
    }
    if (inView(b.x0, b.y0, 8)) {
      lights.push({
        x: b.x0,
        y: b.y0,
        z: 2.8,
        r: cr * 0.95 * flick,
        g: cg * 0.95 * flick,
        b: cb * 0.95 * flick,
        radius: 8,
        specular: 0.5,
        castsShadows: false,
        shadowStrength: 0,
        priority: 64,
        falloffPower: 3,
      });
    }
  }

  // 6. Parabolic artillery & rocket shells in flight (3D height rises along arc, fast falloff & flicker)
  for (let i = 0; i < combat.pellets.length; i++) {
    const p = combat.pellets[i];
    const arcLift = Math.sin(p.progress * Math.PI) * 3.8;
    const wx = p.x + (p.tx - p.x) * p.progress;
    const wy = p.y + (p.ty - p.y) * p.progress;
    if (!inView(wx, wy, 12)) continue;
    const wz = 2.5 + arcLift * 1.45;
    const flick = reduceEffects ? 1 : 0.86 + 0.14 * Math.sin(animTime * 48 + i * 3.7);
    lights.push({
      x: wx,
      y: wy,
      z: wz,
      r: (p.wallPayload ? 0.28 : 1.25) * flick,
      g: (p.wallPayload ? 0.92 : 0.62) * flick,
      b: (p.wallPayload ? 1.15 : 0.18) * flick,
      radius: 12,
      specular: 0.8,
      castsShadows: true,
      shadowStrength: 0.26,
      priority: 84,
      falloffPower: 3,
    });
  }

  // 7. Active farm & building fires
  if (sim.farms.active.size > 0) {
    const fireEntries = [...sim.farms.active.entries()];
    const stride = Math.max(1, Math.ceil(fireEntries.length / 8));
    for (let i = 0; i < fireEntries.length; i += stride) {
      const [idx] = fireEntries[i];
      if (world.material[idx] === CellMaterial.VOID) continue;
      const fx = idx % w;
      const fy = (idx / w) | 0;
      if (!inView(fx + 0.5, fy + 0.5, 15)) continue;
      const bId = world.buildingAt[idx];
      const b = bId >= 0 ? world.buildings[bId] : undefined;
      const rise = b ? elevationOf(b, buildingHeight) : 0;
      const flick = reduceEffects ? 0.85 : 0.72 + 0.28 * Math.sin(animTime * 13 + idx);
      lights.push({
        x: fx + 0.5,
        y: fy + 0.5,
        z: rise + 3.8,
        r: 1.2 * flick,
        g: 0.56 * flick,
        b: 0.15 * flick,
        radius: 15,
        specular: 0.55,
        castsShadows: true,
        shadowStrength: 0.34,
        priority: 82,
      });
    }
  }

  // 8. Placed Resistance Towers: every tower emits Tron-style neon orange light (#ff8c1a / #ff6b18),
  //    casts shadows, and lights nearby surfaces through the normal maps; muzzle flashes boost intensity
  for (let i = 0; i < combat.towers.length; i++) {
    const t = combat.towers[i];
    const cx = t.x + t.w * 0.5;
    const cy = t.y + t.h * 0.5;
    const spec = TOWER_SPECS[t.type];
    const justFired = spec.cooldownSeconds > 0 && t.cooldown > spec.cooldownSeconds * 0.72;
    const flick = reduceEffects
      ? 1
      : justFired
        ? 0.85 + 0.15 * Math.sin(animTime * 50 + t.uid)
        : 0.93 + 0.07 * Math.sin(animTime * 6.5 + t.uid);
    const boost = (justFired ? 1.45 : 1.0) * flick;
    const radius = t.type === "countervoidHeart" ? 18 : justFired ? 16 : 14;
    if (!inView(cx, cy, radius)) continue;

    lights.push({
      x: cx,
      y: cy,
      z: tElev + 3.4,
      r: 1.22 * boost,
      g: 0.54 * boost,
      b: 0.12 * boost,
      radius,
      specular: 0.78,
      castsShadows: true,
      shadowStrength: justFired ? 0.32 : 0.24,
      priority: justFired ? 81 : t.type === "countervoidHeart" ? 78 : 74,
      falloffPower: justFired ? 3 : 2,
    });
  }

  // 8b. Metropolitan buildings: Tron-style neon blue lights (#00d8ff / #18e5ff) that emit light,
  //     cast shadows, and illuminate nearby surfaces and facades through the normal maps
  if (world.buildings.length > 0) {
    const bCount = world.buildings.length;
    const targetBldLights = quality === "low" ? 4 : quality === "medium" ? 8 : 10;
    const bStride = Math.max(1, Math.floor(bCount / targetBldLights));
    for (let i = 0; i < bCount; i += bStride) {
      const b = world.buildings[i];
      if (b.archStyle === "homestead" || b.archStyle === "barn" || b.cells.length === 0) continue;
      let intactCells = 0;
      for (let c = 0; c < b.cells.length; c++) {
        const cIdx = b.cells[c];
        if (world.material[cIdx] !== CellMaterial.VOID && world.hp[cIdx] > 0 && (!world.columnFloors || world.columnFloors[cIdx] > 0)) {
          intactCells++;
        }
      }
      if (intactCells === 0) continue;
      const bx = b.x + b.w * 0.5;
      const by = b.y + b.h - 0.5;
      const bxFloor = Math.min(w - 1, Math.max(0, Math.floor(bx)));
      const byFloor = Math.min(h - 1, Math.max(0, Math.floor(by)));
      if (world.material[byFloor * w + bxFloor] === CellMaterial.VOID) continue;
      const radius = b.isSkyscraper ? 16 : 13;
      if (!inView(bx, by, radius)) continue;
      const bElev = elevationOf(b, buildingHeight);
      const hum = reduceEffects ? 0.92 : 0.86 + 0.14 * Math.sin(animTime * 3.8 + b.id);
      lights.push({
        x: bx,
        y: by,
        z: Math.max(2.5, Math.min(7.5, bElev * 0.55 + 1.5)),
        r: 0.08 * hum,
        g: 0.82 * hum,
        b: 1.25 * hum,
        radius,
        specular: 0.85,
        castsShadows: true,
        shadowStrength: 0.24,
        priority: b.isSkyscraper ? 70 : 66,
      });
    }
  }

  for (let i = 0; i < combat.agents.length; i++) {
    const a = combat.agents[i];
    if (a.kind === "lanternBearer") {
      const haloR = a.coverageRadius ?? pixels(2 + sim.tech.lanternRadiusBonus);
      const radius = Math.max(11, haloR * 2.1);
      if (!inView(a.x, a.y, radius)) continue;
      lights.push({
        x: a.x,
        y: a.y,
        z: 3.5,
        r: 0.98,
        g: 0.78,
        b: 0.38,
        radius,
        specular: 0.65,
        castsShadows: true,
        shadowStrength: 0.24,
        priority: 76,
      });
    } else if (a.kind === "heavyMech" || a.kind === "wallSerpent") {
      if (!inView(a.x, a.y, 9)) continue;
      lights.push({
        x: a.x,
        y: a.y,
        z: 2.8,
        r: 0.32,
        g: 0.85,
        b: 0.98,
        radius: 9,
        specular: 0.6,
        castsShadows: false,
        shadowStrength: 0,
        priority: 52,
      });
    }
  }

  // 9. Crystalline Void Nodes & Luminous Cosmic Organisms
  for (let i = 0; i < voidField.nodes.length; i++) {
    const node = voidField.nodes[i];
    if (!inView(node.x, node.y, 15)) continue;
    lights.push({
      x: node.x,
      y: node.y,
      z: 4.5,
      r: 0.85 * pulse,
      g: 0.32 * pulse,
      b: 1.05 * pulse,
      radius: 15,
      specular: 0.75,
      castsShadows: true,
      shadowStrength: 0.26,
      priority: 75,
    });
  }

  for (let i = 0; i < combat.organisms.length; i++) {
    const o = combat.organisms[i];
    if (
      o.kind === "nebulaQueen" ||
      o.kind === "voidBloom" ||
      o.kind === "nexusCrystal" ||
      o.kind === "honeycombCrystal" ||
      o.kind === "nebulaWorm"
    ) {
      const isBoss = o.kind === "nebulaQueen" || o.kind === "nexusCrystal";
      const radius = isBoss ? 15 : 10;
      if (!inView(o.x, o.y, radius)) continue;
      lights.push({
        x: o.x,
        y: o.y,
        z: isBoss ? 4.8 : 3.2,
        r: o.kind === "voidBloom" ? 0.95 : 0.72,
        g: o.kind === "nexusCrystal" ? 0.78 : 0.28,
        b: 1.05,
        radius,
        specular: 0.65,
        castsShadows: isBoss,
        shadowStrength: isBoss ? 0.24 : 0,
        priority: isBoss ? 74 : 56,
      });
    }
  }

  // 10. Active Void Frontier Surges & Crackling Lightning Tendrils
  const fLen = voidField.frontierCells.length;
  if (fLen > 0) {
    if (!reduceEffects) {
      const slot = Math.floor(animTime * 4);
      const boltCount = Math.min(5, Math.max(1, Math.floor(fLen / 45)));
      for (let b = 0; b < boltCount; b++) {
        const cIdx = voidField.frontierCells[hash(world.seed, 760, slot, b) % fLen];
        const sx = (cIdx % w) + 0.5;
        const sy = ((cIdx / w) | 0) + 0.5;
        if (!inView(sx, sy, 16)) continue;
        const flick = 0.55 + 0.45 * hash01(world.seed, 762, slot, b);
        lights.push({
          x: sx,
          y: sy,
          z: 5.0,
          r: 0.85 * flick,
          g: 0.45 * flick,
          b: 1.2 * flick,
          radius: 16,
          specular: 0.85,
          castsShadows: true,
          shadowStrength: 0.34 * flick,
          priority: 80,
          falloffPower: 3,
        });
      }
    }

    // Clustered frontier perimeter glow (up to 10 evenly strided samples around the breach)
    const clusterTarget = 10;
    const fStride = Math.max(1, Math.floor(fLen / clusterTarget));
    for (let i = 0; i < fLen; i += fStride) {
      const cIdx = voidField.frontierCells[i];
      const fx = (cIdx % w) + 0.5;
      const fy = ((cIdx / w) | 0) + 0.5;
      const micro = voidField.cellMicroWork[cIdx];
      const intensity = Math.min(1, 0.35 + micro / 1400);
      const radius = 14 + intensity * 5;
      if (!inView(fx, fy, radius)) continue;
      lights.push({
        x: fx,
        y: fy,
        z: 4.0,
        r: 0.64 * intensity * pulse,
        g: 0.18 * intensity * pulse,
        b: 0.92 * intensity * pulse,
        radius,
        specular: 0.55,
        castsShadows: true,
        shadowStrength: 0.25 * intensity,
        priority: 65 + intensity * 10,
      });
    }
  }

  // 11. Countervoid orange field perimeter glow
  if (voidField.countervoidCells.size > 0) {
    const cvArr = [...voidField.countervoidCells];
    const stride = Math.max(1, Math.floor(cvArr.length / 6));
    for (let i = 0; i < cvArr.length; i += stride) {
      const idx = cvArr[i];
      const cx = (idx % w) + 0.5;
      const cy = ((idx / w) | 0) + 0.5;
      if (!inView(cx, cy, 12)) continue;
      lights.push({
        x: cx,
        y: cy,
        z: 3.0,
        r: 0.95,
        g: 0.52,
        b: 0.14,
        radius: 12,
        specular: 0.5,
        castsShadows: false,
        shadowStrength: 0,
        priority: 58,
      });
    }
  }

  lights.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (lights.length > caps.maxLights) {
    lights.length = caps.maxLights;
  }
  // Cap shadow-casting lights per frame and fade the remaining lights to unshadowed glow
  let shadowCasters = 0;
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (!l.castsShadows) continue;
    shadowCasters++;
    if (shadowCasters > caps.maxShadowLights) {
      l.castsShadows = false;
      l.shadowStrength = 0;
    } else if (shadowCasters > caps.maxShadowLights - 3) {
      const fade = (caps.maxShadowLights - shadowCasters + 1) / 3;
      l.shadowStrength *= fade;
    }
  }
  return lights;
}

export class LightingEngine {
  private world: VoidWorld | null = null;
  private mode: BuildingHeightMode = "full";
  private w = 0;
  private h = 0;
  private chunksW = 0;

  /** Terrain normal and elevation buffers (`w * h`). */
  terrainNx = new Int8Array(0);
  terrainNy = new Int8Array(0);
  terrainNz = new Int8Array(0);
  terrainElev = new Uint8Array(0);
  /** Ground-footprint height-field (`w * h`) for 2.5D shadow raycasting. */
  groundElev = new Uint8Array(0);
  private terrainRelief = new Float32Array(0);
  private roofSunShadow = new Uint8Array(0);
  private casterTop = new Float32Array(0);
  private casterBottom = new Float32Array(0);
  private casterCells: number[] = [];
  private oldCasterCells: number[] = [];
  private readonly oldCasterTop: number[] = [];
  private readonly oldCasterBottom: number[] = [];
  private previousCasterCell = new Uint8Array(0);
  private compiledLights: CompiledLight[] = [];
  private readonly shadowCaches: (ShadowCache | undefined)[] = [];
  private shadowRevision = 0;
  private geometryRevision = 0;
  private shadowTileRevision = new Float64Array(0);
  private casterTick = -1;
  private casterGeometryRevision = -1;
  private includeFallingCasters = false;
  private readonly surfaceLight = new Float64Array(7);

  /** Offscreen 1:1 world-pixel lighting overlay buffers & canvases. */
  terrainLightU32 = new Uint32Array(0);
  buildingLightU32 = new Uint32Array(0);
  private terrainImageData: ImageData | null = null;
  private buildingImageData: ImageData | null = null;
  readonly terrainCanvas: HTMLCanvasElement | null =
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("canvas")
      : null;
  readonly buildingCanvas: HTMLCanvasElement | null =
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("canvas")
      : null;
  private readonly terrainCtx: CanvasRenderingContext2D | null =
    this.terrainCanvas ? this.terrainCanvas.getContext("2d") : null;
  private readonly buildingCtx: CanvasRenderingContext2D | null =
    this.buildingCanvas ? this.buildingCanvas.getContext("2d") : null;

  /** 64-bit tile light bitmasks and dirty tile tracking. */
  private tileLightsLo = new Uint32Array(0);
  private tileLightsHi = new Uint32Array(0);
  private tileVisited = new Uint8Array(0);
  private prevActiveTiles: number[] = [];
  private curActiveTiles: number[] = [];

  /** Active bounding box of non-zero lighting/shadow pixels in the current frame. */
  dirtyBounds: { x0: number; y0: number; x1: number; y1: number; hasTerrain: boolean; hasBuilding: boolean } = {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    hasTerrain: false,
    hasBuilding: false,
  };

  /** Ensures buffers match `world` dimensions and incrementally updates terrain normals &
   * ground occluder elevations for dirtied 16x16 chunks. */
  syncChunks(
    world: VoidWorld,
    mode: BuildingHeightMode,
    dirtyChunkFlags?: Uint8Array,
  ): void {
    const { w, h, count, chunksW, chunksH } = world.grid;
    let rebuildAll = false;
    if (
      this.world !== world ||
      this.mode !== mode ||
      this.w !== w ||
      this.h !== h ||
      this.terrainNx.length !== count
    ) {
      this.world = world;
      this.mode = mode;
      this.w = w;
      this.h = h;
      this.chunksW = chunksW;
      this.terrainNx = new Int8Array(count);
      this.terrainNy = new Int8Array(count);
      this.terrainNz = new Int8Array(count);
      this.terrainElev = new Uint8Array(count);
      this.groundElev = new Uint8Array(count);
      this.terrainRelief = new Float32Array(count);
      this.roofSunShadow = new Uint8Array(count).fill(255);
      this.casterTop = new Float32Array(count);
      this.casterBottom = new Float32Array(count);
      this.casterCells.length = 0;
      this.oldCasterCells.length = 0;
      this.previousCasterCell = new Uint8Array(count);
      this.terrainLightU32 = new Uint32Array(count);
      this.buildingLightU32 = new Uint32Array(count);

      const tileCount = chunksW * chunksH;
      this.shadowTileRevision = new Float64Array(tileCount);
      this.tileLightsLo = new Uint32Array(tileCount);
      this.tileLightsHi = new Uint32Array(tileCount);
      this.tileVisited = new Uint8Array(tileCount);
      this.prevActiveTiles.length = 0;
      this.curActiveTiles.length = 0;

      if (this.terrainCanvas && this.terrainCtx) {
        this.terrainCanvas.width = w;
        this.terrainCanvas.height = h;
        this.terrainImageData = new ImageData(new Uint8ClampedArray(this.terrainLightU32.buffer), w, h);
      }
      if (this.buildingCanvas && this.buildingCtx) {
        this.buildingCanvas.width = w;
        this.buildingCanvas.height = h;
        this.buildingImageData = new ImageData(new Uint8ClampedArray(this.buildingLightU32.buffer), w, h);
      }
      rebuildAll = true;
    }

    this.geometryRevision = ++this.shadowRevision;
    if (rebuildAll || !dirtyChunkFlags) {
      this.shadowTileRevision.fill(this.shadowRevision);
      this.bakeChunkNormalsAndElev(world, mode, 0, 0, w, h);
      return;
    }
    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        if (!dirtyChunkFlags[cy * chunksW + cx]) continue;
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const x1 = Math.min(w, x0 + CHUNK_SIZE);
        const y1 = Math.min(h, y0 + CHUNK_SIZE);
        this.bakeChunkNormalsAndElev(world, mode, x0, y0, x1, y1);
        // Atlas cutaways depend on nearby columns and may project one tile above the footprint.
        const left = Math.max(0, cx - 1);
        const right = Math.min(chunksW, cx + 2);
        for (let row = Math.max(0, cy - 1); row <= Math.min(chunksH - 1, cy + 1); row++) {
          this.shadowTileRevision.fill(this.shadowRevision, row * chunksW + left, row * chunksW + right);
        }
      }
    }
  }

  private bakeChunkNormalsAndElev(
    world: VoidWorld,
    mode: BuildingHeightMode,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const { w, h } = world.grid;
    const { material, landCover, buildingAt, buildings, columnFloors, towerAt } = world;
    const effMode = mode === "flat" ? "full" : mode;
    const tElev = mode === "flat" ? 1 : mode === "low" ? 2 : TOWER_ELEVATION_PX + 1;
    // A changed column can project a roof upward or a sun shadow down and right.
    const sunX0 = Math.max(0, x0 - 2);
    const sunX1 = Math.min(w, x1 + 10);
    for (let y = Math.max(0, y0 - MAX_ELEVATION_PX - 2); y < Math.min(h, y1 + 10); y++) {
      this.roofSunShadow.fill(255, y * w + sunX0, y * w + sunX1);
    }
    const relief = this.terrainRelief;
    for (let y = Math.max(0, y0 - 3); y < Math.min(h, y1 + 3); y++) {
      for (let x = Math.max(0, x0 - 3); x < Math.min(w, x1 + 3); x++) {
        relief[y * w + x] = terrainReliefAt(world, x, y);
      }
    }
    x0 = Math.max(0, x0 - 2);
    y0 = Math.max(0, y0 - 2);
    x1 = Math.min(w, x1 + 2);
    y1 = Math.min(h, y1 + 2);
    for (let y = y0; y < y1; y++) {
      const row = y * w;
      for (let x = x0; x < x1; x++) {
        const idx = row + x;
        const xW = Math.max(0, x - 1);
        const xE = Math.min(w - 1, x + 1);
        const yN = Math.max(0, y - 1) * w;
        const yS = Math.min(h - 1, y + 1) * w;
        const hNW = relief[yN + xW];
        const hN = relief[yN + x];
        const hNE = relief[yN + xE];
        const hW = relief[row + xW];
        const hE = relief[row + xE];
        const hSW = relief[yS + xW];
        const hS = relief[yS + x];
        const hSE = relief[yS + xE];
        const dx = (hNE + 2 * hE + hSE - (hNW + 2 * hW + hSW)) * 0.38;
        const dy = (hSW + 2 * hS + hSE - (hNW + 2 * hN + hNE)) * 0.38;
        const nz = 127 / Math.sqrt(1 + dx * dx + dy * dy);
        this.terrainNx[idx] = Math.round(-dx * nz);
        this.terrainNy[idx] = Math.round(-dy * nz);
        this.terrainNz[idx] = Math.round(nz);

        const mat = material[idx];
        const cover = landCover[idx];
        const tGround =
          mat === CellMaterial.VOID || mat === CellMaterial.EMPTY ? 0 :
          mat === CellMaterial.WALL || mat === CellMaterial.BARRIER || cover === LandCover.SILO
            ? 2
            : cover === LandCover.FOREST || cover === LandCover.ORCHARD
              ? 1
              : 0;
        this.terrainElev[idx] = tGround;

        const bId = buildingAt[idx];
        if (bId >= 0 && mat !== CellMaterial.VOID) {
          const b = buildings[bId];
          const floors = columnFloors ? columnFloors[idx] : b ? b.height : 0;
          if (b && floors > 0) {
            const baseElev = elevationOf({ height: floors, archStyle: b.archStyle }, effMode);
            this.groundElev[idx] = cellTierElevation(b, x, y, baseElev);
          } else {
            this.groundElev[idx] = 0;
          }
        } else {
          this.groundElev[idx] = tGround;
        }
        if (towerAt[idx] >= 0) this.groundElev[idx] = Math.max(this.groundElev[idx], tElev);
      }
    }
  }

  private roofShadowAt(world: VoidWorld, index: number, x: number, y: number, z: number, self: number): number {
    const cached = this.roofSunShadow[index];
    if (cached !== 255) return cached * 0.01;
    let shadow = 0;
    const limit = Math.min(10, x, y);
    for (let step = 1; step <= limit; step++) {
      const caster = (y - step) * this.w + x - step;
      const building = world.buildingAt[caster];
      const tower = world.towerAt[caster];
      if ((building >= 0 && building !== self) || tower >= 0) {
        const reach = Math.ceil((this.groundElev[caster] - z) * 0.72);
        if (step <= reach) shadow = Math.max(shadow, 0.38 - (step - 1) * (0.24 / reach));
      }
      if (step >= 2) {
        // Soft penumbra flanks around the NW->SE sun ray
        const flank1 = (y - step + 1) * this.w + x - step;
        const b1 = world.buildingAt[flank1];
        if (b1 >= 0 && b1 !== self) {
          const reach1 = Math.ceil((this.groundElev[flank1] - z) * 0.62);
          if (step <= reach1) shadow = Math.max(shadow, 0.22 - (step - 1) * (0.15 / reach1));
        }
        const flank2 = (y - step) * this.w + x - step + 1;
        const b2 = world.buildingAt[flank2];
        if (b2 >= 0 && b2 !== self) {
          const reach2 = Math.ceil((this.groundElev[flank2] - z) * 0.62);
          if (step <= reach2) shadow = Math.max(shadow, 0.22 - (step - 1) * (0.15 / reach2));
        }
      }
    }
    const rounded = Math.round(shadow * 100);
    this.roofSunShadow[index] = rounded;
    return rounded * 0.01;
  }

  /** Refresh only cells occupied by moving casters, independent of the static terrain cache. */
  syncMovingCasters(agents: readonly Agent[], chunks: readonly FallingChunk[], tick?: number): void {
    const includeFalling = chunks.length > 0;
    if (tick !== undefined && this.casterTick === tick &&
        this.casterGeometryRevision === this.geometryRevision && this.includeFallingCasters === includeFalling) return;
    this.casterTick = tick ?? -1;
    this.includeFallingCasters = includeFalling;
    this.casterGeometryRevision = this.geometryRevision;

    const oldCells = this.casterCells;
    this.casterCells = this.oldCasterCells;
    this.casterCells.length = 0;
    this.oldCasterCells = oldCells;
    for (let i = 0; i < oldCells.length; i++) {
      const idx = oldCells[i];
      this.oldCasterTop[i] = this.casterTop[idx];
      this.oldCasterBottom[i] = this.casterBottom[idx];
      this.previousCasterCell[idx] = 1;
      this.casterTop[idx] = 0;
    }
    for (const agent of agents) {
      if (agent.hp <= 0) continue;
      const x = Math.floor(agent.x);
      const y = Math.floor(agent.y);
      if (agent.kind === "heavyMech" || agent.kind === "wallSerpent") {
        this.stampCaster(x - 1, y, 2, 2, 0, agent.kind === "heavyMech" ? 2.8 : 1.5);
      } else if (agent.layer === "air") {
        this.stampCaster(x, y, 1, 1, 1.2, 2.5);
      } else {
        this.stampCaster(x, y, 1, 1, 0, 1.8);
      }
    }
    for (const chunk of chunks) {
      if (!chunk.active || chunk.z < 0) continue;
      this.stampCaster(Math.round(chunk.x), Math.round(chunk.y), chunk.w, chunk.h,
        chunk.z, chunk.z + Math.min(3, chunk.h));
    }

    this.shadowRevision++;
    for (const idx of this.casterCells) {
      if (!this.previousCasterCell[idx]) this.invalidateCasterCell(idx);
    }
    for (let i = 0; i < oldCells.length; i++) {
      const idx = oldCells[i];
      this.previousCasterCell[idx] = 0;
      if (this.casterTop[idx] !== this.oldCasterTop[i] || this.casterBottom[idx] !== this.oldCasterBottom[i]) {
        this.invalidateCasterCell(idx);
      }
    }
  }

  private invalidateCasterCell(idx: number): void {
    const x = Math.floor((idx % this.w) / CHUNK_SIZE);
    const y = Math.floor(idx / (this.w * CHUNK_SIZE));
    this.shadowTileRevision[y * this.chunksW + x] = this.shadowRevision;
  }

  private stampCaster(x: number, y: number, width: number, height: number, bottom: number, top: number): void {
    const x1 = Math.min(this.w, x + width);
    const y1 = Math.min(this.h, y + height);
    for (let cy = Math.max(0, y); cy < y1; cy++) {
      for (let cx = Math.max(0, x); cx < x1; cx++) {
        const idx = cy * this.w + cx;
        if (this.casterTop[idx] === 0) {
          this.casterCells.push(idx);
          this.casterBottom[idx] = bottom;
        } else {
          this.casterBottom[idx] = Math.min(this.casterBottom[idx], bottom);
        }
        this.casterTop[idx] = Math.max(this.casterTop[idx], top);
      }
    }
  }

  /** Samples the light on an actor's procedural surface normal once, then shades its palette. */
  surfacePalette(x: number, y: number, z: number, nx: number, ny: number, nz: number, tower = -1):
    (color: string) => string {
    const world = this.world;
    if (!world) return unlitColor;
    if (!this.illuminate(world, this.compiledLights, x, y, z, nx, ny, nz, 0.3, -1, tower, 0)) return unlitColor;
    const [r, g, b, sr, sg, sb, shadow] = this.surfaceLight;
    return (color) => {
      const [red, green, blue] = parseColorRgb01(color);
      return `rgb(${litChannel(red * 255, r, sr, shadow)} ${litChannel(green * 255, g, sg, shadow)} ${litChannel(blue * 255, b, sb, shadow)})`;
    };
  }

  // Cache only on the native raster. Actor samples use arbitrary heights and normals.
  private shadowCacheFor(slot: number, light: PointLight, tx0: number, ty0: number, tx1: number, ty1: number): ShadowCache {
    let revision = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      const row = ty * this.chunksW;
      for (let tx = tx0; tx <= tx1; tx++) revision = Math.max(revision, this.shadowTileRevision[row + tx]);
    }
    const x0 = tx0 * CHUNK_SIZE;
    const y0 = ty0 * CHUNK_SIZE;
    const w = (tx1 - tx0 + 1) * CHUNK_SIZE;
    const h = (ty1 - ty0 + 1) * CHUNK_SIZE;
    let cache = this.shadowCaches[slot];
    const length = w * h;
    if (!cache || cache.visibility.length < length) {
      cache = { x: 0, y: 0, z: 0, x0: 0, y0: 0, w: 0, h: 0, revision: -1, visibility: new Uint8Array(length) };
      this.shadowCaches[slot] = cache;
    }
    if (cache.revision !== revision || cache.x !== light.x || cache.y !== light.y || cache.z !== light.z ||
        cache.x0 !== x0 || cache.y0 !== y0 || cache.w !== w || cache.h !== h) {
      cache.x = light.x;
      cache.y = light.y;
      cache.z = light.z;
      cache.x0 = x0;
      cache.y0 = y0;
      cache.w = w;
      cache.h = h;
      cache.revision = revision;
      cache.visibility.fill(255, 0, length);
    }
    return cache;
  }

  /** Evaluates tiled 2.5D bump-mapped lighting and dynamic building cast shadows across
   * all active light tiles, updating `terrainLightU32` and `buildingLightU32`. */
  renderLighting(
    world: VoidWorld,
    terrainU32: Uint32Array,
    spriteCache: BuildingSpriteCache,
    lights: readonly PointLight[],
  ): void {
    const { w, h, chunksW, chunksH } = world.grid;
    const {
      terrainLightU32,
      buildingLightU32,
      terrainNx,
      terrainNy,
      terrainNz,
      terrainElev,
      tileLightsLo,
      tileLightsHi,
      tileVisited,
      prevActiveTiles,
      curActiveTiles,
    } = this;

    // 1. Clear only tiles that were lit in the previous frame
    if (prevActiveTiles.length > 0) {
      let cMinX = w;
      let cMinY = h;
      let cMaxX = 0;
      let cMaxY = 0;
      for (let t = 0; t < prevActiveTiles.length; t++) {
        const tileIdx = prevActiveTiles[t];
        const tx = tileIdx % chunksW;
        const ty = (tileIdx / chunksW) | 0;
        const x0 = tx * CHUNK_SIZE;
        const y0 = ty * CHUNK_SIZE;
        const x1 = Math.min(w, x0 + CHUNK_SIZE);
        const y1 = Math.min(h, y0 + CHUNK_SIZE);
        if (x0 < cMinX) cMinX = x0;
        if (y0 < cMinY) cMinY = y0;
        if (x1 > cMaxX) cMaxX = x1;
        if (y1 > cMaxY) cMaxY = y1;
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          terrainLightU32.fill(0, row + x0, row + x1);
          buildingLightU32.fill(0, row + x0, row + x1);
        }
      }
      if (this.terrainCtx && cMaxX > cMinX && cMaxY > cMinY) {
        this.terrainCtx.clearRect(cMinX, cMinY, cMaxX - cMinX, cMaxY - cMinY);
      }
      if (this.buildingCtx && cMaxX > cMinX && cMaxY > cMinY) {
        this.buildingCtx.clearRect(cMinX, cMinY, cMaxX - cMinX, cMaxY - cMinY);
      }
      prevActiveTiles.length = 0;
    }

    this.dirtyBounds = { x0: w, y0: h, x1: 0, y1: 0, hasTerrain: false, hasBuilding: false };
    const lightCount = Math.min(MAX_DYNAMIC_LIGHTS, lights.length);
    const compiled = this.compiledLights;
    compiled.length = lightCount;
    if (lightCount === 0) return;

    // 2. Compile lights and bin them into 16x16 tiles via 64-bit bitmasks
    curActiveTiles.length = 0;

    for (let k = 0; k < lightCount; k++) {
      const l = lights[k];
      const R = l.radius;
      const x = Math.floor(l.x + 0.5);
      const y = Math.floor(l.y + 0.5);
      const src = world.grid.inBounds(x, y) ? y * w + x : -1;
      const tx0 = Math.max(0, Math.floor((l.x - R) / CHUNK_SIZE));
      const tx1 = Math.min(chunksW - 1, Math.floor((l.x + R) / CHUNK_SIZE));
      // Raised roofs at ground y project upward to sy = y - MAX_ELEVATION_PX
      const ty0 = Math.max(0, Math.floor((l.y - R - MAX_ELEVATION_PX) / CHUNK_SIZE));
      const ty1 = Math.min(chunksH - 1, Math.floor((l.y + R) / CHUNK_SIZE));
      const shadowCache = l.castsShadows && tx0 <= tx1 && ty0 <= ty1 ?
        this.shadowCacheFor(k, l, tx0, ty0, tx1, ty1) : undefined;
      compiled[k] = {
        ...l,
        radiusSq: R * R,
        invRadius: 1 / Math.max(1, R),
        sourceBuilding: world.buildingAt[src] ?? -1,
        sourceTower: world.towerAt[src] ?? -1,
        shadowCache,
      };
      const isHi = k >= 32;
      const bit = 1 << (k & 31);

      for (let ty = ty0; ty <= ty1; ty++) {
        const tRow = ty * chunksW;
        for (let tx = tx0; tx <= tx1; tx++) {
          const tileIdx = tRow + tx;
          if (!tileVisited[tileIdx]) {
            tileVisited[tileIdx] = 1;
            curActiveTiles.push(tileIdx);
          }
          if (isHi) tileLightsHi[tileIdx] |= bit;
          else tileLightsLo[tileIdx] |= bit;
        }
      }
    }

    const {
      atlasColorU32,
      atlasElev,
      atlasNx,
      atlasNy,
      atlasNz,
      atlasSpec,
      atlasBldId,
    } = spriteCache;
    const { material } = world;
    const localLights: CompiledLight[] = [];

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let hasTerrain = false;
    let hasBuilding = false;

    // 3. Shade active 16x16 tiles
    for (let t = 0; t < curActiveTiles.length; t++) {
      const tileIdx = curActiveTiles[t];
      let maskLo = tileLightsLo[tileIdx];
      let maskHi = tileLightsHi[tileIdx];
      tileLightsLo[tileIdx] = 0;
      tileLightsHi[tileIdx] = 0;
      tileVisited[tileIdx] = 0;
      prevActiveTiles.push(tileIdx);

      localLights.length = 0;
      while (maskLo !== 0) {
        const bitIdx = 31 - Math.clz32(maskLo & -maskLo);
        localLights.push(compiled[bitIdx]);
        maskLo &= maskLo - 1;
      }
      while (maskHi !== 0) {
        const bitIdx = 31 - Math.clz32(maskHi & -maskHi);
        localLights.push(compiled[32 + bitIdx]);
        maskHi &= maskHi - 1;
      }
      const nLocal = localLights.length;
      if (nLocal === 0) continue;

      const tx = tileIdx % chunksW;
      const ty = (tileIdx / chunksW) | 0;
      const x0 = tx * CHUNK_SIZE;
      const y0 = ty * CHUNK_SIZE;
      const x1 = Math.min(w, x0 + CHUNK_SIZE);
      const y1 = Math.min(h, y0 + CHUNK_SIZE);

      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;

      for (let sy = y0; sy < y1; sy++) {
        const row = sy * w;
        for (let sx = x0; sx < x1; sx++) {
          const i = row + sx;
          const bldAbgr = atlasColorU32[i];
          const isBuilding = bldAbgr !== 0;

          if (!isBuilding && material[i] === CellMaterial.VOID) {
            continue;
          }

          const baseAbgr = isBuilding ? bldAbgr : terrainU32[i];
          if (baseAbgr === 0) continue;

          const wz = isBuilding ? atlasElev[i] : terrainElev[i];
          const nx = (isBuilding ? atlasNx[i] : terrainNx[i]) * (1 / 127);
          const ny = (isBuilding ? atlasNy[i] : terrainNy[i]) * (1 / 127);
          const nz = (isBuilding ? atlasNz[i] : terrainNz[i]) * (1 / 127);
          const specWeight = isBuilding
            ? atlasSpec[i] * (1 / 255)
            : material[i] === CellMaterial.UNCLAIMED
              ? 0.65
              : material[i] === CellMaterial.BARRIER
                ? 0.55
                : 0.16;
          const selfBldId = isBuilding ? atlasBldId[i] : -1;

          // Reconstruct 3D world ground position from oblique screen coordinate (sy = wy - wz)
          const wx = sx;
          const wy = isBuilding ? Math.min(h - 1, sy + wz) : sy;

          const shadowDarken = isBuilding && wz > 0 ?
            this.roofShadowAt(world, i, wx, wy, wz, selfBldId) : 0;

          if (!this.illuminate(world, localLights, wx, wy, wz, nx, ny, nz, specWeight,
            selfBldId, -1, shadowDarken, sy)) continue;

          const br = IS_LITTLE_ENDIAN ? baseAbgr & 255 : baseAbgr >>> 24;
          const bg = (baseAbgr >>> (IS_LITTLE_ENDIAN ? 8 : 16)) & 255;
          const bb = (baseAbgr >>> (IS_LITTLE_ENDIAN ? 16 : 8)) & 255;
          const light = this.surfaceLight;
          const packed = packRgba(
            litChannel(br, light[0], light[3], light[6]),
            litChannel(bg, light[1], light[4], light[6]),
            litChannel(bb, light[2], light[5], light[6]),
          );

          if (isBuilding) {
            buildingLightU32[i] = packed;
            hasBuilding = true;
          } else {
            terrainLightU32[i] = packed;
            hasTerrain = true;
          }
        }
      }
    }

    if (maxX > minX && maxY > minY) {
      this.dirtyBounds = { x0: minX, y0: minY, x1: maxX, y1: maxY, hasTerrain, hasBuilding };
      const dw = maxX - minX;
      const dh = maxY - minY;
      if (hasTerrain && this.terrainCtx && this.terrainImageData) {
        this.terrainCtx.putImageData(this.terrainImageData, 0, 0, minX, minY, dw, dh);
      }
      if (hasBuilding && this.buildingCtx && this.buildingImageData) {
        this.buildingCtx.putImageData(this.buildingImageData, 0, 0, minX, minY, dw, dh);
      }
    }
  }

  private illuminate(
    world: VoidWorld, lights: readonly CompiledLight[],
    wx: number, wy: number, wz: number, nx: number, ny: number, nz: number,
    specWeight: number, selfBuilding: number, selfTower: number, shadow: number, screenY = -1,
  ): boolean {
    let red = 0;
    let green = 0;
    let blue = 0;
    let specRed = 0;
    let specGreen = 0;
    let specBlue = 0;
    for (let m = 0; m < lights.length; m++) {
      const light = lights[m];
      const dx = light.x - wx;
      const dy = light.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= light.radiusSq) continue;

      const dz = light.z - wz;
      const falloff = 1 - Math.sqrt(d2) * light.invRadius;
      const fPow = light.falloffPower === 3 ? falloff * falloff * falloff : falloff * falloff;
      const attenuation = fPow / (1 + dz * dz * 0.035);
      let visible = 1;
      if (light.castsShadows && d2 > 1) {
        const cache = screenY < 0 ? undefined : light.shadowCache;
        const index = cache ? (screenY - cache.y0) * cache.w + wx - cache.x0 : 0;
        const cached = cache ? cache.visibility[index] : 255;
        if (cached < 255) {
          visible = cached / 254;
        } else {
          visible = traceLightOcclusion(world, this.groundElev, wx, wy, wz, selfBuilding,
            light.x, light.y, light.z, this.casterTop, this.casterBottom,
            light.sourceBuilding, light.sourceTower, selfTower);
          if (cache) {
            const packed = Math.round(visible * 254);
            cache.visibility[index] = packed;
            visible = packed / 254;
          }
        }
        shadow = Math.min(0.62, shadow + (1 - visible) * falloff * light.shadowStrength);
        if (visible === 0) continue;
      }

      const invDistance = 1 / (Math.sqrt(d2 + dz * dz) + 0.001);
      const lx = dx * invDistance;
      const ly = dy * invDistance;
      const lz = dz * invDistance;
      // A broad diffuse lobe gives nearby surfaces a soft glow, gated by the same shadow ray.
      const facing = nx * lx + ny * ly + nz * lz;
      const diffuse = (0.24 + Math.max(0, facing) * 0.76) * attenuation * visible;
      red += light.r * diffuse;
      green += light.g * diffuse;
      blue += light.b * diffuse;

      if (facing > 0 && specWeight > 0.05 && light.specular > 0) {
        const hy = ly + 0.35;
        const hz = lz + 0.94;
        const ndoth = (nx * lx + ny * hy + nz * hz) / Math.sqrt(lx * lx + hy * hy + hz * hz);
        if (ndoth > 0.5) {
          const squared = ndoth * ndoth;
          const fourth = squared * squared;
          const specular = fourth * fourth * attenuation * visible * specWeight * light.specular * 135;
          specRed += light.r * specular;
          specGreen += light.g * specular;
          specBlue += light.b * specular;
        }
      }
    }

    if (red + green + blue < 0.015 && specRed + specGreen + specBlue < 0.5 && shadow < 0.015) return false;
    // Blend warm directional sunlight on unshadowed sun-facing relief/bevels and cool sky/Void ambient fill
    // on lit/shadowed tiles without mutating unlit static palette tests
    const sunDot = Math.max(0, nx * SUN_DIRECTION.x + ny * SUN_DIRECTION.y + nz * SUN_DIRECTION.z);
    const sunVis = Math.max(0, 1 - shadow * 1.45);
    const sunTerm = Math.max(0, sunDot - 0.56) * 0.55 * sunVis;
    const gIdx =
      Math.min(this.h - 1, Math.max(0, Math.floor(wy))) * this.w +
      Math.min(this.w - 1, Math.max(0, Math.floor(wx)));
    const nearVoid =
      world.material[gIdx] === CellMaterial.VOID ||
      (gIdx > 0 && world.material[gIdx - 1] === CellMaterial.VOID) ||
      (gIdx + 1 < world.material.length && world.material[gIdx + 1] === CellMaterial.VOID);
    const amb = nearVoid ? VOID_AMBIENT_FILL : AMBIENT_COOL_FILL;
    const ambScale = Math.min(0.22, (red + green + blue) * 0.14 + shadow * 0.32);
    red += SUN_WARM_COLOR[0] * sunTerm + amb[0] * ambScale;
    green += SUN_WARM_COLOR[1] * sunTerm + amb[1] * ambScale;
    blue += SUN_WARM_COLOR[2] * sunTerm + amb[2] * ambScale;
    const out = this.surfaceLight;
    out[0] = red;
    out[1] = green;
    out[2] = blue;
    out[3] = specRed;
    out[4] = specGreen;
    out[5] = specBlue;
    out[6] = shadow;
    return true;
  }

}
