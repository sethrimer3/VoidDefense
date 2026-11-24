import { CHUNK_SIZE } from "./config.ts";
import { MAX_ELEVATION_PX, packElevAbgr, type BuildingSpriteCache } from "./elevation.ts";
import { hash } from "./grid.ts";
import {
  puddleWetnessFor,
  type LightingEngine,
  type LightingQualityMode,
  type PointLight,
  type TimeOfDayPreset,
} from "./lighting.ts";
import { CellMaterial, LandCover, SurfaceMaterial } from "./model.ts";
import type { VoidWorld } from "./world.ts";

type RGB = readonly [number, number, number];
type Bounds = { x0: number; y0: number; x1: number; y1: number };
type Atlas = Pick<BuildingSpriteCache, "atlasElev" | "atlasBldId" | "atlasNx" | "atlasNy" | "atlasNz">;
export type ReflectiveMaterial =
  | typeof SurfaceMaterial.WATER
  | typeof SurfaceMaterial.GLASS
  | typeof SurfaceMaterial.WET_PUDDLE
  | typeof SurfaceMaterial.WET_SHEEN;

export const REFLECTION_MATERIALS = {
  [SurfaceMaterial.WATER]: { reflectivity: 0.74, fresnel: 0.75, roughness: 0, tint: [0.66, 0.85, 0.98], ripple: 1 },
  [SurfaceMaterial.GLASS]: { reflectivity: 0.32, fresnel: 0.85, roughness: 0.15, tint: [0.91, 0.96, 1.03], ripple: 0 },
  [SurfaceMaterial.WET_PUDDLE]: { reflectivity: 0.36, fresnel: 0.65, roughness: 0.12, tint: [0.68, 0.86, 1.08], ripple: 1 },
  [SurfaceMaterial.WET_SHEEN]: { reflectivity: 0.14, fresnel: 0.52, roughness: 0.58, tint: [0.62, 0.82, 1.06], ripple: 0 },
} as const;

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const RED = LITTLE_ENDIAN ? 0 : 24;
const GREEN = LITTLE_ENDIAN ? 8 : 16;
const BLUE = LITTLE_ENDIAN ? 16 : 8;
const GLASS_REACH = 12;

export function reflectionColor(rgb: RGB): number {
  return packElevAbgr(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]));
}

/** Deterministic raindrop ripple ring perturbation (`dx, dy` in `-2..2` whole pixels) for puddle reflections. */
export function computePuddleRippleOffset(
  seed: number,
  x: number,
  y: number,
  time: number,
): [number, number] {
  const tx = x >> 3;
  const ty = y >> 3;
  const period = 0.85;
  const slot = Math.floor(time / period);
  const h = hash(seed, 941, tx, ty, slot);
  const cx = (tx << 3) + (h & 7);
  const cy = (ty << 3) + ((h >>> 3) & 7);
  const phaseOffset = ((h >>> 6) & 15) / 16;
  const age = (time / period - slot + phaseOffset) % 1;
  const r = age * 4.5;
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 < 0.06 || d2 > 32) return [0, 0];
  const dist = Math.sqrt(d2);
  if (Math.abs(dist - r) > 0.95) return [0, 0];
  const amp = age < 0.35 ? 2 : 1;
  const sign = dist >= r ? 1 : -1;
  const ox = Math.max(-2, Math.min(2, Math.round((dx / dist) * amp * sign)));
  const oy = Math.max(-2, Math.min(2, Math.round((dy / dist) * amp * sign)));
  return [ox, oy];
}

/** The orthographic ray crosses one Y boundary per elevation step. A real pixel at
 * groundY - z appears at groundY + z in the mirror. Tree canopies use terrain colors. */
export function sampleWaterMirror(
  x: number, y: number, width: number, atlas: Pick<Atlas, "atlasElev" | "atlasBldId">,
  foliage?: Pick<VoidWorld, "material" | "landCover">,
): number {
  const limit = Math.min(MAX_ELEVATION_PX, y >> 1);
  for (let z = 1; z <= limit; z++) {
    const source = (y - z * 2) * width + x;
    if (atlas.atlasBldId[source] >= 0 && atlas.atlasElev[source] === z) return source;
    const ground = (y - z) * width + x;
    if (foliage?.material[ground] === CellMaterial.PARK &&
        ((z === 3 && foliage.landCover[ground] === LandCover.FOREST) ||
         (z === 2 && foliage.landCover[ground] === LandCover.ORCHARD))) return -2 - ground;
  }
  return -1;
}

/** Grid-boundary DDA in the reflected view direction. Samples the visible face
 * of a neighboring column only if that column is tall enough to intercept the ray. */
