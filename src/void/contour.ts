/** Nebula contours for cosmic Void organisms and crystalline spires.
 *
 * Uses the classic renderer's 2D Value Noise with ridged multifractal octaves
 * (from portal-noise.ts; verified: portal-noise.ts uses smooth cubic value noise,
 * not gradient Perlin noise) to generate organic, evolving nebula contours in
 * violet/magenta with occasional cyan highlights while preserving crisp silhouettes.
 *
 * All coordinates and output pixels adhere to the 1 simulation cell = 1 world pixel
 * discrete integer grid.
 */
import { portalNoiseTile } from "./portal-noise.ts";
import type { VoidOrganism, VoidNode } from "./model.ts";

export type PixelPoint = { x: number; y: number; color: string };

const TILE = 96;

// Palette ramp for nebula contours: deep violet, vibrant magenta, bright hot magenta, and rare cyan highlights.
const CONTOUR_VIOLET = "#8425d9";
const CONTOUR_PURPLE = "#a832e8";
const CONTOUR_MAGENTA = "#df42d1";
const CONTOUR_HOT_MAGENTA = "#ff62e2";
const CONTOUR_CYAN = "#6ef3ff";
const CONTOUR_WHITE_CYAN = "#d8fbff";

/** Cached static noise tile from classic portal noise (96x96 grayscale). */
let cachedTile: Uint8ClampedArray | null = null;
function getNoiseTile(): Uint8ClampedArray {
  if (!cachedTile) {
    cachedTile = portalNoiseTile();
  }
  return cachedTile;
}

/** Samples the toroidal noise tile at continuous (u, v) in [0..1). */
export function sampleContourNoise(u: number, v: number): number {
  const tile = getNoiseTile();
  let x = Math.floor((u % 1 + 1) % 1 * TILE);
  let y = Math.floor((v % 1 + 1) % 1 * TILE);
  x = (x % TILE + TILE) % TILE;
  y = (y % TILE + TILE) % TILE;
  return tile[(y * TILE + x) * 4] / 255;
}

/** Maps a noise value in [0, 1] plus an index hash to a nebula contour color.
 * Violet/magenta base with occasional cyan highlights for peak ridges.
 */
export function contourColor(noiseVal: number, seedJitter = 0): string {
  // Peak values (> 0.84) trigger cyan highlights
  if (noiseVal > 0.84 && (seedJitter % 3 !== 0)) {
    return noiseVal > 0.93 ? CONTOUR_WHITE_CYAN : CONTOUR_CYAN;
  }
  if (noiseVal > 0.65) {
    return CONTOUR_HOT_MAGENTA;
  }
  if (noiseVal > 0.42) {
    return CONTOUR_MAGENTA;
  }
  if (noiseVal > 0.22) {
    return CONTOUR_PURPLE;
  }
  return CONTOUR_VIOLET;
}

export type SilhouettePixel = { x: number; y: number };

/** Returns the local integer footprint cells for a given cosmic organism type. */
export function organismFootprint(o: VoidOrganism): SilhouettePixel[] {
  const cx = Math.round(o.x);
  const cy = Math.round(o.y);
  const cells: SilhouettePixel[] = [];

  switch (o.kind) {
    case "nebulaWorm": {
      // 3x3 rounded head/body block
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          cells.push({ x: cx + dx, y: cy + dy });
        }
      }
      break;
    }
    case "constellationSpider": {
      // 2x2 core body
      cells.push({ x: cx - 1, y: cy - 1 });
      cells.push({ x: cx, y: cy - 1 });
      cells.push({ x: cx - 1, y: cy });
      cells.push({ x: cx, y: cy });
      break;
    }
    case "voidBloom": {
      // 3x3 diamond/cross flower
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= 2) {
            cells.push({ x: cx + dx, y: cy + dy });
          }
        }
      }
      break;
    }
    case "nebulaQueen": {
      // 4x4 grand nexus queen
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = -2; dx <= 1; dx++) {
          cells.push({ x: cx + dx, y: cy + dy });
        }
      }
      break;
    }
    case "honeycombCrystal": {
      // 3x3 crystalline hexagonal core
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          cells.push({ x: cx + dx, y: cy + dy });
        }
      }
      break;
    }
    case "nexusCrystal": {
      // 4x4 diamond nexus spire
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = -2; dx <= 1; dx++) {
          cells.push({ x: cx + dx, y: cy + dy });
        }
      }
      break;
    }
    default: {
      // voidBee: 1-cell organism
      cells.push({ x: cx, y: cy });
      break;
    }
  }
  return cells;
}

