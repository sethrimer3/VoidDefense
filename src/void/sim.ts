/** Fixed-step simulation orchestrator for Void Defense.
 * Coordinates `VoidWorld`, `VoidPhysics`, `VoidField`, `VoidCombatManager`,
 * Supplies economy, and mode rules (`underSiege` vs `buildAndWatch`). */

import { SUPPLIES_ECONOMY, TICK_DT } from "./config.ts";
import { getScenario } from "./maps.ts";
import type {
  PlacedTower,
  PlayStyleMode,
  RunOutcome,
  ScenarioConfig,
  ScenarioId,
  StrikeId,
  TowerTypeId,
  ZeroContactReason,
} from "./model.ts";
import { FarmFires } from "./farms.ts";
import { VoidPhysics } from "./physics.ts";
import { computeCityIncomePerCycle, evaluateRunOutcome } from "./scoring.ts";
import { evaluateTech, type EvaluatedTech, type VoidTechWallet } from "./tech/wallet.ts";
import { STRIKE_SPECS, TOWER_SPECS, VoidCombatManager } from "./towers.ts";
import { VoidField } from "./void-field.ts";
import { VoidWorld } from "./world.ts";

export class VoidSim {
  readonly scenario: ScenarioConfig;
  readonly mode: PlayStyleMode;
  readonly tech: EvaluatedTech;
  readonly world: VoidWorld;
  readonly physics: VoidPhysics;
  readonly farms: FarmFires;
  readonly voidField: VoidField;
  readonly combat: VoidCombatManager;

  /** Current phase:
   * - `prep`: pre-combat placement phase (default start for `buildAndWatch`; optional pause before `underSiege`).
   * - `battle`: active Void expansion and combat.
   * - `won` / `lost`: encounter completed. */
  phase: "prep" | "battle" | "won" | "lost";
  reason: ZeroContactReason = "active";
  supplies: number;
  tick = 0;
  elapsedSeconds = 0;
  speed: 1 | 2 | 3 = 1;
  paused = false;
  playerActionsCount = 0;
  outcome: RunOutcome | null = null;
  private acc = 0;

  constructor(
    scenarioId: ScenarioId,
    mode: PlayStyleMode,
    private readonly wallet: VoidTechWallet,
    private readonly devUnlimited = false,
  ) {
    this.scenario = getScenario(scenarioId);
    this.mode = mode;
    this.tech = evaluateTech(wallet.ranks);
    this.world = new VoidWorld(this.scenario);
    this.physics = new VoidPhysics();
    this.farms = new FarmFires(this.world);
    this.voidField = new VoidField(this.world, this.scenario);
    this.combat = new VoidCombatManager(this.world.grid.count);

    // Under Siege begins directly in active battle; Build & Watch begins in prep phase
    this.phase = mode === "buildAndWatch" ? "prep" : "battle";
    const baseStart =
      mode === "buildAndWatch"
        ? this.scenario.startingSuppliesWatch
        : this.scenario.startingSuppliesSiege;
    this.supplies = baseStart + this.tech.startingSuppliesBonus;
  }

  /** Starts the active battle from `buildAndWatch` prep phase. */
  startBattle(): boolean {
    if (this.phase !== "prep") return false;
    this.phase = "battle";
    return true;
  }

  /** Whether tower placement and selling are currently permitted.
   * - `underSiege`: allowed in both `prep` and `battle`.
   * - `buildAndWatch`: allowed ONLY in `prep` (locked once battle begins). */
  canModifyTowers(): boolean {
    if (this.phase === "won" || this.phase === "lost") return false;
    if (this.mode === "buildAndWatch" && this.phase === "battle") return false;
    return true;
  }

  towerPrice(type: TowerTypeId): number {
    return this.combat.towerPrice(type, this.tech);
  }

  refundAmount(uid: number): number {
    const t = this.combat.towers.find((tw) => tw.uid === uid);
    if (!t) return 0;
    if (this.phase === "prep" || this.tick - t.placedAtTick <= 90) {
      return t.paid;
    }
    const rate = Math.min(1, SUPPLIES_ECONOMY.combatSellRefundRate + this.tech.combatSellRefundBonus);
    return Math.round((t.paid * rate) / 5) * 5;
  }

  placeTower(type: TowerTypeId, x: number, y: number): PlacedTower | null {
    if (!this.canModifyTowers()) return null;
    if (!this.devUnlimited && !this.tech.unlockedTowers.has(type)) return null;
    const price = this.towerPrice(type);
    if (!this.devUnlimited && price > this.supplies) return null;
    const placed = this.combat.placeTower(this.world, type, x, y, price, this.tick, this.tech);
    if (!placed) return null;
    if (!this.devUnlimited) this.supplies -= price;
    this.playerActionsCount++;
    return placed;
  }

  moveTower(uid: number, newX: number, newY: number): boolean {
    // Relocation is pre-battle only (matching Section 2A / AmbushSim.moveTo)
    if (this.phase !== "prep") return false;
    return this.combat.moveTower(this.world, uid, newX, newY);
  }

  sellTower(uid: number): boolean {
    if (!this.canModifyTowers()) return false;
    const refund = this.refundAmount(uid);
    const removed = this.combat.removeTower(this.world, uid);
    if (!removed) return false;
    this.supplies += refund;
    return true;
  }

  setTowerFocus(uid: number, x: number, y: number): boolean {
    const t = this.combat.towers.find((tw) => tw.uid === uid);
    if (!t || !this.world.grid.inBounds(Math.floor(x), Math.floor(y))) return false;
    t.focus = { x, y };
    this.playerActionsCount++;
    return true;
  }