export function sampleGlassMirror(
  index: number, width: number, height: number, atlas: Atlas, columnHeight: Uint8Array, buildingAt: Int16Array,
): number {
  const z0 = atlas.atlasElev[index];
  const owner = atlas.atlasBldId[index];
  const nx = atlas.atlasNx[index] / 127;
  const ny = atlas.atlasNy[index] / 127;
  const nz = atlas.atlasNz[index] / 127;
  const twiceDot = 2 * (ny + nz);
  const dx = twiceDot * nx;
  const dy = twiceDot * ny - 1;
  const dz = twiceDot * nz - 1;
  let x = index % width;
  let y = Math.min(height - 1, ((index / width) | 0) + z0);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let nextX = deltaX / 2;
  let nextY = deltaY / 2;

  for (let n = 0; n < GLASS_REACH; n++) {
    const t = Math.min(nextX, nextY);
    if (!Number.isFinite(t)) break;
    if (nextX === t) { x += stepX; nextX += deltaX; }
    if (nextY === t) { y += stepY; nextY += deltaY; }
    const z = Math.max(z0, Math.ceil(z0 + t * dz));
    if (x < 0 || x >= width || y < 0 || y >= height || z > MAX_ELEVATION_PX) break;
    const ground = y * width + x;
    const b = buildingAt[ground];
    if (b < 0 || b === owner || columnHeight[ground] <= z) continue;
    for (let face = z; face <= columnHeight[ground] && face <= y; face++) {
      const source = (y - face) * width + x;
      if (atlas.atlasBldId[source] === b) return source;
    }
  }
  return -1;
}

function channel(color: number, shift: number): number {
  return (color >>> shift) & 255;
}

/** Quantizes a reflected/streak channel delta to whole-pixel palette steps so reflections preserve the crisp pixel-art look. */
function quantizeDelta(delta: number, step = 4): number {
  return Math.round(delta / step) * step;
}

/** Tint the reflected radiance and apply Schlick's grazing-angle term. */
export function shadeReflection(
  material: ReflectiveMaterial, base: number, reflected: number, facing: number, glint = 0, streak = 0,
  wetScale = 1,
): number {
  const settings = REFLECTION_MATERIALS[material];
  const edge = 1 - Math.min(1, Math.max(0, facing));
  const rawStrength = (settings.reflectivity + (1 - settings.reflectivity) * settings.fresnel * edge ** 5) * wetScale;
  const strength = Math.max(0, Math.min(1, rawStrength));
  const softness = 1 - settings.roughness * 0.35;
  const isWetGround = material === SurfaceMaterial.WET_PUDDLE || material === SurfaceMaterial.WET_SHEEN;
  const blend = (shift: number, tint: number) => {
    const baseC = channel(base, shift);
    if (isWetGround) {
      const refDelta = quantizeDelta((channel(reflected, shift) * tint * softness - baseC) * strength, 4);
      const streakAdd = quantizeDelta((channel(glint, shift) + channel(streak, shift)) * wetScale, 4);
      return Math.max(0, Math.min(255, baseC + refDelta + streakAdd));
    }
    return Math.min(255, Math.round(
      baseC * (1 - strength) + channel(reflected, shift) * tint * strength * softness +
      channel(glint, shift) + channel(streak, shift),
    ));
  };
  return packElevAbgr(blend(RED, settings.tint[0]), blend(GREEN, settings.tint[1]), blend(BLUE, settings.tint[2]));
}

type Samples = {
  cells: number[];
  hits: number[];
  facing: number[];
  previousBase: Uint32Array;
  previousRay: Uint32Array;
  previousStreak: Uint32Array;
  glints: Uint32Array;
};

type WetSamples = {
  cells: number[];
  hits: number[];
  depths: Uint8Array;
  isPuddle: Uint8Array;
  facing: number[];
  sources: number[];
  hasMirrorHits: boolean;
  previousBase: Uint32Array;
  previousRay: Uint32Array;
  previousStreak: Uint32Array;
  glints: Uint32Array;
};

type Tile = {
  water: Samples;
  glass: Samples;
  wet?: WetSamples;
  glassSources: number[];
  geometry: LightingQualityMode;
  wetGeometry?: LightingQualityMode;
  sky?: string;
  wetSky?: string;
  waterRevision?: number;
  glassRevision?: number;
  wetRevision?: number;
  wetRipplePhase?: number;
  hadStreak?: boolean;
  hadWetStreak?: boolean;
};

function samples(cells: number[], hits: number[], facing: number[]): Samples {
  return {
    cells, hits, facing, previousBase: new Uint32Array(cells.length),
    previousRay: new Uint32Array(cells.length), previousStreak: new Uint32Array(cells.length),
    glints: new Uint32Array(cells.length),
  };
}

function wetSamples(
  cells: number[],
  hits: number[],
  depths: Uint8Array,
  isPuddle: Uint8Array,
  facing: number[],
  sources: number[],
  hasMirrorHits: boolean,
): WetSamples {
  return {
    cells,
    hits,
    depths,
    isPuddle,
    facing,
    sources,
    hasMirrorHits,
    previousBase: new Uint32Array(cells.length),
    previousRay: new Uint32Array(cells.length),
    previousStreak: new Uint32Array(cells.length),
    glints: new Uint32Array(cells.length),
  };
}

class ReflectionLayer {
  private readonly canvas =
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("canvas")
      : null;
  private readonly ctx = this.canvas ? this.canvas.getContext("2d") : null;
  private image?: ImageData;
  pixels = new Uint32Array(0);

