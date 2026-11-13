/** Accounting invariants, prerequisite DAG validation, purchases, and
 * full-refund cascades for Void Defense's global technology network.
 * Adapted from `src/campaign/levels.ts` and `src/ambush-upgrades.ts`. */

import type { PlayStyleMode, ScenarioId, StrikeId, TowerTypeId } from "../model.ts";
import { TECH_BY_ID, TECH_NODES, type TechNodeDef } from "./catalog.ts";

export type SparksTier = 0 | 1 | 2 | 3;

export type ModeRecord = {
  bestPreserved: number; // 0..100
  bestTier: SparksTier;
  attempts: number;
  victories: number;
};

export type ScenarioProgress = {
  /** Shared maximum Sparks tier reached in EITHER play style (prevents double-claiming). */
  sparksTier: SparksTier;
  underSiege: ModeRecord;
  buildAndWatch: ModeRecord;
};

export type VoidTechWallet = {
  /** Total lifetime Void Essence earned across all runs (never reduced by refunds). */
  lifetimeEssence: number;
  /** Allocated ranks by tech node ID (`commandCore` is always implicitly rank 1). */
  ranks: Record<string, number>;
  /** Per-scenario milestone & mode ledger. */
  scenarios: Partial<Record<ScenarioId, ScenarioProgress>>;
  /** Endless mode records. */
  endlessBestSeconds: number;
  endlessAttempts: number;
};

export const emptyModeRecord = (): ModeRecord => ({
  bestPreserved: 0,
  bestTier: 0,
  attempts: 0,
  victories: 0,
});

export const emptyScenarioProgress = (): ScenarioProgress => ({
  sparksTier: 0,
  underSiege: emptyModeRecord(),
  buildAndWatch: emptyModeRecord(),
});

export const emptyTechWallet = (): VoidTechWallet => ({
  lifetimeEssence: 0,
  ranks: { commandCore: 1 },
  scenarios: {},
  endlessBestSeconds: 0,
  endlessAttempts: 0,
});

/** Total Sparks of Defiance earned across all scenarios (shared entitlement per map). */
export function totalEarnedSparks(wallet: VoidTechWallet): number {
  let sum = 0;
  for (const s of Object.values(wallet.scenarios)) {
    if (s) sum += s.sparksTier;
  }
  return sum;
}

/** Records a completed run's result and returns the newly earned Sparks delta (0..3).
 * Enforces the Section 2A policy: best survival %, tier badge, and attempts are
 * recorded separately per mode, while each map has ONE shared Sparks entitlement
 * equal to `max(underSiege.bestTier, buildAndWatch.bestTier)`. */
export function recordScenarioResult(
  wallet: VoidTechWallet,
  scenarioId: ScenarioId,
  mode: PlayStyleMode,
  won: boolean,
  preservedPercent: number,
  tier: SparksTier,
  essenceEarned: number,
): { sparksDelta: number; essenceAdded: number } {
  const essenceAdded = Math.max(0, Math.floor(essenceEarned));
  wallet.lifetimeEssence += essenceAdded;

  if (scenarioId === "endless") {
    wallet.endlessAttempts++;
    return { sparksDelta: 0, essenceAdded };
  }

  const prog = (wallet.scenarios[scenarioId] ??= emptyScenarioProgress());
  const rec = mode === "underSiege" ? prog.underSiege : prog.buildAndWatch;
  rec.attempts++;
  if (won) {
    rec.victories++;
    if (preservedPercent > rec.bestPreserved) rec.bestPreserved = preservedPercent;
    if (tier > rec.bestTier) rec.bestTier = tier;
  }
  const newEntitlement = Math.max(prog.sparksTier, prog.underSiege.bestTier, prog.buildAndWatch.bestTier) as SparksTier;
  const sparksDelta = Math.max(0, newEntitlement - prog.sparksTier);
  prog.sparksTier = newEntitlement;

  return { sparksDelta, essenceAdded };
}

