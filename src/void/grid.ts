/** World coordinate math, safe cell indexing, chunk partitioning, and dirty
 * chunk tracking for Void Defense's metropolitan boards (384x512, 512x768, etc.).
 * Deterministic 32-bit integer hashing and seeded PRNG. */

import { CHUNK_SIZE } from "./config.ts";

export type Rect = { x: number; y: number; w: number; h: number };

export const ORTHO: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Stable 32-bit hash of a few integers — used instead of a sequential RNG
 * stream wherever generation should stay put when unrelated parts of the
 * city change. */
export function hash(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** `hash` mapped onto [0, 1). */
export const hash01 = (...n: number[]) => hash(...n) / 4294967296;

/** Small seeded PRNG (mulberry32) for the simulation, where a stream is fine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  /** Marks every chunk overlapping the square of radius `r` cells around cell `i`
   * (used so the Void's corruption band repaints around newly consumed cells). */
  markRadiusDirty(i: number, r: number): void {
    if (i < 0 || i >= this.count) return;
    const x = i % this.w;
    const y = (i / this.w) | 0;
    this.markRectDirty({ x: x - r, y: y - r, w: r * 2 + 1, h: r * 2 + 1 });
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
