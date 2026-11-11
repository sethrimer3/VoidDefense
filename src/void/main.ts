/** Isolated entrypoint for Void Defense (`src/void/main.ts`).
 *
 * Enforces Section 2A / Phase 1 & 11 requirements:
 * - Never instantiates legacy `MinePage`, `LibraryPage`, `WelcomeBack`, or `away.ts`.
 * - Never settles wall-clock `settleTraining`, `settleForge`, or `settleResearch`.
 * - Saves strictly to `voiddefense.v1`, leaving `towerdefense.v1` intact.
 * - Suspends simulation and resets frame accumulators on `visibilitychange` / `pagehide`
 *   so zero offline accumulation ever happens. */

import "./void.css";
import { fitViewport } from "../ui/viewport.ts";
import { soundEnabledBy } from "../sound.ts";
import { loadVoidSave, persistVoidSave, type VoidSave } from "./save.ts";
import { VoidApp } from "./ui.ts";

let save: VoidSave = loadVoidSave();
let app: VoidApp | null = null;
let rafId = 0;

function store(): void {
  if (!persistVoidSave(save)) {
    console.warn("Storage unavailable — Void Defense progress is only kept for this session.");
  }
}

function loop(now: number): void {
  app?.frame(now);
  rafId = requestAnimationFrame(loop);
}

export function startVoidGame(): void {
  fitViewport();
  soundEnabledBy(() => !save.settings.soundOff);
  const root = document.querySelector<HTMLDivElement>("#app")!;
  cancelAnimationFrame(rafId);
  app = new VoidApp(root, save, store);

  document.addEventListener("visibilitychange", () => app?.resetClockOnVisibility());
  window.addEventListener("pagehide", () => app?.resetClockOnVisibility());
  window.addEventListener("pageshow", () => app?.resetClockOnVisibility());

  rafId = requestAnimationFrame(loop);
}
