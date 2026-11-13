/** Native-cell art, non-antialiased primitives, integer zoom and camera regression. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
await mkdir('test-results/void-crisp', { recursive: true });
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (executablePath ? undefined : (process.platform === 'win32' ? 'chrome' : undefined));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : channel ? { channel } : { executablePath: '/usr/bin/chromium' }),
});
try {
  for (const [width, height, dpr] of [[1280, 900, 1], [390, 844, 2]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
    await page.locator('input[name="callsign"]').fill('Crisp Inspector');
    await page.locator('[data-dlg-mode="buildAndWatch"]').click();
    await page.getByRole('button', { name: 'Confirm & Enter Command', exact: true }).click();
    await page.locator('[data-start-battle]').waitFor();
    await page.screenshot({ path: `test-results/void-crisp/city-${width}.png` });
    const result = await page.evaluate(async () => {
      const { pixelPainter } = await import('/src/void/pixel-painter.ts');
      const { VoidRenderer } = await import('/src/void/render.ts');
      const { VoidSim } = await import('/src/void/sim.ts');
      const { emptyTechWallet } = await import('/src/void/tech/wallet.ts');
      const { CellMaterial } = await import('/src/void/model.ts');
      const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
      const raw = sample.getContext('2d'); const pen = pixelPainter(raw);
      pen.fillStyle = '#ff0000'; pen.fillRect(1.25, 1.25, 0.4, 0.4);
      pen.strokeStyle = '#ff0000'; pen.lineWidth = 0.25;
      pen.beginPath(); pen.moveTo(3.3, 2.8); pen.lineTo(15.8, 11.2); pen.stroke();
      pen.beginPath(); pen.arc(24.3, 23.8, 7.4, 0, Math.PI * 2); pen.stroke();
      pen.save(); pen.translate(44.2, 40.7); pen.rotate(0.47);
      pen.beginPath(); pen.ellipse(0, 0, 9.2, 4.6, 0, 0, Math.PI * 2); pen.fill(); pen.restore();
      const mask = raw.getImageData(0, 0, 64, 64).data;
      let opaque = 0, partial = 0;
      for (let i = 3; i < mask.length; i += 4) {
        if (mask[i] === 255) opaque++;
        else if (mask[i] !== 0) partial++;
      }
      const sim = new VoidSim('tutorialBreach', 'buildAndWatch', emptyTechWallet());
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';
      document.body.append(canvas);
      const renderer = new VoidRenderer(canvas);
      renderer.cam.s = 3.7;
      renderer.draw(sim, 1000, null, null, null, false);
      renderer.panBy(0.35, 0.65, sim.world.grid.w, sim.world.grid.h);
      renderer.draw(sim, 1000, null, null, null, false);
      await new Promise(requestAnimationFrame);
      const a = renderer.toClient(192.5, 256.5), b = renderer.toClient(193.5, 256.5);
      const scale = (b.x - a.x) * canvas.width / canvas.getBoundingClientRect().width;
      const hit = renderer.toCell(a.x, a.y);
      const fractionalPan = !Number.isInteger(renderer.cam.x) || !Number.isInteger(renderer.cam.y);
      // A wall's stripe is one exact palette color, never an average of an old 4×4 stamp.
      sim.world.material.fill(CellMaterial.WALL); sim.world.buildingAt.fill(-1);
      sim.world.hp.fill(255); sim.world.maxHp.fill(255);
      sim.world.buildings.length = 0; sim.world.portals.length = 0;
      sim.world.grid.markAllDirty(); sim.voidField.rebuildFrontier(sim.world);
      renderer.draw(sim, 1000, null, null, null, false);
      const wall = Array.from(renderer.tctx.getImageData(192, 255, 1, 1).data);
      return { opaque, partial, tinyPixel: mask[(1 * 64 + 1) * 4 + 3], scale,
        hit: [hit.cx, hit.cy], fractionalPan, wall, filter: renderer.sceneCtx.filter };
    });
    assert.ok(result.opaque > 100);
    assert.equal(result.partial, 0, 'opaque rectangles, lines, rotated ellipses and circles must have no antialiased fringe');
    assert.equal(result.tinyPixel, 255, 'small objects must occupy a full world pixel');
    assert.ok(Math.abs(result.scale - Math.round(result.scale)) < 1e-8);
    assert.equal(result.fractionalPan, false);
    assert.deepEqual(result.hit, [192, 256]);
    assert.deepEqual(result.wall, [90, 107, 130, 255]);
    assert.equal(result.filter, 'none');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px DPR ${dpr}: native palette, hard edges, zoom, pan and input`);
  }
} finally { await browser.close(); }
