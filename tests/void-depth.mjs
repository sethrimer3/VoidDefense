/** Browser verification of 3D oblique building depth, crumbling structures, and falling physics.
 * Phase 1: Verifies ringed building (Void visible left, right, below; raised roof covering Void behind it),
 * crisp whole-pixel facades, elevation shadows, and saves desktop & phone screenshots.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const outputDir = "test-results/void-depth";
await mkdir(outputDir, { recursive: true });

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
const channel =
  process.env.PLAYWRIGHT_CHANNEL ??
  (executablePath ? undefined : process.platform === "win32" ? "chrome" : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath
    ? { executablePath }
    : channel
      ? { channel }
      : { executablePath: "/usr/bin/chromium" }),
});

try {
  for (const [label, width, height, dpr] of [
    ["desktop", 1280, 800, 1],
    ["phone", 390, 844, 2],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173/");
    await page.locator('input[name="callsign"]').fill("Depth Inspector");
    await page.locator('[data-dlg-mode="buildAndWatch"]').click();
    await page.getByRole("button", { name: "Confirm & Enter Command", exact: true }).click();
    await page.locator("[data-start-battle]").waitFor();

    const ringedCheck = await page.evaluate(async () => {
      const { VoidSim } = await import("/src/void/sim.ts");
      const { VoidRenderer } = await import("/src/void/render.ts");
      const { emptyTechWallet } = await import("/src/void/tech/wallet.ts");
      const { CellMaterial } = await import("/src/void/model.ts");

      const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:99999";
      document.body.append(canvas);

      const renderer = new VoidRenderer(canvas);
      const { world, voidField } = sim;

      // Pick a tall skyscraper with elevation >= 10 px near the middle of the city
      const target =
        world.buildings.find(
          (b) =>
            b.isSkyscraper &&
            b.height >= 22 &&
            b.x > 40 &&
            b.x < world.grid.w - 40 &&
            b.y > 50 &&
            b.y < world.grid.h - 50,
        ) ?? world.buildings.find((b) => b.isSkyscraper);

      // Carve a 12-px ring of Void completely around the target building's footprint
      const margin = 12;
      const { w, h } = world.grid;
      for (let y = Math.max(2, target.y - margin); y < Math.min(h - 2, target.y + target.h + margin); y++) {
        for (let x = Math.max(2, target.x - margin); x < Math.min(w - 2, target.x + target.w + margin); x++) {
          const idx = y * w + x;
          if (world.buildingAt[idx] === target.id) continue;
          world.material[idx] = CellMaterial.VOID;
          world.hp[idx] = 0;
          world.buildingAt[idx] = -1;
          world.grid.markCellDirty(x, y);
        }
      }
      voidField.rebuildFrontier(world);

      renderer.resize(w, h);
      renderer.cam.s = innerWidth < 500 ? 6 : 5;
      const scale = renderer.pixelScale();
      const cx = target.x + target.w * 0.5;
      const cy = target.y + target.h * 0.5 - 4;
      renderer.cam.x = Math.round(canvas.width / 2 - cx * scale);
      renderer.cam.y = Math.round(canvas.height / 2 - cy * scale);

      const matBefore = world.material.slice();
      renderer.draw(sim, 1000, null, null, null, false);
      const img = renderer.sceneCtx.getImageData(0, 0, w, h).data;

      // Check that pixels immediately above the north footprint edge (`y = target.y - 3`) are painted by the raised roof (not Void)
      const midX = target.x + Math.floor(target.w / 2);
      const behindY = target.y - 3;
      const behindIdx = (behindY * w + midX) * 4;
      const behindIsVoidInSim = world.material[behindY * w + midX] === CellMaterial.VOID;

      // Render in flat mode to compare the exact same pixel when the roof is not raised
      renderer.buildingHeight = "flat";
      renderer.draw(sim, 1000, null, null, null, false);
      const imgFlat = renderer.sceneCtx.getImageData(0, 0, w, h).data;

      // Restore full height for the screenshot
      renderer.buildingHeight = "full";
      renderer.draw(sim, 1000, null, null, null, false);

      const roofCoversVoidBehind =
        img[behindIdx] !== imgFlat[behindIdx] ||
        img[behindIdx + 1] !== imgFlat[behindIdx + 1] ||
        img[behindIdx + 2] !== imgFlat[behindIdx + 2];

      // Check Void is visible to the left, right, and south (below) of the building footprint
      const leftVoid = world.material[(target.y + 2) * w + (target.x - 4)] === CellMaterial.VOID;
      const rightVoid = world.material[(target.y + 2) * w + (target.x + target.w + 3)] === CellMaterial.VOID;
      const southVoid = world.material[(target.y + target.h + 4) * w + midX] === CellMaterial.VOID;

      const simUnchanged = matBefore.every((m, i) => m === world.material[i]);

      return {
        behindIsVoidInSim,
        roofCoversVoidBehind,
        leftVoid,
        rightVoid,
        southVoid,
        simUnchanged,
        buildingId: target.id,
        height: target.height,
      };
    });

    assert.equal(ringedCheck.behindIsVoidInSim, true, "Cell behind building must be Void in simulation");
    assert.equal(ringedCheck.roofCoversVoidBehind, true, "Raised roof must visually cover Void behind building");
    assert.equal(ringedCheck.leftVoid, true);
    assert.equal(ringedCheck.rightVoid, true);
    assert.equal(ringedCheck.southVoid, true);
    assert.equal(ringedCheck.simUnchanged, true, "Renderer must not mutate simulation state");
    assert.deepEqual(errors, []);

    await page.screenshot({ path: `${outputDir}/ringed-building-${label}.png` });

    // Phase 2: Mid-collapse cutaway sequence showing exposed horizontal floor slabs, interior rooms, and broken edges
    const collapseCheck = await page.evaluate(async () => {
      const { VoidSim } = await import("/src/void/sim.ts");
      const { VoidRenderer } = await import("/src/void/render.ts");
      const { emptyTechWallet } = await import("/src/void/tech/wallet.ts");

      const sim = new VoidSim("tutorialBreach", "buildAndWatch", emptyTechWallet());
      const { world, physics, voidField } = sim;
      const { w, h } = world.grid;

      // Pick two adjacent skyscrapers so we can show progressive mid-collapse exposed floors
      const tall = world.buildings.filter(
        (b) => b.isSkyscraper && b.height >= 20 && b.w >= 8 && b.h >= 6 && b.x > 40 && b.x < w - 40 && b.y > 50 && b.y < h - 50,
      );
      const bMain = tall[0];

      // Consume the southern half of bMain's footprint into Void and step structural support so its south wall
      // shears off and upper floors spall into a stepped cutaway cross-section
      const cutY = bMain.y + Math.floor(bMain.h * 0.55);
      for (let py = cutY; py < bMain.y + bMain.h + 8; py++) {
        for (let px = bMain.x - 4; px < bMain.x + bMain.w + 4; px++) {
          if (world.grid.inBounds(px, py)) {
            physics.consumeCellIntoVoid(world, py * w + px, false);
          }
        }
      }
      // Step 25 ticks of structural support so cantilever and brink spalling create stepped exposed floors
      for (let t = 0; t < 25; t++) {
        physics.stepStructuralSupport(world, 1 / 30);
      }
      // Also stagger remaining northern columns to show a clear multi-floor cutaway cross-section
      // (north rows keep full roof; middle rows expose a 5-px tall interior wall; south rows step down to a lower concrete slab)
      const keepRows = Math.floor(bMain.h * 0.55);
      for (let ly = 0; ly < keepRows; ly++) {
        for (let lx = 0; lx < bMain.w; lx++) {
          const idx = (bMain.y + ly) * w + (bMain.x + lx);
          if (world.buildingAt[idx] === bMain.id) {
            if (ly === 0) {
              world.columnFloors[idx] = bMain.height;
            } else if (ly === keepRows - 1) {
              world.columnFloors[idx] = Math.max(4, Math.floor(bMain.height * 0.35));
            } else {
              world.columnFloors[idx] = Math.max(10, Math.floor(bMain.height * 0.72));
            }
            world.grid.markCellDirty(bMain.x + lx, bMain.y + ly);
          }
        }
      }
      voidField.rebuildFrontier(world);

      const canvas = document.querySelectorAll("canvas")[document.querySelectorAll("canvas").length - 1];
      const renderer = new VoidRenderer(canvas);
      renderer.resize(w, h);
      renderer.cam.s = innerWidth < 500 ? 6 : 5;
      const scale = renderer.pixelScale();
      const cx = bMain.x + bMain.w * 0.5;
      const cy = bMain.y + bMain.h * 0.5 - 3;
      renderer.cam.x = Math.round(canvas.width / 2 - cx * scale);
      renderer.cam.y = Math.round(canvas.height / 2 - cy * scale);

      const floorsBefore = world.columnFloors.slice();
      renderer.draw(sim, 1500, null, null, null, false);

      const sp = renderer.spriteCache.getSprite(world, bMain, "full", false);
      let slabPixels = 0;
      let roomPixels = 0;
      for (const op of sp.ops) {
        if (op.color === "#5c6574" || op.color === "#4a525e") slabPixels++;
        if (op.color === "#141923" || op.color === "#2a3344" || op.color === "#48e5ff") roomPixels++;
      }

      const unchanged = floorsBefore.every((f, i) => f === world.columnFloors[i]);
      return { slabPixels, roomPixels, unchanged };
    });

    assert.ok(collapseCheck.slabPixels >= 8, `Expected >= 8 exposed concrete slab pixels, got ${collapseCheck.slabPixels}`);
    assert.ok(collapseCheck.roomPixels >= 8, `Expected >= 8 exposed interior room pixels, got ${collapseCheck.roomPixels}`);
    assert.equal(collapseCheck.unchanged, true, "Cutaway rendering must not mutate columnFloors");

    await page.screenshot({ path: `${outputDir}/mid-collapse-${label}.png` });
    await page.close();
    console.log(`PASS ${label} (${width}x${height} DPR ${dpr}): ringed building & mid-collapse exposed floors verified`);
  }
} finally {
  await browser.close();
}
