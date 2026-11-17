/** A living upgrade tree: nodes on branches that hold their shape loosely.
 * Each node sits on a spring to its place (the root at the bottom; the
 * branch a building is on carries on upward, while choices that turn it
 * down another branch sit beside it and below), joined to its parent by
 * another, and nodes
 * push apart when crowded, so a dragged node pulls its branch along and
 * everything eases back when let go. Nodes that leave the tree (a branch
 * cut off by a choice) shrivel and drop away; new ones sprout from their
 * parent. Branches not shown yet trail off from a node as lines that
 * scatter into pixels and fade away (what buying it would open), each
 * toward where it would stand, and the ones a choice closed off trail off
 * in withered brown toward where they stood. The branches are pixel art
 * (`branch-art.ts`), drawn on one canvas under the nodes. Drag a node
 * to pull it, drag the background to pan, the wheel to zoom; a tap picks a
 * node and shows its card.
 *
 * Presentation only, with no game imports: the page hands it `GraphNode`s
 * (`set`) and hears back which node was picked (`onPick`). */
import { stream } from "../random.ts";
import { TreeMotes, type MoteArea, type MoteNode } from "./tree-motes.ts";
import { BranchArt, rgb, type Pt, type Stroke, type Tone } from "./branch-art.ts";

const rand = stream("effects");

/** One node as drawn. */
export type GraphNode = {
  id: string;
  parent?: string;
  /** owned: had; next: can be bought now; locked: further along. */
  state: "owned" | "next" | "locked";
  /** The node's face (an icon), as HTML. */
  face: string;
  /** A short tag under it (a price, or a numeral). */
  tag?: string;
  /** Full name shown in a hover/tap tooltip. */
  label?: string;
  /** Dimmed by a filter; excluded from Fit View bounds when any node is active. */
  dimmed?: boolean;
  /** A path's colours (`hue-*` class), if any. */
  hue?: string;
  /** A choice down another branch: placed beside its parent and below,
   * rather than above it. */
  side?: boolean;
  /** Branches beyond it not shown yet: drawn as lines fanning away from its
   * parent and fading off. */
  hidden?: Slot[];
  /** Branches a later choice closed off: drawn as withered lines fading off
   * toward where each stood... */
  closed?: Slot[];
  /** ...beside the one it took. */
  took?: Slot;
};

/** Where a branch stands among its node's: one of `n` choices beside it
 * (`side`) or of `n` branches carrying on up, the `i`th. */
export type Slot = { side: boolean; i: number; n: number };

type Body = {
  n: GraphNode;
  el: HTMLElement;
  x: number; y: number; vx: number; vy: number;
  hx: number; hy: number;
  /** Seconds since it began to wither, or -1 while alive. */
  dying: number;
  spin: number;
};

/** Board pixels to an art pixel of the branches, at zoom 1. */
const ART = 2;
/** How far from a node's middle its trailing lines start (past its frame),
 * and the longest they run. */
const TRAIL_FROM = 22, TRAIL_MAX = 80;

const tone = (light: string, base: string, shade: string): Tone => ({ light: rgb(light), base: rgb(base), shade: rgb(shade) });
const TONES = {
  owned: tone("#fff1b8", "#f2c95a", "#9a6a1c"),
  next: tone("#dcfcff", "#57d6e0", "#2a7f8c"),
  locked: tone("#5d7880", "#3c5459", "#26363a"),
  withering: tone("#8f6a3c", "#6b4a2b", "#43301c"),
  hidden: tone("#bff6fb", "#57d6e0", "#2a7f8c"),
  dim: tone("#7fb0b6", "#4f7d83", "#2c4a4e"),
  closed: tone("#dcaa6c", "#b07840", "#6e4824"),
};

/** Pixels between neighbouring leaves, and between generations. */
const GAP_X = 66, GAP_Y = 74;
/** How long a cut branch takes to shrivel and fall away (s). */
const WITHER = 1.1;

