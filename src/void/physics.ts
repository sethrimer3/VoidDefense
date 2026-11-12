import { CORRUPTION_REACH, PIXEL_AREA, pixels } from "./config.ts";
/** Destructible terrain, structural support connectivity, detached debris
 * clusters, prismatic inward debris streams, and matter restoration/reinforcement
 * for Void Defense. */

import { dist } from "../exact.ts";
import { ARCH_PALETTES, FLOORS_PER_PIXEL } from "./elevation.ts";
import { hash01, ORTHO } from "./grid.ts";
import {
  CellMaterial,
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
/** Fraction of impact damage armoured towers take. */
export const CHUNK_TOWER_DAMAGE_SCALE = 0.5;

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
};

export class VoidPhysics {
  readonly debris: DebrisFragment[] = [];
  readonly shockwaves: ShockwaveEffect[] = [];
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
  /** Support tick of the most recent large structural collapse (>= 20 columns in one tick). */
  lastLargeCollapseTick = 0;
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

  /** Converts cell `idx` into Void and queues any affected building for structural support evaluation. */
  consumeCellIntoVoid(world: VoidWorld, idx: number, spawnDebris = true): void {
    const bId = world.buildingAt[idx];
    const prevMat = world.material[idx];
    const prevCover = world.landCover[idx];
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

    if (spawnDebris && prevMat !== CellMaterial.VOID && this.debris.length < 750) {
      const x = world.grid.xOf(idx) + 0.5;
      const y = world.grid.yOf(idx) + 0.5;

      // Locate nearest active Void portal (or fall back to nearest Void neighbor)
      let portalX = x;
      let portalY = y;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const p of world.portals) {
        if (!p.active) continue;
        const d = dist(x - p.x, y - p.y);
        if (d < bestDist) {
          bestDist = d;
          portalX = p.x;
          portalY = p.y;
        }
      }

      if (!Number.isFinite(bestDist)) {
        for (const [dx, dy] of ORTHO) {
          const nx = (x | 0) + dx;
          const ny = (y | 0) + dy;
          if (world.grid.inBounds(nx, ny) && world.material[world.grid.index(nx, ny)] === CellMaterial.VOID) {
            portalX = x + dx * 4;
            portalY = y + dy * 4;
            break;
          }
        }
      }

      const dx = portalX - x;
      const dy = portalY - y;
      const d = Math.max(0.5, dist(dx, dy));
      const nx = dx / d;
      const ny = dy / d;
      // Two kinds of fragment: slow heavy slabs of the torn land (keeping its colour) and
      // fast prismatic sparks. Both swirl tangentially while being pulled inward.
      const isSlab = hash01(world.seed, 611, idx, this.debris.length) < 0.55;
      const swirl = (hash01(world.seed, 612, idx, this.debris.length) - 0.5) * (isSlab ? 5.5 : 9.5);
      const speed = pixels(isSlab ? 2.2 + hash01(world.seed, 613, idx) * 3.0 : 5.5 + hash01(world.seed, 613, idx) * 6.0);
      let color: string;
      let glow: string;
      if (isSlab) {
        const slabs = SLAB_COLORS[prevCover] ?? SLAB_URBAN[prevMat] ?? SLAB_URBAN[CellMaterial.STREET];
        color = slabs[(idx + this.debris.length) % slabs.length];
        glow = "rgba(190, 80, 255, 0.35)";
      } else {
        const palIdx =
          prevMat === CellMaterial.SKYSCRAPER
            ? (idx + this.debris.length) % 4
            : prevMat === CellMaterial.BUILDING
              ? (idx + this.debris.length) % 5
              : (idx + this.debris.length) % DEBRIS_PALETTES.length;
        color = DEBRIS_PALETTES[palIdx].color;
        glow = DEBRIS_PALETTES[palIdx].glow;
      }

      this.debris.push({
        x,
        y,
        px: x,
        py: y,
        vx: nx * speed - ny * swirl,
        vy: ny * speed + nx * swirl,
        portalX,
        portalY,
        color,
        glowColor: glow,
        size: isSlab
          ? 1.0 + hash01(world.seed, 614, idx) * 0.55
          : prevMat === CellMaterial.SKYSCRAPER
            ? 1.15
            : 0.85,
        life: 0,
        maxLife: isSlab ? Math.min(2.8, Math.max(0.9, d / 7)) : Math.min(1.45, Math.max(0.45, d / 14)),
      });
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
    const { w, h } = world.grid;
    const { material, buildingAt, hp, maxHp, columnFloors } = world;

    if (this.damagedBuildings.size > 0) {
      const keepActive: number[] = [];
      for (const bId of this.damagedBuildings) {
        const b = world.buildings[bId];
        if (!b) continue;

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
      if (columnsCollapsedThisTick >= 20) {
        this.lastLargeCollapseTick = this.supportTick;
      }
    }

    // Advance drifting debris fragments along curved streamlines into their target portal
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.px = d.x;
      d.py = d.y;
      d.life += dt;

      const dx = d.portalX - d.x;
      const dy = d.portalY - d.y;
      const distToPortal = dist(dx, dy);
      if (distToPortal > 0.6) {
        const heavy = d.size >= 1.0 && d.maxLife > 1.5;
        const pull = pixels(heavy ? 9 : 18) * dt;
        const spin = (heavy ? 3.2 : 4.5) * dt;
        d.vx += (dx / distToPortal) * pull - (dy / distToPortal) * spin;
        d.vy += (dy / distToPortal) * pull + (dx / distToPortal) * spin;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.life >= d.maxLife || distToPortal < 1.1) {
        this.debris.splice(i, 1);
      }
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

        if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED) {
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
        if (mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED) continue;
        if (world.landCover[idx] === LandCover.RIVER || world.landCover[idx] === LandCover.BRIDGE) continue;

        if (mat === CellMaterial.VOID) displacedVoidCells++;
        world.material[idx] = CellMaterial.RECLAIMED;
        world.buildingAt[idx] = -1;
        world.columnFloors[idx] = 0;
        world.hp[idx] = islandHp;
        world.maxHp[idx] = islandHp;
        world.landCover[idx] = LandCover.GRASS;
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
    for (const c of created) {
      const hVal = hash01(Math.round(c.dx) + 2048, Math.round(c.dy) + 2048, world.seed);
      const interior = c.d <= radius - margin;
      if (!interior) {
        if (hVal < 0.22) world.landCover[c.idx] = LandCover.MEADOW;
        continue;
      }

      if (clampedRank === 0) {
        if (hVal < 0.25) world.landCover[c.idx] = LandCover.MEADOW;
      } else if (clampedRank === 1) {
        if (hVal < 0.16) world.landCover[c.idx] = LandCover.FOREST;
        else if (hVal < 0.36) world.landCover[c.idx] = LandCover.MEADOW;
      } else if (clampedRank === 2) {
        const inFarmPatch = Math.abs(c.dx) <= pixels(1.6) && Math.abs(c.dy) <= pixels(1.2);
        if (inFarmPatch) {
          world.landCover[c.idx] = LandCover.FIELD_H;
        } else if (hVal < 0.2) {
          world.landCover[c.idx] = LandCover.FOREST;
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
        } else if (hVal < 0.44) {
          world.landCover[c.idx] = LandCover.MEADOW;
        }
      }
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
