/** Living, moving Void interior animation using recolored, pixelated Star Nest fractal math.
 *
 * Adapted from the Star Nest volumetric fractal (Pablo Roman Andrioli, 2013; Sign99 starNestBackground.ts),
 * converted into a discrete, pixelated 2D torus-tiled field and recolored for Void Defense:
 * 1. Precomputed volumetric fractal intensity tile with 11 iterations & 8 raymarch steps.
 * 2. Recolored along a cosmic Void spectrum: deep indigo/violet nebula floor, hot magenta dust filaments,
 *    and brilliant cyan/white stars at peak fractal ridges.
 * 3. Dynamic accretion flow: continuous rotational warping and gravitational drift sampled strictly
 *    within CellMaterial.VOID cells behind exposed ledges and outside the pure black hole core.
 * 4. Preserves 1 simulation cell = 1 world pixel discrete art, reduced-motion stability,
 *    and complete simulation isolation.
 */
import { hash, hash01 } from "./grid.ts";
import { CellMaterial, type VoidRipple } from "./model.ts";
import type { VoidWorld } from "./world.ts";

export type VoidInteriorWorld = Pick<VoidWorld, "grid" | "seed" | "material" | "portals">;

export type WispPixel = {
  x: number;
  y: number;
  color: string;
};

export const STARNEST_TILE_SIZE = 96;

/** Star Nest volumetric fractal tile generator.
 * Computes a toroidal 96x96 grayscale intensity field matching the Sign99 Star Nest formula.
 */
export function generateStarNestTile(): Float32Array {
  const TILE = STARNEST_TILE_SIZE;
  const tile = new Float32Array(TILE * TILE);
  const iter = 11;
  const volsteps = 8;
  const a1 = 0.45, a2 = 0.75;
  const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
  const cos2 = Math.cos(a2), sin2 = Math.sin(a2);

  for (let y = 0; y < TILE; y++) {
    const uvY = (y / TILE - 0.5);
    for (let x = 0; x < TILE; x++) {
      const uvX = (x / TILE - 0.5);
      let s = 0.1;
      let fade = 1.0;
      let vr = 0, vg = 0, vb = 0;

      for (let r = 0; r < volsteps; r++) {
        let dx = uvX * 2.5;
        let dy = uvY * 2.5;
        let dz = 1.0;

        // Static view rotation rot1 (xz) & rot2 (xy) from Sign99
        const rx = cos1 * dx - sin1 * dz;
        const rz = sin1 * dx + cos1 * dz;
        dx = rx; dz = rz;
        const rrx = cos2 * dx - sin2 * dy;
        const rry = sin2 * dx + cos2 * dy;
        dx = rrx; dy = rry;

        let px = 1.0 + s * dx * 0.5;
        let py = 0.5 + s * dy * 0.5;
        let pz = 0.5 + s * dz * 0.5;

        // Space folding
        px = Math.abs(0.85 - ((px % 1.7 + 1.7) % 1.7));
        py = Math.abs(0.85 - ((py % 1.7 + 1.7) % 1.7));
        pz = Math.abs(0.85 - ((pz % 1.7 + 1.7) % 1.7));

        let pa = 0;
        let a = 0;
        for (let i = 0; i < iter; i++) {
          const dot = px * px + py * py + pz * pz;
          px = Math.abs(px) / dot - 0.53;
          py = Math.abs(py) / dot - 0.53;
          pz = Math.abs(pz) / dot - 0.53;
          const len = Math.hypot(px, py, pz);
          a += Math.abs(len - pa);
          pa = len;
        }

        const dm = Math.max(0, 0.3 - a * a * 0.001);
        a *= a * a;
        if (r > 6) fade *= (1.0 - dm);

        const bright = a * 0.0015 * fade;
        vr += fade + s * bright;
        vg += fade + (s * s) * bright;
        vb += fade + (s * s * s * s) * bright;
        fade *= 0.73;
        s += 0.1;
      }

      const totalLen = Math.hypot(vr, vg, vb) * 0.01;
      // Normalized intensity in [0, 1]
      tile[y * TILE + x] = Math.min(1, Math.max(0, (totalLen - 0.06) / 0.35));
    }
  }

  return tile;
}

let cachedStarNest: Float32Array | null = null;
export function starNestTile(): Float32Array {
  if (!cachedStarNest) {
    cachedStarNest = generateStarNestTile();
  }
  return cachedStarNest;
}

/** Samples the toroidal Star Nest tile at continuous (u, v) in [0..1). */
export function sampleStarNest(u: number, v: number): number {
  const tile = starNestTile();
  const TILE = STARNEST_TILE_SIZE;
  const x = Math.floor((u % 1 + 1) % 1 * TILE);
  const y = Math.floor((v % 1 + 1) % 1 * TILE);
  return tile[y * TILE + x];
}

/** Recolors a Star Nest fractal intensity into Void Defense's cosmic spectrum:
 * - Low-mid: calm deep indigo & violet nebula floor
 * - High: subtle plum & magenta filaments
 * - Peak: restrained violet-cyan dust at peak fractal ridges
 */
export function starNestColor(intensity: number, jitter = 0): string {
  if (intensity > 0.88) {
    return jitter % 3 === 0 ? "#88d8e8" : "#b84fd9";
  }
  if (intensity > 0.68) {
    return jitter % 2 === 0 ? "#7d2eb8" : "#622296";
  }
  if (intensity > 0.45) {
    return jitter % 3 === 0 ? "#4c1c78" : "#3a145e";
  }
  if (intensity > 0.24) {
    return jitter % 2 === 0 ? "#280f45" : "#1f0b38";
  }
  return "#150726";
}

