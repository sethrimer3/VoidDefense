/** Floating tower & structure selection menus for Void Defense, modeled after
 * TowerDefense's `BuildingPanel` (sliding side-of-board panel that avoids
 * covering the selected unit) and `PlacedBuildingMenu` (square ring frame
 * around the selected unit). */
import { t } from "../i18n/index.ts";
import type { MetroBuilding, PlacedTower, TowerTypeId } from "./model.ts";

const tr = (key: Parameters<typeof t>[0], params?: Record<string, string | number>): string => {
  const s = t(key);
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
};

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const PANEL_SIZE = { desktop: 204, phone: 156, phoneBelow: 560, margin: 8 } as const;

export const MENU_SIZE = {
  desktop: { bar: 48, min: 236 },
  phone: { bar: 42, min: 204 },
  phoneBelow: 560,
  margin: 8,
} as const;

export const MENU_COST_ROOM = 16;

export const menuBars = (view: { w: number }) =>
  view.w < MENU_SIZE.phoneBelow ? MENU_SIZE.phone : MENU_SIZE.desktop;

/** Which side the panel stands on, given the target's span `x0`–`x1` across a
 * board `width` wide and the panel's own `w`: the right, unless it would cover
 * the target there and the left would not (`was` is kept when both would). */
export function panelSide(
  x0: number,
  x1: number,
  width: number,
  w: number,
  was: "left" | "right" = "right",
): "left" | "right" {
  const m = PANEL_SIZE.margin;
  if (x1 <= width - m - w) return "right";
  if (x0 >= m + w) return "left";
  return was;
}

/** Where the square ring menu stands round a target at `rect` (CSS pixels in
 * the board's view, `view` its size): a square centred on it, its open middle
 * at least as big as the target, shifted inward to stay on screen. */
export function buildingMenuBox(
  rect: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number },
  headroom = 0,
  plain = false,
) {
  const s = menuBars(view);
  const hole = Math.ceil(Math.max(rect.w, rect.h) + 8);
  const fit = Math.min(view.w, view.h) - 2 * MENU_SIZE.margin;
  const size = Math.min(Math.max(hole + 2 * s.bar, plain ? 0 : s.min), Math.max(fit, 3 * s.bar));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const clamp = (v: number, span: number, low: number = MENU_SIZE.margin) =>
    Math.min(Math.max(v, low), Math.max(low, span - size - MENU_SIZE.margin));
  return {
    left: Math.round(clamp(cx - size / 2, view.w)),
    top: Math.round(clamp(cy - size / 2, view.h, MENU_SIZE.margin + headroom)),
    size: Math.round(size),
    bar: s.bar,
  };
}

export type TowerMenuTarget =
  | {
      kind: "tower";
      tower: PlacedTower;
      name: string;
      level: number;
      hp: number;
      maxHp: number;
      upgCost: number;
      canUpgrade: boolean;
      refund: number;
      canModify: boolean;
      extraStats: string;
      hasRotate: boolean;
      focusSet: boolean;
    }
  | {
      kind: "building";
      building: MetroBuilding;
      name: string;
      height: number;
      integrityPct: number;
    };

export type TowerMenuHost = {
  board(): HTMLElement;
  renderer(): { toClient(fx: number, fy: number): { x: number; y: number } };
  ringMenu(): boolean;
  reduceMotion(): boolean;
  paintTowerIcon(canvas: HTMLCanvasElement, type: TowerTypeId): void;
  upgrade(uid: number): void;
  rotate(uid: number): void;
  focus(uid: number, placing: boolean): void;
  sell(uid: number): void;
  closed(): void;
};

function targetKey(target: TowerMenuTarget): string {
  return target.kind === "tower" ? `t:${target.tower.uid}` : `b:${target.building.id}`;
}

function targetRect(target: TowerMenuTarget): { x: number; y: number; w: number; h: number } {
  return target.kind === "tower"
    ? { x: target.tower.x, y: target.tower.y, w: target.tower.w, h: target.tower.h }
    : { x: target.building.x, y: target.building.y, w: target.building.w, h: target.building.h };
}

function paintBuildingPortrait(canvas: HTMLCanvasElement, isSkyscraper: boolean): void {
  const c = canvas.getContext("2d");
  if (!c) return;
  c.clearRect(0, 0, 20, 20);
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#161d29";
  c.fillRect(1, 1, 18, 18);
  c.strokeStyle = "#3a4860";
  c.lineWidth = 1;
  c.strokeRect(1.5, 1.5, 17, 17);

  if (isSkyscraper) {
    c.fillStyle = "#41546e";
    c.fillRect(6, 3, 8, 14);
    c.fillStyle = "#8cb8de";
    for (let y = 5; y <= 14; y += 3) {
      c.fillRect(7, y, 2, 1);
      c.fillRect(11, y, 2, 1);
    }
    c.fillStyle = "#ff9e38";
    c.fillRect(9, 2, 2, 1);
  } else {
    c.fillStyle = "#505c70";
    c.fillRect(4, 8, 12, 9);
    c.fillStyle = "#ffd166";
    c.fillRect(6, 10, 2, 2);
    c.fillRect(12, 10, 2, 2);
  }
}

