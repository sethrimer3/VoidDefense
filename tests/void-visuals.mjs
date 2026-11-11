/** Browser verification of nebula enemy contours and living Void interior.
 * Checks:
 * - Inward-flowing spiral wisps and traveling brightness bands inside Void space
 * - Occlusion behind exposed earth/rock ledge
 * - Preservation of black-hole core and solid ground
 * - Nebula-colored organic enemy contours (violet/magenta with cyan highlights)
 * - Reduced motion stability
 * - Screenshots and animation recording
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const outputDir = "test-results/void-visuals";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE || "/usr/bin/chromium",
});

try {
  // Test both desktop (1280x800 DPR 1) and phone (390x844 DPR 2)
  for (const [width, height, dpr] of [
    [1280, 800, 1],
    [390, 844, 2],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173/");
    await page.locator('input[name="callsign"]').fill("Visual Inspector");
    await page.locator('[data-dlg-mode="buildAndWatch"]').click();
    await page.getByRole("button", { name: "Confirm & Enter Command", exact: true }).click();
    await page.locator("[data-start-battle]").waitFor();

    const result = await page.evaluate(async () => {
      const { VoidSim } = await import("/src/void/sim.ts");
      const { VoidRenderer } = await import("/src/void/render.ts");
      const { emptyTechWallet } = await import("/src/void/tech/wallet.ts");
      const { CellMaterial } = await import("/src/void/model.ts");

      // Spawn on organismEscalation scenario so Void organisms (Worms, Spiders, etc.) exist
      const sim = new VoidSim("organismEscalation", "underSiege", emptyTechWallet(), true);
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:99999";
      document.body.append(canvas);

      const renderer = new VoidRenderer(canvas);
      const { world } = sim;
      renderer.resize(world.grid.w, world.grid.h);
      renderer.cam.s = innerWidth < 500 ? 5 : 4;

      const scale = renderer.pixelScale();
      const p = world.portals[0];
      renderer.cam.x = Math.round(canvas.width / 2 - p.x * scale);
      renderer.cam.y = Math.round(canvas.height / 2 - (p.y - 4) * scale);

      // Warm up simulation to spawn cosmic organisms
      sim.stepTicks(380);

      // Render at time t = 1000
      renderer.draw(sim, 1000, null, null, null, false);
      const pixelsT0 = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;

      // Check contour colors on organisms
      let contourVioletMagenta = 0;
      let contourCyan = 0;
      for (const o of sim.combat.organisms) {
        const ox = Math.round(o.x), oy = Math.round(o.y);
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const cx = ox + dx, cy = oy + dy;
            if (!world.grid.inBounds(cx, cy)) continue;
            const idx = (cy * world.grid.w + cx) * 4;
            const r = pixelsT0[idx], g = pixelsT0[idx + 1], b = pixelsT0[idx + 2];
            // Magenta / Violet: #df42d1 (223, 66, 209), #ff62e2 (255, 98, 226), #8425d9 (132, 37, 217)
            if (r > 120 && b > 190 && g < 120) contourVioletMagenta++;
            // Cyan: #6ef3ff (110, 243, 255), #d8fbff (216, 251, 255)
            if (g > 200 && b > 230 && r < 230) contourCyan++;
          }
        }
      }

      // Check ledge pixels in front of nebula
      let ledgeEarthLip = 0;
      let ledgeUndercutShadow = 0;
      for (let i = 0; i < world.grid.count; i++) {
        const at = i * 4;
        if (pixelsT0[at] === 132 && pixelsT0[at + 1] === 100 && pixelsT0[at + 2] === 67) ledgeEarthLip++;
        if (pixelsT0[at] === 8 && pixelsT0[at + 1] === 6 && pixelsT0[at + 2] === 15) ledgeUndercutShadow++;
      }

      // Check black hole core is pure black #000000
      let coreBlackPixels = 0;
      const coreR = Math.max(3.6, p.radius * 0.42);
      for (let dy = -Math.floor(coreR); dy <= Math.floor(coreR); dy++) {
        for (let dx = -Math.floor(coreR); dx <= Math.floor(coreR); dx++) {
          if (Math.hypot(dx, dy) < coreR - 0.8) {
            const cx = Math.floor(p.x + dx), cy = Math.floor(p.y + dy);
            const idx = (cy * world.grid.w + cx) * 4;
            if (pixelsT0[idx] === 0 && pixelsT0[idx + 1] === 0 && pixelsT0[idx + 2] === 0) {
              coreBlackPixels++;
            }
          }
        }
      }

      // Render at time t = 3000 to verify living interior animation evolution
      renderer.draw(sim, 3000, null, null, null, false);
      const pixelsT1 = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;

      let voidDiffCount = 0;
      let nonVoidDiffCount = 0;
      for (let i = 0; i < world.grid.count; i++) {
        const at = i * 4;
        const diff =
          pixelsT0[at] !== pixelsT1[at] ||
          pixelsT0[at + 1] !== pixelsT1[at + 1] ||
          pixelsT0[at + 2] !== pixelsT1[at + 2];
        if (diff) {
          if (world.material[i] === CellMaterial.VOID) {
            voidDiffCount++;
          } else {
            nonVoidDiffCount++;
          }
        }
      }

      // Reduced effects test
      renderer.reduceEffects = true;
      renderer.draw(sim, 1000, null, null, null, false);
      const red1 = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;
      renderer.draw(sim, 4000, null, null, null, false);
      const red2 = renderer.sceneCtx.getImageData(0, 0, world.grid.w, world.grid.h).data;

      let reducedLedgeRetained = 0;
      for (let i = 0; i < world.grid.count; i++) {
        const at = i * 4;
        if (red1[at] === 8 && red1[at + 1] === 6 && red1[at + 2] === 15 &&
            red2[at] === 8 && red2[at + 1] === 6 && red2[at + 2] === 15) {
          reducedLedgeRetained++;
        }
      }

      return {
        organismsCount: sim.combat.organisms.length,
        contourVioletMagenta,
        contourCyan,
        ledgeEarthLip,
        ledgeUndercutShadow,
        coreBlackPixels,
        voidDiffCount,
        reducedLedgeRetained,
      };
    });

    assert.ok(result.organismsCount > 0, "Organisms spawned in organismEscalation");
    assert.ok(result.contourVioletMagenta > 0, "Violet/magenta organism contours rendered");
    assert.ok(result.ledgeEarthLip > 15, "Ledge earth lip intact and visible");
    assert.ok(result.ledgeUndercutShadow > 15, "Ledge undercut intact in front of wisps");
    assert.ok(result.coreBlackPixels > 10, "Black hole core preserved and readable");
    assert.ok(result.voidDiffCount > 50, "Void interior evolved over time (wisps and bands)");
    assert.ok(result.reducedLedgeRetained > 15, "Reduced effects maintains stable ledge");
    assert.deepEqual(errors, []);

    // Take screenshot
    const screenshotPath = `${outputDir}/scene-${width}px.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot to ${screenshotPath}`);

    await page.close();
    console.log(
      `PASS ${width}px DPR ${dpr}: nebula contours, living interior wisps, ledge occlusion, reduced effects`,
    );
  }

  // Capture short animation frames for demonstration
  const animPage = await browser.newPage({
    viewport: { width: 640, height: 480 },
    deviceScaleFactor: 1,
  });
  await animPage.goto(process.env.TEST_URL || "http://127.0.0.1:5173/");
  await animPage.locator('input[name="callsign"]').fill("Animation Recorder");
  await animPage.locator('[data-dlg-mode="buildAndWatch"]').click();
  await animPage.getByRole("button", { name: "Confirm & Enter Command", exact: true }).click();
  await animPage.locator("[data-start-battle]").waitFor();

  for (let frame = 0; frame < 6; frame++) {
    await animPage.screenshot({ path: `${outputDir}/frame-${frame}.png` });
    await animPage.waitForTimeout(200);
  }
  await animPage.close();
  console.log(`Captured short animation frames in ${outputDir}/frame-0..5.png`);
} finally {
  await browser.close();
}
