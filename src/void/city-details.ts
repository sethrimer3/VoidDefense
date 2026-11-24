/** Procedural pixel-art street furniture and halogen street lights for the city. Everything here is a
 * pure, cached function of the generated world (seed + layout), so the city dresses itself the same
 * way on every run and every Node version:
 * - Zebra crosswalks across each street mouth, continuing the cross street's sidewalk band.
 * - Manhole covers and oil stains on the carriageway, drain grates at the curb.
 * - Benches, planters, hydrants and vending boxes on sidewalks, dumpsters in alleys and lots.
 * - Occasional warm halogen (sodium) street lamps on sidewalks, distinct from the cool median lights.
 * Details are visual only and never change pathing, value or simulation. */

import { PARKING_STREET_TIER } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import { isBoulevardOrAvenueLaneAt } from "./lighting.ts";
import { CellMaterial, ZoneKind } from "./model.ts";
import type { VoidWorld } from "./world.ts";

export const CityDetail = {
  NONE: 0,
  CROSSWALK: 1,
  MANHOLE_RIM: 2,
  MANHOLE_CORE: 3,
  OIL_STAIN: 4,
  DRAIN: 5,
  BENCH: 6,
  BENCH_SHADE: 7,
  PLANTER_LEAF: 8,
  PLANTER_LEAF_DARK: 9,
  HYDRANT: 10,
  VENDING_RED: 11,
  VENDING_BLUE: 12,
  DUMPSTER: 13,
  DUMPSTER_LID: 14,
  LAMP_BASE: 15,
} as const;

/** Flat ground colours for each detail code (lit by the normal terrain lighting). */
export const CITY_DETAIL_COLORS: readonly string[] = [
  "",
  "#59606b", // crosswalk stripe (worn paint)
  "#4b525c", // manhole rim
  "#2b3038", // manhole centre
  "#11151b", // oil stain
  "#1b2027", // drain grate
  "#7a5536", // bench slats
  "#4e3624", // bench shadow side
  "#3f7a45", // planter leaves
  "#2a5631", // planter leaves, dark
  "#c0392b", // hydrant
  "#a8323a", // red vending box
  "#2f5f9e", // blue vending box
  "#2e5a3e", // dumpster body
  "#3d7350", // dumpster lid
  "#2a2f36", // halogen lamp base
];

export type HalogenLamp = {
  x: number;
  y: number;
  /** Direction the lamp arm reaches, toward the road (-1, 0 or 1 per axis). */
  ax: number;
  ay: number;
};

type DetailCache = { codes: Uint8Array; lamps: HalogenLamp[]; lampAt: Set<number>; poolAt: Set<number> };
const cache = new WeakMap<VoidWorld, DetailCache>();

function isCorridor(world: VoidWorld, x: number, y: number): boolean {
  const { w, h } = world.grid;
  if (x < 0 || y < 0 || x >= w || y >= h) return true;
  const t = world.streetTier[y * w + x];
  return t === 1 || t === 2 || t === 3;
}

function isUrbanStreet(world: VoidWorld, i: number): boolean {
  return world.material[i] === CellMaterial.STREET && world.zone[i] !== ZoneKind.RURAL && world.buildingAt[i] < 0;
}

/** Distance (1..3) from street pixel `(x, y)` to the nearest block edge along an axis, or 0. */
function blockDistance(world: VoidWorld, x: number, y: number): { d: number; dx: number; dy: number } {
  for (let k = 1; k <= 3; k++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!isCorridor(world, x + dx * k, y + dy * k)) return { d: k, dx, dy };
    }
  }
  return { d: 0, dx: 0, dy: 0 };
}

