import { CORRUPTION_REACH, PIXEL_AREA, pixels } from "./config.ts";
/** Destructible terrain, structural support connectivity, detached debris
 * clusters, prismatic inward debris streams, and matter restoration/reinforcement
 * for Void Defense. */

import { dist } from "../exact.ts";
import { ARCH_PALETTES, FLOORS_PER_PIXEL } from "./elevation.ts";
import { hash01, ORTHO } from "./grid.ts";
import {
  CellMaterial,
  type CellMaterialId,
  type ChunkImpact,
  type DebrisFragment,
  type DustPuff,
  type FallingChunk,
  LandCover,
  type ShockwaveEffect,
  type VoidRipple,
} from "./model.ts";
import type { VoidWorld } from "./world.ts";

/** Maximum pooled 3D falling chunks (zero per-tick allocation). */
export const MAX_FALLING_CHUNKS = 200;
/** Maximum pooled 1-px grey dust puffs from collapsing columns. */
export const MAX_DUST_PUFFS = 120;
/** Maximum pooled brightness ripples in the Void interior. */
export const MAX_VOID_RIPPLES = 16;
/** Vertical gravitational acceleration in world pixels / s². */
export const FALL_GRAVITY_PX = 60;
/** Depth below ground plane (`z < -24`) at which falling Void-bound chunks vanish. */
export const VOID_ABYSS_Z = -24;
/** Falling-chunk impact damage per (mass x landing speed); a 1x1 chunk from a 30-floor roof deals ~8. */
export const CHUNK_IMPACT_DAMAGE_SCALE = 0.2;
/** Cap on one chunk's impact damage, so a 2x2 slab maims rather than one-shots heavy units. */
export const CHUNK_IMPACT_MAX_DAMAGE = 30;
/** HP a landing chunk scuffs off a street cell (buildings and walls take none). */
export const CHUNK_STREET_CRACK = 2;
/** Fraction of impact damage armoured towers take: debris is aimed at units and Void
 * organisms, so a turret only gets scraped (chips under ~7 damage leave it untouched). */
export const CHUNK_TOWER_DAMAGE_SCALE = 0.15;
/** A collapse is "large" (camera-shake worthy) when one building loses at least this many
 * columns in one tick... */
export const LARGE_COLLAPSE_MIN_COLUMNS = 16;
/** ...and at least this share of its footprint. */
export const LARGE_COLLAPSE_MIN_SHARE = 0.3;

/** Prismatic spark colours for small fast fragments. */
const DEBRIS_PALETTES: readonly { color: string; glow: string }[] = [
  { color: "#ff8c29", glow: "rgba(255, 140, 41, 0.45)" },
  { color: "#ffd15c", glow: "rgba(255, 209, 92, 0.45)" },
  { color: "#ff42b8", glow: "rgba(255, 66, 184, 0.48)" },
  { color: "#45e3ff", glow: "rgba(69, 227, 255, 0.48)" },
  { color: "#b967ff", glow: "rgba(185, 103, 255, 0.45)" },
  { color: "#a4b6cc", glow: "rgba(164, 182, 204, 0.35)" },
];

/** Slab colours for torn-off terrain: a fragment keeps the colour of the land it was,
 * so grass, crops, forest canopy, pavement and lit masonry visibly stream into the anomaly. */
const SLAB_COLORS: Record<number, readonly string[]> = {
  [LandCover.GRASS]: ["#5e9a3c", "#4f8a34", "#6fae46"],
  [LandCover.MEADOW]: ["#8fb45a", "#a7c46a"],
  [LandCover.FOREST]: ["#2f6b3a", "#3c7d46"],
  [LandCover.FIELD_H]: ["#d9a63a", "#e8c050"],
  [LandCover.FIELD_V]: ["#d9a63a", "#e8c050"],
  [LandCover.ORCHARD]: ["#5e9a3c", "#3c7d46"],
  [LandCover.DIRT_ROAD]: ["#b08a5a", "#9a7549"],
  [LandCover.BRIDGE]: ["#8a6a48"],
  [LandCover.RIVER]: ["#2f78b8", "#58b0e6"],
  [LandCover.SILO]: ["#b8c0cc"],
};
const SLAB_URBAN: Record<number, readonly string[]> = {
  [CellMaterial.STREET]: ["#3a414c", "#4a525e", "#2c323b"],
  [CellMaterial.PARK]: ["#2e6b4e", "#38414f"],
  [CellMaterial.BUILDING]: ["#6e5846", "#4a5568", "#8c6d61"],
  [CellMaterial.SKYSCRAPER]: ["#3b6691", "#5c7894", "#465375"],
  [CellMaterial.RECLAIMED]: ["#7a4d30", "#485669"],
  [CellMaterial.SALVAGE]: ["#6e472b"],
  [CellMaterial.WALL]: ["#5c6d85"],
  [CellMaterial.BARRIER]: ["#48e5ff"],
  [CellMaterial.UNCLAIMED]: ["#153956"],
  [CellMaterial.EMPTY]: ["#0a0b12"],
};

const moltenHexParseCache = new Map<string, [number, number, number]>();

function parseBaseHexRgb(hex: string): [number, number, number] {
  let v = moltenHexParseCache.get(hex);
  if (v) return v;
  if (hex.startsWith("#") && hex.length >= 7) {
    v = [
      parseInt(hex.slice(1, 3), 16) & 0xff,
      parseInt(hex.slice(3, 5), 16) & 0xff,
      parseInt(hex.slice(5, 7), 16) & 0xff,
    ];
  } else {
    v = [110, 120, 136];
  }
  moltenHexParseCache.set(hex, v);
  return v;
}

function toHexByte(n: number): string {
  const c = Math.max(0, Math.min(255, Math.round(n)));
  return c < 16 ? `0${c.toString(16)}` : c.toString(16);
}

/** Computes normalized thermal heat (`0..1`) as a sucked-in pixel spirals from the frontier
 * (`distToPortal = startDist`) toward the Void's center/core (`coreRadius`).
 * - At detachment (`distToPortal >= startDist * 0.85`), heat is strictly `0` (original color preserved).
 * - Approaching the event-horizon core (`distToPortal -> coreRadius`), heat smoothly rises to `1`. */
export function computeDebrisHeat(
  distToPortal: number,
  startDist: number,
  coreRadius = 5,
  _lifeRatio = 0,
): number {
  const core = Math.max(2.5, coreRadius);
  const sDist = Math.max(core + 4, startDist);
  const heatStart = Math.max(core + 3.0, Math.min(sDist * 0.72, core * 4.0));
  if (distToPortal >= heatStart) return 0;
  const raw = Math.min(
    1,
    Math.max(0, (heatStart - distToPortal) / Math.max(0.5, heatStart - core)),
  );
  // Smooth cubic Hermite ramp
  return raw * raw * (3 - 2 * raw);
}

