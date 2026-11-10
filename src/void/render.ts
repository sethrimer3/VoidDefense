/** High-performance metropolitan renderer for Void Defense.
 *
 * Key architecture:
 * - Dirty-chunk offscreen canvas caching (`CHUNK_SIZE = 16` cells, rendered at
 *   one raster pixel per simulation cell) so static streets, stepped skyscraper rooftops,
 *   multi-cell directional shadows, rooftop features (helipads, spires, solar arrays,
 *   reactor domes, sky gardens), and deep cosmic nebula interiors are only repainted
 *   in chunks touched by Void erosion, debris, or construction.
 * - Multi-scale LOD & Visual Recovery Pass (V1–V3):
 *   - Overview zoom shows distinct district palettes, stepped 3D skyscraper setbacks,
 *     arterial avenues with crosswalks and moving civilian/emergency traffic, deep
 *     nebula Void fields, sizzling magenta/orange frontier rims, concentric prismatic
 *     event-horizon portals, and curved inward debris streams.
 *   - Close zoom reveals 1-pixel riflemen with muzzle flashes, 1x2 exosuit
 *     engineers with welding arcs and carried matter bricks, turret barrels, and
 *     individual fracturing pixels.
 * - Reuses camera math from `src/defend/render.ts` and `Loupe` from `src/defend/loupe.ts`. */

import { Loupe } from "../defend/loupe.ts";
import { CHUNK_SIZE, pixels } from "./config.ts";
import { hash, hash01 } from "./grid.ts";
import {
  CellMaterial,
  type MetroBuilding,
  type PlacedTower,
  type StrikeId,
  type TowerTypeId,
} from "./model.ts";
import type { VoidSim } from "./sim.ts";
import { STRIKE_SPECS, TOWER_SPECS } from "./towers.ts";
import type { VoidWorld } from "./world.ts";


export type DragPreview =
  | { kind: "tower"; type: TowerTypeId; x: number; y: number; valid: boolean }
  | { kind: "strike"; strike: StrikeId; x: number; y: number; valid: boolean }
  | { kind: "reticle"; towerUid: number; x: number; y: number }
  | { kind: "blueprint"; points: { x: number; y: number }[] };

type ArchPalette = {
  podium: string;
  mid: string;
  crown: string;
  litEdge: string;
  shadeEdge: string;
  windowWarm: string;
  windowAlt: string;
};

const ARCH_PALETTES: Record<MetroBuilding["archStyle"], readonly ArchPalette[]> = {
  glassTower: [
    {
      podium: "#1f344d",
      mid: "#2b4a6b",
      crown: "#3b6691",
      litEdge: "#639bcf",
      shadeEdge: "#0f1b29",
      windowWarm: "#ffbe55",
      windowAlt: "#7ce8ff",
    },
    {
      podium: "#1b3948",
      mid: "#265166",
      crown: "#356e8a",
      litEdge: "#5db0d4",
      shadeEdge: "#0d1f29",
      windowWarm: "#ffaa3b",
      windowAlt: "#8cf4ff",
    },
  ],
  artDecoSetback: [
    {
      podium: "#3b3028",
      mid: "#524236",
      crown: "#6e5846",
      litEdge: "#9c7e63",
      shadeEdge: "#1c1612",
      windowWarm: "#ffb84d",
      windowAlt: "#ffe299",
    },
    {
      podium: "#42322b",
      mid: "#5c453a",
      crown: "#785a4b",
      litEdge: "#a8826c",
      shadeEdge: "#211714",
      windowWarm: "#ff9c33",
      windowAlt: "#ffd480",
    },
  ],
  cyberArcology: [
    {
      podium: "#252b3d",
      mid: "#343d57",
      crown: "#465375",
      litEdge: "#6e82b5",
      shadeEdge: "#121521",
      windowWarm: "#ff852b",
      windowAlt: "#5ce1e6",
    },
    {
      podium: "#2c283d",
      mid: "#3e3857",
      crown: "#544c75",
      litEdge: "#8277b0",
      shadeEdge: "#151221",
      windowWarm: "#ff9e3b",
      windowAlt: "#6ef3ff",
    },
  ],
  foundryComplex: [
    {
      podium: "#382520",
      mid: "#4f342c",
      crown: "#69453a",
      litEdge: "#946252",
      shadeEdge: "#1c110e",
      windowWarm: "#ff6b1a",
      windowAlt: "#ffbe3b",
    },
    {
      podium: "#332824",
      mid: "#4a3933",
      crown: "#634c44",
      litEdge: "#8c6d61",
      shadeEdge: "#191311",
      windowWarm: "#ff7b24",
      windowAlt: "#ffd166",
    },
  ],
  solarTerrace: [
    {
      podium: "#2d3644",
      mid: "#3e4b5e",
      crown: "#52637a",
      litEdge: "#7990b0",
      shadeEdge: "#161b24",
      windowWarm: "#ffad42",
      windowAlt: "#ffe08c",
    },
    {
      podium: "#333942",
      mid: "#47505c",
      crown: "#5c6878",
      litEdge: "#8595ab",
      shadeEdge: "#191c22",
      windowWarm: "#ff9933",
      windowAlt: "#ffd685",
    },
  ],
  civicDome: [
    {
      podium: "#324252",
      mid: "#465c73",
      crown: "#5c7894",
      litEdge: "#8ab0d4",
      shadeEdge: "#172029",
      windowWarm: "#ffd166",
      windowAlt: "#80f5ff",
    },
  ],
};

