/** Exposed ground cross-sections above the Void. Cosmetic pixels only: faces are
 * projected down-screen into existing Void cells, never into playable ground.
 *
 * Includes:
 * - 2 to 4 pixel geological/urban strata bands (asphalt, concrete, dirt, rock for city;
 *   topsoil, subsoil, root threads, and dark earth for farmland), darker with depth.
 * - Directional light-direction shading (`sunDir`) so sun-facing walls are lit and opposite walls are in shadow.
 * - Low quality (`quality === "low"`) uses a simpler 2-band cliff profile. */
import { hash } from "./grid.ts";
import { CellMaterial, LandCover } from "./model.ts";
import type { VoidWorld } from "./world.ts";

type LedgeWorld = Pick<VoidWorld, "grid" | "seed" | "material" | "landCover">;
type Painter = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect">;

export type LedgeOptions = {
  /** Directional 3D sun/light vector `[lx, ly, lz]` (default NW sun `[-0.58, -0.58, 0.57]`). */
  sunDir?: readonly [number, number, number];
  /** Quality tier (`"low"` uses simpler 2-band strata). */
  quality?: "high" | "medium" | "low";
};

/** Farmland / park strata (top to bottom): rich topsoil lip, warm loam, root-threaded clay, dark subsoil, deep bed. */
const EARTH = ["#846443", "#614731", "#735438", "#44352f", "#372b30"] as const;
const EARTH_LIT = ["#96734e", "#72553b", "#856242", "#524038", "#3f3136"] as const;
const EARTH_SHADE = ["#694f35", "#4c3726", "#5a412b", "#332723", "#261e22"] as const;

/** Urban / engineered strata (top to bottom): broken asphalt/concrete lip, concrete slab, compacted dirt/gravel, bedrock, deep stone. */
const ROCK = ["#868080", "#5f5b62", "#716970", "#423e4c", "#312c3e"] as const;
const ROCK_LIT = ["#9a9494", "#726d75", "#837a82", "#504b5c", "#3b354a"] as const;
const ROCK_SHADE = ["#6b6666", "#4b484e", "#595258", "#322f3a", "#24202e"] as const;

/** Street asphalt strata (top to bottom): dark torn asphalt cap, concrete roadbed, compacted dirt sub-base, deep rock. */
const ASPHALT_STRATA = ["#4e5868", "#868080", "#614731", "#423e4c", "#2d2838"] as const;
const ASPHALT_LIT = ["#5d697c", "#9a9494", "#735438", "#504b5c", "#373145"] as const;
const ASPHALT_SHADE = ["#3a424e", "#6b6666", "#4c3726", "#322f3a", "#211d2a"] as const;

/** Returns the vertical front-face depth (in world pixels `3..7`) of the subterranean ledge
 * below ground cell `(x, y)`, or `0` if `(x, y + 1)` is not Void. */