function build(world: VoidWorld): DetailCache {
  const { w, h, count } = world.grid;
  const seed = world.seed;
  const codes = new Uint8Array(count);
  const line = new Uint8Array(count);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (isBoulevardOrAvenueLaneAt(world, x, y)) line[y * w + x] = 1;
  }
  const isLine = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && line[y * w + x] === 1;
  const put = (x: number, y: number, code: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (!isUrbanStreet(world, i) || line[i]) return;
    codes[i] = code;
  };
  const free = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return isUrbanStreet(world, i) && !line[i] && codes[i] === 0;
  };

  // 1. Zebra crosswalks just past each end of a curb line, spanning to the matching line opposite.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!line[y * w + x]) continue;
      const vertical = isLine(x, y - 1) || isLine(x, y + 1);
      if (vertical) {
        for (const end of [1, -1]) {
          if (!isLine(x, y - end) || isLine(x, y + end)) continue;
          for (let x2 = x + 4; x2 <= x + 22 && x2 < w; x2++) {
            if (!isLine(x2, y) || isLine(x2, y + end) || !isLine(x2, y - end)) continue;
            // The crossing continues the cross street's sidewalk band (1..2 px past the block corner).
            for (let r = 1; r <= 2; r++) {
              for (let cx = x + 1; cx < x2; cx++) if ((cx & 1) === 0) put(cx, y + end * r, CityDetail.CROSSWALK);
            }
            break;
          }
        }
      } else {
        for (const end of [1, -1]) {
          if (!isLine(x - end, y) || isLine(x + end, y)) continue;
          for (let y2 = y + 4; y2 <= y + 24 && y2 < h; y2++) {
            if (!isLine(x, y2) || isLine(x + end, y2) || !isLine(x - end, y2)) continue;
            for (let r = 1; r <= 2; r++) {
              for (let cy = y + 1; cy < y2; cy++) if ((cy & 1) === 0) put(x + end * r, cy, CityDetail.CROSSWALK);
            }
            break;
          }
        }
      }
    }
  }

  // 2. Street furniture on a coarse seeded lattice so items never crowd each other.
  for (let y = 2; y < h - 3; y += 3) {
    for (let x = 2; x < w - 3; x += 3) {
      const jx = x + (hash(seed, 1601, x, y) % 3);
      const jy = y + (hash(seed, 1602, x, y) % 3);
      const i = jy * w + jx;
      if (!free(jx, jy)) continue;
      const tier = world.streetTier[i];
      const roll = hash01(seed, 1603, jx, jy);
      const kind = hash(seed, 1604, jx, jy);
      if (tier === 4 || tier === PARKING_STREET_TIER) {
        // Alleys and lots: occasional dumpsters and stains
        if (roll < 0.035 && free(jx + 1, jy) && free(jx + 2, jy) && free(jx, jy + 1) && free(jx + 1, jy + 1) && free(jx + 2, jy + 1)) {
          for (let dx = 0; dx < 3; dx++) { put(jx + dx, jy, CityDetail.DUMPSTER_LID); put(jx + dx, jy + 1, CityDetail.DUMPSTER); }
        } else if (roll < 0.08) {
          put(jx, jy, CityDetail.OIL_STAIN);
        }
        continue;
      }
      if (tier !== 1 && tier !== 2) continue;
      const bd = blockDistance(world, jx, jy);
      if (bd.d === 1 || bd.d === 2) {
        // Sidewalk furniture, laid along the street direction
        const alongX = bd.dy !== 0;
        if (roll < 0.05) {
          const x2 = jx + (alongX ? 1 : 0);
          const y2 = jy + (alongX ? 0 : 1);
          if (free(x2, y2)) { put(jx, jy, CityDetail.BENCH); put(x2, y2, CityDetail.BENCH_SHADE); }
        } else if (roll < 0.095) {
          const x2 = jx + (alongX ? 1 : 0);
          const y2 = jy + (alongX ? 0 : 1);
          if (free(x2, y2)) {
            put(jx, jy, (kind & 1) ? CityDetail.PLANTER_LEAF : CityDetail.PLANTER_LEAF_DARK);
            put(x2, y2, (kind & 1) ? CityDetail.PLANTER_LEAF_DARK : CityDetail.PLANTER_LEAF);
          }
        } else if (roll < 0.11) {
          put(jx, jy, CityDetail.HYDRANT);
        } else if (roll < 0.13) {
          put(jx, jy, (kind & 2) ? CityDetail.VENDING_RED : CityDetail.VENDING_BLUE);
        }
      } else if (bd.d === 0 || bd.d >= 3) {
        // Carriageway: manholes, stains, and drain grates beside the curb line
        const nearLine = isLine(jx - 1, jy) || isLine(jx + 1, jy) || isLine(jx, jy - 1) || isLine(jx, jy + 1);
        if (nearLine && roll < 0.06) {
          put(jx, jy, CityDetail.DRAIN);
        } else if (!nearLine && roll < 0.022 && free(jx + 1, jy) && free(jx, jy + 1) && free(jx + 1, jy + 1)) {
          put(jx, jy, CityDetail.MANHOLE_RIM); put(jx + 1, jy, CityDetail.MANHOLE_RIM);
          put(jx, jy + 1, CityDetail.MANHOLE_RIM); put(jx + 1, jy + 1, CityDetail.MANHOLE_CORE);
        } else if (roll < 0.05) {
          put(jx, jy, CityDetail.OIL_STAIN);
        }
      }
    }
  }

  // 3. Occasional halogen lamps on the sidewalk next to the curb line, arm reaching over the road.
  const candidates: { x: number; y: number; ax: number; ay: number; score: number }[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (!line[y * w + x]) continue;
      // Sidewalk pixel between this curb line pixel and the block
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (isCorridor(world, x + dx * 3, y + dy * 3)) continue;
        const sx = x + dx;
        const sy = y + dy;
        if (!free(sx, sy)) continue;
        candidates.push({ x: sx, y: sy, ax: -dx, ay: -dy, score: hash01(seed, 1701, sx, sy) });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  const target = Math.round((w * h) / 4200);
  const lamps: HalogenLamp[] = [];
  const lampAt = new Set<number>();
  const poolAt = new Set<number>();
  for (const c of candidates) {
    if (lamps.length >= target) break;
    if (lamps.some((l) => (l.x - c.x) ** 2 + (l.y - c.y) ** 2 < 30 * 30)) continue;
    // Skip spots where a building to the south would stand in front of the pole.
    let hidden = false;
    for (let k = 1; k <= 22 && !hidden; k++) {
      for (let ox = -1; ox <= 1; ox++) {
        const px = c.x + ox;
        const py = c.y + k;
        if (px < 0 || px >= w || py >= h) continue;
        if (world.buildingAt[py * w + px] >= 0) { hidden = true; break; }
      }
    }
    if (hidden) continue;
    lamps.push({ x: c.x, y: c.y, ax: c.ax, ay: c.ay });
    lampAt.add(c.y * w + c.x);
    const pool = halogenPoolCell(c);
    poolAt.add(pool.y * w + pool.x);
    codes[c.y * w + c.x] = CityDetail.LAMP_BASE;
  }
  return { codes, lamps, lampAt, poolAt };
}