export class UpgradeGraph {
  readonly el: HTMLElement;
  private readonly view: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly art = new BranchArt();
  private image: ImageData | null = null;
  /** Each path colour's tones, read from its `hue-*` class. */
  private hues = new Map<string, Tone>();
  private readonly layer: HTMLElement;
  private bodies = new Map<string, Body>();
  private picked = "";
  /** The golden motes riding the tree's currents (`tree-motes.ts`), on
   * their own canvas between the branches and the nodes. */
  private readonly motes = new TreeMotes();
  private readonly moteCanvas: HTMLCanvasElement;
  private now = 0;
  private raf = 0;
  private last = 0;
  /** The view's pan (px) and zoom, eased toward the fit. */
  private pan = { x: 0, y: 0, s: 1 };
  private fit = { x: 0, y: 0, s: 1 };
  private steered = false;
  /** The space the view can pan round, in the tree's own pixels: the tree
   * (and its trailing lines) and `PAN_MARGIN` of its size more on every
   * side. */
  private area: MoteArea | null = null;
  /** Where the motes swirl: the pan area, widened to cover the view at the
   * furthest zoom out. */
  private moteArea: MoteArea | null = null;
  /** The furthest the view zooms out: `ZOOM_OUT` past fitting the tree. */
  private minS = 0.2;
  private drag: { id: string; pointer: number; x0: number; y0: number; moved: boolean; pan?: { x: number; y: number } } | null = null;
  private pinch = new Map<number, { x: number; y: number }>();
  private secondaryEdges: readonly [string, string][] = [];
  private readonly tooltip: HTMLElement;
  private hoveredId = "";
  private clusterCenter = { x: 0, y: 0, r: 300 };

  constructor(
    host: HTMLElement,
    private readonly opts: {
      reduceMotion: () => boolean;
      onPick: (id: string) => void;
      paint: (el: HTMLElement) => void;
      /** Opt-in spatial-grid neighbor culling for large 100-300+ node networks. */
      spatialCulling?: boolean;
    },
  ) {
    this.el = host;
    host.classList.add("ug");
    host.innerHTML = `<canvas class="ug-branches"></canvas><canvas class="ug-motes" aria-hidden="true"></canvas><div class="ug-view"><div class="ug-nodes"></div></div><div class="ug-tooltip" hidden></div>`;
    this.view = host.querySelector(".ug-view")!;
    this.canvas = host.querySelector("canvas")!;
    this.moteCanvas = host.querySelector(".ug-motes")!;
    this.layer = host.querySelector(".ug-nodes")!;
    this.tooltip = host.querySelector(".ug-tooltip")!;
    host.addEventListener("pointerdown", this.down);
    host.addEventListener("pointermove", this.move);
    host.addEventListener("pointerup", this.up);
    host.addEventListener("pointercancel", this.up);
    host.addEventListener("pointerleave", this.leave);
    host.addEventListener("wheel", this.wheel, { passive: false });
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el.removeEventListener("pointerdown", this.down);
    this.el.removeEventListener("pointermove", this.move);
    this.el.removeEventListener("pointerup", this.up);
    this.el.removeEventListener("pointercancel", this.up);
    this.el.removeEventListener("pointerleave", this.leave);
    this.el.removeEventListener("wheel", this.wheel);
    this.el.innerHTML = "";
  }

  /** Sets optional secondary prerequisite cross-links (`[fromId, toId]`) for multi-parent DAGs. */
  setSecondaryEdges(edges: readonly [string, string][]) {
    this.secondaryEdges = edges;
  }

  /** The tree as it is now: new nodes sprout, gone ones wither. `web`, the
   * whole of what the nodes are part of, spreads them round its root as a
   * web (the upgrade map), each where it stands in the whole, rather than
   * growing them up as a tree. */
  set(nodes: GraphNode[], picked: string, web?: readonly { id: string; parent?: string }[]) {
    const homes = web ? webLayout(web) : layout(nodes), still = this.opts.reduceMotion();
    const initial = this.bodies.size === 0;
    const live = new Set(nodes.map((n) => n.id));
    for (const [id, b] of this.bodies) {
      if (live.has(id) || b.dying >= 0) continue;
      if (still) this.drop(id);
      else {
        b.dying = 0;
        b.spin = (rand() - 0.5) * 120;
        b.el.classList.add("withering");
      }
    }
    for (const n of nodes) {
      const [hx, hy] = homes.get(n.id)!;
      let b = this.bodies.get(n.id);
      if (!b || b.dying >= 0) {
        if (b) this.drop(n.id);
        const from = n.parent ? this.bodies.get(n.parent) : undefined;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ug-node";
        el.dataset.node = n.id;
        this.layer.append(el);
        const placeDirect = still || initial || !from;
        b = { n, el, x: placeDirect ? hx : from.x, y: placeDirect ? hy : from.y, vx: 0, vy: 0, hx, hy, dying: -1, spin: 0 };
        if (!placeDirect) el.classList.add("sprouting");
        this.bodies.set(n.id, b);
      }
      const changed = b.n.state !== n.state || b.n.face !== n.face || b.n.tag !== n.tag || b.n.dimmed !== n.dimmed || !b.el.innerHTML;
      b.n = n;
      b.hx = hx;
      b.hy = hy;
      if (changed) {
        b.el.innerHTML = `${n.face}${n.tag ? `<small>${n.tag}</small>` : ""}`;
        this.opts.paint(b.el);
      }
      b.el.className = `ug-node ${n.state}${n.dimmed ? " dimmed" : ""}${n.hue ? ` ${n.hue}` : ""}${b.el.classList.contains("sprouting") ? " sprouting" : ""}`;
      b.el.setAttribute("aria-pressed", String(n.id === picked));
    }
    // What trails off, for anyone reading the page (tests among them).
    this.canvas.dataset.hidden = String(nodes.reduce((k, n) => k + (n.hidden?.length ?? 0), 0));
    this.canvas.dataset.closed = String(nodes.reduce((k, n) => k + (n.closed?.length ?? 0), 0));
    this.pick(picked);
    this.refit(!this.steered);
    if (still) this.snap();
  }

