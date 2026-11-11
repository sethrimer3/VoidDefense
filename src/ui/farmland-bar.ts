/** Procedural pixel farmland loading bar being consumed by the cosmic void.
 * Pure rendering logic with zero dependencies on retired systems or game random streams.
 */

export const BAR_WIDTH = 160;
export const BAR_HEIGHT = 24;

// Colors
const BORDER_OUTER = "#0b0706";
const BORDER_INNER = "#2c241c";
const BORDER_BRASS = "#8f764a";
const BORDER_HIGHLIGHT = "#cfb376";

// Farmland palette
const SOIL_DARK = "#4a3319";
const SOIL_MID = "#5c4022";
const SOIL_LIGHT = "#6d4d2b";
const CROP_GOLD = "#dfab3c";
const CROP_GOLD_LIGHT = "#f5c85c";
const CROP_GREEN = "#88a838";
const CROP_GREEN_LIGHT = "#a9cb48";
const CROP_DRY = "#bfa054";

// Void palette
const VOID_BLACK = "#050208";
const VOID_DEEP = "#120524";
const VOID_PURPLE = "#491060";
const CONTOUR_VIOLET = "#8425d9";
const CONTOUR_MAGENTA = "#df42d1";
const CONTOUR_CYAN = "#6ef3ff";
const CONTOUR_WHITE_CYAN = "#d8fbff";

/** Simple deterministic hash for procedural grain. */
function hash(x: number, y: number, s: number = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 951214013) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Paints the farmland loading bar being consumed from the left by the void.
 * @param c 2D Canvas context
 * @param progress Fraction of the bar eaten/loaded, from 0.0 to 1.0
 * @param time Animation time in milliseconds
 */