  resize(w: number, h: number): void {
    if (this.canvas && this.ctx) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.image = this.ctx.createImageData(w, h);
      this.pixels = new Uint32Array(this.image.data.buffer);
    } else {
      this.pixels = new Uint32Array(w * h);
    }
  }

  upload(bounds: Bounds): void {
    if (bounds.x1 > bounds.x0 && bounds.y1 > bounds.y0 && this.image && this.ctx) {
      this.ctx.putImageData(this.image, 0, 0, bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    }
  }

  draw(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
    if (!this.canvas) return;
    const w = bounds.x1 - bounds.x0;
    const h = bounds.y1 - bounds.y0;
    if (w > 0 && h > 0) ctx.drawImage(this.canvas, bounds.x0, bounds.y0, w, h, bounds.x0, bounds.y0, w, h);
  }
}

function expand(bounds: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  bounds.x0 = Math.min(bounds.x0, x0);
  bounds.y0 = Math.min(bounds.y0, y0);
  bounds.x1 = Math.max(bounds.x1, x1);
  bounds.y1 = Math.max(bounds.y1, y1);
}

const MATERIALS = [SurfaceMaterial.WATER, SurfaceMaterial.GLASS] as const;
const HALF_TILE = CHUNK_SIZE / 2;

export class SurfaceReflections {
  readonly water = new ReflectionLayer();
  readonly glass = new ReflectionLayer();
  readonly actorPixels = new Map<number, { lit: number; height: number }>();
  private readonly actorTiles = new Uint8Array(0);
  private readonly streaks = new Map<number, number>();
  private readonly halfWaterHits = new Int32Array(HALF_TILE ** 2);
  private readonly halfGlassHits = new Int32Array(HALF_TILE ** 2);
  private readonly halfGlassOwners = new Int16Array(HALF_TILE ** 2);
  private world?: VoidWorld;
  private dirty = new Uint8Array(0);
  private streakTiles = new Uint8Array(0);
  private actorTileFlags = new Uint8Array(0);
  private tiles: (Tile | undefined)[] = [];
  private bounds: Bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private waterBounds?: Bounds;
  private glassBounds?: Bounds;
  private wasWet = false;

  begin(world: VoidWorld, dirtyChunks: Uint8Array, view: Bounds): void {
    const { w, h, chunksW, chunksH, chunkCount } = world.grid;
    if (this.world !== world) {
      this.world = world;
      this.water.resize(w, h);
      this.glass.resize(w, h);
      this.tiles = new Array(chunkCount);
      this.dirty = new Uint8Array(chunkCount).fill(1);
      this.streakTiles = new Uint8Array(chunkCount);
      this.actorTileFlags = new Uint8Array(chunkCount);
      this.wasWet = false;
    }
    // A roof can project 15 pixels north and reflect 15 south. Glass rays reach 12 sideways.
    for (let i = 0; i < dirtyChunks.length; i++) {
      if (!dirtyChunks[i]) continue;
      const x = i % chunksW;
      const y = (i / chunksW) | 0;
      const left = Math.max(0, x - 1);
      const right = Math.min(chunksW, x + 2);
      for (let row = Math.max(0, y - 2); row <= Math.min(chunksH - 1, y + 2); row++) {
        this.dirty.fill(1, row * chunksW + left, row * chunksW + right);
      }
    }
    this.bounds = {
      x0: Math.max(0, Math.floor(view.x0) - 2), y0: Math.max(0, Math.floor(view.y0) - 2),
      x1: Math.min(w, Math.ceil(view.x1) + 2), y1: Math.min(h, Math.ceil(view.y1) + 2),
    };
    this.actorPixels.clear();
    this.streaks.clear();
    this.streakTiles.fill(0);
    this.actorTileFlags.fill(0);
  }

  stampActor(
    surface: Uint8Array,
    x: number,
    y: number,
    width: number,
    height: number,
    color: () => number,
    wetActive = false,
  ): void {
    const { w, chunksW } = this.world!.grid;
    const projectedY = y + height;
    if (projectedY < this.bounds.y0 || projectedY >= this.bounds.y1) return;
    let stamp: { lit: number; height: number } | undefined;
    for (let px = Math.max(x, this.bounds.x0); px < Math.min(x + width, this.bounds.x1); px++) {
      const idx = projectedY * w + px;
      const s = surface[idx];
      const matches = s === SurfaceMaterial.WATER ||
        (wetActive && (s === SurfaceMaterial.WET_PUDDLE || s === SurfaceMaterial.WET_SHEEN));
      if (!matches || (this.actorPixels.get(idx)?.height ?? Infinity) <= height) continue;
      stamp ??= { lit: color(), height };
      this.actorPixels.set(idx, stamp);
      this.actorTileFlags[((projectedY / CHUNK_SIZE) | 0) * chunksW + ((px / CHUNK_SIZE) | 0)] = 1;
    }
  }