/** Computes whirlpool spiral and spaghettification kinematics at distance `distToPortal` from a Void
 * portal with inner circle radius `coreRadius` and initial detachment distance `startDist`.
 * - Both inward radial pull and tangential whirlpool spin accelerate strongly as `distToPortal -> coreRadius`.
 * - Intact multi-pixel building/object chunks start with heavier inertia (`intact = true`) before disintegrating
 *   into fast individual 1x1 pixels closer to the black hole. */
export function computeWhirlpoolKinematics(
  distToPortal: number,
  startDist: number,
  coreRadius = 5,
  intact = false,
): { radialSpeed: number; tangentialSpeed: number; totalSpeed: number; proximity: number } {
  const core = Math.max(2.5, coreRadius);
  const fullSpan = Math.max(4, Math.max(startDist, distToPortal) - core);
  const tidalSpan = Math.max(10, Math.min(fullSpan, core * 4.2));
  // Proximity u in [0, 1]: blends overall progress from startDist with tidal-zone proximity near the black hole
  const uFull = Math.min(1, Math.max(0, 1 - (distToPortal - core) / fullSpan));
  const uTidal = Math.min(1, Math.max(0, 1 - (distToPortal - core) / tidalSpan));
  const proximity = Math.max(uFull * 0.65, uTidal);
  const u2 = proximity * proximity;
  const u3 = u2 * proximity;
  const massScale = intact ? 0.75 : 1.0;

  // Far-field catch-up pull so distant debris reaches the black hole's tidal whirlpool promptly,
  // plus steep spaghettification acceleration (up to ~8x) as distToPortal -> coreRadius
  const farCatchup = distToPortal > core + tidalSpan ? (distToPortal - (core + tidalSpan)) * 0.5 : 0;
  const radialSpeed = (pixels(3.2) * (1 + 2.4 * proximity + 5.0 * u3) + farCatchup) * massScale;
  const tangentialSpeed = pixels(3.3) * (1 + 2.1 * proximity + 4.0 * u3) * massScale;
  const totalSpeed = Math.hypot(radialSpeed, tangentialSpeed);
  return { radialSpeed, tangentialSpeed, totalSpeed, proximity };
}

/** Interpolates a sucked-in pixel's original color `baseHex` through a molten blackbody ramp as `heat` (`0..1`) increases:
 * - `heat === 0`: 100% original terrain/building color (`baseHex`)
 * - `0.00 -> 0.32`: warms into deep glowing ember red (`#c42410`)
 * - `0.32 -> 0.64`: heats into molten lava orange (`#f86c18`)
 * - `0.64 -> 0.88`: heats into incandescent amber-gold (`#ffc842`)
 * - `0.88 -> 1.00`: peaks at white-hot core incandescence (`#fff4ce`) right at the event horizon */
