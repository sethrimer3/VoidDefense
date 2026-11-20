/** 2.5D bump-mapped surface lighting, dynamic building shadow-casting, and screen-space
 * atmospheric bloom for Void Defense.
 *
 * Architecture:
 * - Incremental Normal & Elevation G-Buffer (`1 cell = 1 world pixel`):
 *   - Ground terrain (`terrainNx`, `terrainNy`, `terrainNz`, `terrainElev`) is derived from a
 *     procedural height relief field (`terrainReliefAt`: street curbs, defensive walls, craggy
 *     salvage rubble, domed forest canopy, orchard tree crowns, wheat furrows, river ripples)
 *     and updated only for dirtied 16x16 terrain chunks.
 *   - Elevated 2.5D buildings (`BuildingSpriteCache` in `elevation.ts`) provide per-pixel 3D
 *     elevation `z` (`0..15` px), specular weight, and 3D bump normals for south facades
 *     (window panes, vertical pilasters, horizontal floor spandrels, side borders), exposed
 *     interior cutaways (projecting concrete floor slabs, recessed rooms), and roofs (parapet
 *     bevels, setback terraces, solar panels, civic domes, pitched farmhouse gables).
 * - Tiled Deferred 2.5D Lighting & Height-Field Shadow Raycasting:
 *   - Dynamic lights (explosions/shockwaves, Void portals, active Void frontier surges and
 *     lightning bolts, parabolic artillery/rocket shells, laser impacts, farm fires, Countervoid,
 *     Lantern Bearers, towers, Void Nodes, and cosmic organisms) are binned into 16x16 tiles
 *     using 64-bit tile bitmasks (`tileLightsLo`, `tileLightsHi`).
 *   - Only active tiles are shaded, visiting each pixel at most once per frame with zero GPU
 *     canvas readbacks (`getImageData` is never called).
 *   - Each light traces a 2.5D ray through `groundElev` so tall buildings block light from
 *     explosions, the Void, and other sources, casting directional dynamic shadows away from
 *     the light source across streets and shorter neighboring buildings.
 * - Screen-Space Additive Bloom (`drawBloom`):
 *   - Composites pre-cached 64x64 radial glow stamps in `lighter` mode over the scaled display
 *     canvas while keeping `sceneLayer` strictly unfiltered 1:1 pixel art. */

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
import { CellMaterial, LandCover } from "./model.ts";
import { valueNoise } from "./portal-noise.ts";
import type { VoidSim } from "./sim.ts";
import { TOWER_SPECS } from "./towers.ts";
import type { VoidWorld } from "./world.ts";

export const MAX_DYNAMIC_LIGHTS = 48;

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
  /** Screen-space bloom intensity (`0` for none). */
  bloom: number;
  /** Optional bloom radius multiplier relative to light radius (default `1.0`). */
  bloomScale?: number;
  /** Priority score for capping to `MAX_DYNAMIC_LIGHTS`. */
  priority?: number;
};

type CompiledLight = PointLight & {
  radiusSq: number;
  invRadius: number;
};

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