/** Computes thin, organic 1-pixel outer contour around organism footprint cells.
 * Evolves slowly over time with scrolling noise coordinates.
 */
export function computeOrganismContour(
  o: VoidOrganism,
  animTime: number,
  reduceMotion = false,
): PixelPoint[] {
  const footprint = organismFootprint(o);
  const occupied = new Set<string>();
  for (const p of footprint) {
    occupied.add(`${p.x},${p.y}`);
  }

  // Find 4-connected exterior rim cells
  const rimMap = new Map<string, { x: number; y: number }>();
  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (const p of footprint) {
    for (const n of neighbors) {
      const nx = p.x + n.dx;
      const ny = p.y + n.dy;
      const key = `${nx},${ny}`;
      if (!occupied.has(key)) {
        rimMap.set(key, { x: nx, y: ny });
      }
    }
  }

  const result: PixelPoint[] = [];
  const t = reduceMotion ? 0 : animTime * 0.35; // Slowly evolves noise (0.35 Hz)

  for (const rim of rimMap.values()) {
    // Spatial noise coordinates anchored to world plus organism id and slow time scroll
    const u = (rim.x * 0.08 + t * 0.05 + (o.id * 0.17)) % 1;
    const v = (rim.y * 0.08 - t * 0.04 + (o.id * 0.31)) % 1;
    const nVal = sampleContourNoise(u, v);

    // Filter thin organic contour: modulate presence slightly while preserving readable silhouette
    // (At least 85% of boundary cells are kept so silhouette is clear and readable)
    const jitter = Math.abs(Math.floor(rim.x * 7 + rim.y * 13 + o.id));
    if (nVal > 0.15 || reduceMotion) {
      const color = contourColor(nVal, jitter);
      result.push({ x: rim.x, y: rim.y, color });
    }
  }

  return result;
}

/** Computes thin nebula contour for crystalline Void Nodes (stationary enemy spires). */
export function computeNodeContour(
  node: VoidNode,
  animTime: number,
  reduceMotion = false,
): PixelPoint[] {
  const cx = Math.round(node.x);
  const cy = Math.round(node.y);
  const occupied = new Set<string>();

  // 3x3 footprint for Void Nodes
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      occupied.add(`${cx + dx},${cy + dy}`);
    }
  }

  const rimMap = new Map<string, { x: number; y: number }>();
  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = cx + dx, py = cy + dy;
      for (const n of neighbors) {
        const nx = px + n.dx, ny = py + n.dy;
        const key = `${nx},${ny}`;
        if (!occupied.has(key)) {
          rimMap.set(key, { x: nx, y: ny });
        }
      }
    }
  }

  const result: PixelPoint[] = [];
  const t = reduceMotion ? 0 : animTime * 0.25;

  for (const rim of rimMap.values()) {
    const u = (rim.x * 0.07 + t * 0.03 + (node.id * 0.23)) % 1;
    const v = (rim.y * 0.07 - t * 0.03 + (node.id * 0.41)) % 1;
    const nVal = sampleContourNoise(u, v);
    const jitter = Math.abs(Math.floor(rim.x * 11 + rim.y * 5 + node.id));
    const color = contourColor(nVal, jitter);
    result.push({ x: rim.x, y: rim.y, color });
  }

  return result;
}
