import { random } from "./random.ts";

/** Shared Web Audio bus graph and user-gesture unlock for Void Defense.
 *
 * Bus topology:
 *   sfxBus      ──────────────────────┐
 *   ambienceBus → ambienceDuck ───────┤
 *   musicBus    → musicDuck    ───────┼─→ master → focusGate → compressor → destination
 *   darkVerb    → darkConvolver ──────┤
 *   roomVerb    → roomConvolver ──────┘
 *
 * Nothing plays until the player's first press (pointerdown / keydown / touchend),
 * which is when browsers (including iOS Safari) allow a page to make sound.
 * Uses a private deterministic RNG so audio initialization never touches shared
 * `"game"` or `"effects"` streams. */

const audioRand = random(0x501d0001);

let enabled: () => boolean = () => true;
let pressed = false;

function markGesture(): void {
  pressed = true;
  if (ctx && enabled()) {
    const state = ctx.state as string;
    if (state === "suspended" || state === "interrupted") {
      void ctx.resume().catch(() => {});
    }
  }
}

if (typeof document !== "undefined") {
  for (const type of ["pointerdown", "keydown", "touchend"] as const) {
    document.addEventListener(type, markGesture, { capture: true, passive: true });
  }
}

export interface SharedAudioGraph {
  ctx: AudioContext;
  /** Legacy alias for `master`. */
  out: GainNode;
  /** Legacy alias for `darkVerb`. */
  hall: GainNode;
  master: GainNode;
  sfxBus: GainNode;
  ambienceBus: GainNode;
  musicBus: GainNode;
  darkVerb: GainNode;
  roomVerb: GainNode;
  /** Smoothly ducks ambience and music by `depthDb` (negative, e.g. -4) for big impacts. */
  duck: (depthDb: number, attackSec?: number, releaseSec?: number) => void;
}

let ctx: AudioContext | null = null;
let focusGate: GainNode;
let master: GainNode;
let sfxBus: GainNode;
let ambienceBus: GainNode;
let musicBus: GainNode;
let ambienceDuck: GainNode;
let musicDuck: GainNode;
let darkVerb: GainNode;
let roomVerb: GainNode;
let graphObj: SharedAudioGraph | null = null;

let volMaster = 0.8;
let volSfx = 0.85;
let volAmbience = 0.65;
let volMusic = 0.5;
let focusMuted = false;

/** Which setting turns sound off; checked by audio engines. */
export function soundEnabledBy(isOn: () => boolean): void {
  enabled = isOn;
}

/** Whether sound is on now. */
export const soundOn = (): boolean => enabled();

/** Sets master and sub-bus volume sliders (`0..1`). */
export function setBusVolumes(
  masterLevel: number,
  sfxLevel: number,
  ambienceLevel: number,
  musicLevel: number,
): void {
  volMaster = Math.max(0, Math.min(1, masterLevel));
  volSfx = Math.max(0, Math.min(1, sfxLevel));
  volAmbience = Math.max(0, Math.min(1, ambienceLevel));
  volMusic = Math.max(0, Math.min(1, musicLevel));
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  master.gain.setTargetAtTime(volMaster * 0.72, now, 0.04);
  sfxBus.gain.setTargetAtTime(volSfx, now, 0.04);
  ambienceBus.gain.setTargetAtTime(volAmbience, now, 0.06);
  musicBus.gain.setTargetAtTime(volMusic, now, 0.06);
}

/** Mutes/suspends or resumes the shared Web Audio context on focus changes. */
export function syncAudioFocus(muted: boolean): void {
  focusMuted = muted;
  if (!ctx || !focusGate) return;
  const now = ctx.currentTime;
  if (muted) {
    focusGate.gain.setTargetAtTime(0, now, 0.025);
    if (ctx.state === "running") void ctx.suspend().catch(() => {});
  } else {
    const state = ctx.state as string;
    if ((state === "suspended" || state === "interrupted") && enabled()) {
      void ctx.resume().catch(() => {});
    }
    focusGate.gain.setTargetAtTime(1, now, 0.03);
  }
}

