/** The Resistance Ops tab, laid out and drawn like the TowerDefense Library
 * and Mine: a plaque button and tally over a tools row, then a framed,
 * pannable and zoomable pixel-art view (`art.ts`) of the Engineering Bay and
 * the Research Lab, lit per pixel. The crew (`crew.ts`) work the floor:
 * welders on the scaffold and round the experimental prototype, riggers
 * hauling plates from the crates, researchers at the containment chambers.
 * Tap one, or a name in the crew list, to follow them.
 *
 * The prototype grows a module for each tower system unlocked in the Global
 * Tech Network and gains armour with its mark; a chamber fills with a
 * captured Void specimen for every two Sparks earned.
 *
 * Strictly cosmetic: never generates offline income, never uses wall-clock
 * catch-up, and only advances in frames drawn while the tab shows. */

import { evaluateTech, totalEarnedSparks, type VoidTechWallet } from "../tech/wallet.ts";
import { OperationsRenderer, type OpsLook } from "./art.ts";
import { CHAMBER_SLOTS } from "./geometry.ts";
import { OperationsCrew, crewSize, type CrewMember } from "./crew.ts";

const ROMAN = ["I", "II", "III", "IV", "V"];
const ROLE_LABEL: Record<CrewMember["role"], string> = { welder: "Welder", rigger: "Rigger", researcher: "Researcher" };
const DUTY_LABEL: Record<CrewMember["goal"]["duty"], string> = {
  weld: "welding", haul: "hauling", fetch: "fetching plate", scan: "scanning", gaze: "watching the Void", rest: "on break",
};
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class ResistanceOperationsView {
  private readonly renderer: OperationsRenderer;
  private readonly crew = new OperationsCrew();
  private look!: OpsLook;
  private lastTime = 0;
  /** Seconds of animation shown so far (held still under reduced motion). */
  private time = 0;
  private framed: "bay" | "lab" | null = null;
  private crewKey = "";
  private listedAt = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly getWallet: () => VoidTechWallet,
    private readonly reduceMotion: () => boolean,
    private readonly onOpenTechTree: () => void,
  ) {
    this.host.classList.add("void-ops-view");
    this.host.innerHTML = `
      <div class="mine-head ops-head">
        <button type="button" class="mine-hire" data-ops-tech title="Unlock tower systems to build them into the prototype">
          ✦ Global Tech Network
          <small>Upgrade the prototype</small>
        </button>
        <p class="mine-tally" data-ops-tally></p>
      </div>
      <div class="mine-tools">
        <button type="button" class="mine-crew-toggle" data-ops-crew-toggle aria-pressed="false" aria-controls="void-ops-crew">☰ Crew</button>
        <p class="mine-prospect" data-ops-prospect></p>
        <button type="button" data-ops-frame title="Glide to the Engineering Bay, the Research Lab, or the whole floor">⤢ Bay</button>
      </div>
      <div class="mine-body" data-ops-body>
        <aside class="mine-crew" id="void-ops-crew" aria-label="The crew" aria-hidden="true">
          <section class="crew-box" data-ops-group="bay"><h3>Engineering Bay <b data-ops-count="bay">0</b></h3><ul></ul></section>
          <section class="crew-box" data-ops-group="lab"><h3>Research Lab <b data-ops-count="lab">0</b></h3><ul></ul></section>
          <p class="crew-hint">Tap a name, or a figure in the view, to follow them. Tap the empty floor to let go. Purely an ambient view: it earns nothing.</p>
        </aside>
        <div class="mine-view ops-view"><canvas class="void-ops-canvas" aria-label="Engineering Bay and Research Lab"></canvas></div>
      </div>
    `;

    const canvas = this.host.querySelector<HTMLCanvasElement>(".void-ops-canvas")!;
    this.renderer = new OperationsRenderer(canvas);
    this.host.querySelector<HTMLButtonElement>("[data-ops-tech]")!.onclick = () => this.onOpenTechTree();
    const toggle = this.host.querySelector<HTMLButtonElement>("[data-ops-crew-toggle]")!;
    const body = this.host.querySelector<HTMLElement>("[data-ops-body]")!;
    const aside = this.host.querySelector<HTMLElement>("#void-ops-crew")!;
    toggle.onclick = () => {
      const open = !body.classList.contains("crew-open");
      body.classList.toggle("crew-open", open);
      toggle.setAttribute("aria-pressed", String(open));
      aside.setAttribute("aria-hidden", String(!open));
      this.crewKey = "";
    };
    const frame = this.host.querySelector<HTMLButtonElement>("[data-ops-frame]")!;
    frame.onclick = () => {
      this.framed = this.framed === null ? "bay" : this.framed === "bay" ? "lab" : null;
      this.renderer.frameRoom(this.framed);
      this.labelFrame();
    };
    aside.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("[data-ops-member]");
      if (!li) return;
      const m = this.crew.members.find((c) => c.id === Number(li.dataset.opsMember)) ?? null;
      this.follow(this.renderer.target === m ? null : m);
    });
    this.bindPointers(canvas);
    this.refreshLook();
  }

  private labelFrame(): void {
    const next = this.framed === null ? "Bay" : this.framed === "bay" ? "Lab" : "Whole floor";
    this.host.querySelector<HTMLButtonElement>("[data-ops-frame]")!.textContent = `⤢ ${next}`;
  }

  private follow(m: CrewMember | null): void {
    this.renderer.target = m;
    this.renderer.goal = null;
    if (m && this.renderer.zoom < 3) {
      const r = this.renderer;
      r.zoomBy(3 / r.zoom, r.canvas.width / 2, r.canvas.height / 2);
    }
    this.framed = null;
    this.labelFrame();
    this.crewKey = "";
  }

  private bindPointers(canvas: HTMLCanvasElement): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const dpr = () => canvas.width / Math.max(1, canvas.clientWidth);
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const k = dpr();
      if (pointers.size === 1) {
        const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) this.renderer.pan(dx * k, dy * k);
      }
      p.x = e.offsetX;
      p.y = e.offsetY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) this.renderer.zoomBy(d / pinch, ((a.x + b.x) / 2) * k, ((a.y + b.y) / 2) * k);
        pinch = d;
        moved = 99;
      }
    });
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && moved <= 4 && e.type === "pointerup") {
        const k = dpr();
        const w = this.renderer.toWorld(e.offsetX * k, e.offsetY * k);
        this.follow(this.renderer.pick(this.crew, w.x, w.y));
      }
      if (pointers.size < 2) pinch = 0;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const k = dpr();
        this.framed = null;
        this.labelFrame();
        this.renderer.zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX * k, e.offsetY * k);
      },
      { passive: false },
    );
  }

  /** Reads the player's tech into what the scene shows. */
  private refreshLook(): void {
    const wallet = this.getWallet();
    const tech = evaluateTech(wallet.ranks);
    const sparks = totalEarnedSparks(wallet);
    const unlocked = Object.values(wallet.ranks).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    this.look = {
      towers: tech.unlockedTowers,
      mark: Math.min(5, 1 + Math.floor(unlocked / 4)),
      chambers: Math.min(CHAMBER_SLOTS, 1 + Math.floor(sparks / 2)),
      twinBarrels: tech.matterCannonSpeedMultiplier > 1,
    };
    this.crew.staff(crewSize(unlocked, this.look.chambers), this.look.chambers);
    if (this.renderer.target && !this.crew.members.includes(this.renderer.target)) this.renderer.target = null;

    const tally = this.host.querySelector<HTMLElement>("[data-ops-tally]")!;
    tally.innerHTML =
      `<b>Mark-${ROMAN[this.look.mark - 1]}</b> prototype · <b>${tech.unlockedTowers.size}</b> tower systems fitted<br>` +
      `<b>${this.look.chambers}</b>/${CHAMBER_SLOTS} Void chambers filled · <b>${unlocked}</b> nodes researched`;
    const bay = this.crew.members.filter((m) => m.role !== "researcher").length;
    this.host.querySelector<HTMLElement>("[data-ops-prospect]")!.innerHTML =
      `<b>${bay}</b> engineers · <b>${this.crew.members.length - bay}</b> researchers`;
    this.crewKey = "";
  }

  renderStatus(): void {
    this.refreshLook();
  }

  /** Redraws the crew list when who is doing what has changed (at most 4× a second). */
  private listCrew(nowMs: number): void {
    if (!this.host.querySelector("[data-ops-body]")!.classList.contains("crew-open")) return;
    if (nowMs - this.listedAt < 250) return;
    this.listedAt = nowMs;
    const target = this.renderer.target;
    const key = this.crew.members.map((m) => `${m.id}:${m.goal.duty}:${m.phase}`).join("|") + `|${target?.id ?? -1}`;
    if (key === this.crewKey) return;
    this.crewKey = key;
    for (const group of ["bay", "lab"] as const) {
      const members = this.crew.members.filter((m) => (m.role === "researcher") === (group === "lab"));
      const box = this.host.querySelector<HTMLElement>(`[data-ops-group="${group}"]`)!;
      box.querySelector("b")!.textContent = String(members.length);
      box.querySelector("ul")!.innerHTML = members
        .map((m) => {
          const doing = m.phase === "work" ? DUTY_LABEL[m.goal.duty] : m.phase === "climb" ? "climbing" : "walking";
          return `<li class="crew-member${m === target ? " selected" : ""}" data-ops-member="${m.id}" title="${ROLE_LABEL[m.role]}"><span>${escape(m.name)} · ${ROLE_LABEL[m.role]} · ${doing}</span></li>`;
        })
        .join("");
    }
  }

  frame(nowMs: number): void {
    const dt = this.lastTime ? Math.min(0.05, Math.max(0, (nowMs - this.lastTime) / 1000)) : 0.016;
    this.lastTime = nowMs;
    const motion = !this.reduceMotion();
    if (motion) {
      this.time += dt;
      this.crew.step(dt);
    }
    this.renderer.draw(this.look, this.crew, this.time, motion ? dt : 0, dt, motion);
    this.listCrew(nowMs);
  }
}
