/** World-pixel rendering and input regression. Requires npm run dev. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = 'test-results/void-pixels';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE || '/usr/bin/chromium' });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
    await page.locator('input[name="callsign"]').fill('Pixel Inspector');
    await page.locator('[data-dlg-mode="buildAndWatch"]').click();
    await page.getByRole('button', { name: 'Confirm & Enter Command', exact: true }).click();
    await page.locator('[data-start-battle]').waitFor();
    await page.screenshot({ path: `${output}/city-${viewport.width}.png` });
    const result = await page.evaluate(async () => {
      const { VoidRenderer } = await import('/src/void/render.ts');
      const { VoidSim } = await import('/src/void/sim.ts');
      const { emptyTechWallet } = await import('/src/void/tech/wallet.ts');
      const { CellMaterial } = await import('/src/void/model.ts');
      const sim = new VoidSim('tutorialBreach', 'buildAndWatch', emptyTechWallet());
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';
      document.body.append(canvas);
      const renderer = new VoidRenderer(canvas);
      renderer.reduceEffects = true;
      const { world } = sim;
      world.material.fill(CellMaterial.STREET);
      world.hp.fill(16); world.maxHp.fill(16); world.buildingAt.fill(-1);
      world.buildings.length = 0; world.portals.length = 0;
      sim.voidField.rebuildFrontier(world);
      renderer.draw(sim, 0, null, null, null, false);
      const w = world.grid.w, h = world.grid.h;
      const x = 192, y = 256;
      const i = world.grid.index(x, y);
      const before = renderer.tctx.getImageData(0, 0, w, h).data;
      sim.physics.consumeCellIntoVoid(world, i, false);
      renderer.draw(sim, 0, null, null, null, false);
      const after = renderer.tctx.getImageData(0, 0, w, h).data;
      const changed = [];
      for (let n = 0; n < w * h; n++) {
        if ([0, 1, 2].some(c => before[n * 4 + c] !== after[n * 4 + c])) changed.push(n);
      }
      // Zoom exactly around the cell center, then hit-test its center and neighbor.
      const center = renderer.toClient(x + 0.5, y + 0.5);
      renderer.zoomAt(center.x, center.y, 7, w, h);
      renderer.draw(sim, 0, null, null, null, false);
      const pt = renderer.toClient(x + 0.5, y + 0.5);
      const next = renderer.toClient(x + 1.5, y + 0.5);
      const hit = renderer.toCell(pt.x, pt.y);
      const neighbor = renderer.toCell(next.x, next.y);
      return { changed, i, hit: [hit.cx, hit.cy], neighbor: [neighbor.cx, neighbor.cy],
        terrain: [renderer.terrainLayer.width, renderer.terrainLayer.height],
        scene: [renderer.sceneLayer.width, renderer.sceneLayer.height],
        world: [w, h], fits: renderer.px <= Math.min(canvas.width / w, canvas.height / h) + 0.001,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(result.changed, [result.i], 'one consumed cell must change exactly one terrain raster pixel');
    assert.deepEqual(result.terrain, result.world);
    assert.deepEqual(result.scene, result.world);
    assert.deepEqual(result.hit, [192, 256]);
    assert.deepEqual(result.neighbor, [193, 256]);
    assert.ok(result.fits, 'phone overview must fit the finer grid');
    assert.equal(result.overflow, false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/single-pixel-${viewport.width}.png` });
    await page.close();
    console.log(`PASS ${viewport.width}px: one cell = one raster pixel; independent destruction, zoom and input`);
  }
} finally {
  await browser.close();
}
