/** Resistance Command Shell, Battle HUD, Drag-to-Place / Strike / Blueprint
 * Pointers, Profile Mode Picker, and Tab Navigation for Void Defense. */

import { cleanName, defaultFlag, escapeText, flagSvg, randomPlayerName } from "../profile/model.ts";
import { getLanguage, LANGUAGES, setLanguage, t, t as tr, translateWithin } from "../i18n/index.ts";
import { soundOn, syncAudioFocus } from "../sound.ts";
import { VoidSoundEngine } from "./audio.ts";
import { VoidMusicEngine } from "./music.ts";
import type {
  PlayStyleMode,
  RunOutcome,
  ScenarioId,
  StrikeId,
  TowerTypeId,
  VoidProfile,
} from "./model.ts";
import { ResistanceMapView } from "./map/view.ts";
import { sectorUnlocked } from "./map/progress.ts";
import { ResistanceOperationsView } from "./operations/scene.ts";
import { VoidRenderer, type DragPreview } from "./render.ts";
import { type VoidSave } from "./save.ts";
import { VoidSim } from "./sim.ts";
import { VoidTechTreeView } from "./tech/tech-ui.ts";
import { availableCurrencies, totalEarnedSparks } from "./tech/wallet.ts";
import { STRIKE_SPECS, TOWER_SPECS } from "./towers.ts";
import { TowerMenuController, type TowerMenuTarget } from "./tower-menu.ts";

export type VoidTab = "battle" | "network" | "operations" | "map";

/** Paints a crisp 20x20 pixel-art icon for each tower, strike, or blueprint card. */
function paintCardIcon(canvas: HTMLCanvasElement, kind: string): void {
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, 20, 20);
  c.imageSmoothingEnabled = false;

  // Base gunmetal plate
  c.fillStyle = "#161d29";
  c.fillRect(1, 1, 18, 18);
  c.strokeStyle = "#3a4860";
  c.lineWidth = 1;
  c.strokeRect(1.5, 1.5, 17, 17);

  switch (kind) {
    case "matterCannon":
      c.fillStyle = "#526075";
      c.fillRect(4, 11, 12, 5);
      c.fillStyle = "#ff9e38";
      c.fillRect(6, 6, 8, 6);
      c.fillStyle = "#ffd166";
      c.fillRect(8, 3, 4, 4);
      break;
    case "repairDepot":
      c.fillStyle = "#3d526b";
      c.fillRect(4, 5, 12, 11);
      c.fillStyle = "#ffd15c";
      c.fillRect(9, 6, 2, 8);
      c.fillRect(6, 9, 8, 2);
      break;
    case "infantryBarracks":
      c.fillStyle = "#4a3228";
      c.fillRect(4, 9, 12, 7);
      c.fillStyle = "#ff7b24";
      c.fillRect(5, 5, 3, 5);
      c.fillRect(9, 4, 3, 6);
      c.fillRect(13, 5, 3, 5);
      break;
    case "constructorHub":
      c.fillStyle = "#48586e";
      c.fillRect(4, 12, 12, 4);
      c.fillStyle = "#ffbe3b";
      c.fillRect(6, 4, 2, 9);
      c.fillRect(6, 4, 9, 2);
      c.fillStyle = "#48e5ff";
      c.fillRect(13, 7, 3, 3);
      break;
    case "shieldProjector":
      c.strokeStyle = "#48e5ff";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(10, 10, 6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#7afcff";
      c.fillRect(8, 8, 4, 4);
      break;
    case "wallSerpent":
      c.fillStyle = "#48e5ff";
      c.fillRect(4, 13, 4, 3);
      c.fillRect(7, 9, 4, 4);
      c.fillRect(10, 5, 5, 4);
      c.fillStyle = "#ffd166";
      c.fillRect(13, 4, 3, 3);
      break;
    case "gravityAnchor":
      c.fillStyle = "#6c88ff";
      c.fillRect(7, 4, 6, 12);
      c.fillStyle = "#b8c8ff";
      c.fillRect(4, 8, 12, 4);
      break;
    case "rocketTeam":
      c.fillStyle = "#ff6b2b";
      c.fillRect(8, 4, 4, 9);
      c.fillStyle = "#ffd166";
      c.fillRect(6, 13, 8, 3);
      break;
    case "heavyMechBay":
      c.fillStyle = "#ff9e30";
      c.fillRect(5, 4, 10, 10);
      c.fillStyle = "#263244";
      c.fillRect(7, 6, 6, 5);
      c.fillStyle = "#48e5ff";
      c.fillRect(8, 7, 4, 2);
      break;
    case "blueprint":
      c.strokeStyle = "#ffbe3b";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(4, 14);
      c.lineTo(9, 6);
      c.lineTo(16, 11);
      c.stroke();
      c.fillStyle = "#ffffff";
      c.fillRect(3, 13, 3, 3);
      c.fillRect(8, 5, 3, 3);
      c.fillRect(14, 10, 3, 3);
      break;
    case "landfall":
    case "genesis":
      c.fillStyle = "#59166e";
      c.fillRect(3, 3, 14, 14);
      c.fillStyle = "#ff9e38";
      c.fillRect(6, 6, 8, 8);
      c.fillStyle = "#ffd166";
      c.fillRect(8, 8, 4, 4);
      break;
    case "containmentPulse":
      c.strokeStyle = "#48e5ff";
      c.lineWidth = 1.5;
      c.strokeRect(4, 4, 12, 12);
      c.fillStyle = "#ff42b8";
      c.fillRect(8, 8, 4, 4);
      break;
    default:
      c.fillStyle = "#ff9e38";
      c.fillRect(6, 6, 8, 8);
      break;
  }
}

export class VoidApp {
  private tab: VoidTab = "battle";
  sim: VoidSim;
  renderer!: VoidRenderer;
  private techView!: VoidTechTreeView;
  private opsView!: ResistanceOperationsView;
  private mapView: ResistanceMapView | null = null;
  private towerMenu!: TowerMenuController;
  private soundEngine = new VoidSoundEngine();
  private musicEngine = new VoidMusicEngine();
  private windowFocused =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : true;

  private selectedTowerUid: number | null = null;
  private selectedBuildingId: number | null = null;
  private activeTool:
    | { kind: "none" }
    | { kind: "placeTower"; type: TowerTypeId }
    | { kind: "castStrike"; strike: StrikeId }
    | { kind: "setReticle"; towerUid: number }
    | { kind: "drawBlueprint"; points: { x: number; y: number }[] } = { kind: "none" };

  private hoverPreview: DragPreview | null = null;
  private loupePointer: { clientX: number; clientY: number; cellX: number; cellY: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private panMoved = false;
  private paletteCategory: "all" | "towers" | "strikes" = "all";
  private paletteCategoriesOpen = false;
  private paletteOpen = true;
  private paletteDrag: {
    kind: "tower" | "strike";
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragged: boolean;
    wasSelected: boolean;
  } | null = null;
  private lastPalettePointerTapAt = 0;
  private lastPreservedPercent = 100;
  private lastProfileKey = "";
  private lastCtrlKey = "";
  private lastSoundInBattle = false;
  private awaitingDeploy = false;
  private titleOpen = true;
  private coachStep = -1;
  private statsPillEls: { voidEl: HTMLElement; contactsEl: HTMLElement; unitsEl: HTMLElement; timeEl: HTMLElement } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly save: VoidSave,
    private readonly persist: () => void,
  ) {
    const mode: PlayStyleMode = this.save.profile?.mode ?? "underSiege";
    this.sim = new VoidSim(
      this.save.selectedScenario,
      mode,
      this.save.wallet,
      this.save.settings.devMode,
    );
    this.awaitingDeploy = mode === "underSiege";
    if (this.awaitingDeploy) this.sim.paused = true;
    this.syncAudioVolumes();
    setLanguage(this.save.settings.language);
    this.buildDOM();
    translateWithin(this.root);
    this.showTitleScreen();
  }

