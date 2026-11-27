/**
 * Whole-pixel tower sprites: each Resistance structure is a hand-drawn pixel grid (its roof, any parts
 * that rise above it, and its two-pixel south wall), so towers read as distinct machines at native
 * scale instead of tinted squares. Pure data plus a pixel walker; the renderer lights each pixel.
 */
import type { TowerTypeId } from "./model.ts";

/** How the renderer shades a sprite pixel: roof light, south-wall light, or self-lit neon. */
export type TowerPixelLight = "top" | "front" | "emit";

export type TowerSprite = {
  /** Rows drawn above the roof's north edge (barrels, masts, crystal tips). */
  over: number;
  /** `over + h` rows of `w` characters; `.` is transparent. */
  top: readonly string[];
  /** The south wall, top row first; `h`-elevation towers show both rows, low elevation only the first. */
  face: readonly [string, string];
};

/** Animation inputs for the few live pixels (muzzle flash, reservoir level, clock hand, pulses). */
export type TowerSpriteState = {
  tick: number;
  uid: number;
  /** True just after the tower fired. */
  fired: boolean;
  /** Void Siphon reservoir fill, 0..1. */
  fill: number;
  venting: boolean;
  reduceEffects: boolean;
};

const BASE: Record<string, readonly [string, TowerPixelLight]> = {
  k: ["#0b0f16", "top"],
  d: ["#19212d", "top"],
  m: ["#273142", "top"],
  s: ["#3a4659", "top"],
  l: ["#56657c", "top"],
  h: ["#8798b2", "top"],
  t: ["#f2c14e", "top"],
  r: ["#ff4f38", "top"],
  e: ["#2a8f98", "top"],
  n: ["#1a1426", "top"],
  o: ["#ff7b18", "emit"],
  y: ["#ffc35a", "emit"],
  w: ["#fff3d1", "emit"],
  c: ["#5ce1e6", "emit"],
  C: ["#d4fcff", "emit"],
  v: ["#9a6bff", "emit"],
  V: ["#d8c4ff", "emit"],
  g: ["#7be0ad", "emit"],
  p: ["#ff5c8a", "emit"],
};

const DEFAULT_FACE = ["msoosm", "kdkkdk"] as const;

export const TOWER_SPRITES: Record<TowerTypeId, TowerSprite> = {
  matterCannon: {
    over: 2,
    top: ["..MM..", "..hs..", "klhsmk", "lAhsbd", "laAybd", "laaabd", "lbbbbd", "mddddk"],
    face: DEFAULT_FACE,
  },
  repairDepot: {
    over: 0,
    top: ["hllllm", "lkAAkd", "lAyyAd", "lAyyAd", "lkAAkd", "mddddk"],
    face: ["msyysm", "kdkkdk"],
  },
  infantryBarracks: {
    over: 2,
    top: ["....o.", "....l.", "hllllm", "lAAAAd", "lbbbbd", "lAAAAd", "lbbbbd", "mddddk"],
    face: ["msddsm", "kdyydk"],
  },
  constructorHub: {
    over: 0,
    top: ["akakak", "kslsma", "alyymk", "kmyysa", "asmsdk", "kakaka"],
    face: DEFAULT_FACE,
  },
  shieldProjector: {
    over: 0,
    top: ["khllmk", "hlccmd", "lcCwcd", "lcwCcd", "mmccdd", "kmddkk"],
    face: ["msccsm", "kdkkdk"],
  },
  wallSerpent: {
    over: 0,
    top: ["hllllm", "lccccd", "lmmdcd", "lcCdcd", "lccccd", "mddddk"],
    face: ["msddsm", "kdccdk"],
  },
  gravityAnchor: {
    over: 1,
    top: ["..hm..", "hllllm", "lbaabd", "laVkad", "lakkad", "lbaabd", "mddddk"],
    face: ["msvvsm", "kdkkdk"],
  },
  rocketTeam: {
    over: 1,
    top: [".r..r.", "khmmhk", "khddhk", "aaooaa", "lmddmd", "lbaabd", "mddddk"],
    face: DEFAULT_FACE,
  },
  heavyMechBay: {
    over: 0,
    top: ["hllllllm", "laabbaad", "lbkkkkbd", "lbkAAkbd", "lbkcckbd", "lbkkkkbd", "laabbaad", "mddddddk"],
    face: ["msoddosm", "kdyyyydk"],
  },
  deliveryDepot: {
    over: 0,
    top: ["hllllm", "laaaad", "lbbbbd", "laaaad", "lsyysd", "mddddk"],
    face: ["msddsm", "kdoodk"],
  },
  voidSiphon: {
    over: 0,
    top: ["khVk", "hFFd", "VFFd", "kddk"],
    face: ["mvvm", "kddk"],
  },
  boundaryPrism: {
    over: 2,
    top: [".Cc.", ".Cc.", "lCcd", "lCed", "mCed", "kddk"],
    face: ["mccm", "kddk"],
  },
  chronoCannon: {
    over: 0,
    top: ["kttk", "tQQt", "tQQt", "kttk"],
    face: ["myym", "kddk"],
  },
  lanternBearer: {
    over: 0,
    top: ["hllm", "lkkd", "lkkd", "mddk"],
    face: ["myym", "kddk"],
  },
  seamwalker: {
    over: 0,
    top: ["hllm", "lgmd", "lmgd", "mddk"],
    face: ["moom", "kddk"],
  },
  echoMine: {
    over: 0,
    top: ["kssk", "sPPd", "sPPd", "kddk"],
    face: ["moom", "kddk"],
  },
  countervoidHeart: {
    over: 0,
    top: ["kook", "oHHo", "oHHo", "kook"],
    face: ["mppm", "kddk"],
  },
};

