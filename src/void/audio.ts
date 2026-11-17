/** Procedural cosmic sound engine for Void Defense.
 *
 * Generates an atmospheric sub-bass cosmic rumble with stereo spatialization:
 * - Dual detuned sub-bass sine & triangle drone oscillators (32Hz - 55Hz) with harmonic beating.
 * - Binaural drift LFOs creating a wide, shifting stereo image.
 * - Stereo low-pass resonant filter with cutoff and resonance that open up as the Void expands.
 * - Low-frequency rumble noise through a stereo panner and bandpass filter, simulating
 *   matter crushing, tectonic shearing, and cosmic void gravitational erosion.
 * - Dynamic parameter modulation directly driven by:
 *   1) Void expansion (percentage of original city consumed)
 *   2) Active perimeter contacts / erosion friction
 *   3) Distance to total breach
 */

import { audioGraph, soundOn } from "../sound.ts";
import { stream } from "../random.ts";

export type VoidSfxCue =
  | "uiClick"
  | "uiToggle"
  | "towerPlace"
  | "towerSell"
  | "towerUpgrade"
  | "cannonFire"
  | "shellImpact"
  | "collapse"
  | "voidConsume"
  | "unitDeath"
  | "strikeCast"
  | "victory"
  | "defeat";

const SFX_COOLDOWN_MS: Record<VoidSfxCue, number> = {
  uiClick: 35,
  uiToggle: 35,
  towerPlace: 50,
  towerSell: 50,
  towerUpgrade: 60,
  cannonFire: 75,
  shellImpact: 85,
  collapse: 140,
  voidConsume: 180,
  unitDeath: 110,
  strikeCast: 120,
  victory: 400,
  defeat: 400,
};

export class VoidSoundEngine {
  private active = false;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private volMaster = 0.8;
  private volSfx = 0.85;
  private volAmbience = 0.65;
  private lastSfxAt = new Map<VoidSfxCue, number>();
  private activeVoices = 0;
  private readonly maxVoices = 10;

  // Sub-bass oscillators
  private oscSubL: OscillatorNode | null = null;
  private oscSubR: OscillatorNode | null = null;
  private oscDeep: OscillatorNode | null = null;

  // Stereo filter & stereo panner
  private filterL: BiquadFilterNode | null = null;
  private filterR: BiquadFilterNode | null = null;
  private pannerL: StereoPannerNode | null = null;
  private pannerR: StereoPannerNode | null = null;

  // Granular / tectonic rumble noise generator
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  // Modulation LFO for binaural drift
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  constructor() {}

  /** Starts or updates the continuous synthesized cosmic void soundscape. */
  update(cityPreservedPct: number, contactEdges: number, inBattle: boolean, fallingChunks = 0): void {
    if (!soundOn() || document.hidden || !inBattle) {
      this.fadeQuiet();
      return;
    }

    if (!this.active) {
      this.initGraph();
    }

    if (!this.ctx || !this.masterGain || !this.filterL || !this.filterR || !this.noiseGain) return;

    const now = this.ctx.currentTime;

    // Void takeover metric: 0.0 at 100% city preserved, up to 1.0 at 0% preserved
    const takeover = Math.max(0, Math.min(1, (100 - cityPreservedPct) / 100));

    // Intensity of perimeter shear / grinding and active structural collapse
    const contactNorm = Math.min(1, contactEdges / 1500);
    const chunkNorm = Math.min(1, fallingChunks / 40);

    // Dynamic targets:
    // 1. Master volume grows deeper and fuller as Void engulfs the metropolis
    const ambScale = this.volMaster * this.volAmbience;
    const targetGain = (0.08 + takeover * 0.45 + chunkNorm * 0.08) * ambScale;
    this.masterGain.gain.setTargetAtTime(targetGain, now, 0.4);

    // 2. Filter cutoff opens from a muffled 45Hz sub-hum to a roaring 220Hz stereo roar
    const baseCutoff = 45 + Math.pow(takeover, 1.5) * 175;
    this.filterL.frequency.setTargetAtTime(baseCutoff, now, 0.3);
    this.filterR.frequency.setTargetAtTime(baseCutoff * 1.08, now, 0.3); // slight stereo offset

    // 3. Resonance increases as takeover intensifies
    const qVal = 2.0 + takeover * 4.5;
    this.filterL.Q.setTargetAtTime(qVal, now, 0.5);
    this.filterR.Q.setTargetAtTime(qVal, now, 0.5);

    // 4. Sub-bass frequency subtly shifts lower with mass accumulation (from 42Hz down to 33Hz)
    const subFreq = 44 - takeover * 11;
    if (this.oscSubL && this.oscSubR && this.oscDeep) {
      this.oscSubL.frequency.setTargetAtTime(subFreq, now, 0.5);
      this.oscSubR.frequency.setTargetAtTime(subFreq + 0.75 + takeover * 1.5, now, 0.5); // beating widens stereo
      this.oscDeep.frequency.setTargetAtTime(subFreq * 0.5, now, 0.5); // extreme sub (16Hz - 22Hz)
    }

    // 5. Tectonic rumble noise gain driven by active contact edges, collapse chunks, and overall consumption
    const noiseTarget = 0.02 + contactNorm * 0.2 + takeover * 0.25 + chunkNorm * 0.22;
    this.noiseGain.gain.setTargetAtTime(noiseTarget, now, 0.3);

    if (this.noiseFilter) {
      const noiseCutoff = 80 + contactNorm * 180 + takeover * 200 + chunkNorm * 60;
      this.noiseFilter.frequency.setTargetAtTime(noiseCutoff, now, 0.3);
    }
  }

