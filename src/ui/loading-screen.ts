/** Loading screen animation and startup handoff.
 * Fully self-contained: zero dependencies on retired medieval game systems.
 * Never consumes a game random stream or changes player state. */

import { BRICKS, W, TOP, COURSE, paintBrick, paintBrickBed } from "./brick-wall.ts";

const DROP = 16, BRICK_MS = 90, SETTLE_MS = 100;
const ORDER = [...BRICKS].sort((a, b) => b.y - a.y || a.x - b.x);
const target = (ready: boolean) => ready ? ORDER.length : ORDER.length - 1;
const HANDOFF_MS = ORDER.length * BRICK_MS + SETTLE_MS + 1500;

export class LoadingScreen {
  private readonly stones: HTMLCanvasElement;
  private readonly torch: HTMLCanvasElement;
  private readonly bricks: HTMLCanvasElement;
  private last = performance.now();
  private elapsed = 0;
  private frame = 0;
  private ready = false;
  private finish: (() => void) | null = null;
  private paintFailed = false;

  constructor(private root: HTMLElement, private reduced: () => boolean) {
    this.stones = root.querySelector<HTMLCanvasElement>(".loading-stones")!;
    this.torch = root.querySelector<HTMLCanvasElement>(".loading-torch")!;
    this.bricks = root.querySelector<HTMLCanvasElement>(".loading-bricks")!;
    if (this.bricks) {
      this.bricks.width = W;
      this.bricks.height = DROP + TOP + COURSE * 2 + 1;
    }
    this.fitCanvases();
    this.draw();
  }

  private fitCanvases() {
    if (!this.stones) return;
    const rect = this.root.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || window.innerWidth));
    const h = Math.max(240, Math.round(rect.height || window.innerHeight));
    if (this.stones.width !== w || this.stones.height !== h) {
      this.stones.width = w;
      this.stones.height = h;
    }
    if (this.torch) {
      this.torch.width = 33;
      this.torch.height = 72;
    }
  }

  private draw = () => {
    this.advance();
    try {
      this.paint();
    } catch (error) {
      if (!this.paintFailed) console.error("Loading screen paint failed", error);
      this.paintFailed = true;
    }
    if (this.ready && (this.reduced() || this.elapsed >= ORDER.length * BRICK_MS + SETTLE_MS)) {
      this.finish?.();
      return;
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  private paint() {
    const now = performance.now(), reduced = this.reduced();
    this.fitCanvases();

    // 1. Paint background stones / vignette
    if (this.stones) {
      const c = this.stones.getContext("2d");
      if (c) {
        const w = this.stones.width, h = this.stones.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = "#121110";
        c.fillRect(0, 0, w, h);

        // Torch glow / flicker
        const flicker = reduced ? 0.8 : 0.75 + 0.1 * Math.sin(now * 0.007) + 0.05 * Math.cos(now * 0.019);
        const grad = c.createRadialGradient(w * 0.12, h * 0.35, 10, w * 0.12, h * 0.35, Math.max(w, h) * 0.85);
        grad.addColorStop(0, `rgba(255, 160, 50, ${0.28 * flicker})`);
        grad.addColorStop(0.3, `rgba(180, 80, 20, ${0.12 * flicker})`);
        grad.addColorStop(1, "rgba(0, 0, 0, 0.75)");
        c.fillStyle = grad;
        c.fillRect(0, 0, w, h);
      }
    }

    // 2. Paint torch sconce & flame
    if (this.torch) {
      const c = this.torch.getContext("2d");
      if (c) {
        c.clearRect(0, 0, this.torch.width, this.torch.height);
        // Bracket
        c.fillStyle = "#2c2824";
        c.fillRect(14, 30, 5, 32);
        c.fillStyle = "#3d3732";
        c.fillRect(10, 24, 13, 6);

        // Flame
        const flameH = reduced ? 18 : 16 + 4 * Math.sin(now * 0.012);
        const flameW = reduced ? 10 : 9 + 2 * Math.cos(now * 0.015);
        c.fillStyle = "#ff5500";
        c.beginPath();
        c.ellipse(16.5, 20, flameW / 2, flameH / 2, 0, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = "#ffcc00";
        c.beginPath();
        c.ellipse(16.5, 21, flameW / 3, flameH / 3, 0, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = "#ffffff";
        c.beginPath();
        c.ellipse(16.5, 22, flameW / 5, flameH / 5, 0, 0, Math.PI * 2);
        c.fill();
      }
    }

    // 3. Paint brick progress bar
    if (this.bricks) {
      const elapsed = this.elapsed;
      const laid = reduced ? target(this.ready) : Math.min(target(this.ready), Math.floor(elapsed / BRICK_MS));
      const c = this.bricks.getContext("2d");
      if (c) {
        c.clearRect(0, 0, this.bricks.width, this.bricks.height);
        c.save();
        c.translate(0, DROP);
        paintBrickBed(c);
        for (let i = 0; i < laid; i++) paintBrick(c, ORDER[i]);
        if (!reduced && laid < target(this.ready)) {
          const fall = (elapsed % BRICK_MS) / BRICK_MS;
          const b = ORDER[laid];
          paintBrick(c, { ...b, y: b.y - Math.round((1 - fall * fall) * (DROP + b.y)) });
        }
        c.restore();
      }
    }
  }

  private advance() {
    const time = performance.now();
    this.elapsed += Math.min(50, time - this.last);
    this.last = time;
    if (!this.ready) this.elapsed = Math.min(this.elapsed, target(false) * BRICK_MS);
  }

  complete(): Promise<void> {
    return new Promise(resolve => {
      let done = false;
      const fallback = setTimeout(() => this.finish?.(), HANDOFF_MS);
      this.finish = () => {
        if (done) return;
        done = true;
        clearTimeout(fallback);
        cancelAnimationFrame(this.frame);
        this.root.remove();
        document.documentElement.classList.remove("game-loading");
        const app = document.querySelector<HTMLElement>("#app")!;
        if (app) {
          app.inert = false;
          app.removeAttribute("aria-busy");
        }
        resolve();
      };
      this.ready = true;
    });
  }

  slow() {
    if (!this.root.isConnected) return;
    this.showRetry();
  }

  fail() {
    if (!this.root.isConnected) return;
    cancelAnimationFrame(this.frame);
    this.root.setAttribute("aria-label", "Unable to load the game. Try again.");
    const label = this.root.querySelector<HTMLElement>(".loading-label");
    if (label) label.textContent = "Unable to load game";
    if (this.bricks) this.bricks.hidden = true;
    this.showRetry();
  }

  private showRetry() {
    const retry = this.root.querySelector<HTMLButtonElement>(".loading-retry");
    if (!retry) return;
    retry.hidden = false;
    retry.onclick = () => location.reload();
  }
}
