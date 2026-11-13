/** Browser QA, Visual Recovery Gallery & Performance Benchmark for Void Defense (`tests/void-defense.mjs`).
 *
 * Verifies:
 * 1. V1–V5 Visual Recovery captures:
 *    - `void-v1-city-overview.png`: Full metropolitan city at default zoom (`1280x800`).
 *    - `void-v2-portal-landfall.png`: Event-horizon portal & Landfall strike island.
 *    - `void-v3-active-battle.png`: Busy active siege with 1x1 riflemen, 1x2 engineers,
 *      Matter Cannons, laser beams, and inward prismatic debris streams.
 *    - `void-v3-closeup-zoom.png`: Close-up (`3.2x` zoom) on the active Void frontier & units.
 *    - `void-v5-reduced-effects.png`: Same scene with Reduce Motion / Reduced Effects enabled.
 *    - `void-battle-portrait.png` (`390x844`) & `void-battle-landscape.png` (`844x390`).
 *    - `void-network-desktop.png`, `void-operations-desktop.png` & `void-map-desktop.png`.
 * 2. Zero HUD currency overlap and strict page visibility isolation (only `.void-page.active` visible).
 * 3. Save isolation (`voiddefense.v1` vs `towerdefense.v1`).
 * 4. Busy siege frame-time benchmark on `384x512` and `512x768` worlds. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const URL = process.env.TEST_URL ?? "http://127.0.0.1:5173/";
const OUT_DIR = path.resolve("test-results");
fs.mkdirSync(OUT_DIR, { recursive: true });

function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (executablePath ? undefined : (process.platform === 'win32' ? 'chrome' : undefined));
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : channel ? { channel } : { executablePath: '/usr/bin/chromium' }),
  });
}

const browser = await launchBrowser();

/** Clicks a HUD control from inside the page. The battle HUD re-renders its buttons every
 * half second of simulation time, so Playwright's own click can keep finding the element
 * detached; a direct `element.click()` lands on whichever button is current. */
async function clickNow(page, selector) {
  const found = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  assert.ok(found, `Expected a control matching ${selector}`);
}