/** The shared audio graph once the player has pressed something and sound is on; null until then. */
export function audioGraph(): SharedAudioGraph | null {
  if (!pressed || !enabled()) return null;
  const ac = ensureAudio();
  return ac ? graphObj : null;
}

function duckBuses(depthDb: number, attackSec = 0.03, releaseSec = 0.85): void {
  if (!ctx || !ambienceDuck || !musicDuck) return;
  const now = ctx.currentTime;
  const lin = Math.max(0.25, Math.min(1, Math.pow(10, depthDb / 20)));
  for (const node of [ambienceDuck, musicDuck]) {
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(lin, now, Math.max(0.01, attackSec));
    node.gain.setTargetAtTime(1, now + Math.max(0.04, attackSec * 2.2), Math.max(0.15, releaseSec));
  }
}

function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const now = ctx.currentTime;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-16, now);
    comp.knee.setValueAtTime(12, now);
    comp.ratio.setValueAtTime(4, now);
    comp.attack.setValueAtTime(0.005, now);
    comp.release.setValueAtTime(0.18, now);
    comp.connect(ctx.destination);

    focusGate = ctx.createGain();
    focusGate.gain.setValueAtTime(focusMuted ? 0 : 1, now);
    focusGate.connect(comp);

    master = ctx.createGain();
    master.gain.setValueAtTime(volMaster * 0.72, now);
    master.connect(focusGate);

    sfxBus = ctx.createGain();
    sfxBus.gain.setValueAtTime(volSfx, now);
    sfxBus.connect(master);

    ambienceDuck = ctx.createGain();
    ambienceDuck.gain.setValueAtTime(1, now);
    ambienceDuck.connect(master);

    ambienceBus = ctx.createGain();
    ambienceBus.gain.setValueAtTime(volAmbience, now);
    ambienceBus.connect(ambienceDuck);

    musicDuck = ctx.createGain();
    musicDuck.gain.setValueAtTime(1, now);
    musicDuck.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(volMusic, now);
    musicBus.connect(musicDuck);

    // Long, dark, distant reverb for Void rumble, earthquakes, collapses, and strikes
    const darkConv = ctx.createConvolver();
    darkConv.buffer = buildImpulse(ctx, 3.2, 2.8, 0.35, 0.08);
    darkVerb = ctx.createGain();
    darkVerb.gain.setValueAtTime(0.42, now);
    darkVerb.connect(darkConv);
    darkConv.connect(master);

    // Short, warm room reverb for close SFX and tower shots
    const roomConv = ctx.createConvolver();
    roomConv.buffer = buildImpulse(ctx, 0.65, 3.6, 0.68, 0.25);
    roomVerb = ctx.createGain();
    roomVerb.gain.setValueAtTime(0.22, now);
    roomVerb.connect(roomConv);
    roomConv.connect(master);

    graphObj = {
      ctx,
      out: master,
      hall: darkVerb,
      master,
      sfxBus,
      ambienceBus,
      musicBus,
      darkVerb,
      roomVerb,
      duck: duckBuses,
    };
  }
  const state = ctx.state as string;
  if ((state === "suspended" || state === "interrupted") && !focusMuted) {
    void ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Synthesizes a decorrelated stereo impulse response using the private audio RNG. */
function buildImpulse(
  ac: AudioContext,
  durationSec: number,
  decayExp: number,
  startDamp: number,
  endDamp: number,
): AudioBuffer {
  const len = Math.max(1, Math.floor(ac.sampleRate * durationSec));
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = startDamp + (endDamp - startDamp) * t;
      lp += k * (audioRand() * 2 - 1 - lp);
      // Soft onset ramp over first 18 ms avoids a metallic pre-delay slap
      const onset = Math.min(1, i / (ac.sampleRate * 0.018));
      d[i] = lp * onset * Math.pow(1 - t, decayExp);
    }
  }
  return buf;
}
