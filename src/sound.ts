import { stream } from "./random.ts";

/** Shared Web Audio graph and user-gesture unlock for Void Defense.
 * Nothing plays until the player's first press, which is when browsers let
 * a page make sound. */

const rand = stream("effects");
let enabled: () => boolean = () => true;
let pressed = false;
if (typeof document !== "undefined") {
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, () => (pressed = true), { capture: true, once: true });
  }
}

let ctx: AudioContext | null = null;
let out: GainNode;
let hall: GainNode;

/** Which setting turns sound off; checked by audio engines. */
export function soundEnabledBy(isOn: () => boolean) {
  enabled = isOn;
}

/** Whether sound is on now. */
export const soundOn = () => enabled();

/** The shared audio graph once the player has pressed something and sound is on; null until then. */
export function audioGraph(): { ctx: AudioContext; out: GainNode; hall: GainNode } | null {
  if (!pressed || !enabled()) return null;
  const ac = audio();
  return ac ? { ctx: ac, out, hall } : null;
}

function audio(): AudioContext | null {
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(comp);
    const verb = ctx.createConvolver();
    verb.buffer = hallImpulse(ctx);
    hall = ctx.createGain();
    hall.gain.value = 0.28;
    hall.connect(verb);
    verb.connect(out);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function hallImpulse(ac: AudioContext): AudioBuffer {
  const len = Math.floor(ac.sampleRate * 1.6);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.6 - 0.5 * t;
      lp += k * (rand() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  return buf;
}
