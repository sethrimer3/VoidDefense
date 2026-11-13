/** The Resistance Operations crew: engineers welding and hauling in the
 * Engineering Bay, researchers tending the Research Lab's containment
 * chambers. Purely cosmetic and frame-driven, like the TowerDefense Library's
 * librarians: nothing here earns anything, and nothing runs while the tab is
 * hidden. Positions are world pixels of the Operations scene (see
 * `geometry.ts`); a figure's `y` is the row its feet stand on. */

import { random } from "../../random.ts";
import { BAY, CHAMBER_SLOTS, CRATES, DECKS, LAB, LADDER_X, TURRET, WINDOW, chamberX, levelY } from "./geometry.ts";

export type CrewRole = "welder" | "rigger" | "researcher";

/** What a crew member is off to do at its spot. */
export type Duty = "weld" | "haul" | "fetch" | "scan" | "gaze" | "rest";

export type CrewMember = {
  id: number;
  name: string;
  role: CrewRole;
  x: number;
  /** Feet row. */
  y: number;
  /** Bay level stood on: 0 the floor, then each scaffold deck. */
  level: number;
  facing: -1 | 1;
  goal: { x: number; level: number; duty: Duty; face: -1 | 1 };
  phase: "walk" | "climb" | "work";
  /** Seconds left at the current duty. */
  timer: number;
  /** Walking cycle, for the legs. */
  stride: number;
  /** A rigger with a plate in hand. */
  carrying: boolean;
};

const WALK = 13;
const CLIMB = 9;
const NAMES = [
  "Vance", "Okoro", "Ilya", "Marisol", "Tamsin", "Reyes", "Koa", "Imani", "Bram", "Sol",
  "Nadia", "Petra", "Juno", "Hale", "Oren", "Linh", "Ash", "Kestrel", "Dara", "Quill",
];

export type CrewSize = { welders: number; riggers: number; researchers: number };

/** How many of each the Operations floor shows for the global tech owned:
 * more hands as the network grows (cosmetic only). */
export function crewSize(unlockedNodes: number, chambers: number): CrewSize {
  return {
    welders: 2 + Math.min(3, Math.floor(unlockedNodes / 4)),
    riggers: 1 + Math.min(2, Math.floor(unlockedNodes / 6)),
    researchers: 1 + Math.min(4, chambers),
  };
}

export class OperationsCrew {
  readonly members: CrewMember[] = [];
  private readonly rng: () => number;
  private chambers = 1;

  constructor(seed = 0x0b5ca7e) {
    this.rng = random(seed);
  }

  /** Grows or shrinks the crew to `size`, keeping whoever is already there. */
  staff(size: CrewSize, chambers: number): void {
    this.chambers = Math.max(1, Math.min(CHAMBER_SLOTS, chambers));
    const want: CrewRole[] = [
      ...Array<CrewRole>(size.welders).fill("welder"),
      ...Array<CrewRole>(size.riggers).fill("rigger"),
      ...Array<CrewRole>(size.researchers).fill("researcher"),
    ];
    const kept: CrewMember[] = [];
    const pool = [...this.members];
    for (const role of want) {
      const at = pool.findIndex((m) => m.role === role);
      kept.push(at >= 0 ? pool.splice(at, 1)[0] : this.hire(role, kept.length + this.members.length));
    }
    this.members.length = 0;
    this.members.push(...kept);
  }

  private hire(role: CrewRole, n: number): CrewMember {
    const lab = role === "researcher";
    const x = lab
      ? LAB.x0 + 6 + Math.floor(this.rng() * (LAB.x1 - LAB.x0 - 12))
      : BAY.x0 + 46 + Math.floor(this.rng() * (BAY.x1 - BAY.x0 - 52));
    const used = new Set(this.members.map((m) => m.id));
    let id = n;
    while (used.has(id)) id++;
    const m: CrewMember = {
      id,
      name: NAMES[id % NAMES.length] + (id >= NAMES.length ? ` ${Math.floor(id / NAMES.length) + 1}` : ""),
      role,
      x,
      y: levelY(0),
      level: 0,
      facing: this.rng() < 0.5 ? -1 : 1,
      goal: { x, level: 0, duty: "rest", face: 1 },
      phase: "work",
      timer: this.rng() * 1.5,
      stride: 0,
      carrying: false,
    };
    return m;
  }