try {
  const viewports = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "portrait", width: 390, height: 844 },
    { name: "landscape", width: 844, height: 390 },
  ];

  const report = {
    timestamp: new Date().toISOString(),
    viewports: {},
    benchmark: {},
  };

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.name === "desktop" ? 1 : 2,
    });
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem(
        "towerdefense.v1",
        JSON.stringify({ marker: "preserve-classic-save", version: 1 }),
      );
      localStorage.setItem(
        "voiddefense.v1",
        JSON.stringify({
          version: 1,
          profile: {
            name: "Cmdr. Vance",
            flag: { shape: "shield", bg: "obsidian", fg: "amber", charge: "star" },
            mode: "underSiege",
          },
          selectedScenario: "centralRupture",
          wallet: {
            lifetimeEssence: 640,
            ranks: {
              commandCore: 1,
              matterCannonOutput: 2,
              masonThroughput: 2,
              rifleSquads: 2,
              unlockShieldProjector: 1,
              unlockRocketTeam: 1,
              unlockGenesis: 1,
            },
            scenarios: {
              tutorialBreach: {
                sparksTier: 3,
                underSiege: { attempts: 2, wins: 2, bestPreserved: 96.4, bestTimeSeconds: 58 },
                buildAndWatch: { attempts: 1, wins: 1, bestPreserved: 94.0, bestTimeSeconds: 61 },
              },
            },
            endlessBestSeconds: 185,
            endlessAttempts: 1,
          },
          settings: {
            soundOff: true,
            magnifier: true,
            reduceMotion: false,
            devMode: true,
          },
        }),
      );
    });

    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#void-board-canvas", { state: "visible", timeout: 15000 });
    await page.waitForTimeout(350);

    // Verify strict page isolation and non-overlapping currency boxes
    const layoutCheck = await page.evaluate(() => {
      const activePages = [...document.querySelectorAll(".void-page")].filter(
        (el) => getComputedStyle(el).display !== "none",
      );
      const currBoxes = [...document.querySelectorAll(".void-curr")].map((el) =>
        el.getBoundingClientRect(),
      );
      let overlaps = false;
      for (let i = 0; i < currBoxes.length; i++) {
        for (let j = i + 1; j < currBoxes.length; j++) {
          const a = currBoxes[i];
          const b = currBoxes[j];
          const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (ix > 2 && iy > 2) overlaps = true;
        }
      }
      return { activePageCount: activePages.length, overlaps };
    });
    assert.equal(layoutCheck.activePageCount, 1, "Only 1 .void-page may be visible at a time");
    assert.equal(layoutCheck.overlaps, false, "Currency boxes must never overlap");

    if (vp.name === "desktop") {
      // V1: Capture clean initial city overview at default zoom
      await page.screenshot({ path: path.join(OUT_DIR, "void-v1-city-overview.png") });
    }

    // Place defenses and cast Landfall inside the Void, then advance battle for active frontier spectacle
    await page.evaluate(() => {
      // Access VoidSim through the canvas / DOM or trigger clicks
    });

    // Click Matter Cannon and place near portal
    const canvasBox = await page.locator("#void-board-canvas").boundingBox();
    assert.ok(canvasBox && canvasBox.width > 100 && canvasBox.height > 100);

    const cx = canvasBox.x + canvasBox.width * 0.5;
    const cy = canvasBox.y + canvasBox.height * 0.5;

    // Place Matter Cannon, Repair Depot, Infantry Barracks, and Rocket Team around the central breach
    const placements = [
      { tower: "matterCannon", dx: -55, dy: -45 },
      { tower: "matterCannon", dx: 55, dy: -45 },
      { tower: "infantryBarracks", dx: -65, dy: 20 },
      { tower: "infantryBarracks", dx: 65, dy: 20 },
      { tower: "repairDepot", dx: -40, dy: 60 },
      { tower: "rocketTeam", dx: 45, dy: 55 },
      { tower: "shieldProjector", dx: 0, dy: -65 },
    ];

    for (const pl of placements) {
      const btn = page.locator(`[data-pick-tower="${pl.tower}"]`);
      if ((await btn.count()) > 0) {
        await clickNow(page, `[data-pick-tower="${pl.tower}"]`);
        await page.mouse.click(cx + pl.dx, cy + pl.dy);
      }
    }

    // Cast Landfall right on the portal edge to create a sacrificial island + shockwave
    await clickNow(page, '[data-pick-strike="landfall"]');
    await page.mouse.click(cx + 12, cy - 10);

    if (vp.name === "desktop") {
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(OUT_DIR, "void-v2-portal-landfall.png") });
    }

    // Set 3x speed and let battle run for 2.2 real seconds (~6.5 sim seconds of intense erosion, debris & fire)
    await clickNow(page, "[data-cycle-speed]");
    await clickNow(page, "[data-cycle-speed]");
    await page.waitForTimeout(2200);

    // Pause so before/after & close-up screenshots capture the exact same active tick
    await clickNow(page, "[data-toggle-pause]");
    await page.waitForTimeout(80);

    await page.screenshot({ path: path.join(OUT_DIR, `void-battle-${vp.name}.png`) });

    if (vp.name === "desktop") {
      await page.screenshot({ path: path.join(OUT_DIR, "void-v3-active-battle.png") });

      // V3 Close-up zoom (wheel zoom in onto the active Void frontier & soldiers)
      await page.mouse.move(cx, cy);
      for (let z = 0; z < 6; z++) {
        await page.mouse.wheel(0, -240);
      }
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(OUT_DIR, "void-v3-closeup-zoom.png") });

      // Zoom back out to default overview
      for (let z = 0; z < 8; z++) {
        await page.mouse.wheel(0, 260);
      }
      await page.waitForTimeout(100);
    }

    // Open Global Tech Network tab
    await page.click('[data-void-tab="network"]');
    await page.waitForTimeout(250);
    const nodeCount = await page.locator(".void-tech-graph button.ug-node").count();
    assert.ok(nodeCount >= 30, `Expected >=30 tech nodes rendered, got ${nodeCount}`);
    await page.screenshot({ path: path.join(OUT_DIR, `void-network-${vp.name}.png`) });

    // Open Resistance Operations tab
    await page.click('[data-void-tab="operations"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, `void-operations-${vp.name}.png`) });

    // Open the Resistance Map tab: one map canvas and a briefing for the frontier sector
    await page.click('[data-void-tab="map"]');
    await page.waitForTimeout(300);
    assert.equal(await page.locator("canvas.void-map-canvas").count(), 1, "Expected the Resistance Map canvas");
    assert.equal(await page.locator('[data-void-tab="map"]').innerText(), "Resistance Map");
    assert.ok(await page.locator("[data-map-deploy]").count() >= 1, "Expected a Deploy button for an open sector");
    await page.screenshot({ path: path.join(OUT_DIR, `void-map-${vp.name}.png`) });

    if (vp.name === "desktop") {
      // V5: Enable Reduce Motion & Ambient Flicker and capture reduced-effects comparison
      await page.click("[data-set-motion]");
      await page.click('[data-void-tab="battle"]');
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, "void-v5-reduced-effects.png") });
    }

    const classicSave = await page.evaluate(() => localStorage.getItem("towerdefense.v1"));
    assert.equal(
      classicSave,
      JSON.stringify({ marker: "preserve-classic-save", version: 1 }),
      "Classic towerdefense.v1 save must remain untouched",
    );

    report.viewports[vp.name] = {
      width: vp.width,
      height: vp.height,
      nodeCount,
      mapCanvases: 1,
      ok: true,
    };

    await context.close();
  }

  // Run busy-siege simulation & rendering benchmark on both 384x512 and 512x768 worlds
  const benchContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const benchPage = await benchContext.newPage();
  await benchPage.goto(URL, { waitUntil: "networkidle" });
  await benchPage.waitForSelector("#void-board-canvas", { state: "visible" });

  const benchResults = await benchPage.evaluate(async () => {
    const { VoidSim } = await import("/src/void/sim.ts");
    const { VoidRenderer } = await import("/src/void/render.ts");
    const { emptyTechWallet } = await import("/src/void/tech/wallet.ts");

    const canvas = document.querySelector("#void-board-canvas");
    const renderer = new VoidRenderer(canvas);
    const results = {};

    for (const scenarioId of ["tutorialBreach", "organismEscalation"]) {
      const wallet = emptyTechWallet();
      const sim = new VoidSim(scenarioId, "underSiege", wallet, true);
      const { w, h } = sim.world.grid;

      let placed = 0;
      for (let y = 20; y < h - 20 && placed < 24; y += 16) {
        for (let x = 16; x < w - 16 && placed < 24; x += 20) {
          const types = [
            "matterCannon",
            "repairDepot",
            "infantryBarracks",
            "rocketTeam",
            "heavyMechBay",
            "wallSerpent",
          ];
          const t = types[placed % types.length];
          if (sim.placeTower(t, x, y)) placed++;
        }
      }

      // Warm up 120 ticks + initial terrain layer bake so Void tendrils, debris streams, projectiles, and units are all active
      sim.stepTicks(120);
      renderer.draw(sim, performance.now(), null, null, null, false);

      const simTimes = [];
      const renderTimes = [];
      for (let f = 0; f < 90; f++) {
        const t0 = performance.now();
        sim.stepTicks(1);
        const t1 = performance.now();
        renderer.draw(sim, t1, null, null, null, false);
        const t2 = performance.now();
        simTimes.push(t1 - t0);
        renderTimes.push(t2 - t1);
      }

      simTimes.sort((a, b) => a - b);
      renderTimes.sort((a, b) => a - b);
      const p50 = (arr) => Number(arr[Math.floor(arr.length * 0.5)].toFixed(2));
      const p95 = (arr) => Number(arr[Math.floor(arr.length * 0.95)].toFixed(2));

      results[scenarioId] = {
        worldSize: `${w}x${h}`,
        buildings: sim.world.buildings.length,
        agents: sim.combat.agents.length,
        debris: sim.physics.debris.length,
        frontierEdges: sim.voidField.totalContactEdges(),
        simP50Ms: p50(simTimes),
        simP95Ms: p95(simTimes),
        renderP50Ms: p50(renderTimes),
        renderP95Ms: p95(renderTimes),
      };
    }
    return results;
  });

  report.benchmark = benchResults;
  await benchContext.close();

  fs.writeFileSync(
    path.join(OUT_DIR, "void-defense-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("Void Defense browser QA & benchmark passed:", JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
