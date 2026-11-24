import { pixels, TICK_HZ } from "./config.ts";
import type { PlacedTower } from "./model.ts";
import { findDeliveryPath, isCityStreet, type StreetBfsScratch } from "./street-routes.ts";
import type { VoidWorld } from "./world.ts";

const DELIVERY_SPEED = pixels(15);
const LOADING_TICKS = TICK_HZ * 5;
const RETRY_TICKS = TICK_HZ * 2;
/** Highest Delivery Depot level (base plus two upgrades). */
export const DEPOT_MAX_LEVEL = 3;

export function deliveryPayout(distance: number): number {
  return Math.round(6 * 2 ** (Math.min(distance, pixels(220)) / pixels(50)));
}

/** How many depots a depot of `level` delivers to: the furthest 1, 2 or 3. */
export function depotTargetCount(level: number | undefined): number {
  return Math.max(1, Math.min(DEPOT_MAX_LEVEL, level ?? 1));
}

/** Delivery speed multiplier: a fully upgraded depot's cars drive and load three times faster. */
export function depotSpeedMultiplier(level: number | undefined): number {
  return (level ?? 1) >= DEPOT_MAX_LEVEL ? 3 : 1;
}

export type DepotLink = { from: PlacedTower; to: PlacedTower; key: string };

export const depotLinkKey = (from: number, to: number): string => `${from}>${to}`;

const centerDistance = (a: PlacedTower, b: PlacedTower): number =>
  Math.hypot(a.x + a.w * 0.5 - (b.x + b.w * 0.5), a.y + a.h * 0.5 - (b.y + b.h * 0.5));

/** Every living depot links to its furthest other living depots (1, 2 or 3 by level). Ties go
 * to the lower uid, so the link set is a pure function of the depots on the board. */
export function depotLinks(towers: readonly PlacedTower[]): DepotLink[] {
  const depots = towers.filter((t) => t.type === "deliveryDepot" && t.hp > 0);
  const links: DepotLink[] = [];
  for (const from of depots) {
    const others = depots
      .filter((d) => d !== from)
      .map((d) => ({ d, dist: centerDistance(from, d) }))
      .sort((a, b) => b.dist - a.dist || a.d.uid - b.d.uid);
    const n = Math.min(others.length, depotTargetCount(from.level));
    for (let i = 0; i < n; i++) links.push({ from, to: others[i].d, key: depotLinkKey(from.uid, others[i].d.uid) });
  }
  return links;
}

export type DeliveryRoute = {
  key: string;
  from: PlacedTower;
  to: PlacedTower;
  /** Street path from `from` to `to`; the car drives it forward loaded and back empty. */
  path: { x: number; y: number }[] | null;
  progress: number;
  /** False while driving loaded toward `to`, true while returning empty to `from`. */
  reverse: boolean;
  retryAt: number;
  holdUntil: number;
  payout: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Index of the car's head in `path`. */
  head: number;
};

export class DeliveryNetwork {
  readonly arrivals: { x: number; y: number; amount: number }[] = [];
  readonly routes: DeliveryRoute[] = [];
  private scratch?: StreetBfsScratch;

  /** The first outgoing route of depot `uid`, or else any route touching it. */
  routeFor(uid: number): DeliveryRoute | undefined {
    return this.routes.find(({ from }) => from.uid === uid) ??
      this.routes.find(({ to }) => to.uid === uid);
  }

  /** All routes depot `uid` delivers along. */
  routesFrom(uid: number): DeliveryRoute[] {
    return this.routes.filter(({ from }) => from.uid === uid);
  }