  strikePrice(strike: StrikeId): number {
    return Math.max(10, Math.round((STRIKE_SPECS[strike].supplyCost * this.tech.strikeCostMultiplier) / 5) * 5);
  }

  castStrike(strike: StrikeId, tx: number, ty: number): boolean {
    if (this.phase !== "battle") return false;
    if (!this.devUnlimited && !this.tech.unlockedStrikes.has(strike)) return false;
    const cost = this.strikePrice(strike);
    if (!this.devUnlimited && cost > this.supplies) return false;
    const ok = this.combat.castStrike(
      this.world,
      this.physics,
      this.voidField,
      strike,
      tx,
      ty,
      this.tech,
    );
    if (!ok) return false;
    if (!this.devUnlimited) this.supplies -= cost;
    this.playerActionsCount++;
    return true;
  }

  /** Advances the simulation by `dtSeconds` of foreground frame time.
   * Uses a bounded fixed-step accumulator (max 0.25s per frame) so visual
   * frame rate never changes combat outcome or Void expansion. */
  advanceFrame(dtSeconds: number): void {
    if (this.paused || this.phase !== "battle" || !Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }
    this.acc += Math.min(0.25, dtSeconds) * this.speed;
    while (this.acc >= TICK_DT && this.phase === "battle") {
      this.acc -= TICK_DT;
      this.stepOneTick();
    }
  }

  /** Runs `ticks` deterministic fixed steps directly (for unit tests and fast-forward). */
  stepTicks(ticks: number): void {
    for (let i = 0; i < ticks && this.phase === "battle"; i++) {
      this.stepOneTick();
    }
  }

  stepOneTick(): void {
    if (this.phase !== "battle") return;
    this.tick++;
    this.elapsedSeconds = this.tick * TICK_DT;

    // 1. Periodic Supplies income from surviving & developed civilian buildings (Under Siege mode only)
    if (this.mode === "underSiege" && this.tick % SUPPLIES_ECONOMY.incomeTickInterval === 0) {
      this.supplies += computeCityIncomePerCycle(this.world, this.tech);
    }

    // 2. Step Void field expansion & frontier work distribution
    const allowOrganisms =
      this.scenario.id === "organismEscalation" ||
      this.scenario.id === "endless" ||
      this.elapsedSeconds >= 35;

    const statusReason = this.voidField.step(
      this.world,
      this.physics,
      this.scenario,
      this.tick,
      TICK_DT,
      {
        wallResistanceMultiplier: this.tech.wallResistanceMultiplier,
        perimeterResonanceBonus: this.tech.perimeterResonanceBonus,
        gravityAnchorMask: this.combat.gravityAnchorMask,
        shieldAbsorptionAt: (cIdx, work) =>
          this.combat.absorbWorkWithShields(this.world, cIdx, work, this.tech),
        prisms: this.combat.prismStates.values(),
        siphons: this.combat.siphonStates.values(),
        siphonIntakeCap: this.tech.siphonIntakeCap,
      },
    );

    // 3. Step structural integrity & debris fragments
    this.physics.stepStructuralSupport(this.world, TICK_DT);

    // 3b. Ingest Void-caused cell losses into Chrono Cannon bounded journal
    if (this.physics.recentCellLosses.length > 0) {
      for (let i = 0; i < this.physics.recentCellLosses.length; i++) {
        const loss = this.physics.recentCellLosses[i];
        this.combat.recordChronoLoss(
          this.elapsedSeconds,
          "terrain",
          this.world.grid.xOf(loss.cellIdx) + 0.5,
          this.world.grid.yOf(loss.cellIdx) + 0.5,
          loss.cellIdx,
          loss.material,
          loss.maxHp,
          loss.buildingId,
          loss.columnFloors,
        );
      }
      this.physics.recentCellLosses.length = 0;
    }

    // 3c. Step Seamwalker frozen-Void timers and Countervoid Heart opposing frontier
    const hearts: { x: number; y: number; range: number }[] = [];
    for (let i = 0; i < this.combat.towers.length; i++) {
      const t = this.combat.towers[i];
      if (t.type === "countervoidHeart" && t.hp > 0) {
        hearts.push({ x: t.x, y: t.y, range: TOWER_SPECS.countervoidHeart.range });
      }
    }
    this.voidField.stepCountervoidField(this.world, TICK_DT, hearts, this.tech);

    // 4. Step towers, projectiles, autonomous agents, and cosmic organisms
    this.combat.step(
      this.world,
      this.physics,
      this.voidField,
      this.tick,
      TICK_DT,
      this.tech,
      allowOrganisms,
    );

    this.farms.step(TICK_DT, this.combat.lasers);

    this.reason = statusReason;

    if (statusReason === "cityConsumedDefeat") {
      this.finishRun("lost", statusReason);
    } else if (statusReason === "reservoirDepletedVictory" || statusReason === "voidEradicatedVictory") {
      this.finishRun("won", statusReason);
    }
  }

  /** Ends the current encounter (either automatically on win/loss or by player retreat). */
  finishRun(status: "won" | "lost", reason: ZeroContactReason = this.reason): RunOutcome {
    if (this.outcome) return this.outcome;
    this.phase = status;
    this.reason = reason;
    this.outcome = evaluateRunOutcome(
      this.scenario,
      this.mode,
      status,
      reason,
      this.elapsedSeconds,
      this.world,
      this.voidField.totalWorkResisted,
      this.playerActionsCount,
      this.wallet,
    );
    return this.outcome;
  }
}
