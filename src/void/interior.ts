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

// Colors for traveling brightness/color bands and inward spiral wisps
const WISP_RAMP = [
  "#2f176f", // Deep violet wisp tail
  "#4a1f93", // Violet wisp body
  "#6e2bb4", // Rich purple
  "#9a36cf", // Vibrant magenta
  "#c746dd", // Hot magenta
  "#e066ff", // Bright crest
  "#7afcff", // Cyan wisp sparkle
  "#d8fbff", // White-cyan core
] as const;

/** Pre-computed seeded spiral wisp parameters for each portal.
 * Kept bounded (e.g. 32 streams per portal) to avoid per-frame cell loops.
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

    // 1. Traveling concentric brightness/color waves (expanding/contracting ripple bands)
    const bandCount = 4;
    for (let b = 0; b < bandCount; b++) {
      // Evolving traveling wave phase
      const wavePhase = (animTime * 0.22 + b / bandCount) % 1.0;
      // Inward traveling band radius
      const r = coreR + 1.2 + (1.0 - wavePhase) * (maxReach - coreR - 1.2);
      const segments = Math.max(16, Math.floor(r * 2.8));
      
      // Gradually vary the band shape with multi-frequency modulation so it feels evolving
      const wobbleSpeed = animTime * 0.45;
      for (let s = 0; s < segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        // Radial perturbation gives organic, fluid contours to the traveling band
        const dr = Math.sin(theta * 3 + wobbleSpeed + b) * 0.9 + Math.cos(theta * 5 - wobbleSpeed * 0.7) * 0.5;
        const currentR = r + dr;
        if (currentR <= coreR + 0.8 || currentR >= maxReach) continue;

        const px = Math.floor(p.x + Math.cos(theta) * currentR);
        const py = Math.floor(p.y + Math.sin(theta) * currentR);

        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const idx = py * w + px;
        if (world.material[idx] !== CellMaterial.VOID) continue;
        if (occupied.has(idx)) continue;

        // Color shifts from magenta on the rim to cyan on harmonic peaks
        const colorIdx = (b + Math.floor(theta * 2 + animTime * 0.6)) % 4;
        const col = colorIdx === 0 ? "#7a22bb" : colorIdx === 1 ? "#ad32d9" : colorIdx === 2 ? "#e052eb" : "#5ce1ff";

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

    // Logarithmic spiral angle + dynamic swirling evolution
    const swirlEvolve = Math.sin(animTime * 0.3 + wisp.id) * 0.4;
    const baseAngle = wisp.armAngleOffset + Math.log(smoothR + 1.0) * wisp.spiralTightness + animTime * 0.4 + swirlEvolve;

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
