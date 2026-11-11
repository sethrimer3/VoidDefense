/** Resistance Operations ambient scene:
 * 1. Engineering Bay (left/top zone): 1x2-pixel engineers on scaffolding
 *    welding and testing an enormous experimental turret prototype that
 *    physically evolves as weapon, shield, and constructor branches are unlocked.
 * 2. Research Lab (right/bottom zone): 1x2-pixel researchers scanning captured
 *    Void nebula specimens in crystalline containment chambers.
 *
 * Strictly cosmetic: never generates offline income, never uses wall-clock
 * catch-up, and pauses cleanly when hidden or on another tab. */

import { evaluateTech, totalEarnedSparks, type VoidTechWallet } from "../tech/wallet.ts";

type TinyWorker = {
  x: number;
  y: number;
  targetX: number;
  zone: "bay" | "lab";
  role: "welder" | "hauler" | "researcher";
  timer: number;
};

export class ResistanceOperationsView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly workers: TinyWorker[] = [];
  private lastTime = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly getWallet: () => VoidTechWallet,
    private readonly reduceMotion: () => boolean,
    private readonly onOpenTechTree: () => void,
  ) {
    this.host.classList.add("void-ops-view");
    this.host.innerHTML = `
      <header class="void-ops-header">
        <div>
          <strong>Resistance Operations: Engineering Bay & Void Research Lab</strong>
          <small>Live prototype assembly and containment telemetry. Reflects your unlocked global technologies (cosmetic ambient scene; zero offline/idle farming).</small>
        </div>
        <button type="button" class="secondary-btn" data-ops-tech>Open Global Tech Network</button>
      </header>
      <div class="void-ops-canvas-wrap">
        <canvas class="void-ops-canvas" width="320" height="160"></canvas>
      </div>
      <div class="void-ops-status" data-ops-status></div>
    `;

    this.canvas = this.host.querySelector<HTMLCanvasElement>(".void-ops-canvas")!;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.host.querySelector<HTMLButtonElement>("[data-ops-tech]")!.onclick = () =>
      this.onOpenTechTree();

    // Seed 14 tiny 1x2 personnel across the Bay and Lab
    for (let i = 0; i < 8; i++) {
      const x = 18 + i * 16;
      this.workers.push({
        x,
        y: i % 2 === 0 ? 128 : 96,
        targetX: 35 + ((i * 23) % 95),
        zone: "bay",
        role: i % 2 === 0 ? "welder" : "hauler",
        timer: i * 0.4,
      });
    }
    for (let i = 0; i < 6; i++) {
      const x = 178 + i * 20;
      this.workers.push({
        x,
        y: 128,
        targetX: 180 + ((i * 31) % 120),
        zone: "lab",
        role: "researcher",
        timer: i * 0.5,
      });
    }
  }

  renderStatus(): void {
    const wallet = this.getWallet();
    const tech = evaluateTech(wallet.ranks);
    const sparks = totalEarnedSparks(wallet);
    const unlockedCount = Object.values(wallet.ranks).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    const statusEl = this.host.querySelector<HTMLElement>("[data-ops-status]")!;
    statusEl.innerHTML = `
      <span><b>Engineering Bay:</b> Mark-${Math.min(5, 1 + Math.floor(unlockedCount / 4))} Matter/Thermal Prototype (${tech.unlockedTowers.size} Tower Systems Active)</span>
      <span><b>Research Lab:</b> ${Math.min(4, 1 + Math.floor(sparks / 2))} Void Containment Chambers (${unlockedCount} Nodes Researched)</span>
    `;
  }

  frame(nowMs: number): void {
    const dt = this.lastTime ? Math.min(0.05, (nowMs - this.lastTime) / 1000) : 0.016;
    this.lastTime = nowMs;
    if (!this.reduceMotion()) {
      this.stepWorkers(dt, nowMs);
    }
    this.draw(nowMs);
  }

  private stepWorkers(dt: number, nowMs: number): void {
    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[i];
      const dx = w.targetX - w.x;
      if (Math.abs(dx) > 1.2) {
        w.x += Math.sign(dx) * 14 * dt;
      } else {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = 1.5 + ((i * 7 + Math.floor(nowMs * 0.001)) % 3);
          w.targetX =
            w.zone === "bay"
              ? 18 + ((Math.floor(nowMs * 0.03) + i * 29) % 124)
              : 175 + ((Math.floor(nowMs * 0.03) + i * 37) % 128);
        }
      }
    }
  }

  private draw(nowMs: number): void {
    const wallet = this.getWallet();
    const tech = evaluateTech(wallet.ranks);
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.imageSmoothingEnabled = false;

    // Background steel & charcoal bulkhead
    c.fillStyle = "#10141c";
    c.fillRect(0, 0, W, H);

    // Center divider bulkhead between Engineering Bay (0..158) and Research Lab (162..320)
    c.fillStyle = "#262e3d";
    c.fillRect(158, 0, 4, H);
    c.fillStyle = "#1b212c";
    c.fillRect(0, 132, W, 28); // Floor deck
    c.fillStyle = "#f28d35";
    for (let x = 4; x < W; x += 12) {
      c.fillRect(x, 133, 6, 1); // Hazard deck stripe
    }

    // ── Zone 1: Engineering Bay (Enormous Turret Prototype + 1x2 Engineers) ──
    // Overhead gantry crane
    c.fillStyle = "#2b3342";
    c.fillRect(10, 12, 140, 5);
    const craneX = 55 + Math.round(Math.sin(nowMs * 0.001) * 28);
    c.fillStyle = "#d4882a";
    c.fillRect(craneX, 17, 6, 18);

    // Scaffolding levels
    c.fillStyle = "#364052";
    c.fillRect(18, 98, 124, 2);
    c.fillRect(28, 66, 104, 2);
    for (let sx = 24; sx <= 136; sx += 28) {
      c.fillRect(sx, 66, 2, 66);
    }

    // Giant experimental turret prototype in the center of the Bay (scale contrast vs 1x2 workers)
    const tx = 54;
    const ty = 58;
    // Heavy base pedestal
    c.fillStyle = "#28303d";
    c.fillRect(tx - 12, 108, 68, 24);
    c.fillStyle = "#455063";
    c.fillRect(tx - 6, 92, 56, 16);
    // Main armored turret housing
    c.fillStyle = "#3b4659";
    c.fillRect(tx, ty, 44, 34);
    c.fillStyle = "#f28d35";
    c.fillRect(tx + 4, ty + 6, 36, 4);

    // Evolving modules based on unlocked tech branches
    if (tech.matterCannonSpeedMultiplier > 1) {
      // Twin heavy rotary barrels
      c.fillStyle = "#6c7a91";
      c.fillRect(tx + 44, ty + 8, 26, 6);
      c.fillRect(tx + 44, ty + 18, 26, 6);
      c.fillStyle = "#ffaa33";
      c.fillRect(tx + 68, ty + 9, 3, 4);
      c.fillRect(tx + 68, ty + 19, 3, 4);
    } else {
      c.fillStyle = "#5a667a";
      c.fillRect(tx + 44, ty + 12, 20, 8);
    }

    if (tech.unlockedTowers.has("shieldProjector")) {
      // Glowing cyan capacitor coils on top of turret
      c.fillStyle = "#45d1e6";
      c.fillRect(tx + 10, ty - 8, 8, 8);
      c.fillRect(tx + 24, ty - 8, 8, 8);
    }

    if (tech.unlockedTowers.has("wallSerpent") || tech.unlockedTowers.has("heavyMechBay")) {
      // Side exomech / serpent fabrication bay
      c.fillStyle = "#ffa630";
      c.fillRect(18, 114, 14, 18);
      c.fillStyle = "#6ef3ff";
      c.fillRect(21, 118, 8, 6);
    }

    // ── Zone 2: Research Lab (Captured Void Nebula Specimens & Analyzers) ──
    const chambers = Math.min(4, 1 + Math.floor(Object.keys(wallet.ranks).length / 3));
    for (let i = 0; i < chambers; i++) {
      const cx = 176 + i * 34;
      const cy = 74;
      // Containment cylinder frame
      c.fillStyle = "#2d3748";
      c.fillRect(cx, cy, 22, 58);
      // Glass tube with starry Void specimen inside
      c.fillStyle = "#110926";
      c.fillRect(cx + 3, cy + 6, 16, 44);
      const pulse = Math.sin(nowMs * 0.004 + i) * 3;
      c.fillStyle = i % 2 === 0 ? "#b85cff" : "#6ef3ff";
      c.fillRect(cx + 8, cy + 24 + Math.round(pulse), 6, 6);
      c.fillStyle = "#ffffff";
      c.fillRect(cx + 10, cy + 26 + Math.round(pulse), 2, 2);
      // Console monitor beside chamber
      c.fillStyle = "#1f2733";
      c.fillRect(cx + 23, 114, 8, 18);
      c.fillStyle = "#45d1e6";
      c.fillRect(cx + 24, 116, 6, 5);
    }

    // Draw 1x2-art-pixel engineers and researchers (scaled 2x2 per pixel for crisp visibility)
    for (const w of this.workers) {
      const wx = Math.round(w.x);
      const wy = Math.round(w.y);
      if (w.zone === "bay") {
        // Warm orange/amber engineer (2px wide, 4px tall = 1x2 art ratio)
        c.fillStyle = "#ff9933";
        c.fillRect(wx, wy - 4, 2, 2);
        c.fillStyle = "#d96b27";
        c.fillRect(wx, wy - 2, 2, 2);
        // Welding sparks when paused near prototype
        if (Math.abs(w.targetX - w.x) <= 1.5 && Math.sin(nowMs * 0.03 + w.x) > 0.2) {
          c.fillStyle = "#fff3a1";
          c.fillRect(wx + 2, wy - 4, 1, 1);
          c.fillStyle = "#ff7722";
          c.fillRect(wx + 3, wy - 5, 1, 1);
        }
      } else {
        // Steel/cyan lab researcher (1x2 art ratio)
        c.fillStyle = "#7afcff";
        c.fillRect(wx, wy - 4, 2, 2);
        c.fillStyle = "#cbd5e1";
        c.fillRect(wx, wy - 2, 2, 2);
      }
    }
  }
}
