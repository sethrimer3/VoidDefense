import assert from "node:assert/strict";
import test from "node:test";
import { OperationsCrew, crewSize } from "../src/void/operations/crew.ts";
import { BAY, BULKHEAD, DECKS, LAB, levelY } from "../src/void/operations/geometry.ts";

test("Resistance Ops crew keep to their rooms, stand on floor or decks, and get to work", () => {
  const crew = new OperationsCrew(7);
  crew.staff(crewSize(12, 4), 4);
  const standing = new Set([levelY(0), ...DECKS.map((_, i) => levelY(i + 1))]);
  const did = new Set<string>();
  for (let n = 0; n < 30 * 120; n++) {
    crew.step(1 / 30);
    for (const m of crew.members) {
      if (m.role === "researcher") assert.ok(m.x >= LAB.x0 && m.x < LAB.x1, `${m.name} left the lab at ${m.x}`);
      else assert.ok(m.x >= BAY.x0 && m.x < BULKHEAD.x0, `${m.name} left the bay at ${m.x}`);
      if (m.phase !== "climb") assert.ok(standing.has(m.y), `${m.name} floating at y=${m.y}`);
      if (m.phase === "work") did.add(`${m.role}:${m.goal.duty}`);
      if (m.phase === "work" && m.level > 0) did.add(`${m.role}:deck`);
    }
  }
  for (const duty of ["welder:weld", "rigger:fetch", "rigger:haul", "researcher:scan"]) assert.ok(did.has(duty), duty);
  // Welders reach the scaffold's decks by the ladder.
  assert.ok(did.has("welder:deck"));
});

test("Resistance Ops crew grows with the tech network and keeps who was there", () => {
  const crew = new OperationsCrew(3);
  crew.staff(crewSize(0, 1), 1);
  const first = crew.members.map((m) => m.id);
  crew.staff(crewSize(20, 4), 4);
  assert.ok(crew.members.length > first.length);
  for (const id of first) assert.ok(crew.members.some((m) => m.id === id));
  assert.equal(new Set(crew.members.map((m) => m.id)).size, crew.members.length);
});
