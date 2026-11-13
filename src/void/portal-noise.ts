/** The burning dimension behind portal contours, after Sign99's building cores:
 * a sharp ridged-noise fire, three layers scrolling different ways, multiplied out
 * of a warm bed and lit with additive hot cores. It is anchored to the screen, as
 * though it filled it unseen, and shows through the contour's mask. Presentation only. */
type Ctx = CanvasRenderingContext2D;

const TILE = 96;

function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  return hash2(x0, y0) * (1 - fx) * (1 - fy) + hash2(x0 + 1, y0) * fx * (1 - fy)
    + hash2(x0, y0 + 1) * (1 - fx) * fy + hash2(x0 + 1, y0 + 1) * fx * fy;
}

/** Ridged multifractal: the fold gives licking flame edges, not soft blobs. */
function ridged(x: number, y: number): number {
  let sum = 0, amp = 0.55, freq = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * (1 - Math.abs(valueNoise(x * freq, y * freq) * 2 - 1));
    freq *= 2.03;
    amp *= 0.5;
  }
  return Math.min(1, sum);
}

/** Opaque grayscale noise, sampled on a torus so it tiles seamlessly. */
export function portalNoiseTile(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(TILE * TILE * 4), scale = 4;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const a = (x / TILE) * Math.PI * 2, b = (y / TILE) * Math.PI * 2;
    let v = ridged((Math.cos(a) + 1) * scale + (Math.cos(b) + 1) * scale, (Math.sin(a) + 1) * scale + (Math.sin(b) + 1) * scale);
    // Bright cores and dark gaps, the floor lifted so multiply never crushes to black.
    v = 0.2 + 0.8 * Math.pow(v, 2.4);
    const i = (y * TILE + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255);
    d[i + 3] = 255;
  }
  return d;
}

/** Scroll direction, speed (tiles' screen pixels a second), size and strength. */
export const PORTAL_LAYERS = [
  { dx: 0.0, dy: -1.0, speed: 9, scale: 1.0, alpha: 0.55 },
  { dx: 0.87, dy: 0.5, speed: 6, scale: 1.6, alpha: 0.4 },
  { dx: -0.7, dy: 0.2, speed: 13, scale: 0.7, alpha: 0.3 },
] as const;

/** The tile's drawn size at scale 1, in CSS pixels (times the device ratio). */
export const PORTAL_TILE_PX = 110;
const BED = "rgb(240, 96, 18)";
/** The hot cores' tint: only the brightest ridges, yellow, never grey. */
const HOT = [255, 196, 70];

// Each renderer keeps its patterns when a preview or another board draws.
// Alternating contexts must not regenerate the tile on every frame.
const patterns = new WeakMap<Ctx, { noise: CanvasPattern; hot: CanvasPattern }>();
function patternsFor(c: Ctx) {
  const cached = patterns.get(c);
  if (cached) return cached;
  const make = (tint: (v: number, d: Uint8ClampedArray, i: number) => void) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = TILE;
    const t = cv.getContext("2d")!;
    const img = t.createImageData(TILE, TILE), d = portalNoiseTile();
    for (let i = 0; i < d.length; i += 4) tint(d[i] / 255, d, i);
    img.data.set(d);
    t.putImageData(img, 0, 0);
    return c.createPattern(cv, "repeat");
  };
  const noise = make(() => {}), hot = make((v, d, i) => {
    const k = Math.max(0, (v - 0.55) / 0.45);
    for (let j = 0; j < 3; j++) d[i + j] = Math.round(HOT[j] * k * k);
  });
  if (!noise || !hot) return null;
  const made = { noise, hot }; patterns.set(c, made); return made;
}

/** Fill a device-pixel box of `c` (identity transform) with the burning
 * dimension at `seconds`; the caller masks it to the contour. */
export function paintPortal(c: Ctx, box: { x: number; y: number; w: number; h: number }, seconds: number, ratio = 1) {
  const p = patternsFor(c);
  c.save();
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.fillStyle = BED;
  c.fillRect(box.x, box.y, box.w, box.h);
  if (p) {
    const pass = (pattern: CanvasPattern, op: GlobalCompositeOperation, alpha: (i: number, a: number) => number, shrink: number, push: number) => {
      c.globalCompositeOperation = op;
      PORTAL_LAYERS.forEach((L, i) => {
        const drawn = PORTAL_TILE_PX * ratio * L.scale * shrink, off = (seconds * L.speed + i * 40) * ratio * push;
        pattern.setTransform(new DOMMatrix().translate(-L.dx * off, -L.dy * off).scale(drawn / TILE));
        c.fillStyle = pattern;
        c.globalAlpha = alpha(i, L.alpha);
        c.fillRect(box.x, box.y, box.w, box.h);
      });
    };
    pass(p.noise, "multiply", i => 0.85 - i * 0.12, 1, 1); // carve the flames out of the bed
    pass(p.hot, "lighter", (_, a) => Math.min(1, a * 1.6), 0.8, 1.3); // additive hot cores
  }
  c.restore();
}