  private initGraph(): void {
    const graph = audioGraph();
    if (!graph) return;
    const { ctx, out } = graph;
    this.ctx = ctx;

    const now = ctx.currentTime;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.001, now);
    this.masterGain.connect(out);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.setValueAtTime(this.volMaster * this.volSfx, now);
    this.sfxGain.connect(out);

    // Left Sub-Bass Oscillator (Sine for deep body)
    this.oscSubL = ctx.createOscillator();
    this.oscSubL.type = "sine";
    this.oscSubL.frequency.setValueAtTime(42, now);

    // Right Sub-Bass Oscillator (Detuned Triangle for stereo width and grit)
    this.oscSubR = ctx.createOscillator();
    this.oscSubR.type = "triangle";
    this.oscSubR.frequency.setValueAtTime(42.8, now);

    // Extreme Sub Oscillator (Sub-harmonic foundation)
    this.oscDeep = ctx.createOscillator();
    this.oscDeep.type = "sine";
    this.oscDeep.frequency.setValueAtTime(21, now);

    // Left & Right Resonant Low-Pass Filters for true wide stereo response
    this.filterL = ctx.createBiquadFilter();
    this.filterL.type = "lowpass";
    this.filterL.frequency.setValueAtTime(45, now);
    this.filterL.Q.setValueAtTime(2.0, now);

    this.filterR = ctx.createBiquadFilter();
    this.filterR.type = "lowpass";
    this.filterR.frequency.setValueAtTime(48, now);
    this.filterR.Q.setValueAtTime(2.0, now);

    // Stereo Panners (if supported by Web Audio in browser)
    if (typeof ctx.createStereoPanner === "function") {
      this.pannerL = ctx.createStereoPanner();
      this.pannerL.pan.setValueAtTime(-0.85, now);

      this.pannerR = ctx.createStereoPanner();
      this.pannerR.pan.setValueAtTime(0.85, now);

      this.filterL.connect(this.pannerL);
      this.pannerL.connect(this.masterGain);

      this.filterR.connect(this.pannerR);
      this.pannerR.connect(this.masterGain);
    } else {
      this.filterL.connect(this.masterGain);
      this.filterR.connect(this.masterGain);
    }

    // Connect oscillators to stereo channels
    this.oscSubL.connect(this.filterL);
    this.oscDeep.connect(this.filterL);
    this.oscSubR.connect(this.filterR);
    this.oscDeep.connect(this.filterR);