  removeDepot(uid: number): void {
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const { from, to } = this.routes[i];
      if (from.uid === uid || to.uid === uid) this.routes.splice(i, 1);
    }
  }

  /** Rebuilds the route set from the current depot links, keeping cars on links that still exist. */
  private syncLinks(towers: readonly PlacedTower[], tick: number): void {
    const links = depotLinks(towers);
    const wanted = new Set(links.map((l) => l.key));
    for (let i = this.routes.length - 1; i >= 0; i--) {
      if (!wanted.has(this.routes[i].key)) this.routes.splice(i, 1);
    }
    for (const link of links) {
      if (this.routes.some((r) => r.key === link.key)) continue;
      this.routes.push({
        key: link.key, from: link.from, to: link.to, path: null, progress: 0, reverse: false,
        retryAt: tick, holdUntil: tick, payout: deliveryPayout(centerDistance(link.from, link.to)),
        x: link.from.x, y: link.from.y, dx: 0, dy: 0, head: 0,
      });
    }
  }

  /** Advances one car per link. Searches at most one damaged or newly opened route per tick. */
  step(world: VoidWorld, towers: readonly PlacedTower[], tick: number, dt: number): number {
    this.syncLinks(towers, tick);

    let searched = false;
    let earned = 0;
    for (const route of this.routes) {
      const speedMult = depotSpeedMultiplier(route.from.level);
      const loadTicks = Math.round(LOADING_TICKS / speedMult);
      if (!route.path) {
        if (tick < route.retryAt) continue;
        // The return link drives the same streets, so reuse its path rather than searching again.
        const mirror = this.routes.find((r) => r.from === route.to && r.to === route.from && r.path);
        if (mirror?.path) {
          route.path = mirror.path.slice().reverse();
        } else {
          if (searched) continue;
          searched = true;
          this.scratch ??= { parent: new Int32Array(world.grid.count), queue: new Int32Array(world.grid.count) };
          route.path = findDeliveryPath(world, route.from, route.to, this.scratch);
        }
        route.holdUntil = tick + loadTicks;
        route.progress = 0;
        route.reverse = false;
        if (!route.path) {
          route.retryAt = tick + RETRY_TICKS;
          continue;
        }
      }

      const path = route.path;
      const last = path.length - 1;
      const next = Math.min(last, route.progress + (tick >= route.holdUntil ? DELIVERY_SPEED * speedMult * dt : 0));
      let clear = true;
      // Check every crossed pixel and the cell the car will enter next.
      for (let i = Math.floor(route.progress); i <= Math.ceil(next); i++) {
        const p = path[route.reverse ? last - i : i];
        if (!isCityStreet(world, p.x, p.y, true) || world.towerAt[world.grid.index(p.x, p.y)] >= 0) {
          clear = false;
          break;
        }
      }
      if (!clear) {
        route.path = null;
        route.retryAt = tick + RETRY_TICKS;
        continue;
      }
      const head = Math.floor(next);
      const headIdx = route.reverse ? last - head : head;
      const current = path[headIdx];
      const ahead = path[route.reverse ? last - Math.min(last, head + 1) : Math.min(last, head + 1)];
      route.head = headIdx;
      route.x = current.x;
      route.y = current.y;
      if (ahead.x !== current.x || ahead.y !== current.y) {
        route.dx = ahead.x - current.x;
        route.dy = ahead.y - current.y;
      }
      if (next === last) {
        if (!route.reverse) {
          // Loaded arrival pays; the return trip runs empty.
          earned += route.payout;
          if (this.arrivals.length < 24) this.arrivals.push({ x: current.x, y: current.y, amount: route.payout });
        }
        route.holdUntil = tick + loadTicks;
        route.reverse = !route.reverse;
        route.progress = 0;
      } else {
        route.progress = next;
      }
    }
    return earned;
  }
}

/** Whole-pixel path of a crisp Tron-style lightning bolt from `(x0, y0)` to `(x1, y1)`. The bolt
 * zigzags through seeded perpendicular kinks, and every leg runs straight or at exactly 45 degrees,
 * so it reads as a circuit trace rather than a soft line. Pure function of its inputs. */
export function depotBoltPixels(x0: number, y0: number, x1: number, y1: number, seed: number): { x: number; y: number }[] {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 11));
  const nx = len > 0 ? -(y1 - y0) / len : 0;
  const ny = len > 0 ? (x1 - x0) / len : 0;
  const knots: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const h = hashBolt(seed, i);
    const off = (i % 2 === 0 ? 1 : -1) * (2 + (h % 4));
    knots.push({ x: Math.round(x0 + (x1 - x0) * t + nx * off), y: Math.round(y0 + (y1 - y0) * t + ny * off) });
  }
  knots.push({ x: x1, y: y1 });
  const out: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  for (let k = 1; k < knots.length; k++) {
    let { x, y } = out[out.length - 1];
    const q = knots[k];
    const diagFirst = (hashBolt(seed, 100 + k) & 1) === 0;
    while (x !== q.x || y !== q.y) {
      const dx = q.x - x;
      const dy = q.y - y;
      const diag = dx !== 0 && dy !== 0;
      const straightLeft = Math.abs(Math.abs(dx) - Math.abs(dy));
      if (diag && (diagFirst || straightLeft === 0)) {
        x += Math.sign(dx);
        y += Math.sign(dy);
      } else if (Math.abs(dx) > Math.abs(dy) || dy === 0) {
        x += Math.sign(dx);
      } else {
        y += Math.sign(dy);
      }
      out.push({ x, y });
    }
  }
  return out;
}

function hashBolt(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
