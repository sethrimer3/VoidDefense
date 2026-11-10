import { CORRUPTION_REACH, PIXEL_AREA, pixels } from "./config.ts";
/** Destructible terrain, structural support connectivity, detached debris
 * clusters, prismatic inward debris streams, and matter restoration/reinforcement
 * for Void Defense. */

import { dist } from "../exact.ts";
import { hash01, ORTHO } from "./grid.ts";
import { CellMaterial, type DebrisFragment, LandCover, type ShockwaveEffect } from "./model.ts";
import type { VoidWorld } from "./world.ts";

/** Prismatic spark colours for small fast fragments. */
const DEBRIS_PALETTES: readonly { color: string; glow: string }[] = [
  { color: "#ff8c29", glow: "rgba(255, 140, 41, 0.45)" },
  { color: "#ffd15c", glow: "rgba(255, 209, 92, 0.45)" },
  { color: "#ff42b8", glow: "rgba(255, 66, 184, 0.48)" },
  { color: "#45e3ff", glow: "rgba(69, 227, 255, 0.48)" },
  { color: "#b967ff", glow: "rgba(185, 103, 255, 0.45)" },
  { color: "#a4b6cc", glow: "rgba(164, 182, 204, 0.35)" },
];

/** Slab colours for torn-off terrain: a fragment keeps the colour of the land it was,
 * so grass, crops, forest canopy, pavement and lit masonry visibly stream into the anomaly. */
const SLAB_COLORS: Record<number, readonly string[]> = {
  [LandCover.GRASS]: ["#5e9a3c", "#4f8a34", "#6fae46"],
  [LandCover.MEADOW]: ["#8fb45a", "#a7c46a"],
  [LandCover.FOREST]: ["#2f6b3a", "#3c7d46"],
  [LandCover.FIELD_H]: ["#d9a63a", "#e8c050"],
  [LandCover.FIELD_V]: ["#d9a63a", "#e8c050"],
  [LandCover.ORCHARD]: ["#5e9a3c", "#3c7d46"],
  [LandCover.DIRT_ROAD]: ["#b08a5a", "#9a7549"],
  [LandCover.BRIDGE]: ["#8a6a48"],
  [LandCover.RIVER]: ["#2f78b8", "#58b0e6"],
  [LandCover.SILO]: ["#b8c0cc"],
};
const SLAB_URBAN: Record<number, readonly string[]> = {
  [CellMaterial.STREET]: ["#3a414c", "#4a525e", "#2c323b"],
  [CellMaterial.PARK]: ["#2e6b4e", "#38414f"],
  [CellMaterial.BUILDING]: ["#6e5846", "#4a5568", "#8c6d61"],
  [CellMaterial.SKYSCRAPER]: ["#3b6691", "#5c7894", "#465375"],
  [CellMaterial.RECLAIMED]: ["#7a4d30", "#485669"],
  [CellMaterial.SALVAGE]: ["#6e472b"],
  [CellMaterial.WALL]: ["#5c6d85"],
  [CellMaterial.BARRIER]: ["#48e5ff"],
  [CellMaterial.UNCLAIMED]: ["#153956"],
};

export class VoidPhysics {
  readonly debris: DebrisFragment[] = [];
  readonly shockwaves: ShockwaveEffect[] = [];
  /** Set of building IDs that lost at least one pixel this tick and need a local connectivity check. */
  private readonly damagedBuildings = new Set<number>();