  private syncAudioVolumes(): void {
    this.soundEngine.setVolumes(
      this.save.settings.masterVolume / 100,
      this.save.settings.sfxVolume / 100,
      this.save.settings.ambienceVolume / 100,
    );
    this.musicEngine.setVolumes(
      this.save.settings.masterVolume / 100,
      this.save.settings.musicVolume / 100,
    );
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <main class="void-shell">
        <header class="void-topbar">
          <div class="void-brand">
            <span class="void-emblem" aria-hidden="true"></span>
            <div class="void-brand-text">
              <strong>VOID DEFENSE</strong>
              <small data-top-scenario></small>
            </div>
          </div>
          <div class="void-currencies">
            <div class="void-curr void-curr--supplies" title="Supplies: runtime construction & strike resource earned from surviving city blocks">
              <i class="void-curr-gem void-curr-gem--supplies" aria-hidden="true"></i>
              <span class="void-curr-label" data-i18n="void.curr.supplies">Supplies</span>
              <b data-curr-supplies>0</b>
            </div>
            <div class="void-curr void-curr--essence" title="Void Essence: repeatable between-run technology resource">
              <i class="void-curr-gem void-curr-gem--essence" aria-hidden="true"></i>
              <span class="void-curr-label" data-i18n="void.curr.essence">Essence</span>
              <b data-curr-essence>0</b>
            </div>
            <div class="void-curr void-curr--sparks" title="Sparks of Defiance: rare milestone breakthroughs (1 shared entitlement per sector)">
              <i class="void-curr-gem void-curr-gem--sparks" aria-hidden="true"></i>
              <span class="void-curr-label" data-i18n="void.curr.sparks">Sparks</span>
              <b data-curr-sparks>0</b>
            </div>
          </div>
          <div class="void-header-actions">
            <div class="void-profile-bar" data-profile-bar></div>
            <button type="button" class="void-gear-btn" data-open-settings title="Settings" aria-label="Settings">⚙</button>
          </div>
        </header>

        <section id="void-page-battle" class="void-page active">
          <div class="void-battle-layout">
            <div class="void-board-stage palette-open" data-board-stage>
              <aside class="void-pal-side" data-pal-side aria-label="Deployment Palette">
                <div class="void-pal-drawer" data-pal-drawer></div>
              </aside>
              <button type="button" class="void-pal-toggle" data-pal-toggle aria-expanded="true" aria-label="Toggle deployment palette" title="Toggle deployment palette">◀</button>
              <canvas id="void-board-canvas"></canvas>

              <!-- Clean HUD Overlays floating over battle canvas -->
              <div class="void-battle-hud" data-battle-hud>
                <div class="void-hud-top">
                  <div class="void-hud-bar-wrap" title="Metropolitan Integrity">
                    <div class="void-hud-bar void-hud-bar--city">
                      <div class="void-hud-bar-fill" data-hud-city-bar></div>
                      <span class="void-hud-bar-label" data-hud-city-text>100%</span>
                    </div>
                  </div>
                  <div class="void-hud-stats" data-hud-stats-pills></div>
                </div>

                <div class="void-hud-top-right">
                  <div class="void-run-controls" data-run-controls></div>
                </div>

                <div class="void-coach" data-coach-card hidden></div>
                <div class="void-inspector" data-tower-inspector hidden></div>
                <div class="void-outcome-banner" data-outcome-banner hidden></div>
              </div>
            </div>

            <aside class="void-side-panel" data-side-panel aria-label="Sector Telemetry">
              <div class="void-side-section">
                <div class="void-side-sector-head">
                  <strong data-side-sector-name>Sector 01</strong>
                  <span class="void-side-mode-badge" data-side-mode-badge>Under Siege</span>
                </div>
                <p class="void-side-goal" data-side-goal data-i18n="void.hud.goal">Contain the Void breach before the city falls.</p>
              </div>
              <div class="void-side-section">
                <div class="void-side-label" data-i18n="void.hud.command">Command</div>
                <div class="void-run-controls void-side-controls" data-side-run-controls></div>
              </div>
              <div class="void-side-section">
                <div class="void-side-label" data-i18n="void.hud.telemetry">Telemetry</div>
                <div class="void-side-telemetry" data-side-telemetry></div>
              </div>
              <div class="void-side-section void-side-insp-wrap" data-side-inspector-host>
                <div class="void-side-label" data-i18n="void.hud.selected">Selected Unit / Structure</div>
                <div class="void-side-insp-empty" data-side-insp-empty data-i18n="void.hud.emptyInsp">Tap any tower or building on the map to inspect or sell it.</div>
                <div class="void-side-insp-body" data-side-inspector hidden></div>
              </div>
            </aside>
          </div>
        </section>

        <section id="void-page-network" class="void-page"></section>
        <section id="void-page-operations" class="void-page"></section>
        <section id="void-page-map" class="void-page"></section>

        <div class="void-nav" role="tablist" aria-label="Resistance Navigation">
          <button type="button" data-void-tab="battle" class="selected" data-i18n="void.tab.battle">Battlefield</button>
          <button type="button" data-void-tab="network" data-i18n="void.tab.network">Global Tech Network</button>
          <button type="button" data-void-tab="operations" data-i18n="void.tab.operations">Resistance Ops</button>
          <button type="button" data-void-tab="map" data-i18n="void.tab.map">Resistance Map</button>
        </div>
      </main>
      <div class="void-title-screen" data-title-screen>
        <canvas class="void-title-canvas" data-title-canvas aria-hidden="true"></canvas>
        <div class="void-title-content">
          <div class="void-title-badge">YEAR 3000 // METROPOLITAN CONTAINMENT</div>
          <h1 class="void-title-logo">VOID DEFENSE</h1>
          <p class="void-title-tag" data-i18n="void.title.subtitle">Contain the Violet Breach</p>
          <div class="void-title-actions">
            <button type="button" class="primary-btn" data-title-continue hidden data-i18n="void.title.continue">Continue</button>
            <button type="button" class="primary-btn" data-title-new data-i18n="void.title.newGame">New Game</button>
            <button type="button" class="secondary-btn" data-title-settings data-i18n="void.title.settings">Settings</button>
          </div>
        </div>
      </div>
      <dialog id="void-profile-dialog" class="void-dialog"></dialog>
      <dialog id="void-settings-dialog" class="void-dialog"></dialog>
    `;

    const canvas = this.root.querySelector<HTMLCanvasElement>("#void-board-canvas")!;
    this.renderer = new VoidRenderer(canvas);
    this.renderer.reduceEffects = this.save.settings.reduceMotion;
    this.renderer.buildingHeight = this.save.settings.buildingHeight;
    this.bindBoardPointers(canvas);

    this.towerMenu = new TowerMenuController({
      board: () => this.root.querySelector<HTMLElement>(".void-board-stage")!,
      renderer: () => this.renderer,
      ringMenu: () => this.save.settings.ringMenu,
      reduceMotion: () => this.save.settings.reduceMotion,
      paintTowerIcon: (c, type) => paintCardIcon(c, type),
      upgrade: (uid) => {
        const tw = this.sim.combat.towers.find((x) => x.uid === uid);
        if (tw && this.sim.upgradeTower(uid)) {
          this.soundEngine.playSfx("towerUpgrade");
          this.renderer.triggerPlacementPulse(tw.x + tw.w * 0.5, tw.y + tw.h * 0.5);
          this.refreshHUD();
        }
      },
      rotate: (uid) => {
        this.sim.combat.rotatePrism(uid);
        this.soundEngine.playSfx("uiClick");
        this.refreshHUD();
      },
      focus: (uid, placing) => {
        this.activeTool = placing ? { kind: "setReticle", towerUid: uid } : { kind: "none" };
        this.soundEngine.playSfx("uiClick");
      },
      sell: (uid) => {
        if (this.sim.sellTower(uid)) {
          this.soundEngine.playSfx("towerSell");
          this.selectedTowerUid = null;
          this.activeTool = { kind: "none" };
          this.refreshHUD();
        }
      },
      closed: () => {
        this.selectedTowerUid = null;
        this.selectedBuildingId = null;
        this.activeTool = { kind: "none" };
        this.refreshHUD();
      },
    });

    document.addEventListener("pointerdown", (e) => {
      if (!this.towerMenu.element) return;
      const target = e.target as Node;
      if (!this.towerMenu.element.contains(target) && target !== canvas) {
        this.towerMenu.dismiss();
      }
    });

    this.techView = new VoidTechTreeView(
      this.root.querySelector<HTMLElement>("#void-page-network")!,
      () => this.save.wallet,
      () => this.sim.phase === "battle" && this.sim.tick > 0 && !this.sim.outcome,
      () => this.save.settings.reduceMotion,
      () => {
        this.persist();
        this.refreshHUD();
        this.opsView.renderStatus();
      },
    );

    this.opsView = new ResistanceOperationsView(
      this.root.querySelector<HTMLElement>("#void-page-operations")!,
      () => this.save.wallet,
      () => this.save.settings.reduceMotion,
      () => this.navigate("network"),
    );

    this.root.querySelectorAll<HTMLButtonElement>("[data-void-tab]").forEach((btn) => {
      btn.onclick = () => {
        this.soundEngine.playSfx("uiToggle");
        this.navigate(btn.dataset.voidTab as VoidTab);
      };
    });

    const gearBtn = this.root.querySelector<HTMLButtonElement>("[data-open-settings]");
    if (gearBtn) {
      gearBtn.onclick = () => {
        this.soundEngine.playSfx("uiToggle");
        this.openSettingsDialog();
      };
    }

    window.addEventListener("keydown", (e) => {
      if (this.tab !== "battle") return;
      if (e.key === "Escape") {
        if (this.towerMenu.element) {
          this.towerMenu.escape();
          return;
        }
        this.activeTool = { kind: "none" };
        this.hoverPreview = null;
        this.selectedTowerUid = null;
        this.selectedBuildingId = null;
        this.renderPalette();
        this.refreshHUD();
        return;
      }
      const strikeOrder: StrikeId[] = [
        "landfall",
        "quarantineBell",
        "containmentPulse",
        "genesis",
        "orbitalReinforcement",
        "seismicFrame",
      ];
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < strikeOrder.length) {
        const s = strikeOrder[idx];
        if (
          this.sim.tech.unlockedStrikes.has(s) &&
          this.sim.combat.strikeCooldowns[s] <= 0 &&
          this.sim.phase === "battle"
        ) {
          this.activeTool =
            this.activeTool.kind === "castStrike" && this.activeTool.strike === s
              ? { kind: "none" }
              : { kind: "castStrike", strike: s };
          this.hoverPreview = null;
          this.renderPalette();
        }
      }
    });

    this.renderPalette();
    this.refreshHUD();
  }

  navigate(tab: VoidTab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>(".void-page").forEach((p) => {
      p.classList.toggle("active", p.id === `void-page-${tab}`);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-void-tab]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.voidTab === tab);
    });
    if (tab === "network") this.techView.render();
    if (tab === "operations") this.opsView.renderStatus();
    if (tab === "map") this.renderMapPage();
    this.refreshHUD();
  }

  startNewRun(scenarioId = this.save.selectedScenario, mode?: PlayStyleMode): void {
    this.save.selectedScenario = scenarioId;
    if (mode && this.save.profile) {
      this.save.profile.mode = mode;
    }
    const activeMode: PlayStyleMode = this.save.profile?.mode ?? "underSiege";
    this.sim = new VoidSim(
      scenarioId,
      activeMode,
      this.save.wallet,
      this.save.settings.devMode,
    );
    this.selectedTowerUid = null;
    this.selectedBuildingId = null;
    this.activeTool = { kind: "none" };
    this.hoverPreview = null;
    this.awaitingDeploy = activeMode === "underSiege";
    if (this.awaitingDeploy) this.sim.paused = true;
    this.renderer.reduceEffects = this.save.settings.reduceMotion;
    this.renderer.buildingHeight = this.save.settings.buildingHeight;
    this.renderer.resetCam(this.sim.world.grid.w, this.sim.world.grid.h);
    this.persist();
    this.renderPalette();
    this.refreshHUD();
    this.navigate("battle");
    this.maybeStartCoach();
  }

  private bindBoardPointers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.panMoved = false;
      this.updateHover(e);
    });

    canvas.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev && this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const nextPts = [...this.pointers.values()];
        const d1 = Math.hypot(nextPts[0].x - nextPts[1].x, nextPts[0].y - nextPts[1].y);
        if (d0 > 0) {
          this.renderer.zoomAt(
            (nextPts[0].x + nextPts[1].x) * 0.5,
            (nextPts[0].y + nextPts[1].y) * 0.5,
            d1 / d0,
            this.sim.world.grid.w,
            this.sim.world.grid.h,
          );
        }
        return;
      }

      if (prev && this.activeTool.kind === "none") {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (Math.hypot(dx, dy) > 5) this.panMoved = true;
        if (this.panMoved) {
          this.renderer.panBy(dx, dy, this.sim.world.grid.w, this.sim.world.grid.h);
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        return;
      }

      if (prev && this.activeTool.kind === "drawBlueprint" && this.pointers.has(e.pointerId)) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (Math.hypot(dx, dy) > 4) this.panMoved = true;
      }

      this.updateHover(e);
    });

    canvas.addEventListener("pointerup", (e) => {
      this.pointers.delete(e.pointerId);
      this.loupePointer = null;
      if (this.panMoved && this.activeTool.kind === "none") {
        this.panMoved = false;
        return;
      }
      this.panMoved = false;
      this.commitBoardTapOrDrop(e);
    });

    canvas.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.loupePointer = null;
      this.hoverPreview = null;
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.renderer.zoomAt(
          e.clientX,
          e.clientY,
          Math.exp(-e.deltaY * 0.0015),
          this.sim.world.grid.w,
          this.sim.world.grid.h,
        );
      },
      { passive: false },
    );

    const palToggle = this.root.querySelector<HTMLButtonElement>("[data-pal-toggle]");
    if (palToggle) {
      palToggle.onclick = () => {
        this.paletteOpen = !this.paletteOpen;
        this.root.querySelector("[data-board-stage]")?.classList.toggle("palette-open", this.paletteOpen);
        palToggle.setAttribute("aria-expanded", String(this.paletteOpen));
        palToggle.textContent = this.paletteOpen ? "◀" : "▶";
        this.soundEngine.playSfx("uiToggle");
      };
    }

    window.addEventListener("pointermove", (e) => {
      const drag = this.paletteDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.dragged && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.dragged = true;
        this.activeTool =
          drag.kind === "tower"
            ? { kind: "placeTower", type: drag.id as TowerTypeId }
            : { kind: "castStrike", strike: drag.id as StrikeId };
        this.renderPalette();
      }
      if (drag.dragged) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.updateHover(e);
      }
    });

    const finishPaletteDrag = (e: PointerEvent, cancelled: boolean) => {
      const drag = this.paletteDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      this.paletteDrag = null;
      this.pointers.delete(e.pointerId);
      this.loupePointer = null;

      if (cancelled) {
        if (drag.dragged) {
          this.activeTool = { kind: "none" };
          this.hoverPreview = null;
          this.renderPalette();
        }
        return;
      }

      if (drag.dragged) {
        const r = canvas.getBoundingClientRect();
        const overCanvas =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (overCanvas) {
          this.commitBoardTapOrDrop(e);
        } else {
          this.activeTool = { kind: "none" };
          this.hoverPreview = null;
          this.renderPalette();
        }
      } else {
        this.lastPalettePointerTapAt = performance.now();
        if (drag.wasSelected) {
          this.activeTool = { kind: "none" };
        } else {
          this.activeTool =
            drag.kind === "tower"
              ? { kind: "placeTower", type: drag.id as TowerTypeId }
              : { kind: "castStrike", strike: drag.id as StrikeId };
        }
        this.hoverPreview = null;
        this.renderPalette();
      }
    };

    window.addEventListener("pointerup", (e) => finishPaletteDrag(e, false));
    window.addEventListener("pointercancel", (e) => finishPaletteDrag(e, true));
  }

  private updateHover(e: PointerEvent): void {
    const { fx, fy, cx, cy } = this.renderer.toCell(e.clientX, e.clientY);
    if (this.activeTool.kind !== "none" && this.pointers.has(e.pointerId)) {
      this.loupePointer = { clientX: e.clientX, clientY: e.clientY, cellX: fx, cellY: fy };
    } else {
      this.loupePointer = null;
    }

    if (this.activeTool.kind === "placeTower") {
      const spec = TOWER_SPECS[this.activeTool.type];
      const tx = cx - Math.floor(spec.w / 2);
      const ty = cy - Math.floor(spec.h / 2);
      const valid =
        this.sim.canModifyTowers() &&
        this.sim.supplies >= this.sim.towerPrice(this.activeTool.type) &&
        this.sim.combat.canPlaceTower(this.sim.world, this.activeTool.type, tx, ty);
      this.hoverPreview = { kind: "tower", type: this.activeTool.type, x: tx, y: ty, valid };
    } else if (this.activeTool.kind === "castStrike") {
      const strike = this.activeTool.strike;
      const valid =
        this.sim.phase === "battle" &&
        this.sim.combat.strikeCooldowns[strike] <= 0 &&
        this.sim.supplies >= this.sim.strikePrice(strike) &&
        this.sim.world.grid.inBounds(cx, cy);
      this.hoverPreview = { kind: "strike", strike, x: fx, y: fy, valid };
    } else if (this.activeTool.kind === "setReticle") {
      this.hoverPreview = {
        kind: "reticle",
        towerUid: this.activeTool.towerUid,
        x: fx,
        y: fy,
      };
    } else if (this.activeTool.kind === "drawBlueprint") {
      if (this.pointers.has(e.pointerId) && this.sim.world.grid.inBounds(cx, cy)) {
        const pts = this.activeTool.points;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(fx - last.x, fy - last.y) >= 1.5) {
          pts.push({ x: fx, y: fy });
        }
      }
      this.hoverPreview = { kind: "blueprint", points: this.activeTool.points };
    } else {
      this.hoverPreview = null;
    }
  }

  private commitBoardTapOrDrop(e: PointerEvent): void {
    const { fx, fy, cx, cy } = this.renderer.toCell(e.clientX, e.clientY);

    if (this.activeTool.kind === "placeTower") {
      const spec = TOWER_SPECS[this.activeTool.type];
      const tx = cx - Math.floor(spec.w / 2);
      const ty = cy - Math.floor(spec.h / 2);
      const placed = this.sim.placeTower(this.activeTool.type, tx, ty);
      if (placed) {
        this.soundEngine.playSfx("towerPlace");
        this.renderer.triggerPlacementPulse(placed.x + placed.w * 0.5, placed.y + placed.h * 0.5);
        if (this.awaitingDeploy && this.coachStep < 0) {
          this.awaitingDeploy = false;
          this.sim.paused = false;
        }
        if (this.coachStep === 1 && placed.type === "matterCannon") {
          this.coachStep = 2;
          this.renderCoach();
        } else if (this.coachStep === 2 && placed.type === "repairDepot") {
          this.coachStep = 3;
          this.renderCoach();
        }
        this.selectedTowerUid = placed.uid;
        this.refreshHUD();
      }
      return;
    }

    if (this.activeTool.kind === "castStrike") {
      const ok = this.sim.castStrike(this.activeTool.strike, fx, fy);
      if (ok) {
        this.soundEngine.playSfx("strikeCast");
        this.renderer.triggerPlacementPulse(fx, fy);
        this.activeTool = { kind: "none" };
        this.hoverPreview = null;
        this.renderPalette();
        this.refreshHUD();
      }
      return;
    }

    if (this.activeTool.kind === "setReticle") {
      if (this.sim.setTowerFocus(this.activeTool.towerUid, fx, fy)) {
        this.soundEngine.playSfx("uiClick");
      }
      this.activeTool = { kind: "none" };
      this.hoverPreview = null;
      this.refreshHUD();
      return;
    }

    if (this.activeTool.kind === "drawBlueprint") {
      if (this.activeTool.points.length >= 2) {
        this.sim.combat.addWallBlueprint(this.sim.world, [...this.activeTool.points], false);
        this.soundEngine.playSfx("uiClick");
      }
      this.activeTool = { kind: "none" };
      this.hoverPreview = null;
      this.renderPalette();
      return;
    }

    const picked = this.renderer.pickStructureAt(
      this.sim.world,
      this.sim.combat.towers,
      e.clientX,
      e.clientY,
    );
    if (picked?.kind === "tower") {
      this.selectedTowerUid = this.selectedTowerUid === picked.uid ? null : picked.uid;
      this.selectedBuildingId = null;
      this.refreshHUD();
      return;
    }
    if (picked?.kind === "building") {
      // Still allow ground tower hit if a tower is right under or adjacent to the tap
      if (this.sim.world.grid.inBounds(cx, cy)) {
        const groundUid = this.sim.world.towerAt[this.sim.world.grid.index(cx, cy)];
        if (groundUid >= 0) {
          this.selectedTowerUid = this.selectedTowerUid === groundUid ? null : groundUid;
          this.selectedBuildingId = null;
          this.refreshHUD();
          return;
        }
      }
      this.selectedTowerUid = null;
      this.selectedBuildingId = this.selectedBuildingId === picked.id ? null : picked.id;
      this.refreshHUD();
      return;
    }

    if (this.sim.world.grid.inBounds(cx, cy)) {
      let uid = this.sim.world.towerAt[this.sim.world.grid.index(cx, cy)];
      if (uid < 0) {
        let bestD = 3.2;
        for (const t of this.sim.combat.towers) {
          const d = Math.hypot(fx - (t.x + t.w * 0.5), fy - (t.y + t.h * 0.5));
          if (d <= bestD) {
            bestD = d;
            uid = t.uid;
          }
        }
      }
      this.selectedTowerUid = uid >= 0 && this.selectedTowerUid !== uid ? uid : null;
      this.selectedBuildingId = null;
      this.refreshHUD();
    }
  }

  private renderPalette(): void {
    const drawer = this.root.querySelector<HTMLElement>("[data-pal-drawer]")!;
    const unlockedTowers = [...this.sim.tech.unlockedTowers];
    const unlockedStrikes = [...this.sim.tech.unlockedStrikes];

    const catLabel =
      this.paletteCategory === "towers"
        ? "Towers"
        : this.paletteCategory === "strikes"
          ? "Strikes"
          : "All";
    const catList = this.paletteCategoriesOpen
      ? `<div class="void-pal-categories" role="menu">
          <button type="button" role="menuitemradio" aria-checked="${this.paletteCategory === "all"}" data-pal-cat="all">All</button>
          <button type="button" role="menuitemradio" aria-checked="${this.paletteCategory === "towers"}" data-pal-cat="towers">Towers</button>
          <button type="button" role="menuitemradio" aria-checked="${this.paletteCategory === "strikes"}" data-pal-cat="strikes">Strikes</button>
        </div>`
      : "";
    const catPicker = `<button type="button" class="void-pal-cat-btn" data-pal-cat-toggle aria-haspopup="menu" aria-expanded="${this.paletteCategoriesOpen}" title="Filter deployment palette"><span aria-hidden="true">☰</span> ${catLabel}</button>${catList}`;

    const towerItems =
      this.paletteCategory === "strikes"
        ? ""
        : unlockedTowers
            .map((type) => {
              const spec = TOWER_SPECS[type];
              const price = this.sim.towerPrice(type);
              const active =
                this.activeTool.kind === "placeTower" && this.activeTool.type === type;
              const lockedByMode = !this.sim.canModifyTowers();
              return `
                <button type="button" class="void-pal-btn ${active ? "selected" : ""}" data-pick-tower="${type}" ${
                  lockedByMode ? "disabled" : ""
                } title="${spec.name}: ${spec.description} (Drag onto board or click then click board)">
                  <canvas class="void-card-icon" width="20" height="20" data-card-icon="${type}"></canvas>
                  <b>${spec.shortName}</b>
                  <small>${price} SUP</small>
                </button>
              `;
            })
            .join("") +
          `<button type="button" class="void-pal-btn ${
            this.activeTool.kind === "drawBlueprint" ? "selected" : ""
          }" data-pick-blueprint title="Draw a polyline wall blueprint for your 1x2 Engineers to construct">
            <canvas class="void-card-icon" width="20" height="20" data-card-icon="blueprint"></canvas>
            <b>Wall Plan</b>
            <small>Draw</small>
          </button>`;

    const strikeItems =
      this.paletteCategory === "towers"
        ? ""
        : unlockedStrikes
            .map((s, idx) => {
              const spec = STRIKE_SPECS[s];
              const price = this.sim.strikePrice(s);
              const cd = Math.ceil(this.sim.combat.strikeCooldowns[s]);
              const active =
                this.activeTool.kind === "castStrike" && this.activeTool.strike === s;
              return `
                <button type="button" class="void-pal-btn void-pal-btn--strike ${active ? "selected" : ""}" data-pick-strike="${s}" ${
                  cd > 0 || this.sim.phase !== "battle" ? "disabled" : ""
                } title="${spec.name} [Hotkey ${idx + 1}]: ${spec.description} (Drag onto board or click then click board)">
                  <canvas class="void-card-icon" width="20" height="20" data-card-icon="${s}"></canvas>
                  <b>${spec.shortName}</b>
                  <small>${cd > 0 ? `${cd}s` : `${price} SUP`}</small>
                </button>
              `;
            })
            .join("");

    drawer.innerHTML = catPicker + towerItems + strikeItems;

    const catToggle = drawer.querySelector<HTMLButtonElement>("[data-pal-cat-toggle]");
    if (catToggle) {
      catToggle.onclick = () => {
        this.paletteCategoriesOpen = !this.paletteCategoriesOpen;
        this.renderPalette();
      };
    }
    drawer.querySelectorAll<HTMLButtonElement>("[data-pal-cat]").forEach((b) => {
      b.onclick = () => {
        this.paletteCategory = b.dataset.palCat as "all" | "towers" | "strikes";
        this.paletteCategoriesOpen = false;
        this.renderPalette();
        drawer.scrollTop = 0;
      };
    });

    drawer.querySelectorAll<HTMLButtonElement>("[data-pick-tower]").forEach((btn) => {
      const t = btn.dataset.pickTower as TowerTypeId;
      btn.onpointerdown = (e) => {
        if (e.button !== 0 || btn.disabled) return;
        const wasSelected =
          this.activeTool.kind === "placeTower" && this.activeTool.type === t;
        this.paletteDrag = {
          kind: "tower",
          id: t,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          dragged: false,
          wasSelected,
        };
      };
      btn.onclick = (e) => {
        if (btn.disabled) return;
        if (e.detail !== 0 && performance.now() - this.lastPalettePointerTapAt < 80) return;
        this.activeTool =
          this.activeTool.kind === "placeTower" && this.activeTool.type === t
            ? { kind: "none" }
            : { kind: "placeTower", type: t };
        this.hoverPreview = null;
        this.renderPalette();
      };
    });

    const bpBtn = drawer.querySelector<HTMLButtonElement>("[data-pick-blueprint]");
    if (bpBtn) {
      bpBtn.onclick = () => {
        if (this.activeTool.kind === "drawBlueprint") {
          this.activeTool = { kind: "none" };
        } else {
          this.activeTool = { kind: "drawBlueprint", points: [] };
        }
        this.hoverPreview = null;
        this.renderPalette();
      };
    }

    drawer.querySelectorAll<HTMLButtonElement>("[data-pick-strike]").forEach((btn) => {
      const s = btn.dataset.pickStrike as StrikeId;
      btn.onpointerdown = (e) => {
        if (e.button !== 0 || btn.disabled) return;
        const wasSelected =
          this.activeTool.kind === "castStrike" && this.activeTool.strike === s;
        this.paletteDrag = {
          kind: "strike",
          id: s,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          dragged: false,
          wasSelected,
        };
      };
      btn.onclick = (e) => {
        if (btn.disabled) return;
        if (e.detail !== 0 && performance.now() - this.lastPalettePointerTapAt < 80) return;
        this.activeTool =
          this.activeTool.kind === "castStrike" && this.activeTool.strike === s
            ? { kind: "none" }
            : { kind: "castStrike", strike: s };
        this.hoverPreview = null;
        this.renderPalette();
      };
    });

    this.root.querySelectorAll<HTMLCanvasElement>("[data-card-icon]").forEach((c) => {
      paintCardIcon(c, c.dataset.cardIcon || "");
    });
  }

  refreshHUD(): void {
    const avail = availableCurrencies(this.save.wallet);
    this.root.querySelector("[data-top-scenario]")!.textContent =
      `${this.sim.scenario.name} - ${this.sim.mode === "underSiege" ? "Build Under Siege" : "Build & Watch"}`;
    this.root.querySelector("[data-curr-supplies]")!.textContent = String(Math.floor(this.sim.supplies));
    this.root.querySelector("[data-curr-essence]")!.textContent = String(avail.essence);
    this.root.querySelector("[data-curr-sparks]")!.textContent = `${avail.sparks} / ${totalEarnedSparks(this.save.wallet)}`;

    const profBar = this.root.querySelector<HTMLElement>("[data-profile-bar]")!;
    const p = this.save.profile;
    const lang = getLanguage();
    const profileKey = p ? `${lang}\0${p.name}\0${p.flag}\0${p.mode}` : `${lang}\0__none__`;
    if (profileKey !== this.lastProfileKey) {
      this.lastProfileKey = profileKey;
      profBar.innerHTML = p
        ? `<button type="button" class="void-prof-btn" data-edit-profile>${flagSvg(p.flag, "void-mini-flag")} <span>${escapeText(p.name)}</span> <small>(${p.mode === "underSiege" ? t("void.mode.underSiege") : t("void.mode.buildAndWatch")})</small></button>`
        : `<button type="button" class="void-prof-btn" data-edit-profile>${t("void.profile.edit")}</button>`;
      profBar.querySelector<HTMLButtonElement>("[data-edit-profile]")!.onclick = () =>
        this.openProfileDialog(false);
    }

    // Tactical Telemetry Bar with sleek top-center health/integrity bar and minimal badges
    const { preservedPercent } = this.sim.world.computePreservedBaseline();
    this.lastPreservedPercent = preservedPercent;
    const isFiniteVoid = Number.isFinite(this.sim.voidField.energyRemaining);
    const energyText = isFiniteVoid
      ? `${Math.ceil(this.sim.voidField.energyRemaining)}`
      : "∞";

    const cityBarFill = this.root.querySelector<HTMLElement>("[data-hud-city-bar]");
    if (cityBarFill) cityBarFill.style.width = `${preservedPercent.toFixed(1)}%`;
    const cityText = this.root.querySelector<HTMLElement>("[data-hud-city-text]");
    if (cityText) cityText.textContent = `${preservedPercent.toFixed(1)}%`;

    const statsPills = this.root.querySelector<HTMLElement>("[data-hud-stats-pills]");
    if (statsPills) {
      if (!this.statsPillEls || !statsPills.isConnected || statsPills.childElementCount === 0) {
        statsPills.innerHTML = `
          <span class="void-hud-pill" title="Void Energy Remaining">${t("void.hud.voidEnergy")} <b data-pill-void></b></span>
          <span class="void-hud-pill" title="Active Frontier Contacts">${t("void.hud.contacts")} <b data-pill-contacts></b></span>
          <span class="void-hud-pill" title="Active Units">${t("void.hud.units")} <b data-pill-units></b></span>
          <span class="void-hud-pill" title="Elapsed Battle Time">${t("void.hud.time")} <b data-pill-time></b></span>
        `;
        this.statsPillEls = {
          voidEl: statsPills.querySelector<HTMLElement>("[data-pill-void]")!,
          contactsEl: statsPills.querySelector<HTMLElement>("[data-pill-contacts]")!,
          unitsEl: statsPills.querySelector<HTMLElement>("[data-pill-units]")!,
          timeEl: statsPills.querySelector<HTMLElement>("[data-pill-time]")!,
        };
      }
      this.statsPillEls.voidEl.textContent = energyText;
      this.statsPillEls.contactsEl.textContent = String(this.sim.voidField.totalContactEdges());
      this.statsPillEls.unitsEl.textContent = String(this.sim.combat.agents.length);
      this.statsPillEls.timeEl.textContent = `${this.sim.elapsedSeconds.toFixed(1)}s`;
    }

    // Side panel sector info & telemetry
    const sideName = this.root.querySelector<HTMLElement>("[data-side-sector-name]");
    if (sideName) sideName.textContent = this.sim.scenario.name;
    const sideMode = this.root.querySelector<HTMLElement>("[data-side-mode-badge]");
    if (sideMode) sideMode.textContent = this.sim.mode === "underSiege" ? t("void.mode.underSiege") : t("void.mode.buildAndWatch");
    const sideGoal = this.root.querySelector<HTMLElement>("[data-side-goal]");
    if (sideGoal) {
      sideGoal.textContent = this.sim.scenario.endless
        ? "Survive the endless Void escalation as long as possible."
        : t("void.hud.goal");
    }
    const sideTel = this.root.querySelector<HTMLElement>("[data-side-telemetry]");
    if (sideTel) {
      const contacts = this.sim.voidField.totalContactEdges();
      sideTel.innerHTML = `
        <div class="void-tel-row"><span>${t("void.hud.voidEnergy")}</span><b>${energyText}</b></div>
        <div class="void-tel-row ${contacts > 800 ? "warn" : ""}"><span>${t("void.hud.contacts")}</span><b>${contacts}</b></div>
        <div class="void-tel-row"><span>${t("void.hud.units")}</span><b>${this.sim.combat.agents.length}</b></div>
        <div class="void-tel-row"><span>${t("void.hud.time")}</span><b>${this.sim.elapsedSeconds.toFixed(1)}s</b></div>
      `;
    }

    // Run controls (rebuild only when phase/paused/speed/deploy/lang changes so buttons don't detach mid-click)
    const ctrlKey = `${lang}:${this.sim.phase}:${this.awaitingDeploy ? 1 : 0}:${this.sim.paused ? 1 : 0}:${this.sim.speed}`;
    if (ctrlKey !== this.lastCtrlKey) {
      this.lastCtrlKey = ctrlKey;
      const isDeployReady = this.sim.phase === "prep" || this.awaitingDeploy;
      const ctrlHtml = `
        ${
          isDeployReady
            ? `<button type="button" class="primary-btn void-start-btn" data-start-battle>${t("void.hud.startBattle")}</button>`
            : `<button type="button" class="void-ctrl-btn" data-toggle-pause>${this.sim.paused ? t("void.hud.resume") : t("void.hud.pause")}</button>`
        }
        <button type="button" data-cycle-speed>${this.sim.speed}x</button>
        <button type="button" data-retry-run>${t("void.hud.retry")}</button>
      `;
      const ctrlContainers = [
        this.root.querySelector<HTMLElement>("[data-run-controls]"),
        this.root.querySelector<HTMLElement>("[data-side-run-controls]"),
      ];
      for (const ctrlEl of ctrlContainers) {
        if (!ctrlEl) continue;
        ctrlEl.innerHTML = ctrlHtml;
        this.bindRunControls(ctrlEl);
      }
    }

    this.renderTowerInspector();
    this.renderOutcomeBanner(this.sim.outcome);
  }

  private bindRunControls(ctrlEl: HTMLElement): void {
    const startBtn = ctrlEl.querySelector<HTMLButtonElement>("[data-start-battle]");
    if (startBtn) {
      startBtn.onclick = () => {
        if (this.sim.phase === "prep") {
          this.sim.startBattle();
        }
        this.awaitingDeploy = false;
        this.sim.paused = false;
        this.activeTool = { kind: "none" };
        this.renderPalette();
        this.refreshHUD();
      };
    }

    const pauseBtn = ctrlEl.querySelector<HTMLButtonElement>("[data-toggle-pause]");
    if (pauseBtn) {
      pauseBtn.onclick = () => {
        this.sim.paused = !this.sim.paused;
        this.refreshHUD();
      };
    }

    const speedBtn = ctrlEl.querySelector<HTMLButtonElement>("[data-cycle-speed]");
    if (speedBtn) {
      speedBtn.onclick = () => {
        this.sim.speed = (this.sim.speed === 1 ? 2 : this.sim.speed === 2 ? 3 : 1) as 1 | 2 | 3;
        this.refreshHUD();
      };
    }

    const retryBtn = ctrlEl.querySelector<HTMLButtonElement>("[data-retry-run]");
    if (retryBtn) {
      retryBtn.onclick = () => {
        if (this.sim.phase === "battle" && !this.sim.outcome) {
          this.sim.finishRun("lost", "active");
          this.persist();
        }
        this.startNewRun(this.sim.scenario.id);
      };
    }
  }

  private setInspectorContent(html: string | null, bind?: (root: HTMLElement) => void): void {
    const insp = this.root.querySelector<HTMLElement>("[data-tower-inspector]");
    const sideInsp = this.root.querySelector<HTMLElement>("[data-side-inspector]");
    const sideEmpty = this.root.querySelector<HTMLElement>("[data-side-insp-empty]");
    if (insp) insp.hidden = true;
    if (!html) {
      if (sideInsp) sideInsp.hidden = true;
      if (sideEmpty) sideEmpty.hidden = false;
      return;
    }
    if (sideInsp) {
      sideInsp.hidden = false;
      sideInsp.innerHTML = html;
      if (bind) bind(sideInsp);
    }
    if (sideEmpty) sideEmpty.hidden = true;
  }

  private renderTowerInspector(): void {
    if (this.sim.outcome) {
      this.towerMenu.dismiss(false);
      this.setInspectorContent(null);
      return;
    }
    const t = this.sim.combat.towers.find((tw) => tw.uid === this.selectedTowerUid);
    if (!t) {
      const b =
        this.selectedBuildingId !== null
          ? this.sim.world.buildings.find((mb) => mb.id === this.selectedBuildingId)
          : undefined;
      if (b) {
        let intact = 0;
        for (let i = 0; i < b.cells.length; i++) {
          const idx = b.cells[i];
          if (this.sim.world.buildingAt[idx] === b.id && this.sim.world.hp[idx] > 0) intact++;
        }
        if (intact > 0) {
          const pct = Math.round((intact / Math.max(1, b.cells.length)) * 100);
          const name = `${b.isSkyscraper ? "Skyscraper" : "Structure"} #${b.id}`;
          const target: TowerMenuTarget = {
            kind: "building",
            building: b,
            name,
            height: b.height,
            integrityPct: pct,
          };
          this.towerMenu.show(target, false);
          const html = `
            <div class="void-insp-head">
              <strong>${name}</strong>
              <span class="void-insp-tag">${b.height}F</span>
              <button type="button" data-insp-close class="void-insp-close" aria-label="Close inspector">×</button>
            </div>
            <div class="void-insp-stats">
              <span>Integrity: <b>${pct}%</b></span>
            </div>
          `;
          this.setInspectorContent(html, (el) => {
            el.querySelector<HTMLButtonElement>("[data-insp-close]")!.onclick = () => {
              this.selectedBuildingId = null;
              this.refreshHUD();
            };
          });
          return;
        }
      }
      this.towerMenu.dismiss(false);
      this.setInspectorContent(null);
      return;
    }
    const spec = TOWER_SPECS[t.type];
    const lvl = t.level ?? 1;
    const upgCost = this.sim.upgradePrice(t.uid);
    const canUpgrade = upgCost > 0 && this.sim.canModifyTowers() && (this.save.settings.devMode || this.sim.supplies >= upgCost);
    const refund = this.sim.refundAmount(t.uid);
    const canModify = this.sim.canModifyTowers();
    let extraInfo = "";
    let rotateBtn = "";
    let hasRotate = false;
    if (t.type === "voidSiphon") {
      const s = this.sim.combat.siphonStates.get(t.uid);
      if (s) {
        const pct = Math.round((s.stored / Math.max(1, s.maxStorage)) * 100);
        extraInfo = `<span>Tank: <b>${pct}%</b> (${s.phase === "venting" ? `Venting ${s.ventRemaining.toFixed(1)}s` : "Intake"})</span>`;
      }
    } else if (t.type === "boundaryPrism") {
      const p = this.sim.combat.prismStates.get(t.uid);
      if (p) {
        const deg = Math.round((p.angleRad * 180) / Math.PI) % 360;
        extraInfo = `<span>Plane: <b>${deg}°</b></span>`;
        rotateBtn = `<button type="button" data-insp-rotate class="secondary-btn">Rotate +45°</button>`;
        hasRotate = true;
      }
    } else if (t.type === "chronoCannon") {
      extraInfo = `<span>Rewind: <b>${t.cooldown <= 0 ? "Ready" : `${t.cooldown.toFixed(1)}s`}</b></span>`;
    }
    const placing = this.activeTool.kind === "setReticle" && this.activeTool.towerUid === t.uid;
    const target: TowerMenuTarget = {
      kind: "tower",
      tower: t,
      name: spec.name,
      level: lvl,
      hp: t.hp,
      maxHp: t.maxHp,
      upgCost,
      canUpgrade,
      refund,
      canModify,
      extraStats: extraInfo,
      hasRotate,
      focusSet: !!t.focus,
    };
    this.towerMenu.show(target, placing);
    const html = `
      <div class="void-insp-head">
        <strong>${spec.name}</strong>
        <span class="void-insp-tag">${tr("void.insp.lv", { n: lvl })}</span>
        <button type="button" data-insp-close class="void-insp-close" aria-label="Close inspector">×</button>
      </div>
      <div class="void-insp-stats">
        <span>${tr("void.insp.hp")}: <b>${Math.ceil(t.hp)}/${t.maxHp}</b></span>
        ${extraInfo}
      </div>
      <div class="void-insp-actions">
        ${upgCost > 0 ? `<button type="button" data-insp-upgrade class="primary-btn" ${canUpgrade ? "" : "disabled"}>${tr("void.insp.upgrade", { n: lvl + 1, cost: upgCost })}</button>` : ""}
        ${rotateBtn}
        <button type="button" data-insp-reticle class="secondary-btn">${tr("void.insp.focus")}</button>
        <button type="button" data-insp-sell class="danger-btn" ${canModify ? "" : "disabled"}>${tr("void.insp.sell", { n: refund })}</button>
      </div>
    `;
    this.setInspectorContent(html, (el) => {
      const upgBtn = el.querySelector<HTMLButtonElement>("[data-insp-upgrade]");
      if (upgBtn) {
        upgBtn.onclick = () => {
          if (this.sim.upgradeTower(t.uid)) {
            this.soundEngine.playSfx("towerUpgrade");
            this.renderer.triggerPlacementPulse(t.x + t.w * 0.5, t.y + t.h * 0.5);
            this.refreshHUD();
          }
        };
      }
      const rotBtn = el.querySelector<HTMLButtonElement>("[data-insp-rotate]");
      if (rotBtn) {
        rotBtn.onclick = () => {
          this.sim.combat.rotatePrism(t.uid);
          this.soundEngine.playSfx("uiClick");
          this.refreshHUD();
        };
      }
      el.querySelector<HTMLButtonElement>("[data-insp-reticle]")!.onclick = () => {
        this.activeTool = { kind: "setReticle", towerUid: t.uid };
        this.towerMenu.setPlacing(true);
        this.soundEngine.playSfx("uiClick");
      };
      el.querySelector<HTMLButtonElement>("[data-insp-sell]")!.onclick = () => {
        if (this.sim.sellTower(t.uid)) {
          this.soundEngine.playSfx("towerSell");
          this.selectedTowerUid = null;
          this.refreshHUD();
        }
      };
      el.querySelector<HTMLButtonElement>("[data-insp-close]")!.onclick = () => {
        this.selectedTowerUid = null;
        this.refreshHUD();
      };
    });
  }

  private renderOutcomeBanner(outcome: RunOutcome | null): void {
    const banner = this.root.querySelector<HTMLElement>("[data-outcome-banner]")!;
    if (!outcome) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const tierTitles: Record<number, string> = {
      0: t("void.outcome.lost"),
      1: t("void.outcome.pyrrhic"),
      2: t("void.outcome.contained"),
      3: t("void.outcome.flawless"),
    };
    const title = outcome.status === "won" ? (tierTitles[outcome.sparksTier] ?? t("void.outcome.contained")) : t("void.outcome.lost");
    const sparksHtml = [1, 2, 3]
      .map((n) => `<span class="void-outcome-spark ${n <= outcome.sparksTier ? "filled" : ""}" aria-hidden="true">◆</span>`)
      .join("");
    const rec = this.save.wallet.scenarios[this.sim.scenario.id]?.[this.sim.mode];
    const bestPct = rec ? rec.bestPreserved.toFixed(1) : outcome.preservedPercent.toFixed(1);
    banner.innerHTML = `
      <div class="void-outcome-card ${outcome.status === "won" ? "won" : "lost"}">
        <div class="void-outcome-sparks" aria-label="${outcome.sparksTier} of 3 Sparks">${sparksHtml}</div>
        <h2>${title}</h2>
        <div class="void-outcome-stats">
          <div><span>${t("void.outcome.preserved")}</span><b>${outcome.preservedPercent.toFixed(1)}%</b></div>
          <div><span>${t("void.outcome.best")}</span><b>${bestPct}%</b></div>
          <div><span>${t("void.hud.time")}</span><b>${outcome.elapsedSeconds}s</b></div>
        </div>
        <div class="void-outcome-rewards">
          <span class="void-reward-chip void-reward-chip--essence">+${outcome.voidEssenceAwarded} ${t("void.outcome.essenceEarned")}</span>
          <span class="void-reward-chip void-reward-chip--sparks">+${outcome.sparksAwarded} ${t("void.outcome.sparksEarned")}</span>
        </div>
        ${
          !outcome.participated && outcome.status === "lost"
            ? `<small class="void-warn">Minimal defense activity detected: active engagement is required to harvest Void Essence on defeat.</small>`
            : ""
        }
        <div class="void-outcome-actions">
          <button type="button" class="primary-btn" data-out-retry>${t("void.outcome.retry")}</button>
          ${outcome.status === "won" ? `<button type="button" class="primary-btn" data-out-map>${t("void.outcome.map")}</button>` : ""}
          <button type="button" class="secondary-btn" data-out-tech>${t("void.outcome.tech")}</button>
        </div>
      </div>
    `;
    banner.querySelector<HTMLButtonElement>("[data-out-retry]")!.onclick = () =>
      this.startNewRun(this.sim.scenario.id);
    banner.querySelector<HTMLButtonElement>("[data-out-tech]")!.onclick = () =>
      this.navigate("network");
    const toMap = banner.querySelector<HTMLButtonElement>("[data-out-map]");
    if (toMap) toMap.onclick = () => this.navigate("map");
  }

  private renderMapPage(): void {
    const page = this.root.querySelector<HTMLElement>("#void-page-map")!;
    if (!this.mapView) {
      page.innerHTML = `
        <div class="void-sectors-wrap">
          <section class="void-map-section">
            <h3>Resistance Map</h3>
            <div data-map-host></div>
          </section>
          <div data-map-extras></div>
        </div>
      `;
      this.mapView = new ResistanceMapView(page.querySelector<HTMLElement>("[data-map-host]")!, {
        wallet: () => this.save.wallet,
        devMode: () => this.save.settings.devMode,
        reduceMotion: () => this.save.settings.reduceMotion,
        selectedScenario: () => this.save.selectedScenario,
        revealed: () => this.save.mapRevealed ?? 0,
        setRevealed: (n) => {
          this.save.mapRevealed = n;
          this.persist();
        },
        deploy: (id) => {
          if (sectorUnlocked(this.save.wallet, id, this.save.settings.devMode)) this.startNewRun(id);
        },
      });
    }
    this.mapView.show();
    const secPage = page.querySelector<HTMLElement>("[data-map-extras]")!;
    const currentMode: PlayStyleMode = this.save.profile?.mode ?? "underSiege";

    secPage.innerHTML = `
        <section class="void-mode-selector">
          <h3>Deployment Play Style (Changeable Between Runs)</h3>
          <div class="void-mode-cards">
            <button type="button" class="void-mode-card ${currentMode === "underSiege" ? "selected" : ""}" data-select-mode="underSiege">
              <strong>Build Under Siege (Recommended)</strong>
              <p>Build, sell, and adapt in real time as the Void actively consumes the city. Earn continuous Supplies from surviving skyscrapers.</p>
            </button>
            <button type="button" class="void-mode-card ${currentMode === "buildAndWatch" ? "selected" : ""}" data-select-mode="buildAndWatch">
              <strong>Build &amp; Watch</strong>
              <p>Prepare your defenses beforehand with a fixed starting budget, then unleash the Void and watch your containment plan unfold.</p>
            </button>
          </div>
          <small>Note: Best survival percentages and attempt counts are tracked separately per mode. Each sector has <b>one shared Sparks of Defiance entitlement</b> (up to 3 Sparks), equal to the highest tier reached in either mode.</small>
        </section>
    `;

    secPage.querySelectorAll<HTMLButtonElement>("[data-select-mode]").forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.selectMode as PlayStyleMode;
        if (this.save.profile) this.save.profile.mode = m;
        this.startNewRun(this.save.selectedScenario, m);
        this.renderMapPage();
      };
    });

  }

  private showTitleScreen(): void {
    const titleEl = this.root.querySelector<HTMLElement>("[data-title-screen]")!;
    const contBtn = titleEl.querySelector<HTMLButtonElement>("[data-title-continue]")!;
    const newBtn = titleEl.querySelector<HTMLButtonElement>("[data-title-new]")!;
    const setBtn = titleEl.querySelector<HTMLButtonElement>("[data-title-settings]")!;

    this.titleOpen = true;
    titleEl.hidden = false;
    contBtn.hidden = !this.save.profile;

    contBtn.onclick = () => {
      this.soundEngine.playSfx("uiClick");
      this.titleOpen = false;
      titleEl.hidden = true;
      this.maybeStartCoach();
    };
    newBtn.onclick = () => {
      this.soundEngine.playSfx("uiClick");
      this.titleOpen = false;
      titleEl.hidden = true;
      this.openProfileDialog(!this.save.profile);
    };
    setBtn.onclick = () => {
      this.soundEngine.playSfx("uiToggle");
      this.openSettingsDialog();
    };
  }

  private paintTitleBackdrop(nowMs: number): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>("[data-title-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = 3;
    const w = Math.max(160, Math.floor(rect.width / scale));
    const h = Math.max(100, Math.floor(rect.height / scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false;

    // Deep cosmic sky
    c.fillStyle = "#06080c";
    c.fillRect(0, 0, w, h);

    // Subtle stars
    for (let i = 0; i < 42; i++) {
      const sx = ((i * 73 + 19) % w);
      const sy = ((i * 41 + 11) % Math.max(1, Math.floor(h * 0.65)));
      c.fillStyle = i % 5 === 0 ? "#00e5ff" : i % 3 === 0 ? "#c080ff" : "#5a6b84";
      c.fillRect(sx, sy, 1, 1);
    }

    // Rising Void horizon glow behind skyline
    const t = this.save.settings.reduceMotion ? 0 : nowMs * 0.001;
    const voidTop = Math.floor(h * 0.54 + Math.sin(t * 0.7) * 3);
    c.fillStyle = "#190726";
    c.fillRect(0, voidTop, w, h - voidTop);
    c.fillStyle = "#3b0e57";
    for (let x = 0; x < w; x += 2) {
      const wave = Math.floor(Math.sin(x * 0.08 + t * 1.3) * 2 + Math.cos(x * 0.03 - t) * 2);
      c.fillRect(x, voidTop + wave, 2, 2);
    }
    c.fillStyle = "#c040ff";
    for (let x = 0; x < w; x += 3) {
      const wave = Math.floor(Math.sin(x * 0.08 + t * 1.3) * 2 + Math.cos(x * 0.03 - t) * 2);
      if ((x + Math.floor(t * 4)) % 6 === 0) c.fillRect(x, voidTop + wave, 1, 1);
    }

    // Pixel-art metropolitan skyline silhouettes with warm amber windows
    const bWidth = 10;
    const cols = Math.ceil(w / bWidth);
    for (let i = 0; i < cols; i++) {
      const bx = i * bWidth;
      const bh = 22 + ((i * 37 + 13) % Math.max(16, Math.floor(h * 0.42)));
      const by = h - bh;
      c.fillStyle = i % 2 === 0 ? "#0d121b" : "#111824";
      c.fillRect(bx, by, bWidth - 1, bh);
      c.fillStyle = "#222d3f";
      c.fillRect(bx, by, bWidth - 1, 1);
      // Lit amber / cyan windows
      for (let wy = by + 3; wy < h - 4; wy += 4) {
        for (let wx = bx + 2; wx < bx + bWidth - 3; wx += 3) {
          const lit = ((wx * 13 + wy * 7 + i) % 11) > 4;
          if (lit) {
            c.fillStyle = ((wx + wy) % 7 === 0) ? "#00e5ff" : "#ff9d2b";
            c.fillRect(wx, wy, 1, 2);
          }
        }
      }
    }
  }

  private maybeStartCoach(): void {
    if (
      this.sim.scenario.id === "tutorialBreach" &&
      !this.save.coachDone &&
      !this.titleOpen &&
      !this.root.querySelector("dialog[open]")
    ) {
      this.coachStep = 0;
      this.awaitingDeploy = true;
      this.sim.paused = true;
      this.renderCoach();
    } else {
      this.coachStep = -1;
      this.renderCoach();
    }
  }

  private renderCoach(): void {
    const el = this.root.querySelector<HTMLElement>("[data-coach-card]");
    if (!el) return;

    this.root.querySelectorAll(".void-coach-pulse").forEach((n) => n.classList.remove("void-coach-pulse"));

    if (this.coachStep < 0 || this.sim.scenario.id !== "tutorialBreach" || this.save.coachDone) {
      el.hidden = true;
      return;
    }

    const steps = [
      {
        title: t("void.coach.1.title"),
        body: t("void.coach.1.body"),
        next: t("void.coach.next"),
        highlight: "",
      },
      {
        title: t("void.coach.2.title"),
        body: t("void.coach.2.body"),
        next: "",
        highlight: '[data-pick-tower="matterCannon"]',
      },
      {
        title: t("void.coach.3.title"),
        body: t("void.coach.3.body"),
        next: t("void.coach.next"),
        highlight: '[data-pick-tower="repairDepot"]',
      },
      {
        title: t("void.coach.4.title"),
        body: t("void.coach.4.body"),
        next: t("void.coach.gotIt"),
        highlight: "[data-start-battle]",
      },
    ];

    const step = steps[this.coachStep];
    if (!step) {
      this.coachStep = -1;
      el.hidden = true;
      return;
    }

    if (step.highlight) {
      this.root.querySelectorAll(step.highlight).forEach((n) => n.classList.add("void-coach-pulse"));
    }

    el.hidden = false;
    el.innerHTML = `
      <div class="void-coach-head">
        <strong>${step.title}</strong>
        <button type="button" class="secondary-btn void-coach-skip" data-coach-skip>${t("void.coach.skip")}</button>
      </div>
      <p>${step.body}</p>
      ${step.next ? `<div class="void-coach-actions"><button type="button" class="primary-btn" data-coach-next>${step.next}</button></div>` : ""}
    `;

    el.querySelector<HTMLButtonElement>("[data-coach-skip]")!.onclick = () => {
      this.save.coachDone = true;
      this.coachStep = -1;
      this.persist();
      this.renderCoach();
    };
    const nextBtn = el.querySelector<HTMLButtonElement>("[data-coach-next]");
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.coachStep >= 3) {
          this.save.coachDone = true;
          this.coachStep = -1;
          this.persist();
        } else {
          this.coachStep++;
        }
        this.renderCoach();
      };
    }
  }

  private applyLanguage(): void {
    translateWithin(this.root);
    this.statsPillEls = null;
    this.lastCtrlKey = "";
    this.lastProfileKey = "";
    this.refreshHUD();
    this.renderCoach();
    this.techView.retranslate();
  }

  openSettingsDialog(): void {
    const dlg = this.root.querySelector<HTMLDialogElement>("#void-settings-dialog");
    if (!dlg) return;
    const showDev =
      (typeof location !== "undefined" && location.search.includes("dev=1")) ||
      this.save.settings.devMode;

    dlg.innerHTML = `
      <div class="void-settings-modal">
        <div class="void-dialog-head">
          <span class="void-emblem" aria-hidden="true"></span>
          <h2>${t("void.settings.title")}</h2>
        </div>
        <div class="void-settings-panel">
          <h3>${t("void.settings.gameplay")}</h3>
          <div class="void-settings-row">
            <label><input type="checkbox" data-set-pause-blur ${this.save.settings.pauseOnBlur ? "checked" : ""} /> ${t("void.settings.pauseOnBlur")}</label>
            <label><input type="checkbox" data-set-mag ${this.save.settings.magnifier ? "checked" : ""} /> ${t("void.settings.magnifier")}</label>
            <label><input type="checkbox" data-set-ring-menu ${this.save.settings.ringMenu ? "checked" : ""} /> ${t("void.settings.ringMenu")}</label>
          </div>
        </div>
        <div class="void-settings-panel">
          <h3>${t("void.settings.audio")}</h3>
          <div class="void-settings-row">
            <label><input type="checkbox" data-set-sound ${!this.save.settings.soundOff ? "checked" : ""} /> ${t("void.settings.sound")}</label>
            <label class="void-slider-row"><span>${t("void.settings.master")}</span><input type="range" min="0" max="100" step="5" value="${this.save.settings.masterVolume}" data-set-vol-master /></label>
            <label class="void-slider-row"><span>${t("void.settings.sfx")}</span><input type="range" min="0" max="100" step="5" value="${this.save.settings.sfxVolume}" data-set-vol-sfx /></label>
            <label class="void-slider-row"><span>${t("void.settings.ambience")}</span><input type="range" min="0" max="100" step="5" value="${this.save.settings.ambienceVolume}" data-set-vol-amb /></label>
            <label class="void-slider-row"><span>${t("void.settings.music")}</span><input type="range" min="0" max="100" step="5" value="${this.save.settings.musicVolume}" data-set-vol-music /></label>
          </div>
        </div>
        <div class="void-settings-panel">
          <h3>${t("void.settings.display")}</h3>
          <div class="void-settings-row">
            <label class="void-select-row"><span>${t("void.settings.language")}</span>
              <select data-set-lang>
                ${LANGUAGES.map((l) => `<option value="${l.code}" ${this.save.settings.language === l.code ? "selected" : ""}>${l.name}</option>`).join("")}
              </select>
            </label>
            <label><input type="checkbox" data-set-motion ${this.save.settings.reduceMotion ? "checked" : ""} /> ${t("void.settings.motion")}</label>
            <label><input type="checkbox" data-set-pfont ${this.save.settings.pixelFont ? "checked" : ""} /> ${t("void.settings.pixelFont")}</label>
            <label class="void-select-row"><span>${t("void.settings.bheight")}</span>
              <select data-set-bheight>
                <option value="full" ${this.save.settings.buildingHeight === "full" ? "selected" : ""}>Full (1 px / 2 floors)</option>
                <option value="low" ${this.save.settings.buildingHeight === "low" ? "selected" : ""}>Low (Half Height)</option>
                <option value="flat" ${this.save.settings.buildingHeight === "flat" ? "selected" : ""}>Flat (Top-Down)</option>
              </select>
            </label>
            ${
              showDev
                ? `<label><input type="checkbox" data-set-dev ${this.save.settings.devMode ? "checked" : ""} /> Developer Mode (Unlock All &amp; Unlimited Supplies)</label>`
                : ""
            }
          </div>
        </div>
        <div class="void-dialog-actions">
          <button type="button" class="primary-btn" data-set-close>${t("void.settings.done")}</button>
        </div>
      </div>
    `;

    dlg.querySelector<HTMLSelectElement>("[data-set-lang]")!.onchange = (e) => {
      const lang = (e.target as HTMLSelectElement).value as typeof this.save.settings.language;
      this.save.settings.language = lang;
      setLanguage(lang);
      this.persist();
      this.applyLanguage();
      dlg.close();
      this.openSettingsDialog();
    };

    dlg.querySelector<HTMLInputElement>("[data-set-sound]")!.onchange = (e) => {
      this.save.settings.soundOff = !(e.target as HTMLInputElement).checked;
      syncAudioFocus(!soundOn());
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-pause-blur]")!.onchange = (e) => {
      this.save.settings.pauseOnBlur = (e.target as HTMLInputElement).checked;
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-vol-master]")!.oninput = (e) => {
      this.save.settings.masterVolume = Number((e.target as HTMLInputElement).value);
      this.syncAudioVolumes();
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-vol-sfx]")!.oninput = (e) => {
      this.save.settings.sfxVolume = Number((e.target as HTMLInputElement).value);
      this.syncAudioVolumes();
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-vol-amb]")!.oninput = (e) => {
      this.save.settings.ambienceVolume = Number((e.target as HTMLInputElement).value);
      this.syncAudioVolumes();
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-vol-music]")!.oninput = (e) => {
      this.save.settings.musicVolume = Number((e.target as HTMLInputElement).value);
      this.syncAudioVolumes();
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-mag]")!.onchange = (e) => {
      this.save.settings.magnifier = (e.target as HTMLInputElement).checked;
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-ring-menu]")!.onchange = (e) => {
      this.save.settings.ringMenu = (e.target as HTMLInputElement).checked;
      this.persist();
      this.renderTowerInspector();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-motion]")!.onchange = (e) => {
      this.save.settings.reduceMotion = (e.target as HTMLInputElement).checked;
      this.renderer.reduceEffects = this.save.settings.reduceMotion;
      document.documentElement.classList.toggle("reduce-motion", this.save.settings.reduceMotion);
      this.persist();
    };
    dlg.querySelector<HTMLInputElement>("[data-set-pfont]")!.onchange = (e) => {
      this.save.settings.pixelFont = (e.target as HTMLInputElement).checked;
      document.documentElement.classList.toggle("pixel-font", this.save.settings.pixelFont);
      this.persist();
    };
    dlg.querySelector<HTMLSelectElement>("[data-set-bheight]")!.onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.save.settings.buildingHeight = v === "low" || v === "flat" ? v : "full";
      this.renderer.buildingHeight = this.save.settings.buildingHeight;
      this.persist();
    };
    const devInput = dlg.querySelector<HTMLInputElement>("[data-set-dev]");
    if (devInput) {
      devInput.onchange = (e) => {
        this.save.settings.devMode = (e.target as HTMLInputElement).checked;
        this.persist();
        this.startNewRun(this.save.selectedScenario);
      };
    }
    dlg.querySelector<HTMLButtonElement>("[data-set-close]")!.onclick = () => {
      dlg.close();
    };

    dlg.showModal();
  }

  private openProfileDialog(firstTime: boolean): void {
    const dlg = this.root.querySelector<HTMLDialogElement>("#void-profile-dialog")!;
    const current = this.save.profile;
    let chosenMode: PlayStyleMode = current?.mode ?? "underSiege";

    dlg.innerHTML = `
      <form class="void-profile-form">
        <div class="void-dialog-head">
          <span class="void-emblem" aria-hidden="true"></span>
          <h2>${firstTime ? t("void.profile.welcome") : t("void.profile.edit")}</h2>
        </div>
        <p>Year 3000: Reality has ruptured in the metropolitan core. Set your callsign and operational doctrine before deployment.</p>
        <label>Commander Callsign
          <input name="callsign" maxlength="24" value="${escapeText(current?.name ?? "")}" placeholder="Leave blank for random callsign" />
        </label>
        <fieldset class="void-mode-fieldset">
          <legend>Operational Doctrine</legend>
          <button type="button" class="void-mode-card ${chosenMode === "underSiege" ? "selected" : ""}" data-dlg-mode="underSiege">
            <strong>${t("void.mode.underSiege")}</strong>
            <p>Build and adapt in real time as the Void consumes the city. Earn continuous Supplies from surviving blocks.</p>
          </button>
          <button type="button" class="void-mode-card ${chosenMode === "buildAndWatch" ? "selected" : ""}" data-dlg-mode="buildAndWatch">
            <strong>${t("void.mode.buildAndWatch")}</strong>
            <p>Prepare your defenses with a fixed starting budget, then unleash the Void and watch your plan unfold.</p>
          </button>
        </fieldset>
        <div class="void-dialog-actions">
          ${!firstTime ? `<button type="button" class="secondary-btn" data-dlg-cancel>Cancel</button>` : ""}
          <button type="submit" class="primary-btn">${firstTime ? t("void.profile.enter") : t("void.profile.save")}</button>
        </div>
      </form>
    `;

    const cancelBtn = dlg.querySelector<HTMLButtonElement>("[data-dlg-cancel]");
    if (cancelBtn) cancelBtn.onclick = () => dlg.close();

    dlg.querySelectorAll<HTMLButtonElement>("[data-dlg-mode]").forEach((btn) => {
      btn.onclick = () => {
        chosenMode = btn.dataset.dlgMode as PlayStyleMode;
        dlg.querySelectorAll<HTMLButtonElement>("[data-dlg-mode]").forEach((b) =>
          b.classList.toggle("selected", b.dataset.dlgMode === chosenMode),
        );
      };
    });

    dlg.querySelector("form")!.onsubmit = (e) => {
      e.preventDefault();
      const input = dlg.querySelector<HTMLInputElement>('input[name="callsign"]')!;
      const name = cleanName(input.value) ?? randomPlayerName();
      const profile: VoidProfile = {
        name,
        flag: current?.flag ?? defaultFlag(),
        mode: chosenMode,
      };
      this.save.profile = profile;
      this.persist();
      dlg.close();
      this.startNewRun(this.save.selectedScenario, chosenMode);
    };

    dlg.showModal();
  }

  private lastFrameMs = 0;

  frame(nowMs: number): void {
    const dt = this.lastFrameMs ? Math.min(0.1, (nowMs - this.lastFrameMs) / 1000) : 0.016;
    this.lastFrameMs = nowMs;

    if (this.titleOpen) {
      if (!document.hidden) this.paintTitleBackdrop(nowMs);
      if (this.lastSoundInBattle) {
        this.lastSoundInBattle = false;
        this.soundEngine.update(100, 0, false);
      }
      this.musicEngine.update("title", 0, nowMs);
      return;
    }

    const modalOpen = Boolean(this.root.querySelector("dialog[open]"));
    if (!document.hidden && this.tab === "battle") {
      const prevTick = this.sim.tick;
      const hadOutcome = !!this.sim.outcome;
      if (!modalOpen && !this.awaitingDeploy) {
        this.sim.advanceFrame(dt);
      }
      const hudTick = Math.floor(this.sim.tick / 15) !== Math.floor(prevTick / 15);
      if (!hadOutcome && this.sim.outcome) {
        this.soundEngine.playSfx(this.sim.outcome.status === "won" ? "victory" : "defeat");
        this.musicEngine.triggerOutcome(this.sim.outcome.status);
        this.renderer.triggerOutcomeFlash(this.sim.outcome.status === "won");
        this.persist();
        this.refreshHUD();
      } else if (hudTick) {
        this.refreshHUD();
        this.renderPalette();
      }

      // Drain sim audio/visual events
      const ev = this.sim.sfxEvents;
      if (ev.pelletsFired > 0) this.soundEngine.playSfx("cannonFire");
      if (ev.pelletsHit > 0) this.soundEngine.playSfx("shellImpact");
      if (ev.collapses > 0) this.soundEngine.playSfx("collapse", Math.min(1.4, 0.75 + ev.collapses * 0.2));
      if (ev.cellsConsumed > 0) this.soundEngine.playSfx("voidConsume");
      if (ev.unitsLost > 0) this.soundEngine.playSfx("unitDeath");
      if (ev.lastIncomeAmount > 0) {
        const b = this.sim.world.buildings.find((mb) => mb.isSkyscraper) ?? this.sim.world.buildings[0];
        if (b) {
          this.renderer.triggerIncomePopup(b.x + b.w * 0.5, b.y + b.h * 0.5, ev.lastIncomeAmount);
        }
      }
      ev.pelletsFired = 0;
      ev.pelletsHit = 0;
      ev.collapses = 0;
      ev.cellsConsumed = 0;
      ev.unitsLost = 0;
      ev.lastIncomeAmount = 0;
      this.renderer.draw(
        this.sim,
        nowMs,
        this.selectedTowerUid,
        this.hoverPreview,
        this.loupePointer,
        this.save.settings.magnifier,
      );
      this.towerMenu.position();

      const inBattle = this.sim.phase === "battle" && !this.sim.outcome && !this.sim.paused;
      const contacts = this.sim.voidField.totalContactEdges();
      if (hudTick || inBattle !== this.lastSoundInBattle) {
        this.lastSoundInBattle = inBattle;
        this.soundEngine.update(
          this.lastPreservedPercent,
          contacts,
          inBattle,
          this.sim.physics.activeFallingChunkCount(),
        );
      }
      this.musicEngine.update(this.sim.outcome ? "outcome" : inBattle ? "battle" : "title", contacts, nowMs);
    } else {
      if (this.lastSoundInBattle) {
        this.lastSoundInBattle = false;
        this.soundEngine.update(100, 0, false);
      }
      this.musicEngine.update("title", 0, nowMs);
      if (!document.hidden && this.tab === "network") {
        this.techView.frame(nowMs);
      } else if (!document.hidden && this.tab === "operations") {
        this.opsView.frame(nowMs);
      } else if (!document.hidden && this.tab === "map") {
        this.mapView?.frame(nowMs);
      }
    }
  }

  /** Whether the tab is hidden or the browser window has lost focus. */
  isUnfocused(): boolean {
    const hidden = typeof document !== "undefined" && document.hidden;
    return hidden || !this.windowFocused;
  }

  /** Whether audio should currently be muted due to losing tab/window focus. */
  isMutedByFocus(): boolean {
    return this.save.settings.pauseOnBlur && this.isUnfocused();
  }

  /** Pauses active battle and mutes audio on tab/window focus loss when enabled, and resets the frame clock. */
  handleFocusChange(windowFocused?: boolean): void {
    if (typeof windowFocused === "boolean") {
      this.windowFocused = windowFocused;
    } else if (typeof document !== "undefined" && typeof document.hasFocus === "function") {
      this.windowFocused = document.hasFocus();
    }
    const unfocused = this.isUnfocused();
    this.lastFrameMs = 0;

    if (unfocused && this.save.settings.pauseOnBlur) {
      let hudDirty = false;
      if (!this.titleOpen && this.sim.phase === "battle" && !this.sim.outcome && !this.sim.paused) {
        this.sim.paused = true;
        hudDirty = true;
      }
      this.lastSoundInBattle = false;
      this.soundEngine.update(100, 0, false);
      this.musicEngine.update("title", 0);
      syncAudioFocus(true);
      if (hudDirty) this.refreshHUD();
      this.persist();
    } else {
      syncAudioFocus(!soundOn());
      if (unfocused) {
        this.persist();
      } else {
        this.syncAudioVolumes();
      }
    }
  }

  /** Resets frame accumulator on visibility change / pagehide so zero offline progress ever occurs. */
  resetClockOnVisibility(): void {
    this.handleFocusChange();
  }
}
