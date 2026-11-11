/** Loading screen animation and startup handoff.
 * Fully self-contained: zero dependencies on retired medieval game systems.
 * Never consumes a game random stream or changes player state. */

import { BAR_WIDTH, BAR_HEIGHT, paintLoadingBar } from "./farmland-bar.ts";

const LOAD_DURATION_MS = 1200;
const SETTLE_MS = 150;
const HANDOFF_MS = LOAD_DURATION_MS + SETTLE_MS + 1500;

export class LoadingScreen {
  private readonly stones: HTMLCanvasElement;
  private readonly bar: HTMLCanvasElement;
  private last = performance.now();
  private elapsed = 0;
  private frame = 0;
  private ready = false;
  private finish: (() => void) | null = null;
  private paintFailed = false;

  constructor(private root: HTMLElement, private reduced: () => boolean) {
    this.stones = root.querySelector<HTMLCanvasElement>(".loading-stones")!;
    this.bar = root.querySelector<HTMLCanvasElement>(".loading-bar")!;
    if (this.bar) {
      this.bar.width = BAR_WIDTH;
      this.bar.height = BAR_HEIGHT;
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
  }

  private draw = () => {
    this.advance();
    try {
      this.paint();
    } catch (error) {
      if (!this.paintFailed) console.error("Loading screen paint failed", error);
      this.paintFailed = true;
    }
    if (this.ready && (this.reduced() || this.elapsed >= LOAD_DURATION_MS + SETTLE_MS)) {
      this.finish?.();
      return;
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  private paint() {
    const now = performance.now(), reduced = this.reduced();
    this.fitCanvases();

    // 1. Paint background cosmic void / vignette
    if (this.stones) {
      const c = this.stones.getContext("2d");
      if (c) {
        const w = this.stones.width, h = this.stones.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = "#0c0a09";
        c.fillRect(0, 0, w, h);

        // Cosmic nebula vignette
        const pulse = reduced ? 0.8 : 0.75 + 0.08 * Math.sin(now * 0.002);
        const grad = c.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
        grad.addColorStop(0, `rgba(45, 10, 65, ${0.45 * pulse})`);
        grad.addColorStop(0.4, `rgba(18, 5, 30, ${0.3 * pulse})`);
        grad.addColorStop(1, "rgba(5, 2, 8, 0.92)");
        c.fillStyle = grad;
        c.fillRect(0, 0, w, h);
      }
    }

    // 2. Paint farmland void-eaten progress bar
    if (this.bar) {
      const progress = reduced
        ? (this.ready ? 1.0 : 0.9)
        : Math.min(this.ready ? 1.0 : 0.92, this.elapsed / LOAD_DURATION_MS);
      const c = this.bar.getContext("2d");
      if (c) {
        paintLoadingBar(c, progress, now);
      }
    }
  }

  private advance() {
    const time = performance.now();
    this.elapsed += Math.min(50, time - this.last);
    this.last = time;
    if (!this.ready) this.elapsed = Math.min(this.elapsed, LOAD_DURATION_MS * 0.92);
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
    if (this.bar) this.bar.hidden = true;
    this.showRetry();
  }

  private showRetry() {
    const retry = this.root.querySelector<HTMLButtonElement>(".loading-retry");
    if (!retry) return;
    retry.hidden = false;
    retry.onclick = () => location.reload();
  }
}
