/**
 * Generates official high-fidelity Void Defense favicons and game icons.
 * Design:
 * - Gunmetal-steel bevelled outer command border (#ff9e38 / #ffbe3b rivets)
 * - Deep abyssal cosmic singularity (#04020a, deep violet nebula dust)
 * - Concentric & tilted glowing event-horizon rings (magenta #ff38b8, cyan #48e5ff, white/gold #ffd6ff)
 * - Lensed star glints & singularity core
 *
 * Outputs:
 * - public/favicon.ico (multi-res: 16x16, 32x32, 48x48, 64x64)
 * - public/apple-touch-icon.png (180x180)
 * - public/GameIcon-192.png (192x192)
 * - public/GameIcon.png (512x512)
 * - dist/ copies if dist exists
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function buildIco(pngBuffers: { size: number; buffer: Buffer }[]): Buffer {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + count * dirEntrySize;

  let totalSize = dirSize;
  for (const item of pngBuffers) {
    totalSize += item.buffer.length;
  }

  const out = Buffer.alloc(totalSize);

  // ICONDIR header
  out.writeUInt16LE(0, 0); // Reserved
  out.writeUInt16LE(1, 2); // 1 = ICO
  out.writeUInt16LE(count, 4); // image count

  let currentOffset = dirSize;
  for (let i = 0; i < count; i++) {
    const { size, buffer } = pngBuffers[i];
    const entryOffset = headerSize + i * dirEntrySize;

    out.writeUInt8(size >= 256 ? 0 : size, entryOffset + 0); // width
    out.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1); // height
    out.writeUInt8(0, entryOffset + 2); // color palette
    out.writeUInt8(0, entryOffset + 3); // reserved
    out.writeUInt16LE(1, entryOffset + 4); // color planes
    out.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    out.writeUInt32LE(buffer.length, entryOffset + 8); // image size in bytes
    out.writeUInt32LE(currentOffset, entryOffset + 12); // file offset

    buffer.copy(out, currentOffset);
    currentOffset += buffer.length;
  }

  return out;
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();

  // HTML page with a canvas painter that draws the Void Defense singularity emblem
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; background: transparent; overflow: hidden; }
          canvas { display: block; }
        </style>
      </head>
      <body>
        <canvas id="c"></canvas>
        <script>
          function drawVoidIcon(size) {
            const canvas = document.getElementById('c');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);

            const r = size * 0.16; // corner radius
            const w = size, h = size;

            // 1. Base rounded shield plate (dark gunmetal/space)
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.lineTo(w - r, 0);
            ctx.quadraticCurveTo(w, 0, w, r);
            ctx.lineTo(w, h - r);
            ctx.quadraticCurveTo(w, h, w - r, h);
            ctx.lineTo(r, h);
            ctx.quadraticCurveTo(0, h, 0, h - r);
            ctx.lineTo(0, r);
            ctx.quadraticCurveTo(0, 0, r, 0);
            ctx.closePath();

            ctx.fillStyle = '#0a0d14';
            ctx.fill();

            // 2. Inner cosmic deep-space gradient
            const pad = Math.max(1, Math.round(size * 0.05));
            const innerW = w - pad * 2, innerH = h - pad * 2;
            const innerR = Math.max(2, r - pad);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pad + innerR, pad);
            ctx.lineTo(pad + innerW - innerR, pad);
            ctx.quadraticCurveTo(pad + innerW, pad, pad + innerW, pad + innerR);
            ctx.lineTo(pad + innerW, pad + innerH - innerR);
            ctx.quadraticCurveTo(pad + innerW, pad + innerH, pad + innerW - innerR, pad + innerH);
            ctx.lineTo(pad + innerR, pad + innerH);
            ctx.quadraticCurveTo(pad, pad + innerH, pad, pad + innerH - innerR);
            ctx.lineTo(pad, pad + innerR);
            ctx.quadraticCurveTo(pad, pad, pad + innerR, pad);
            ctx.closePath();
            ctx.clip();

            const spaceGrad = ctx.createRadialGradient(
              w * 0.5, h * 0.5, size * 0.05,
              w * 0.5, h * 0.5, size * 0.55
            );
            spaceGrad.addColorStop(0, '#220838');
            spaceGrad.addColorStop(0.4, '#130526');
            spaceGrad.addColorStop(0.75, '#070212');
            spaceGrad.addColorStop(1, '#030108');
            ctx.fillStyle = spaceGrad;
            ctx.fillRect(pad, pad, innerW, innerH);

            // Subtle nebula dust clouds
            const nebGrad = ctx.createRadialGradient(
              w * 0.65, h * 0.35, 0,
              w * 0.65, h * 0.35, size * 0.4
            );
            nebGrad.addColorStop(0, 'rgba(216, 56, 255, 0.28)');
            nebGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = nebGrad;
            ctx.fillRect(pad, pad, innerW, innerH);

            const cyanNeb = ctx.createRadialGradient(
              w * 0.32, h * 0.68, 0,
              w * 0.32, h * 0.68, size * 0.35
            );
            cyanNeb.addColorStop(0, 'rgba(72, 229, 255, 0.22)');
            cyanNeb.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = cyanNeb;
            ctx.fillRect(pad, pad, innerW, innerH);

            // Distant starry background glints
            const stars = [
              [0.25, 0.22, '#48e5ff', 0.8],
              [0.78, 0.24, '#ffffff', 0.9],
              [0.82, 0.72, '#ff80df', 0.85],
              [0.22, 0.78, '#ffd685', 0.75],
              [0.7, 0.84, '#48e5ff', 0.7],
              [0.18, 0.45, '#ffffff', 0.6],
              [0.85, 0.48, '#c84bff', 0.7],
            ];
            for (const [sx, sy, col, a] of stars) {
              const spx = sx * w;
              const spy = sy * h;
              const sRad = Math.max(0.6, size * 0.012);
              ctx.fillStyle = col;
              ctx.globalAlpha = a;
              ctx.fillRect(spx - sRad, spy - sRad, sRad * 2, sRad * 2);
            }
            ctx.globalAlpha = 1;

            // 3. Tilted elliptical accretion disc & chromatic event horizon rings
            const cx = w * 0.5, cy = h * 0.5;

            // Outer cyan glowing accretion halo
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-Math.PI * 0.18);
            ctx.beginPath();
            ctx.ellipse(0, 0, size * 0.38, size * 0.18, 0, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(72, 229, 255, 0.45)';
            ctx.lineWidth = Math.max(1, size * 0.035);
            ctx.stroke();

            // Sizzling magenta/orange main event horizon ring
            ctx.beginPath();
            ctx.ellipse(0, 0, size * 0.34, size * 0.155, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff38b8';
            ctx.lineWidth = Math.max(1.2, size * 0.045);
            ctx.stroke();

            // Inner hot white/amber core stream
            ctx.beginPath();
            ctx.ellipse(0, 0, size * 0.31, size * 0.13, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffd6ff';
            ctx.lineWidth = Math.max(0.8, size * 0.02);
            ctx.stroke();
            ctx.restore();

            // Singular black hole core (abyssal shadow)
            const coreRad = size * 0.165;
            const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRad);
            coreGrad.addColorStop(0, '#000000');
            coreGrad.addColorStop(0.7, '#020005');
            coreGrad.addColorStop(0.9, '#1a052e');
            coreGrad.addColorStop(1, '#ff38b8');
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, coreRad, 0, Math.PI * 2);
            ctx.fill();

            // Inner photon ring
            ctx.beginPath();
            ctx.arc(cx, cy, coreRad * 0.95, 0, Math.PI * 2);
            ctx.strokeStyle = '#7afcff';
            ctx.lineWidth = Math.max(0.8, size * 0.022);
            ctx.stroke();

            // Singularity point (brilliant central quantum flare)
            const flareRad = Math.max(1.5, size * 0.04);
            const flareGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, flareRad);
            flareGrad.addColorStop(0, '#ffffff');
            flareGrad.addColorStop(0.4, '#7afcff');
            flareGrad.addColorStop(1, 'rgba(122, 252, 255, 0)');
            ctx.fillStyle = flareGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, flareRad, 0, Math.PI * 2);
            ctx.fill();

            // Horizontal & vertical lens cross-glints
            ctx.fillStyle = '#ffffff';
            const glintLen = size * 0.18;
            const glintThick = Math.max(0.6, size * 0.015);
            ctx.fillRect(cx - glintLen, cy - glintThick * 0.5, glintLen * 2, glintThick);
            ctx.fillRect(cx - glintThick * 0.5, cy - glintLen, glintThick, glintLen * 2);

            ctx.restore();

            // 4. Command console border (amber-orange metal trim with brass rivets)
            const strokeW = Math.max(1, size * 0.038);
            ctx.beginPath();
            ctx.moveTo(r, strokeW * 0.5);
            ctx.lineTo(w - r, strokeW * 0.5);
            ctx.quadraticCurveTo(w - strokeW * 0.5, strokeW * 0.5, w - strokeW * 0.5, r);
            ctx.lineTo(w - strokeW * 0.5, h - r);
            ctx.quadraticCurveTo(w - strokeW * 0.5, h - strokeW * 0.5, w - r, h - strokeW * 0.5);
            ctx.lineTo(r, h - strokeW * 0.5);
            ctx.quadraticCurveTo(strokeW * 0.5, h - strokeW * 0.5, strokeW * 0.5, h - r);
            ctx.lineTo(strokeW * 0.5, r);
            ctx.quadraticCurveTo(strokeW * 0.5, strokeW * 0.5, r, strokeW * 0.5);
            ctx.closePath();

            ctx.strokeStyle = '#ff9e38';
            ctx.lineWidth = strokeW;
            ctx.stroke();

            // Corner rivets if size >= 32
            if (size >= 32) {
              const rivetR = Math.max(1, size * 0.022);
              const rivetInset = Math.max(3, size * 0.09);
              const rivetPts = [
                [rivetInset, rivetInset],
                [w - rivetInset, rivetInset],
                [rivetInset, h - rivetInset],
                [w - rivetInset, h - rivetInset],
              ];
              for (const [rx, ry] of rivetPts) {
                ctx.fillStyle = '#ffbe3b';
                ctx.beginPath();
                ctx.arc(rx, ry, rivetR, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#2a1a08';
                ctx.fillRect(rx - rivetR * 0.4, ry - rivetR * 0.4, rivetR * 0.8, rivetR * 0.8);
              }
            }
          }
        </script>
      </body>
    </html>
  `);

  async function renderPng(size: number): Promise<Buffer> {
    await page.evaluate((s) => (window as any).drawVoidIcon(s), size);
    const canvas = page.locator("#c");
    return await canvas.screenshot({ type: "png", omitBackground: true });
  }

  // 1. Generate multi-resolution PNGs for favicon.ico (16, 32, 48, 64)
  console.log("Generating ICO sizes...");
  const icoSizes = [16, 32, 48, 64];
  const icoPngs: { size: number; buffer: Buffer }[] = [];
  for (const size of icoSizes) {
    const buffer = await renderPng(size);
    icoPngs.push({ size, buffer });
  }
  const icoBuffer = buildIco(icoPngs);

  // 2. Generate Apple Touch Icon (180x180)
  console.log("Generating Apple touch icon 180x180...");
  const appleTouch = await renderPng(180);

  // 3. Generate PWA Game Icons (192x192 and 512x512)
  console.log("Generating PWA icons (192x192, 512x512)...");
  const gameIcon192 = await renderPng(192);
  const gameIcon512 = await renderPng(512);

  // Write outputs to public/
  const pubDir = path.resolve("public");
  fs.writeFileSync(path.join(pubDir, "favicon.ico"), icoBuffer);
  fs.writeFileSync(path.join(pubDir, "apple-touch-icon.png"), appleTouch);
  fs.writeFileSync(path.join(pubDir, "GameIcon-192.png"), gameIcon192);
  fs.writeFileSync(path.join(pubDir, "GameIcon.png"), gameIcon512);

  // Also sync to dist/ if it exists
  const distDir = path.resolve("dist");
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, "favicon.ico"), icoBuffer);
    fs.writeFileSync(path.join(distDir, "apple-touch-icon.png"), appleTouch);
    fs.writeFileSync(path.join(distDir, "GameIcon-192.png"), gameIcon192);
    fs.writeFileSync(path.join(distDir, "GameIcon.png"), gameIcon512);
  }

  console.log("Void Defense favicons and game icons generated successfully!");
  await browser.close();
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