function get(world: VoidWorld): DetailCache {
  let c = cache.get(world);
  if (!c) {
    c = build(world);
    cache.set(world, c);
  }
  return c;
}

/** Detail code (`CityDetail`) painted on ground cell `idx`, or `0`. */
export function cityDetailAt(world: VoidWorld, idx: number): number {
  return get(world).codes[idx];
}

/** All halogen street lamps for `world`. */
export function halogenLamps(world: VoidWorld): readonly HalogenLamp[] {
  return get(world).lamps;
}

/** True when a halogen lamp stands on cell `(x, y)`. */
export function isHalogenLampAt(world: VoidWorld, x: number, y: number): boolean {
  return get(world).lampAt.has(y * world.grid.w + x);
}

/** True while lamp `l` still stands (its cell is intact street). */
export function halogenLampStanding(world: VoidWorld, l: HalogenLamp): boolean {
  const i = l.y * world.grid.w + l.x;
  return world.material[i] === CellMaterial.STREET && world.hp[i] >= world.maxHp[i] * 0.6 && world.towerAt[i] < 0;
}

/** Ground cell under the lamp head, where its warm pool of light centres. */
export function halogenPoolCell(l: HalogenLamp): { x: number; y: number } {
  return { x: l.x + l.ax * 2, y: l.y + l.ay * 2 };
}

/** True when `(x, y)` is the centre of a halogen lamp's light pool (seeds the warm halo). */
export function isHalogenPoolAt(world: VoidWorld, x: number, y: number): boolean {
  return get(world).poolAt.has(y * world.grid.w + x);
}
