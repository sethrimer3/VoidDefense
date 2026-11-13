/** Draws Resistance Operations the way the TowerDefense Library draws its
 * nave and the Mine its galleries: one pixel a world unit, scaled up crisp,
 * every surface lit per pixel by the lights around it through a bump map.
 * Each riveted plate's height comes from its own art, so the side of a
 * plate facing a lamp brightens and the side facing away darkens.
 *
 * The Engineering Bay's work lamps, the welders' arcs and the prototype's
 * own indicator lights light the bay; the lab is lit by cool ceiling lamps,
 * its console screens and the captured Void in each containment chamber,
 * glowing and pulsing behind the glass. A viewport above the chambers looks
 * out on stars and drifting nebula. Crew, the crane's load, sparks and dust
 * go over the lit image, lit by the same light without the bevels. Soft
 * lamp cones and light blooms are composited over the scaled image. */

import {
  BAY, BULKHEAD, CEIL, CHAMBER, CHAMBER_SLOTS, CRANE, CRATES, DECKS, FLOOR, LAB, LADDER_X, OPS_H, OPS_W,
  TURRET, WINDOW, chamberX,
} from "./geometry.ts";
import { OperationsCrew, type CrewMember } from "./crew.ts";

type RGB = [number, number, number];

/** What the scene reflects of the player's global tech. */
export type OpsLook = {
  /** Unlocked tower systems (each adds a module to the prototype). */
  towers: ReadonlySet<string>;
  /** Prototype mark, 1 to 5. */
  mark: number;
  /** Containment chambers holding a specimen, 1 to `CHAMBER_SLOTS`. */
  chambers: number;
  twinBarrels: boolean;
};

const W = OPS_W;
const H = OPS_H;
const N = W * H;
const MAX_ZOOM = 6;

const enum Kind {
  Lit = 0,
  Glow = 1,
  Window = 2,
  Tube = 3,
}

type Light = {
  x: number;
  y: number;
  c: RGB;
  radius: number;
  /** How far in front of the wall the light hangs: low lights rake the bevels. */
  lz: number;
  /** Pulses (chambers) or flickers (arcs) when set. */
  pulse?: number;
  flicker?: number;
  /** Bloom drawn over the scaled image, 0 for none. */
  bloom: number;
  /** Fades linearly rather than with the square: wide lamps that fill a room. */
  soft?: boolean;
};

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number };
type Mote = { x: number; y: number; vx: number; vy: number; alpha: number };

/** A fixed number in [0, 1) for a few integers. */
function h01(a: number, b: number, c = 0) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const c255 = (v: number) => (v >= 255 ? 255 : v <= 0 ? 0 : v | 0);
const CHAMBER_COLORS: RGB[] = [[190, 90, 255], [80, 225, 255], [255, 110, 200], [140, 255, 190]];
const AMBIENT: RGB = [0.12, 0.13, 0.17];
const BAY_LAMPS = [30, 92];
const LAB_LAMPS = [164, 224];
const DOOR_TOP = FLOOR - BULKHEAD.door;