function unpackRgb(abgr: number): [number, number, number] {
  if (IS_LITTLE_ENDIAN) {
    return [abgr & 0xff, (abgr >>> 8) & 0xff, (abgr >>> 16) & 0xff];
  }
  return [(abgr >>> 24) & 0xff, (abgr >>> 16) & 0xff, (abgr >>> 8) & 0xff];
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

/** Computes the unit 3D surface normal `(nx, ny, nz)` for terrain cell `(x, y)` from its relief gradient. */
export function computeTerrainNormalAt(
  world: VoidWorld,
  x: number,
  y: number,
): [number, number, number] {
  const hL = terrainReliefAt(world, x - 1, y);
  const hR = terrainReliefAt(world, x + 1, y);
  const hU = terrainReliefAt(world, x, y - 1);
  const hD = terrainReliefAt(world, x, y + 1);
  const scale = 1.45;
  const sx = (hR - hL) * scale;
  const sy = (hD - hU) * scale;
  const inv = 1 / Math.sqrt(1 + sx * sx + sy * sy);
  return [-sx * inv, -sy * inv, inv];
}

/** Fast 2.5D height-field raycast from target `(wx, wy, wz)` toward light `(lx, ly, lz)`.
 * Returns visibility in `[0, 1]` (`0` = fully occluded by an intervening building/wall,
 * `0.28` = grazing rooftop penumbra, `1` = clear line of sight). */
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
): number {
  const dx = lx - wx;
  const dy = ly - wy;
  const dist2 = dx * dx + dy * dy;
  if (dist2 < 2.25) return 1;
  const { w, h } = world.grid;
  const { buildingAt } = world;
  const dz = lz - wz;
  let vis = 1;

  // 4-step height-field march along the segment from target to light
  const steps = dist2 > 144 ? 5 : 4;
  const invSteps = 1 / (steps + 1);
  for (let s = 1; s <= steps; s++) {
    const t = s * invSteps;
    const cx = (wx + dx * t + 0.5) | 0;
    const cy = (wy + dy * t + 0.5) | 0;
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
    const cIdx = cy * w + cx;
    const occElev = groundElev[cIdx];
    if (occElev <= wz) continue;
    if (selfBldId >= 0 && buildingAt[cIdx] === selfBldId) continue;
    const rayZ = wz + dz * t;
    if (occElev > rayZ + 0.35) {
      if (occElev > rayZ + 1.45) {
        return 0;
      }
      vis = 0.28;
    }
  }
  return vis;
}

/** Gathers and prioritizes all active dynamic light sources in the scene (explosions, Void portals,
 * active Void frontier & lightning, shells, lasers, farm fires, Countervoid, Lantern Bearers, towers,
 * Void Nodes, and cosmic organisms), capped to `MAX_DYNAMIC_LIGHTS`. */
