/** Real-city cutaway gallery and scene-layer regression; requires the Vite server. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
await mkdir('test-results/void-ledge', { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE || '/usr/bin/chromium' });
try {
  for (const [width, height, dpr] of [[1000, 800, 1], [390, 844, 2]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
    await page.locator('input[name="callsign"]').fill('Ledge Inspector');
    await page.locator('[data-dlg-mode="buildAndWatch"]').click();
    await page.getByRole('button', { name: 'Confirm & Enter Command', exact: true }).click();
    await page.locator('[data-start-battle]').waitFor();
    const result = await page.evaluate(async () => {
      const { VoidSim } = await import('/src/void/sim.ts');
      const { VoidRenderer } = await import('/src/void/render.ts');
      const { emptyTechWallet } = await import('/src/void/tech/wallet.ts');
      const { CellMaterial } = await import('/src/void/model.ts');
      const sim = new VoidSim('tutorialBreach', 'buildAndWatch', emptyTechWallet());
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';
      document.body.append(canvas);
      const renderer = new VoidRenderer(canvas);
      const { world } = sim;
      renderer.resize(world.grid.w, world.grid.h);
      renderer.cam.s = innerWidth < 500 ? 6 : 4;
      const scale = renderer.pixelScale(), p = world.portals[0];
      renderer.cam.x = Math.round(canvas.width / 2 - p.x * scale);
      renderer.cam.y = Math.round(canvas.height / 2 - (p.y - 4) * scale);
      const before = world.material.slice(), hp = world.hp.slice();
      renderer.draw(sim, 1000, null, null, null, false);
      const pixels = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;
      let lips = 0, shadows = 0, invalid = 0;
      for (let i = 0; i < world.grid.count; i++) {
        const at = i * 4;
        const lip = pixels[at] === 132 && pixels[at + 1] === 100 && pixels[at + 2] === 67;
        const shadow = pixels[at] === 8 && pixels[at + 1] === 6 && pixels[at + 2] === 15;
        if (lip) lips++;
        if (shadow) shadows++;
        if ((lip || shadow) && world.material[i] !== CellMaterial.VOID) invalid++;
      }
      const sceneBefore = pixels.slice();
      renderer.reduceEffects = true;
      renderer.draw(sim, 1000, null, null, null, false);
      const reduced = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;
      let retained = 0;
      for (let i = 0; i < world.grid.count; i++) {
        const at = i * 4;
        if (sceneBefore[at] === 8 && sceneBefore[at + 1] === 6 && sceneBefore[at + 2] === 15
          && reduced[at] === 8 && reduced[at + 1] === 6 && reduced[at + 2] === 15) retained++;
      }
      return { lips, shadows, retained, invalid,
        unchanged: before.every((m, i) => m === world.material[i] && hp[i] === world.hp[i]) };
    });
    assert.ok(result.lips > 20, 'earth lip must remain visible in front of the nebula');
    assert.ok(result.shadows > 20, 'the exposed face needs a visible undercut');
    assert.ok(result.retained > 20, 'depth must remain visible with reduced effects');
    assert.equal(result.invalid, 0, 'cut faces cannot cover playable ground');
    assert.equal(result.unchanged, true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `test-results/void-ledge/close-${width}.png` });
    await page.close();
    console.log(`PASS ${width}px DPR ${dpr}: exposed strata, underside, clipping, reduced effects and simulation isolation`);
  }
} finally { await browser.close(); }