export function moltenColorAtHeat(baseHex: string, heat: number): string {
  if (heat <= 0.001) return baseHex;
  const [r0, g0, b0] = parseBaseHexRgb(baseHex);
  let r: number;
  let g: number;
  let b: number;

  if (heat < 0.32) {
    const t = heat / 0.32;
    r = r0 + (196 - r0) * t;
    g = g0 + (36 - g0) * t;
    b = b0 + (16 - b0) * t;
  } else if (heat < 0.64) {
    const t = (heat - 0.32) / 0.32;
    r = 196 + (248 - 196) * t;
    g = 36 + (108 - 36) * t;
    b = 16 + (24 - 16) * t;
  } else if (heat < 0.88) {
    const t = (heat - 0.64) / 0.24;
    r = 248 + (255 - 248) * t;
    g = 108 + (200 - 108) * t;
    b = 24 + (66 - 24) * t;
  } else {
    const t = Math.min(1, (heat - 0.88) / 0.12);
    r = 255;
    g = 200 + (244 - 200) * t;
    b = 66 + (206 - 66) * t;
  }

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/** Smoothly transitions from strictly no glow (`0` when `heat <= 0.12`) to a slight warm glow (`0.34`)
 * as a pixel gets near the Void's center/core (`heat -> 1`). */
export function computeDebrisGlowAlpha(heat: number): number {
  if (heat <= 0.12) return 0;
  const u = Math.min(1, (heat - 0.12) / 0.88);
  const smooth = u * u * (3 - 2 * u);
  return smooth * 0.34;
}

/** Returns the warm molten glow RGBA color for a heated pixel at `heat` (`0..1`). */
export function moltenGlowColorAtHeat(heat: number, alphaScale = 1): string {
  const alpha = computeDebrisGlowAlpha(heat) * alphaScale;
  if (alpha <= 0.002) return "rgba(0, 0, 0, 0)";
  const r = 255;
  const g = Math.round(70 + heat * 135);
  const b = Math.round(20 + Math.max(0, heat - 0.5) * 140);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export class VoidPhysics {
  readonly debris: DebrisFragment[] = [];
  readonly shockwaves: ShockwaveEffect[] = [];
  readonly recentCellLosses: {
    cellIdx: number;
    material: CellMaterialId;
    maxHp: number;
    buildingId: number;
    columnFloors: number;
  }[] = [];
  /** Pre-allocated fixed pool of 3D falling chunks (masonry, roof slabs, collapsed towers, fallen units). */
  readonly fallingChunks: FallingChunk[] = Array.from({ length: MAX_FALLING_CHUNKS }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    w: 1,
    h: 1,
    color: "#4a525e",
    edgeColor: "#ff8c29",
    settle: "void",
    age: 0,
    bounces: 0,
  }));
  /** Set of building IDs that lost at least one pixel this tick and need a local connectivity check. */
  private readonly damagedBuildings = new Set<number>();
  private readonly cellLostBuildings = new Set<number>();
  /** Buildings shored up by Mason engineers (`buildingId -> shoredUntilTick`) to slow spalling & extend cantilever span. */
  readonly shoredBuildings = new Map<number, number>();
  /** Ground impact events emitted by falling chunks this tick for `VoidCombatManager` to apply to towers, units, and organisms. */
  readonly pendingImpacts: ChunkImpact[] = [];
  /** Monotonic tick counter for deterministic spalling rolls. */
  private supportTick = 0;

  /** Shores up `buildingId` until `untilTick`, slowing brink spalling and adding +1 px cantilever support. */
  shoreBuilding(buildingId: number, untilTick: number): void {
    const prev = this.shoredBuildings.get(buildingId) ?? 0;
    if (untilTick > prev) {
      this.shoredBuildings.set(buildingId, untilTick);
    }
  }

  /** Returns true if `buildingId` is currently tracked as damaged/brink-exposed. */
  isBrinkBuilding(buildingId: number): boolean {
    return this.damagedBuildings.has(buildingId);
  }
  /** Support tick of the most recent large structural collapse: one building losing at least
   * `LARGE_COLLAPSE_MIN_COLUMNS` columns and `LARGE_COLLAPSE_MIN_SHARE` of its footprint in one tick. */
  lastLargeCollapseTick = 0;
  /** World-pixel centre of the building behind `lastLargeCollapseTick` (the renderer only shakes when it is on screen). */
  lastLargeCollapseX = 0;
  lastLargeCollapseY = 0;
  /** Pre-allocated pool of 1-pixel grey dust puffs emitted when building columns lose floors. */
  readonly dustPuffs: DustPuff[] = Array.from({ length: MAX_DUST_PUFFS }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vz: 6,
    age: 0,
    maxAge: 0.4,
    color: "#868080",
  }));
  /** Pre-allocated pool of brightness ripples where large chunks vanish into the Void abyss. */
  readonly voidRipples: VoidRipple[] = Array.from({ length: MAX_VOID_RIPPLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    maxAge: 0.55,
  }));
  private dustSlot = 0;
  private rippleSlot = 0;

  /** Returns the count of currently active falling chunks in the pool. */
  activeFallingChunkCount(): number {
    let n = 0;
    for (let i = 0; i < this.fallingChunks.length; i++) {
      if (this.fallingChunks[i].active) n++;
    }
    return n;
  }

  /** Spawns a falling chunk into the pre-allocated pool without allocating.
   * When the pool is full, recycles the oldest Void-bound chunk first, else the oldest chunk. */
  spawnFallingChunk(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    w: number,
    h: number,
    color: string,
    edgeColor: string,
    settle: "salvage" | "void" | "fade",
  ): FallingChunk {
    let slot = -1;
    let oldestVoidSlot = -1;
    let oldestVoidAge = -1;
    let oldestAnySlot = 0;
    let oldestAnyAge = -1;

    for (let i = 0; i < this.fallingChunks.length; i++) {
      const ch = this.fallingChunks[i];
      if (!ch.active) {
        slot = i;
        break;
      }
      if (ch.settle === "void" && ch.age > oldestVoidAge) {
        oldestVoidAge = ch.age;
        oldestVoidSlot = i;
      }
      if (ch.age > oldestAnyAge) {
        oldestAnyAge = ch.age;
        oldestAnySlot = i;
      }
    }

    if (slot < 0) {
      slot = oldestVoidSlot >= 0 ? oldestVoidSlot : oldestAnySlot;
    }

    const ch = this.fallingChunks[slot];
    ch.active = true;
    ch.x = x;
    ch.y = y;
    ch.z = z;
    ch.vx = vx;
    ch.vy = vy;
    ch.vz = vz;
    ch.w = Math.max(1, Math.round(w));
    ch.h = Math.max(1, Math.round(h));
    ch.color = color;
    ch.edgeColor = edgeColor;
    ch.settle = settle;
    ch.age = 0;
    ch.bounces = 0;
    return ch;
  }

  /** Spawns a 1-pixel grey dust puff into the pre-allocated pool. */
  spawnDustPuff(x: number, y: number, z: number, color = "#868080"): void {
    let slot: DustPuff | null = null;
    for (let i = 0; i < this.dustPuffs.length; i++) {
      const idx = (this.dustSlot + i) % this.dustPuffs.length;
      if (!this.dustPuffs[idx].active) {
        slot = this.dustPuffs[idx];
        this.dustSlot = (idx + 1) % this.dustPuffs.length;
        break;
      }
    }
    if (!slot) {
      slot = this.dustPuffs[this.dustSlot];
      this.dustSlot = (this.dustSlot + 1) % this.dustPuffs.length;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vz = 6.0;
    slot.age = 0;
    slot.maxAge = 0.4;
    slot.color = color;
  }

  /** Spawns a Void interior brightness ripple where a large falling chunk plunges into the abyss. */
  spawnVoidRipple(x: number, y: number): void {
    const slot = this.voidRipples[this.rippleSlot];
    this.rippleSlot = (this.rippleSlot + 1) % this.voidRipples.length;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.maxAge = 0.55;
  }

  /** Resolves the true original primary and accent colors of cell `idx` before Void consumption so
   * sucked-in buildings, objects, and terrain start intact in their true colors. */
  private originalCellColors(
    world: VoidWorld,
    idx: number,
    prevMat: number,
    prevCover: number,
    bId: number,
  ): { color: string; accent: string } {
    const x = idx % world.grid.w;
    const y = (idx / world.grid.w) | 0;
    const v = (x * 7 + y * 13 + this.debris.length) & 7;
    if (bId >= 0) {
      const b = world.buildings[bId];
      if (b) {
        const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
        const pal = palettes[b.variant % palettes.length];
        const color = v === 0 ? pal.litEdge : v < 3 ? pal.crown : v < 6 ? pal.mid : pal.podium;
        const accent = (v & 1) === 0 ? pal.neonCore : pal.litEdge;
        return { color, accent };
      }
    }
    if (prevMat === CellMaterial.UNCLAIMED) {
      const c = prevCover === LandCover.RIVER ? (v < 2 ? "#4a9bd1" : "#2b6ca3") : "#153956";
      return { color: c, accent: "#58b0e6" };
    }
    if (prevMat === CellMaterial.WALL || prevMat === CellMaterial.BARRIER) {
      const c = prevMat === CellMaterial.BARRIER ? "#48c9e0" : (x + y) % 4 === 0 ? "#788ca8" : "#5a6b82";
      return { color: c, accent: "#8fa4c2" };
    }
    if (prevMat === CellMaterial.RECLAIMED) {
      return { color: v < 3 ? "#9e7e4e" : "#7d623c", accent: "#b08e5a" };
    }
    if (prevMat === CellMaterial.SALVAGE) {
      return { color: v < 2 ? "#995c38" : v < 5 ? "#5e4334" : "#3d353a", accent: "#7a5844" };
    }
    if (prevMat === CellMaterial.STREET) {
      if (prevCover === LandCover.BRIDGE) {
        return { color: (x + y) % 3 === 0 ? "#523b28" : "#876948", accent: "#a38152" };
      }
      if (world.streetTier[idx] === 8) {
        return { color: v < 4 ? "#a38152" : "#8c6d45", accent: "#b08a5a" };
      }
      // Broken asphalt pavement & roadbed concrete aggregate (readable against the dark Void)
      const asphalt = v < 3 ? "#4a5464" : v < 6 ? "#586478" : "#3e4756";
      const accent = v === 0 ? "#d4a64a" : "#7a869a";
      return { color: asphalt, accent };
    }
    if (prevMat === CellMaterial.PARK || prevCover !== LandCover.NONE) {
      const slabs = SLAB_COLORS[prevCover];
      if (slabs && slabs.length > 0) {
        return {
          color: slabs[v % slabs.length],
          accent: slabs[(v + 1) % slabs.length],
        };
      }
      return { color: v < 4 ? "#3a6e3b" : "#294a33", accent: "#507d39" };
    }
    const urban = SLAB_URBAN[prevMat] ?? SLAB_URBAN[CellMaterial.STREET];
    return {
      color: urban[v % urban.length],
      accent: urban[(v + 1) % urban.length],
    };
  }

  /** Converts cell `idx` into Void and queues any affected building for structural support evaluation. */
  consumeCellIntoVoid(world: VoidWorld, idx: number, spawnDebris = true): void {
    const bId = world.buildingAt[idx];
    const prevMat = world.material[idx];
    const prevMaxHp = world.maxHp[idx];
    const prevFloors = world.columnFloors[idx];
    const prevCover = world.landCover[idx];
    if (prevMat !== CellMaterial.VOID && prevMat !== CellMaterial.EMPTY && this.recentCellLosses.length < 256) {
      this.recentCellLosses.push({
        cellIdx: idx,
        material: prevMat as CellMaterialId,
        maxHp: Math.max(40, prevMaxHp),
        buildingId: bId,
        columnFloors: prevFloors,
      });
    }
    world.material[idx] = CellMaterial.VOID;
    world.hp[idx] = 0;
    world.buildingAt[idx] = -1;
    // The corruption band tints land up to CORRUPTION_REACH pixels from the Void, so repaint that neighbourhood
    world.grid.markRadiusDirty(idx, CORRUPTION_REACH);

    if (bId >= 0) {
      this.damagedBuildings.add(bId);
      this.cellLostBuildings.add(bId);
    } else {
      // Also check if any adjacent cell belongs to a building so brink spalling activates
      const cx = world.grid.xOf(idx);
      const cy = world.grid.yOf(idx);
      for (const [dx, dy] of ORTHO) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (world.grid.inBounds(nx, ny)) {
          const nbId = world.buildingAt[world.grid.index(nx, ny)];
          if (nbId >= 0) this.damagedBuildings.add(nbId);
        }
      }
    }

    if (spawnDebris && prevMat !== CellMaterial.VOID && prevMat !== CellMaterial.EMPTY) {
      if (this.debris.length >= 750) {
        this.debris.shift();
      }
      const rawX = world.grid.xOf(idx) + 0.5;
      const rawY = world.grid.yOf(idx) + 0.5;

      // Locate nearest active Void portal (or fall back to nearest Void neighbor)
      let portalX = rawX;
      let portalY = rawY;
      let bestDist = Number.POSITIVE_INFINITY;
      let bestCoreR = 5;
      for (const p of world.portals) {
        if (!p.active) continue;
        const d = dist(rawX - p.x, rawY - p.y);
        if (d < bestDist) {
          bestDist = d;
          portalX = p.x;
          portalY = p.y;
          bestCoreR = Math.max(3.6, p.radius * 0.42);
        }
      }

      if (!Number.isFinite(bestDist)) {
        for (const [dx, dy] of ORTHO) {
          const nx = (rawX | 0) + dx;
          const ny = (rawY | 0) + dy;
          if (world.grid.inBounds(nx, ny) && world.material[world.grid.index(nx, ny)] === CellMaterial.VOID) {
            portalX = rawX + dx * 6;
            portalY = rawY + dy * 6;
            bestCoreR = 2.5;
            break;
          }
        }
      }

      const rawDx = portalX - rawX;
      const rawDy = portalY - rawY;
      const rawDist = Math.max(bestCoreR + 0.8, dist(rawDx, rawDy));
      const nx = rawDx / rawDist;
      const ny = rawDy / rawDist;

      // Start slightly closer to the Void center (clearing the subterranean ledge lip)
      const inwardShift = Math.max(
        0,
        Math.min(rawDist - bestCoreR - 1.2, Math.min(4.5, (rawDist - bestCoreR) * 0.22)),
      );
      const x = rawX + nx * inwardShift;
      const y = rawY + ny * inwardShift;
      const d = Math.max(bestCoreR + 0.5, rawDist - inwardShift);

      // Buildings, walls, streets, and objects tear off as intact blocks/slabs or crumbling particles,
      // then disintegrate into individual 1x1 pixels closer to the black hole.
      const isStructure =
        bId >= 0 ||
        prevMat === CellMaterial.BUILDING ||
        prevMat === CellMaterial.SKYSCRAPER ||
        prevMat === CellMaterial.WALL ||
        prevMat === CellMaterial.BARRIER ||
        prevCover === LandCover.SILO ||
        prevCover === LandCover.BRIDGE;
      const isStreet = prevMat === CellMaterial.STREET;
      const startsIntact =
        isStructure ||
        (isStreet ? hash01(world.seed, 611, idx, this.debris.length) < 0.55 : hash01(world.seed, 611, idx, this.debris.length) < 0.72);
      const { color, accent } = this.originalCellColors(world, idx, prevMat, prevCover, bId);
      const kin = computeWhirlpoolKinematics(d, d, bestCoreR, startsIntact);
      const disintegrateAt = 0.36 + hash01(world.seed, 615, idx, this.debris.length) * 0.22;

      this.debris.push({
        x,
        y,
        px: x,
        py: y,
        vx: nx * kin.radialSpeed - ny * kin.tangentialSpeed,
        vy: ny * kin.radialSpeed + nx * kin.tangentialSpeed,
        portalX,
        portalY,
        color,
        accentColor: accent,
        glowColor: "rgba(0, 0, 0, 0)",
        size: startsIntact
          ? isStructure
            ? prevMat === CellMaterial.SKYSCRAPER
              ? 2.8
              : 2.2
            : 2.0
          : 1.0,
        life: 0,
        // Generous safety cap so particles disappear strictly upon touching the inner circle (coreRadius),
        // never after a short fixed travel time.
        maxLife: 30,
        startDist: d,
        coreRadius: bestCoreR,
        intact: startsIntact,
        disintegrateAt,
      });

      // Streets also shed a crumbling 1x1 asphalt/roadbed particle as the pavement fractures into the Void
      if (isStreet && startsIntact && d > bestCoreR + 2.0 && this.debris.length < 750) {
        const px2 = x - ny * 0.65 + nx * 0.5;
        const py2 = y + nx * 0.65 + ny * 0.5;
        const d2 = Math.max(bestCoreR + 0.5, dist(portalX - px2, portalY - py2));
        const kin2 = computeWhirlpoolKinematics(d2, d2, bestCoreR, false);
        this.debris.push({
          x: px2,
          y: py2,
          px: px2,
          py: py2,
          vx: nx * kin2.radialSpeed - ny * kin2.tangentialSpeed,
          vy: ny * kin2.radialSpeed + nx * kin2.tangentialSpeed,
          portalX,
          portalY,
          color: accent,
          glowColor: "rgba(0, 0, 0, 0)",
          size: 1.0,
          life: 0,
          maxLife: 30,
          startDist: d2,
          coreRadius: bestCoreR,
          intact: false,
        });
      }
    }
  }

  /** Evaluates structural stability for any building damaged this tick:
   * - Cantilever rule: a column whose foundation cell became Void survives only if within
   *   `maxSpan = 1 + floor(remainingFloors / 8)` px of a supported column of the same building.
   * - Spalling at the brink: columns adjacent to Void or overhanging Void lose floors from the top
   *   at a deterministic seeded rate scaled by adjacent Void count.
   * - Disconnected splinters (`<= 2 / PIXEL_AREA` pixels) detach into salvage/debris. */
  stepStructuralSupport(world: VoidWorld, dt: number): void {
    this.supportTick++;
    let columnsCollapsedThisTick = 0;
    let largestCollapse = 0;
    const { w, h } = world.grid;
    const { material, buildingAt, hp, maxHp, columnFloors } = world;

    if (this.damagedBuildings.size > 0) {
      const keepActive: number[] = [];
      for (const bId of this.damagedBuildings) {
        const b = world.buildings[bId];
        if (!b) continue;
        const collapsedBefore = columnsCollapsedThisTick;

        // 1. Identify supported columns (solid ground foundation) vs overhanging columns (over Void)
        const supported: number[] = [];
        const overhanging: number[] = [];
        let hasBrinkOrOverhang = false;

        for (let i = 0; i < b.cells.length; i++) {
          const c = b.cells[i];
          if (buildingAt[c] === bId && material[c] !== CellMaterial.VOID && hp[c] > 0) {
            if (columnFloors[c] === 0) columnFloors[c] = b.height;
            supported.push(c);
          } else if (material[c] === CellMaterial.VOID && columnFloors[c] > 0) {
            overhanging.push(c);
          }
        }

        // 2. Cantilever check for overhanging columns over Void
        const palettes = ARCH_PALETTES[b.archStyle] ?? ARCH_PALETTES.glassTower;
        const pal = palettes[b.variant % palettes.length];
        const bCenterX = b.x + b.w * 0.5;
        const bCenterY = b.y + b.h * 0.5;
        const isShored = (this.shoredBuildings.get(bId) ?? 0) >= this.supportTick;
        const shoreSpanBonus = isShored ? 1 : 0;
        const shoreSpallScale = isShored ? 0.25 : 1.0;

        if (overhanging.length > 0) {
          for (let i = 0; i < overhanging.length; i++) {
            const c = overhanging[i];
            const floors = columnFloors[c];
            const maxSpan = 1 + Math.floor(floors / 8) + shoreSpanBonus;
            const cx = c % w;
            const cy = (c / w) | 0;
            let held = false;
            for (let j = 0; j < supported.length; j++) {
              const s = supported[j];
              const sx = s % w;
              const sy = (s / w) | 0;
              if (Math.abs(cx - sx) + Math.abs(cy - sy) <= maxSpan) {
                held = true;
                break;
              }
            }
            if (!held) {
              columnsCollapsedThisTick++;
              columnFloors[c] = 0;
              world.grid.markIndexDirty(c);
              const z0 = Math.max(1, Math.ceil(floors / FLOORS_PER_PIXEL));
              this.spawnDustPuff(cx, cy, z0, (c & 1) === 0 ? "#868080" : "#5c6574");
              const outX = cx - bCenterX;
              const outY = cy - bCenterY;
              const outD = Math.max(1, dist(outX, outY));
              const spd = 2.0 + hash01(world.seed, 945, this.supportTick, c) * 3.5;
              this.spawnFallingChunk(
                cx,
                cy,
                z0,
                (outX / outD) * spd,
                (outY / outD) * spd,
                0,
                floors >= 12 ? 2 : 1,
                floors >= 12 ? 2 : 1,
                pal.crown,
                pal.neonEdge,
                "void",
              );
            } else {
              hasBrinkOrOverhang = true;
              // Overhanging cantilever spalls from the top (slowed 75% when shored by Mason engineers)
              if (hash01(world.seed, 940, this.supportTick, c) < 0.42 * shoreSpallScale) {
                columnsCollapsedThisTick++;
                const loss = 1 + (hash01(world.seed, 941, this.supportTick, c) < 0.35 ? 1 : 0);
                columnFloors[c] = Math.max(0, floors - loss);
                world.grid.markIndexDirty(c);
                const z0 = Math.max(1, Math.ceil(floors / FLOORS_PER_PIXEL));
                this.spawnDustPuff(cx, cy, z0, (c & 1) === 0 ? "#868080" : "#5c6574");
                const outX = cx - bCenterX;
                const outY = cy - bCenterY;
                const outD = Math.max(1, dist(outX, outY));
                const spd = 2.0 + hash01(world.seed, 946, this.supportTick, c) * 3.0;
                this.spawnFallingChunk(
                  cx,
                  cy,
                  z0,
                  (outX / outD) * spd,
                  (outY / outD) * spd,
                  0,
                  1,
                  1,
                  pal.mid,
                  pal.neonCore,
                  "void",
                );
              }
            }
          }
        }

        // 3. Brink spalling on supported columns adjacent to Void
        for (let i = 0; i < supported.length; i++) {
          const c = supported[i];
          const cx = c % w;
          const cy = (c / w) | 0;
          let adjVoid = 0;
          if (cx > 0 && material[c - 1] === CellMaterial.VOID) adjVoid++;
          if (cx + 1 < w && material[c + 1] === CellMaterial.VOID) adjVoid++;
          if (cy > 0 && material[c - w] === CellMaterial.VOID) adjVoid++;
          if (cy + 1 < h && material[c + w] === CellMaterial.VOID) adjVoid++;
          if (adjVoid > 0) {
            hasBrinkOrOverhang = true;
            // Spall rate proportional to adjacent Void count; floors crumble from the top down to 1 floor
            // (preserving ground cell HP/salvage until Void or splinter collapse finishes the foundation)
            if (
              columnFloors[c] > 1 &&
              hash01(world.seed, 942, this.supportTick, c) < 0.14 * adjVoid * shoreSpallScale
            ) {
              columnsCollapsedThisTick++;
              const oldFloors = columnFloors[c];
              const loss = adjVoid >= 2 ? 2 : 1;
              columnFloors[c] = Math.max(1, oldFloors - loss);
              world.grid.markIndexDirty(c);
              const z0 = Math.max(1, Math.ceil(oldFloors / FLOORS_PER_PIXEL));
              this.spawnDustPuff(cx, cy, z0, (c & 1) === 0 ? "#868080" : "#5c6574");
              const outX = cx - bCenterX;
              const outY = cy - bCenterY;
              const outD = Math.max(1, dist(outX, outY));
              const spd = 2.2 + hash01(world.seed, 947, this.supportTick, c) * 3.2;
              this.spawnFallingChunk(
                cx,
                cy,
                z0,
                (outX / outD) * spd,
                (outY / outD) * spd,
                0,
                adjVoid >= 2 ? 2 : 1,
                1,
                pal.podium,
                pal.neonEdge,
                "fade",
              );
            }
          }
        }

        const collapsed = columnsCollapsedThisTick - collapsedBefore;
        if (
          collapsed >= LARGE_COLLAPSE_MIN_COLUMNS &&
          collapsed >= b.cells.length * LARGE_COLLAPSE_MIN_SHARE &&
          collapsed > largestCollapse
        ) {
          largestCollapse = collapsed;
          this.lastLargeCollapseTick = this.supportTick;
          this.lastLargeCollapseX = bCenterX;
          this.lastLargeCollapseY = bCenterY;
        }

        if (supported.length === 0) continue;

        // 4. Connected-component splinter check on supported ground footprint (only when a cell was lost this tick)
        if (this.cellLostBuildings.has(bId)) {
          const intactSet = new Set<number>(supported);
          const visited = new Set<number>();
          const components: number[][] = [];

          for (const start of supported) {
            if (visited.has(start)) continue;
            const comp: number[] = [];
            const queue = [start];
            visited.add(start);
            while (queue.length > 0) {
              const curr = queue.pop()!;
              comp.push(curr);
              const cx = world.grid.xOf(curr);
              const cy = world.grid.yOf(curr);
              for (const [dx, dy] of ORTHO) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (!world.grid.inBounds(nx, ny)) continue;
                const nIdx = world.grid.index(nx, ny);
                if (intactSet.has(nIdx) && !visited.has(nIdx)) {
                  visited.add(nIdx);
                  queue.push(nIdx);
                }
              }
            }
            components.push(comp);
          }

          if (components.length > 1) {
            components.sort((aComp, bComp) => bComp.length - aComp.length);
            for (let i = 1; i < components.length; i++) {
              const splinter = components[i];
              if (splinter.length <= 2 / PIXEL_AREA) {
                for (const cIdx of splinter) {
                  const sx = cIdx % w;
                  const sy = (cIdx / w) | 0;
                  const z0 = Math.max(1, Math.ceil((columnFloors[cIdx] || b.height) / FLOORS_PER_PIXEL));
                  this.spawnFallingChunk(
                    sx,
                    sy,
                    z0,
                    0,
                    0,
                    0,
                    1,
                    1,
                    "#6e472b",
                    "#ff8c29",
                    "salvage",
                  );
                  material[cIdx] = CellMaterial.SALVAGE;
                  hp[cIdx] = 20;
                  maxHp[cIdx] = 26;
                  buildingAt[cIdx] = -1;
                  columnFloors[cIdx] = 0;
                  world.grid.markIndexDirty(cIdx);
                }
              }
            }
          }
        }

        if (hasBrinkOrOverhang) {
          keepActive.push(bId);
        }

      }
      this.damagedBuildings.clear();
      this.cellLostBuildings.clear();
      for (let i = 0; i < keepActive.length; i++) {
        this.damagedBuildings.add(keepActive[i]);
      }
    }

    // Advance drifting debris along whirlpool spirals with spaghettification acceleration and tidal disintegration
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.px = d.x;
      d.py = d.y;
      d.life += dt;

      const coreR = d.coreRadius ?? 0;
      if (coreR <= 0) {
        // Non-portal street impact spark
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.life >= d.maxLife) {
          this.debris.splice(i, 1);
        }
        continue;
      }

      const rx = d.x - d.portalX;
      const ry = d.y - d.portalY;
      const distToPortal = dist(rx, ry);
      if (distToPortal <= coreR || d.life >= d.maxLife) {
        this.debris.splice(i, 1);
        continue;
      }

      const startDist = Math.max(coreR + 4, d.startDist ?? distToPortal);
      const kin = computeWhirlpoolKinematics(distToPortal, startDist, coreR, Boolean(d.intact));

      // Tidal disintegration: intact multi-pixel building/object chunks remain intact initially,
      // then shatter into individual 1x1 pixels closer to the black hole
      if (d.intact && kin.proximity >= (d.disintegrateAt ?? 0.35)) {
        const pieceCount = Math.min(3, Math.max(2, Math.round(d.size)));
        d.intact = false;
        d.size = 1.0;
        const ux = rx / distToPortal;
        const uy = ry / distToPortal;
        const tx = -uy;
        const ty = ux;
        for (let k = 1; k <= pieceCount && this.debris.length < 950; k++) {
          const radOff = (k - 1.5) * 0.65;
          const tanOff = ((k & 1) === 0 ? 1 : -1) * 0.75;
          const sx = d.x + ux * radOff + tx * tanOff;
          const sy = d.y + uy * radOff + ty * tanOff;
          const sDist = dist(sx - d.portalX, sy - d.portalY);
          if (sDist <= coreR) continue;
          this.debris.push({
            x: sx,
            y: sy,
            px: sx,
            py: sy,
            vx: d.vx,
            vy: d.vy,
            portalX: d.portalX,
            portalY: d.portalY,
            color: k === 1 && d.accentColor ? d.accentColor : d.color,
            glowColor: "rgba(0, 0, 0, 0)",
            size: 1.0,
            life: d.life,
            maxLife: d.maxLife,
            startDist: d.startDist,
            coreRadius: coreR,
            intact: false,
          });
        }
      }

      // Polar whirlpool & spaghettification step: strictly decreases radius toward coreR while spinning
      const rNext = distToPortal - kin.radialSpeed * dt;
      if (rNext <= coreR) {
        // Disappears upon touching the Void's center mass / inner circle
        this.debris.splice(i, 1);
        continue;
      }

      const avgR = Math.max(coreR, 0.5 * (distToPortal + rNext));
      const dTheta = (kin.tangentialSpeed * dt) / avgR;
      const cosT = Math.cos(dTheta);
      const sinT = Math.sin(dTheta);
      const ux = rx / distToPortal;
      const uy = ry / distToPortal;
      const nx = d.portalX + rNext * (ux * cosT - uy * sinT);
      const ny = d.portalY + rNext * (uy * cosT + ux * sinT);
      const invDt = 1 / Math.max(0.001, dt);
      d.vx = (nx - d.x) * invDt;
      d.vy = (ny - d.y) * invDt;
      d.x = nx;
      d.y = ny;
    }

    // Advance expanding shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Advance pooled 3D falling chunks (semi-implicit Euler under gravity g = 60 px/s²)
    this.stepFallingChunks(world, dt);
  }

  /** Steps all active 3D falling chunks for `dt` seconds.
   * Over solid ground: bounces once at `z = 0` (`vz = -vz * 0.25`) then settles (depositing `SALVAGE` if `settle === "salvage"`).
   * Over Void: falls below the ground plane (`z < 0`, drawn at `screenY = y - z`) and vanishes at `z < -24`. */
  stepFallingChunks(world: VoidWorld, dt: number): void {
    const { w, h } = world.grid;
    const { material, hp, maxHp, buildingAt, towerAt } = world;
    const drag = Math.max(0, 1 - 1.2 * dt);

    for (let i = 0; i < this.fallingChunks.length; i++) {
      const ch = this.fallingChunks[i];
      if (!ch.active) continue;

      ch.age += dt;
      ch.vz -= FALL_GRAVITY_PX * dt;
      ch.vx *= drag;
      ch.vy *= drag;
      ch.x += ch.vx * dt;
      ch.y += ch.vy * dt;
      ch.z += ch.vz * dt;

      const gx = Math.floor(ch.x);
      const gy = Math.floor(ch.y);
      if (gx < 0 || gx >= w || gy < 0 || gy >= h) {
        ch.active = false;
        continue;
      }

      const idx = gy * w + gx;
      const onVoid = material[idx] === CellMaterial.VOID;

      if (!onVoid && ch.z <= 0) {
        ch.z = 0;
        if (ch.bounces === 0 && Math.abs(ch.vz) > 10) {
          const mass = Math.max(1, ch.w * ch.h);
          const impactDamage = Math.min(
            CHUNK_IMPACT_MAX_DAMAGE,
            Math.max(3, Math.round(mass * Math.abs(ch.vz) * CHUNK_IMPACT_DAMAGE_SCALE)),
          );

          // Debris is aimed at entities, not the city: it only scuffs a street it lands on
          // (never below 1 HP) and leaves buildings and walls untouched.
          if (material[idx] === CellMaterial.STREET) {
            hp[idx] = Math.max(1, hp[idx] - CHUNK_STREET_CRACK);
            world.grid.markIndexDirty(idx);
          }

          // Smoke cloud puffs around ground impact
          const puffCount = Math.min(5, 2 + mass);
          for (let k = 0; k < puffCount; k++) {
            const ox = (hash01(world.seed, 960, i, k) - 0.5) * 2.5;
            const oy = (hash01(world.seed, 961, i, k) - 0.5) * 2.5;
            this.spawnDustPuff(
              ch.x + ox,
              ch.y + oy,
              0.5 + k * 0.4,
              k % 2 === 0 ? "#5c6574" : "#4a525e",
            );
          }

          // Debris sparks on heavy impact
          if (this.debris.length < 750) {
            const dAng = hash01(world.seed, 962, i, this.supportTick) * Math.PI * 2;
            const dSpd = pixels(4.5);
            this.debris.push({
              x: ch.x,
              y: ch.y,
              px: ch.x,
              py: ch.y,
              vx: Math.cos(dAng) * dSpd,
              vy: Math.sin(dAng) * dSpd,
              portalX: ch.x + Math.cos(dAng) * 6,
              portalY: ch.y + Math.sin(dAng) * 6,
              color: ch.color,
              glowColor: "rgba(180, 190, 210, 0.35)",
              size: 1.0,
              life: 0,
              maxLife: 0.35,
            });
          }

          // Queue impact for towers, friendly agents, and Void organisms
          this.pendingImpacts.push({
            x: ch.x,
            y: ch.y,
            radius: Math.max(1.5, ch.w),
            damage: impactDamage,
          });
        }

        if (ch.bounces === 0 && Math.abs(ch.vz) > 8) {
          ch.vz = -ch.vz * 0.25;
          ch.vx *= 0.45;
          ch.vy *= 0.45;
          ch.bounces = 1;
        } else {
          if (
            ch.settle === "salvage" &&
            material[idx] !== CellMaterial.VOID &&
            material[idx] !== CellMaterial.UNCLAIMED &&
            material[idx] !== CellMaterial.WALL &&
            material[idx] !== CellMaterial.BARRIER &&
            buildingAt[idx] < 0 &&
            towerAt[idx] < 0
          ) {
            material[idx] = CellMaterial.SALVAGE;
            hp[idx] = 20;
            maxHp[idx] = 26;
            world.grid.markIndexDirty(idx);
          }
          ch.active = false;
        }
        continue;
      }

      if (onVoid && ch.z < VOID_ABYSS_Z) {
        if (ch.w * ch.h >= 4) {
          this.spawnVoidRipple(Math.round(ch.x), Math.round(ch.y - ch.z));
        }
        // Disintegrate fallen building/tower/agent chunk into individual 1x1 pixels that spiral into the portal core
        if (world.portals.length > 0 && this.debris.length < 850) {
          const sx0 = Math.round(ch.x);
          const sy0 = Math.round(ch.y - ch.z);
          let portalX = sx0;
          let portalY = sy0;
          let bestDist = Number.POSITIVE_INFINITY;
          let bestCoreR = 5;
          for (const p of world.portals) {
            if (!p.active) continue;
            const d = dist(sx0 - p.x, sy0 - p.y);
            if (d < bestDist) {
              bestDist = d;
              portalX = p.x;
              portalY = p.y;
              bestCoreR = Math.max(3.6, p.radius * 0.42);
            }
          }
          if (Number.isFinite(bestDist) && bestDist > bestCoreR + 0.5) {
            const count = Math.min(4, Math.max(1, ch.w * ch.h));
            for (let k = 0; k < count && this.debris.length < 850; k++) {
              const px = sx0 + (k & 1) * 0.7;
              const py = sy0 + (k >> 1) * 0.7;
              const pDist = dist(px - portalX, py - portalY);
              if (pDist <= bestCoreR) continue;
              this.debris.push({
                x: px,
                y: py,
                px,
                py,
                vx: 0,
                vy: 0,
                portalX,
                portalY,
                color: k === 0 ? ch.edgeColor : ch.color,
                glowColor: "rgba(0, 0, 0, 0)",
                size: 1.0,
                life: 0,
                maxLife: 30,
                startDist: Math.max(pDist, bestCoreR + 6),
                coreRadius: bestCoreR,
                intact: false,
              });
            }
          }
        }
        ch.active = false;
      } else if (ch.age > 3.5) {
        ch.active = false;
      }
    }

    // Advance pooled 1-px dust puffs
    for (let i = 0; i < this.dustPuffs.length; i++) {
      const p = this.dustPuffs[i];
      if (!p.active) continue;
      p.age += dt;
      p.z += p.vz * dt;
      if (p.age >= p.maxAge) p.active = false;
    }

    // Advance pooled Void interior brightness ripples
    for (let i = 0; i < this.voidRipples.length; i++) {
      const r = this.voidRipples[i];
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.maxAge) r.active = false;
    }
  }

  /** Deposits matter/land or ferrocrete wall in a circular radius around `(cx, cy)`. */
  depositMatterDisc(
    world: VoidWorld,
    cx: number,
    cy: number,
    radius: number,
    asWall: boolean,
    hpBoost = 1.0,
  ): { displacedVoidCells: number; restoredCells: number } {
    let displacedVoidCells = 0;
    let restoredCells = 0;
    const rCeil = Math.ceil(radius);
    const { w, h } = world.grid;

    for (
      let y = Math.max(0, Math.floor(cy - rCeil));
      y <= Math.min(h - 1, Math.ceil(cy + rCeil));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(cx - rCeil));
        x <= Math.min(w - 1, Math.ceil(cx + rCeil));
        x++
      ) {
        if (dist(x - cx, y - cy) > radius) continue;
        const idx = y * w + x;
        const mat = world.material[idx];

        if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED || mat === CellMaterial.EMPTY) {
          if (mat === CellMaterial.VOID) displacedVoidCells++;
          if (asWall) {
            world.material[idx] = CellMaterial.WALL;
            const wallHp = Math.min(255, Math.round(140 * hpBoost));
            world.hp[idx] = wallHp;
            world.maxHp[idx] = wallHp;
            world.buildingAt[idx] = -1;
          } else if (world.isBaselineCell[idx]) {
            const origMat = world.originalMaterial[idx];
            const origBld = world.originalBuildingAt[idx];
            world.material[idx] = origBld >= 0 ? origMat : CellMaterial.RECLAIMED;
            world.buildingAt[idx] = origBld;
            if (origBld >= 0 && world.buildings[origBld]) {
              world.columnFloors[idx] = world.buildings[origBld].height;
            }
            const restoredHp = Math.min(255, Math.round(65 * hpBoost));
            world.hp[idx] = restoredHp;
            world.maxHp[idx] = Math.max(world.maxHp[idx], restoredHp);
            restoredCells++;
          } else {
            world.material[idx] = CellMaterial.RECLAIMED;
            const islandHp = Math.min(255, Math.round(80 * hpBoost));
            world.hp[idx] = islandHp;
            world.maxHp[idx] = islandHp;
            world.buildingAt[idx] = -1;
          }
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
        } else if (world.hp[idx] < world.maxHp[idx]) {
          world.hp[idx] = Math.min(world.maxHp[idx], world.hp[idx] + Math.round(35 * hpBoost));
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
          restoredCells++;
        } else if (asWall && mat === CellMaterial.STREET && world.towerAt[idx] < 0) {
          world.material[idx] = CellMaterial.WALL;
          const wallHp = Math.min(255, Math.round(150 * hpBoost));
          world.hp[idx] = wallHp;
          world.maxHp[idx] = wallHp;
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
        }
      }
    }

    if (this.shockwaves.length < 48 && radius >= 2.0) {
      this.shockwaves.push({
        x: cx,
        y: cy,
        maxRadius: radius * 1.25,
        color: asWall ? "#48e5ff" : "#ff9e38",
        secondaryColor: displacedVoidCells > 0 ? "#ff42b8" : "#ffd166",
        life: 0,
        maxLife: radius >= 5 ? 0.65 : 0.38,
      });
    }

    return { displacedVoidCells, restoredCells };
  }

  /** Creates a new-land Hearthseed island on eligible Void/UNCLAIMED cells without
   * restoring historical buildings. Deterministic nested footprint grows monotonically with rank. */
  depositHearthseedIsland(
    world: VoidWorld,
    cx: number,
    cy: number,
    rank: number,
    hpBoost = 1.15,
  ): { displacedVoidCells: number; createdCells: number } {
    const clampedRank = Math.max(0, Math.min(3, Math.floor(rank)));
    const radius = pixels(4 + clampedRank);
    const rCeil = Math.ceil(radius + 1);
    const { w, h } = world.grid;
    const islandHp = Math.min(255, Math.round(80 * hpBoost));

    let displacedVoidCells = 0;
    let createdCells = 0;
    const created: { idx: number; dx: number; dy: number; d: number }[] = [];

    for (let y = Math.max(0, Math.floor(cy - rCeil)); y <= Math.min(h - 1, Math.ceil(cy + rCeil)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rCeil)); x <= Math.min(w - 1, Math.ceil(cx + rCeil)); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = dist(dx, dy);
        // Deterministic organic edge jitter independent of rank so higher ranks strictly nest lower ranks.
        const jitter = (hash01(Math.round(dx) + 1000, Math.round(dy) + 1000, world.seed) - 0.5) * 0.9;
        if (d + jitter > radius) continue;

        const idx = y * w + x;
        const mat = world.material[idx];
        if (mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED && mat !== CellMaterial.EMPTY) continue;
        if (world.landCover[idx] === LandCover.RIVER || world.landCover[idx] === LandCover.BRIDGE) continue;

        if (mat === CellMaterial.VOID) displacedVoidCells++;
        world.material[idx] = CellMaterial.RECLAIMED;
        world.buildingAt[idx] = -1;
        world.columnFloors[idx] = 0;
        world.hp[idx] = islandHp;
        world.maxHp[idx] = islandHp;
        world.landCover[idx] = LandCover.GRASS;
        world.farmScorch[idx] = 0;
        world.grid.markRadiusDirty(idx, CORRUPTION_REACH);

        createdCells++;
        created.push({ idx, dx, dy, d });
      }
    }

    if (createdCells === 0) {
      return { displacedVoidCells: 0, createdCells: 0 };
    }

    // Deterministic decorative planting on newly created cells only, with a compact margin from the edge.
    const margin = pixels(0.8);
    let plantedForest = false;
    let firstInteriorIdx = -1;
    for (const c of created) {
      const hVal = hash01(Math.round(c.dx) + 2048, Math.round(c.dy) + 2048, world.seed);
      const interior = c.d <= radius - margin;
      if (!interior) {
        if (hVal < 0.22) world.landCover[c.idx] = LandCover.MEADOW;
        continue;
      }
      if (firstInteriorIdx < 0) firstInteriorIdx = c.idx;

      if (clampedRank === 0) {
        if (hVal < 0.25) world.landCover[c.idx] = LandCover.MEADOW;
      } else if (clampedRank === 1) {
        if (hVal < 0.16) {
          world.landCover[c.idx] = LandCover.FOREST;
          plantedForest = true;
        } else if (hVal < 0.36) {
          world.landCover[c.idx] = LandCover.MEADOW;
        }
      } else if (clampedRank === 2) {
        const inFarmPatch = Math.abs(c.dx) <= pixels(1.6) && Math.abs(c.dy) <= pixels(1.2);
        if (inFarmPatch) {
          world.landCover[c.idx] = LandCover.FIELD_H;
        } else if (hVal < 0.2) {
          world.landCover[c.idx] = LandCover.FOREST;
          plantedForest = true;
        } else if (hVal < 0.38) {
          world.landCover[c.idx] = LandCover.MEADOW;
        }
      } else {
        const inFarmPatch =
          (Math.abs(c.dx) <= pixels(2.4) && Math.abs(c.dy) <= pixels(1.8)) ||
          (c.dx > pixels(0.5) && c.dx <= pixels(3.2) && c.dy >= -pixels(2.2) && c.dy <= pixels(0.4));
        if (inFarmPatch) {
          world.landCover[c.idx] = c.dy > 0 ? LandCover.FIELD_V : LandCover.FIELD_H;
        } else if (hVal < 0.26) {
          world.landCover[c.idx] = LandCover.FOREST;
          plantedForest = true;
        } else if (hVal < 0.44) {
          world.landCover[c.idx] = LandCover.MEADOW;
        }
      }
    }
    for (const c of created) {
      if (world.landCover[c.idx] === LandCover.FIELD_H || world.landCover[c.idx] === LandCover.FIELD_V) world.wheatCells.add(c.idx);
    }
    if (clampedRank >= 1 && !plantedForest && firstInteriorIdx >= 0) {
      world.landCover[firstInteriorIdx] = LandCover.FOREST;
    }

    if (this.shockwaves.length < 48) {
      this.shockwaves.push({
        x: cx,
        y: cy,
        maxRadius: radius * 1.15,
        color: "#86d96a",
        secondaryColor: "#e8c050",
        life: 0,
        maxLife: 0.55,
      });
    }

    return { displacedVoidCells, createdCells };
  }
}
