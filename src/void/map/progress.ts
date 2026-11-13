/** The Resistance Map's campaign: its sectors in order, where each city
 * stands on the map, and which are beaten, open, or still locked. Pure, so
 * the rules are tested without a browser.
 *
 * A sector is beaten once won in either play style (Endless, which can't be
 * won, once it has been attempted). The first sector is always open; each
 * later one opens when the one before it is beaten. A sector already beaten
 * (from before the map gated play) stays open, and Developer Mode opens all. */

import type { ScenarioId } from "../model.ts";
import type { VoidTechWallet } from "../tech/wallet.ts";

/** Map size in map pixels (one pixel a map unit, scaled up crisp). */
export const MAP_W = 320;
export const MAP_H = 180;

export type MapCity = {
  id: ScenarioId;
  /** The city's centre on the map. */
  x: number;
  y: number;
  /** Footprint radius: bigger, taller skylines later in the campaign. */
  r: number;
};

/** The campaign route, from the first breach to the Endless dark city. */
export const MAP_CITIES: readonly MapCity[] = [
  { id: "tutorialBreach", x: 42, y: 146, r: 10 },
  { id: "edgeAdvance", x: 98, y: 118, r: 11 },
  { id: "centralRupture", x: 64, y: 66, r: 12 },
  { id: "twinBreaches", x: 132, y: 40, r: 12 },
  { id: "delayedCollapse", x: 186, y: 84, r: 12 },
  { id: "archipelagoCity", x: 236, y: 142, r: 13 },
  { id: "organismEscalation", x: 268, y: 82, r: 13 },
  { id: "endless", x: 284, y: 30, r: 14 },
];

export type CityState = "locked" | "open" | "beaten";

export function sectorBeaten(wallet: VoidTechWallet, id: ScenarioId): boolean {
  if (id === "endless") return wallet.endlessAttempts > 0;
  const p = wallet.scenarios[id];
  return !!p && (p.underSiege.victories > 0 || p.buildAndWatch.victories > 0);
}

export function cityStates(wallet: VoidTechWallet, devMode = false): CityState[] {
  return MAP_CITIES.map((c, i) => {
    if (sectorBeaten(wallet, c.id)) return "beaten";
    if (devMode || i === 0 || sectorBeaten(wallet, MAP_CITIES[i - 1].id)) return "open";
    return "locked";
  });
}

export function sectorUnlocked(wallet: VoidTechWallet, id: ScenarioId, devMode = false): boolean {
  const i = MAP_CITIES.findIndex((c) => c.id === id);
  return i >= 0 && cityStates(wallet, devMode)[i] !== "locked";
}

/** The trails walked so far: from each beaten city to the next on the route. */
export function trailsWalked(wallet: VoidTechWallet): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < MAP_CITIES.length; i++) if (sectorBeaten(wallet, MAP_CITIES[i].id)) out.push(i);
  return out;
}

/** The city the campaign urges the player toward: the first open, unbeaten one. */
export function frontier(wallet: VoidTechWallet, devMode = false): number {
  const states = cityStates(wallet, devMode);
  const i = states.findIndex((s, k) => s === "open" && (k === 0 || states[k - 1] === "beaten"));
  return i >= 0 ? i : states.indexOf("open");
}

/** Points along the trail from city `i` to city `i + 1`, a pixel apart: a
 * gentle curve that bows to one side, alternating along the route. */
export function trailPath(i: number): { x: number; y: number }[] {
  const a = MAP_CITIES[i], b = MAP_CITIES[i + 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  // Leave each city at its edge rather than its centre.
  const sx = a.x + (dx / len) * (a.r + 2), sy = a.y + (dy / len) * (a.r + 2);
  const ex = b.x - (dx / len) * (b.r + 2), ey = b.y - (dy / len) * (b.r + 2);
  const bow = (i % 2 === 0 ? 1 : -1) * len * 0.22;
  const cx = (sx + ex) / 2 - (dy / len) * bow, cy = (sy + ey) / 2 + (dx / len) * bow;
  const pts: { x: number; y: number }[] = [];
  const steps = Math.ceil(len * 1.6);
  let last = "";
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, u = 1 - t;
    const x = Math.round(u * u * sx + 2 * u * t * cx + t * t * ex);
    const y = Math.round(u * u * sy + 2 * u * t * cy + t * t * ey);
    const k = `${x},${y}`;
    if (k !== last) pts.push({ x, y });
    last = k;
  }
  return pts;
}
