/** Living wheat and bounded, simulation-driven farm fires. */
import { hash01, ORTHO } from "./grid.ts";
import { CellMaterial, LandCover, type LaserBeam } from "./model.ts";
import type { VoidWorld } from "./world.ts";

export function isWheat(cover: number): boolean {
  return cover === LandCover.FIELD_H || cover === LandCover.FIELD_V;
}

/** Coherent gusts with a local push away from people; never changes collision. */
export function wheatLean(x: number, y: number, time: number, nearby: readonly { x: number; y: number }[]): number {
  let lean = Math.sin(time * 1.4 + x * 0.14 + y * 0.09) * 0.5;
  for (const unit of nearby) {
    const dx = x - unit.x, dy = y - unit.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) lean += (dx < 0 ? -1 : 1) * (1 - d / 3) * 2.2;
  }
  return Math.max(-2, Math.min(2, lean));
}

export function farmSoilColor(x: number, y: number, cover: number, scorch: number): string {
  if (scorch) return (x + y) % 3 === 0 ? "#423229" : "#292621";
  const row = cover === LandCover.FIELD_H ? y % 3 : x % 3;
  return row === 0 ? "#695238" : row === 1 ? "#8a7244" : "#967d49";
}

export class FarmFires {
  /** Scorch persists for the current run; it never alters baseline score metadata. */
  readonly scorch: Uint8Array;
  readonly active = new Map<number, { age: number; damage: number; spread: number }>();
  private readonly seenBeams = new WeakSet<LaserBeam>();
  constructor(readonly world: VoidWorld) { this.scorch = world.farmScorch; }

  flammable(idx: number): boolean {
    const w = this.world;
    if (w.material[idx] === CellMaterial.VOID || w.material[idx] === CellMaterial.SALVAGE || this.scorch[idx] === 2) return false;
    const id = w.buildingAt[idx];
    return isWheat(w.landCover[idx]) || w.landCover[idx] === LandCover.SILO ||
      (id >= 0 && w.buildings[id]?.district === "rural");
  }

  ignite(idx: number): void {
    if (this.active.size >= 512 || this.active.has(idx) || !this.flammable(idx)) return;
    this.active.set(idx, { age: 0, damage: 0, spread: 0 });
    this.scorch[idx] = 1;
    this.world.grid.markIndexDirty(idx);
  }

  /** Supercover-like half-cell sampling also catches narrow field/structure crossings. */
  igniteBeam(beam: LaserBeam): void {
    if (beam.energy !== true || this.seenBeams.has(beam)) return;
    this.seenBeams.add(beam);
    const dx = beam.x1 - beam.x0, dy = beam.y1 - beam.y0;
    const n = Math.min(this.world.grid.w + this.world.grid.h, Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2)));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(beam.x0 + dx * k / n), y = Math.floor(beam.y0 + dy * k / n);
      if (this.world.grid.inBounds(x, y)) this.ignite(this.world.grid.index(x, y));
    }
  }

  step(dt: number, beams: readonly LaserBeam[]): void {
    for (const beam of beams) this.igniteBeam(beam);
    const w = this.world;
    // Snapshot: newly ignited neighbors start next tick, never a same-tick chain reaction.
    const spreadTo: number[] = [];
    for (const [idx, fire] of this.active) {
      if (this.scorch[idx] !== 1 || w.material[idx] === CellMaterial.VOID || w.material[idx] === CellMaterial.SALVAGE) {
        this.active.delete(idx); continue;
      }
      fire.age += dt;
      fire.damage += dt * 18;
      const loss = Math.floor(fire.damage);
      fire.damage -= loss;
      const previousHp = w.hp[idx];
      w.hp[idx] = Math.max(0, w.hp[idx] - loss);
      fire.spread += dt;
      if (fire.spread >= 0.5) {
        fire.spread -= 0.5;
        const x = w.grid.xOf(idx), y = w.grid.yOf(idx);
        const offset = Math.floor(hash01(w.seed, idx, Math.floor(fire.age * 2)) * 4);
        for (let k = 0; k < 4; k++) {
          const [dx, dy] = ORTHO[(offset + k) % 4];
          if (w.grid.inBounds(x + dx, y + dy)) {
            const next = w.grid.index(x + dx, y + dy);
            if (!this.active.has(next) && this.flammable(next)) { spreadTo.push(next); break; }
          }
        }
      }
      if (w.hp[idx] === 0 || fire.age >= 8) {
        const building = w.buildingAt[idx];
        if (building >= 0 || w.landCover[idx] === LandCover.SILO) {
          w.material[idx] = CellMaterial.SALVAGE;
          w.buildingAt[idx] = -1;
          w.columnFloors[idx] = 0;
          w.hp[idx] = 20;
          w.maxHp[idx] = 26;
        } else if (w.hp[idx] === 0) {
          // Burned crops leave soil, never a new hole into the Void.
          w.hp[idx] = 20;
        }
        this.scorch[idx] = 2;
        this.active.delete(idx);
      }
      // Soil changes only at ignition/extinguishing; building damage tiers need cache invalidation.
      const maxHp = Math.max(1, w.maxHp[idx]);
      const tier = (hp: number) => hp / maxHp < 0.4 ? 2 : hp / maxHp < 0.75 ? 1 : 0;
      if (!this.active.has(idx) || tier(previousHp) !== tier(w.hp[idx])) w.grid.markIndexDirty(idx);
    }
    for (const idx of spreadTo) this.ignite(idx);
  }
}