  /** Marks `id` as the picked node. */
  pick(id: string) {
    this.picked = id;
    for (const [nid, b] of this.bodies) b.el.classList.toggle("picked", nid === id);
    this.updateTooltip();
  }

  /** Screen-space center and radius of the node cluster (for backdrops). */
  getClusterScreen(): { x: number; y: number; r: number } {
    return {
      x: this.pan.x + this.clusterCenter.x * this.pan.s,
      y: this.pan.y + this.clusterCenter.y * this.pan.s,
      r: this.clusterCenter.r * this.pan.s,
    };
  }

  /** Fits the visible tree in view (eased unless `now`). */
  refit(now = false) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let hasActive = false;
    for (const b of this.bodies.values()) {
      if (b.dying < 0 && !b.n.dimmed) { hasActive = true; break; }
    }
    for (const b of this.bodies.values()) {
      if (b.dying >= 0) continue;
      if (hasActive && b.n.dimmed) continue;
      // Room for the node box (44x44 + tag) and any trailing lines.
      const trail = b.n.hidden?.length || b.n.closed?.length ? TRAIL_FROM + TRAIL_MAX * 0.7 : 0;
      const rx = Math.max(26, trail);
      const ryTop = Math.max(26, trail);
      const ryBot = Math.max(36, trail);
      x0 = Math.min(x0, b.hx - rx); x1 = Math.max(x1, b.hx + rx);
      y0 = Math.min(y0, b.hy - ryTop); y1 = Math.max(y1, b.hy + ryBot);
    }
    if (x0 > x1) return;
    this.clusterCenter = {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      r: Math.max(120, Math.hypot(x1 - x0, y1 - y0) * 0.45),
    };
    this.area = panArea(x0, y0, x1, y1);
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 300, pad = 16;
    const s = Math.min(1.25, (w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
    this.fit = { s, x: w / 2 - ((x0 + x1) / 2) * s, y: h / 2 - ((y0 + y1) / 2) * s };
    this.minS = s / ZOOM_OUT;
    this.moteArea = coverView(this.area, w, h, this.minS);
    if (now) {
      this.pan = { ...this.fit };
      this.steered = false;
    } else if (this.steered) this.clamp();
  }

  private drop(id: string) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.el.remove();
    this.bodies.delete(id);
  }

  private snap() {
    for (const b of this.bodies.values()) {
      b.x = b.hx;
      b.y = b.hy;
      b.el.classList.remove("sprouting");
    }
    this.pan = { ...this.fit };
    this.draw();
  }

