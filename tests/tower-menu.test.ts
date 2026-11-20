import test from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_SIZE,
  buildingMenuBox,
  panelSide,
  towerPanelHtml,
  towerRingHtml,
  type TowerMenuTarget,
} from "../src/void/tower-menu.ts";

test("panelSide avoids covering the selected tower", () => {
  const width = 800;
  const w = PANEL_SIZE.desktop;
  assert.equal(panelSide(100, 140, width, w, "right"), "right");
  assert.equal(panelSide(650, 700, width, w, "right"), "left");
  // When both sides would overlap, keep previous side
  assert.equal(panelSide(50, 750, width, w, "left"), "left");
  assert.equal(panelSide(50, 750, width, w, "right"), "right");
});

test("buildingMenuBox centers on target and clamps inside board view", () => {
  const box = buildingMenuBox({ x: 300, y: 240, w: 24, h: 24 }, { w: 800, h: 600 }, 16);
  assert.ok(box.size >= 236);
  assert.ok(box.left >= 8 && box.left + box.size <= 792);
  assert.ok(box.top >= 24 && box.top + box.size <= 592);

  // Near top-left edge: clamped to margin + headroom
  const corner = buildingMenuBox({ x: 0, y: 0, w: 20, h: 20 }, { w: 400, h: 400 }, 16);
  assert.equal(corner.left, 8);
  assert.equal(corner.top, 24);
  assert.equal(corner.bar, 42);
});

test("towerPanelHtml and towerRingHtml render tower and building controls", () => {
  const towerTarget: TowerMenuTarget = {
    kind: "tower",
    tower: {
      uid: 7,
      type: "boundaryPrism",
      x: 100,
      y: 120,
      w: 4,
      h: 4,
      hp: 80,
      maxHp: 100,
      paid: 60,
      level: 1,
      placedAtTick: 0,
      cooldown: 0,
    },
    name: "Boundary Prism",
    level: 1,
    hp: 80,
    maxHp: 100,
    upgCost: 90,
    canUpgrade: true,
    refund: 45,
    canModify: true,
    extraStats: "<span>Plane: <b>45°</b></span>",
    hasRotate: true,
    focusSet: false,
  };

  const panel = towerPanelHtml(towerTarget, false);
  assert.match(panel, /void-building-panel/);
  assert.match(panel, /Boundary Prism/);
  assert.match(panel, /data-vbp="upgrade"/);
  assert.match(panel, /data-vbp="rotate"/);
  assert.match(panel, /data-vbp="focus"/);
  assert.match(panel, /data-vbp="sell"/);

  const ring = towerRingHtml(towerTarget, true);
  assert.match(ring, /void-building-menu placing/);
  assert.match(ring, /vbm-hole/);
  assert.match(ring, /data-vbp="upgrade"/);
  assert.match(ring, /data-vbp="sell"/);

  const bldgTarget: TowerMenuTarget = {
    kind: "building",
    building: {
      id: 3,
      x: 50,
      y: 60,
      w: 12,
      h: 12,
      district: "downtown",
      isSkyscraper: true,
      archStyle: "glassTower",
      roofFeature: "helipad",
      height: 18,
      cells: [],
      baselineValue: 100,
      incomePerCycle: 10,
      lastDamageTick: -1,
    },
    name: "Skyscraper #3",
    height: 18,
    integrityPct: 92,
  };
  const bldgPanel = towerPanelHtml(bldgTarget);
  assert.match(bldgPanel, /Skyscraper #3/);
  assert.match(bldgPanel, /18F/);
  assert.match(bldgPanel, /92%/);
});
