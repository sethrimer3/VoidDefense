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
  /** Path pixels the car will advance during the next tick (0 while loading), so the renderer can
   * place it between ticks instead of snapping once per 30 Hz tick. */
  rate: number;
};

/** Where a delivery car is drawn: the head pixel, its heading, and the second lane pixel of the 2-wide car. */
export type DeliveryCarPose = {
  /** Index of the head pixel in `route.path`. */
  idx: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Offset of the car's second lane pixel from each path pixel at this heading. */
  ox: number;
  oy: number;
};

/** Path index `along` pixels into the current trip (forward trips run up the path, returns run down it). */
export const tripIndex = (route: DeliveryRoute, along: number): number =>
  route.reverse ? route.path!.length - 1 - along : along;

/** Heading of the car while on path index `idx`: toward the next pixel of its trip, or the last step at the end. */
export function tripHeading(path: readonly { x: number; y: number }[], idx: number, reverse: boolean): { dx: number; dy: number } {
  const step = reverse ? -1 : 1;
  const a = path[idx];
  const ahead = path[idx + step];
  if (ahead) return { dx: ahead.x - a.x, dy: ahead.y - a.y };
  const behind = path[idx - step];
  return behind ? { dx: a.x - behind.x, dy: a.y - behind.y } : { dx: 1, dy: 0 };
}

/** Lane offset for a 2-wide car at `(x, y)` heading `(dx, dy)`: its right-hand side (screen y points
 * down), or the left when the right is not drivable. A pure function of heading and terrain, so the
 * car never swaps sides on a straight street just because it moved. */
export function laneOffset(world: VoidWorld, x: number, y: number, dx: number, dy: number): { ox: number; oy: number } {
  const ox = -dy;
  const oy = dx;
  return isCityStreet(world, x + ox, y + oy, true) ? { ox, oy } : { ox: -ox, oy: -oy };
}

/** The car's pose `frac` (0..1) of the way into the next tick, so motion advances by wall time rather
 * than jumping a whole tick's worth of pixels at a time. Stays on whole pixels. */
export function deliveryCarPose(world: VoidWorld, route: DeliveryRoute, frac: number): DeliveryCarPose | null {
  const path = route.path;
  if (!path) return null;
  const last = path.length - 1;
  const along = Math.min(last, Math.floor(route.progress + Math.max(0, Math.min(1, frac)) * route.rate));
  const idx = tripIndex(route, along);
  const p = path[idx];
  const { dx, dy } = tripHeading(path, idx, route.reverse);
  const { ox, oy } = laneOffset(world, p.x, p.y, dx, dy);
  return { idx, x: p.x, y: p.y, dx, dy, ox, oy };
}

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
        x: link.from.x, y: link.from.y, dx: 0, dy: 0, head: 0, rate: 0,
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
      route.rate = 0;
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
        // Speed for the coming tick, so rendering can advance the car smoothly until it runs.
        if (tick + 1 >= route.holdUntil) route.rate = Math.min(last - next, DELIVERY_SPEED * speedMult * dt);
      }
    }
    return earned;
  }
}