    // LFO for slow spatial drifting of stereo cutoff
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.setValueAtTime(0.18, now); // ~5.5s cycle
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.setValueAtTime(14, now);
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filterL.frequency);

    // Generate Pink/Brownish low-rumble noise buffer for tectonic shearing
    const sampleRate = ctx.sampleRate;
    const noiseDuration = 3.0; // 3 second looping buffer
    const bufSize = Math.floor(sampleRate * noiseDuration);
    const noiseBuffer = ctx.createBuffer(2, bufSize, sampleRate);
    const rand = stream("effects");
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuffer.getChannelData(ch);
      let lastOut = 0.0;
      for (let i = 0; i < bufSize; i++) {
        const white = rand() * 2 - 1;
        // Brown noise one-pole filter integration for heavy earth-shaking rumble
        lastOut = (lastOut + 0.03 * white) / 1.03;
        data[i] = lastOut * 3.5;
      }
    }

    this.noiseNode = ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "lowpass";
    this.noiseFilter.frequency.setValueAtTime(90, now);
    this.noiseFilter.Q.setValueAtTime(1.5, now);

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.setValueAtTime(0.01, now);

    this.noiseNode.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    // Start all procedural audio sources
    this.oscSubL.start(now);
    this.oscSubR.start(now);
    this.oscDeep.start(now);
    this.lfo.start(now);
    this.noiseNode.start(now);

    this.active = true;
  }

  /** Gently fades out sound when paused, hidden, or between runs. */
  private fadeQuiet(): void {
    if (!this.active || !this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.25);
  }

  /** Releases audio nodes when completely stopped. */
  dispose(): void {
    if (!this.active) return;
    try {
      this.oscSubL?.stop();
      this.oscSubR?.stop();
      this.oscDeep?.stop();
      this.lfo?.stop();
      this.noiseNode?.stop();
    } catch {
      // Audio nodes may already be stopped
    }
    this.active = false;
  }

  private lastAnimalSoundAt = 0;

  /** Updates master, SFX, and ambience volume levels (0..1). */
  setVolumes(master: number, sfx: number, ambience: number): void {
    this.volMaster = Math.max(0, Math.min(1, master));
    this.volSfx = Math.max(0, Math.min(1, sfx));
    this.volAmbience = Math.max(0, Math.min(1, ambience));
    if (this.ctx && this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(this.volMaster * this.volSfx, this.ctx.currentTime, 0.05);
    }
  }

  /** Plays a rate-limited, voice-capped procedural sci-fi sound effect. */
  playSfx(cue: VoidSfxCue, intensity = 1): void {
    if (!soundOn() || document.hidden) return;
    const nowMs = performance.now();
    const prev = this.lastSfxAt.get(cue) ?? 0;
    if (nowMs - prev < SFX_COOLDOWN_MS[cue]) return;
    if (this.activeVoices >= this.maxVoices) return;

    if (!this.active) {
      this.initGraph();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    if (!this.ctx || !this.sfxGain || this.ctx.state !== "running") return;

    this.lastSfxAt.set(cue, nowMs);
    const ctx = this.ctx;
    const out = this.sfxGain;
    const now = ctx.currentTime;
    const scale = Math.max(0.25, Math.min(1.5, intensity));

    const tone = (
      type: OscillatorType,
      f0: number,
      f1: number,
      dur: number,
      peak: number,
      delay = 0,
    ) => {
      if (this.activeVoices >= this.maxVoices) return;
      this.activeVoices++;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, now + delay);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + delay + dur);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(peak * scale, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      };
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.02);
    };

    switch (cue) {
      case "uiClick":
        tone("triangle", 820, 540, 0.055, 0.09);
        break;
      case "uiToggle":
        tone("sine", 620, 460, 0.045, 0.07);
        break;
      case "towerPlace":
        tone("sine", 140, 62, 0.14, 0.22);
        tone("triangle", 520, 780, 0.1, 0.1, 0.02);
        break;
      case "towerSell":
        tone("triangle", 480, 190, 0.14, 0.14);
        break;
      case "towerUpgrade":
        tone("triangle", 440, 660, 0.12, 0.14);
        tone("sine", 660, 990, 0.16, 0.12, 0.07);
        break;
      case "cannonFire":
        tone("sawtooth", 170, 52, 0.12, 0.14);
        break;
      case "shellImpact":
        tone("triangle", 220, 75, 0.09, 0.11);
        break;
      case "collapse":
        tone("sawtooth", 92, 34, 0.28, 0.2 * scale);
        tone("sine", 58, 28, 0.34, 0.18 * scale);
        break;
      case "voidConsume":
        tone("sine", 620, 290, 0.08, 0.045);
        break;
      case "unitDeath":
        tone("square", 320, 110, 0.07, 0.05);
        break;
      case "strikeCast":
        tone("sawtooth", 240, 880, 0.18, 0.16);
        tone("sine", 880, 220, 0.28, 0.14, 0.12);
        break;
      case "victory":
        tone("triangle", 440, 440, 0.22, 0.15, 0);
        tone("triangle", 554.37, 554.37, 0.24, 0.15, 0.11);
        tone("triangle", 659.25, 659.25, 0.38, 0.18, 0.22);
        break;
      case "defeat":
        tone("sawtooth", 220, 196, 0.24, 0.14, 0);
        tone("sawtooth", 164.8, 110, 0.42, 0.16, 0.16);
        break;
    }
  }

  /** Plays a short synthesized sheep ("baa") or cow ("moo") sound when farmland livestock falls into the Void. */
  playAnimalSound(kind: "sheep" | "cow"): void {
    if (!this.active || !this.ctx || this.ctx.state !== "running") return;
    const nowMs = performance.now();
    if (nowMs - this.lastAnimalSoundAt < 350) return;
    this.lastAnimalSoundAt = nowMs;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = "lowpass";
    if (kind === "sheep") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.linearRampToValueAtTime(390, now + 0.08);
      osc.frequency.linearRampToValueAtTime(310, now + 0.24);
      filter.frequency.setValueAtTime(1100, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(155, now);
      osc.frequency.linearRampToValueAtTime(140, now + 0.16);
      osc.frequency.linearRampToValueAtTime(118, now + 0.38);
      filter.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    }
  }
}