/** Logical prerequisite IDs for `node` (visual parent + any secondary `requires`). */
export function prerequisiteIds(node: TechNodeDef): string[] {
  const out: string[] = [];
  if (node.parent) out.push(node.parent);
  if (node.requires) {
    for (const r of node.requires) if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** Secondary cross-link edges `[fromId, toId]` for multi-parent nodes. */
export function secondaryTechEdges(): [string, string][] {
  const edges: [string, string][] = [];
  for (const n of TECH_NODES) {
    if (!n.requires) continue;
    for (const req of n.requires) {
      if (req !== n.parent && TECH_BY_ID.has(req)) edges.push([req, n.id]);
    }
  }
  return edges;
}

/** Validates that `TECH_NODES` forms a cycle-free DAG with known prerequisites. */
export function validateTechCatalog(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Cycle detected involving node '${id}'`);
      return;
    }
    const node = TECH_BY_ID.get(id);
    if (!node) {
      errors.push(`Unknown node '${id}'`);
      return;
    }
    visiting.add(id);
    for (const req of prerequisiteIds(node)) {
      if (!TECH_BY_ID.has(req)) errors.push(`Node '${id}' references missing prerequisite '${req}'`);
      else dfs(req);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const n of TECH_NODES) dfs(n.id);
  return { ok: errors.length === 0, errors };
}

/** Whether a node's logical prerequisites are satisfied under `ranks`. */
export function prerequisitesMet(node: TechNodeDef, ranks: Readonly<Record<string, number>>): boolean {
  if (node.id === "commandCore") return true;
  const reqs = prerequisiteIds(node);
  if (reqs.length === 0) return true;
  const has = (id: string) => (ranks[id] ?? (id === "commandCore" ? 1 : 0)) >= 1;
  return node.requireMode === "any" ? reqs.some(has) : reqs.every(has);
}

/** Total Essence and Sparks currently allocated across all purchased ranks. */
export function allocatedCurrencies(ranks: Readonly<Record<string, number>>): { essence: number; sparks: number } {
  let essence = 0;
  let sparks = 0;
  for (const n of TECH_NODES) {
    const r = Math.max(0, Math.min(n.costs.length, ranks[n.id] ?? 0));
    for (let i = 0; i < r; i++) {
      if (n.currency === "sparks") sparks += n.costs[i];
      else essence += n.costs[i];
    }
  }
  return { essence, sparks };
}

/** Spendable unallocated Void Essence and Sparks of Defiance. */
export function availableCurrencies(wallet: VoidTechWallet): { essence: number; sparks: number } {
  const alloc = allocatedCurrencies(wallet.ranks);
  return {
    essence: Math.max(0, wallet.lifetimeEssence - alloc.essence),
    sparks: Math.max(0, totalEarnedSparks(wallet) - alloc.sparks),
  };
}

/** Purchases the next rank of `nodeId` if prerequisites and funds permit.
 * Forbidden while a combat run is active (`inBattle === true`). */
export function buyTechNode(wallet: VoidTechWallet, nodeId: string, inBattle = false): boolean {
  if (inBattle) return false;
  const node = TECH_BY_ID.get(nodeId);
  if (!node || !prerequisitesMet(node, wallet.ranks)) return false;
  const current = wallet.ranks[nodeId] ?? (nodeId === "commandCore" ? 1 : 0);
  if (current >= node.costs.length) return false;
  const cost = node.costs[current];
  const pool = availableCurrencies(wallet);
  if (node.currency === "sparks" ? cost > pool.sparks : cost > pool.essence) return false;
  wallet.ranks[nodeId] = current + 1;
  return true;
}

/** Refunds `nodeId` down to `targetRank` (default 0). If `targetRank === 0`,
 * automatically cascades and refunds all dependent nodes whose prerequisites
 * would no longer be met, returning 100% of spent Essence and Sparks. */
export function refundTechNode(wallet: VoidTechWallet, nodeId: string, targetRank = 0, inBattle = false): boolean {
  if (inBattle || nodeId === "commandCore") return false;
  const node = TECH_BY_ID.get(nodeId);
  const current = wallet.ranks[nodeId] ?? 0;
  if (!node || targetRank < 0 || targetRank >= current) return false;

  if (targetRank > 0) {
    wallet.ranks[nodeId] = targetRank;
    return true;
  }

  delete wallet.ranks[nodeId];
  // Cascade: repeatedly strip any owned node whose prerequisites are now broken.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of TECH_NODES) {
      if (n.id === "commandCore") continue;
      if ((wallet.ranks[n.id] ?? 0) > 0 && !prerequisitesMet(n, wallet.ranks)) {
        delete wallet.ranks[n.id];
        changed = true;
      }
    }
  }
  return true;
}

/** Full no-fee respec of all Void Essence and Sparks allocations between runs. */
export function respecAllTech(wallet: VoidTechWallet, inBattle = false): boolean {
  if (inBattle) return false;
  wallet.ranks = { commandCore: 1 };
  return true;
}

/** Sanitizes and clamps saved tech ranks against malformed/imported saves:
 * strips unreachable nodes and trims overspent ranks in reverse topological order. */
export function sanitizeTechRanks(rawRanks: unknown, maxEssence: number, maxSparks: number): Record<string, number> {
  const out: Record<string, number> = { commandCore: 1 };
  if (rawRanks && typeof rawRanks === "object") {
    const src = rawRanks as Record<string, unknown>;
    for (const n of TECH_NODES) {
      if (n.id === "commandCore") continue;
      const v = src[n.id];
      if (Number.isInteger(v) && Number(v) > 0) {
        out[n.id] = Math.min(n.costs.length, Number(v));
      }
    }
  }
  // Strip unreachable allocations.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of TECH_NODES) {
      if (n.id !== "commandCore" && (out[n.id] ?? 0) > 0 && !prerequisitesMet(n, out)) {
        delete out[n.id];
        changed = true;
      }
    }
  }
  // Trim overspending from leaves back to root.
  for (const n of [...TECH_NODES].reverse()) {
    if (n.id === "commandCore") continue;
    while ((out[n.id] ?? 0) > 0) {
      const alloc = allocatedCurrencies(out);
      if (alloc.essence <= maxEssence && alloc.sparks <= maxSparks) break;
      out[n.id]--;
      if (out[n.id] <= 0) delete out[n.id];
    }
  }
  // Re-verify prerequisites after trimming.
  changed = true;
  while (changed) {
    changed = false;
    for (const n of TECH_NODES) {
      if (n.id !== "commandCore" && (out[n.id] ?? 0) > 0 && !prerequisitesMet(n, out)) {
        delete out[n.id];
        changed = true;
      }
    }
  }
  return out;
}

/** Evaluates all active global modifiers and unlocked towers/strikes from `ranks`. */
export type EvaluatedTech = {
  unlockedTowers: Set<TowerTypeId>;
  unlockedStrikes: Set<StrikeId>;
  startingSuppliesBonus: number;
  cityIncomeMultiplier: number;
  maxDevelopmentCeiling: number;
  combatSellRefundBonus: number;
  structureCostMultiplier: number;
  matterCannonSpeedMultiplier: number;
  matterCannonDensityMultiplier: number;
  masonSpeedMultiplier: number;
  masonRepairMultiplier: number;
  wallResistanceMultiplier: number;
  strategicMasonry: boolean;
  rifleDamageMultiplier: number;
  rifleRangeMultiplier: number;
  extraSquadSize: number;
  priorityTargeting: boolean;
  tacticalRetreat: boolean;
  shieldRegenMultiplier: number;
  shieldExtraRadius: number;
  landfallRadiusMultiplier: number;
  hearthseedRank: number;
  quarantineDurationBonus: number;
  quarantineRadiusBonus: number;
  siphonCapacityMultiplier: number;
  siphonIntakeCap: number;
  siphonVentReduction: number;
  prismLengthBonus: number;
  prismRedirectCap: number;
  chronoWindowBonus: number;
  chronoBudgetBonus: number;
  chronoRadiusBonus: number;
  echoLureRadiusBonus: number;
  echoTargetCapBonus: number;
  echoBlastDamageMult: number;
  echoBlastRadiusBonus: number;
  echoPersistent: boolean;
  countervoidOutputMult: number;
  countervoidPressureMult: number;
  countervoidLandHpBonus: number;
  lanternRadiusBonus: number;
  lanternHpMultiplier: number;
  lanternSpeedMultiplier: number;
  seamwalkerSegmentRadius: number;
  seamwalkerHoldDuration: number;
  seamwalkerCooldownMultiplier: number;
  unlockedJetpack: boolean;
  strikeCooldownMultiplier: number;
  strikeCostMultiplier: number;
  matterSynthesis: boolean;
  synthesisSpeedMultiplier: number;
  perimeterResonanceBonus: number;
  serpentSpeedMultiplier: number;
  extraMechCount: number;
  mechDamageMultiplier: number;
};

export function evaluateTech(ranks: Readonly<Record<string, number>>): EvaluatedTech {
  const r = (id: string) => ranks[id] ?? 0;
  const unlockedTowers = new Set<TowerTypeId>(["matterCannon", "repairDepot", "infantryBarracks"]);
  const unlockedStrikes = new Set<StrikeId>(["landfall"]);

  for (const n of TECH_NODES) {
    if (r(n.id) > 0) {
      if (n.unlocksTower) unlockedTowers.add(n.unlocksTower);
      if (n.unlocksStrike) unlockedStrikes.add(n.unlocksStrike);
    }
  }

  return {
    unlockedTowers,
    unlockedStrikes,
    startingSuppliesBonus: 35 * r("supplyDrop"),
    cityIncomeMultiplier: 1 + 0.15 * r("civicGrid"),
    maxDevelopmentCeiling: 1.25 + 0.25 * r("verticalArcology"),
    combatSellRefundBonus: 0.08 * r("rapidDeconstruct"),
    structureCostMultiplier: Math.max(0.5, 1 - 0.06 * r("prefabFoundations")),
    matterCannonSpeedMultiplier: 1 + 0.2 * r("matterCannonOutput"),
    matterCannonDensityMultiplier: 1 + 0.2 * r("matterCannonOutput"),
    masonSpeedMultiplier: 1 + 0.18 * r("masonThroughput"),
    masonRepairMultiplier: 1 + 0.25 * r("masonThroughput"),
    wallResistanceMultiplier: 1 + 0.25 * r("ferrocreteWalls"),
    strategicMasonry: r("strategicMasonry") > 0,
    rifleDamageMultiplier: 1 + 0.25 * r("thermalLasers"),
    rifleRangeMultiplier: 1 + 0.15 * r("thermalLasers"),
    extraSquadSize: 2 * r("squadExpansion"),
    priorityTargeting: r("priorityTargeting") > 0,
    tacticalRetreat: r("tacticalRetreat") > 0,
    shieldRegenMultiplier: 1 + 0.25 * r("harmonicShields"),
    shieldExtraRadius: r("harmonicShields"),
    landfallRadiusMultiplier: 1 + 0.25 * r("landfallPayload"),
    hearthseedRank: r("landfallPayload"),
    quarantineDurationBonus: 1.5 * r("quarantineDuration"),
    quarantineRadiusBonus: 2 * r("quarantineRadius"),
    siphonCapacityMultiplier: 1 + 0.4 * r("siphonCapacity"),
    siphonIntakeCap: Math.min(0.4, 0.25 + 0.05 * r("siphonCapacity")),
    siphonVentReduction: 0.75 * r("siphonVenting"),
    prismLengthBonus: 2 * r("prismLength"),
    prismRedirectCap: Math.min(0.45, 0.35 + 0.05 * r("prismRedirect")),
    chronoWindowBonus: 2 * r("chronoWindow"),
    chronoBudgetBonus: 12 * r("chronoBudget"),
    chronoRadiusBonus: 1 * r("chronoRadius"),
    echoLureRadiusBonus: 2 * r("echoSignal"),
    echoTargetCapBonus: 3 * r("echoSignal"),
    echoBlastDamageMult: 1 + 0.5 * r("echoVolatile"),
    echoBlastRadiusBonus: 1.5 * r("echoVolatile"),
    echoPersistent: r("echoPersistent") > 0,
    countervoidOutputMult: 1 + 0.35 * r("countervoidExpansion"),
    countervoidPressureMult: 1 + 0.3 * r("countervoidStrength"),
    countervoidLandHpBonus: 35 * r("countervoidLasting"),
    lanternRadiusBonus: Math.min(1.0, 0.5 * r("lanternEscortRadius")),
    lanternHpMultiplier: 1 + 0.35 * r("lanternSurvivability"),
    lanternSpeedMultiplier: 1 + 0.2 * r("lanternStride"),
    seamwalkerSegmentRadius: Math.min(2, r("seamwalkerWidth")),
    seamwalkerHoldDuration: Math.min(3.2, 2.0 + 0.6 * r("seamwalkerHold")),
    seamwalkerCooldownMultiplier: Math.max(0.55, 1 - 0.18 * r("seamwalkerCadence")),
    unlockedJetpack: r("jetpackInfantry") > 0,
    strikeCooldownMultiplier: Math.max(0.4, 1 - 0.12 * r("orbitalCooldowns")),
    strikeCostMultiplier: Math.max(0.5, 1 - 0.1 * r("strikeCapacitors")),
    matterSynthesis: r("matterSynthesis") > 0,
    synthesisSpeedMultiplier: 1 + 0.2 * r("synthesisEfficiency"),
    perimeterResonanceBonus: r("perimeterResonance") > 0 ? 0.35 : 0,
    serpentSpeedMultiplier: 1 + 0.25 * r("serpentConduits"),
    extraMechCount: r("mechOverdrive") > 0 ? 1 : 0,
    mechDamageMultiplier: 1 + 0.3 * r("mechOverdrive"),
  };
}