  private tick = (t: number) => {
    if (!this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(1 / 30, this.last ? (t - this.last) / 1000 : 0);
    this.last = t;
    this.now = t;
    if (!this.el.isConnected || this.el.offsetParent === null) return;
    if (this.opts.reduceMotion()) {
      for (const [id, b] of this.bodies) if (b.dying >= 0) this.drop(id);
      for (const b of this.bodies.values()) if (!(this.drag?.id === b.n.id && this.drag.moved)) { b.x = b.hx; b.y = b.hy; }
    } else this.step(dt);
    if (!this.steered) {
      const k = Math.min(1, dt * 6);
      this.pan.x += (this.fit.x - this.pan.x) * k;
      this.pan.y += (this.fit.y - this.pan.y) * k;
      this.pan.s += (this.fit.s - this.pan.s) * k;
    }
    this.draw();
  };

  /** Springs home and along each branch, crowding apart, damping. */
  private step(dt: number) {
    if (!dt) return;
    const live = [...this.bodies.values()].filter((b) => b.dying < 0);
    let buckets: Map<number, Body[]> | null = null;
    if (this.opts.spatialCulling && live.length > 48) {
      buckets = new Map();
      for (const b of live) {
        const gx = Math.floor(b.x / 52) & 0xffff;
        const gy = Math.floor(b.y / 52) & 0xffff;
        const key = (gx << 16) | gy;
        let arr = buckets.get(key);
        if (!arr) {
          arr = [];
          buckets.set(key, arr);
        }
        arr.push(b);
      }
    }
    for (const b of live) {
      let ax = (b.hx - b.x) * 9, ay = (b.hy - b.y) * 9;
      const p = b.n.parent ? this.bodies.get(b.n.parent) : undefined;
      if (p) {
        // Keep the branch's length and lean to its parent.
        const rx = b.hx - p.hx, ry = b.hy - p.hy;
        ax += (p.x + rx - b.x) * 16;
        ay += (p.y + ry - b.y) * 16;
      }
      if (buckets) {
        const cx = Math.floor(b.x / 52), cy = Math.floor(b.y / 52);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const cell = buckets.get(((cx + ox) & 0xffff) << 16 | ((cy + oy) & 0xffff));
            if (!cell) continue;
            for (const o of cell) {
              if (o === b || o.n.id === b.n.parent || o.n.parent === b.n.id) continue;
              const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy;
              if (d2 > 2500 || d2 < 0.01) continue;
              const d = Math.sqrt(d2), f = (50 - d) * 30;
              ax += (dx / d) * f;
              ay += (dy / d) * f;
            }
          }
        }
      } else {
        for (const o of live) {
          // A parent and its child keep apart by their branch, so a sprouting
          // child doesn't shove its parent out of place.
          if (o === b || o.n.id === b.n.parent || o.n.parent === b.n.id) continue;
          const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy;
          if (d2 > 2500 || d2 < 0.01) continue;
          const d = Math.sqrt(d2), f = (50 - d) * 30;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
      b.vx = (b.vx + ax * dt) * Math.exp(-7 * dt);
      b.vy = (b.vy + ay * dt) * Math.exp(-7 * dt);
    }
    for (const b of live) {
      if (this.drag?.id === b.n.id && this.drag.moved) { b.vx = b.vy = 0; continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const [id, b] of this.bodies) {
      if (b.dying < 0) continue;
      b.dying += dt;
      b.vy += 420 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.dying >= WITHER) this.drop(id);
    }
    for (const b of live) {
      if (b.el.classList.contains("sprouting") && Math.abs(b.x - b.hx) + Math.abs(b.y - b.hy) < 6) b.el.classList.remove("sprouting");
    }
  }

  private draw() {
    const { x: px, y: py, s } = this.pan;
    this.view.style.transform = `translate(${px}px, ${py}px) scale(${s})`;
    this.view.style.setProperty("--ug-s", String(s));
    this.el.classList.toggle("ug-hide-labels", s < 0.40);
    for (const b of this.bodies.values()) {
      const w = b.dying >= 0 ? Math.min(1, b.dying / WITHER) : 0;
      b.el.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -50%)${w ? ` rotate(${b.spin * w}deg) scale(${1 - 0.75 * w})` : ""}`;
    }
    this.paintBranches();
    this.paintMotes();
    this.updateTooltip();
  }

  /** The motes over the branches: every live node a swirl, every branch a
   * current from parent to child, in the host's CSS pixels. */
  private paintMotes() {
    if (!this.area) return;
    const nodes: MoteNode[] = [], edges: [string, string][] = [];
    for (const b of this.bodies.values()) {
      if (b.dying >= 0) continue;
      nodes.push({ id: b.n.id, x: b.x, y: b.y });
      if (b.n.parent && this.bodies.has(b.n.parent)) edges.push([b.n.parent, b.n.id]);
    }
    // A mote pixel is half a branch's art pixel.
    this.motes.draw(this.moteCanvas, this.now || performance.now(), { nodes, edges, picked: this.picked || null, area: this.moteArea ?? this.area, view: this.pan, pixel: (ART * this.pan.s) / 2, reduced: this.opts.reduceMotion() });
  }

  /** Keeps the view inside the space it can pan round (`area`): along an
   * axis the area is wider than the view, its edges stay beyond the view's;
   * along one it fits in, it stays centred. */
  private clamp() {
    const a = this.area;
    if (!a) return;
    const { s } = this.pan;
    this.pan.x = clampAxis(this.pan.x, a.x, a.w, this.el.clientWidth, s);
    this.pan.y = clampAxis(this.pan.y, a.y, a.h, this.el.clientHeight, s);
  }

  /** A purchase at node `id`: the motes round it burst outward. */
  burst(id: string) {
    const b = this.bodies.get(id);
    if (b) this.motes.burst(b.x, b.y);
  }

  /** The branches and trailing lines, as pixel art a whole number of device
   * pixels each, under the nodes. */
  private paintBranches() {
    const dpr = window.devicePixelRatio || 1, { x: px, y: py, s } = this.pan;
    const unit = Math.max(1, Math.round(ART * s * dpr));
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    const aw = Math.max(1, Math.ceil((cw * dpr) / unit)), ah = Math.max(1, Math.ceil((ch * dpr) / unit));
    if (this.canvas.width !== aw || this.canvas.height !== ah) {
      this.canvas.width = aw;
      this.canvas.height = ah;
      this.image = null;
    }
    this.canvas.style.width = `${(aw * unit) / dpr}px`;
    this.canvas.style.height = `${(ah * unit) / dpr}px`;
    this.art.resize(aw, ah);
    /** A board point in art pixels. */
    const at = (x: number, y: number) => ({ x: ((px + x * s) * dpr) / unit, y: ((py + y * s) * dpr) / unit });
    const still = this.opts.reduceMotion(), now = performance.now() / 1000;
    const layers: Stroke[][] = [[], [], [], [], []];
    for (const b of this.bodies.values()) {
      const p = b.n.parent ? this.bodies.get(b.n.parent) : undefined;
      if (p) {
        // A branch: a slight curve, sagging more as it withers.
        const w = b.dying >= 0 ? Math.min(1, b.dying / WITHER) : 0;
        const mx = (p.x + b.x) / 2 + (b.y - p.y) * 0.08, my = (p.y + b.y) / 2 + 6 + w * 30;
        const state = b.dying >= 0 ? "withering" : b.n.state;
        const lively = state === "owned" || state === "next";
        const stroke: Stroke = {
          a: at(p.x, p.y), c: at(mx, my), b: at(b.x, b.y),
          tone: state === "owned" && b.n.hue ? this.hue(b) : TONES[state],
          ...(state === "locked" ? { dash: 3 } : {}),
          ...(state === "withering" ? { alpha: 1 - w, crumble: 0.5, fade: 0 } : {}),
          ...(lively ? { glow: true } : {}),
          ...(lively && !still && !b.el.classList.contains("sprouting") ? { mote: (now / (state === "owned" ? 2.4 : 1.6) + seedOf(b.n.id)) % 1 } : {}),
        };
        layers[state === "owned" ? 4 : state === "next" ? 3 : state === "withering" ? 2 : 1].push(stroke);
      }
      if (b.dying < 0) this.trails(b, at, layers);
    }
    for (const [fromId, toId] of this.secondaryEdges) {
      const a = this.bodies.get(fromId), b = this.bodies.get(toId);
      if (!a || !b || a.dying >= 0 || b.dying >= 0) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 14;
      const bothOwned = a.n.state === "owned" && b.n.state === "owned";
      layers[bothOwned ? 3 : 0].push({
        a: at(a.x, a.y),
        c: at(mx, my),
        b: at(b.x, b.y),
        tone: bothOwned ? TONES.owned : TONES.locked,
        dash: bothOwned ? 2 : 4,
        alpha: bothOwned ? 0.7 : 0.4,
      });
    }
    this.art.draw(layers.flat());
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    if (!this.image) this.image = ctx.createImageData(aw, ah);
    new Uint32Array(this.image.data.buffer).set(this.art.pix);
    ctx.putImageData(this.image, 0, 0);
  }

  /** `b`'s trailing lines, each fading off toward where its branch would
   * stand (hidden) or stood (closed): what buying it would open, bright and
   * straight; what a choice cut off, withered, drooping and crumbling. */
  private trails(b: Body, at: (x: number, y: number) => Pt, layers: Stroke[][]) {
    // Hidden branches fan out away from its parent, leaning up, as the tree
    // grows outward.
    let ax = 0, ay = -1;
    const p = b.n.parent ? this.bodies.get(b.n.parent) : undefined;
    if (p) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
      ax = dx / d;
      ay = dy / d - 0.5;
      const u = Math.hypot(ax, ay) || 1;
      ax /= u;
      ay /= u;
    }
    const hidden = b.n.hidden?.length ?? 0;
    const lines = [
      ...(b.n.hidden ?? []).map((slot) => ({ slot, closed: false })),
      ...(b.n.closed ?? []).map((slot) => ({ slot, closed: true })),
    ];
    lines.forEach(({ slot, closed }, i) => {
      let dx: number, dy: number;
      if (closed && b.n.took) [dx, dy] = trailAim(slot, b.n.took, !b.n.parent);
      else {
        const a = (i - (hidden - 1) / 2) * 0.42, c = Math.cos(a), s = Math.sin(a);
        [dx, dy] = [(ax * c - ay * s) * GAP_Y, (ax * s + ay * c) * GAP_Y];
      }
      const d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const len = closed ? Math.min(TRAIL_MAX, Math.max(46, d * 0.6)) : 52;
      const x0 = b.x + ux * TRAIL_FROM, y0 = b.y + uy * TRAIL_FROM;
      let x1 = x0 + ux * len, y1 = y0 + uy * len, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (closed) {
        // Withered: it droops as it goes.
        y1 += len * 0.18;
        cy += len * 0.16;
      } else {
        // Alive: a slight bow away from the middle.
        const bow = (ux >= 0 ? 1 : -1) * 4;
        cx += -uy * bow;
        cy += ux * bow;
      }
      const tone = closed ? TONES.closed : b.n.state === "locked" ? TONES.dim : TONES.hidden;
      layers[0].push({
        a: at(x0, y0), c: at(cx, cy), b: at(x1, y1), tone,
        fade: closed ? 0.12 : 0.22,
        ...(closed ? { crumble: 0.45, seed: seedOf(b.n.id) * 9973 + i } : {}),
      });
    });
  }

  /** A path colour's tones, from its `--hue` and `--hue-deep`. */
  private hue(b: Body): Tone {
    const key = b.n.hue!;
    let t = this.hues.get(key);
    if (!t) {
      const css = getComputedStyle(b.el), light = css.getPropertyValue("--hue").trim(), deep = css.getPropertyValue("--hue-deep").trim();
      t = light && deep ? { light: mix(light, "#ffffff", 0.55), base: rgb(light), shade: rgb(deep) } : TONES.owned;
      this.hues.set(key, t);
    }
    return t;
  }

  // ── Pointers ──────────────────────────────────────────────────────────
  private local(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.pan.x) / this.pan.s, y: (e.clientY - r.top - this.pan.y) / this.pan.s };
  }

  private down = (e: PointerEvent) => {
    if ((e.target as Element).closest("[data-ug-ignore]")) return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size > 1) {
      this.drag = null;
      return;
    }
    const node = (e.target as Element).closest<HTMLElement>(".ug-node");
    const id = node?.dataset.node ?? "";
    this.drag = { id, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ...(id ? {} : { pan: { x: this.pan.x, y: this.pan.y } }) };
    this.el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  private move = (e: PointerEvent) => {
    const prev = this.pinch.get(e.pointerId);
    if (prev && this.pinch.size === 2) {
      // Two fingers: zoom about their middle.
      const [a, b] = [...this.pinch.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, d] = [...this.pinch.values()];
      const after = Math.hypot(c.x - d.x, c.y - d.y);
      if (before > 0) this.zoom(after / before, (c.x + d.x) / 2, (c.y + d.y) / 2);
      return;
    }
    if (prev) this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.drag;
    if (!g) {
      const node = (e.target as Element).closest<HTMLElement>(".ug-node");
      const hid = node?.dataset.node ?? "";
      if (hid !== this.hoveredId) {
        this.hoveredId = hid;
        this.updateTooltip();
      }
      return;
    }
    if (g.pointer !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 5) g.moved = true;
    if (!g.moved) return;
    if (g.pan) {
      this.steered = true;
      this.pan.x = g.pan.x + e.clientX - g.x0;
      this.pan.y = g.pan.y + e.clientY - g.y0;
      this.clamp();
      if (this.opts.reduceMotion()) this.draw();
      return;
    }
    const b = this.bodies.get(g.id);
    if (!b) return;
    const p = this.local(e);
    b.x = p.x;
    b.y = p.y;
    b.el.classList.add("dragged");
    if (this.opts.reduceMotion()) this.draw();
  };

  private up = (e: PointerEvent) => {
    this.pinch.delete(e.pointerId);
    const g = this.drag;
    if (!g || g.pointer !== e.pointerId) return;
    this.drag = null;
    const b = this.bodies.get(g.id);
    b?.el.classList.remove("dragged");
    if (e.type === "pointerup" && !g.moved && g.id) this.opts.onPick(g.id);
    if (this.opts.reduceMotion()) this.snap();
  };

  private leave = () => {
    if (this.hoveredId) {
      this.hoveredId = "";
      this.updateTooltip();
    }
  };

  private updateTooltip() {
    const id = this.hoveredId || (this.pan.s < 0.40 ? this.picked : "");
    const b = id ? this.bodies.get(id) : undefined;
    const text = b && b.dying < 0 ? (b.n.label ?? b.n.tag ?? "") : "";
    if (!text) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    const cw = this.el.clientWidth || 300;
    const ch = this.el.clientHeight || 300;
    const sx = this.pan.x + b!.x * this.pan.s;
    const sy = this.pan.y + (b!.y - 26) * this.pan.s;
    const tx = Math.max(60, Math.min(cw - 60, sx));
    const ty = Math.max(24, Math.min(ch - 12, sy));
    this.tooltip.style.left = `${tx}px`;
    this.tooltip.style.top = `${ty}px`;
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };

  private zoom(f: number, cx: number, cy: number) {
    const r = this.el.getBoundingClientRect(), s = Math.max(this.minS, Math.min(Math.max(2.5, this.minS), this.pan.s * f));
    const k = s / this.pan.s, x = cx - r.left, y = cy - r.top;
    this.pan = { s, x: x - (x - this.pan.x) * k, y: y - (y - this.pan.y) * k };
    this.clamp();
    this.steered = true;
    if (this.opts.reduceMotion()) this.draw();
  }
}

/** A steady fraction, 0 to 1, from a node's id. */
const seedOf = (id: string) => {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 1000) / 1000;
};

/** `a` taken `t` of the way to `b`, as a packed pixel. */
const mix = (a: string, b: string, t: number) => {
  const n = (h: string) => parseInt(h.replace("#", "").slice(0, 6), 16);
  const p = n(a), q = n(b), ch = (s: number) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
  return rgb(`#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`);
};

/** Where a choice beside its parent stands, from it: left and right a little
 * below, row under row (the root's odd one out straight below). */
function sideSpot(i: number, n: number, root: boolean): [number, number] {
  if (root && n % 2 && i === n - 1) return [0, GAP_Y];
  const lr = i % 2 ? 1 : -1, row = Math.floor(i / 2);
  return [lr * GAP_X * 1.2, GAP_Y * (0.35 + row * 0.95)];
}

/** Which way, from its node, a closed-off branch's trailing line heads:
 * toward where the branch in `slot` stood before the node `took` another (the one
 * taken now carries on straight up, so the ones it passed over keep to its
 * side: a path to the right of the one taken trails off up and right). */
export function trailAim(slot: Slot, took: Slot, root: boolean): [number, number] {
  if (slot.side) return sideSpot(slot.i, slot.n, root);
  let col: number;
  if (!took.side) col = slot.i - took.i;
  else {
    // It became another building, which now stands straight up: the paths
    // part round it.
    const mid = Math.ceil(slot.n / 2);
    col = (slot.i < mid ? slot.i : slot.i + 1) - mid;
  }
  return [col * GAP_X, -GAP_Y];
}

/** Each node's place: branches carrying on from a node grow up from it in
 * a tidy tree (leaves side by side, each parent over the middle of its
 * children, the root at the bottom); `side` nodes, choices down another
 * branch, sit to its left and right a little below it, row under row (the
 * root's odd one out straight below it). */
export function layout(nodes: readonly { id: string; parent?: string; side?: boolean }[]): Map<string, [number, number]> {
  const up = new Map<string, string[]>(), side = new Map<string, string[]>(), at = new Map<string, [number, number]>();
  const ids = new Set(nodes.map((n) => n.id));
  const roots: string[] = [];
  for (const n of nodes) {
    if (!n.parent || !ids.has(n.parent)) roots.push(n.id);
    else {
      const to = n.side ? side : up;
      to.set(n.parent, [...(to.get(n.parent) ?? []), n.id]);
    }
  }
  /** Leaves across a node's upward tree. */
  const width = (id: string): number => (up.get(id) ?? []).reduce((w, k) => w + width(k), 0) || 1;
  const place = (id: string, x: number, y: number, root: boolean) => {
    at.set(id, [x, y]);
    let left = x - ((width(id) - 1) / 2) * GAP_X;
    for (const k of up.get(id) ?? []) {
      const w = width(k);
      place(k, left + ((w - 1) / 2) * GAP_X, y - GAP_Y, false);
      left += w * GAP_X;
    }
    const sides = side.get(id) ?? [];
    sides.forEach((k, i) => {
      const [dx, dy] = sideSpot(i, sides.length, root);
      place(k, x + dx, y + dy, false);
    });
  };
  let x = 0;
  for (const r of roots) {
    place(r, x, 0, true);
    x += (width(r) + 2) * GAP_X;
  }
  return at;
}

/** Each node's place in a web round its root: every branch out from the
 * root along its own spoke, the room round each ring shared out by how many
 * leaves each branch ends in, each ring a step further out. */
export function webLayout(nodes: readonly { id: string; parent?: string }[]): Map<string, [number, number]> {
  const kids = new Map<string, string[]>(), at = new Map<string, [number, number]>();
  const ids = new Set(nodes.map((n) => n.id));
  const roots: string[] = [];
  for (const n of nodes) {
    if (!n.parent || !ids.has(n.parent)) roots.push(n.id);
    else kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  }
  const leaves = (id: string): number => (kids.get(id) ?? []).reduce((w, k) => w + leaves(k), 0) || 1;
  let x = 0;
  for (const r of roots) {
    const total = leaves(r);
    // Rings far enough apart that leaves two or three rings out sit a gap apart.
    const ring = Math.max(GAP_Y * 1.15, (total * GAP_X) / (2 * Math.PI * 2.5));
    const place = (id: string, depth: number, a0: number, a1: number) => {
      const a = (a0 + a1) / 2;
      at.set(id, depth ? [x + Math.cos(a) * ring * depth, Math.sin(a) * ring * depth] : [x, 0]);
      let from = a0;
      const all = leaves(id);
      for (const k of kids.get(id) ?? []) {
        const span = ((a1 - a0) * leaves(k)) / all;
        place(k, depth + 1, from, from + span);
        from += span;
      }
    };
    // Starting straight down, so the first branches open up the left.
    place(r, 0, Math.PI / 2, Math.PI / 2 + 2 * Math.PI);
    x += ring * 2 * 9;
  }
  return at;
}

/** How far past the tree the view can pan, a share of the tree's size each
 * way (at least `PAN_MIN` pixels, so a small tree still has room round it). */
export const PAN_MARGIN = 0.2, PAN_MIN = 60;
/** How far past fitting the whole tree the view zooms out: a quarter more. */
export const ZOOM_OUT = 1.25;

/** `area` widened about its middle, along each axis it falls short, to cover
 * a `w` by `h` view at zoom `s`. */
export function coverView(area: MoteArea, w: number, h: number, s: number): MoteArea {
  const cw = Math.max(area.w, w / s), ch = Math.max(area.h, h / s);
  return { x: area.x + (area.w - cw) / 2, y: area.y + (area.h - ch) / 2, w: cw, h: ch };
}

/** The space a tree spanning (x0, y0) to (x1, y1) can be panned round:
 * `PAN_MARGIN` of its width more on the left and right, of its height above
 * and below. */
export function panArea(x0: number, y0: number, x1: number, y1: number): MoteArea {
  const mx = Math.max(PAN_MIN, (x1 - x0) * PAN_MARGIN), my = Math.max(PAN_MIN, (y1 - y0) * PAN_MARGIN);
  return { x: x0 - mx, y: y0 - my, w: x1 - x0 + mx * 2, h: y1 - y0 + my * 2 };
}

/** A pan offset `p` along one axis held so the area from `a0`, `len` long,
 * covers the view (`view` pixels at zoom `s`) when it is bigger, else sits
 * centred in it. */
export function clampAxis(p: number, a0: number, len: number, view: number, s: number) {
  if (!view) return p;
  if (len * s <= view) return view / 2 - (a0 + len / 2) * s;
  return Math.min(-a0 * s, Math.max(view - (a0 + len) * s, p));
}
