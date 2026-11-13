/** Defensive save model for Void Defense under `voiddefense.v1`.
 * Completely isolated from `towerdefense.v1` so legacy saves are never
 * modified, overwritten, or silently converted. */

import { cleanName, decodeFlag, defaultFlag } from "../profile/model.ts";
import { decodeSettings, defaultSettings, type Settings } from "../settings.ts";
import { VOID_SAVE_KEY, VOID_SAVE_VERSION } from "./config.ts";
import type { PlayStyleMode, ScenarioId, VoidProfile } from "./model.ts";
import {
  emptyTechWallet,
  sanitizeTechRanks,
  totalEarnedSparks,
  type ModeRecord,
  type ScenarioProgress,
  type SparksTier,
  type VoidTechWallet,
} from "./tech/wallet.ts";

const SCENARIO_IDS: readonly ScenarioId[] = [
  "tutorialBreach",
  "edgeAdvance",
  "centralRupture",
  "twinBreaches",
  "delayedCollapse",
  "archipelagoCity",
  "organismEscalation",
  "endless",
];

export type VoidSave = {
  version: number;
  profile?: VoidProfile;
  selectedScenario: ScenarioId;
  wallet: VoidTechWallet;
  settings: Settings;
  /** Resistance Map trails already drawn on for the player (optional; 0 when absent). */
  mapRevealed?: number;
};

export function defaultVoidSave(): VoidSave {
  return {
    version: VOID_SAVE_VERSION,
    selectedScenario: "tutorialBreach",
    wallet: emptyTechWallet(),
    settings: defaultSettings(),
  };
}

const int = (v: unknown, fallback = 0, min = 0, max = 1e9): number =>
  Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback;

const num = (v: unknown, fallback = 0, min = 0, max = 100): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function decodeModeRecord(raw: unknown): ModeRecord {
  if (!raw || typeof raw !== "object") {
    return { bestPreserved: 0, bestTier: 0, attempts: 0, victories: 0 };
  }
  const r = raw as Record<string, unknown>;
  return {
    bestPreserved: num(r.bestPreserved, 0, 0, 100),
    bestTier: int(r.bestTier, 0, 0, 3) as SparksTier,
    attempts: int(r.attempts, 0, 0, 1e8),
    victories: int(r.victories, 0, 0, 1e8),
  };
}

function decodeVoidProfile(raw: unknown): VoidProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const name = cleanName(p.name);
  const flag = decodeFlag(p.flag) ?? defaultFlag();
  const mode: PlayStyleMode = p.mode === "buildAndWatch" ? "buildAndWatch" : "underSiege";
  return name ? { name, flag, mode } : undefined;
}

export function decodeVoidSave(raw: string | null): VoidSave {
  const out = defaultVoidSave();
  let s: any;
  try {
    s = raw ? JSON.parse(raw) : null;
  } catch {
    return out;
  }
  if (!s || typeof s !== "object" || !Number.isInteger(s.version) || s.version > VOID_SAVE_VERSION) {
    return out;
  }
  const profile = decodeVoidProfile(s.profile);
  if (profile) out.profile = profile;
  if (SCENARIO_IDS.includes(s.selectedScenario)) {
    out.selectedScenario = s.selectedScenario;
  }
  out.settings = decodeSettings(s.settings);
  const revealed = int(s.mapRevealed, 0, 0, 64);
  if (revealed > 0) out.mapRevealed = revealed;

  const w = s.wallet;
  if (w && typeof w === "object") {
    out.wallet.lifetimeEssence = int(w.lifetimeEssence, 0, 0, 1e9);
    out.wallet.endlessBestSeconds = num(w.endlessBestSeconds, 0, 0, 1e7);
    out.wallet.endlessAttempts = int(w.endlessAttempts, 0, 0, 1e8);
    if (w.scenarios && typeof w.scenarios === "object") {
      for (const id of SCENARIO_IDS) {
        if (id === "endless") continue;
        const sc = w.scenarios[id];
        if (!sc || typeof sc !== "object") continue;
        const underSiege = decodeModeRecord(sc.underSiege);
        const buildAndWatch = decodeModeRecord(sc.buildAndWatch);
        const sparksTier = Math.max(
          int(sc.sparksTier, 0, 0, 3),
          underSiege.bestTier,
          buildAndWatch.bestTier,
        ) as SparksTier;
        const prog: ScenarioProgress = { sparksTier, underSiege, buildAndWatch };
        out.wallet.scenarios[id] = prog;
      }
    }
    const maxSparks = totalEarnedSparks(out.wallet);
    out.wallet.ranks = sanitizeTechRanks(w.ranks, out.wallet.lifetimeEssence, maxSparks);
  }

  return out;
}

export function loadVoidSave(): VoidSave {
  try {
    const raw = localStorage.getItem(VOID_SAVE_KEY);
    if (raw) return decodeVoidSave(raw);
    const legacyRaw = localStorage.getItem("towerdefense.v1");
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const seeded = defaultVoidSave();
      if (legacy && typeof legacy === "object") {
        if (legacy.settings) seeded.settings = decodeSettings(legacy.settings);
        const profile = decodeVoidProfile(legacy.profile);
        if (profile) seeded.profile = profile;
        return seeded;
      }
    }
  } catch {
    return defaultVoidSave();
  }
  return defaultVoidSave();
}

export function persistVoidSave(save: VoidSave): boolean {
  try {
    localStorage.setItem(VOID_SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