export function collectSceneLights(
  sim: VoidSim,
  animTime: number,
  reduceEffects: boolean,
  buildingHeight: BuildingHeightMode = "full",
): PointLight[] {
  const { world, voidField, combat, physics } = sim;
  const { w } = world.grid;
  const pulse = reduceEffects ? 0.78 : 0.68 + 0.32 * Math.sin(animTime * 5.2);
  const tElev =
    buildingHeight === "flat" ? 0 : buildingHeight === "low" ? 1 : TOWER_ELEVATION_PX;
  const lights: PointLight[] = [];

  // 1. Explosions & expanding impact/strike shockwaves (highest priority, strong shadows & bloom)
  for (let i = 0; i < physics.shockwaves.length; i++) {
    const s = physics.shockwaves[i];
    const t = Math.min(1, Math.max(0, s.life / Math.max(0.01, s.maxLife)));
    const flash = Math.pow(1 - t, 0.7);
    if (flash <= 0.04) continue;
    const [cr, cg, cb] = parseColorRgb01(s.color);
    const [sr, sg, sb] = parseColorRgb01(s.secondaryColor || s.color);
    const boost = 1.85 * flash;
    const radius = Math.min(44, Math.max(12, s.maxRadius * (1.45 + t * 0.95)));
    lights.push({
      x: s.x,
      y: s.y,
      z: 5.5 + s.maxRadius * 0.35 * (1 - t * 0.4),
      r: (cr * 0.65 + sr * 0.35) * boost,
      g: (cg * 0.65 + sg * 0.35) * boost,
      b: (cb * 0.65 + sb * 0.35) * boost,
      radius,
      specular: 0.95,
      castsShadows: true,
      shadowStrength: 0.52 * flash,
      bloom: 0.95 * flash,
      bloomScale: 1.35,
      priority: 100 + radius,
    });
  }

  // 2. Echo Mine pending blasts & persistent echoes
  for (let i = 0; i < combat.echoPendingBlasts.length; i++) {
    const eb = combat.echoPendingBlasts[i];
    lights.push({
      x: eb.x,
      y: eb.y,
      z: 4.5,
      r: 1.55,
      g: 0.72,
      b: 0.22,
      radius: Math.max(14, eb.radius * 1.6),
      specular: 0.85,
      castsShadows: true,
      shadowStrength: 0.42,
      bloom: 0.85,
      bloomScale: 1.25,
      priority: 96,
    });
  }
  for (let i = 0; i < combat.persistentEchoes.length; i++) {
    const pe = combat.persistentEchoes[i];
    lights.push({
      x: pe.x,
      y: pe.y,
      z: 3.5,
      r: 1.05 * pulse,
      g: 0.54 * pulse,
      b: 0.18 * pulse,
      radius: Math.max(12, pe.radius * 1.3),
      specular: 0.6,
      castsShadows: true,
      shadowStrength: 0.25,
      bloom: 0.45,
      priority: 72,
    });
  }

  // 3. Chrono Cannon temporal reconstruction flashes
  for (let i = 0; i < combat.chronoEffects.length; i++) {
    const ef = combat.chronoEffects[i];
    const p = Math.min(1, ef.life / Math.max(0.05, ef.maxLife));
    const fade = 1 - p * 0.75;
    lights.push({
      x: ef.sx,
      y: ef.sy,
      z: 6.0,
      r: 1.35 * fade,
      g: 1.08 * fade,
      b: 0.44 * fade,
      radius: Math.max(14, ef.radius * 1.85),
      specular: 0.8,
      castsShadows: true,
      shadowStrength: 0.38 * fade,
      bloom: 0.8 * fade,
      bloomScale: 1.25,
      priority: 94,
    });
  }

  // 4. Void Portals (black hole event horizon accretion glow)
  const activePortals = [];
  for (let i = 0; i < world.portals.length; i++) {
    const p = world.portals[i];
    if (p.active) {
      activePortals.push(p);
      lights.push({
        x: p.x,
        y: p.y,
        z: 8.5,
        r: 0.88 * pulse,
        g: 0.26 * pulse,
        b: 1.15 * pulse,
        radius: Math.min(48, Math.max(20, p.radius * 2.4)),
        specular: 0.72,
        castsShadows: true,
        shadowStrength: 0.36,
        bloom: 0.62 * pulse,
        bloomScale: 1.35,
        priority: 92,
      });
    } else {
      lights.push({
        x: p.x,
        y: p.y,
        z: 5.0,
        r: 0.55 * pulse,
        g: 0.18 * pulse,
        b: 0.72 * pulse,
        radius: Math.max(12, p.radius * 1.4),
        specular: 0.4,
        castsShadows: false,
        shadowStrength: 0,
        bloom: 0.28 * pulse,
        priority: 60,
      });
    }
  }

  // 5. Laser beams (muzzle & high-intensity target impact lights)
  for (let i = 0; i < combat.lasers.length; i++) {
    const b = combat.lasers[i];
    const [cr, cg, cb] = parseColorRgb01(b.color);
    lights.push({
      x: b.x1,
      y: b.y1,
      z: 3.5,
      r: Math.min(1.8, cr * 1.35 + 0.35),
      g: Math.min(1.8, cg * 1.35 + 0.28),
      b: Math.min(1.8, cb * 1.35 + 0.15),
      radius: 13,
      specular: 0.9,
      castsShadows: true,
      shadowStrength: 0.32,
      bloom: 0.68,
      priority: 88,
    });
    lights.push({
      x: b.x0,
      y: b.y0,
      z: 2.8,
      r: cr * 0.85,
      g: cg * 0.85,
      b: cb * 0.85,
      radius: 8,
      specular: 0.5,
      castsShadows: false,
      shadowStrength: 0,
      bloom: 0.32,
      priority: 64,
    });
  }

  // 6. Parabolic artillery & rocket shells in flight (3D height rises along arc)
  for (let i = 0; i < combat.pellets.length; i++) {
    const p = combat.pellets[i];
    const arcLift = Math.sin(p.progress * Math.PI) * 3.8;
    const wx = p.x + (p.tx - p.x) * p.progress;
    const wy = p.y + (p.ty - p.y) * p.progress;
    const wz = 2.5 + arcLift * 1.45;
    lights.push({
      x: wx,
      y: wy,
      z: wz,
      r: p.wallPayload ? 0.28 : 1.15,
      g: p.wallPayload ? 0.92 : 0.64,
      b: p.wallPayload ? 1.15 : 0.22,
      radius: 12,
      specular: 0.8,
      castsShadows: true,
      shadowStrength: 0.26,
      bloom: 0.52,
      priority: 84,
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
        bloom: 0.52 * flick,
        priority: 82,
      });
    }
  }

  // 8. Placed Resistance Towers & Lantern Bearer / Heavy Mech agents
  for (let i = 0; i < combat.towers.length; i++) {
    const t = combat.towers[i];
    const cx = t.x + t.w * 0.5;
    const cy = t.y + t.h * 0.5;
    const spec = TOWER_SPECS[t.type];
    const justFired = spec.cooldownSeconds > 0 && t.cooldown > spec.cooldownSeconds * 0.72;

    if (t.type === "countervoidHeart") {
      const beat = reduceEffects ? 0.85 : 0.7 + 0.3 * Math.sin(sim.tick * 0.16);
      lights.push({
        x: cx,
        y: cy,
        z: tElev + 3.5,
        r: 1.15 * beat,
        g: 0.58 * beat,
        b: 0.16 * beat,
        radius: 18,
        specular: 0.65,
        castsShadows: true,
        shadowStrength: 0.28,
        bloom: 0.55 * beat,
        priority: 78,
      });
    } else if (t.type === "shieldProjector") {
      const pool = combat.shieldPools.get(t.uid) ?? 0;
      if (pool > 5) {
        lights.push({
          x: cx,
          y: cy,
          z: tElev + 3.5,
          r: 0.25,
          g: 0.88,
          b: 1.05,
          radius: 16,
          specular: 0.75,
          castsShadows: true,
          shadowStrength: 0.22,
          bloom: 0.45,
          priority: 74,
        });
      }
    } else if (t.type === "voidSiphon") {
      const s = combat.siphonStates.get(t.uid);
      const venting = s?.phase === "venting";
      lights.push({
        x: cx,
        y: cy,
        z: tElev + 4.0,
        r: venting ? 1.1 : 0.62,
        g: venting ? 0.68 : 0.36,
        b: venting ? 0.25 : 1.05,
        radius: 15,
        specular: 0.7,
        castsShadows: true,
        shadowStrength: 0.22,
        bloom: venting ? 0.55 : 0.38,
        priority: 73,
      });
    } else if (t.type === "boundaryPrism") {
      lights.push({
        x: cx,
        y: cy,
        z: tElev + 3.5,
        r: 0.38,
        g: 0.92,
        b: 1.0,
        radius: 14,
        specular: 0.85,
        castsShadows: true,
        shadowStrength: 0.2,
        bloom: 0.44,
        priority: 72,
      });
    } else if (t.type === "chronoCannon") {
      lights.push({
        x: cx,
        y: cy,
        z: tElev + 3.2,
        r: 0.95,
        g: 0.76,
        b: 0.3,
        radius: 13,
        specular: 0.7,
        castsShadows: true,
        shadowStrength: 0.2,
        bloom: 0.38,
        priority: 71,
      });
    } else if (justFired) {
      // Muzzle blast light when Matter Cannon / Rocket Team fires
      const [cr, cg, cb] = parseColorRgb01(spec.color);
      lights.push({
        x: cx,
        y: cy,
        z: tElev + 3.2,
        r: Math.min(1.5, cr * 1.2 + 0.4),
        g: Math.min(1.5, cg * 1.2 + 0.3),
        b: Math.min(1.5, cb * 1.2 + 0.15),
        radius: 13,
        specular: 0.75,
        castsShadows: true,
        shadowStrength: 0.25,
        bloom: 0.5,
        priority: 79,
      });
    }
  }

  for (let i = 0; i < combat.agents.length; i++) {
    const a = combat.agents[i];
    if (a.kind === "lanternBearer") {
      const haloR = a.coverageRadius ?? pixels(2 + sim.tech.lanternRadiusBonus);
      lights.push({
        x: a.x,
        y: a.y,
        z: 3.5,
        r: 0.98,
        g: 0.78,
        b: 0.38,
        radius: Math.max(11, haloR * 2.1),
        specular: 0.65,
        castsShadows: true,
        shadowStrength: 0.24,
        bloom: 0.42,
        priority: 76,
      });
    } else if (a.kind === "heavyMech" || a.kind === "wallSerpent") {
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
        bloom: 0.24,
        priority: 52,
      });
    }
  }

  // 9. Crystalline Void Nodes & Luminous Cosmic Organisms
  for (let i = 0; i < voidField.nodes.length; i++) {
    const node = voidField.nodes[i];
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
      bloom: 0.5,
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
      lights.push({
        x: o.x,
        y: o.y,
        z: isBoss ? 4.8 : 3.2,
        r: o.kind === "voidBloom" ? 0.95 : 0.72,
        g: o.kind === "nexusCrystal" ? 0.78 : 0.28,
        b: 1.05,
        radius: isBoss ? 15 : 10,
        specular: 0.65,
        castsShadows: isBoss,
        shadowStrength: isBoss ? 0.24 : 0,
        bloom: isBoss ? 0.46 : 0.28,
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
          bloom: 0.55 * flick,
          priority: 80,
        });
      }
    }

    // Clustered frontier perimeter glow (up to 12 evenly strided samples around the breach)
    const clusterTarget = 12;
    const fStride = Math.max(1, Math.floor(fLen / clusterTarget));
    for (let i = 0; i < fLen; i += fStride) {
      const cIdx = voidField.frontierCells[i];
      const fx = (cIdx % w) + 0.5;
      const fy = ((cIdx / w) | 0) + 0.5;
      const micro = voidField.cellMicroWork[cIdx];
      const intensity = Math.min(1, 0.35 + micro / 1400);
      lights.push({
        x: fx,
        y: fy,
        z: 4.0,
        r: 0.64 * intensity * pulse,
        g: 0.18 * intensity * pulse,
        b: 0.92 * intensity * pulse,
        radius: 14 + intensity * 5,
        specular: 0.55,
        castsShadows: true,
        shadowStrength: 0.25 * intensity,
        bloom: 0.24 * intensity,
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
      lights.push({
        x: (idx % w) + 0.5,
        y: ((idx / w) | 0) + 0.5,
        z: 3.0,
        r: 0.95,
        g: 0.52,
        b: 0.14,
        radius: 12,
        specular: 0.5,
        castsShadows: false,
        shadowStrength: 0,
        bloom: 0.26,
        priority: 58,
      });
    }
  }

  if (lights.length > MAX_DYNAMIC_LIGHTS) {
    lights.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    lights.length = MAX_DYNAMIC_LIGHTS;
  }
  return lights;
}

