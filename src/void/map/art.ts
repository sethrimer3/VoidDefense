/** Draws the Resistance Map: a pixel-art countryside, one pixel a map unit,
 * scaled up crisp. Most of it is farmland, a patchwork of wheat, green
 * rows, ploughed soil, canola, orchards and pasture between hedgerows and
 * farm tracks, with woods, farmsteads, wind turbines, a river and a lake.
 * The campaign's sectors are futuristic cities set into it.
 *
 * The countryside and the cities are baked once. Each frame the water
 * glints, turbines turn and cloud shadows drift over it. Each city shows its
 * state: locked ones lie dim under fog, open ones have a Void breach pulsing
 * at their heart, beaten ones stand under a shimmering shield. Red trails
 * run from each beaten city to the next, the newest drawn on as the player
 * watches, and a bobbing exclamation mark over the city the campaign urges
 * them toward shows its urgency. */

import { random } from "../../random.ts";
import { MAP_CITIES, MAP_H, MAP_W, trailPath, type CityState } from "./progress.ts";

type RGB = [number, number, number];
const W = MAP_W, H = MAP_H, N = W * H;

const enum Kind {
  Land = 0,
  Water = 1,
  City = 2,
  Window = 3,
}

/** A fixed number in [0, 1) for a few integers. */
function h01(a: number, b: number, c = 0) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const c255 = (v: number) => (v >= 255 ? 255 : v <= 0 ? 0 : v | 0);
const pack = (r: number, g: number, b: number) => 0xff000000 | (c255(b) << 16) | (c255(g) << 8) | c255(r);

/** Each crop's two row colours and a highlight. */
const CROPS: { a: RGB; b: RGB; hi: RGB; every: number }[] = [
  { a: [198, 162, 72], b: [172, 136, 58], hi: [226, 194, 100], every: 3 }, // wheat
  { a: [88, 142, 54], b: [100, 76, 48], hi: [116, 170, 70], every: 3 }, // green rows
  { a: [112, 82, 54], b: [88, 62, 40], hi: [128, 96, 64], every: 2 }, // ploughed
  { a: [216, 198, 62], b: [192, 174, 50], hi: [240, 222, 96], every: 4 }, // canola
  { a: [98, 152, 64], b: [92, 144, 60], hi: [230, 230, 170], every: 9 }, // pasture
  { a: [142, 130, 84], b: [130, 118, 76], hi: [160, 148, 98], every: 5 }, // fallow
  { a: [90, 138, 58], b: [90, 138, 58], hi: [90, 138, 58], every: 1 }, // orchard (trees added)
];

/** The river, from the top edge into the lake and out at the bottom. */
const RIVER = [
  [214, -3], [226, 22], [218, 50], [229, 72], [221, 102], [232, 124], [236, 142], [222, 164], [208, 184],
];
const LAKE = { x: 236, y: 143, rx: 24, ry: 19 };