export class OperationsRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly off: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly px: Uint32Array;
  // The baked scene: what each pixel is, its colour and the facing of its bevel.
  private readonly kind = new Uint8Array(N);
  private readonly base = new Float32Array(N * 3);
  private readonly hgt = new Float32Array(N);
  private readonly nx = new Float32Array(N);
  private readonly ny = new Float32Array(N);
  private readonly nz = new Float32Array(N);
  /** Which chamber (0..3) a tube pixel belongs to. */
  private readonly tubeOf = new Int8Array(N);
  // This frame's light, with the bevels and without.
  private readonly lit = new Float32Array(N * 3);
  private readonly flat = new Float32Array(N * 3);
  private bakedKey = "";
  private staticLights: Light[] = [];
  private sparks: Spark[] = [];
  private motes: Mote[] = [];
  private readonly stars: { x: number; y: number; b: number; phase: number }[] = [];
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private fx = 0x51ab1e;

  view = { scale: 1, ox: 0, oy: 0 };
  /** Zoom (1 shows the whole floor) and the world point at the view's centre. */
  zoom = 1;
  focus = { x: W / 2, y: H / 2 };
  /** The crew member the view follows, and where the view is gliding to. */
  target: CrewMember | null = null;
  goal: { x: number; y: number; zoom: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.off = document.createElement("canvas");
    this.off.width = W;
    this.off.height = H;
    this.offCtx = this.off.getContext("2d")!;
    this.image = this.offCtx.createImageData(W, H);
    this.px = new Uint32Array(this.image.data.buffer);
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: WINDOW.x0 + 3 + Math.floor(h01(i, 1, 7) * (WINDOW.x1 - WINDOW.x0 - 6)),
        y: WINDOW.y0 + 3 + Math.floor(h01(i, 2, 7) * (WINDOW.y1 - WINDOW.y0 - 6)),
        b: 0.35 + h01(i, 3, 7) * 0.65,
        phase: h01(i, 4, 7) * Math.PI * 2,
      });
    }
    for (let i = 0; i < 28; i++) {
      this.motes.push({ x: this.rand() * W, y: CEIL + this.rand() * (FLOOR - CEIL), vx: 0, vy: 0, alpha: 0 });
    }
  }

  /** Effects-only randomness (sparks and dust), never part of any save. */
  private rand(): number {
    this.fx = (this.fx + 0x6d2b79f5) >>> 0;
    let t = this.fx;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  private fit(): number {
    return Math.min(this.canvas.width / W, this.canvas.height / H);
  }

  resize(): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const scale = this.fit() * this.zoom;
    const half = { x: w / scale / 2, y: h / scale / 2 };
    if (this.target) {
      this.focus.x = this.target.x;
      this.focus.y = this.target.y - 4;
    }
    this.focus.x = half.x * 2 >= W ? W / 2 : Math.max(half.x, Math.min(W - half.x, this.focus.x));
    this.focus.y = half.y * 2 >= H ? H / 2 : Math.max(half.y, Math.min(H - half.y, this.focus.y));
    this.view = { scale, ox: Math.round(w / 2 - this.focus.x * scale), oy: Math.round(h / 2 - this.focus.y * scale) };
  }

  pan(dx: number, dy: number): void {
    this.target = null;
    this.goal = null;
    this.focus.x -= dx / this.view.scale;
    this.focus.y -= dy / this.view.scale;
  }

  /** Zooms by `factor`, keeping the world point under device pixel (px, py) still. */
  zoomBy(factor: number, px: number, py: number): void {
    this.goal = null;
    const { scale, ox, oy } = this.view;
    const wx = (px - ox) / scale;
    const wy = (py - oy) / scale;
    const zoom = Math.max(1, Math.min(MAX_ZOOM, this.zoom * factor));
    if (zoom === this.zoom) return;
    const next = this.fit() * zoom;
    this.zoom = zoom;
    this.focus = { x: wx - (px - this.canvas.width / 2) / next, y: wy - (py - this.canvas.height / 2) / next };
    this.resize();
  }

  /** Glides to frame the bay, the lab, or (null) the whole floor. */
  frameRoom(room: "bay" | "lab" | null): void {
    this.resize();
    this.target = null;
    if (!room) {
      this.goal = { x: W / 2, y: H / 2, zoom: 1 };
      return;
    }
    const span = room === "bay" ? BAY : LAB;
    const fitRoom = Math.min(this.canvas.width / (span.x1 - span.x0 + 4), this.canvas.height / H);
    this.goal = { x: (span.x0 + span.x1) / 2, y: H / 2, zoom: Math.min(MAX_ZOOM, Math.max(1, fitRoom / this.fit())) };
  }

  /** The world point under device pixel (px, py). */
  toWorld(px: number, py: number): { x: number; y: number } {
    const { scale, ox, oy } = this.view;
    return { x: (px - ox) / scale, y: (py - oy) / scale };
  }

  // ── Baking ───────────────────────────────────────────────────────────────

  private set(x: number, y: number, rgb: RGB, h: number, kind = Kind.Lit): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    this.kind[i] = kind;
    this.base[i * 3] = rgb[0];
    this.base[i * 3 + 1] = rgb[1];
    this.base[i * 3 + 2] = rgb[2];
    this.hgt[i] = h;
  }

  /** Fills [x0, x1) × [y0, y1), bevelled `bevel` pixels in from each edge. */
  private rect(x0: number, y0: number, x1: number, y1: number, rgb: RGB, bevel = 0, kind = Kind.Lit, tint = 0): void {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y);
        const h = bevel > 0 ? Math.min(1, (edge + 0.5) / bevel) : 1;
        const t = tint > 0 ? 1 - tint / 2 + h01(x, y, 99) * tint : 1;
        this.set(x, y, [rgb[0] * t, rgb[1] * t, rgb[2] * t], h, kind);
      }
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= n; s++) {
      const t = n ? s / n : 0;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgb, 1);
    }
  }

  private bake(look: OpsLook): void {
    this.kind.fill(Kind.Lit);
    this.tubeOf.fill(-1);
    const lights: Light[] = [];

    // The back wall: riveted steel plates in the bay, clean panels in the lab.
    for (let y = CEIL; y < FLOOR; y++) {
      for (let x = 0; x < W; x++) {
        if (x < BULKHEAD.x0) {
          const PW = 20, PH = 12;
          const row = Math.floor((y - CEIL) / PH);
          const along = x + (row % 2) * 10;
          const lx = along % PW, ly = (y - CEIL) % PH;
          const t = 0.82 + h01(Math.floor(along / PW), row, 3) * 0.3;
          const grime = 1 - 0.18 * ((y - CEIL) / (FLOOR - CEIL));
          if (lx === 0 || ly === 0) this.set(x, y, [24, 27, 33], 0);
          else if ((lx === 2 || lx === PW - 2) && (ly === 2 || ly === PH - 2)) this.set(x, y, [120, 126, 138], 1);
          else {
            const k = t * grime;
            this.set(x, y, [64 * k, 70 * k, 82 * k], Math.min(1, Math.min(lx, PW - lx, ly, PH - ly) / 2));
          }
        } else if (x >= BULKHEAD.x1) {
          const PW = 16, PH = 16;
          const lx = (x - BULKHEAD.x1) % PW, ly = (y - CEIL) % PH;
          const t = 0.9 + h01(Math.floor((x - BULKHEAD.x1) / PW), Math.floor((y - CEIL) / PH), 5) * 0.16;
          if (lx === 0 || ly === 0) this.set(x, y, [36, 42, 52], 0);
          else if (y >= FLOOR - 34 && y < FLOOR - 31) this.set(x, y, [36 * t, 92 * t, 104 * t], 1);
          else this.set(x, y, [76 * t, 86 * t, 102 * t], Math.min(1, Math.min(lx, PW - lx, ly, PH - ly) / 3));
        }
      }
    }

    // The ceiling's trusses.
    for (let y = 0; y < CEIL; y++) {
      for (let x = 0; x < W; x++) {
        if (y === CEIL - 1) this.set(x, y, [84, 88, 98], 1);
        else if (y < 2) this.set(x, y, [16, 17, 21], 0);
        else if ((x + y) % 10 === 0 || (((x - y) % 10) + 10) % 10 === 0) this.set(x, y, [60, 63, 72], 1);
        else this.set(x, y, [28, 30, 36], 0.2);
      }
    }

    // The bulkhead between the rooms, its door under a red lamp.
    this.rect(BULKHEAD.x0, CEIL, BULKHEAD.x1, FLOOR, [52, 57, 68], 2);
    this.rect(BULKHEAD.x0 + 1, DOOR_TOP, BULKHEAD.x1 - 1, FLOOR, [10, 11, 15], 0);
    for (let y = DOOR_TOP - 3; y < DOOR_TOP; y++)
      for (let x = BULKHEAD.x0; x < BULKHEAD.x1; x++)
        this.set(x, y, (x + y) % 4 < 2 ? [210, 160, 40] : [26, 24, 22], 1);
    this.rect(BULKHEAD.x0 + 3, DOOR_TOP - 6, BULKHEAD.x1 - 3, DOOR_TOP - 4, [255, 70, 50], 0, Kind.Glow);
    lights.push({ x: (BULKHEAD.x0 + BULKHEAD.x1) / 2, y: DOOR_TOP - 5, c: [0.9, 0.18, 0.12], radius: 18, lz: 4, bloom: 0.35, flicker: 0.3 });

    // The deck: a lit edge, a hazard band in the bay, grating below.
    for (let y = FLOOR; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (y === FLOOR) this.set(x, y, [112, 118, 130], 1);
        else if (x < BULKHEAD.x0 && y <= FLOOR + 2) this.set(x, y, (x + y) % 8 < 4 ? [196, 148, 40] : [30, 30, 32], 1);
        else if (x < BULKHEAD.x1) {
          const lx = x % 4, ly = (y - FLOOR) % 4;
          this.set(x, y, lx === 0 || ly === 0 ? [62, 66, 76] : [22, 24, 30], lx === 0 || ly === 0 ? 1 : 0);
        } else {
          const lx = (x - BULKHEAD.x1) % 10, ly = (y - FLOOR - 1) % 5;
          const t = 0.9 + h01(Math.floor((x - BULKHEAD.x1) / 10), Math.floor((y - FLOOR) / 5), 11) * 0.15;
          this.set(x, y, lx === 0 || ly === 0 ? [34, 38, 46] : [70 * t, 78 * t, 92 * t], lx === 0 || ly === 0 ? 0 : 0.8);
        }
      }
    }

    // Ceiling lamps: warm work lamps in the bay, cool ones in the lab.
    for (const x of BAY_LAMPS) {
      this.rect(x - 4, CEIL, x + 5, CEIL + 3, [44, 46, 54], 1);
      this.rect(x - 3, CEIL + 3, x + 4, CEIL + 4, [255, 226, 170], 0, Kind.Glow);
      lights.push({ x, y: CEIL + 5, c: [0.95, 0.77, 0.56], radius: 150, lz: 22, bloom: 0.55, soft: true });
    }
    for (const x of LAB_LAMPS) {
      this.rect(x - 4, CEIL, x + 5, CEIL + 2, [44, 48, 58], 1);
      this.rect(x - 3, CEIL + 2, x + 4, CEIL + 3, [210, 236, 255], 0, Kind.Glow);
      lights.push({ x, y: CEIL + 4, c: [0.5, 0.6, 0.76], radius: 130, lz: 22, bloom: 0.45, soft: true });
    }

    // A floodlight on a tripod, trained on the prototype from beside the door.
    const FX = 115, FY = FLOOR - 26;
    this.line(FX, FY + 3, FX - 4, FLOOR - 1, [70, 74, 84]);
    this.line(FX, FY + 3, FX + 4, FLOOR - 1, [70, 74, 84]);
    this.rect(FX, FY + 3, FX + 1, FLOOR - 1, [86, 90, 100], 0);
    this.rect(FX - 2, FY - 2, FX + 4, FY + 4, [50, 54, 62], 1);
    this.rect(FX - 3, FY - 1, FX - 2, FY + 3, [255, 236, 190], 0, Kind.Glow);
    lights.push({ x: FX - 6, y: FY + 1, c: [0.9, 0.82, 0.66], radius: 64, lz: 8, bloom: 0.5 });

    // The crane's rail.
    this.rect(CRANE.x0, CRANE.y, CRANE.x1, CRANE.y + 2, [92, 96, 108], 1);
    for (let x = CRANE.x0 + 2; x < CRANE.x1; x += 12) this.set(x, CRANE.y, [150, 154, 166], 1);

    this.bakeScaffold();
    this.bakeCrates();
    this.bakePrototype(look, lights);
    this.bakeLab(look, lights);

    // The bevels' facings, from the height field.
    const S = 1.6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const sx = (this.hgt[y * W + Math.min(W - 1, x + 1)] - this.hgt[y * W + Math.max(0, x - 1)]) * S;
        const sy = (this.hgt[Math.min(H - 1, y + 1) * W + x] - this.hgt[Math.max(0, y - 1) * W + x]) * S;
        const inv = 1 / Math.sqrt(1 + sx * sx + sy * sy);
        this.nx[i] = -sx * inv;
        this.ny[i] = -sy * inv;
        this.nz[i] = inv;
      }
    }
    this.staticLights = lights;
  }

  private bakeScaffold(): void {
    const POLE: RGB = [182, 124, 44];
    const top = DECKS[DECKS.length - 1].y - 7;
    // Diagonal braces behind, then poles, decks and guard rails.
    for (let d = 0; d < DECKS.length; d++) {
      const lower = d === 0 ? FLOOR : DECKS[d - 1].y;
      const upper = DECKS[d].y + 2;
      this.line(26, lower - 1, DECKS[d].x1 - 2, upper, [120, 84, 34]);
      this.line(14, upper, 25, lower - 1, [120, 84, 34]);
    }
    for (const x of [DECKS[0].x0, 26, DECKS[0].x1 - 1]) this.rect(x, top, x + 1, FLOOR, POLE, 0);
    for (const deck of DECKS) {
      for (let x = deck.x0; x < deck.x1; x++) {
        const seam = (x - deck.x0) % 7 === 0;
        this.set(x, deck.y, seam ? [70, 50, 30] : [132, 94, 56], 1);
        this.set(x, deck.y + 1, seam ? [56, 40, 24] : [96, 68, 40], 0.6);
      }
      this.rect(deck.x0, deck.y - 7, deck.x1, deck.y - 6, POLE, 0);
    }
    // The ladder up both decks.
    for (let y = top; y < FLOOR; y++) {
      this.set(LADDER_X - 2, y, [150, 154, 164], 1);
      this.set(LADDER_X + 2, y, [150, 154, 164], 1);
      if ((y - top) % 4 === 0) for (let x = LADDER_X - 1; x <= LADDER_X + 1; x++) this.set(x, y, [120, 124, 134], 1);
    }
  }

  private bakeCrates(): void {
    const crate = (x: number, y: number) => {
      this.rect(x, y, x + 8, y + 8, [78, 90, 62], 1.5, Kind.Lit, 0.12);
      this.line(x + 1, y + 1, x + 6, y + 6, [104, 118, 82]);
      this.line(x + 6, y + 1, x + 1, y + 6, [104, 118, 82]);
    };
    crate(CRATES.x0, FLOOR - 8);
    crate(CRATES.x0 + 9, FLOOR - 8);
    crate(CRATES.x0 + 18, FLOOR - 8);
    crate(CRATES.x0 + 4, FLOOR - 16);
    // Plates waiting to be hauled, leant on the stack.
    this.rect(CRATES.x1 - 2, FLOOR - 12, CRATES.x1, FLOOR, [132, 140, 154], 1);
  }

  private bakePrototype(look: OpsLook, lights: Light[]): void {
    const T = TURRET;
    const has = (id: string) => look.towers.has(id);
    // The pedestal narrows as it rises, banded with hazard paint.
    for (let y = FLOOR - 14; y < FLOOR; y++) {
      const inset = Math.floor((y - (FLOOR - 14)) < 4 ? 6 - (y - (FLOOR - 14)) : 2);
      for (let x = T.x0 + inset; x < T.x1 - inset; x++) {
        const edge = Math.min(x - T.x0 - inset, T.x1 - inset - 1 - x, y - (FLOOR - 14));
        if (y === FLOOR - 5 || y === FLOOR - 4) this.set(x, y, (x + y) % 6 < 3 ? [200, 150, 40] : [28, 28, 30], 1);
        else this.set(x, y, [60, 66, 78], Math.min(1, (edge + 0.5) / 2));
      }
    }
    // The bearing ring, slotted.
    this.rect(58, T.housingY1, 98, FLOOR - 14, [82, 90, 104], 2);
    for (let x = 61; x < 96; x += 6) this.rect(x, T.housingY1 + 3, x + 2, T.housingY1 + 7, [26, 28, 34], 0);
    // The cupola grows with the mark.
    if (look.mark >= 3) this.rect(68, T.housingY0 - 6, 86, T.housingY0, [70, 80, 96], 2);
    if (look.mark >= 5) this.rect(72, T.housingY0 - 10, 82, T.housingY0 - 6, [86, 96, 112], 1.5);
    // The housing, with an armour plate a mark.
    this.rect(T.housingX0, T.housingY0, T.housingX1, T.housingY1, [72, 82, 98], 3);
    for (let m = 1; m < Math.min(5, look.mark); m++) {
      const y = T.housingY0 + 4 + m * 5;
      this.rect(T.housingX0 + 3, y, T.housingX1 - 3, y + 3, [86, 96, 112], 1.2);
    }
    this.rect(T.housingX0 + 2, T.housingY0 + 4, T.housingX1 - 2, T.housingY0 + 6, [204, 112, 40], 1);
    this.rect(T.housingX0 + 7, T.housingY0 + 9, T.housingX1 - 7, T.housingY0 + 11, [255, 160, 60], 0, Kind.Glow);
    lights.push({ x: (T.housingX0 + T.housingX1) / 2, y: T.housingY0 + 10, c: [0.9, 0.5, 0.15], radius: 22, lz: 5, bloom: 0.3 });
    // The guns: a single heavy barrel, or twin rotaries once the cannons are sped up.
    if (look.twinBarrels) {
      for (const y of [T.housingY0 + 8, T.housingY0 + 18]) {
        this.rect(T.housingX1, y, 120, y + 4, [104, 114, 128], 1);
        this.rect(118, y - 1, 122, y + 5, [122, 132, 146], 1);
      }
    } else {
      this.rect(T.housingX1, T.housingY0 + 12, 116, T.housingY0 + 17, [96, 106, 120], 1.5);
      this.rect(114, T.housingY0 + 11, 118, T.housingY0 + 18, [118, 128, 142], 1);
    }
    // A module a tower system.
    if (has("shieldProjector")) {
      for (const x of [62, 87]) {
        this.rect(x, T.housingY0 - 12, x + 5, T.housingY0, [60, 68, 82], 1);
        this.rect(x + 1, T.housingY0 - 10, x + 4, T.housingY0 - 2, [90, 230, 250], 0, Kind.Glow);
        lights.push({ x: x + 2.5, y: T.housingY0 - 6, c: [0.25, 0.75, 0.9], radius: 26, lz: 6, bloom: 0.5, pulse: x });
      }
    }
    if (has("rocketTeam")) {
      this.rect(51, T.housingY0 + 6, 60, T.housingY0 + 20, [90, 84, 70], 1.5);
      for (let y = T.housingY0 + 8; y < T.housingY0 + 19; y += 4) this.rect(50, y, 52, y + 2, [255, 70, 50], 0, Kind.Glow);
      lights.push({ x: 51, y: T.housingY0 + 13, c: [0.8, 0.15, 0.1], radius: 12, lz: 3, bloom: 0.2 });
    }
    if (has("wallSerpent") || has("heavyMechBay")) {
      // A servo arm folded against the base, for the mechs and serpents.
      this.rect(100, T.housingY1 + 2, 103, FLOOR - 14, [176, 110, 40], 1);
      this.rect(98, T.housingY1 - 2, 104, T.housingY1 + 3, [210, 130, 46], 1.5);
      this.rect(99, FLOOR - 17, 104, FLOOR - 13, [210, 130, 46], 1.5);
    }
    if (has("voidSiphon")) {
      this.rect(T.housingX1 - 3, T.housingY1 - 9, T.housingX1, T.housingY1 - 2, [180, 90, 255], 0, Kind.Glow);
      lights.push({ x: T.housingX1 - 1, y: T.housingY1 - 5, c: [0.55, 0.25, 0.9], radius: 20, lz: 4, bloom: 0.35, pulse: 3 });
    }
    if (has("boundaryPrism")) {
      const top = look.mark >= 5 ? T.housingY0 - 10 : look.mark >= 3 ? T.housingY0 - 6 : T.housingY0;
      for (let r = 0; r < 6; r++) this.rect(77 - Math.floor(r / 2), top - 6 + r, 78 + Math.floor(r / 2), top - 5 + r, [230, 220, 255], 0, Kind.Glow);
      lights.push({ x: 77.5, y: top - 3, c: [0.7, 0.65, 1], radius: 22, lz: 6, bloom: 0.4, pulse: 7 });
    }
    if (has("chronoCannon")) this.rect(T.housingX1, T.housingY0 + 6, T.housingX1 + 3, T.housingY0 + 25, [206, 164, 62], 1);
    if (has("gravityAnchor")) {
      this.rect(75, FLOOR - 12, 81, FLOOR - 7, [120, 70, 220], 0, Kind.Glow);
      lights.push({ x: 78, y: FLOOR - 10, c: [0.4, 0.2, 0.75], radius: 16, lz: 4, bloom: 0.3, pulse: 11 });
    }
  }

  private bakeLab(look: OpsLook, lights: Light[]): void {
    // The viewport: an oak-dark steel frame round a rounded pane on the Void.
    const F = 3;
    for (let y = WINDOW.y0 - F; y < WINDOW.y1 + F; y++) {
      for (let x = WINDOW.x0 - F; x < WINDOW.x1 + F; x++) {
        const dx = Math.min(x - (WINDOW.x0 - F), WINDOW.x1 + F - 1 - x);
        const dy = Math.min(y - (WINDOW.y0 - F), WINDOW.y1 + F - 1 - y);
        if (dx + dy < 4) continue;
        const inPane = x >= WINDOW.x0 && x < WINDOW.x1 && y >= WINDOW.y0 && y < WINDOW.y1 && dx + dy >= 4 + F * 2;
        if (inPane) this.set(x, y, [0, 0, 0], 0, Kind.Window);
        else this.set(x, y, [58, 64, 78], Math.min(1, (Math.min(dx, dy) + 0.5) / 1.5));
      }
    }
    // The sill.
    this.rect(WINDOW.x0 - 6, WINDOW.y1 + F, WINDOW.x1 + 6, WINDOW.y1 + F + 3, [84, 92, 108], 1.5);
    lights.push({ x: (WINDOW.x0 + WINDOW.x1) / 2, y: WINDOW.y1, c: [0.32, 0.26, 0.55], radius: 70, lz: 10, bloom: 0, pulse: 17 });

    // The containment chambers, full or awaiting a specimen, each with its console.
    for (let i = 0; i < CHAMBER_SLOTS; i++) {
      const x = chamberX(i), full = i < look.chambers;
      const col = CHAMBER_COLORS[i % CHAMBER_COLORS.length];
      this.rect(x, CHAMBER.top, x + CHAMBER.w, CHAMBER.top + 6, [70, 78, 94], 2);
      this.rect(x - 1, FLOOR - 7, x + CHAMBER.w + 1, FLOOR, [62, 68, 82], 2);
      this.rect(x + 1, CHAMBER.top + 6, x + 2, FLOOR - 7, [96, 104, 120], 1);
      this.rect(x + CHAMBER.w - 2, CHAMBER.top + 6, x + CHAMBER.w - 1, FLOOR - 7, [96, 104, 120], 1);
      for (let y = CHAMBER.top + 6; y < FLOOR - 7; y++) {
        for (let tx = x + 2; tx < x + CHAMBER.w - 2; tx++) {
          if (full) {
            this.set(tx, y, [0, 0, 0], 0, Kind.Tube);
            this.tubeOf[y * W + tx] = i;
          } else {
            const shine = (tx - x === 4 || tx - x === 5) && y % 9 < 6;
            this.set(tx, y, shine ? [44, 52, 64] : [18, 21, 28], 0.3);
          }
        }
      }
      // Status lamp on the cap.
      this.rect(x + 7, CHAMBER.top + 2, x + 11, CHAMBER.top + 4, full ? col : [80, 40, 30], 0, Kind.Glow);
      // The console.
      const cx = x + CHAMBER.w + 1;
      this.rect(cx, FLOOR - 18, cx + 7, FLOOR, [48, 54, 66], 1.5);
      this.rect(cx + 1, FLOOR - 16, cx + 6, FLOOR - 12, full ? [90, 220, 240] : [34, 52, 60], 0, Kind.Glow);
      this.rect(cx + 1, FLOOR - 10, cx + 6, FLOOR - 9, [30, 34, 42], 0);
      if (full) {
        lights.push({ x: x + CHAMBER.w / 2, y: (CHAMBER.top + FLOOR) / 2, c: [col[0] / 255 * 0.85, col[1] / 255 * 0.85, col[2] / 255 * 0.85], radius: 44, lz: 6, bloom: 0.5, pulse: i * 1.7 });
        lights.push({ x: cx + 3.5, y: FLOOR - 14, c: [0.2, 0.5, 0.55], radius: 12, lz: 3, bloom: 0.15, flicker: 0.08 });
      }
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  draw(look: OpsLook, crew: OperationsCrew, t: number, dt: number, wallDt: number, motion: boolean): void {
    const key = `${[...look.towers].sort().join(",")}|${look.mark}|${look.chambers}|${look.twinBarrels}`;
    if (key !== this.bakedKey) {
      this.bake(look);
      this.bakedKey = key;
    }

    if (this.goal) {
      const ease = motion ? 1 - Math.exp(-wallDt * 5) : 1;
      this.focus.x += (this.goal.x - this.focus.x) * ease;
      this.focus.y += (this.goal.y - this.focus.y) * ease;
      this.zoom += (this.goal.zoom - this.zoom) * ease;
      if (Math.abs(this.goal.x - this.focus.x) < 0.3 && Math.abs(this.zoom - this.goal.zoom) < 0.005) {
        this.focus = { x: this.goal.x, y: this.goal.y };
        this.zoom = this.goal.zoom;
        this.goal = null;
      }
    }
    this.resize();

    // This frame's lights: the fixed ones, then each welder's arc.
    const lights: Light[] = this.staticLights.map((l) => {
      let k = 1;
      if (motion && l.pulse !== undefined) k *= 0.82 + 0.18 * Math.sin(t * 1.4 + l.pulse);
      if (motion && l.flicker) k *= 1 - l.flicker * (0.5 + 0.5 * Math.sin(t * 17 + l.x));
      return k === 1 ? l : { ...l, c: [l.c[0] * k, l.c[1] * k, l.c[2] * k] as RGB };
    });
    const arcs: { x: number; y: number; face: number }[] = [];
    for (const m of crew.members) {
      if (!OperationsCrew.welding(m)) continue;
      // Welders strike their arc in bursts.
      const on = !motion || Math.sin(t * 3.1 + m.id * 2.3) > -0.35;
      if (!on) continue;
      const k = motion ? 0.75 + 0.5 * h01(Math.floor(t * 30), m.id, 3) : 1;
      const x = Math.round(m.x) + m.facing * 3, y = Math.round(m.y) - 3;
      arcs.push({ x, y, face: m.facing });
      lights.push({ x, y, c: [0.85 * k, 1.0 * k, 1.35 * k], radius: 38, lz: 4, bloom: 0.8 * k });
    }

    this.light(lights);
    this.compose(t);
    if (motion) this.stepEffects(arcs, dt);
    this.drawCrane(t, motion);
    for (const m of crew.members) this.drawFigure(m, m === this.target);
    this.drawEffects();
    for (const a of arcs) {
      this.emit(a.x, a.y, [255, 255, 255], 1);
      this.emit(a.x + a.face, a.y, [190, 220, 255], 0.8);
    }

    this.offCtx.putImageData(this.image, 0, 0);
    const c = this.ctx;
    const { scale, ox, oy } = this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#050608";
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.off, ox, oy, W * scale, H * scale);
    this.drawAtmosphere(lights, t, motion);
  }

  /** Lights every pixel: with the bevels (`lit`) and without (`flat`). */
  private light(lights: Light[]): void {
    const lit = this.lit, flat = this.flat;
    for (let i = 0; i < N; i++) {
      lit[i * 3] = flat[i * 3] = AMBIENT[0];
      lit[i * 3 + 1] = flat[i * 3 + 1] = AMBIENT[1];
      lit[i * 3 + 2] = flat[i * 3 + 2] = AMBIENT[2];
    }
    for (const l of lights) {
      const R = l.radius, R2 = R * R, lz2 = l.lz * l.lz;
      const x0 = Math.max(0, Math.floor(l.x - R)), x1 = Math.min(W - 1, Math.ceil(l.x + R));
      const y0 = Math.max(0, Math.floor(l.y - R)), y1 = Math.min(H - 1, Math.ceil(l.y + R));
      const [r, g, b] = l.c;
      for (let y = y0; y <= y1; y++) {
        const dy = l.y - y;
        for (let x = x0; x <= x1; x++) {
          const dx = l.x - x, d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          const i = y * W + x;
          let f = 1 - Math.sqrt(d2) / R;
          if (!l.soft) f *= f;
          const inv = f / Math.sqrt(d2 + lz2);
          const kf = l.lz * inv;
          const kb = Math.max(0, this.nx[i] * dx + this.ny[i] * dy + this.nz[i] * l.lz) * inv;
          const j = i * 3;
          lit[j] += r * kb;
          lit[j + 1] += g * kb;
          lit[j + 2] += b * kb;
          flat[j] += r * kf;
          flat[j + 1] += g * kf;
          flat[j + 2] += b * kf;
        }
      }
    }
  }

  private compose(t: number): void {
    const px = this.px, base = this.base, lit = this.lit;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      let r: number, g: number, b: number;
      switch (this.kind[i]) {
        case Kind.Glow:
          r = base[j]; g = base[j + 1]; b = base[j + 2];
          break;
        case Kind.Window: {
          const x = i % W, y = (i / W) | 0;
          const n1 = Math.sin(x * 0.09 + t * 0.05) * Math.sin(y * 0.17 - t * 0.03 + x * 0.02);
          const n2 = Math.sin(x * 0.05 - t * 0.04 + 2) * Math.sin(y * 0.11 + t * 0.02 + 1);
          const a = Math.max(0, n1) ** 2 * 0.8, c = Math.max(0, n2) ** 2 * 0.6;
          r = 6 + 110 * a + 20 * c; g = 4 + 30 * a + 90 * c; b = 16 + 160 * a + 110 * c;
          if ((((x - y) % 46) + 46) % 46 < 3) { r += 14; g += 16; b += 22; }
          break;
        }
        case Kind.Tube: {
          const x = i % W, y = (i / W) | 0, k = this.tubeOf[i];
          const col = CHAMBER_COLORS[k % CHAMBER_COLORS.length];
          const cx = chamberX(k) + CHAMBER.w / 2 - 0.5;
          const cy = (CHAMBER.top + 6 + FLOOR - 7) / 2 + Math.sin(t * 1.2 + k * 2) * 5;
          const swirl = Math.sin(x * 0.7 + t * 1.6 + k) * Math.sin(y * 0.22 - t * 1.1 + k * 3);
          const d = Math.hypot(x - cx, (y - cy) * 0.8);
          const core = Math.max(0, 1 - d / 5);
          const v = 0.16 + 0.3 * swirl * swirl + core * 1.2;
          r = 10 + col[0] * v; g = 6 + col[1] * v; b = 22 + col[2] * v;
          if (core > 0.6) { r += 120; g += 120; b += 120; }
          if (x - chamberX(k) === 4) { r += 26; g += 26; b += 30; }
          break;
        }
        default:
          r = base[j] * lit[j]; g = base[j + 1] * lit[j + 1]; b = base[j + 2] * lit[j + 2];
      }
      px[i] = 0xff000000 | (c255(b) << 16) | (c255(g) << 8) | c255(r);
    }
    // Stars through the viewport's pane.
    for (const s of this.stars) {
      const i = s.y * W + s.x;
      if (this.kind[i] !== Kind.Window) continue;
      const tw = s.b * (0.6 + 0.4 * Math.sin(t * 1.7 + s.phase));
      this.add(s.x, s.y, [255 * tw, 245 * tw, 230 * tw], 1);
    }
  }

  /** Paints an object pixel lit by the flat light where it stands. */
  private put(x: number, y: number, rgb: RGB): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x, j = i * 3;
    this.px[i] = 0xff000000 | (c255(rgb[2] * this.flat[j + 2]) << 16) | (c255(rgb[1] * this.flat[j + 1]) << 8) | c255(rgb[0] * this.flat[j]);
  }

  /** Paints a pixel that shines by itself. */
  private emit(x: number, y: number, rgb: RGB, a: number): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x, p = this.px[i];
    const r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
    this.px[i] = 0xff000000 | (c255(b + (rgb[2] - b) * a) << 16) | (c255(g + (rgb[1] - g) * a) << 8) | c255(r + (rgb[0] - r) * a);
  }

  /** Adds light to a pixel. */
  private add(x: number, y: number, rgb: RGB, a: number): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x, p = this.px[i];
    this.px[i] = 0xff000000 | (c255(((p >> 16) & 255) + rgb[2] * a) << 16) | (c255(((p >> 8) & 255) + rgb[1] * a) << 8) | c255((p & 255) + rgb[0] * a);
  }

  private drawCrane(t: number, motion: boolean): void {
    // The trolley trundles along the rail, lowering a plate to the prototype.
    const tt = motion ? t : 0;
    const x = Math.round(78 + Math.sin(tt * 0.21) * 34);
    const drop = Math.round(26 + Math.max(0, Math.sin(tt * 0.43)) * 22);
    for (let dx = -3; dx <= 3; dx++) for (let dy = 2; dy <= 4; dy++) this.put(x + dx, CRANE.y + dy, dx === -3 || dx === 3 ? [150, 100, 36] : [214, 140, 44]);
    this.put(x - 2, CRANE.y + 5, [40, 40, 44]);
    this.put(x + 2, CRANE.y + 5, [40, 40, 44]);
    const hookY = CRANE.y + 5 + drop;
    for (let y = CRANE.y + 5; y < hookY; y++) this.put(x, y, [70, 72, 80]);
    this.put(x - 1, hookY, [150, 150, 160]);
    this.put(x, hookY, [150, 150, 160]);
    this.put(x + 1, hookY, [150, 150, 160]);
    for (let dx = -5; dx <= 5; dx++) {
      this.put(x + dx, hookY + 1, [146, 154, 168]);
      this.put(x + dx, hookY + 2, [104, 112, 126]);
    }
  }

  private drawFigure(m: CrewMember, followed: boolean): void {
    const x = Math.round(m.x), y = Math.round(m.y), f = m.facing;
    const lab = m.role === "researcher";
    const body: RGB = lab ? [226, 230, 236] : m.role === "welder" ? [204, 102, 40] : [86, 108, 150];
    const hat: RGB = lab ? [52, 40, 34] : m.role === "welder" ? [230, 190, 48] : [236, 128, 40];
    const skin: RGB = [214, 164, 124];
    const legs: RGB = lab ? [52, 58, 74] : [46, 50, 60];
    const walking = m.phase !== "work";
    const frame = Math.floor(m.stride) % 2;
    // Hat (or hair), then the head: a face to the front.
    for (let dx = -1; dx <= 1; dx++) this.put(x + dx, y - 6, hat);
    this.put(x, y - 5, skin);
    this.put(x + f, y - 5, lab ? [110, 230, 245] : OperationsCrew.welding(m) ? [36, 48, 60] : skin);
    if (lab) this.put(x - f, y - 5, hat);
    // Body and sleeves.
    for (let dy = 2; dy <= 4; dy++) for (let dx = -1; dx <= 1; dx++) this.put(x + dx, y - dy, dx === -f ? [body[0] * 0.75, body[1] * 0.75, body[2] * 0.75] : body);
    if (lab) this.put(x - f, y - 1, body);
    if (m.phase === "work" && m.goal.duty !== "rest" && m.goal.duty !== "gaze") this.put(x + f * 2, y - 3, body);
    if (m.phase === "climb") {
      this.put(x - 1, y - 4 - (frame ? 1 : 0), body);
      this.put(x + 1, y - 4 - (frame ? 0 : 1), body);
    }
    // Legs: apart and together in turn when walking.
    if (walking && frame === 1) {
      this.put(x, y - 1, legs);
      this.put(x, y, [28, 28, 32]);
    } else {
      this.put(x - 1, y - 1, legs);
      this.put(x + 1, y - 1, legs);
      this.put(x - 1, y, [28, 28, 32]);
      this.put(x + 1, y, [28, 28, 32]);
    }
    if (m.carrying) for (let dx = -2; dx <= 2; dx++) this.put(x + dx, y - 7, [150, 158, 172]);
    if (followed) {
      this.emit(x, y - 9, [255, 214, 120], 1);
      this.emit(x - 1, y - 10, [255, 214, 120], 0.9);
      this.emit(x + 1, y - 10, [255, 214, 120], 0.9);
    }
  }

  private stepEffects(arcs: { x: number; y: number; face: number }[], dt: number): void {
    for (const a of arcs) {
      const n = this.rand() < dt * 30 ? 1 + Math.floor(this.rand() * 3) : 0;
      for (let k = 0; k < n && this.sparks.length < 240; k++) {
        const max = 0.4 + this.rand() * 0.9;
        this.sparks.push({ x: a.x, y: a.y, vx: a.face * (8 + this.rand() * 34) + (this.rand() - 0.5) * 24, vy: -(6 + this.rand() * 30), life: max, max });
      }
    }
    for (const s of this.sparks) {
      s.life -= dt;
      s.vy += 120 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const ground = this.groundAt(s.x, s.y - s.vy * dt);
      if (s.y >= ground && s.vy > 0) {
        s.y = ground - 0.01;
        s.vy *= -0.3;
        s.vx *= 0.55;
      }
    }
    this.sparks = this.sparks.filter((s) => s.life > 0 && s.x >= 0 && s.x < W);
    for (const m of this.motes) {
      m.vx += (this.rand() - 0.5) * dt * 4;
      m.vy += (this.rand() - 0.5) * dt * 4;
      m.vx *= 0.98;
      m.vy *= 0.98;
      m.x += m.vx * dt;
      m.y += (m.vy + 0.6) * dt;
      if (m.x < 0) m.x += W;
      if (m.x >= W) m.x -= W;
      if (m.y >= FLOOR - 1 || m.y < CEIL) {
        m.y = CEIL + 2 + this.rand() * 20;
        m.alpha = 0;
      }
      const i = Math.floor(m.y) * W + Math.floor(m.x), j = i * 3;
      const lum = (this.flat[j] + this.flat[j + 1] + this.flat[j + 2]) / 3;
      const want = Math.min(1, Math.max(0, (lum - 0.25) / 0.6));
      m.alpha += (want - m.alpha) * (want > m.alpha ? 0.03 : 0.015);
    }
  }

  /** The first solid row at or below y at column x, for sparks to bounce on. */
  private groundAt(x: number, y: number): number {
    for (const d of DECKS) if (x >= d.x0 && x < d.x1 && y <= d.y) return d.y;
    return FLOOR;
  }

  private drawEffects(): void {
    for (const s of this.sparks) {
      const k = s.life / s.max;
      const rgb: RGB = k > 0.7 ? [255, 250, 210] : k > 0.4 ? [255, 200, 80] : [240, 110, 40];
      this.emit(s.x, s.y, rgb, Math.min(1, 0.4 + k));
    }
    for (const m of this.motes) if (m.alpha > 0.02) this.add(m.x, m.y, [255, 236, 200], m.alpha * 0.22);
  }

  private glow(rgb: RGB): HTMLCanvasElement {
    const key = rgb.map((v) => Math.round(Math.min(1, v) * 15)).join(",");
    let g = this.glows.get(key);
    if (!g) {
      g = document.createElement("canvas");
      g.width = g.height = 64;
      const c = g.getContext("2d")!;
      const q = key.split(",").map((v) => Math.round((Number(v) / 15) * 255));
      const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(${q[0]},${q[1]},${q[2]},0.9)`);
      grad.addColorStop(0.35, `rgba(${q[0]},${q[1]},${q[2]},0.28)`);
      grad.addColorStop(1, `rgba(${q[0]},${q[1]},${q[2]},0)`);
      c.fillStyle = grad;
      c.fillRect(0, 0, 64, 64);
      this.glows.set(key, g);
    }
    return g;
  }

  /** Soft lamp cones and the lights' bloom, over the scaled image. */
  private drawAtmosphere(lights: Light[], t: number, motion: boolean): void {
    const c = this.ctx;
    const { scale, ox, oy } = this.view;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.setTransform(scale, 0, 0, scale, ox, oy);
    const cones: [number, number, string][] = [
      ...BAY_LAMPS.map((x) => [x, CEIL + 4, "255,214,150"] as [number, number, string]),
      ...LAB_LAMPS.map((x) => [x, CEIL + 3, "180,215,255"] as [number, number, string]),
    ];
    for (const [x, y, rgb] of cones) {
      const sway = motion ? Math.sin(t * 0.3 + x) * 0.015 : 0;
      const grad = c.createLinearGradient(0, y, 0, FLOOR);
      grad.addColorStop(0, `rgba(${rgb},${0.11 + sway})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(x - 3, y);
      c.lineTo(x + 4, y);
      c.lineTo(x + 26, FLOOR);
      c.lineTo(x - 25, FLOOR);
      c.closePath();
      c.fill();
    }
    for (const l of lights) {
      if (!l.bloom) continue;
      const peak = Math.max(l.c[0], l.c[1], l.c[2]) || 1;
      const size = Math.min(40, l.radius * 0.5) * (0.6 + 0.4 * Math.min(1.5, peak));
      c.globalAlpha = Math.min(1, l.bloom);
      c.drawImage(this.glow([l.c[0] / peak, l.c[1] / peak, l.c[2] / peak]), l.x - size, l.y - size, size * 2, size * 2);
    }
    c.restore();
  }

  /** The crew member nearest world point (x, y), if any is close. */
  pick(crew: OperationsCrew, x: number, y: number): CrewMember | null {
    let best: CrewMember | null = null, bestD = 7;
    for (const m of crew.members) {
      const d = Math.hypot(m.x - x, m.y - 3 - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }
}