  private stampLights(surface: Uint8Array, lights: readonly PointLight[], phase: number, wetness: number): void {
    const { w, chunksW } = this.world!.grid;
    const { x0, x1, y0, y1 } = this.bounds;
    const wetActive = wetness > 0.001;
    const puddleWet = wetActive ? puddleWetnessFor(wetness) : 0;
    for (const light of lights) {
      const lightX = Math.round(light.x);
      if (lightX + light.radius < x0 || lightX - light.radius >= x1 ||
          light.y + light.radius < y0 || light.y - light.radius >= y1) continue;
      const cy = Math.round(light.y + light.z * 0.65);
      const length = Math.max(4, Math.round(light.radius * 0.9));
      const halfWidth = Math.max(1, Math.min(5, Math.round(light.radius * 0.15)));
      // A fixture on the bank still has a reflection. Find the nearest wet column
      // within its influence at the center and along the projected streak.
      let cx = lightX;
      let best = Infinity;
      for (const dy of [0, -4, 4, 8]) {
        if (cy + dy < y0 || cy + dy >= y1) continue;
        for (let x = Math.max(x0, lightX - length); x <= Math.min(x1 - 1, lightX + length); x++) {
          const s = surface[(cy + dy) * w + x];
          if (s !== SurfaceMaterial.WATER && (!wetActive || (s !== SurfaceMaterial.WET_PUDDLE && s !== SurfaceMaterial.WET_SHEEN))) continue;
          const distance = Math.abs(x - lightX) + Math.abs(dy) * 0.5;
          if (distance < best) { best = distance; cx = x; }
        }
      }
      const bankFalloff = Math.max(0.24, 1 - Math.abs(cx - lightX) / light.radius);
      const streakLen = wetActive ? Math.max(length, Math.round(light.radius * 1.35)) : length;
      for (let y = Math.max(y0, cy - (length >> 1)); y < Math.min(y1, cy + streakLen); y++) {
        const wave = phase > 0 ? ((y + phase + cx) >> 2) % 3 - 1 : 0;
        const falloff = Math.max(0, 1 - Math.abs(y - cy) / streakLen);
        for (let x = Math.max(x0, cx + wave - halfWidth); x <= Math.min(x1 - 1, cx + wave + halfWidth); x++) {
          const idx = y * w + x;
          const s = surface[idx];
          if (s === SurfaceMaterial.WATER) {
            if (y >= cy + length) continue;
            const wFalloff = Math.max(0, 1 - Math.abs(y - cy) / length);
            const energy = wFalloff * wFalloff * (1 - Math.abs(x - cx - wave) / (halfWidth + 1)) * 113 * bankFalloff;
            if (energy < 3) continue;
            this.streakTiles[((y / CHUNK_SIZE) | 0) * chunksW + ((x / CHUNK_SIZE) | 0)] = 1;
            const old = this.streaks.get(idx) ?? 0;
            this.streaks.set(idx, packElevAbgr(
              Math.min(255, channel(old, RED) + Math.round(light.r * energy)),
              Math.min(255, channel(old, GREEN) + Math.round(light.g * energy)),
              Math.min(255, channel(old, BLUE) + Math.round(light.b * energy)),
            ));
          } else if (wetActive && (s === SurfaceMaterial.WET_PUDDLE || s === SurfaceMaterial.WET_SHEEN)) {
            // Wet ground streaks stretch south below the light source in screen space
            if (y < cy - 2) continue;
            const isPuddle = s === SurfaceMaterial.WET_PUDDLE;
            const localWet = isPuddle ? puddleWet : wetness;
            if (localWet <= 0.01) continue;
            const shimmer = isPuddle ? wave : (phase > 0 && ((x + y + phase) & 3) === 0 ? 1 : 0);
            const xDist = Math.abs(x - cx - shimmer);
            if (xDist > halfWidth) continue;
            const rawEnergy = Math.pow(falloff, 1.55) * (1 - xDist / (halfWidth + 1)) * (isPuddle ? 128 : 92) * bankFalloff * localWet;
            const energy = Math.round(rawEnergy / 6) * 6;
            if (energy < 4) continue;
            this.streakTiles[((y / CHUNK_SIZE) | 0) * chunksW + ((x / CHUNK_SIZE) | 0)] = 1;
            const old = this.streaks.get(idx) ?? 0;
            this.streaks.set(idx, packElevAbgr(
              Math.min(255, channel(old, RED) + Math.round(light.r * energy)),
              Math.min(255, channel(old, GREEN) + Math.round(light.g * energy)),
              Math.min(255, channel(old, BLUE) + Math.round(light.b * energy)),
            ));
          }
        }
      }
    }
  }

  private clearWetPixels(waterPut: Bounds): void {
    const world = this.world;
    if (!world) return;
    const { w, h } = world.grid;
    const localWater = this.water.pixels;
    for (let idx = 0; idx < this.tiles.length; idx++) {
      const tile = this.tiles[idx];
      if (!tile?.wet || tile.wet.cells.length === 0) continue;
      let cleared = false;
      for (const cell of tile.wet.cells) {
        if (localWater[cell] !== 0) {
          localWater[cell] = 0;
          cleared = true;
        }
      }
      tile.wet.previousBase.fill(0);
      tile.wet.previousRay.fill(0);
      tile.wet.previousStreak.fill(0);
      tile.wetSky = undefined;
      tile.wetRevision = undefined;
      tile.wetRipplePhase = undefined;
      tile.hadWetStreak = false;
      if (cleared) {
        const tx = idx % world.grid.chunksW;
        const ty = (idx / world.grid.chunksW) | 0;
        const ix = tx * CHUNK_SIZE;
        const iy = ty * CHUNK_SIZE;
        expand(waterPut, ix, iy, Math.min(w, ix + CHUNK_SIZE), Math.min(h, iy + CHUNK_SIZE));
      }
    }
  }

