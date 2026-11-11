// Preloaded into every Node test process (`--import ./tests/pin-random.ts`)
// before any game module: Math.random becomes a fixed-seed stream, so the
// start-up seeds of the game's random streams (src/random.ts,
// src/void/grid.ts), and anything a test leaves to chance, come out the
// same on every run. A test that wants other randomness passes its own
// stream (`new Game(save, rng)`, `newRun({ seed })`, `withStream`).
//
// Kept free of imports: an import would load before this patch runs.
let n = 0x5eed1e55;
Math.random = () => {
  n = (n + 0x6d2b79f5) >>> 0;
  let t = n;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The streams' start-up seeds, pinned by name, so they never depend on
// which module a test file happens to load first.
(globalThis as { __pinnedSeeds?: Record<string, number> }).__pinnedSeeds = { game: 3887091088, defend: 3182828918 };
