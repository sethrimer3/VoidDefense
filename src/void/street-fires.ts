/** Persistent street fires: flickering trash-can fires, debris piles and trash heaps scattered
 * through streets, alleys and lots. They are placed deterministically from the world seed,
 * never burn out on their own, and go out for good once their footprint is blasted, built
 * over or swallowed by the Void. Flicker is a pure function of time and the fire's phase,
 * so rendering stays deterministic. */

import { PARKING_STREET_TIER } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import { CellMaterial, ZoneKind } from "./model.ts";
import type { VoidWorld } from "./world.ts";

/** 0 = burning trash can, 1 = debris pile, 2 = trash heap. */
export type StreetFireKind = 0 | 1 | 2;

export type StreetFire = {
  /** Top-left world pixel of the footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: StreetFireKind;
  /** Footprint cell indices. */
  cells: number[];
  /** Flicker phase in radians, from the seed. */
  phase: number;
  alive: boolean;
};

/** Grid step between candidate fire sites, in world pixels. */
const SITE_STEP = 6;
/** Minimum spacing between fires, in world pixels. */
const MIN_SPACING = 30;
/** Fires per 10,000 world pixels of map (about 12 on the default 384x512 board). */
const DENSITY = 0.62;

function isSidewalkOrLot(world: VoidWorld, x: number, y: number): boolean {
  const { w, h } = world.grid;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
  const i = y * w + x;
  if (world.material[i] !== CellMaterial.STREET || world.zone[i] === ZoneKind.RURAL) return false;
  if (world.buildingAt[i] >= 0) return false;
  const tier = world.streetTier[i];
  if (tier === 4 || tier === PARKING_STREET_TIER) return true;
  if (tier !== 1 && tier !== 2) return false;
  // Sidewalk: within two pixels of a block edge, outside the curb line
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let k = 1; k <= 2; k++) {
      const t = world.streetTier[(y + dy * k) * w + (x + dx * k)];
      if (t !== 1 && t !== 2 && t !== 3) return true;
    }
  }
  return false;
}

/** Deterministically scatters persistent fires across the city's sidewalks, alleys and lots. */
export function placeStreetFires(world: VoidWorld): StreetFire[] {
  const { w, h } = world.grid;
  const target = Math.max(4, Math.round((w * h) / 10000 * DENSITY));
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 4; y < h - 6; y += SITE_STEP) {
    for (let x = 4; x < w - 6; x += SITE_STEP) {
      const jx = x + (hash(world.seed, 1401, x, y) % 3);
      const jy = y + (hash(world.seed, 1402, x, y) % 3);
      candidates.push({ x: jx, y: jy, score: hash01(world.seed, 1403, x, y) });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  const fires: StreetFire[] = [];
  for (const c of candidates) {
    if (fires.length >= target) break;
    const kind = (hash(world.seed, 1404, c.x, c.y) % 3) as StreetFireKind;
    const fw = kind === 0 ? 2 : 3;
    const fh = 2;
    let ok = true;
    const cells: number[] = [];
    for (let dy = -1; dy <= fh && ok; dy++) {
      for (let dx = -1; dx <= fw && ok; dx++) {
        const inside = dx >= 0 && dy >= 0 && dx < fw && dy < fh;
        const px = c.x + dx;
        const py = c.y + dy;
        if (inside) {
          if (!isSidewalkOrLot(world, px, py)) ok = false;
          else cells.push(py * w + px);
        } else if (world.buildingAt[py * w + px] >= 0 && dy === fh) {
          // Keep the flames clear of a building facade directly south (it would hide them).
          ok = false;
        }
      }
    }
    if (!ok) continue;
    if (fires.some((f) => (f.x - c.x) ** 2 + (f.y - c.y) ** 2 < MIN_SPACING ** 2)) continue;
    fires.push({
      x: c.x, y: c.y, w: fw, h: fh, kind, cells,
      phase: hash01(world.seed, 1405, c.x, c.y) * Math.PI * 2,
      alive: true,
    });
  }
  return fires;
}

/** Deterministic flame intensity `0.55..1.05` for `fire` at `time` seconds. */
export function streetFireFlicker(fire: StreetFire, time: number): number {
  const p = fire.phase;
  return 0.8 + 0.13 * Math.sin(time * 11.3 + p) + 0.08 * Math.sin(time * 23.7 + p * 2.1) +
    0.04 * Math.sin(time * 41.9 + p * 3.7);
}

export class StreetFires {
  readonly fires: StreetFire[];

  constructor(world: VoidWorld) {
    this.fires = placeStreetFires(world);
  }

  /** Puts out any fire whose footprint was blasted, cratered, built over, or consumed. */
  step(world: VoidWorld): void {
    for (const fire of this.fires) {
      if (!fire.alive) continue;
      for (const i of fire.cells) {
        if (world.material[i] !== CellMaterial.STREET || world.hp[i] < world.maxHp[i] * 0.6 || world.towerAt[i] >= 0) {
          fire.alive = false;
          for (const c of fire.cells) world.grid.markIndexDirty(c);
          break;
        }
      }
    }
  }
}
