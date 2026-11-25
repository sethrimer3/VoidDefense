/** Soft, clean street lighting for the city's boulevards and avenues, cached per world and purely
 * seeded so it looks the same on every run and every Node version:
 * - Curb lights: small cool inset light dots spaced along each curb line (`isBoulevardOrAvenueLaneAt`),
 *   with a barely-there seam between them, instead of a solid painted line.
 * - Intersection rings: a faint ring of cool light set into the middle of every major intersection
 *   (one that a boulevard runs through), plus a gentle glow on the crosswalks around it.
 * Visual only: nothing here changes pathing, value or simulation. */

import { CellMaterial } from "./model.ts";
import { isBoulevardOrAvenueLaneAt } from "./lighting.ts";
import type { VoidWorld } from "./world.ts";

export const StreetGlow = {
  NONE: 0,
  /** Curb line pixel between lights: a faint seam that keeps the road edge readable. */
  CURB_SEAM: 1,
  /** Inset curb light dot. */
  CURB_LIGHT: 2,
  /** Pixel of a major intersection's light ring. */
  RING: 3,
} as const;

/** Pixels between curb light dots along a curb line. */
export const CURB_LIGHT_SPACING = 8;

/** Flat ground colours for each glow code (lit and brightened by the night lighting). */
export const STREET_GLOW_COLORS: readonly string[] = [
  "",
  "#1d242d", // curb seam
  "#cdeffa", // curb light dot
  "#2c4a58", // intersection ring
];

/** Cool tint of the glow that curb lights and rings spill onto the street (linear RGB weights). */
export const STREET_GLOW_TINT: readonly [number, number, number] = [0.42, 0.78, 1];

type GlowCache = { codes: Uint8Array; spill: Uint8Array };
const cache = new WeakMap<VoidWorld, GlowCache>();

/** Corridor runs at least this long on both axes mark an intersection (wider than any single street). */
const INTERSECTION_RUN = 26;

function isCorridorTier(t: number): boolean {
  return t === 1 || t === 2 || t === 3;
}

function build(world: VoidWorld): GlowCache {
  const { w, h, count } = world.grid;
  const codes = new Uint8Array(count);
  const spill = new Uint8Array(count);

  // 1. Curb lights every CURB_LIGHT_SPACING px along each curb line; `x + y` steps one per pixel
  //    along both horizontal and vertical lines, so spacing is even either way.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBoulevardOrAvenueLaneAt(world, x, y)) continue;
      codes[y * w + x] = (x + y) % CURB_LIGHT_SPACING === 0 ? StreetGlow.CURB_LIGHT : StreetGlow.CURB_SEAM;
    }
  }

  // 2. Intersections: corridor pixels whose contiguous corridor run is long on both axes.
  const hRun = new Uint16Array(count);
  const vRun = new Uint16Array(count);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!isCorridorTier(world.streetTier[y * w + x])) { x++; continue; }
      let e = x;
      while (e < w && isCorridorTier(world.streetTier[y * w + e])) e++;
      for (let k = x; k < e; k++) hRun[y * w + k] = Math.min(65535, e - x);
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!isCorridorTier(world.streetTier[y * w + x])) { y++; continue; }
      let e = y;
      while (e < h && isCorridorTier(world.streetTier[e * w + x])) e++;
      for (let k = y; k < e; k++) vRun[k * w + x] = Math.min(65535, e - y);
      y = e;
    }
  }
  const inX = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (hRun[i] >= INTERSECTION_RUN && vRun[i] >= INTERSECTION_RUN) inX[i] = 1;
  }

  // 3. One ring per major intersection, centred in its box (flood-filled components).
  const seen = new Uint8Array(count);
  const stack: number[] = [];
  for (let start = 0; start < count; start++) {
    if (!inX[start] || seen[start]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, major = false;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const t = world.streetTier[i];
      if (t === 1 || t === 3) major = true;
      if (x > 0 && inX[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x + 1 < w && inX[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && inX[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y + 1 < h && inX[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (!major || bw < 10 || bh < 10) continue;
    // Integer ring centred in the box: whole pixels at a squared radius band, no anti-aliasing.
    const cx2 = x0 + x1; // doubled centre keeps half-pixel centres exact
    const cy2 = y0 + y1;
    const r = Math.floor(Math.min(bw, bh) * 0.3);
    const rIn2 = (2 * r - 1) * (2 * r - 1);
    const rOut2 = (2 * r + 1) * (2 * r + 1);
    const halo2 = (2 * r + 5) * (2 * r + 5);
    const haloIn2 = Math.max(0, (2 * r - 5) * (2 * r - 5));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!inX[i] || world.streetTier[i] === 3) continue;
        const dx = 2 * x + 1 - cx2 - 1;
        const dy = 2 * y + 1 - cy2 - 1;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rIn2 && d2 <= rOut2) {
          if (codes[i] === 0) codes[i] = StreetGlow.RING;
          spill[i] = Math.max(spill[i], 2);
        } else if (d2 >= haloIn2 && d2 <= halo2) {
          spill[i] = Math.max(spill[i], 1);
        }
      }
    }
  }

  // 4. Curb lights spill a short soft falloff onto the road and sidewalk beside them.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (codes[y * w + x] !== StreetGlow.CURB_LIGHT) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          const level = d === 0 ? 3 : d === 1 ? 2 : d === 2 ? 1 : 0;
          const j = ny * w + nx;
          if (level > spill[j]) spill[j] = level;
        }
      }
    }
  }
  return { codes, spill };
}

function get(world: VoidWorld): GlowCache {
  let c = cache.get(world);
  if (!c) {
    c = build(world);
    cache.set(world, c);
  }
  return c;
}

/** Street glow code (`StreetGlow`) at cell `idx`; 0 once the street there is gone. */
export function streetGlowAt(world: VoidWorld, idx: number): number {
  if (world.material[idx] !== CellMaterial.STREET) return 0;
  return get(world).codes[idx];
}

/** Soft glow level (0..3) that curb lights and intersection rings cast on street cell `idx`. */
export function streetGlowSpillAt(world: VoidWorld, idx: number): number {
  if (world.material[idx] !== CellMaterial.STREET) return 0;
  return get(world).spill[idx];
}

/** Street glow code the layout gave cell `idx`, even after the street there is gone (for debris colours). */
export function streetGlowLayoutAt(world: VoidWorld, idx: number): number {
  return get(world).codes[idx];
}
