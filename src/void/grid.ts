/** World coordinate math, safe cell indexing, chunk partitioning, and dirty
 * chunk tracking for Void Defense's metropolitan boards (384x512, 512x768, etc.).
 * Reuses deterministic hashing from `src/defend/grid.ts`. */

import { hash, hash01, ORTHO, rng, type Rect } from "../defend/grid.ts";
import { CHUNK_SIZE } from "./config.ts";

export { hash, hash01, ORTHO, rng, type Rect };

export class VoidGrid {
  readonly w: number;
  readonly h: number;
  readonly count: number;
  readonly chunksW: number;
  readonly chunksH: number;
  readonly chunkCount: number;
  /** Dirty flag per chunk (`1` = needs repaint). */
  readonly dirtyChunks: Uint8Array;
  private allDirty = true;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.count = w * h;
    this.chunksW = Math.ceil(w / CHUNK_SIZE);
    this.chunksH = Math.ceil(h / CHUNK_SIZE);
    this.chunkCount = this.chunksW * this.chunksH;
    this.dirtyChunks = new Uint8Array(this.chunkCount).fill(1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  index(x: number, y: number): number {
    return y * this.w + x;
  }

  xOf(i: number): number {
    return i % this.w;
  }

  yOf(i: number): number {
    return (i / this.w) | 0;
  }

  chunkIndexAtCell(x: number, y: number): number {
    const cx = (x / CHUNK_SIZE) | 0;
    const cy = (y / CHUNK_SIZE) | 0;
    return cy * this.chunksW + cx;
  }

  markCellDirty(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    this.dirtyChunks[this.chunkIndexAtCell(x, y)] = 1;
    this.allDirty = true;
  }

  markIndexDirty(i: number): void {
    if (i < 0 || i >= this.count) return;
    const x = i % this.w;
    const y = (i / this.w) | 0;
    this.dirtyChunks[this.chunkIndexAtCell(x, y)] = 1;
    this.allDirty = true;
  }

  markRectDirty(r: Rect): void {
    const x0 = Math.max(0, (r.x / CHUNK_SIZE) | 0);
    const y0 = Math.max(0, (r.y / CHUNK_SIZE) | 0);
    const x1 = Math.min(this.chunksW - 1, ((r.x + r.w) / CHUNK_SIZE) | 0);
    const y1 = Math.min(this.chunksH - 1, ((r.y + r.h) / CHUNK_SIZE) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        this.dirtyChunks[cy * this.chunksW + cx] = 1;
      }
    }
    this.allDirty = true;
  }

  markAllDirty(): void {
    this.dirtyChunks.fill(1);
    this.allDirty = true;
  }

  hasDirtyChunks(): boolean {
    return this.allDirty;
  }

  clearDirtyFlags(): void {
    this.dirtyChunks.fill(0);
    this.allDirty = false;
  }

  rectCells(r: Rect): number[] {
    const out: number[] = [];
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(this.w, r.x + r.w);
    const y1 = Math.min(this.h, r.y + r.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        out.push(y * this.w + x);
      }
    }
    return out;
  }
}