export function towerPanelHtml(target: TowerMenuTarget, placing = false): string {
  if (target.kind === "building") {
    return (
      `<aside class="void-building-panel" data-side="right" role="dialog" aria-label="${esc(target.name)}">` +
      `<header class="vbp-head"><strong class="vbp-name">${esc(target.name)}</strong>` +
      `<button type="button" class="vbp-close" data-vbp="close" aria-label="Close">×</button></header>` +
      `<div class="vbp-portrait"><canvas width="20" height="20" data-vbp-bldg="${target.building.isSkyscraper ? "sky" : "std"}"></canvas>` +
      `<span class="vbp-badge">${target.height}F</span></div>` +
      `<div class="vbp-stats"><span>Integrity: <b>${target.integrityPct}%</b></span></div>` +
      `</aside>`
    );
  }

  const upgBtn =
    target.upgCost > 0
      ? `<button type="button" class="primary-btn" data-vbp="upgrade" ${target.canUpgrade ? "" : "disabled"}>${tr("void.insp.upgrade", { n: target.level + 1, cost: target.upgCost })}</button>`
      : `<div class="vbp-max">${tr("void.insp.maxLv")}</div>`;

  const rotateBtn = target.hasRotate
    ? `<button type="button" class="secondary-btn" data-vbp="rotate">Rotate +45°</button>`
    : "";

  const focusBtn = target.tower.type === "deliveryDepot" ? "" : `<button type="button" class="secondary-btn vbp-focus" data-vbp="focus" aria-pressed="${placing || target.focusSet}">${tr("void.insp.focus")}</button>`;
  const sellBtn = `<button type="button" class="danger-btn" data-vbp="sell" ${target.canModify ? "" : "disabled"}>${tr("void.insp.sell", { n: target.refund })}</button>`;

  return (
    `<aside class="void-building-panel${placing ? " placing" : ""}" data-side="right" role="dialog" aria-label="${esc(target.name)}">` +
    `<header class="vbp-head"><strong class="vbp-name">${esc(target.name)}</strong>` +
    `<button type="button" class="vbp-close" data-vbp="close" aria-label="Close">×</button></header>` +
    `<div class="vbp-portrait"><canvas width="20" height="20" data-vbp-tower="${esc(target.tower.type)}"></canvas>` +
    `<span class="vbp-badge">${tr("void.insp.lv", { n: target.level })}</span></div>` +
    `<div class="vbp-stats"><span>${tr("void.insp.hp")}: <b>${Math.ceil(target.hp)}/${target.maxHp}</b></span>${target.extraStats}</div>` +
    `<div class="vbp-actions">${upgBtn}${rotateBtn}${focusBtn}${sellBtn}</div>` +
    `</aside>`
  );
}

export function towerRingHtml(target: TowerMenuTarget, placing = false): string {
  if (target.kind === "building") {
    return (
      `<div class="void-building-menu" data-plain="true" role="dialog" aria-label="${esc(target.name)}">` +
      `<div class="vbm-bar vbm-top"><span class="vbm-tag">${esc(target.name)} · ${target.height}F (${target.integrityPct}%)</span></div>` +
      `<div class="vbm-bar vbm-left"></div>` +
      `<div class="vbm-hole" aria-hidden="true"></div>` +
      `<div class="vbm-bar vbm-right"></div>` +
      `<div class="vbm-bar vbm-bottom"><button type="button" class="vbm-btn" data-vbp="close" aria-label="Close">×</button></div>` +
      `</div>`
    );
  }

  const upg =
    target.upgCost > 0
      ? `<span class="vbm-upgrade${target.canUpgrade ? "" : " short"}"><span class="vbm-cost" aria-hidden="true">${target.upgCost}</span>` +
        `<button type="button" class="vbm-btn primary-btn" data-vbp="upgrade" ${target.canUpgrade ? "" : "disabled"} title="${esc(tr("void.insp.upgrade", { n: target.level + 1, cost: target.upgCost }))}">▲${target.level + 1}</button></span>`
      : `<span class="vbm-tag">${tr("void.insp.maxLv")}</span>`;

  const left =
    `<span class="vbm-tag">${tr("void.insp.lv", { n: target.level })}</span>` +
    (target.hasRotate
      ? `<button type="button" class="vbm-btn secondary-btn" data-vbp="rotate" title="Rotate +45°">↻</button>`
      : "");

  const right = target.tower.type === "deliveryDepot" ? "" :
    `<div class="vbm-aim"><button type="button" class="vbm-btn secondary-btn" data-vbp="focus" aria-pressed="${placing || target.focusSet}" title="${esc(tr("void.insp.focus"))}">⌖</button></div>`;

  const bottom =
    `<button type="button" class="vbm-btn danger-btn" data-vbp="sell" ${target.canModify ? "" : "disabled"} title="${esc(tr("void.insp.sell", { n: target.refund }))}">+${target.refund}</button>`;

  return (
    `<div class="void-building-menu${placing ? " placing" : ""}" role="dialog" aria-label="${esc(target.name)}">` +
    `<div class="vbm-bar vbm-top">${upg}</div>` +
    `<div class="vbm-bar vbm-left">${left}</div>` +
    `<div class="vbm-hole" aria-hidden="true"></div>` +
    `<div class="vbm-bar vbm-right">${right}</div>` +
    `<div class="vbm-bar vbm-bottom">${bottom}</div>` +
    `</div>`
  );
}

