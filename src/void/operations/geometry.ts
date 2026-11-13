/** Where things stand in the Resistance Operations scene, in world pixels
 * (one pixel a world unit, scaled up crisp like the TowerDefense Library's
 * nave). The Engineering Bay is on the left of the bulkhead, the Research
 * Lab on the right. */

export const OPS_W = 256;
export const OPS_H = 144;
/** The ceiling's girders fill the rows above this. */
export const CEIL = 10;
/** The deck's top row: crew on the floor stand on the row above it. */
export const FLOOR = 124;
export const BAY = { x0: 0, x1: 124 };
export const BULKHEAD = { x0: 124, x1: 132, door: 18 };
export const LAB = { x0: 132, x1: OPS_W };
/** The scaffold's decks, lowest first: crew stand on the row above `y`. */
export const DECKS = [
  { y: 100, x0: 6, x1: 46 },
  { y: 76, x0: 6, x1: 46 },
] as const;
export const LADDER_X = 9;
/** The prototype's footprint on the floor and its armoured housing. */
export const TURRET = { x0: 50, x1: 106, housingX0: 60, housingX1: 94, housingY0: 70, housingY1: 100 };
/** Supply crates stacked under the scaffold. */
export const CRATES = { x0: 16, x1: 42 };
export const CRANE = { y: 11, x0: 8, x1: 120 };
/** The viewport onto the Void above the lab's chambers. */
export const WINDOW = { x0: 150, x1: 238, y0: 20, y1: 58 };
export const CHAMBER_SLOTS = 4;
export const CHAMBER = { w: 18, top: 80 };
export const chamberX = (i: number) => 136 + i * 30;

/** The row a figure's feet stand on at bay level `level`. */
export function levelY(level: number): number {
  return level <= 0 ? FLOOR - 1 : DECKS[Math.min(DECKS.length, level) - 1].y - 1;
}