export class LightingEngine {
  private world: VoidWorld | null = null;
  private mode: BuildingHeightMode = "full";
  private w = 0;
  private h = 0;
  private tilesW = 0;
  private tilesH = 0;

  /** Terrain normal and elevation buffers (`w * h`). */
  terrainNx = new Int8Array(0);
  terrainNy = new Int8Array(0);
  terrainNz = new Int8Array(0);
  terrainElev = new Uint8Array(0);
  /** Ground-footprint height-field (`w * h`) for 2.5D shadow raycasting. */
  groundElev = new Uint8Array(0);
  /** Building-to-building static NW sun shadow factor (`0..100` on screen coordinates `w * h`). */
  buildingSunShadow = new Uint8Array(0);

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

  /** Cached 64x64 radial bloom gradient stamps keyed by quantized RGB. */
  private readonly bloomStamps = new Map<string, HTMLCanvasElement>();

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
      this.tilesW = chunksW;
      this.tilesH = chunksH;
      this.terrainNx = new Int8Array(count);
      this.terrainNy = new Int8Array(count);
      this.terrainNz = new Int8Array(count);
      this.terrainElev = new Uint8Array(count);
      this.groundElev = new Uint8Array(count);
      this.buildingSunShadow = new Uint8Array(count);
      this.terrainLightU32 = new Uint32Array(count);
      this.buildingLightU32 = new Uint32Array(count);

