/** Resistance Command Shell, Battle HUD, Drag-to-Place / Strike / Blueprint
 * Pointers, Profile Mode Picker, and Tab Navigation for Void Defense. */

import { cleanName, defaultFlag, escapeText, flagSvg, randomPlayerName } from "../profile/model.ts";
import { play } from "../sound.ts";
import { VoidSoundEngine } from "./audio.ts";
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
  private soundEngine = new VoidSoundEngine();

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
    this.buildDOM();
    if (!this.save.profile) {
      this.openProfileDialog(true);
    }
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <main class="void-shell">
        <header class="void-topbar">
          <div class="void-brand">
            <span class="void-emblem" aria-hidden="true"></span>
            <div>
              <strong>VOID DEFENSE</strong>
              <small data-top-scenario></small>
            </div>
          </div>
          <div class="void-currencies">
            <div class="void-curr void-curr--supplies" title="Supplies: runtime construction & strike resource earned from surviving city blocks">
              <i class="void-curr-gem void-curr-gem--supplies" aria-hidden="true"></i>
              <span>Supplies</span>
              <b data-curr-supplies>0</b>
            </div>
            <div class="void-curr void-curr--essence" title="Void Essence: repeatable between-run technology resource">
              <i class="void-curr-gem void-curr-gem--essence" aria-hidden="true"></i>
              <span>Essence</span>
              <b data-curr-essence>0</b>
            </div>
            <div class="void-curr void-curr--sparks" title="Sparks of Defiance: rare milestone breakthroughs (1 shared entitlement per sector)">
              <i class="void-curr-gem void-curr-gem--sparks" aria-hidden="true"></i>
              <span>Sparks</span>
              <b data-curr-sparks>0</b>
            </div>
          </div>
          <div class="void-profile-bar" data-profile-bar></div>
        </header>

        <section id="void-page-battle" class="void-page active">
          <div class="void-board-stage">
            <canvas id="void-board-canvas"></canvas>

            <!-- Ultra-clean HUD Overlays directly floating over battle canvas -->
            <div class="void-battle-hud" data-battle-hud>
              <div class="void-hud-top">
                <div class="void-hud-bar-wrap" title="Metropolitan Survival & Void Reservoir">
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

              <div class="void-inspector" data-tower-inspector hidden></div>
              <div class="void-outcome-banner" data-outcome-banner hidden></div>

              <!-- Ultra-clean dock tray centered at bottom -->
              <div class="void-hud-bottom" role="toolbar" aria-label="Tactical Action Bar">
                <div class="void-hud-tray">
                  <div class="void-palette" data-tower-palette></div>
                  <div class="void-hud-tray-divider" aria-hidden="true"></div>
                  <div class="void-strikes" data-strike-palette></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="void-page-network" class="void-page"></section>
        <section id="void-page-operations" class="void-page"></section>
        <section id="void-page-map" class="void-page"></section>

        <div class="void-nav" role="tablist" aria-label="Resistance Navigation">
          <button type="button" data-void-tab="battle" class="selected">Defense Feed</button>
          <button type="button" data-void-tab="network">Global Tech Network</button>
          <button type="button" data-void-tab="operations">Resistance Ops</button>
          <button type="button" data-void-tab="map">Resistance Map</button>
        </div>
      </main>
      <dialog id="void-profile-dialog" class="void-dialog"></dialog>
    `;

    const canvas = this.root.querySelector<HTMLCanvasElement>("#void-board-canvas")!;
    this.renderer = new VoidRenderer(canvas);
    this.renderer.reduceEffects = this.save.settings.reduceMotion;
    this.renderer.buildingHeight = this.save.settings.buildingHeight;
    this.bindBoardPointers(canvas);

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
        play("stone");
        this.navigate(btn.dataset.voidTab as VoidTab);
      };
    });

    window.addEventListener("keydown", (e) => {
      if (this.tab !== "battle") return;
      if (e.key === "Escape") {
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
    this.renderer.reduceEffects = this.save.settings.reduceMotion;
    this.renderer.buildingHeight = this.save.settings.buildingHeight;
    this.renderer.resetCam(this.sim.world.grid.w, this.sim.world.grid.h);
    this.persist();
    this.renderPalette();
    this.refreshHUD();
    this.navigate("battle");
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
        play("knock");
        this.selectedTowerUid = placed.uid;
        this.refreshHUD();
      }
      return;
    }

    if (this.activeTool.kind === "castStrike") {
      const ok = this.sim.castStrike(this.activeTool.strike, fx, fy);
      if (ok) {
        play("stone");
        this.activeTool = { kind: "none" };
        this.hoverPreview = null;
        this.renderPalette();
        this.refreshHUD();
      }
      return;
    }

    if (this.activeTool.kind === "setReticle") {
      if (this.sim.setTowerFocus(this.activeTool.towerUid, fx, fy)) {
        play("knock");
      }
      this.activeTool = { kind: "none" };
      this.hoverPreview = null;
      this.refreshHUD();
      return;
    }

    if (this.activeTool.kind === "drawBlueprint") {
      if (this.activeTool.points.length >= 2) {
        this.sim.combat.addWallBlueprint(this.sim.world, [...this.activeTool.points], false);
        play("knock");
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
      this.selectedTowerUid = picked.uid;
      this.selectedBuildingId = null;
      this.refreshHUD();
      return;
    }
    if (picked?.kind === "building") {
      // Still allow ground tower hit if a tower is right under or adjacent to the tap
      if (this.sim.world.grid.inBounds(cx, cy)) {
        const groundUid = this.sim.world.towerAt[this.sim.world.grid.index(cx, cy)];
        if (groundUid >= 0) {
          this.selectedTowerUid = groundUid;
          this.selectedBuildingId = null;
          this.refreshHUD();
          return;
        }
      }
      this.selectedTowerUid = null;
      this.selectedBuildingId = picked.id;
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
      this.selectedTowerUid = uid >= 0 ? uid : null;
      this.selectedBuildingId = null;
      this.refreshHUD();
    }
  }

  private renderPalette(): void {
    const towerPal = this.root.querySelector<HTMLElement>("[data-tower-palette]")!;
    const strikePal = this.root.querySelector<HTMLElement>("[data-strike-palette]")!;

    const unlockedTowers = [...this.sim.tech.unlockedTowers];
    towerPal.innerHTML =
      unlockedTowers
        .map((type) => {
          const spec = TOWER_SPECS[type];
          const price = this.sim.towerPrice(type);
          const active =
            this.activeTool.kind === "placeTower" && this.activeTool.type === type;
          const lockedByMode = !this.sim.canModifyTowers();
          return `
            <button type="button" class="void-pal-btn ${active ? "selected" : ""}" data-pick-tower="${type}" ${
              lockedByMode ? "disabled" : ""
            } title="${spec.name}: ${spec.description}">
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

    towerPal.querySelectorAll<HTMLButtonElement>("[data-pick-tower]").forEach((btn) => {
      const startTowerPick = (fromDrag: boolean, e?: PointerEvent) => {
        const t = btn.dataset.pickTower as TowerTypeId;
        if (!fromDrag && this.activeTool.kind === "placeTower" && this.activeTool.type === t) {
          this.activeTool = { kind: "none" };
        } else {
          this.activeTool = { kind: "placeTower", type: t };
        }
        this.hoverPreview = null;
        this.renderPalette();
        if (fromDrag && e) {
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
      };
      btn.onclick = () => startTowerPick(false);
      btn.onpointerdown = (e) => {
        if (e.button === 0 && !btn.disabled) startTowerPick(true, e);
      };
    });

    const bpBtn = towerPal.querySelector<HTMLButtonElement>("[data-pick-blueprint]");
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

    const unlockedStrikes = [...this.sim.tech.unlockedStrikes];
    strikePal.innerHTML = unlockedStrikes
      .map((s, idx) => {
        const spec = STRIKE_SPECS[s];
        const price = this.sim.strikePrice(s);
        const cd = Math.ceil(this.sim.combat.strikeCooldowns[s]);
        const active =
          this.activeTool.kind === "castStrike" && this.activeTool.strike === s;
        return `
          <button type="button" class="void-pal-btn void-pal-btn--strike ${active ? "selected" : ""}" data-pick-strike="${s}" ${
            cd > 0 || this.sim.phase !== "battle" ? "disabled" : ""
          } title="${spec.name} [Hotkey ${idx + 1}]: ${spec.description}">
            <canvas class="void-card-icon" width="20" height="20" data-card-icon="${s}"></canvas>
            <b>${spec.shortName}</b>
            <small>${cd > 0 ? `${cd}s` : `${price} SUP`}</small>
          </button>
        `;
      })
      .join("");

    strikePal.querySelectorAll<HTMLButtonElement>("[data-pick-strike]").forEach((btn) => {
      const startStrikePick = (fromDrag: boolean, e?: PointerEvent) => {
        const s = btn.dataset.pickStrike as StrikeId;
        if (!fromDrag && this.activeTool.kind === "castStrike" && this.activeTool.strike === s) {
          this.activeTool = { kind: "none" };
        } else {
          this.activeTool = { kind: "castStrike", strike: s };
        }
        this.hoverPreview = null;
        this.renderPalette();
        if (fromDrag && e) {
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
      };
      btn.onclick = () => startStrikePick(false);
      btn.onpointerdown = (e) => {
        if (e.button === 0 && !btn.disabled) startStrikePick(true, e);
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
    profBar.innerHTML = p
      ? `<button type="button" class="void-prof-btn" data-edit-profile>${flagSvg(p.flag, "void-mini-flag")} <span>${escapeText(p.name)}</span> <small>(${p.mode === "underSiege" ? "Under Siege" : "Build & Watch"})</small></button>`
      : `<button type="button" class="void-prof-btn" data-edit-profile>Set Commander Profile</button>`;
    profBar.querySelector<HTMLButtonElement>("[data-edit-profile]")!.onclick = () =>
      this.openProfileDialog(false);

    // Tactical Telemetry Bar with sleek top-center health/integrity bar and minimal badges
    const { preservedPercent } = this.sim.world.computePreservedBaseline();
    const isFiniteVoid = Number.isFinite(this.sim.voidField.energyRemaining);
    const energyPct = isFiniteVoid
      ? Math.max(0, Math.min(100, (this.sim.voidField.energyRemaining / Math.max(1, this.sim.voidField.initialEnergy)) * 100))
      : 100;
    const energyText = isFiniteVoid
      ? `${Math.ceil(this.sim.voidField.energyRemaining)}`
      : "∞";

    const cityBarFill = this.root.querySelector<HTMLElement>("[data-hud-city-bar]");
    if (cityBarFill) cityBarFill.style.width = `${preservedPercent.toFixed(1)}%`;
    const cityText = this.root.querySelector<HTMLElement>("[data-hud-city-text]");
    if (cityText) cityText.textContent = `${preservedPercent.toFixed(1)}%`;

    const statsPills = this.root.querySelector<HTMLElement>("[data-hud-stats-pills]");
    if (statsPills) {
      statsPills.innerHTML = `
        <span class="void-hud-pill" title="Void Energy Remaining">Void <b>${energyText}</b></span>
        <span class="void-hud-pill" title="Active Frontier Contacts">Contacts <b>${this.sim.voidField.totalContactEdges()}</b></span>
        <span class="void-hud-pill" title="Active Units">Units <b>${this.sim.combat.agents.length}</b></span>
        <span class="void-hud-pill" title="Elapsed Battle Time">Time <b>${this.sim.elapsedSeconds.toFixed(1)}s</b></span>
      `;
    }

    // Run controls
    const ctrlEl = this.root.querySelector<HTMLElement>("[data-run-controls]")!;
    ctrlEl.innerHTML = `
      ${
        this.sim.phase === "prep"
          ? `<button type="button" class="primary-btn" data-start-battle>Unleash Void (Start Watch)</button>`
          : `<button type="button" data-toggle-pause>${this.sim.paused ? "Resume" : "Pause"}</button>`
      }
      <button type="button" data-cycle-speed>${this.sim.speed}x Speed</button>
      <button type="button" data-retry-run>Retry</button>
    `;

    const startBtn = ctrlEl.querySelector<HTMLButtonElement>("[data-start-battle]");
    if (startBtn) {
      startBtn.onclick = () => {
        this.sim.startBattle();
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

    this.renderTowerInspector();
    this.renderOutcomeBanner(this.sim.outcome);
  }

  private renderTowerInspector(): void {
    const insp = this.root.querySelector<HTMLElement>("[data-tower-inspector]")!;
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
          insp.hidden = false;
          insp.innerHTML = `
            <strong>${b.isSkyscraper ? "Skyscraper" : "Structure"} #${b.id} (${b.height}F)</strong>
            <span>Integrity: ${Math.round((intact / Math.max(1, b.cells.length)) * 100)}%</span>
            <button type="button" data-insp-close class="secondary-btn">X</button>
          `;
          insp.querySelector<HTMLButtonElement>("[data-insp-close]")!.onclick = () => {
            this.selectedBuildingId = null;
            this.refreshHUD();
          };
          return;
        }
      }
      insp.hidden = true;
      return;
    }
    const spec = TOWER_SPECS[t.type];
    const refund = this.sim.refundAmount(t.uid);
    const canModify = this.sim.canModifyTowers();
    let extraInfo = "";
    if (t.type === "voidSiphon") {
      const s = this.sim.combat.siphonStates.get(t.uid);
      if (s) {
        const pct = Math.round((s.stored / Math.max(1, s.maxStorage)) * 100);
        extraInfo = `<span>Tank: ${pct}% (${s.phase === "venting" ? `Venting ${s.ventRemaining.toFixed(1)}s` : "Intake"})</span>`;
      }
    } else if (t.type === "boundaryPrism") {
      const p = this.sim.combat.prismStates.get(t.uid);
      if (p) {
        const deg = Math.round((p.angleRad * 180) / Math.PI) % 360;
        extraInfo = `<span>Plane: ${deg}°</span><button type="button" data-insp-rotate class="secondary-btn">Rotate +45°</button>`;
      }
    } else if (t.type === "chronoCannon") {
      extraInfo = `<span>Rewind: ${t.cooldown <= 0 ? "Ready" : `${t.cooldown.toFixed(1)}s`}</span>`;
    }
    insp.hidden = false;
    insp.innerHTML = `
      <strong>${spec.name} #${t.uid}</strong>
      <span>HP: ${Math.ceil(t.hp)}/${t.maxHp}</span>
      ${extraInfo}
      <button type="button" data-insp-reticle class="secondary-btn">Set Focus Reticle</button>
      <button type="button" data-insp-sell class="danger-btn" ${canModify ? "" : "disabled"}>Sell (+${refund} SUP)</button>
      <button type="button" data-insp-close class="secondary-btn">X</button>
    `;
    const rotBtn = insp.querySelector<HTMLButtonElement>("[data-insp-rotate]");
    if (rotBtn) {
      rotBtn.onclick = () => {
        this.sim.combat.rotatePrism(t.uid);
        this.refreshHUD();
      };
    }
    insp.querySelector<HTMLButtonElement>("[data-insp-reticle]")!.onclick = () => {
      this.activeTool = { kind: "setReticle", towerUid: t.uid };
    };
    insp.querySelector<HTMLButtonElement>("[data-insp-sell]")!.onclick = () => {
      if (this.sim.sellTower(t.uid)) {
        this.selectedTowerUid = null;
        this.refreshHUD();
      }
    };
    insp.querySelector<HTMLButtonElement>("[data-insp-close]")!.onclick = () => {
      this.selectedTowerUid = null;
      this.refreshHUD();
    };
  }

  private renderOutcomeBanner(outcome: RunOutcome | null): void {
    const banner = this.root.querySelector<HTMLElement>("[data-outcome-banner]")!;
    if (!outcome) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const title = outcome.status === "won" ? "BREACH CONTAINED - VICTORY" : "METROPOLIS LOST - DEFEAT";
    banner.innerHTML = `
      <h2>${title}</h2>
      <p>Original City Preserved: <b>${outcome.preservedPercent.toFixed(1)}%</b> - Duration: <b>${outcome.elapsedSeconds}s</b></p>
      <p>Rewards Earned: <b>+${outcome.voidEssenceAwarded} Void Essence</b> - <b>+${outcome.sparksAwarded} Sparks of Defiance</b> (Tier ${outcome.sparksTier}/3)</p>
      ${
        !outcome.participated && outcome.status === "lost"
          ? `<small class="void-warn">Instant abort / zero defense activity detected: meaningful participation is required to harvest Void Essence on defeat.</small>`
          : ""
      }
      <div class="void-outcome-actions">
        <button type="button" class="primary-btn" data-out-retry>Deploy Again</button>
        ${outcome.status === "won" ? `<button type="button" class="primary-btn" data-out-map>Advance on the Resistance Map</button>` : ""}
        <button type="button" class="secondary-btn" data-out-tech>Spend Upgrades in Global Network</button>
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
              <strong>Build & Watch</strong>
              <p>Prepare your defenses beforehand with a fixed starting budget, then unleash the Void and watch your containment plan unfold.</p>
            </button>
          </div>
          <small>Note: Best survival percentages and attempt counts are tracked separately per mode. Each sector has <b>one shared Sparks of Defiance entitlement</b> (up to 3 Sparks), equal to the highest tier reached in either mode.</small>
        </section>

        <section class="void-settings-panel">
          <h3>Resistance Command Settings</h3>
          <div class="void-settings-row">
            <label><input type="checkbox" data-set-sound ${!this.save.settings.soundOff ? "checked" : ""} /> Audio Telemetry & Sound Effects</label>
            <label><input type="checkbox" data-set-mag ${this.save.settings.magnifier ? "checked" : ""} /> Precision Placement Magnifier (Loupe)</label>
            <label><input type="checkbox" data-set-motion ${this.save.settings.reduceMotion ? "checked" : ""} /> Reduce Motion & Ambient Flicker</label>
            <label>Building Height (Oblique Depth)
              <select data-set-bheight>
                <option value="full" ${this.save.settings.buildingHeight === "full" ? "selected" : ""}>Full (1 px / 2 floors)</option>
                <option value="low" ${this.save.settings.buildingHeight === "low" ? "selected" : ""}>Low (Half Height)</option>
                <option value="flat" ${this.save.settings.buildingHeight === "flat" ? "selected" : ""}>Flat (Legacy Top-Down)</option>
              </select>
            </label>
            <label><input type="checkbox" data-set-dev ${this.save.settings.devMode ? "checked" : ""} /> Developer Mode (Unlock All Towers/Strikes & Unlimited Supplies)</label>
          </div>
        </section>
    `;

    secPage.querySelector<HTMLInputElement>("[data-set-sound]")!.onchange = (e) => {
      this.save.settings.soundOff = !(e.target as HTMLInputElement).checked;
      this.persist();
    };
    secPage.querySelector<HTMLInputElement>("[data-set-mag]")!.onchange = (e) => {
      this.save.settings.magnifier = (e.target as HTMLInputElement).checked;
      this.persist();
    };
    secPage.querySelector<HTMLInputElement>("[data-set-motion]")!.onchange = (e) => {
      this.save.settings.reduceMotion = (e.target as HTMLInputElement).checked;
      this.renderer.reduceEffects = this.save.settings.reduceMotion;
      this.persist();
    };
    secPage.querySelector<HTMLSelectElement>("[data-set-bheight]")!.onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.save.settings.buildingHeight = v === "low" || v === "flat" ? v : "full";
      this.renderer.buildingHeight = this.save.settings.buildingHeight;
      this.persist();
    };
    secPage.querySelector<HTMLInputElement>("[data-set-dev]")!.onchange = (e) => {
      this.save.settings.devMode = (e.target as HTMLInputElement).checked;
      this.persist();
      this.startNewRun(this.save.selectedScenario);
    };

    secPage.querySelectorAll<HTMLButtonElement>("[data-select-mode]").forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.selectMode as PlayStyleMode;
        if (this.save.profile) this.save.profile.mode = m;
        this.startNewRun(this.save.selectedScenario, m);
        this.renderMapPage();
      };
    });

  }

  private openProfileDialog(firstTime: boolean): void {
    const dlg = this.root.querySelector<HTMLDialogElement>("#void-profile-dialog")!;
    const current = this.save.profile;
    let chosenMode: PlayStyleMode = current?.mode ?? "underSiege";

    dlg.innerHTML = `
      <form class="void-profile-form">
        <h2>${firstTime ? "Resistance Commander Onboarding" : "Commander Profile & Play Style"}</h2>
        <p>Year 3000: Reality has ruptured in the metropolitan core. Choose your callsign and preferred operational doctrine.</p>
        <label>Commander Callsign
          <input name="callsign" maxlength="24" value="${escapeText(current?.name ?? "")}" placeholder="Leave blank for random callsign" />
        </label>
        <fieldset class="void-mode-fieldset">
          <legend>Select Starting Operational Mode</legend>
          <button type="button" class="void-mode-card ${chosenMode === "underSiege" ? "selected" : ""}" data-dlg-mode="underSiege">
            <strong>Build Under Siege (Recommended)</strong>
            <p>Recommended: build and adapt in real time as the Void consumes the city. The intended, more demanding experience.</p>
          </button>
          <button type="button" class="void-mode-card ${chosenMode === "buildAndWatch" ? "selected" : ""}" data-dlg-mode="buildAndWatch">
            <strong>Build & Watch</strong>
            <p>Prepare your defenses, then unleash the Void and watch the battle unfold. A calmer planning-focused experience.</p>
          </button>
        </fieldset>
        <div class="void-dialog-actions">
          <button type="submit" class="primary-btn">Confirm & Enter Command</button>
        </div>
      </form>
    `;

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

    if (!document.hidden && this.tab === "battle") {
      const prevTick = this.sim.tick;
      const hadOutcome = !!this.sim.outcome;
      this.sim.advanceFrame(dt);
      if (!hadOutcome && this.sim.outcome) {
        this.persist();
        this.refreshHUD();
      } else if (Math.floor(this.sim.tick / 15) !== Math.floor(prevTick / 15)) {
        this.refreshHUD();
        this.renderPalette();
      }
      this.renderer.draw(
        this.sim,
        nowMs,
        this.selectedTowerUid,
        this.hoverPreview,
        this.loupePointer,
        this.save.settings.magnifier,
      );

      const baseline = this.sim.world.computePreservedBaseline();
      this.soundEngine.update(
        baseline.preservedPercent,
        this.sim.voidField.totalContactEdges(),
        this.sim.phase === "battle" && !this.sim.outcome && !this.sim.paused,
        this.sim.physics.activeFallingChunkCount(),
      );
    } else {
      this.soundEngine.update(100, 0, false);
      if (!document.hidden && this.tab === "network") {
        this.techView.frame(nowMs);
      } else if (!document.hidden && this.tab === "operations") {
        this.opsView.frame(nowMs);
      } else if (!document.hidden && this.tab === "map") {
        this.mapView?.frame(nowMs);
      }
    }
  }

  /** Resets frame accumulator on visibility change / pagehide so zero offline progress ever occurs. */
  resetClockOnVisibility(): void {
    this.lastFrameMs = 0;
    this.persist();
  }
}
