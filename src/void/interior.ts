/** Living, moving Void interior animation.
 *
 * Preserves the current nebula artwork while adding:
 * 1. Lightweight inward-flowing logarithmic spiral wisps.
 * 2. Subtle traveling color/brightness bands.
 * 3. Seeded particles with bounded lifetime and smooth radial acceleration toward portals.
 *
 * Rendered exclusively within CellMaterial.VOID cells and strictly behind exposed
 * earth/rock ledges, preserving the ground's stability and black-hole core readability.
 *
 * All rasterization produces whole world pixels (1 simulation cell = 1 world pixel).
 */
import { hash, hash01 } from "./grid.ts";
import { CellMaterial } from "./model.ts";
import type { VoidWorld } from "./world.ts";

export type VoidInteriorWorld = Pick<VoidWorld, "grid" | "seed" | "material" | "portals">;

export type WispPixel = {
  x: number;
  y: number;
  color: string;
};

// Smooth cubic Hermite interpolation
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// 2D smooth value noise with continuous spatial coordinates
function fluidNoise2D(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  const h00 = hash01(1337, x0, y0);
  const h10 = hash01(1337, x0 + 1, y0);
  const h01 = hash01(1337, x0, y0 + 1);
  const h11 = hash01(1337, x0 + 1, y0 + 1);

  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

// Fractal Brownian Motion (fBM) with 3 octaves for fluid density & curl
function fluidFbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.0;
  for (let i = 0; i < 3; i++) {
    sum += fluidNoise2D(x * freq, y * freq) * amp;
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

/** Pre-computed seeded spiral wisp parameters for each portal.
 * Kept bounded to avoid per-frame cell loops.
 */
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
    const count = 36; // Bounded 36 spiral wisps per active portal
    for (let k = 0; k < count; k++) {
      const initialRadiusFrac = 0.25 + hash01(world.seed, 1401, portal.id, k) * 0.75;
      const armAngleOffset = hash01(world.seed, 1402, portal.id, k) * Math.PI * 2;
      const speed = 0.12 + hash01(world.seed, 1403, portal.id, k) * 0.28;
      const spiralTightness = 2.4 + hash01(world.seed, 1404, portal.id, k) * 1.8;
      const colorOffset = hash(world.seed, 1405, portal.id, k) % 3;
      const length = 3 + hash(world.seed, 1406, portal.id, k) % 4; // 3 to 6 pixels long wisp segment
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

/** Palette ramps for coherent cosmic fluid waves */
const FLUID_PALETTE_DEEP = ["#32115a", "#4a187a", "#631fa3", "#7e28cf"] as const;
const FLUID_PALETTE_MID = ["#7a22bb", "#9d2edb", "#c73ef5", "#df56ff"] as const;
const FLUID_PALETTE_HIGH = ["#ff5ee8", "#7afcff", "#b8fdff", "#d8fbff"] as const;

/** Computes the living Void interior pixels for a given frame.
 * All pixels are clamped strictly inside CellMaterial.VOID, outside black-hole cores.
 */
export function computeVoidInterior(
  world: VoidInteriorWorld,
  wisps: readonly SeededWisp[],
  animTime: number,
  reduceEffects = false,
): WispPixel[] {
  if (reduceEffects) {
    // In reduced effects mode, static subtle standing bands, no moving streams
    return [];
  }

  const { w, h } = world.grid;
  const pixels: WispPixel[] = [];
  const occupied = new Set<number>();

  for (const p of world.portals) {
    if (!p.active) continue;
    const coreR = Math.max(3.6, p.radius * 0.42);
    const maxReach = p.radius * 2.8;

    // 1. Continuous organic vortex streamlines: fluid curl advection
    const streamlineCount = 5;
    for (let b = 0; b < streamlineCount; b++) {
      // Continuous inward phase
      const wavePhase = (animTime * 0.14 + b / streamlineCount) % 1.0;
      const baseR = coreR + 1.2 + (1.0 - wavePhase) * (maxReach - coreR - 1.2);
      const segments = Math.max(20, Math.floor(baseR * 3.2));

      for (let s = 0; s < segments; s++) {
        const theta = (s / segments) * Math.PI * 2;

        // Fluid noise domain warping: sample fbm along logarithmic spiral coordinates
        const logR = Math.log(baseR + 1.0);
        const spiralU = (theta * 2.0 + logR * 3.5 - animTime * 0.45) * 0.4;
        const spiralV = (baseR * 0.15 + animTime * 0.25) * 0.4;
        const fluidPerturb = fluidFbm(spiralU + b * 2.1, spiralV) * 2.2 - 1.1;

        const currentR = baseR + fluidPerturb;
        if (currentR <= coreR + 0.8 || currentR >= maxReach) continue;

        // Smooth vortex rotation with Keplerian-like differential rotation (faster near core)
        const swirlOffset = (animTime * (1.6 / (0.8 + currentR * 0.12))) + Math.sin(theta * 3 + animTime * 0.5) * 0.15;
        const finalTheta = theta + swirlOffset;

        const px = Math.floor(p.x + Math.cos(finalTheta) * currentR);
        const py = Math.floor(p.y + Math.sin(finalTheta) * currentR);

        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const idx = py * w + px;
        if (world.material[idx] !== CellMaterial.VOID) continue;
        if (occupied.has(idx)) continue;

        // Color mapped along radial gradient: cyan crests near core, vibrant magenta mid, deep purple outer
        const normDist = (currentR - coreR) / (maxReach - coreR);
        let col: string;
        if (normDist < 0.28 && (s + b) % 3 === 0) {
          col = FLUID_PALETTE_HIGH[(s + b) % FLUID_PALETTE_HIGH.length];
        } else if (normDist < 0.65) {
          col = FLUID_PALETTE_MID[(s + b) % FLUID_PALETTE_MID.length];
        } else {
          col = FLUID_PALETTE_DEEP[(s + b) % FLUID_PALETTE_DEEP.length];
        }

        occupied.add(idx);
        pixels.push({ x: px, y: py, color: col });
      }
    }
  }

  // 2. Inward-flowing logarithmic spiral wisps
  for (const wisp of wisps) {
    const portal = world.portals.find((prt) => prt.id === wisp.portalId && prt.active);
    if (!portal) continue;

    const coreR = Math.max(3.6, portal.radius * 0.42);
    const maxReach = portal.radius * 2.6;
    const travelRange = maxReach - coreR - 1.2;

    // Progress moves inward (1 -> 0) with non-linear cosmic gravity acceleration
    const cycle = (animTime * wisp.speed + wisp.initialRadiusFrac) % 1.0;
    const progress = 1.0 - cycle; // 1 (far outside) to 0 (core horizon)
    const smoothR = coreR + 1.2 + Math.pow(progress, 1.35) * travelRange;

    // Fluid-advected swirl: combine logarithmic spiral angle with smooth continuous noise
    const curlX = Math.cos(wisp.armAngleOffset) * (smoothR * 0.1);
    const curlY = Math.sin(wisp.armAngleOffset) * (smoothR * 0.1);
    const fluidCurl = (fluidNoise2D(curlX + animTime * 0.15, curlY - animTime * 0.15) - 0.5) * 0.6;
    const baseAngle = wisp.armAngleOffset + Math.log(smoothR + 1.0) * wisp.spiralTightness + animTime * 0.35 + fluidCurl;

    // Draw wisp head and trailing segments
    for (let seg = 0; seg < wisp.length; seg++) {
      const segProg = Math.min(1.0, progress + seg * 0.025);
      const segR = coreR + 1.2 + Math.pow(segProg, 1.35) * travelRange;
      const segAngle = baseAngle + seg * 0.08;

      const wx = Math.floor(portal.x + Math.cos(segAngle) * segR);
      const wy = Math.floor(portal.y + Math.sin(segAngle) * segR);

      if (wx < 0 || wy < 0 || wx >= w || wy >= h) continue;
      const idx = wy * w + wx;
      if (world.material[idx] !== CellMaterial.VOID) continue;
      if (occupied.has(idx)) continue;

      // Color selection along the wisp: head has brightest highlight (cyan or hot magenta), tail fades to deep violet
      let color: string;
      if (seg === 0) {
        color = wisp.id % 4 === 0 ? "#7afcff" : wisp.id % 4 === 1 ? "#ff6ee8" : "#e066ff";
      } else if (seg === 1) {
        color = wisp.id % 2 === 0 ? "#c746dd" : "#9a36cf";
      } else {
        color = "#4a1f93";
      }

      occupied.add(idx);
      pixels.push({ x: wx, y: wy, color });
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