  step(dt: number): void {
    for (const m of this.members) this.move(m, dt);
  }

  private move(m: CrewMember, dt: number): void {
    if (m.phase === "work") {
      m.timer -= dt;
      if (m.timer <= 0) this.nextDuty(m);
      return;
    }
    const g = m.goal;
    if (m.level !== g.level) {
      // Off to the ladder first, then up or down it a level at a time.
      if (Math.abs(m.x - LADDER_X) > 0.5) {
        this.walkTo(m, LADDER_X, dt);
        return;
      }
      m.x = LADDER_X;
      m.phase = "climb";
      const next = m.level + Math.sign(g.level - m.level);
      const ty = levelY(next);
      const dy = ty - m.y;
      const stepY = CLIMB * dt;
      if (Math.abs(dy) <= stepY) {
        m.y = ty;
        m.level = next;
        m.phase = "walk";
      } else {
        m.y += Math.sign(dy) * stepY;
        m.stride += dt * 8;
      }
      return;
    }
    m.phase = "walk";
    if (Math.abs(m.x - g.x) > 0.5) {
      this.walkTo(m, g.x, dt);
      return;
    }
    m.x = g.x;
    m.facing = g.face;
    m.phase = "work";
    if (g.duty === "fetch") m.carrying = true;
    if (g.duty === "haul") m.carrying = false;
    m.timer = this.dutyTime(g.duty);
  }

  private walkTo(m: CrewMember, x: number, dt: number) {
    const dx = x - m.x;
    const s = WALK * dt;
    m.facing = dx < 0 ? -1 : 1;
    m.x = Math.abs(dx) <= s ? x : m.x + Math.sign(dx) * s;
    m.stride += dt * 9;
    m.phase = "walk";
  }

  private dutyTime(duty: Duty): number {
    const r = this.rng();
    switch (duty) {
      case "weld": return 3 + r * 4;
      case "scan": return 3 + r * 5;
      case "gaze": return 2 + r * 3;
      case "fetch":
      case "haul": return 0.8 + r * 0.8;
      default: return 1 + r * 2;
    }
  }

  private nextDuty(m: CrewMember): void {
    const r = this.rng;
    let goal: CrewMember["goal"];
    if (m.role === "welder") {
      // Weld from a scaffold deck (facing the prototype) or the floor round it.
      const spot = Math.floor(r() * 4);
      if (spot < 2) {
        const deck = DECKS[spot];
        goal = { x: deck.x1 - 1 - Math.floor(r() * 3), level: spot + 1, duty: "weld", face: 1 };
      } else if (spot === 2) {
        goal = { x: TURRET.x0 + 2 + Math.floor(r() * 3), level: 0, duty: "weld", face: 1 };
      } else {
        goal = { x: TURRET.x1 - 2 - Math.floor(r() * 3), level: 0, duty: "weld", face: -1 };
      }
    } else if (m.role === "rigger") {
      // Fetch a plate from the crates under the scaffold, haul it to the base.
      goal = m.carrying
        ? { x: TURRET.x0 - 2 - Math.floor(r() * 4), level: 0, duty: "haul", face: 1 }
        : { x: CRATES.x0 + 2 + Math.floor(r() * (CRATES.x1 - CRATES.x0 - 4)), level: 0, duty: "fetch", face: -1 };
    } else {
      const pick = r();
      if (pick < 0.7) {
        const i = Math.floor(r() * this.chambers);
        goal = { x: chamberX(i) + 21, level: 0, duty: "scan", face: 1 };
      } else if (pick < 0.9) {
        goal = { x: WINDOW.x0 + 6 + Math.floor(r() * (WINDOW.x1 - WINDOW.x0 - 12)), level: 0, duty: "gaze", face: r() < 0.5 ? -1 : 1 };
      } else {
        goal = { x: LAB.x0 + 4 + Math.floor(r() * (LAB.x1 - LAB.x0 - 8)), level: 0, duty: "rest", face: r() < 0.5 ? -1 : 1 };
      }
    }
    m.goal = goal;
    m.phase = "walk";
  }

  /** Whether `m` is welding this moment (its arc lights the bay). */
  static welding(m: CrewMember): boolean {
    return m.role === "welder" && m.phase === "work" && m.goal.duty === "weld";
  }
}
