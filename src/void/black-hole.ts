/** Pixel-art black hole drawn over each active Void portal.
 *
 * Built per frame into a small `ImageData` sprite at whole-pixel scale (no anti-aliased strokes):
 * 1. A lightless core with a faint red-shifted inner rim, so it reads as a hole rather than a flat disc.
 * 2. A photon ring, two pixels thick on the Doppler-beamed side (white-gold) and one pixel on the far side
 *    (deep violet), with a few hot knots orbiting it.
 * 3. A lensed glow just outside the ring that is thick on the beamed side and thins to nothing on the other.
 * 4. Broken Einstein-ring arcs further out that drift against the orbit and shimmer like warped light.
 * 5. The reservoir gauge, a dotted, segmented ring inside the core: lit dots are the Void energy left.
 */

import { hash01 } from "./grid.ts";

/** Photon ring ramp from the dim far side to the beamed near side. */
const RING_RAMP: readonly (readonly [number, number, number])[] = [
  [58, 20, 96],
  [116, 46, 182],
  [196, 92, 226],
  [255, 150, 196],
  [255, 214, 168],
  [255, 246, 228],
];

/** Direction (radians) of the beamed, brightest side of the ring: upper left, toward the scene's key light. */
const BEAM_ANGLE = -2.35;
const GAUGE_SEGMENTS = 12;
const MARGIN = 6;

export type BlackHoleSpec = {
  x: number;
  y: number;
  coreR: number;
  /** Reservoir energy left, `0..1`. */
  energy: number;
  animTime: number;
  /** Stable per-portal seed so neighbouring holes don't shimmer in lockstep. */
  seed: number;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let image: ImageData | null = null;
let scratch = new Uint32Array(0);

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
function pack(r: number, g: number, b: number, a: number): number {
  return IS_LITTLE_ENDIAN
    ? (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0
    : (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

function ramp(level: number, alpha: number): number {
  const i = Math.max(0, Math.min(RING_RAMP.length - 1, level));
  const c = RING_RAMP[i];
  return pack(c[0], c[1], c[2], alpha);
}

/** Fills `out` (side x side, row-major ABGR) with the black hole sprite centred on pixel `(side >> 1)`.
 * Pure and deterministic, so it can be checked without a canvas. */
export function paintBlackHolePixels(out: Uint32Array, side: number, spec: BlackHoleSpec): void {
  const R = spec.coreR;
  const c = side >> 1;
  const t = spec.animTime;
  const gaugeR = R - 2.2;
  const showGauge = R >= 4.5;
  const energy = Math.max(0, Math.min(1, spec.energy));
  const gaugeLit = energy > 0.25 ? pack(150, 128, 206, 255) : pack(236, 132, 92, 255);
  const gaugeDim = pack(30, 14, 42, 255);
  // Three hot knots orbit the ring; the lens arcs drift slowly the other way
  const knotA = t * 1.9 + spec.seed;
  const arcPhase = -t * 0.55 + spec.seed * 0.37;
  const breathe = 0.92 + 0.08 * Math.sin(t * 2.1 + spec.seed);

  for (let py = 0; py < side; py++) {
    const dy = py - c;
    for (let px = 0; px < side; px++) {
      const dx = px - c;
      const i = py * side + px;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R + 4.6) {
        out[i] = 0;
        continue;
      }
      const a = Math.atan2(dy, dx);

      if (d < R - 0.4) {
        // Core: pure black with a faint red-shifted rim, and the segmented reservoir gauge
        if (showGauge && Math.abs(d - gaugeR) < 0.5 && ((px + py) & 1) === 0) {
          const f = (((a + Math.PI / 2) / (Math.PI * 2)) % 1 + 1) % 1;
          const seg = f * GAUGE_SEGMENTS;
          if (seg - Math.floor(seg) > 0.8) {
            out[i] = pack(0, 0, 0, 255);
          } else {
            out[i] = f < energy ? gaugeLit : gaugeDim;
          }
        } else if (d >= R - 1.4) {
          out[i] = pack(22, 6, 30, 255);
        } else {
          out[i] = pack(0, 0, 0, 255);
        }
        continue;
      }

      // Doppler beaming: 1 on the near side, 0 on the far side
      const beam = 0.5 + 0.5 * Math.cos(a - BEAM_ANGLE);
      let knot = 0;
      for (let k = 0; k < 3; k++) {
        const ck = Math.cos(a - knotA - k * 2.09);
        if (ck > 0.93) knot = Math.max(knot, (ck - 0.93) / 0.07);
      }

      const ringOuter = R + 0.6 + (beam > 0.55 ? 0.9 : 0);
      if (d < ringOuter) {
        // Photon ring: one crisp pixel ring, beamed and studded with orbiting hot knots
        const lvl = Math.round((0.38 + beam * 0.5 + knot * 0.4) * breathe * (RING_RAMP.length - 1));
        out[i] = ramp(lvl, 255);
      } else if (d < ringOuter + 1.1) {
        // Lensed glow: thick on the beamed side, gone on the far side
        const g = beam * breathe + knot * 0.3;
        out[i] = g > 0.72 ? ramp(Math.round(g * 3.2), 210) : g > 0.3 ? ramp(1, 120) : 0;
      } else if (d > R + 2.7 && d < R + 3.7) {
        // Broken Einstein-ring arcs, drifting against the orbit like warped light
        const arc = Math.sin(a * 3 + arcPhase) + 0.6 * Math.sin(a * 5 - arcPhase * 1.7);
        const flicker = hash01(px, py, spec.seed, Math.floor(t * 6)) < 0.85;
        out[i] = arc > 0.75 && flicker ? ramp(beam > 0.5 ? 2 : 1, beam > 0.5 ? 170 : 110) : 0;
      } else {
        out[i] = 0;
      }
    }
  }
}

/** Draws the black hole sprite for one active portal onto the world-resolution scene at whole pixels. */
export function drawBlackHole(target: CanvasRenderingContext2D, spec: BlackHoleSpec): void {
  if (typeof document === "undefined") return;
  const side = 2 * (Math.ceil(spec.coreR) + MARGIN) + 1;
  if (!canvas) {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }
  if (!ctx) return;
  if (!image || image.width < side) {
    canvas.width = side;
    canvas.height = side;
    image = ctx.createImageData(side, side);
  }
  const buf = new Uint32Array(image.data.buffer);
  if (scratch.length < side * side) scratch = new Uint32Array(side * side);
  const sub = scratch;
  paintBlackHolePixels(sub, side, spec);
  const stride = image.width;
  buf.fill(0);
  for (let y = 0; y < side; y++) buf.set(sub.subarray(y * side, (y + 1) * side), y * stride);
  ctx.putImageData(image, 0, 0, 0, 0, side, side);
  const x0 = Math.floor(spec.x) - (side >> 1);
  const y0 = Math.floor(spec.y) - (side >> 1);
  const prev = target.imageSmoothingEnabled;
  target.imageSmoothingEnabled = false;
  target.drawImage(canvas, 0, 0, side, side, x0, y0, side, side);
  target.imageSmoothingEnabled = prev;
}