export type MapLook = {
  states: CityState[];
  /** Trails walked (index i runs from city i to i + 1). */
  trails: number[];
  /** Trails already shown; later ones are drawn on as the player watches. */
  revealed: number;
  frontier: number;
  selected: number;
};

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly off: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly px: Uint32Array;
  private readonly base = new Uint32Array(N);
  private readonly kind = new Uint8Array(N);
  /** Which city (index) a pixel belongs to, -1 for none. */
  private readonly cityOf = new Int8Array(N).fill(-1);
  private readonly turbines: { x: number; y: number; phase: number }[] = [];
  private readonly beacons: { x: number; y: number; city: number; rgb: RGB; phase: number }[] = [];
  private readonly trails = new Map<number, { x: number; y: number }[]>();
  /** When each newly walked trail began drawing on (seconds), by trail index. */
  private readonly drawing = new Map<number, number>();
  view = { scale: 1, ox: 0, oy: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.off = document.createElement("canvas");
    this.off.width = W;
    this.off.height = H;
    this.offCtx = this.off.getContext("2d")!;
    this.image = this.offCtx.createImageData(W, H);
    this.px = new Uint32Array(this.image.data.buffer);
    for (let i = 0; i + 1 < MAP_CITIES.length; i++) this.trails.set(i, trailPath(i));
    this.bake();
  }

  // ── Baking ───────────────────────────────────────────────────────────────

  private set(x: number, y: number, rgb: RGB, kind = Kind.Land): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    this.base[i] = pack(rgb[0], rgb[1], rgb[2]);
    this.kind[i] = kind;
  }

  private nearCity(x: number, y: number, pad: number): boolean {
    return MAP_CITIES.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + pad);
  }

  private nearTrail(x: number, y: number, pad: number): boolean {
    for (const pts of this.trails.values()) for (const p of pts) if (Math.abs(p.x - x) <= pad && Math.abs(p.y - y) <= pad) return true;
    return false;
  }

  private bake(): void {
    const rng = random(0x5eed_f1e1d);
    // Fields: split the land into a patchwork, each with its crop and row direction.
    type Rect = { x0: number; y0: number; x1: number; y1: number };
    const leaves: Rect[] = [];
    const tracks: Rect[] = [];
    const split = (r: Rect, depth: number) => {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if ((w < 44 && h < 32 && depth > 2) || w < 18 || h < 14) {
        leaves.push(r);
        return;
      }
      const vertical = w / h > 1.3 ? true : h / w > 1.3 ? false : rng() < 0.5;
      const t = 0.35 + rng() * 0.3;
      const road = depth < 3 && rng() < 0.55;
      if (vertical) {
        const sx = Math.round(r.x0 + w * t);
        if (road) tracks.push({ x0: sx - 1, y0: r.y0, x1: sx + 1, y1: r.y1 });
        split({ ...r, x1: sx }, depth + 1);
        split({ ...r, x0: sx }, depth + 1);
      } else {
        const sy = Math.round(r.y0 + h * t);
        if (road) tracks.push({ x0: r.x0, y0: sy - 1, x1: r.x1, y1: sy + 1 });
        split({ ...r, y1: sy }, depth + 1);
        split({ ...r, y0: sy }, depth + 1);
      }
    };
    split({ x0: -2, y0: -2, x1: W + 2, y1: H + 2 }, 0);
    leaves.forEach((f, n) => {
      const crop = CROPS[Math.floor(h01(n, 7, 1) * CROPS.length)];
      const dir = Math.floor(h01(n, 7, 2) * 3);
      for (let y = Math.max(0, f.y0); y < Math.min(H, f.y1); y++) {
        for (let x = Math.max(0, f.x0); x < Math.min(W, f.x1); x++) {
          const lx = x - f.x0, ly = y - f.y0;
          if (lx === 0 || ly === 0) {
            // Hedgerow, with a tree now and then.
            const tree = h01(x, y, 3) < 0.12;
            this.set(x, y, tree ? [42, 84, 34] : [56, 98, 40]);
            continue;
          }
          const row = dir === 0 ? ly : dir === 1 ? lx : lx + ly;
          let c = row % crop.every === 0 ? crop.b : crop.a;
          const n2 = h01(x, y, 5);
          if (n2 < 0.06) c = crop.hi;
          const shade = 0.94 + h01(x >> 2, y >> 2, n) * 0.1;
          this.set(x, y, [c[0] * shade, c[1] * shade, c[2] * shade]);
        }
      }
      if (crop === CROPS[6]) {
        for (let y = f.y0 + 3; y < f.y1 - 2; y += 5)
          for (let x = f.x0 + 3 + ((y / 5) % 2 ? 2 : 0); x < f.x1 - 2; x += 5) {
            this.set(x, y, [48, 92, 38]);
            this.set(x + 1, y, [48, 92, 38]);
            this.set(x, y + 1, [40, 78, 32]);
            this.set(x + 1, y + 1, [40, 78, 32]);
            this.set(x, y - 1, [80, 130, 56]);
          }
      }
    });
    // Farm tracks over the field edges.
    for (const t of tracks)
      for (let y = Math.max(0, t.y0); y < Math.min(H, t.y1); y++)
        for (let x = Math.max(0, t.x0); x < Math.min(W, t.x1); x++)
          this.set(x, y, h01(x, y, 9) < 0.15 ? [150, 126, 86] : [172, 148, 104]);

    // Woods.
    for (let n = 0; n < 9; n++) {
      const cx = 10 + rng() * (W - 20), cy = 10 + rng() * (H - 20), r = 6 + rng() * 7;
      if (this.nearCity(cx, cy, r + 4)) continue;
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = Math.hypot(x - cx, (y - cy) * 1.2) / r + (h01(x, y, 11) - 0.5) * 0.35;
          if (d > 1) continue;
          const crown = h01(x >> 1, y >> 1, 12) < 0.5;
          this.set(x, y, crown ? [34, 74, 32] : [46, 92, 40]);
          if (h01(x, y, 13) < 0.18) this.set(x, y, [70, 122, 54]);
        }
    }

    // The river and lake, with banks.
    const water = (x: number, y: number) => {
      const i = y * W + x;
      return x >= 0 && y >= 0 && x < W && y < H && this.kind[i] === Kind.Water;
    };
    for (let s = 0; s + 1 < RIVER.length; s++) {
      const [ax, ay] = RIVER[s], [bx, by] = RIVER[s + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        // A gentle wiggle between the bends.
        const wob = Math.sin((s + t) * 5.3) * 2;
        const x = ax + (bx - ax) * t + wob, y = ay + (by - ay) * t;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (dx * dx + dy * dy <= 3) this.set(Math.round(x + dx), Math.round(y + dy), [52, 104, 160], Kind.Water);
      }
    }
    for (let y = LAKE.y - LAKE.ry - 2; y <= LAKE.y + LAKE.ry + 2; y++)
      for (let x = LAKE.x - LAKE.rx - 2; x <= LAKE.x + LAKE.rx + 2; x++) {
        const d = Math.hypot((x - LAKE.x) / LAKE.rx, (y - LAKE.y) / LAKE.ry) + (h01(x, y, 21) - 0.5) * 0.06;
        if (d <= 1) this.set(x, y, d > 0.8 ? [58, 116, 166] : [42, 90, 148], Kind.Water);
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!water(x, y) && (water(x + 1, y) || water(x - 1, y) || water(x, y + 1) || water(x, y - 1)))
          this.set(x, y, [150, 142, 98]);

    // Farmsteads: farmhouse, barn and silo, out in the fields.
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 26; tries++) {
      const x = 6 + Math.floor(rng() * (W - 14)), y = 6 + Math.floor(rng() * (H - 12));
      if (this.nearCity(x, y, 10) || this.nearTrail(x + 4, y, 5)) continue;
      let wet = false;
      for (let dy = -2; dy < 7 && !wet; dy++) for (let dx = -2; dx < 12; dx++) if (water(x + dx, y + dy)) wet = true;
      if (wet) continue;
      placed++;
      // Yard.
      for (let dy = -1; dy < 6; dy++) for (let dx = -1; dx < 11; dx++) this.set(x + dx, y + dy, [126, 140, 74]);
      // Farmhouse.
      for (let dx = 0; dx < 4; dx++) {
        this.set(x + dx, y, [150, 58, 40]);
        this.set(x + dx, y + 1, [124, 46, 32]);
        for (let dy = 2; dy < 4; dy++) this.set(x + dx, y + dy, [214, 204, 180]);
      }
      this.set(x + 1, y + 3, [70, 50, 40]);
      this.set(x + 2, y + 2, [240, 220, 140]);
      // Barn.
      for (let dx = 5; dx < 10; dx++) {
        this.set(x + dx, y + 1, [120, 40, 30]);
        for (let dy = 2; dy < 5; dy++) this.set(x + dx, y + dy, [168, 50, 38]);
      }
      this.set(x + 7, y + 3, [230, 222, 206]);
      this.set(x + 7, y + 4, [230, 222, 206]);
      // Silo.
      if (rng() < 0.7) {
        this.set(x + 10, y - 1, [196, 200, 206]);
        for (let dy = 0; dy < 5; dy++) this.set(x + 10, y + dy, dy % 2 ? [150, 156, 166] : [176, 182, 190]);
      }
    }

    // Wind turbines (turned each frame) along the ridges.
    for (let tries = 0; tries < 200 && this.turbines.length < 9; tries++) {
      const x = 8 + Math.floor(rng() * (W - 16)), y = 10 + Math.floor(rng() * (H - 16));
      if (this.nearCity(x, y, 8) || this.nearTrail(x, y, 4) || water(x, y) || water(x, y - 6)) continue;
      if (this.turbines.some((t) => Math.hypot(t.x - x, t.y - y) < 18)) continue;
      for (let dy = 0; dy < 7; dy++) this.set(x, y - dy, [226, 230, 236]);
      this.set(x + 1, y, [70, 90, 50]);
      this.turbines.push({ x, y: y - 7, phase: rng() * Math.PI * 2 });
    }

    // The cities, back to front.
    MAP_CITIES.forEach((c, i) => this.bakeCity(i, rng));
  }

  private bakeCity(i: number, rng: () => number): void {
    const c = MAP_CITIES[i];
    const dark = c.id === "endless";
    const lake = c.id === "archipelagoCity";
    // Ground: a concrete pad crossed by streets (islands in the lake for the archipelago).
    for (let y = c.y - c.r - 1; y <= c.y + c.r + 1; y++)
      for (let x = c.x - c.r - 1; x <= c.x + c.r + 1; x++) {
        const d = Math.hypot(x - c.x, (y - c.y) * 1.15) + (h01(x, y, 31) - 0.5) * 1.6;
        if (d > c.r + 0.5) continue;
        if (lake && (Math.abs(x - c.x + 2) <= 0 || Math.abs(y - c.y - 1) <= 0 || Math.abs(x - c.x - y + c.y) === 0)) continue;
        const street = (x - c.x + 64) % 5 === 0 || (y - c.y + 64) % 5 === 0;
        const rim = d > c.r - 1;
        const col: RGB = dark
          ? street ? [24, 16, 34] : rim ? [40, 30, 52] : [52, 42, 64]
          : street ? [64, 70, 82] : rim ? [96, 102, 112] : [126, 134, 146];
        this.set(x, y, col, Kind.City);
        this.cityOf[y * W + x] = i;
      }
    // Towers: taller toward the centre, each a lit front, a shaded side and a pale roof.
    const towers: { x: number; y: number; w: number; h: number }[] = [];
    const count = Math.round(c.r * 1.7);
    for (let k = 0; k < count * 3 && towers.length < count; k++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (c.r - 3);
      const x = Math.round(c.x + Math.cos(a) * rr), y = Math.round(c.y + Math.sin(a) * rr * 0.85) + 2;
      const center = 1 - rr / c.r;
      const w = 2 + Math.floor(rng() * 3);
      const h = Math.round(3 + center * (c.r * 0.9) + rng() * 4);
      if (this.cityOf[y * W + x] !== i) continue;
      towers.push({ x, y, w, h });
    }
    towers.sort((a, b) => a.y - b.y);
    const bodies: RGB[] = dark
      ? [[46, 36, 62], [34, 26, 48], [58, 44, 76]]
      : [[176, 196, 214], [92, 150, 170], [210, 218, 228], [120, 140, 170]];
    const lights: RGB[] = dark ? [[190, 80, 255], [120, 40, 200]] : [[120, 232, 255], [255, 120, 210], [255, 206, 110]];
    for (const t of towers) {
      const body = bodies[Math.floor(rng() * bodies.length)];
      for (let dy = 0; dy < t.h; dy++) {
        const y = t.y - dy;
        for (let dx = 0; dx <= t.w; dx++) {
          const x = t.x + dx;
          const side = dx === t.w;
          const top = dy === t.h - 1;
          let col: RGB = side ? [body[0] * 0.62, body[1] * 0.62, body[2] * 0.66] : top ? [body[0] * 1.15, body[1] * 1.15, body[2] * 1.12] : body;
          let kind = Kind.City;
          if (!side && !top && dy % 2 === 1 && rng() < (dark ? 0.25 : 0.5)) {
            col = lights[Math.floor(rng() * lights.length)];
            kind = Kind.Window;
          }
          this.set(x, y, col, kind);
          if (x >= 0 && y >= 0 && x < W && y < H) this.cityOf[y * W + x] = i;
        }
      }
      // A spire with a beacon on the tallest.
      if (t.h > c.r * 0.75) {
        const sx = t.x + Math.floor(t.w / 2);
        for (let dy = t.h; dy < t.h + 3; dy++) this.set(sx, t.y - dy, dark ? [80, 60, 100] : [220, 226, 236], Kind.City);
        this.beacons.push({ x: sx, y: t.y - t.h - 3, city: i, rgb: dark ? [200, 90, 255] : rng() < 0.5 ? [255, 70, 70] : [120, 240, 255], phase: rng() * 6 });
      }
    }
    // A glass dome in the larger cities.
    if (c.r >= 12 && !dark) {
      const dx0 = c.x - c.r + 4, dy0 = c.y + c.r - 4;
      for (let y = -3; y <= 0; y++)
        for (let x = -4; x <= 4; x++)
          if (x * x + (y * 1.6) ** 2 <= 17) this.set(dx0 + x, dy0 + y, y === -3 || x === -3 ? [190, 240, 250] : [96, 186, 208], Kind.Window);
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  resize(): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const fit = Math.min(w / W, h / H);
    // Whole screen pixels per map pixel where there is room, so every pixel is the same size.
    const scale = fit >= 2 ? Math.floor(fit) : fit;
    this.view = { scale, ox: Math.round((w - W * scale) / 2), oy: Math.round((h - H * scale) / 2) };
  }

  /** The city under device pixel (px, py), or -1. */
  pick(px: number, py: number): number {
    const { scale, ox, oy } = this.view;
    const x = (px - ox) / scale, y = (py - oy) / scale;
    let best = -1, bestD = Infinity;
    MAP_CITIES.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < c.r + 6 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Whether a trail is still drawing on. */
  get busy(): boolean {
    return this.drawing.size > 0;
  }

  /** Draws a frame; returns how many trails have now been fully shown. */
  draw(look: MapLook, t: number, motion: boolean): number {
    this.resize();
    const px = this.px;
    px.set(this.base);

    // Water glints.
    if (motion) {
      for (let i = 0; i < N; i++) {
        if (this.kind[i] !== Kind.Water) continue;
        const x = i % W, y = (i / W) | 0;
        const g = Math.sin(x * 0.55 + y * 0.9 - t * 1.6) + Math.sin(x * 0.21 - y * 0.4 + t * 0.9);
        if (g > 1.55) px[i] = pack(150, 200, 230);
        else if (g > 1.2) px[i] = pack(84, 140, 190);
      }
    }

    // Turbines.
    for (const tb of this.turbines) {
      const a0 = tb.phase + (motion ? t * 2.2 : 0);
      for (let b = 0; b < 3; b++) {
        const a = a0 + (b * Math.PI * 2) / 3;
        for (let r = 1; r <= 3; r++) this.put(tb.x + Math.cos(a) * r, tb.y + Math.sin(a) * r, [240, 244, 248]);
      }
      this.put(tb.x, tb.y, [180, 186, 196]);
    }

    // City states.
    for (let i = 0; i < N; i++) {
      const k = this.cityOf[i];
      if (k < 0) continue;
      const st = look.states[k];
      if (st === "locked") {
        const p = px[i];
        const r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
        const l = (r + g + b) / 3;
        px[i] = pack(l * 0.42 + 8, l * 0.44 + 10, l * 0.5 + 16);
      } else if (st === "open" && this.kind[i] === Kind.Window && motion) {
        // The lights stutter as the breach drains the grid.
        const x = i % W, y = (i / W) | 0;
        if (h01(x, y, Math.floor(t * 6)) < 0.18) px[i] = pack(30, 26, 40);
      }
    }
    for (const bc of this.beacons) {
      if (look.states[bc.city] === "locked") continue;
      const on = !motion || Math.sin(t * 3 + bc.phase) > 0;
      if (on) this.put(bc.x, bc.y, bc.rgb);
    }
    MAP_CITIES.forEach((c, i) => {
      const st = look.states[i];
      if (st === "open") this.breach(c.x, c.y, c.r, t, motion, c.id === "endless");
      else if (st === "beaten") this.shield(c.x, c.y, c.r, t, motion);
    });

    // Cloud shadows, drifting east.
    if (motion) this.clouds(t);

    // Trails: dashed red routes from each beaten city to the next.
    let shown = look.revealed;
    for (const i of look.trails) {
      const pts = this.trails.get(i)!;
      let n = pts.length;
      if (i >= look.revealed) {
        if (!this.drawing.has(i)) this.drawing.set(i, t);
        const p = motion ? Math.min(1, (t - this.drawing.get(i)!) / 1.6) : 1;
        n = Math.round(pts.length * p);
        if (p >= 1) {
          this.drawing.delete(i);
          shown = Math.max(shown, i + 1);
        }
      }
      const leading = i + 1 === look.frontier;
      const march = leading && motion ? Math.floor(t * 6) : 0;
      for (let s = 0; s < n; s++) {
        const p = pts[s];
        this.put(p.x, p.y + 1, [44, 18, 14]);
      }
      for (let s = 0; s < n; s++) {
        const p = pts[s];
        if ((s + 4 - (march % 4)) % 4 === 3) continue;
        this.put(p.x, p.y, leading ? [255, 74, 52] : [214, 70, 48]);
      }
      // The pen's tip while drawing on.
      if (n > 0 && n < pts.length) this.put(pts[n - 1].x, pts[n - 1].y, [255, 230, 200]);
    }

    // Selection brackets.
    if (look.selected >= 0) this.brackets(MAP_CITIES[look.selected], t, motion);

    // The urgent "!" over the frontier city (once its trail has arrived).
    const f = look.frontier;
    const arriving = f > 0 && look.trails.includes(f - 1) && this.drawing.has(f - 1);
    if (f >= 0 && !arriving) this.bang(MAP_CITIES[f], t, motion);

    this.offCtx.putImageData(this.image, 0, 0);
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#0b0908";
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    const { scale, ox, oy } = this.view;
    c.drawImage(this.off, ox, oy, W * scale, H * scale);
    this.labels(look);
    return shown;
  }

  private put(x: number, y: number, rgb: RGB): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.px[y * W + x] = pack(rgb[0], rgb[1], rgb[2]);
  }

  private blend(x: number, y: number, rgb: RGB, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x, p = this.px[i];
    const r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
    this.px[i] = pack(r + (rgb[0] - r) * a, g + (rgb[1] - g) * a, b + (rgb[2] - b) * a);
  }

  /** A Void breach: a pulsing violet rupture with a black heart and tendrils. */
  private breach(cx: number, cy: number, r: number, t: number, motion: boolean, dark: boolean): void {
    const pulse = motion ? 0.5 + 0.5 * Math.sin(t * 2.4) : 0.5;
    const R = 3 + pulse * 1.5 + (dark ? 2 : 0);
    for (let y = Math.floor(cy - R - 3); y <= cy + R + 3; y++)
      for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
        const a = Math.atan2(y - cy, x - cx);
        const wob = Math.sin(a * 5 + (motion ? t * 1.7 : 0)) * 1.2;
        const d = Math.hypot(x - cx, y - cy) - wob;
        if (d < R * 0.45) this.put(x, y, [8, 2, 16]);
        else if (d < R) this.put(x, y, h01(x, y, Math.floor(t * 4)) < 0.2 ? [255, 190, 255] : [150, 60, 230]);
        else if (d < R + 2) this.blend(x, y, [120, 40, 200], 0.45 * (1 - (d - R) / 2));
      }
    // A warning ring sweeping out over the city.
    if (motion) {
      const ring = ((t * 0.7) % 1) * (r + 4);
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        this.blend(cx + Math.cos(a) * ring, cy + Math.sin(a) * ring * 0.87, [255, 80, 90], 0.5 * (1 - ring / (r + 4)));
      }
    }
  }

  /** A contained city: a cyan shield dome shimmering over it. */
  private shield(cx: number, cy: number, r: number, t: number, motion: boolean): void {
    const R = r + 2;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI;
      const x = cx + Math.cos(a + Math.PI) * R, y = cy - Math.sin(a) * R * 0.9 + 1;
      const glint = motion ? 0.25 + 0.35 * Math.max(0, Math.sin(a * 3 - t * 2)) : 0.35;
      this.blend(x, y, [140, 240, 255], glint);
    }
    for (let x = Math.floor(cx - R); x <= cx + R; x++) this.blend(x, cy + 1, [140, 240, 255], 0.12);
  }

  private clouds(t: number): void {
    for (let k = 0; k < 4; k++) {
      const span = W + 80;
      const cx = ((h01(k, 1, 41) * span + t * (2 + k * 0.7)) % span) - 40;
      const cy = 20 + h01(k, 2, 41) * (H - 40);
      const rx = 18 + h01(k, 3, 41) * 14, ry = rx * 0.5;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (h01(x >> 1, y >> 1, k) - 0.5) * 0.3;
          if (d < 1) this.blend(x, y, [20, 30, 40], 0.16);
        }
    }
  }

  private brackets(c: { x: number; y: number; r: number }, t: number, motion: boolean): void {
    const R = c.r + 4 + (motion ? Math.round(Math.sin(t * 3) * 0.6) : 0);
    const col: RGB = [255, 214, 120];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = c.x + sx * R, y = c.y + sy * R;
      for (let k = 0; k < 4; k++) {
        this.put(x - sx * k, y, col);
        this.put(x, y - sy * k, col);
      }
    }
  }

  /** The bobbing exclamation mark: red, outlined, over the city. */
  private bang(c: { x: number; y: number; r: number }, t: number, motion: boolean): void {
    const bob = motion ? Math.round(Math.sin(t * 4) * 1.5) : 0;
    const x0 = c.x - 2, y0 = c.y - c.r - 16 + bob;
    const SPRITE = [
      ".###.",
      "#RRR#",
      "#RWR#",
      "#RRR#",
      "#RRR#",
      ".#R#.",
      ".#R#.",
      "..#..",
      ".###.",
      "#RRR#",
      ".###.",
    ];
    SPRITE.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "#") this.put(x0 + x, y0 + y, [40, 6, 6]);
        else if (ch === "R") this.put(x0 + x, y0 + y, [255, 64, 44]);
        else if (ch === "W") this.put(x0 + x, y0 + y, [255, 210, 190]);
      }),
    );
  }

  private labels(look: MapLook): void {
    const c = this.ctx;
    const { scale, ox, oy } = this.view;
    const font = getComputedStyle(this.canvas).getPropertyValue("--font").trim() || "monospace";
    const size = Math.max(9, Math.round(scale * 4.2));
    c.font = `bold ${size}px ${font}`;
    c.textAlign = "center";
    c.textBaseline = "top";
    MAP_CITIES.forEach((city, i) => {
      const label = city.id === "endless" ? "∞" : String(i + 1).padStart(2, "0");
      const x = ox + city.x * scale, y = oy + (city.y + city.r * 0.95 + 2) * scale;
      const st = look.states[i];
      const w = c.measureText(label).width + size * 0.8;
      c.fillStyle = st === "locked" ? "rgba(20,18,16,0.75)" : "rgba(28,18,10,0.88)";
      c.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), Math.round(size * 1.25));
      c.strokeStyle = st === "beaten" ? "#7fe6f2" : st === "open" ? "#ff6a4a" : "#5a5248";
      c.lineWidth = Math.max(1, Math.round(scale / 2));
      c.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(size * 1.25));
      c.fillStyle = st === "locked" ? "#8a8070" : "#ffe6b0";
      c.fillText(label, x, y + size * 0.15);
    });
  }
}
