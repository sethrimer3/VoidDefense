/** Pixel-art black hole sprite (`src/void/black-hole.ts`). */

import assert from "node:assert/strict";
import test from "node:test";
import { paintBlackHolePixels } from "../src/void/black-hole.ts";

const SIDE = 37;
const C = SIDE >> 1;
const alphaOf = (v: number): number => v >>> 24;
const rgbOf = (v: number): [number, number, number] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff];

function paint(energy: number, animTime = 3.2): Uint32Array {
  const out = new Uint32Array(SIDE * SIDE);
  paintBlackHolePixels(out, SIDE, { x: 0, y: 0, coreR: 10, energy, animTime, seed: 4 });
  return out;
}

test("black hole core is lightless and the photon ring closes all the way around", () => {
  const px = paint(0.6);
  assert.deepEqual(rgbOf(px[C * SIDE + C]), [0, 0, 0]);
  assert.equal(alphaOf(px[C * SIDE + C]), 255);
  // Every direction crosses a bright, opaque ring pixel just outside the core (no crescent)
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    let brightest = 0;
    for (let r = 9.6; r <= 11.6; r += 0.25) {
      const x = Math.round(C + Math.cos(a) * r);
      const y = Math.round(C + Math.sin(a) * r);
      const v = px[y * SIDE + x];
      if (alphaOf(v) === 255) brightest = Math.max(brightest, Math.max(...rgbOf(v)));
    }
    assert.ok(brightest >= 180, `ring is lit at angle ${a.toFixed(2)} (max channel ${brightest})`);
  }
  // Nothing is drawn far outside the hole
  assert.equal(px[0], 0);
});

test("black hole gauge lights more dots as the Void has more energy, and the sprite is deterministic", () => {
  const litCount = (px: Uint32Array): number => {
    let n = 0;
    for (const v of px) {
      const [r, g, b] = rgbOf(v);
      if (r === 150 && g === 128 && b === 206) n++;
    }
    return n;
  };
  const full = litCount(paint(1));
  const half = litCount(paint(0.5));
  assert.ok(full > half && half > 0, `gauge shows remaining energy (${full} > ${half})`);
  assert.deepEqual(Array.from(paint(0.5, 7.7)), Array.from(paint(0.5, 7.7)));
});