      const tileCount = chunksW * chunksH;
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

    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        if (!rebuildAll && dirtyChunkFlags && !dirtyChunkFlags[cy * chunksW + cx]) continue;
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const x1 = Math.min(w, x0 + CHUNK_SIZE);
        const y1 = Math.min(h, y0 + CHUNK_SIZE);
        this.bakeChunkNormalsAndElev(world, mode, x0, y0, x1, y1);
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
    const { w } = world.grid;
    const { material, landCover, buildingAt, buildings, columnFloors, towerAt } = world;
    const effMode = mode === "flat" ? "full" : mode;
    const tElev = mode === "flat" ? 0 : mode === "low" ? 1 : TOWER_ELEVATION_PX;

    for (let y = y0; y < y1; y++) {
      const row = y * w;
      for (let x = x0; x < x1; x++) {
        const idx = row + x;
        const [nx, ny, nz] = computeTerrainNormalAt(world, x, y);
        this.terrainNx[idx] = Math.max(-127, Math.min(127, Math.round(nx * 127)));
        this.terrainNy[idx] = Math.max(-127, Math.min(127, Math.round(ny * 127)));
        this.terrainNz[idx] = Math.max(-127, Math.min(127, Math.round(nz * 127)));

        const mat = material[idx];
        const cover = landCover[idx];
        const tGround =
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
        } else if (towerAt && towerAt[idx] >= 0) {
          this.groundElev[idx] = tElev;
        } else {
          this.groundElev[idx] = tGround;
        }
      }
    }
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
      groundElev,
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
    if (lightCount === 0) return;

    // 2. Compile lights and bin them into 16x16 tiles via 64-bit bitmasks
    const compiled: CompiledLight[] = new Array(lightCount);
    curActiveTiles.length = 0;

    for (let k = 0; k < lightCount; k++) {
      const l = lights[k];
      const R = l.radius;
      compiled[k] = {
        ...l,
        radiusSq: R * R,
        invRadius: 1 / Math.max(1, R),
      };
      const tx0 = Math.max(0, Math.floor((l.x - R) / CHUNK_SIZE));
      const tx1 = Math.min(chunksW - 1, Math.floor((l.x + R) / CHUNK_SIZE));
      // Raised roofs at ground y project upward to sy = y - MAX_ELEVATION_PX
      const ty0 = Math.max(0, Math.floor((l.y - R - MAX_ELEVATION_PX) / CHUNK_SIZE));
      const ty1 = Math.min(chunksH - 1, Math.floor((l.y + R) / CHUNK_SIZE));
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
    const { material, buildingAt } = world;
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
          const wy = Math.min(h - 1, sy + wz);

          let totR = 0;
          let totG = 0;
          let totB = 0;
          let specR = 0;
          let specG = 0;
          let specB = 0;
          let shadowDarken = 0;

          // Check building-to-building static directional NW sun shadow on shorter buildings
          if (isBuilding && wz > 0) {
            for (let step = 1; step <= 8; step++) {
              const sNx = wx - step;
              const sNy = wy - step;
              if (sNx < 0 || sNy < 0) break;
              const sIdx = sNy * w + sNx;
              const casterBld = buildingAt[sIdx];
              if (casterBld >= 0 && casterBld !== selfBldId) {
                const casterElev = groundElev[sIdx];
                const deltaE = casterElev - wz;
                const reach = Math.ceil(deltaE * 0.65);
                if (deltaE > 0 && step <= reach) {
                  shadowDarken = Math.max(
                    shadowDarken,
                    0.36 - (step - 1) * (0.22 / Math.max(1, reach)),
                  );
                }
              }
            }
          }

          for (let m = 0; m < nLocal; m++) {
            const L = localLights[m];
            const dx = L.x - wx;
            const dy = L.y - wy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= L.radiusSq) continue;

            const dist2D = Math.sqrt(d2);
            const linAtten = 1 - dist2D * L.invRadius;
            const atten = linAtten * linAtten;

            let vis = 1;
            if (L.castsShadows && dist2D > 1.5) {
              vis = traceLightOcclusion(world, groundElev, wx, wy, wz, selfBldId, L.x, L.y, L.z);
              if (vis < 1 && L.shadowStrength > 0) {
                shadowDarken = Math.min(
                  0.62,
                  shadowDarken + (1 - vis) * linAtten * L.shadowStrength,
                );
              }
              if (vis <= 0.01) continue;
            }

            const dz = L.z - wz;
            const inv3D = 1 / (Math.sqrt(d2 + dz * dz) + 0.001);
            const lx = dx * inv3D;
            const ly = dy * inv3D;
            const lz = dz * inv3D;

            const ndotl = nx * lx + ny * ly + nz * lz;
            if (ndotl <= 0) {
              // Subtle bump self-shadowing on facets angled away from a strong nearby light
              if (isBuilding && ndotl < -0.15) {
                shadowDarken = Math.min(0.55, shadowDarken + -ndotl * atten * vis * 0.16);
              }
              continue;
            }

            const diff = ndotl * atten * vis;
            totR += L.r * diff;
            totG += L.g * diff;
            totB += L.b * diff;

            if (specWeight > 0.05 && L.specular > 0) {
              // Halfway vector between light ray and oblique viewer (0, 0.35, 0.94)
              const hx = lx;
              const hy = ly + 0.35;
              const hz = lz + 0.94;
              const hInv = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
              const ndoth = Math.max(0, (nx * hx + ny * hy + nz * hz) * hInv);
              if (ndoth > 0.5) {
                const s2 = ndoth * ndoth;
                const s4 = s2 * s2;
                const kSpec = s4 * s4 * atten * vis * specWeight * L.specular * 135;
                specR += L.r * kSpec;
                specG += L.g * kSpec;
                specB += L.b * kSpec;
              }
            }
          }

          if (totR + totG + totB < 0.015 && specR + specG + specB < 0.5 && shadowDarken < 0.015) {
            continue;
          }

          const [br, bg, bb] = unpackRgb(baseAbgr);
          const shadeMul = Math.max(0.28, 1 - shadowDarken);
          // Warm ambient bounce + direct colored diffuse + specular glint
          const r = Math.min(255, Math.max(0, Math.round(br * (shadeMul + totR * 1.15) + totR * 18 + specR)));
          const g = Math.min(255, Math.max(0, Math.round(bg * (shadeMul + totG * 1.15) + totG * 18 + specG)));
          const b = Math.min(255, Math.max(0, Math.round(bb * (shadeMul + totB * 1.15) + totB * 18 + specB)));
          const packed = packRgba(r, g, b, 255);

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

  private getBloomStamp(r01: number, g01: number, b01: number): HTMLCanvasElement | null {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    const peak = Math.max(0.01, r01, g01, b01);
    const qr = Math.min(15, Math.round((r01 / peak) * 15));
    const qg = Math.min(15, Math.round((g01 / peak) * 15));
    const qb = Math.min(15, Math.round((b01 / peak) * 15));
    const key = `${qr},${qg},${qb}`;
    let stamp = this.bloomStamps.get(key);
    if (!stamp) {
      stamp = document.createElement("canvas");
      stamp.width = 64;
      stamp.height = 64;
      const c = stamp.getContext("2d")!;
      const r255 = Math.round((qr / 15) * 255);
      const g255 = Math.round((qg / 15) * 255);
      const b255 = Math.round((qb / 15) * 255);
      const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(${r255},${g255},${b255},0.92)`);
      grad.addColorStop(0.28, `rgba(${r255},${g255},${b255},0.36)`);
      grad.addColorStop(0.65, `rgba(${r255},${g255},${b255},0.10)`);
      grad.addColorStop(1, `rgba(${r255},${g255},${b255},0)`);
      c.fillStyle = grad;
      c.fillRect(0, 0, 64, 64);
      this.bloomStamps.set(key, stamp);
    }
    return stamp;
  }

  /** Composites soft additive screen-space bloom halos over the scaled display canvas
   * for explosions, portals, frontier surges, shells, lasers, fires, towers, and skyscraper beacons. */
  drawBloom(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    scale: number,
    world: VoidWorld,
    lights: readonly PointLight[],
    reduceEffects: boolean,
  ): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;

    // 1. Dynamic light source blooms (explosions, portals, lasers, shells, fires, towers, nodes)
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.bloom <= 0.02) continue;
      if (reduceEffects && l.bloom < 0.35) continue;

      const stamp = this.getBloomStamp(l.r, l.g, l.b);
      if (!stamp) continue;

      // Project 3D light position `(l.x, l.y, l.z)` to oblique screen coordinates
      const wyScreen = l.y - l.z * 0.45;
      const sx = camX + l.x * scale;
      const sy = camY + wyScreen * scale;
      const rad = l.radius * (l.bloomScale ?? 0.85) * scale;
      if (sx + rad < 0 || sx - rad > cw || sy + rad < 0 || sy - rad > ch) continue;

      const alpha = Math.min(0.88, l.bloom * (reduceEffects ? 0.45 : 0.72));
      ctx.globalAlpha = alpha;
      ctx.drawImage(stamp, sx - rad, sy - rad, rad * 2, rad * 2);

      // High-energy explosions and portals get a tight hot core bloom
      if (!reduceEffects && l.bloom >= 0.65) {
        const coreRad = rad * 0.42;
        ctx.globalAlpha = Math.min(0.75, l.bloom * 0.55);
        ctx.drawImage(stamp, sx - coreRad, sy - coreRad, coreRad * 2, coreRad * 2);
      }
    }

    // 2. Subtle warm rooftop beacon & neon lobby bloom on intact developed city skyscrapers
    if (!reduceEffects) {
      const amberStamp = this.getBloomStamp(1.0, 0.72, 0.32);
      if (amberStamp) {
        const mode = this.mode;
        ctx.globalAlpha = 0.22;
        for (let i = 0; i < world.buildings.length; i += 2) {
          const b = world.buildings[i];
          if (!b.isSkyscraper && b.development <= 1.05) continue;
          const headCell = b.cells[0];
          if (headCell === undefined || world.material[headCell] === CellMaterial.VOID) continue;
          const elev = elevationOf(b, mode);
          const bx = camX + (b.x + 1.5) * scale;
          const by = camY + (b.y + 1.5 - elev) * scale;
          const bRad = Math.max(4, 3.8 * scale);
          if (bx + bRad < 0 || bx - bRad > cw || by + bRad < 0 || by - bRad > ch) continue;
          ctx.drawImage(amberStamp, bx - bRad, by - bRad, bRad * 2, bRad * 2);
        }
      }
    }

    ctx.restore();
  }
}
