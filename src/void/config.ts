/** Central tunable constants for Void Defense.
 * Keeps balance, world dimensions, and economy thresholds in one module rather
 * than scattering magic numbers across simulation and rendering. */

export const VOID_SAVE_KEY = "voiddefense.v1";
export const VOID_SAVE_VERSION = 1;

/** Fixed simulation step rate (30 Hz, matching deterministic replay conventions). */
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

/** One world pixel IS one simulation cell. Each former cell is subdivided 2×2.
 * Camera zoom changes display size only; there is no smaller terrain art grid. */
export const PIXELS_PER_FORMER_CELL = 2;
export const PIXEL_AREA = 1 / (PIXELS_PER_FORMER_CELL ** 2);
/** Convert authored distances/speeds from the former grid into world pixels. */
export const pixels = (formerCells: number): number => formerCells * PIXELS_PER_FORMER_CELL;

/** Same metropolitan footprint, four times as many independently simulated pixels. */
export const DEFAULT_WORLD_W = pixels(192);
export const DEFAULT_WORLD_H = pixels(256);
export const LARGE_WORLD_W = pixels(256);
export const LARGE_WORLD_H = pixels(384);

/** Spatial chunk size in cells for dirty-region terrain & rooftop rendering. */
export const CHUNK_SIZE = 16;

/** Micro-work fixed-point scale so fractional frontier work is conserved
 * deterministically across any perimeter length without floating-point drift. */
export const WORK_SCALE = 1000;
/** Extra fixed-point precision preserves quarter-cell erosion costs exactly. */
export const PIXEL_WORK_SCALE = WORK_SCALE / PIXEL_AREA;

/** Material resistance (micro-work required to erode 1 HP of cell integrity).
 * Unreinforced civilian streets and buildings erode rapidly enough that an unopposed
 * Void visibly devours entire city blocks, whereas Resistance-engineered reclaimed
 * bedrock, ferrocrete walls, and energy barriers absorb 6x to 25x more work per HP. */
export const MATERIAL_RESISTANCE = {
  void: 0,
  unclaimed: 14,
  street: 18,
  park: 15,
  salvage: 22,
  building: 30,
  skyscraper: 45,
  reclaimed: 180,
  wall: 520,
  barrier: 440,
} as const;

/** Void expansion and energy balance.
 * - `infantryAblationEfficiency`: Rifle laser damage pushes back local frontier
 *   accumulated work and newly formed Void cells, but drains the global reservoir
 *   at a low efficiency (12%) and cannot reduce reservoir below `minReservoirFloorFraction`
 *   via ablation alone, preventing cheap terrain/infantry loops from trivially exhausting the Void. */
export const VOID_BALANCE = {
  baseWorkPerSecond: 220,
  rampPerMinute: 140,
  isolatedPocketBurnPerSecond: 120,
  infantryAblationEfficiency: 0.12,
  minReservoirFloorFraction: 0.15,
  nodeSpawnIntervalTicks: 180,
  nodeSpawnEnergyCost: 85,
  nodeErosionBoost: 1.65,
  nodeMaxCount: 16,
} as const;

/** Run-time Supplies & building economy. */
export const SUPPLIES_ECONOMY = {
  startingUnderSiege: 180,
  startingBuildAndWatch: 320,
  passiveTricklePerSec: 3,
  incomeTickInterval: 60, // every 2.0s (60 ticks)
  maxDevelopmentTier: 2.0, // up to 200% development for extra income
  combatSellRefundRate: 0.75,
  prepSellRefundRate: 1.0,
} as const;

/** Post-run scoring & anti-instant-abort participation gate.
 * Failed runs only award Void Essence if the player meaningfully participated:
 * at least `minParticipationSeconds` elapsed OR `minWorkResisted` Void work absorbed
 * AND at least 1 structure/strike action or meaningful defense interaction. */
export const SCORING_RULES = {
  sparksThresholds: [0.0001, 0.5, 0.95] as const, // 1 Spark: >0%, 2 Sparks: >=50%, 3 Sparks: >=95%
  minParticipationSeconds: 20,
  minWorkResisted: 350,
  essencePerWorkResisted: 0.015,
  essencePerPreservedPercentOnWin: 0.45,
  victoryBonusEssence: 18,
  maxLossEssenceShare: 0.65,
} as const;