export class TowerMenuController {
  element: HTMLElement | null = null;
  target: TowerMenuTarget | null = null;
  placing = false;
  private side: "left" | "right" = "right";
  private lastKey: string | null = null;
  private lastSignature = "";

  constructor(private host: TowerMenuHost) {}

  show(target: TowerMenuTarget, placing = false): void {
    const key = targetKey(target);
    const ring = this.host.ringMenu();
    const sig =
      target.kind === "tower"
        ? `${ring ? "r" : "p"}:${key}:${target.level}:${Math.ceil(target.hp)}:${target.upgCost}:${target.canUpgrade}:${target.refund}:${target.canModify}:${target.extraStats}:${target.focusSet}:${placing}`
        : `${ring ? "r" : "p"}:${key}:${target.integrityPct}`;

    if (this.element && sig === this.lastSignature) {
      this.target = target;
      return;
    }

    const sameTarget = this.lastKey === key && this.element !== null;
    this.clearDom();
    if (!sameTarget) this.side = "right";
    this.target = target;
    this.lastKey = key;
    this.lastSignature = sig;
    this.placing = placing;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = ring ? towerRingHtml(target, placing) : towerPanelHtml(target, placing);
    const el = (this.element = wrapper.firstElementChild as HTMLElement);

    if (!ring) {
      const towerCanvas = el.querySelector<HTMLCanvasElement>("[data-vbp-tower]");
      if (towerCanvas && target.kind === "tower") {
        this.host.paintTowerIcon(towerCanvas, target.tower.type);
      }
      const bldgCanvas = el.querySelector<HTMLCanvasElement>("[data-vbp-bldg]");
      if (bldgCanvas && target.kind === "building") {
        paintBuildingPortrait(bldgCanvas, target.building.isSkyscraper);
      }
      if (!sameTarget && !this.host.reduceMotion()) {
        el.classList.add("opening");
      }
    }

    this.host.board().append(el);
    el.onpointerdown = (e) => e.stopPropagation();
    el.onclick = (e) => this.handleClick(e);
    this.position();
  }

  private handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn || btn.disabled || !this.target) return;
    const hook = btn.dataset.vbp;
    if (hook === "close") {
      this.dismiss(true);
      return;
    }
    if (this.target.kind !== "tower") return;
    const uid = this.target.tower.uid;
    if (hook === "upgrade") this.host.upgrade(uid);
    else if (hook === "rotate") this.host.rotate(uid);
    else if (hook === "sell") this.host.sell(uid);
    else if (hook === "focus") {
      const next = !this.placing;
      this.setPlacing(next);
      this.host.focus(uid, next);
    }
  }

  setPlacing(placing: boolean): void {
    this.placing = placing;
    if (!this.element) return;
    this.element.classList.toggle("placing", placing);
    const btn = this.element.querySelector<HTMLButtonElement>('[data-vbp="focus"]');
    if (btn) {
      const active = placing || (this.target?.kind === "tower" && this.target.focusSet);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  escape(): void {
    if (this.placing && this.target?.kind === "tower") {
      this.setPlacing(false);
      this.host.focus(this.target.tower.uid, false);
    } else {
      this.dismiss(true);
    }
  }

  private clearDom(): void {
    this.element?.remove();
    this.element = null;
  }

  dismiss(notify = true): void {
    this.clearDom();
    this.target = null;
    this.lastKey = null;
    this.lastSignature = "";
    this.placing = false;
    if (notify) this.host.closed();
  }

  position(): void {
    const el = this.element;
    const target = this.target;
    if (!el || !target) return;
    const r = targetRect(target);
    const renderer = this.host.renderer();
    const board = this.host.board().getBoundingClientRect();
    const a = renderer.toClient(r.x, r.y);
    const z = renderer.toClient(r.x + r.w, r.y + r.h);

    if (this.host.ringMenu()) {
      const headroom = target.kind === "tower" && target.upgCost > 0 ? MENU_COST_ROOM : 0;
      const box = buildingMenuBox(
        { x: a.x - board.left, y: a.y - board.top, w: z.x - a.x, h: z.y - a.y },
        { w: board.width, h: board.height },
        headroom,
        target.kind === "building",
      );
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = el.style.height = `${box.size}px`;
      el.style.setProperty("--vbm-bar", `${box.bar}px`);
    } else {
      const side = panelSide(
        a.x - board.left,
        z.x - board.left,
        board.width,
        el.offsetWidth || PANEL_SIZE.desktop,
        this.side,
      );
      if (side !== this.side || el.dataset.side !== side) {
        this.side = side;
        el.dataset.side = side;
      }
    }
  }
}
