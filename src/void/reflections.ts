import { CHUNK_SIZE } from "./config.ts";
import { MAX_ELEVATION_PX, packElevAbgr, type BuildingSpriteCache } from "./elevation.ts";
import type { LightingEngine, LightingQualityMode, PointLight, TimeOfDayPreset } from "./lighting.ts";
import { CellMaterial, LandCover, SurfaceMaterial } from "./model.ts";
import type { VoidWorld } from "./world.ts";

type RGB = readonly [number, number, number];
type Bounds = { x0: number; y0: number; x1: number; y1: number };
type Atlas = Pick<BuildingSpriteCache, "atlasElev" | "atlasBldId" | "atlasNx" | "atlasNy" | "atlasNz">;
type ReflectiveMaterial = typeof SurfaceMaterial.WATER | typeof SurfaceMaterial.GLASS;

export const REFLECTION_MATERIALS = {
  [SurfaceMaterial.WATER]: { reflectivity: 0.74, fresnel: 0.75, roughness: 0, tint: [0.66, 0.85, 0.98], ripple: 1 },
  [SurfaceMaterial.GLASS]: { reflectivity: 0.32, fresnel: 0.85, roughness: 0.15, tint: [0.91, 0.96, 1.03], ripple: 0 },
} as const;

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const RED = LITTLE_ENDIAN ? 0 : 24;
const GREEN = LITTLE_ENDIAN ? 8 : 16;
const BLUE = LITTLE_ENDIAN ? 16 : 8;
const GLASS_REACH = 12;

export function reflectionColor(rgb: RGB): number {
  return packElevAbgr(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]));
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

/** Tint the reflected radiance and apply Schlick's grazing-angle term. */
export function shadeReflection(
  material: ReflectiveMaterial, base: number, reflected: number, facing: number, glint = 0, streak = 0,
): number {
  const settings = REFLECTION_MATERIALS[material];
  const edge = 1 - Math.min(1, Math.max(0, facing));
  const strength = settings.reflectivity + (1 - settings.reflectivity) * settings.fresnel * edge ** 5;
  const softness = 1 - settings.roughness * 0.35;
  const blend = (shift: number, tint: number) => Math.min(255, Math.round(
    channel(base, shift) * (1 - strength) + channel(reflected, shift) * tint * strength * softness +
    channel(glint, shift) + channel(streak, shift),
  ));
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

type Tile = {
  water: Samples;
  glass: Samples;
  glassSources: number[];
  geometry: LightingQualityMode;
  sky?: string;
  waterRevision?: number;
  glassRevision?: number;
  hadStreak?: boolean;
};

function samples(cells: number[], hits: number[], facing: number[]): Samples {
  return {
    cells, hits, facing, previousBase: new Uint32Array(cells.length),
    previousRay: new Uint32Array(cells.length), previousStreak: new Uint32Array(cells.length),
    glints: new Uint32Array(cells.length),
  };
}

class ReflectionLayer {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;
  private image?: ImageData;
  pixels = new Uint32Array(0);

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.image = this.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  upload(bounds: Bounds): void {
    if (bounds.x1 > bounds.x0 && bounds.y1 > bounds.y0 && this.image) {
      this.ctx.putImageData(this.image, 0, 0, bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    }
  }

  draw(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
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
  private readonly water = new ReflectionLayer();
  private readonly glass = new ReflectionLayer();
  private readonly actorPixels = new Map<number, { lit: number; height: number }>();
  private readonly streaks = new Map<number, number>();
  private readonly halfWaterHits = new Int32Array(HALF_TILE ** 2);
  private readonly halfGlassHits = new Int32Array(HALF_TILE ** 2);
  private readonly halfGlassOwners = new Int16Array(HALF_TILE ** 2);
  private world?: VoidWorld;
  private dirty = new Uint8Array(0);
  private streakTiles = new Uint8Array(0);
  private tiles: (Tile | undefined)[] = [];
  private bounds: Bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private waterBounds?: Bounds;
  private glassBounds?: Bounds;

  begin(world: VoidWorld, dirtyChunks: Uint8Array, view: Bounds): void {
    const { w, h, chunksW, chunksH, chunkCount } = world.grid;
    if (this.world !== world) {
      this.world = world;
      this.water.resize(w, h);
      this.glass.resize(w, h);
      this.tiles = new Array(chunkCount);
      this.dirty = new Uint8Array(chunkCount).fill(1);
      this.streakTiles = new Uint8Array(chunkCount);
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
  }

  stampActor(surface: Uint8Array, x: number, y: number, width: number, height: number, color: () => number): void {
    const { w } = this.world!.grid;
    const projectedY = y + height;
    if (projectedY < this.bounds.y0 || projectedY >= this.bounds.y1) return;
    let stamp: { lit: number; height: number } | undefined;
    for (let px = Math.max(x, this.bounds.x0); px < Math.min(x + width, this.bounds.x1); px++) {
      const idx = projectedY * w + px;
      if (surface[idx] !== SurfaceMaterial.WATER || (this.actorPixels.get(idx)?.height ?? Infinity) <= height) continue;
      stamp ??= { lit: color(), height };
      this.actorPixels.set(idx, stamp);
    }
  }

  private stampLights(surface: Uint8Array, lights: readonly PointLight[], phase: number): void {
    const { w, chunksW } = this.world!.grid;
    const { x0, x1, y0, y1 } = this.bounds;
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
          if (surface[(cy + dy) * w + x] !== SurfaceMaterial.WATER) continue;
          const distance = Math.abs(x - lightX) + Math.abs(dy) * 0.5;
          if (distance < best) { best = distance; cx = x; }
        }
      }
      const bankFalloff = Math.max(0.24, 1 - Math.abs(cx - lightX) / light.radius);
      for (let y = Math.max(y0, cy - (length >> 1)); y < Math.min(y1, cy + length); y++) {
        const wave = phase > 0 ? ((y + phase + cx) >> 2) % 3 - 1 : 0;
        const falloff = Math.max(0, 1 - Math.abs(y - cy) / length);
        for (let x = Math.max(x0, cx + wave - halfWidth); x <= Math.min(x1 - 1, cx + wave + halfWidth); x++) {
          const idx = y * w + x;
          if (surface[idx] !== SurfaceMaterial.WATER) continue;
          const energy = falloff * falloff * (1 - Math.abs(x - cx - wave) / (halfWidth + 1)) * 113 * bankFalloff;
          if (energy < 3) continue;
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

  paint(
    atlas: BuildingSpriteCache, lighting: LightingEngine, baseTerrain: Uint32Array,
    lights: readonly PointLight[], preset: TimeOfDayPreset, quality: LightingQualityMode, time: number,
  ): void {
    const world = this.world!;
    const { w, h, chunksW } = world.grid;
    const { x0, y0, x1, y1 } = this.bounds;
    this.waterBounds = this.glassBounds = undefined;
    if (x1 <= x0 || y1 <= y0) return;
    const { terrainSurface, terrainLightU32, buildingLightU32 } = lighting;
    const phase = Math.floor(time * 6);
    this.stampLights(terrainSurface, lights, phase);
    const sky = reflectionColor(preset.skyColor);
    const skyKey = [preset.id, ...preset.skyColor, ...preset.sunDir, ...preset.sunColor, preset.sunIntensity].join(",");
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