function mix(hex: string, toward: number, amount: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number): string => {
    const c = (v >> shift) & 255;
    return Math.round(c + (toward - c) * amount).toString(16).padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Clockwise interior cells of a 4x4 dial, used for the Chrono Cannon's backward-ticking hand. */
const DIAL = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
] as const;

function liveColor(
  key: string,
  col: number,
  row: number,
  state: TowerSpriteState,
): readonly [string, TowerPixelLight] {
  switch (key) {
    case "M":
      return state.fired ? ["#fff3d1", "emit"] : ["#3a4659", "top"];
    case "F": {
      // Reservoir fills bottom row first, left to right.
      const order = (2 - row) * 2 + (col - 1);
      if (state.fill * 4 > order + 0.05) return [state.venting ? "#ffb052" : "#9a6bff", "emit"];
      return ["#1a1426", "top"];
    }
    case "Q": {
      const step = state.reduceEffects ? 0 : Math.floor(state.tick / 15);
      const hand = DIAL[(4 - (step % 4)) % 4];
      return hand[0] === col && hand[1] === row ? ["#fff3d1", "emit"] : ["#3a2e18", "top"];
    }
    case "P": {
      const pulse = state.reduceEffects ? 0.65 : 0.45 + 0.55 * Math.abs(Math.sin(state.tick * 0.12 + state.uid));
      if (pulse > 0.8) return ["#ffd6a0", "emit"];
      return pulse > 0.55 ? ["#ff8830", "emit"] : ["#7a3426", "top"];
    }
    case "H": {
      const beat = state.reduceEffects ? 0.8 : 0.65 + 0.35 * Math.sin(state.tick * 0.16);
      return beat > 0.75 ? ["#ffe39c", "emit"] : ["#ff8c24", "emit"];
    }
    default:
      return BASE[key] ?? BASE.k;
  }
}

/**
 * Visits every opaque pixel of a tower sprite. `dy` is relative to the roof's north row (negative
 * above it, `h..h+faceRows-1` for the south wall); `accent` is the tower's spec colour.
 */
export function forEachTowerSpritePixel(
  type: TowerTypeId,
  accent: string,
  w: number,
  h: number,
  faceRows: number,
  state: TowerSpriteState,
  visit: (dx: number, dy: number, color: string, light: TowerPixelLight) => void,
): void {
  const sprite = TOWER_SPRITES[type];
  const accentKeys: Record<string, string> = {
    a: accent,
    A: mix(accent, 255, 0.4),
    b: mix(accent, 0, 0.45),
  };
  const rows = sprite.top;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const dy = r - sprite.over;
    for (let dx = 0; dx < w && dx < row.length; dx++) {
      const key = row[dx];
      if (key === ".") continue;
      const accentColor = accentKeys[key];
      if (accentColor) {
        visit(dx, dy, accentColor, "top");
        continue;
      }
      const [color, light] = liveColor(key, dx, dy, state);
      visit(dx, dy, color, light);
    }
  }
  for (let f = 0; f < faceRows && f < 2; f++) {
    const row = sprite.face[f];
    for (let dx = 0; dx < w && dx < row.length; dx++) {
      const key = row[dx];
      if (key === ".") continue;
      const accentColor = accentKeys[key];
      const [color, light] = accentColor ? [accentColor, "top" as const] : liveColor(key, dx, h + f, state);
      visit(dx, h + f, color, light === "top" ? "front" : light);
    }
  }
  // Animated parts that float above the roof.
  if (type === "lanternBearer") {
    const bob = state.reduceEffects ? 0 : Math.round((Math.sin(state.tick * 0.08 + state.uid) + 1) * 0.5);
    const cx = Math.floor((w - 2) / 2);
    visit(cx, -3 - bob, "#56657c", "top");
    visit(cx + 1, -3 - bob, "#56657c", "top");
    visit(cx, -2 - bob, "#ffd875", "emit");
    visit(cx + 1, -2 - bob, "#fff3d1", "emit");
  } else if (type === "voidSiphon" && state.venting) {
    const plume = state.reduceEffects ? 2 : 2 + Math.round((Math.sin(state.tick * 0.35) + 1) * 0.5);
    for (let i = 1; i <= plume; i++) visit(Math.floor(w / 2) - (i & 1), -i, i === plume ? "#ffe0a8" : "#ffb052", "emit");
  }
}
