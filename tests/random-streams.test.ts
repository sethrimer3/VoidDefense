// Randomness comes from named streams (src/random.ts), one per purpose,
// so drawing from one never shifts another: a visual effect can't change
// the next run's seed, and a new chance-based feature can't reshuffle
// anything else. Math.random only seeds them at start-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { random, stream, withStream } from "../src/random.ts";

const SRC = new URL("../src/", import.meta.url);
function sources(dir: URL, prefix = ""): string[] {
  return readdirSync(dir).flatMap((f) => statSync(new URL(f, dir)).isDirectory()
    ? sources(new URL(`${f}/`, dir), `${prefix}${f}/`)
    : f.endsWith(".ts") ? [`${prefix}${f}`] : []);
}

test("only the streams' start-up seeds call Math.random", () => {
  const calls = sources(SRC).flatMap((file) => readFileSync(new URL(file, SRC), "utf8").split(/\r?\n/)
    .map((line, i) => [line.replace(/\/\/.*$/, ""), i] as const)
    .filter(([code]) => !/^\s*(\/\*|\*)/.test(code) && /Math\.random\(/.test(code))
    .map(([, i]) => `${file}:${i + 1}`));
  assert.deepEqual(calls.map((c) => c.replace(/:\d+$/, "")), ["random.ts"]);
});

test("drawing from one stream leaves the others' sequences alone", () => {
  const game = stream("game"), effects = stream("effects");
  const sequence = (drawEffects: number) => withStream("game", random(7), () => withStream("effects", random(8), () => {
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < drawEffects; k++) effects();
      out.push(game());
    }
    return out;
  }));
  assert.deepEqual(sequence(0), sequence(5));
});
