import "./style.css";
import "./theme.css";
import "./loading.css";
import { LoadingScreen } from "./ui/loading-screen.ts";
import { within, mayAutoReload } from "./ui/boot-guard.ts";

// Read only the two visual preferences needed before the save module loads.
try {
  const voidSave = JSON.parse(localStorage.getItem("voiddefense.v1") ?? "null");
  const legacySave = JSON.parse(localStorage.getItem("towerdefense.v1") ?? "null");
  const settings = voidSave?.settings ?? legacySave?.settings;
  document.documentElement.classList.toggle("reduce-motion", settings?.reduceMotion === true);
  document.documentElement.classList.toggle("pixel-font", settings?.pixelFont !== false);
} catch { /* Loading the game handles unavailable storage and malformed saves. */ }

/** Fonts are cosmetic: start with fallbacks rather than wait on a stalled font request. */
const FONT_WAIT_MS = 3000;
/** A start this slow offers Try again while it keeps waiting. */
const SLOW_MS = 10_000;
/** A start this slow is stalled: reload once by itself, then leave it to the button. */
const STALL_MS = 25_000;

function session(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

async function boot() {
  const loading = new LoadingScreen(document.querySelector<HTMLElement>("#loading-screen")!,
    () => document.documentElement.classList.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches);
  let started = false;
  const slow = setTimeout(() => { if (!started) loading.slow(); }, SLOW_MS);
  const stall = setTimeout(() => {
    if (started) return;
    console.warn("Game startup stalled");
    if (mayAutoReload(session(), Date.now())) location.reload();
    else loading.fail();
  }, STALL_MS);
  try {
    await within(new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), 200, undefined);
    const voidGame = await import("./void/main.ts");
    await within(document.fonts.ready.then(() => undefined, () => undefined), FONT_WAIT_MS, undefined);
    await loading.complete();
    started = true;
    clearTimeout(slow);
    clearTimeout(stall);
    voidGame.startVoidGame();
  } catch (error) {
    console.error("Game startup failed", error);
    if (started) return;
    started = true;
    clearTimeout(slow);
    clearTimeout(stall);
    if (mayAutoReload(session(), Date.now())) location.reload();
    else loading.fail();
  }
}

void boot();
