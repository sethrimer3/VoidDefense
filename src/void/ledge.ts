/** Exposed ground cross-sections above the Void. Cosmetic pixels only: faces are
 * projected down-screen into existing Void cells, never into playable ground. */
import { hash } from "./grid.ts";
import { CellMaterial, LandCover } from "./model.ts";
import type { VoidWorld } from "./world.ts";

type LedgeWorld = Pick<VoidWorld, "grid" | "seed" | "material" | "landCover">;
type Painter = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect">;

const EARTH = ["#846443", "#614731", "#735438", "#44352f", "#372b30"];
const ROCK = ["#868080", "#5f5b62", "#716970", "#423e4c", "#312c3e"];

/** Returns the vertical front-face depth (in world pixels `3..7`) of the subterranean ledge
 * below ground cell `(x, y)`, or `0` if `(x, y + 1)` is not Void. */
export function ledgeFrontDepthAt(world: LedgeWorld, x: number, y: number): number {
  const { w, h } = world.grid;
  if (x < 0 || y < 0 || x >= w || y + 1 >= h) return 0;
  const idx = y * w + x;
  const material = world.material[idx];
  if (material === CellMaterial.VOID || material === CellMaterial.UNCLAIMED) return 0;
  if (world.material[idx + w] !== CellMaterial.VOID) return 0;
  const depth =
    3 +
    (hash(world.seed, 1201, x >> 2, y >> 1) % 3) +
    (hash(world.seed, 1202, x, y) % 5 === 0 ? 1 : 0);
  let visibleDepth = 0;
  for (let d = 1; d <= depth; d++) {
    if (y + d >= h || world.material[idx + d * w] !== CellMaterial.VOID) break;
    visibleDepth = d;
  }
  return visibleDepth > 0 ? visibleDepth + 1 : 0;
}

/** Returns true if screen pixel `(px, py)` in Void space is covered by a northern ground ledge's
 * front face (`y0 + 1 .. y0 + ledgeFrontDepthAt(x, y0)`). */
export function isOccludedByLedge(world: LedgeWorld, px: number, py: number): boolean {
  const { w, h } = world.grid;
  if (px < 0 || py <= 0 || px >= w || py >= h) return false;
  if (world.material[py * w + px] !== CellMaterial.VOID) return false;
  for (let d = 1; d <= 7 && py - d >= 0; d++) {
    const ny = py - d;
    if (world.material[ny * w + px] !== CellMaterial.VOID) {
      const fDepth = ledgeFrontDepthAt(world, px, ny);
      return d <= fDepth;
    }
  }
  return false;
}

/** A slightly elevated camera sees the south-facing cut most clearly, with narrow
 * darker side cuts. Layering after the nebula lets the ledge occlude the abyss. */
export function paintVoidLedge(c: Painter, world: LedgeWorld, frontier: readonly number[]): void {
  const { w, h } = world.grid;
  const paint = (x: number, y: number, color: string): void => {
    if (x < 0 || y < 0 || x >= w || y >= h || world.material[y * w + x] !== CellMaterial.VOID) return;
    c.fillStyle = color;
    c.fillRect(x, y, 1, 1);
  };
  for (const idx of frontier) {
    const material = world.material[idx];
    if (material === CellMaterial.VOID || material === CellMaterial.UNCLAIMED) continue;
    const x = idx % w, y = Math.floor(idx / w);
    const earthy = material === CellMaterial.PARK || material === CellMaterial.SALVAGE
      || world.landCover[idx] === LandCover.DIRT_ROAD;
    const palette = earthy ? EARTH : ROCK;
    // Broad variation makes rock shelves, with single-pixel chips along the underside.
    const depth = 3 + hash(world.seed, 1201, x >> 2, y >> 1) % 3
      + (hash(world.seed, 1202, x, y) % 5 === 0 ? 1 : 0);
    if (y + 1 < h && world.material[idx + w] === CellMaterial.VOID) {
      let visibleDepth = 0;
      for (let d = 1; d <= depth; d++) {
        if (y + d >= h || world.material[idx + d * w] !== CellMaterial.VOID) break;
        const grain = hash(world.seed, 1203, x, y, d);
        let color = d === 1 ? palette[0] : palette[Math.min(4, 1 + Math.floor(d * 3 / depth))];
        // Broken strata, roots and occasional lit facets keep the edge irregular.
        if (d > 1 && d < depth && grain % 7 === 0) color = palette[2];
        if (d === depth) color = grain % 4 === 0 ? "#624166" : "#211b2d";
        paint(x, y + d, color);
        visibleDepth = d;
      }
      paint(x, y + visibleDepth + 1, "#08060f");
    }
    // Thin side faces imply thickness without making every edge an identical border.
    for (const side of [-1, 1]) {
      if (x + side < 0 || x + side >= w || world.material[idx + side] !== CellMaterial.VOID) continue;
      for (let d = 1; d <= Math.min(depth - 1, 3); d++) {
        if (y + d >= h || world.material[(y + d) * w + x + side] !== CellMaterial.VOID) break;
        paint(x + side, y + d, d === 3 ? "#35233e" : palette[3]);
      }
    }
  }
}
