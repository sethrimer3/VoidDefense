import { CellMaterial, type PlacedTower } from "./model.ts";
import type { VoidWorld } from "./world.ts";

export interface StreetBfsScratch {
  parent: Int32Array;
  queue: Int32Array;
}

function isRoadMaterial(material: number, tier: number, delivery: boolean): boolean {
  return (delivery || tier !== 8) && (material === CellMaterial.STREET ||
    (delivery && tier > 0 && material === CellMaterial.RECLAIMED));
}

export function isCityStreet(world: VoidWorld, x: number, y: number, delivery = false): boolean {
  const { w, h } = world.grid;
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  const i = y * w + x;
  // Only delivery trucks use countryside lanes and reclaimed roadbeds.
  return isRoadMaterial(world.material[i], world.streetTier[i], delivery);
}

/** Finds a shortest orthogonal city-street path between two street cells anywhere on the map. */
export function findStreetPath(
  world: VoidWorld,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  scratch?: StreetBfsScratch,
): { x: number; y: number }[] | null {
  if (!isCityStreet(world, startX, startY) || !isCityStreet(world, goalX, goalY)) return null;
  const { w } = world.grid;
  const start = startY * w + startX;
  const goal = goalY * w + goalX;
  const path = searchStreetPath(world, [start], [goal], scratch);
  return path && path.length >= 4 ? path : null;
}

function searchStreetPath(
  world: VoidWorld, starts: readonly number[], goals: readonly number[], scratch?: StreetBfsScratch, delivery = false,
): { x: number; y: number }[] | null {
  const { w, h } = world.grid;
  if (!starts.length || !goals.length) return null;
  const goal = goals[0];
  const otherGoals = goals.length > 1 ? new Set(goals.slice(1)) : null;

  const n = w * h;
  const parent = scratch && scratch.parent.length === n ? scratch.parent : new Int32Array(n);
  const queue = scratch && scratch.queue.length === n ? scratch.queue : new Int32Array(n);
  parent.fill(-1);

  let head = 0;
  let tail = 0;
  for (const start of starts) {
    if (start === goal || otherGoals?.has(start) || parent[start] !== -1) continue;
    parent[start] = -2;
    queue[tail++] = start;
  }
  let found = -1;

  const { material, streetTier, towerAt } = world;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === goal || otherGoals?.has(cur)) {
      found = cur;
      break;
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;

    if (cx + 1 < w) {
      const ni = cur + 1;
      if (parent[ni] === -1 && isRoadMaterial(material[ni], streetTier[ni], delivery) && (!delivery || towerAt[ni] < 0)) {
        parent[ni] = cur;
        queue[tail++] = ni;
      }
    }
    if (cx - 1 >= 0) {
      const ni = cur - 1;
      if (parent[ni] === -1 && isRoadMaterial(material[ni], streetTier[ni], delivery) && (!delivery || towerAt[ni] < 0)) {
        parent[ni] = cur;
        queue[tail++] = ni;
      }
    }
    if (cy + 1 < h) {
      const ni = cur + w;
      if (parent[ni] === -1 && isRoadMaterial(material[ni], streetTier[ni], delivery) && (!delivery || towerAt[ni] < 0)) {
        parent[ni] = cur;
        queue[tail++] = ni;
      }
    }
    if (cy - 1 >= 0) {
      const ni = cur - w;
      if (parent[ni] === -1 && isRoadMaterial(material[ni], streetTier[ni], delivery) && (!delivery || towerAt[ni] < 0)) {
        parent[ni] = cur;
        queue[tail++] = ni;
      }
    }
  }

  if (found < 0) return null;

  const path: { x: number; y: number }[] = [];
  let cur = found;
  while (cur >= 0) {
    const x = cur % w;
    const y = (cur - x) / w;
    path.push({ x, y });
    cur = parent[cur];
  }
  path.reverse();
  return path;
}

/** Lists drivable cells along a depot's perimeter. */
function depotRoadCells(world: VoidWorld, x: number, y: number, w: number, h: number): number[] {
  const cells: number[] = [];
  const consider = (px: number, py: number) => {
    if (!isCityStreet(world, px, py, true)) return;
    const idx = world.grid.index(px, py);
    if (world.towerAt[idx] < 0) cells.push(idx);
  };
  for (let px = x; px < x + w; px++) {
    consider(px, y + h);
    consider(px, y - 1);
  }
  for (let py = y; py < y + h; py++) {
    consider(x - 1, py);
    consider(x + w, py);
  }
  return cells;
}

export function hasDepotRoad(world: VoidWorld, x: number, y: number, w: number, h: number): boolean {
  return depotRoadCells(world, x, y, w, h).length > 0;
}

export function findDeliveryPath(world: VoidWorld, from: PlacedTower, to: PlacedTower, scratch: StreetBfsScratch) {
  return searchStreetPath(world,
    depotRoadCells(world, from.x, from.y, from.w, from.h),
    depotRoadCells(world, to.x, to.y, to.w, to.h), scratch, true);
}
