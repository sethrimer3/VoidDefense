import { pixels, TICK_HZ } from "./config.ts";
import type { PlacedTower } from "./model.ts";
import { findDeliveryPath, isCityStreet, type StreetBfsScratch } from "./street-routes.ts";
import type { VoidWorld } from "./world.ts";

const DELIVERY_SPEED = pixels(15);
const LOADING_TICKS = TICK_HZ * 5;
const RETRY_TICKS = TICK_HZ * 2;

export function deliveryPayout(distance: number): number {
  return Math.round(6 * 2 ** (Math.min(distance, pixels(220)) / pixels(50)));
}

type DeliveryRoute = {
  from: PlacedTower;
  to: PlacedTower;
  path: { x: number; y: number }[] | null;
  progress: number;
  reverse: boolean;
  retryAt: number;
  holdUntil: number;
  payout: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
};

export class DeliveryNetwork {
  readonly arrivals: { x: number; y: number; amount: number }[] = [];
  readonly routes: DeliveryRoute[] = [];
  private readonly paired = new Set<number>();
  private scratch?: StreetBfsScratch;

  routeFor(uid: number): DeliveryRoute | undefined {
    return this.routes.find(({ from, to }) => from.uid === uid || to.uid === uid);
  }

  removeDepot(uid: number): void {
    const index = this.routes.findIndex(({ from, to }) => from.uid === uid || to.uid === uid);
    if (index < 0) return;
    const [route] = this.routes.splice(index, 1);
    this.paired.delete(route.from.uid);
    this.paired.delete(route.to.uid);
  }

  /** Advances one truck per pair. Search at most one damaged or newly opened route per tick. */
  step(world: VoidWorld, towers: readonly PlacedTower[], tick: number, dt: number): number {
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const { from, to } = this.routes[i];
      if (from.hp <= 0 || to.hp <= 0 || !towers.includes(from) || !towers.includes(to)) this.removeDepot(from.uid);
    }
    let waiting: PlacedTower | undefined;
    for (const depot of towers) {
      if (depot.type !== "deliveryDepot" || depot.hp <= 0 || this.paired.has(depot.uid)) continue;
      if (!waiting) {
        waiting = depot;
        continue;
      }
      const separation = Math.hypot(depot.x - waiting.x, depot.y - waiting.y);
      this.routes.push({
        from: waiting, to: depot, path: null, progress: 0, reverse: false, retryAt: tick, holdUntil: tick,
        payout: deliveryPayout(separation), x: 0, y: 0, dx: 0, dy: 0,
      });
      this.paired.add(depot.uid);
      this.paired.add(waiting.uid);
      waiting = undefined;
    }

    let searched = false;
    let earned = 0;
    for (const route of this.routes) {
      if (!route.path) {
        if (searched || tick < route.retryAt) continue;
        searched = true;
        this.scratch ??= { parent: new Int32Array(world.grid.count), queue: new Int32Array(world.grid.count) };
        route.path = findDeliveryPath(world, route.from, route.to, this.scratch);
        route.holdUntil = tick + LOADING_TICKS;
        route.progress = 0;
        if (!route.path) {
          route.retryAt = tick + RETRY_TICKS;
          continue;
        }
      }

      const path = route.path;
      const last = path.length - 1;
      const next = Math.min(last, route.progress + (tick >= route.holdUntil ? DELIVERY_SPEED * dt : 0));
      let clear = true;
      // Check every crossed pixel and the cell the truck will enter next.
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
      const current = path[route.reverse ? last - head : head];
      const ahead = path[route.reverse ? last - Math.min(last, head + 1) : Math.min(last, head + 1)];
      route.x = current.x;
      route.y = current.y;
      route.dx = ahead.x - current.x;
      route.dy = ahead.y - current.y;
      if (next === last) {
        earned += route.payout;
        if (this.arrivals.length < 24) this.arrivals.push({ x: current.x, y: current.y, amount: route.payout });
        route.holdUntil = tick + LOADING_TICKS;
        route.reverse = !route.reverse;
        route.progress = 0;
      } else {
        route.progress = next;
      }
    }
    return earned;
  }
}