export class VoidRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrainLayer: HTMLCanvasElement;
  private readonly sceneLayer: HTMLCanvasElement;
  private readonly sceneCtx: CanvasRenderingContext2D;
  private readonly tctx: CanvasRenderingContext2D;
  private renderedWorld: VoidWorld | null = null;
  readonly loupe = new Loupe();
  /** When true, suppresses dynamic shimmer/lensing overlays for reduced-motion accessibility & comparison. */
  reduceEffects = false;

  /** Camera state: `s` = zoom multiplier (1 = fit board), `x, y` = canvas pixel pan. */
  readonly cam = { s: 1, x: 0, y: 0 };
  px = 4; // device pixels per cell at zoom 1
  static readonly MAX_ZOOM = 7;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sceneLayer = document.createElement("canvas");
    this.sceneCtx = this.sceneLayer.getContext("2d", { alpha: false })!;
    this.terrainLayer = document.createElement("canvas");
    this.tctx = this.terrainLayer.getContext("2d", { alpha: false })!;
  }

  resize(worldW: number, worldH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round((this.canvas.clientWidth || 800) * dpr));
    const ch = Math.max(1, Math.round((this.canvas.clientHeight || 600) * dpr));
    const fit = Math.min(cw / worldW, ch / worldH);
    if (
      this.canvas.width !== cw ||
      this.canvas.height !== ch ||
      Math.abs(this.px - fit) > 0.01
    ) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.px = fit;
      this.clampCam(worldW, worldH);
    }
  }

  toCell(clientX: number, clientY: number): { fx: number; fy: number; cx: number; cy: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * this.canvas.width;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * this.canvas.height;
    const fx = (x - this.cam.x) / (this.cam.s * this.px);
    const fy = (y - this.cam.y) / (this.cam.s * this.px);
    return { fx, fy, cx: Math.floor(fx), cy: Math.floor(fy) };
  }

  toClient(fx: number, fy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = fx * this.px * this.cam.s + this.cam.x;
    const y = fy * this.px * this.cam.s + this.cam.y;
    return {
      x: r.left + (x / Math.max(1, this.canvas.width)) * r.width,
      y: r.top + (y / Math.max(1, this.canvas.height)) * r.height,
    };
  }

  panBy(dxClient: number, dyClient: number, worldW: number, worldH: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.cam.x += (dxClient / Math.max(1, r.width)) * this.canvas.width;
    this.cam.y += (dyClient / Math.max(1, r.height)) * this.canvas.height;
    this.clampCam(worldW, worldH);
  }

  zoomAt(clientX: number, clientY: number, factor: number, worldW: number, worldH: number): void {
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / Math.max(1, r.width)) * this.canvas.width;
    const py = ((clientY - r.top) / Math.max(1, r.height)) * this.canvas.height;
    const nextS = Math.max(0.85, Math.min(VoidRenderer.MAX_ZOOM, this.cam.s * factor));
    const k = nextS / this.cam.s;
    this.cam.x = px - (px - this.cam.x) * k;
    this.cam.y = py - (py - this.cam.y) * k;
    this.cam.s = nextS;
    this.clampCam(worldW, worldH);
  }

  resetCam(worldW: number, worldH: number): void {
    this.cam.s = 1;
    this.cam.x = 0;
    this.cam.y = 0;
    this.clampCam(worldW, worldH);
  }

  private clampCam(worldW: number, worldH: number): void {
    const bw = worldW * this.px * this.cam.s;
    const bh = worldH * this.px * this.cam.s;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.cam.x = bw <= cw ? (cw - bw) * 0.5 : Math.min(60, Math.max(cw - bw - 60, this.cam.x));
    this.cam.y = bh <= ch ? (ch - bh) * 0.5 : Math.min(60, Math.max(ch - bh - 60, this.cam.y));
  }

  /** Repaints only dirtied 16x16 cell chunks into `this.terrainLayer`. */
  private syncDirtyChunks(world: VoidWorld): void {
    const { w, h, chunksW, chunksH, dirtyChunks } = world.grid;
    const targetW = w;
    const targetH = h;

    if (
      this.renderedWorld !== world ||
      this.terrainLayer.width !== targetW ||
      this.terrainLayer.height !== targetH
    ) {
      this.renderedWorld = world;
      this.terrainLayer.width = targetW;
      this.terrainLayer.height = targetH;
      world.grid.markAllDirty();
    }

    if (!world.grid.hasDirtyChunks()) return;

    const c = this.tctx;
    c.imageSmoothingEnabled = false;

    for (let cy = 0; cy < chunksH; cy++) {
      for (let cx = 0; cx < chunksW; cx++) {
        const chunkIdx = cy * chunksW + cx;
        if (!dirtyChunks[chunkIdx]) continue;
        this.paintChunk(c, world, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      }
    }

    world.grid.clearDirtyFlags();
  }

  /** Computes directional shadow darkness (0..0.68) cast onto `(x, y)` by taller NW buildings. */
  private computeShadowAt(world: VoidWorld, x: number, y: number, selfHeight: number): number {
    const { w } = world.grid;
    let maxShade = 0;
    for (let step = 1; step <= 4; step++) {
      // Diagonal NW sun angle (primary) + N/W ambient occlusion
      const nx = x - step;
      const ny = y - step;
      if (nx >= 0 && ny >= 0) {
        const bId = world.buildingAt[ny * w + nx];
        if (bId >= 0) {
          const b = world.buildings[bId];
          if (b && b.height > selfHeight + step * 3) {
            const reach = Math.min(4, Math.ceil((b.height - selfHeight) / 6));
            if (step <= reach) {
              maxShade = Math.max(maxShade, 0.62 - (step - 1) * 0.12);
            }
          }
        }
      }
      if (step === 1) {
        if (x > 0) {
          const wbId = world.buildingAt[y * w + (x - 1)];
          if (wbId >= 0 && (world.buildings[wbId]?.height ?? 0) > selfHeight + 2) {
            maxShade = Math.max(maxShade, 0.42);
          }
        }
        if (y > 0) {
          const nbId = world.buildingAt[(y - 1) * w + x];
          if (nbId >= 0 && (world.buildings[nbId]?.height ?? 0) > selfHeight + 2) {
            maxShade = Math.max(maxShade, 0.38);
          }
        }
      }
    }
    return maxShade;
  }

  /** Terrain is colored one cell at a time: no sub-cell windows or art tiles. */
  private paintChunk(c: CanvasRenderingContext2D, world: VoidWorld, x0: number, y0: number): void {
    const { w, h } = world.grid;
    for (let y = y0; y < Math.min(h, y0 + CHUNK_SIZE); y++) {
      for (let x = x0; x < Math.min(w, x0 + CHUNK_SIZE); x++) {
        const idx = world.grid.index(x, y);
        const mat = world.material[idx];
        const roll = hash01(world.seed, 995, x, y);
        const bId = world.buildingAt[idx];
        const b = bId >= 0 ? world.buildings[bId] : undefined;
        let color: string;
        if (mat === CellMaterial.VOID) {
          const wave = Math.sin(x * 0.07 + Math.sin(y * 0.055)) * Math.cos(y * 0.07 - x * 0.04);
          color = wave > 0.5 ? "#57166e" : wave > 0 ? "#2b1055" : "#0b051d";
          if (roll > 0.997) color = "#bba5ff";
        } else if (mat === CellMaterial.UNCLAIMED) {
          color = roll > 0.5 ? "#102135" : "#12283e";
        } else if (mat === CellMaterial.PARK) {
          color = roll > 0.55 ? "#315b48" : "#234434";
        } else if (mat === CellMaterial.RECLAIMED) {
          color = roll > 0.6 ? "#897651" : "#665740";
        } else if (mat === CellMaterial.WALL || mat === CellMaterial.BARRIER) {
          color = mat === CellMaterial.BARRIER ? "#48c9dc" : (x + y) % 3 === 0 ? "#b2bdc8" : "#6e7d8e";
        } else if (mat === CellMaterial.SALVAGE) {
          color = roll > 0.7 ? "#b17b46" : "#453b43";
        } else if (b) {
          const palettes = ARCH_PALETTES[b.archStyle];
          const pal = palettes[b.variant % palettes.length];
          const inset = Math.min(x - b.x, y - b.y, b.x + b.w - 1 - x, b.y + b.h - 1 - y);
          color = inset >= pixels(2) ? pal.crown : inset >= pixels(1) ? pal.mid : pal.podium;
          const north = y === 0 || world.buildingAt[idx - w] !== bId;
          const west = x === 0 || world.buildingAt[idx - 1] !== bId;
          const south = y + 1 === h || world.buildingAt[idx + w] !== bId;
          const east = x + 1 === w || world.buildingAt[idx + 1] !== bId;
          if (north || west) color = pal.litEdge;
          else if (south || east) color = pal.shadeEdge;
          // Window ribbons and roof equipment occupy whole simulation pixels.
          else if (inset < pixels(1) && (x + y + b.variant) % 3 === 0) color = pal.windowWarm;
          else if (inset >= pixels(1)) {
            const dx = x - Math.floor(b.x + b.w / 2);
            const dy = y - Math.floor(b.y + b.h / 2);
            if (b.roofFeature === "helipad" && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              color = dx !== 0 || dy === 0 ? "#ffbe3b" : "#19202b";
            } else if (b.roofFeature === "skyGarden" && (x + y) % 3 !== 0) color = "#48a878";
            else if (b.roofFeature === "solarArray" && y % 3 === 0) color = "#5ba4e6";
            else if (dx === 0 && dy === 0) color = pal.windowAlt;
          }
          if (world.hp[idx] < world.maxHp[idx] * 0.4) color = roll < 0.4 ? "#ff42b8" : "#12091c";
          else if (world.hp[idx] < world.maxHp[idx] * 0.75 && roll < 0.3) color = "#ff8c29";
        } else {
          color = world.streetTier[idx] === 4 ? "#293340" : "#192330";
          if (world.streetTier[idx] !== 4 && (x + y) % 10 === 0) color = "#a69a73";
        }
        c.fillStyle = color;
        c.fillRect(x, y, 1, 1);
        if (mat !== CellMaterial.VOID && mat !== CellMaterial.UNCLAIMED) {
          const shade = this.computeShadowAt(world, x, y, b?.height ?? 0);
          if (shade > 0) {
            c.fillStyle = `rgba(5, 8, 16, ${shade * 0.75})`;
            c.fillRect(x, y, 1, 1);
          }
        }
      }
    }
  }

  /** Renders the complete metropolitan board, active Void frontier, portals,
   * ambient traffic, towers, 1-pixel soldiers, 1x2 engineers, projectiles, and overlays. */
  draw(
    sim: VoidSim,
    nowMs: number,
    selectedTowerUid: number | null,
    preview: DragPreview | null,
    pointerForLoupe: { clientX: number; clientY: number; cellX: number; cellY: number } | null,
    showMagnifier: boolean,
  ): void {
    const { world, voidField, combat, physics } = sim;
    this.resize(world.grid.w, world.grid.h);
    this.syncDirtyChunks(world);

    if (this.sceneLayer.width !== world.grid.w || this.sceneLayer.height !== world.grid.h) {
      this.sceneLayer.width = world.grid.w;
      this.sceneLayer.height = world.grid.h;
    }
    const c = this.sceneCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;

    // 1. Draw cached metropolitan terrain layer
    c.drawImage(this.terrainLayer, 0, 0, world.grid.w, world.grid.h);

    const animTime = this.reduceEffects ? 0 : nowMs * 0.001;
    const pulse = this.reduceEffects ? 0.75 : 0.65 + 0.35 * Math.sin(animTime * 5.2);

    // 2. Ambient metropolitan street traffic & evacuating vehicles along intact avenues (V3)
    const { w, h } = world.grid;
    const trafficCount = Math.min(64, Math.floor((w * h) / 900));
    for (let i = 0; i < trafficCount; i++) {
      const horiz = (i & 1) === 0;
      const laneSeed = hash(world.seed, 710, i);
      const speed = 4.5 + (laneSeed % 5) * 1.1;
      const pos = ((laneSeed % 200) + animTime * speed * (i % 3 === 0 ? -1 : 1) + 4000) % (horiz ? w : h);
      const fixedCoord = 4 + (laneSeed % Math.max(1, (horiz ? h : w) - 8));
      const tx = horiz ? Math.floor(pos) : fixedCoord;
      const ty = horiz ? fixedCoord : Math.floor(pos);
      if (!world.grid.inBounds(tx, ty)) continue;
      const tIdx = ty * w + tx;
      if (world.material[tIdx] !== CellMaterial.STREET || world.streetTier[tIdx] === 4) continue;

      // 1x2 emergency / civilian shuttle with warm headlights
      const isEmergency = i % 4 === 0;
      c.fillStyle = isEmergency ? "#ff5436" : "#ffd166";
      c.fillRect(tx + 0.15, ty + 0.15, horiz ? 0.9 : 0.55, horiz ? 0.55 : 0.9);
      c.fillStyle = isEmergency && ((Math.floor(animTime * 8) + i) & 1) === 0 ? "#48e5ff" : "#ffffff";
      c.fillRect(tx + 0.3, ty + 0.3, 0.35, 0.35);
    }

    // 3. Sizzling multi-hue Void frontier rim (magenta/violet event boundary + orange/cyan matter sparks)
    for (let i = 0; i < voidField.frontierCells.length; i++) {
      const cIdx = voidField.frontierCells[i];
      const fx = world.grid.xOf(cIdx);
      const fy = world.grid.yOf(cIdx);
      const micro = voidField.cellMicroWork[cIdx];
      const intensity = Math.min(1, 0.35 + micro / 450);

      // Outer corrosion glow on the threatened cell
      c.fillStyle = `rgba(215, 56, 255, ${0.32 * intensity * pulse})`;
      c.fillRect(fx - 0.1, fy - 0.1, 1.2, 1.2);

      // Sharp spectral edge lines on sides directly touching Void
      c.fillStyle = (fx + fy) % 2 === 0 ? "#ff38b8" : "#c84bff";
      if (fx > 0 && world.material[cIdx - 1] === CellMaterial.VOID) {
        c.fillRect(fx - 0.15, fy, 0.35, 1);
      }
      if (fx + 1 < w && world.material[cIdx + 1] === CellMaterial.VOID) {
        c.fillRect(fx + 0.8, fy, 0.35, 1);
      }
      if (fy > 0 && world.material[cIdx - w] === CellMaterial.VOID) {
        c.fillRect(fx, fy - 0.15, 1, 0.35);
      }
      if (fy + 1 < h && world.material[cIdx + w] === CellMaterial.VOID) {
        c.fillRect(fx, fy + 0.8, 1, 0.35);
      }

      // Matter-annihilation spark glints (warm orange & cyan)
      if (((fx * 7 + fy * 13 + Math.floor(animTime * 12)) & 3) === 0) {
        c.fillStyle = ((fx + fy) & 1) === 0 ? "#ff9e38" : "#48e5ff";
        c.fillRect(fx + 0.25, fy + 0.25, 0.5, 0.5);
      }
    }

    // 4. Spectacular Event-Horizon Source Portals (V2 cinematic reference pass)
    for (const p of world.portals) {
      if (p.active) {
        const coreR = Math.max(3.6, p.radius * 0.42);
        // Outer chromatic halo
        if (!this.reduceEffects) {
          c.strokeStyle = "rgba(157, 78, 221, 0.28)";
          c.lineWidth = 1.6;
          c.beginPath();
          c.arc(p.x, p.y, coreR + 2.4, 0, Math.PI * 2);
          c.stroke();
        }

        // Deep abyssal black singularity interior
        c.fillStyle = "#020006";
        c.beginPath();
        c.arc(p.x, p.y, coreR, 0, Math.PI * 2);
        c.fill();

        // Sweeping golden-orange & cyan accretion arcs (tilted ellipses)
        c.save();
        c.translate(p.x, p.y);
        c.rotate(animTime * 0.85 + p.id);
        c.strokeStyle = "#ff8c29";
        c.lineWidth = 0.55;
        c.beginPath();
        c.ellipse(0, 0, coreR + 1.5, coreR * 0.78, 0, 0, Math.PI * 1.35);
        c.stroke();

        c.rotate(-animTime * 1.45);
        c.strokeStyle = "#48e5ff";
        c.lineWidth = 0.45;
        c.beginPath();
        c.ellipse(0, 0, coreR + 0.9, coreR * 0.88, 0.5, Math.PI * 0.4, Math.PI * 1.75);
        c.stroke();
        c.restore();

        // Crisp blazing magenta & white inner event-horizon ring
        c.strokeStyle = "#ff38b8";
        c.lineWidth = 0.65;
        c.beginPath();
        c.arc(p.x, p.y, coreR + 0.15 * pulse, 0, Math.PI * 2);
        c.stroke();

        c.strokeStyle = "#ffd6ff";
        c.lineWidth = 0.28;
        c.beginPath();
        c.arc(p.x, p.y, coreR - 0.15, 0, Math.PI * 2);
        c.stroke();

        // Lensed radial star streaks around the event horizon
        for (let s = 0; s < 10; s++) {
          const ang = (s / 10) * Math.PI * 2 + animTime * (s % 2 === 0 ? 0.6 : -0.45);
          const r0 = coreR + 0.4 + ((s * 1.7 + animTime * 3) % 3.2);
          const r1 = r0 + 1.4;
          c.strokeStyle = s % 3 === 0 ? "#ff9e38" : s % 3 === 1 ? "#7afcff" : "#ff5ce1";
          c.lineWidth = 0.32;
          c.beginPath();
          c.moveTo(p.x + Math.cos(ang) * r0, p.y + Math.sin(ang) * r0);
          c.lineTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1);
          c.stroke();
        }
      } else {
        // Telegraphed warning ring for delayed secondary portal
        c.strokeStyle = `rgba(255, 120, 45, ${0.45 + 0.4 * pulse})`;
        c.lineWidth = 0.5;
        c.setLineDash([1.5, 1.5]);
        c.beginPath();
        c.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }

    // 5. Draw crystalline Void Nodes (Phase 6+ infantry targets)
    for (const node of voidField.nodes) {
      c.fillStyle = "#59127a";
      c.fillRect(node.x - 1.2, node.y - 1.2, 2.4, 2.4);
      c.fillStyle = "#e056fd";
      c.fillRect(node.x - 0.85, node.y - 0.85, 1.7, 1.7);
      c.fillStyle = "#7afcff";
      c.fillRect(node.x - 0.4, node.y - 0.4, 0.8, 0.8);
    }

    // 6. Draw user-drawn wall blueprints
    for (const bp of combat.blueprints) {
      c.fillStyle = "rgba(255, 168, 52, 0.42)";
      for (const cIdx of bp.cells) {
        if (world.material[cIdx] !== CellMaterial.WALL) {
          c.fillRect(world.grid.xOf(cIdx), world.grid.yOf(cIdx), 1, 1);
        }
      }
    }

    // 7. Draw Shield Projector arcs & Gravity Anchor fields
    for (const t of combat.towers) {
      const cx = t.x + t.w * 0.5;
      const cy = t.y + t.h * 0.5;
      if (t.type === "shieldProjector") {
        const pool = combat.shieldPools.get(t.uid) ?? 0;
        if (pool > 5) {
          const r = TOWER_SPECS.shieldProjector.range + sim.tech.shieldExtraRadius;
          c.strokeStyle = `rgba(72, 229, 255, ${Math.min(0.75, pool / 160)})`;
          c.lineWidth = 0.55;
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (t.type === "gravityAnchor") {
        c.strokeStyle = "rgba(116, 148, 255, 0.38)";
        c.lineWidth = 0.42;
        c.beginPath();
        c.arc(cx, cy, TOWER_SPECS.gravityAnchor.range, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // 8. Draw placed Resistance towers with crisp multi-part pixel silhouettes
    for (const t of combat.towers) {
      const spec = TOWER_SPECS[t.type];
      // Armored shadow & base plate
      c.fillStyle = "#0d1118";
      c.fillRect(t.x - 0.15, t.y - 0.15, t.w + 0.3, t.h + 0.3);
      c.fillStyle = "#242c3a";
      c.fillRect(t.x, t.y, t.w, t.h);
      // Corner rivets / mounting brackets
      c.fillStyle = "#5c6b82";
      c.fillRect(t.x, t.y, 0.6, 0.6);
      c.fillRect(t.x + t.w - 0.6, t.y, 0.6, 0.6);
      c.fillRect(t.x, t.y + t.h - 0.6, 0.6, 0.6);
      c.fillRect(t.x + t.w - 0.6, t.y + t.h - 0.6, 0.6, 0.6);
      // Primary colored turret housing
      c.fillStyle = spec.color;
      c.fillRect(t.x + 0.35, t.y + 0.35, t.w - 0.7, t.h - 0.7);
      // Glowing energy core / barrel mount
      c.fillStyle = "#fff3d1";
      c.fillRect(t.x + t.w * 0.5 - 0.45, t.y + t.h * 0.5 - 0.45, 0.9, 0.9);

      if (t.uid === selectedTowerUid) {
        c.strokeStyle = "#ffbe3b";
        c.lineWidth = 0.4;
        c.strokeRect(t.x - 0.35, t.y - 0.35, t.w + 0.7, t.h + 0.7);
        c.strokeStyle = "rgba(255, 190, 59, 0.42)";
        c.lineWidth = 0.35;
        c.beginPath();
        c.arc(t.x + t.w * 0.5, t.y + t.h * 0.5, spec.range, 0, Math.PI * 2);
        c.stroke();
      }

      if (t.focus) {
        c.strokeStyle = "rgba(255, 145, 45, 0.65)";
        c.lineWidth = 0.28;
        c.beginPath();
        c.moveTo(t.x + t.w * 0.5, t.y + t.h * 0.5);
        c.lineTo(t.focus.x, t.focus.y);
        c.stroke();
        c.strokeRect(t.focus.x - 1.1, t.focus.y - 1.1, 2.2, 2.2);
      }
    }

    // 9. Draw autonomous agents: 1x1 riflemen, 1x2 engineers, 2x2 heavy mechs, wall serpents (V3)
    for (const a of combat.agents) {
      const ax = Math.floor(a.x), ay = Math.floor(a.y);
      if (a.kind === "rifleman") {
        c.fillStyle = "#ff7b24";
        c.fillRect(ax, ay, 1, 1);
      } else if (a.kind === "engineer") {
        c.fillStyle = a.carryingMatter > 0 ? "#48e5ff" : "#ffd15c";
        c.fillRect(ax, ay - 1, 1, 1);
        c.fillStyle = "#d9822b";
        c.fillRect(ax, ay, 1, 1);
      } else if (a.kind === "heavyMech") {
        c.fillStyle = "#ff9e30";
        c.fillRect(ax - 1, ay - 1, 2, 2);
        c.fillStyle = "#7afcff";
        c.fillRect(ax, ay - 1, 1, 1);
      } else if (a.kind === "wallSerpent") {
        c.fillStyle = "#0c1420";
        c.fillRect(a.x - 1.1, a.y - 1.1, 2.2, 2.2);
        c.fillStyle = "#48e5ff";
        c.fillRect(a.x - 0.9, a.y - 0.9, 1.8, 1.8);
        c.fillStyle = "#ffd166";
        c.fillRect(a.x - 0.4, a.y - 0.4, 0.8, 0.8);
      }
    }

    // 10. Draw cosmic Void organisms
    for (const o of combat.organisms) {
      if (o.trail) {
        c.fillStyle = "rgba(195, 92, 255, 0.55)";
        for (const pt of o.trail) {
          c.fillRect(pt.x - 0.65, pt.y - 0.65, 1.3, 1.3);
        }
      }
      if (o.kind === "nebulaWorm") {
        c.fillStyle = "#e066ff";
        c.fillRect(o.x - 1.2, o.y - 1.2, 2.4, 2.4);
        c.fillStyle = "#ffffff";
        c.fillRect(o.x - 0.5, o.y - 0.5, 1.0, 1.0);
      } else if (o.kind === "constellationSpider") {
        c.strokeStyle = "#7afcff";
        c.lineWidth = 0.28;
        for (let leg = 0; leg < 6; leg++) {
          const ang = (leg / 6) * Math.PI * 2 + animTime * 2.5;
          c.beginPath();
          c.moveTo(o.x, o.y);
          c.lineTo(o.x + Math.cos(ang) * 2.4, o.y + Math.sin(ang) * 2.4);
          c.stroke();
        }
        c.fillStyle = "#c88aff";
        c.fillRect(o.x - 0.8, o.y - 0.8, 1.6, 1.6);
      } else if (o.kind === "voidBloom") {
        c.fillStyle = "#ff66c4";
        c.fillRect(o.x - 1.3, o.y - 1.3, 2.6, 2.6);
        c.fillStyle = "#6ef3ff";
        c.fillRect(o.x - 0.5, o.y - 0.5, 1.0, 1.0);
      } else if (o.kind === "nebulaQueen") {
        c.fillStyle = "#9d4edd";
        c.fillRect(o.x - 1.8, o.y - 1.8, 3.6, 3.6);
        c.fillStyle = "#7afcff";
        c.fillRect(o.x - 0.9, o.y - 0.9, 1.8, 1.8);
      } else if (o.kind === "honeycombCrystal") {
        c.fillStyle = "#c77dff";
        c.fillRect(o.x - 1.3, o.y - 1.3, 2.6, 2.6);
        c.fillStyle = "#ff9ebb";
        c.fillRect(o.x - 0.6, o.y - 0.6, 1.2, 1.2);
      } else if (o.kind === "nexusCrystal") {
        c.strokeStyle = "#48cae4";
        c.lineWidth = 0.4;
        c.strokeRect(o.x - 1.7, o.y - 1.7, 3.4, 3.4);
        c.fillStyle = "#7209b7";
        c.fillRect(o.x - 1.2, o.y - 1.2, 2.4, 2.4);
        c.fillStyle = "#90e0ef";
        c.fillRect(o.x - 0.5, o.y - 0.5, 1.0, 1.0);
      } else {
        // 1-pixel Void bee
        c.fillStyle = "#e0aaff";
        c.fillRect(o.x - 0.4, o.y - 0.4, 0.8, 0.8);
      }
    }

    // 11. Draw Matter Cannon & Rocket Team parabolic shells with glowing pixel trails
    for (const p of combat.pellets) {
      const arcLift = Math.sin(p.progress * Math.PI) * 3.8;
      const px = p.x + (p.tx - p.x) * p.progress;
      const py = p.y + (p.ty - p.y) * p.progress - arcLift;

      // Parabolic trail ribbon
      for (let step = 1; step <= 5; step++) {
        const tp = Math.max(0, p.progress - step * 0.045);
        const tLift = Math.sin(tp * Math.PI) * 3.8;
        const tx = p.x + (p.tx - p.x) * tp;
        const ty = p.y + (p.ty - p.y) * tp - tLift;
        c.fillStyle = p.wallPayload ? "rgba(72, 229, 255, 0.45)" : "rgba(255, 158, 56, 0.48)";
        const sz = Math.max(0.4, 1.2 - step * 0.16);
        c.fillRect(tx - sz * 0.5, ty - sz * 0.5, sz, sz);
      }

      // Target impact ring preview on ground
      c.strokeStyle = p.wallPayload ? "rgba(72, 229, 255, 0.32)" : "rgba(255, 174, 66, 0.32)";
      c.lineWidth = 0.25;
      c.beginPath();
      c.arc(p.tx, p.ty, p.radius, 0, Math.PI * 2);
      c.stroke();

      // Shell head
      c.fillStyle = p.wallPayload ? "#48e5ff" : "#ff9e38";
      c.fillRect(px - 0.85, py - 0.85, 1.7, 1.7);
      c.fillStyle = "#ffffff";
      c.fillRect(px - 0.4, py - 0.4, 0.8, 0.8);
    }

    // 12. Draw expanding impact & strike shockwaves
    for (const s of physics.shockwaves) {
      const t = s.life / Math.max(0.01, s.maxLife);
      const r = Math.max(0.5, s.maxRadius * t);
      c.strokeStyle = s.color;
      c.lineWidth = Math.max(0.25, (1 - t) * 0.9);
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.stroke();

      if (r > 1.2) {
        c.strokeStyle = s.secondaryColor;
        c.lineWidth = Math.max(0.2, (1 - t) * 0.5);
        c.beginPath();
        c.arc(s.x, s.y, r * 0.72, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // 13. Draw riflemen & mech laser beams with muzzle & impact flashes
    for (const b of combat.lasers) {
      c.strokeStyle = b.color;
      c.lineWidth = 0.55;
      c.beginPath();
      c.moveTo(b.x0, b.y0);
      c.lineTo(b.x1, b.y1);
      c.stroke();

      c.strokeStyle = "#fff3b0";
      c.lineWidth = 0.22;
      c.beginPath();
      c.moveTo(b.x0, b.y0);
      c.lineTo(b.x1, b.y1);
      c.stroke();

      // Impact spark at target
      c.fillStyle = "#ffbe3b";
      c.fillRect(b.x1 - 0.55, b.y1 - 0.55, 1.1, 1.1);
      c.fillStyle = "#ffffff";
      c.fillRect(b.x1 - 0.25, b.y1 - 0.25, 0.5, 0.5);
    }

    // 14. Draw curved prismatic & ember inward debris streams (V3 cinematic pass)
    for (const d of physics.debris) {
      if (!this.reduceEffects) {
        c.strokeStyle = d.glowColor;
        c.lineWidth = d.size * 0.95;
        c.beginPath();
        c.moveTo(d.px, d.py);
        c.lineTo(d.x, d.y);
        c.stroke();
      }
      c.fillStyle = d.color;
      c.fillRect(d.x - d.size * 0.5, d.y - d.size * 0.5, d.size, d.size);
    }

    // 15. Draw interactive drag preview (tower footprint, strike radius, reticle, or wall blueprint)
    if (preview) {
      if (preview.kind === "tower") {
        const spec = TOWER_SPECS[preview.type];
        c.fillStyle = preview.valid ? "rgba(255, 174, 56, 0.48)" : "rgba(255, 68, 68, 0.48)";
        c.fillRect(preview.x, preview.y, spec.w, spec.h);
        c.strokeStyle = preview.valid ? "#ffbe3b" : "#ff4444";
        c.lineWidth = 0.35;
        c.strokeRect(preview.x, preview.y, spec.w, spec.h);
        c.beginPath();
        c.arc(
          preview.x + spec.w * 0.5,
          preview.y + spec.h * 0.5,
          spec.range,
          0,
          Math.PI * 2,
        );
        c.stroke();
      } else if (preview.kind === "strike") {
        const spec = STRIKE_SPECS[preview.strike];
        c.fillStyle = preview.valid ? "rgba(72, 229, 255, 0.26)" : "rgba(255, 68, 68, 0.28)";
        c.strokeStyle = preview.valid ? "#48e5ff" : "#ff4444";
        c.lineWidth = 0.45;
        c.beginPath();
        c.arc(preview.x, preview.y, spec.radius, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      } else if (preview.kind === "reticle") {
        c.strokeStyle = "#ff9933";
        c.lineWidth = 0.38;
        c.strokeRect(preview.x - 1.5, preview.y - 1.5, 3, 3);
      } else if (preview.kind === "blueprint" && preview.points.length > 0) {
        c.strokeStyle = "#ffbe3b";
        c.lineWidth = 0.55;
        c.beginPath();
        c.moveTo(preview.points[0].x, preview.points[0].y);
        for (let i = 1; i < preview.points.length; i++) {
          c.lineTo(preview.points[i].x, preview.points[i].y);
        }
        c.stroke();
      }
    }

    // Camera magnifies the same world pixels; it never creates a finer art grid.
    const output = this.ctx;
    output.setTransform(1, 0, 0, 1, 0, 0);
    output.fillStyle = "#060810";
    output.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = this.cam.s * this.px;
    output.imageSmoothingEnabled = false;
    output.setTransform(scale, 0, 0, scale, this.cam.x, this.cam.y);
    output.drawImage(this.sceneLayer, 0, 0);
    output.setTransform(1, 0, 0, 1, 0, 0);

    // 16. Touch/drag magnifying glass (`Loupe`)
    if (showMagnifier && pointerForLoupe) {
      const pt = { x: pointerForLoupe.clientX, y: pointerForLoupe.clientY };
      this.loupe.show(pt, pt);
      this.loupe.draw(this.canvas);
    } else {
      this.loupe.hide();
    }
  }
}