export function ledgeFrontDepthAt(world: LedgeWorld, x: number, y: number): number {
  const { w, h } = world.grid;
  if (x < 0 || y < 0 || x >= w || y + 1 >= h) return 0;
  const idx = y * w + x;
  const material = world.material[idx];
  if (material === CellMaterial.VOID || material === CellMaterial.UNCLAIMED || material === CellMaterial.EMPTY) return 0;
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
 * darker side cuts and 2-4 pixel strata bands shaded by the active light direction.
 * Layering after the nebula lets the ledge occlude the abyss. */
export function paintVoidLedge(
  c: Painter,
  world: LedgeWorld,
  frontier: readonly number[],
  options?: LedgeOptions,
): void {
  const { w, h } = world.grid;
  const lowQuality = options?.quality === "low";
  const sunDir = options?.sunDir;
  const lx = sunDir ? sunDir[0] : -0.58;
  const ly = sunDir ? sunDir[1] : -0.58;

  const paint = (x: number, y: number, color: string): void => {
    if (x < 0 || y < 0 || x >= w || y >= h || world.material[y * w + x] !== CellMaterial.VOID) return;
    c.fillStyle = color;
    c.fillRect(x, y, 1, 1);
  };

  for (const idx of frontier) {
    const material = world.material[idx];
    if (material === CellMaterial.VOID || material === CellMaterial.UNCLAIMED || material === CellMaterial.EMPTY) continue;
    const x = idx % w;
    const y = Math.floor(idx / w);
    const cover = world.landCover[idx];
    const earthy =
      material === CellMaterial.PARK ||
      material === CellMaterial.SALVAGE ||
      cover === LandCover.DIRT_ROAD;
    const isStreet = !earthy && material === CellMaterial.STREET && cover !== LandCover.BRIDGE;

    // Estimate local cliff outward normal from adjacent Void cells to shade by light direction
    const vW = x > 0 && world.material[idx - 1] === CellMaterial.VOID ? -1 : 0;
    const vE = x + 1 < w && world.material[idx + 1] === CellMaterial.VOID ? 1 : 0;
    const vN = y > 0 && world.material[idx - w] === CellMaterial.VOID ? -1 : 0;
    const vS = y + 1 < h && world.material[idx + w] === CellMaterial.VOID ? 1 : 0;
    const nx = vW + vE;
    const ny = vN + vS;
    const dot = nx * lx + ny * ly;

    // Preserve exact default palette on pure south-facing cuts when no custom sunDir is supplied
    const shadeTier = !sunDir && nx === 0 ? 0 : dot > 0.15 ? 1 : dot < -0.25 ? -1 : 0;

    const palette = earthy
      ? shadeTier > 0
        ? EARTH_LIT
        : shadeTier < 0
          ? EARTH_SHADE
          : EARTH
      : isStreet && shadeTier !== 0
        ? shadeTier > 0
          ? ASPHALT_LIT
          : ASPHALT_SHADE
        : isStreet
          ? ASPHALT_STRATA
          : shadeTier > 0
            ? ROCK_LIT
            : shadeTier < 0
              ? ROCK_SHADE
              : ROCK;

    // Broad variation makes 2 to 4 pixel strata shelves, with single-pixel chips along the underside.
    const fullDepth =
      3 +
      (hash(world.seed, 1201, x >> 2, y >> 1) % 3) +
      (hash(world.seed, 1202, x, y) % 5 === 0 ? 1 : 0);
    const depth = lowQuality ? Math.min(3, fullDepth) : fullDepth;

    if (y + 1 < h && world.material[idx + w] === CellMaterial.VOID) {
      let visibleDepth = 0;
      for (let d = 1; d <= depth; d++) {
        if (y + d >= h || world.material[idx + d * w] !== CellMaterial.VOID) break;
        const grain = hash(world.seed, 1203, x, y, d);
        let color: string;
        if (lowQuality) {
          color = d === 1 ? (earthy ? EARTH[0] : ROCK[0]) : palette[3];
        } else {
          // d === 1: top rim lip (EARTH[0] "#846443" for earth/farmland, ASPHALT_STRATA[0] "#4e5868" for street asphalt, ROCK[0] "#868080" for masonry/rock)
          const lipColor = earthy ? EARTH[0] : isStreet ? ASPHALT_STRATA[0] : ROCK[0];
          color = d === 1 ? lipColor : palette[Math.min(4, 1 + Math.floor((d * 3) / depth))];
          // Broken strata, dangling root threads in farmland, concrete/dirt/rock seams in city
          if (d > 1 && d < depth) {
            if (earthy && grain % 6 === 0) {
              color = d === 2 ? "#9c7a4c" : EARTH[2]; // exposed root thread / pale rootlet
            } else if (!earthy && d === 2 && grain % 3 !== 0) {
              color = ROCK[1]; // concrete sub-slab band under asphalt
            } else if (!earthy && d === 3 && grain % 3 === 0) {
              color = "#5c4838"; // compacted dirt seam between concrete and bedrock
            } else if (grain % 7 === 0) {
              color = palette[2];
            }
          }
          if (d === depth) color = grain % 4 === 0 ? "#624166" : "#211b2d";
        }
        paint(x, y + d, color);
        visibleDepth = d;
      }
      // Deep undercut contact shadow below the cliff wall (#08060f)
      paint(x, y + visibleDepth + 1, "#08060f");
    }

    // East and west side cliff walls (2 to 3 px deep) shaded by light direction:
    // A west-facing cliff wall (side = -1, facing -X toward NW sun) catches light;
    // an east-facing cliff wall (side = +1, facing +X away from NW sun) falls into deeper shadow.
    const maxSideD = lowQuality ? 2 : Math.min(depth - 1, 3);
    for (const side of [-1, 1] as const) {
      if (x + side < 0 || x + side >= w || world.material[idx + side] !== CellMaterial.VOID) continue;
      const sideLit = side * lx > 0.08;
      const sidePal = earthy
        ? sideLit
          ? EARTH_LIT
          : EARTH_SHADE
        : sideLit
          ? ROCK_LIT
          : ROCK_SHADE;
      for (let d = 1; d <= maxSideD; d++) {
        if (y + d >= h || world.material[(y + d) * w + x + side] !== CellMaterial.VOID) break;
        const sideColor =
          d === 1
            ? sidePal[1]
            : d === 2
              ? sidePal[3]
              : "#24182e";
        paint(x + side, y + d, sideColor);
      }
    }

    // North-facing inner lip (when Void is north of ground at y - 1): 1-2 px deep shadowed rim wall
    // so the southern edge of the crater also reads as a torn rim rather than a flat cutout
    if (!lowQuality && y > 0 && world.material[idx - w] === CellMaterial.VOID) {
      const northShade = earthy ? EARTH_SHADE[3] : ROCK_SHADE[3];
      paint(x, y - 1, northShade);
      if (y > 1 && world.material[idx - w * 2] === CellMaterial.VOID && (x + y) % 2 === 0) {
        paint(x, y - 2, "#140e1f");
      }
    }
  }
}