  paint(
    atlas: BuildingSpriteCache, lighting: LightingEngine, baseTerrain: Uint32Array,
    lights: readonly PointLight[], preset: TimeOfDayPreset, quality: LightingQualityMode, time: number,
    wetness = 0,
  ): void {
    const world = this.world!;
    const { w, h, chunksW } = world.grid;
    const { x0, y0, x1, y1 } = this.bounds;
    this.waterBounds = this.glassBounds = undefined;
    if (x1 <= x0 || y1 <= y0) return;
    const { terrainSurface, terrainLightU32, buildingLightU32 } = lighting;
    const phase = Math.floor(time * 6);
    const ripplePhase = Math.floor(time * 8);
    const wetActive = wetness > 0.001;
    const qWet = wetActive ? Math.max(1 / 32, Math.round(Math.min(1, wetness) * 32) / 32) : 0;
    const qPuddleWet = wetActive ? Math.max(1 / 32, Math.round(puddleWetnessFor(qWet) * 32) / 32) : 0;
    this.stampLights(terrainSurface, lights, phase, qWet);
    const sky = reflectionColor(preset.skyColor);
    const skyKey = [preset.id, ...preset.skyColor, ...preset.sunDir, ...preset.sunColor, preset.sunIntensity].join(",");
    const wetSkyKey = wetActive ? `${skyKey},${qWet}` : skyKey;
    const [sx, sy, sz] = preset.sunDir;
    const sunViewNorm = 127 * Math.hypot(sx, sy + Math.SQRT1_2, sz + Math.SQRT1_2);
    const medium = quality === "medium";
    const waterPut = { x0: w, y0: h, x1: 0, y1: 0 };
    const glassPut = { x0: w, y0: h, x1: 0, y1: 0 };
    const waterDraw = { x0: w, y0: h, x1: 0, y1: 0 };
    const glassDraw = { x0: w, y0: h, x1: 0, y1: 0 };
    const { atlasBldId, atlasColorU32, atlasElev, atlasSurface } = atlas;
    const localWater = this.water.pixels;
    const localGlass = this.glass.pixels;

    if (!wetActive && this.wasWet) {
      this.clearWetPixels(waterPut);
      this.wasWet = false;
    } else if (wetActive) {
      this.wasWet = true;
    }

    for (let ty = (y0 / CHUNK_SIZE) | 0; ty * CHUNK_SIZE < y1; ty++) {
      for (let tx = (x0 / CHUNK_SIZE) | 0; tx * CHUNK_SIZE < x1; tx++) {
        const ix = tx * CHUNK_SIZE;
        const iy = ty * CHUNK_SIZE;
        const ex = Math.min(w, ix + CHUNK_SIZE);
        const ey = Math.min(h, iy + CHUNK_SIZE);
        const tileIndex = ty * chunksW + tx;
        let tile = this.tiles[tileIndex];
        if (!tile || this.dirty[tileIndex] || tile.geometry !== quality) {
          const oldTile = tile;
          const water: number[] = [], waterHits: number[] = [], waterFacing: number[] = [];
          const glass: number[] = [], glassHits: number[] = [], glassFacing: number[] = [];
          if (medium) {
            this.halfWaterHits.fill(-2);
            this.halfGlassOwners.fill(-1);
          }
          for (let y = iy; y < ey; y++) {
            for (let x = ix; x < ex; x++) {
              const i = y * w + x;
              if (terrainSurface[i] === SurfaceMaterial.WATER) {
                water.push(i);
                let hit = -1;
                if (medium) {
                  const block = ((y - iy) >> 1) * HALF_TILE + ((x - ix) >> 1);
                  if (this.halfWaterHits[block] === -2) this.halfWaterHits[block] = sampleWaterMirror(x, y, w, atlas);
                  hit = this.halfWaterHits[block];
                } else if (quality === "high") {
                  hit = sampleWaterMirror(x, y, w, atlas, world);
                }
                waterHits.push(hit);
                waterFacing.push(0.707);
              }
              if (atlasSurface[i] === SurfaceMaterial.GLASS) {
                glass.push(i);
                let hit = -1;
                if (medium) {
                  const block = ((y - iy) >> 1) * HALF_TILE + ((x - ix) >> 1);
                  if (this.halfGlassOwners[block] !== atlasBldId[i]) {
                    this.halfGlassOwners[block] = atlasBldId[i];
                    this.halfGlassHits[block] = sampleGlassMirror(i, w, h, atlas, lighting.groundElev, world.buildingAt);
                  }
                  hit = this.halfGlassHits[block];
                } else if (quality === "high") {
                  hit = sampleGlassMirror(i, w, h, atlas, lighting.groundElev, world.buildingAt);
                }
                glassHits.push(hit);
                glassFacing.push(Math.max(0, (atlas.atlasNy[i] + atlas.atlasNz[i]) / (127 * Math.SQRT2)));
              }
            }
          }
          if (oldTile?.water.cells.length) {
            for (const idx of oldTile.water.cells) localWater[idx] = 0;
            expand(waterPut, ix, iy, ex, ey);
          }
          if (oldTile?.wet?.cells.length) {
            for (const idx of oldTile.wet.cells) localWater[idx] = 0;
            expand(waterPut, ix, iy, ex, ey);
          }
          if (oldTile?.glass.cells.length) {
            for (const idx of oldTile.glass.cells) localGlass[idx] = 0;
            expand(glassPut, ix, iy, ex, ey);
          }
          const glassSources = new Set<number>();
          for (const hit of glassHits) {
            if (hit < 0) continue;
            const x = hit % w;
            const y = (hit / w) | 0;
            glassSources.add(((y / CHUNK_SIZE) | 0) * chunksW + ((x / CHUNK_SIZE) | 0));
          }
          tile = {
            water: samples(water, waterHits, waterFacing),
            glass: samples(glass, glassHits, glassFacing),
            glassSources: [...glassSources],
            geometry: quality,
          };
          this.tiles[tileIndex] = tile;
          this.dirty[tileIndex] = 0;
        }

        const skyChanged = tile.sky !== skyKey;
        tile.sky = skyKey;
        const localRevision = lighting.surfaceTileRevision[tileIndex];
        for (const material of MATERIALS) {
          const water = material === SurfaceMaterial.WATER;
          const sample = water ? tile.water : tile.glass;
          if (sample.cells.length === 0) continue;
          expand(water ? waterDraw : glassDraw, ix, iy, ex, ey);
          if (water && quality === "low") {
            const streak = this.streakTiles[tileIndex] !== 0;
            const remainsClean = !skyChanged && !streak && !tile.hadStreak && tile.waterRevision === localRevision;
            tile.hadStreak = streak;
            tile.waterRevision = localRevision;
            if (remainsClean) continue;
          } else if (!water) {
            let revision = localRevision;
            for (const source of tile.glassSources) revision = Math.max(revision, lighting.surfaceTileRevision[source]);
            const remainsClean = !skyChanged && tile.glassRevision === revision;
            tile.glassRevision = revision;
            if (remainsClean) continue;
          }
          let changed = false;
          for (let k = 0; k < sample.cells.length; k++) {
            const i = sample.cells[k];
            let hit = sample.hits[k];
            if (water && quality === "high" && phase > 0 && hit >= 0) {
              const offset = (((i / w | 0) + phase) >> 2) % 3 - 1;
              const shifted = hit + offset * REFLECTION_MATERIALS[material].ripple;
              if ((shifted / w | 0) === (hit / w | 0) && atlasBldId[shifted] === atlasBldId[hit] &&
                  atlasElev[shifted] === atlasElev[hit]) hit = shifted;
            }
            let ray = hit >= 0 ? buildingLightU32[hit] || atlasColorU32[hit]
              : hit === -1 ? sky : terrainLightU32[-2 - hit] || baseTerrain[-2 - hit];
            if (water && this.actorPixels.size) {
              const actor = this.actorPixels.get(i);
              const mirrorDepth = hit >= 0 ? atlasElev[hit] : hit === -1 ? Infinity
                : ((i / w) | 0) - (((-2 - hit) / w) | 0);
              if (actor && actor.height <= mirrorDepth) ray = actor.lit;
            }
            const base = water ? terrainLightU32[i] || baseTerrain[i] : buildingLightU32[i] || atlasColorU32[i];
            const streak = water && this.streaks.size ? this.streaks.get(i) ?? 0 : 0;
            if (!skyChanged && sample.previousBase[k] === base && sample.previousRay[k] === ray &&
                sample.previousStreak[k] === streak) continue;
            sample.previousBase[k] = base;
            sample.previousRay[k] = ray;
            sample.previousStreak[k] = streak;
            if (skyChanged) {
              const alignment = water
                ? (-sy + sz) * Math.SQRT1_2 + ((((i % w) * 13 + (i / w | 0) * 7) & 15) - 8) * 0.021
                : (atlas.atlasNx[i] * sx + atlas.atlasNy[i] * (sy + Math.SQRT1_2) +
                  atlas.atlasNz[i] * (sz + Math.SQRT1_2)) / sunViewNorm;
              const power = Math.min(1, Math.max(0, alignment)) ** (water ? 10 : 24 - REFLECTION_MATERIALS[material].roughness * 14) * preset.sunIntensity * (water ? 45 : 94);
              const sun = preset.sunColor;
              sample.glints[k] = packElevAbgr(Math.round(power * sun[0]), Math.round(power * sun[1]), Math.round(power * sun[2]));
            }
            (water ? localWater : localGlass)[i] = shadeReflection(material, base, ray, sample.facing[k], sample.glints[k], streak);
            changed = true;
          }
          if (changed) expand(water ? waterPut : glassPut, ix, iy, ex, ey);
        }

        // Wet ground reflection pass (skipped completely when dry: wetness === 0)
        if (!wetActive) continue;

        if (!tile.wet || tile.wetGeometry !== quality) {
          const wetCells: number[] = [];
          const wetHits: number[] = [];
          const wetDepths: number[] = [];
          const wetPuddle: number[] = [];
          const wetFacing: number[] = [];
          const wetSources = new Set<number>();
          let hasMirrorHits = false;
          this.halfWaterHits.fill(-2);
          for (let y = iy; y < ey; y++) {
            for (let x = ix; x < ex; x++) {
              const i = y * w + x;
              const s = terrainSurface[i];
              if (s !== SurfaceMaterial.WET_PUDDLE && s !== SurfaceMaterial.WET_SHEEN) continue;
              if (atlasBldId[i] >= 0) continue; // occluded by projected building sprite
              const isPuddle = s === SurfaceMaterial.WET_PUDDLE;
              wetCells.push(i);
              wetPuddle.push(isPuddle ? 1 : 0);
              let hit = -1;
              if (quality === "medium") {
                // Medium tier: light streaks + puddle reflections (2x2 half-res ray sharing)
                if (isPuddle) {
                  const block = ((y - iy) >> 1) * HALF_TILE + ((x - ix) >> 1);
                  if (this.halfWaterHits[block] === -2) this.halfWaterHits[block] = sampleWaterMirror(x, y, w, atlas);
                  hit = this.halfWaterHits[block];
                }
              } else if (quality === "high") {
                // High tier: puddles at 1:1 with foliage, wet sheen at half-res (2x2) for gentle blur & fast performance
                if (isPuddle) {
                  hit = sampleWaterMirror(x, y, w, atlas, world);
                } else {
                  const block = ((y - iy) >> 1) * HALF_TILE + ((x - ix) >> 1);
                  if (this.halfWaterHits[block] === -2) this.halfWaterHits[block] = sampleWaterMirror(x, y, w, atlas);
                  hit = this.halfWaterHits[block];
                }
              }
              wetHits.push(hit);
              if (hit !== -1) {
                hasMirrorHits = true;
                const sxHit = hit >= 0 ? hit % w : (-2 - hit) % w;
                const syHit = hit >= 0 ? (hit / w) | 0 : ((-2 - hit) / w) | 0;
                wetSources.add(((syHit / CHUNK_SIZE) | 0) * chunksW + ((sxHit / CHUNK_SIZE) | 0));
              }
              const depth = hit >= 0 ? atlasElev[hit] : hit === -1 ? 0 : y - (((-2 - hit) / w) | 0);
              wetDepths.push(depth);
              const dirt = world.material[i] === CellMaterial.STREET && world.streetTier[i] === 8;
              wetFacing.push(dirt ? 0.92 : isPuddle ? 0.65 : 0.78);
            }
          }
          tile.wet = wetSamples(
            wetCells,
            wetHits,
            Uint8Array.from(wetDepths),
            Uint8Array.from(wetPuddle),
            wetFacing,
            [...wetSources],
            hasMirrorHits,
          );
          tile.wetGeometry = quality;
        }

        const wetSample = tile.wet;
        if (wetSample.cells.length === 0) continue;
        expand(waterDraw, ix, iy, ex, ey);
        const wetSkyChanged = tile.wetSky !== wetSkyKey;
        tile.wetSky = wetSkyKey;
        const { halo, haloW } = lighting.getHaloBuffer();
        const haloStreakScale = preset.neonIntensity > 0.25 && haloW > 0 ? preset.neonIntensity * 0.48 : 0;
        const hasWetStreak = this.streakTiles[tileIndex] !== 0 || this.actorTileFlags[tileIndex] !== 0;
        let wetSourceRevision = localRevision;
        for (const source of wetSample.sources) wetSourceRevision = Math.max(wetSourceRevision, lighting.surfaceTileRevision[source]);
        const rippleTickChanged = quality === "high" && wetSample.hasMirrorHits && tile.wetRipplePhase !== ripplePhase;
        tile.wetRipplePhase = ripplePhase;
        const wetRemainsClean =
          !wetSkyChanged &&
          !hasWetStreak &&
          !tile.hadWetStreak &&
          !rippleTickChanged &&
          tile.wetRevision === wetSourceRevision;
        tile.hadWetStreak = hasWetStreak;
        tile.wetRevision = wetSourceRevision;
        if (wetRemainsClean) continue;

        let wetChanged = false;
        for (let k = 0; k < wetSample.cells.length; k++) {
          const i = wetSample.cells[k];
          const isPuddle = wetSample.isPuddle[k] === 1;
          const mat: ReflectiveMaterial = isPuddle ? SurfaceMaterial.WET_PUDDLE : SurfaceMaterial.WET_SHEEN;
          const localWet = isPuddle ? qPuddleWet : qWet;
          let hit = quality === "low" ? -1 : wetSample.hits[k];
          const x = i % w;
          const y = (i / w) | 0;

          if (quality === "high" && time > 0 && hit >= 0) {
            if (isPuddle) {
              const [rx, ry] = computePuddleRippleOffset(world.seed, x, y, time);
              if (rx !== 0 || ry !== 0) {
                const hx = Math.max(0, Math.min(w - 1, (hit % w) + rx));
                const hy = Math.max(0, Math.min(h - 1, ((hit / w) | 0) + ry));
                const shifted = hy * w + hx;
                if (atlasBldId[shifted] >= 0) hit = shifted;
              }
            } else {
              // Slight horizontal blur / faint shimmer outside puddles
              const shimmer = (((x * 5 + y * 9 + phase) >> 2) % 3) - 1;
              const shifted = hit + shimmer;
              if ((shifted / w | 0) === (hit / w | 0) && atlasBldId[shifted] >= 0) hit = shifted;
            }
          } else if (hit >= 0 && !isPuddle) {
            // Slight 1-px neighbor blur on wet sheen
            const blurShift = ((x + y) & 1) === 0 ? 1 : -1;
            const shifted = hit + blurShift;
            if ((shifted / w | 0) === (hit / w | 0) && atlasBldId[shifted] >= 0) hit = shifted;
          }

          let ray = hit >= 0 ? buildingLightU32[hit] || atlasColorU32[hit]
            : hit === -1 ? sky : terrainLightU32[-2 - hit] || baseTerrain[-2 - hit];
          let mirrorDepth = wetSample.depths[k];
          if (quality === "high" && this.actorPixels.size) {
            const actor = this.actorPixels.get(i);
            const curDepth = hit >= 0 ? mirrorDepth : Infinity;
            if (actor && actor.height <= curDepth) {
              ray = actor.lit;
              mirrorDepth = actor.height;
            }
          }

          // Distance fade from the reflected object so nearby buildings/units reflect strongest
          const distFade = hit === -1 && mirrorDepth === 0
            ? 1
            : Math.max(0.22, 1 - mirrorDepth / (MAX_ELEVATION_PX + 3));
          const base = terrainLightU32[i] || baseTerrain[i];
          let streak = this.streaks.size ? this.streaks.get(i) ?? 0 : 0;
          if (haloStreakScale > 0) {
            // Reuse the half-res emissive halo buffer to cast vertical neon streaks onto wet pavement south of storefronts
            const hx = Math.min(haloW - 1, x >> 1);
            const hy1 = Math.max(0, (y - 3) >> 1);
            const hy2 = Math.max(0, (y - 6) >> 1);
            const hy3 = Math.max(0, (y - 10) >> 1);
            const hi1 = (hy1 * haloW + hx) * 3;
            const hi2 = (hy2 * haloW + hx) * 3;
            const hi3 = (hy3 * haloW + hx) * 3;
            const kGain = (isPuddle ? 1.25 : 0.85) * haloStreakScale;
            const hr = (halo[hi1] * 0.68 + halo[hi2] * 0.46 + halo[hi3] * 0.26) * kGain;
            const hg = (halo[hi1 + 1] * 0.68 + halo[hi2 + 1] * 0.46 + halo[hi3 + 1] * 0.26) * kGain;
            const hb = (halo[hi1 + 2] * 0.68 + halo[hi2 + 2] * 0.46 + halo[hi3 + 2] * 0.26) * kGain;
            if (hr + hg + hb > 5) {
              streak = packElevAbgr(
                Math.min(255, channel(streak, RED) + Math.round(hr)),
                Math.min(255, channel(streak, GREEN) + Math.round(hg)),
                Math.min(255, channel(streak, BLUE) + Math.round(hb)),
              );
            }
          }
          if (!wetSkyChanged && wetSample.previousBase[k] === base && wetSample.previousRay[k] === ray &&
              wetSample.previousStreak[k] === streak) continue;
          wetSample.previousBase[k] = base;
          wetSample.previousRay[k] = ray;
          wetSample.previousStreak[k] = streak;
          if (wetSkyChanged) {
            const alignment = (-sy + sz) * Math.SQRT1_2 + (((x * 13 + y * 7) & 15) - 8) * 0.021;
            const power = Math.min(1, Math.max(0, alignment)) ** (isPuddle ? 12 : 8) * preset.sunIntensity * (isPuddle ? 32 : 14);
            const sun = preset.sunColor;
            wetSample.glints[k] = packElevAbgr(Math.round(power * sun[0]), Math.round(power * sun[1]), Math.round(power * sun[2]));
          }
          localWater[i] = shadeReflection(
            mat,
            base,
            ray,
            wetSample.facing[k],
            wetSample.glints[k],
            streak,
            localWet * distFade,
          );
          wetChanged = true;
        }
        if (wetChanged) expand(waterPut, ix, iy, ex, ey);
      }
    }
    this.waterBounds = waterDraw.x1 > waterDraw.x0 ? waterDraw : undefined;
    this.glassBounds = glassDraw.x1 > glassDraw.x0 ? glassDraw : undefined;
    this.water.upload(waterPut);
    this.glass.upload(glassPut);
  }

  drawWater(ctx: CanvasRenderingContext2D): void {
    if (this.waterBounds) this.water.draw(ctx, this.waterBounds);
  }

  drawGlass(ctx: CanvasRenderingContext2D): void {
    if (this.glassBounds) this.glass.draw(ctx, this.glassBounds);
  }
}