export function paintLoadingBar(c: CanvasRenderingContext2D, progress: number, time: number) {
  const w = BAR_WIDTH;
  const h = BAR_HEIGHT;

  // 1. Clear canvas
  c.clearRect(0, 0, w, h);

  // Outer border & frame
  c.fillStyle = BORDER_OUTER;
  c.fillRect(0, 0, w, h);

  c.fillStyle = BORDER_INNER;
  c.fillRect(1, 1, w - 2, h - 2);

  c.fillStyle = BORDER_BRASS;
  c.fillRect(2, 2, w - 4, 1); // top brass rim
  c.fillRect(2, h - 3, w - 4, 1); // bottom brass rim
  c.fillRect(2, 2, 1, h - 4); // left rim
  c.fillRect(w - 3, 2, 1, h - 4); // right rim

  // Subtle highlight
  c.fillStyle = BORDER_HIGHLIGHT;
  c.fillRect(3, 2, w - 6, 1);

  // Inner playable field bounds: 3 to w - 3 (width = w - 6), 3 to h - 3 (height = h - 6)
  const innerX = 3;
  const innerY = 3;
  const innerW = w - 6;
  const innerH = h - 6;

  // Calculate the void frontier eating from the left
  // At progress = 0: frontier is at the left edge (innerX)
  // At progress = 1: entire farmland is eaten (innerX + innerW)
  const eatX = innerX + progress * innerW;

  // 2. Draw farmland across the entire inner region first
  for (let y = 0; y < innerH; y++) {
    const py = innerY + y;
    // Each row represents crop furrow patterns
    // e.g., 3-row repeating pattern: soil trench, crop stalk, crop highlight
    const rowMod = y % 4;
    const isWheat = y < 9; // Top half golden wheat, bottom half lush green crops

    for (let x = 0; x < innerW; x++) {
      const px = innerX + x;
      const hval = hash(px, py, 11);

      let color = SOIL_MID;
      if (rowMod === 0) {
        // Soil furrow between crop rows
        color = hval > 0.6 ? SOIL_DARK : SOIL_MID;
      } else if (rowMod === 1) {
        // Main crop row
        if (isWheat) {
          color = hval > 0.3 ? CROP_GOLD : CROP_DRY;
        } else {
          color = hval > 0.3 ? CROP_GREEN : CROP_DRY;
        }
      } else if (rowMod === 2) {
        // Crop tips / highlights
        if (isWheat) {
          color = hval > 0.5 ? CROP_GOLD_LIGHT : CROP_GOLD;
        } else {
          color = hval > 0.5 ? CROP_GREEN_LIGHT : CROP_GREEN;
        }
      } else {
        // Root bed / soil transition
        color = hval > 0.5 ? SOIL_LIGHT : SOIL_MID;
      }

      c.fillStyle = color;
      c.fillRect(px, py, 1, 1);
    }
  }

  // 3. Draw Void eating from the left
  // Animate organic noise-like wave at the frontier
  const tSec = time * 0.003;

  for (let y = 0; y < innerH; y++) {
    const py = innerY + y;
    // Jagged organic frontier per row
    const wave1 = Math.sin(y * 0.7 + tSec * 2.5) * 3.2;
    const wave2 = Math.cos(y * 1.4 - tSec * 3.8) * 2.1;
    const noiseOffset = (hash(y, Math.floor(tSec * 4), 99) - 0.5) * 2.5;
    const frontierX = Math.min(innerX + innerW, Math.max(innerX, eatX + wave1 + wave2 + noiseOffset));

    for (let px = innerX; px < frontierX; px++) {
      const distFromFrontier = frontierX - px;
      if (distFromFrontier < 1.4) {
        // Frontier edge: bright cosmic cyan & magenta spark highlights
        const sparkHash = hash(px, py, Math.floor(time * 0.01));
        if (sparkHash > 0.7) {
          c.fillStyle = CONTOUR_WHITE_CYAN;
        } else if (sparkHash > 0.4) {
          c.fillStyle = CONTOUR_CYAN;
        } else {
          c.fillStyle = CONTOUR_MAGENTA;
        }
      } else if (distFromFrontier < 3.2) {
        // Inner nebula rim: vibrant magenta & violet
        const nHash = hash(px, py, 42);
        c.fillStyle = nHash > 0.5 ? CONTOUR_MAGENTA : CONTOUR_VIOLET;
      } else if (distFromFrontier < 7.0) {
        // Deep purple aura
        const nHash = hash(px, py, 17);
        c.fillStyle = nHash > 0.4 ? VOID_PURPLE : VOID_DEEP;
      } else {
        // Consumed void abyss: deep void black with twinkling cosmic stars/sparks
        const starHash = hash(px, py, 77);
        if (starHash > 0.96) {
          const blink = (Math.sin(time * 0.005 + px * 3 + py * 7) + 1) * 0.5;
          c.fillStyle = blink > 0.6 ? CONTOUR_CYAN : CONTOUR_VIOLET;
        } else if (starHash > 0.88) {
          c.fillStyle = VOID_PURPLE;
        } else {
          c.fillStyle = (px + py) % 7 === 0 ? VOID_DEEP : VOID_BLACK;
        }
      }
      c.fillRect(px, py, 1, 1);
    }
  }

  // 4. Floating particles/sparks floating off the eaten farmland edge into the void
  const particleCount = Math.min(12, Math.floor(progress * 14) + 2);
  for (let i = 0; i < particleCount; i++) {
    const seed = i * 1337;
    const phase = ((time * 0.002 + hash(seed, 1)) % 1);
    // Drift from frontier leftwards into the void
    const pX = Math.round(eatX - phase * 18 + hash(seed, 2) * 4);
    const pY = Math.round(innerY + (hash(seed, 3) * (innerH - 2)));
    if (pX >= innerX && pX < eatX && pY >= innerY && pY < innerY + innerH) {
      c.fillStyle = phase < 0.3 ? CROP_GOLD_LIGHT : (phase < 0.6 ? CONTOUR_MAGENTA : CONTOUR_CYAN);
      c.fillRect(pX, pY, 1, 1);
    }
  }
}