/** Pre-computed seeded spiral wisp parameters for each portal (kept for compatibility). */
export interface SeededWisp {
  id: number;
  portalId: number;
  initialRadiusFrac: number;
  armAngleOffset: number;
  speed: number;
  spiralTightness: number;
  colorOffset: number;
  length: number;
}

export function generateWispsForPortals(world: VoidInteriorWorld): SeededWisp[] {
  const wisps: SeededWisp[] = [];
  let wispId = 0;
  for (const portal of world.portals) {
    if (!portal.active) continue;
    const count = 36;
    for (let k = 0; k < count; k++) {
      const initialRadiusFrac = 0.25 + hash01(world.seed, 1401, portal.id, k) * 0.75;
      const armAngleOffset = hash01(world.seed, 1402, portal.id, k) * Math.PI * 2;
      const speed = 0.12 + hash01(world.seed, 1403, portal.id, k) * 0.28;
      const spiralTightness = 2.4 + hash01(world.seed, 1404, portal.id, k) * 1.8;
      const colorOffset = hash(world.seed, 1405, portal.id, k) % 3;
      const length = 3 + hash(world.seed, 1406, portal.id, k) % 4;
      wisps.push({
        id: wispId++,
        portalId: portal.id,
        initialRadiusFrac,
        armAngleOffset,
        speed,
        spiralTightness,
        colorOffset,
        length,
      });
    }
  }
  return wisps;
}

/** Computes the living Void interior pixels using pixelated Star Nest fractal sampling.
 * All pixels are clamped strictly inside CellMaterial.VOID, outside black-hole cores.
 */
export function computeVoidInterior(
  world: VoidInteriorWorld,
  wisps: readonly SeededWisp[],
  animTime: number,
  reduceEffects = false,
): WispPixel[] {
  if (reduceEffects) {
    return [];
  }

  const { w, h } = world.grid;
  const pixels: WispPixel[] = [];
  const occupied = new Set<number>();

  for (const p of world.portals) {
    if (!p.active) continue;
    const coreR = Math.max(3.6, p.radius * 0.42);
    const maxReach = p.radius * 2.8;

    // Scan bounding box of the active portal's reach inside Void
    const xMin = Math.max(0, Math.floor(p.x - maxReach));
    const xMax = Math.min(w - 1, Math.ceil(p.x + maxReach));
    const yMin = Math.max(0, Math.floor(p.y - maxReach));
    const yMax = Math.min(h - 1, Math.ceil(p.y + maxReach));

    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        const idx = py * w + px;
        if (world.material[idx] !== CellMaterial.VOID) continue;
        if (occupied.has(idx)) continue;

        const dx = px - p.x;
        const dy = py - p.y;
        const r = Math.hypot(dx, dy);
        if (r <= coreR + 1.8 || r >= maxReach) continue;

        const theta = Math.atan2(dy, dx);

        // Star Nest coordinates: map radial/polar space with subtle gravitational swirl
        const swirlAngle = theta + animTime * (0.65 / (1.0 + r * 0.15));
        const logR = Math.log(r + 1.0);

        // Torus UV mapped across Star Nest volumetric fractal
        const u = ((swirlAngle / (Math.PI * 2)) * 2.0 + logR * 0.4 + animTime * 0.03) % 1;
        const v = (r * 0.05 - animTime * 0.025) % 1;

        const intensity = sampleStarNest(u, v);

        // Only render coherent nebula filaments (calm hierarchy, never noisy confetti)
        if (intensity > 0.48) {
          const jitter = (px * 7 + py * 13) & 15;
          const color = starNestColor(intensity, jitter);
          occupied.add(idx);
          pixels.push({ x: px, y: py, color });
        }
      }
    }
  }

  return pixels;
}

/** Painter interface matching paintVoidLedge */
type Painter = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect">;

/** Paints the computed Void interior wisps into the target canvas.
 * Strict 1x1 whole integer world pixels.
 */
export function paintVoidInterior(c: Painter, wisps: readonly WispPixel[]): void {
  for (const p of wisps) {
    c.fillStyle = p.color;
    c.fillRect(p.x, p.y, 1, 1);
  }
}

/** Paints brief whole-pixel brightness ripples in Void cells where large falling chunks vanish. */
export function paintVoidRipples(
  c: Painter,
  world: VoidInteriorWorld,
  ripples: readonly VoidRipple[],
  reduceEffects = false,
): void {
  if (reduceEffects) return;
  const { w, h } = world.grid;
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    if (!r.active) continue;
    const t = r.age / Math.max(0.01, r.maxAge);
    const rad = Math.max(1, Math.floor(1 + t * 4));
    c.fillStyle = t < 0.4 ? "#7afcff" : "#ff5ee8";
    const ox = [rad, -rad, 0, 0];
    const oy = [0, 0, rad, -rad];
    for (let k = 0; k < 4; k++) {
      const px = r.x + ox[k];
      const py = r.y + oy[k];
      if (px >= 0 && px < w && py >= 0 && py < h && world.material[py * w + px] === CellMaterial.VOID) {
        c.fillRect(px, py, 1, 1);
      }
    }
  }
}