  /** Converts cell `idx` into Void and queues any affected building for structural support evaluation. */
  consumeCellIntoVoid(world: VoidWorld, idx: number, spawnDebris = true): void {
    const bId = world.buildingAt[idx];
    const prevMat = world.material[idx];
    const prevCover = world.landCover[idx];
    world.material[idx] = CellMaterial.VOID;
    world.hp[idx] = 0;
    world.buildingAt[idx] = -1;
    // The corruption band tints land up to CORRUPTION_REACH pixels from the Void, so repaint that neighbourhood
    world.grid.markRadiusDirty(idx, CORRUPTION_REACH);

    if (bId >= 0) {
      this.damagedBuildings.add(bId);
    }

    if (spawnDebris && prevMat !== CellMaterial.VOID && this.debris.length < 750) {
      const x = world.grid.xOf(idx) + 0.5;
      const y = world.grid.yOf(idx) + 0.5;

      // Locate nearest active Void portal (or fall back to nearest Void neighbor)
      let portalX = x;
      let portalY = y;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const p of world.portals) {
        if (!p.active) continue;
        const d = dist(x - p.x, y - p.y);
        if (d < bestDist) {
          bestDist = d;
          portalX = p.x;
          portalY = p.y;
        }
      }

      if (!Number.isFinite(bestDist)) {
        for (const [dx, dy] of ORTHO) {
          const nx = (x | 0) + dx;
          const ny = (y | 0) + dy;
          if (world.grid.inBounds(nx, ny) && world.material[world.grid.index(nx, ny)] === CellMaterial.VOID) {
            portalX = x + dx * 4;
            portalY = y + dy * 4;
            break;
          }
        }
      }

      const dx = portalX - x;
      const dy = portalY - y;
      const d = Math.max(0.5, dist(dx, dy));
      const nx = dx / d;
      const ny = dy / d;
      // Two kinds of fragment: slow heavy slabs of the torn land (keeping its colour) and
      // fast prismatic sparks. Both swirl tangentially while being pulled inward.
      const isSlab = hash01(world.seed, 611, idx, this.debris.length) < 0.55;
      const swirl = (hash01(world.seed, 612, idx, this.debris.length) - 0.5) * (isSlab ? 5.5 : 9.5);
      const speed = pixels(isSlab ? 2.2 + hash01(world.seed, 613, idx) * 3.0 : 5.5 + hash01(world.seed, 613, idx) * 6.0);
      let color: string;
      let glow: string;
      if (isSlab) {
        const slabs = SLAB_COLORS[prevCover] ?? SLAB_URBAN[prevMat] ?? SLAB_URBAN[CellMaterial.STREET];
        color = slabs[(idx + this.debris.length) % slabs.length];
        glow = "rgba(190, 80, 255, 0.35)";
      } else {
        const palIdx =
          prevMat === CellMaterial.SKYSCRAPER
            ? (idx + this.debris.length) % 4
            : prevMat === CellMaterial.BUILDING
              ? (idx + this.debris.length) % 5
              : (idx + this.debris.length) % DEBRIS_PALETTES.length;
        color = DEBRIS_PALETTES[palIdx].color;
        glow = DEBRIS_PALETTES[palIdx].glow;
      }

      this.debris.push({
        x,
        y,
        px: x,
        py: y,
        vx: nx * speed - ny * swirl,
        vy: ny * speed + nx * swirl,
        portalX,
        portalY,
        color,
        glowColor: glow,
        size: isSlab
          ? 1.0 + hash01(world.seed, 614, idx) * 0.55
          : prevMat === CellMaterial.SKYSCRAPER
            ? 1.15
            : 0.85,
        life: 0,
        maxLife: isSlab ? Math.min(2.8, Math.max(0.9, d / 7)) : Math.min(1.45, Math.max(0.45, d / 14)),
      });
    }
  }

  /** Evaluates structural stability for any building damaged this tick:
   * if a building's remaining pixels split into disconnected fragments and a tiny
   * splinter (<= 2 pixels) loses support, it detaches into salvage/debris. */
  stepStructuralSupport(world: VoidWorld, dt: number): void {
    if (this.damagedBuildings.size > 0) {
      for (const bId of this.damagedBuildings) {
        const b = world.buildings[bId];
        if (!b) continue;
        const intact = b.cells.filter(
          (c) =>
            world.buildingAt[c] === bId &&
            world.material[c] !== CellMaterial.VOID &&
            world.hp[c] > 0,
        );
        if (intact.length === 0) continue;

        const intactSet = new Set<number>(intact);
        const visited = new Set<number>();
        const components: number[][] = [];

        for (const start of intact) {
          if (visited.has(start)) continue;
          const comp: number[] = [];
          const queue = [start];
          visited.add(start);
          while (queue.length > 0) {
            const curr = queue.pop()!;
            comp.push(curr);
            const cx = world.grid.xOf(curr);
            const cy = world.grid.yOf(curr);
            for (const [dx, dy] of ORTHO) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (!world.grid.inBounds(nx, ny)) continue;
              const nIdx = world.grid.index(nx, ny);
              if (intactSet.has(nIdx) && !visited.has(nIdx)) {
                visited.add(nIdx);
                queue.push(nIdx);
              }
            }
          }
          components.push(comp);
        }

        if (components.length > 1) {
          components.sort((aComp, bComp) => bComp.length - aComp.length);
          for (let i = 1; i < components.length; i++) {
            const splinter = components[i];
            if (splinter.length <= 2 / PIXEL_AREA) {
              for (const cIdx of splinter) {
                world.material[cIdx] = CellMaterial.SALVAGE;
                world.hp[cIdx] = 20;
                world.maxHp[cIdx] = 26;
                world.buildingAt[cIdx] = -1;
                world.grid.markIndexDirty(cIdx);
              }
            }
          }
        }
      }
      this.damagedBuildings.clear();
    }

    // Advance drifting debris fragments along curved streamlines into their target portal
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.px = d.x;
      d.py = d.y;
      d.life += dt;

      const dx = d.portalX - d.x;
      const dy = d.portalY - d.y;
      const distToPortal = dist(dx, dy);
      if (distToPortal > 0.6) {
        const heavy = d.size >= 1.0 && d.maxLife > 1.5;
        const pull = pixels(heavy ? 9 : 18) * dt;
        const spin = (heavy ? 3.2 : 4.5) * dt;
        d.vx += (dx / distToPortal) * pull - (dy / distToPortal) * spin;
        d.vy += (dy / distToPortal) * pull + (dx / distToPortal) * spin;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.life >= d.maxLife || distToPortal < 1.1) {
        this.debris.splice(i, 1);
      }
    }

    // Advance expanding shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.shockwaves.splice(i, 1);
      }
    }
  }

  /** Deposits matter/land or ferrocrete wall in a circular radius around `(cx, cy)`. */
  depositMatterDisc(
    world: VoidWorld,
    cx: number,
    cy: number,
    radius: number,
    asWall: boolean,
    hpBoost = 1.0,
  ): { displacedVoidCells: number; restoredCells: number } {
    let displacedVoidCells = 0;
    let restoredCells = 0;
    const rCeil = Math.ceil(radius);
    const { w, h } = world.grid;

    for (
      let y = Math.max(0, Math.floor(cy - rCeil));
      y <= Math.min(h - 1, Math.ceil(cy + rCeil));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(cx - rCeil));
        x <= Math.min(w - 1, Math.ceil(cx + rCeil));
        x++
      ) {
        if (dist(x - cx, y - cy) > radius) continue;
        const idx = y * w + x;
        const mat = world.material[idx];

        if (mat === CellMaterial.VOID || mat === CellMaterial.UNCLAIMED) {
          if (mat === CellMaterial.VOID) displacedVoidCells++;
          if (asWall) {
            world.material[idx] = CellMaterial.WALL;
            const wallHp = Math.min(255, Math.round(140 * hpBoost));
            world.hp[idx] = wallHp;
            world.maxHp[idx] = wallHp;
            world.buildingAt[idx] = -1;
          } else if (world.isBaselineCell[idx]) {
            const origMat = world.originalMaterial[idx];
            const origBld = world.originalBuildingAt[idx];
            world.material[idx] = origBld >= 0 ? origMat : CellMaterial.RECLAIMED;
            world.buildingAt[idx] = origBld;
            const restoredHp = Math.min(255, Math.round(65 * hpBoost));
            world.hp[idx] = restoredHp;
            world.maxHp[idx] = Math.max(world.maxHp[idx], restoredHp);
            restoredCells++;
          } else {
            world.material[idx] = CellMaterial.RECLAIMED;
            const islandHp = Math.min(255, Math.round(80 * hpBoost));
            world.hp[idx] = islandHp;
            world.maxHp[idx] = islandHp;
            world.buildingAt[idx] = -1;
          }
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
        } else if (world.hp[idx] < world.maxHp[idx]) {
          world.hp[idx] = Math.min(world.maxHp[idx], world.hp[idx] + Math.round(35 * hpBoost));
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
          restoredCells++;
        } else if (asWall && mat === CellMaterial.STREET && world.towerAt[idx] < 0) {
          world.material[idx] = CellMaterial.WALL;
          const wallHp = Math.min(255, Math.round(150 * hpBoost));
          world.hp[idx] = wallHp;
          world.maxHp[idx] = wallHp;
          world.grid.markRadiusDirty(idx, CORRUPTION_REACH);
        }
      }
    }

    if (this.shockwaves.length < 48 && radius >= 2.0) {
      this.shockwaves.push({
        x: cx,
        y: cy,
        maxRadius: radius * 1.25,
        color: asWall ? "#48e5ff" : "#ff9e38",
        secondaryColor: displacedVoidCells > 0 ? "#ff42b8" : "#ffd166",
        life: 0,
        maxLife: radius >= 5 ? 0.65 : 0.38,
      });
    }

    return { displacedVoidCells, restoredCells };
  }
}
