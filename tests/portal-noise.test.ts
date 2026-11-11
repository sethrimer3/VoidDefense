import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalNoiseTile, PORTAL_LAYERS } from '../src/void/portal-noise.ts';

test('portal noise tile is opaque grayscale with bright cores and dark gaps, and stable', () => {
  const d = portalNoiseTile();
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    assert.equal(d[i + 3], 255);
    assert.equal(d[i], d[i + 1]);
    assert.equal(d[i], d[i + 2]);
    lo = Math.min(lo, d[i]);
    hi = Math.max(hi, d[i]);
  }
  assert.ok(lo >= 50, 'the floor is lifted so multiply never crushes to black');
  assert.ok(hi - lo > 120, 'contrast between flame and gap');
  assert.deepEqual(portalNoiseTile(), d);
  assert.equal(PORTAL_LAYERS.length, 3);
});
