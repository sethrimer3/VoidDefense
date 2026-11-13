/** The Resistance Map tab's map: the framed pixel-art countryside
 * (`art.ts`) with the campaign's cities, and a briefing card for the chosen
 * one with its records and a Deploy button. Tap a city to choose it. Only
 * open and beaten sectors can be deployed to (`progress.ts`). */

import { SCENARIOS } from "../maps.ts";
import type { ScenarioId } from "../model.ts";
import type { VoidTechWallet } from "../tech/wallet.ts";
import { MapRenderer, type MapLook } from "./art.ts";
import { MAP_CITIES, cityStates, frontier, trailsWalked, type CityState } from "./progress.ts";

export type MapHost = {
  wallet(): VoidTechWallet;
  devMode(): boolean;
  reduceMotion(): boolean;
  selectedScenario(): ScenarioId;
  /** Trails the player has already seen drawn. */
  revealed(): number;
  setRevealed(n: number): void;
  deploy(id: ScenarioId): void;
};

const STATE_LABEL: Record<CityState, string> = {
  locked: "Locked",
  open: "Breach active!",
  beaten: "Contained",
};

export class ResistanceMapView {
  private readonly renderer: MapRenderer;
  private readonly card: HTMLElement;
  private selected = -1;
  private time = 0;
  private lastTime = 0;
  private cardKey = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly game: MapHost,
  ) {
    this.host.innerHTML = `
      <div class="mine-view void-map-view"><canvas class="void-map-canvas" aria-label="Resistance Map: tap a city to choose a sector"></canvas></div>
      <section class="void-map-card" data-map-card aria-live="polite"></section>
    `;
    const canvas = this.host.querySelector<HTMLCanvasElement>(".void-map-canvas")!;
    this.card = this.host.querySelector<HTMLElement>("[data-map-card]")!;
    this.renderer = new MapRenderer(canvas);
    canvas.addEventListener("click", (e) => {
      const k = canvas.width / Math.max(1, canvas.clientWidth);
      const i = this.renderer.pick(e.offsetX * k, e.offsetY * k);
      if (i >= 0) {
        this.selected = i;
        this.renderCard();
      }
    });
    this.card.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-map-deploy]");
      if (btn && !btn.disabled) this.game.deploy(btn.dataset.mapDeploy as ScenarioId);
    });
  }

  private look(): MapLook {
    const wallet = this.game.wallet();
    const dev = this.game.devMode();
    const trails = trailsWalked(wallet);
    return {
      states: cityStates(wallet, dev),
      trails,
      // Never draw on more than the newest trail, so old progress shows at once.
      revealed: Math.max(this.game.revealed(), (trails[trails.length - 1] ?? 0)),
      frontier: frontier(wallet, dev),
      selected: this.selected,
    };
  }

  /** Called when the tab opens: chooses the frontier city (or the current sector). */
  show(): void {
    const wallet = this.game.wallet();
    const f = frontier(wallet, this.game.devMode());
    const current = MAP_CITIES.findIndex((c) => c.id === this.game.selectedScenario());
    this.selected = f >= 0 ? f : Math.max(0, current);
    this.cardKey = "";
    this.renderCard();
  }

  private renderCard(): void {
    const look = this.look();
    const i = this.selected;
    const city = MAP_CITIES[i];
    const sc = SCENARIOS.find((s) => s.id === city.id)!;
    const st = look.states[i];
    const wallet = this.game.wallet();
    const key = `${i}|${st}|${JSON.stringify(wallet.scenarios[city.id] ?? null)}|${wallet.endlessBestSeconds}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const prog = wallet.scenarios[city.id];
    const prev = i > 0 ? SCENARIOS.find((s) => s.id === MAP_CITIES[i - 1].id)! : null;
    const sparks = prog?.sparksTier ?? 0;
    const urgent = st === "open" && i === look.frontier;
    this.card.className = `void-map-card state-${st}${urgent ? " urgent" : ""}`;
    this.card.innerHTML = `
      <header>
        <div>
          <strong>${sc.name}</strong>
          <span class="void-map-state">${urgent ? "<b>!</b> " : ""}${STATE_LABEL[st]}</span>
        </div>
        <span class="void-sector-stars">${sc.endless ? "ENDLESS" : `${"✦".repeat(sparks)}${"·".repeat(3 - sparks)} ${sparks}/3 SPARKS`}</span>
      </header>
      <p>${sc.subtitle}</p>
      <div class="void-sector-stats">
        ${
          sc.endless
            ? `<span>Best Survival: <b>${wallet.endlessBestSeconds}s</b> (${wallet.endlessAttempts} runs)</span>`
            : `<span>Under Siege Best: <b>${(prog?.underSiege.bestPreserved ?? 0).toFixed(1)}%</b></span>
               <span>Build & Watch Best: <b>${(prog?.buildAndWatch.bestPreserved ?? 0).toFixed(1)}%</b></span>`
        }
      </div>
      ${
        st === "locked"
          ? `<button type="button" class="primary-btn" disabled>Contain ${prev ? prev.name.split(":")[0] : "the previous sector"} first</button>`
          : `<button type="button" class="primary-btn" data-map-deploy="${sc.id}">${st === "beaten" ? "Redeploy to" : "Deploy to"} ${sc.name.split(":")[0]}</button>`
      }
    `;
  }

  frame(nowMs: number): void {
    const dt = this.lastTime ? Math.min(0.05, Math.max(0, (nowMs - this.lastTime) / 1000)) : 0.016;
    this.lastTime = nowMs;
    const motion = !this.game.reduceMotion();
    if (motion) this.time += dt;
    if (this.selected < 0) this.show();
    const look = this.look();
    const shown = this.renderer.draw(look, this.time, motion);
    if (shown > this.game.revealed()) this.game.setRevealed(shown);
    this.renderCard();
  }
}
