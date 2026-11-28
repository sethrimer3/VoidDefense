/** Procedural spatial sound engine for Void Defense.
 *
 * Replaces the old static binaural sub-bass drone with a layered, evolving,
 * headphone- and phone-speaker-friendly mix:
 * - Living Void bed: decorrelated 14 s crossfaded brown/pink noise layers
 *   (rumble 30-95 Hz, body 90-300 Hz, airy cosmic wind 1.1-3.8 kHz) plus a soft
 *   monaural harmonic pad widened by a Haas/mid-side stereo widener whose width
 *   and horizontal pan track the Void's takeover and map extent. Slow
 *   incommensurate LFOs (11 s, 23 s, 41 s) keep the timbre breathing, and
 *   occasional deep earthquake swells/groans send heavily into the dark reverb.
 * - Zoom-gated fire pool (4 reusable voices) for street fires and farm fires,
 *   silent at full-city overview and fading in smoothly as the player zooms in.
 * - Zoom-gated close-up city neon hum and wetness-driven stereo rain bed.
 * - Positional, multi-layered SFX (collapsing buildings, landing chunk impacts,
 *   tower families, strikes including a true inharmonic quarantine bell,
 *   granular void swallow, livestock) all routed through the shared bus graph.
 *
 * Uses a private seeded RNG so audio never touches shared `"game"` or `"effects"`
 * streams or `Math.random`. Safe to import in Node without `window`/`AudioContext`. */

import { audioGraph, setBusVolumes, soundOn, type SharedAudioGraph } from "../sound.ts";
import {
  cityDetailZoomGain,
  clamp,
  computeVoidBedParams,
  createAudioRng,
  selectFireVoices,
  type FireCandidate,
  type SpatialParams,
} from "./audio-math.ts";
import type { StrikeId, TowerTypeId } from "./model.ts";

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

export interface AmbienceFrameInput {
  cityPreservedPct: number;
  contactEdges: number;
  inBattle: boolean;
  paused: boolean;
  fallingChunks: number;
  /** Normalized horizontal span of the Void across the board (`0..1`). */
  voidExtentX: number;
  /** Normalized horizontal centre of the Void (`0..1`, 0.5 = centred). */
  voidCentroidX: number;
  /** Current camera zoom (`1` = overview, higher = zoomed in). */
  zoom: number;
  /** Viewport size in canvas pixels. */
  viewW: number;
  viewH: number;
  /** Active weather wetness (`0..1`). */
  rainWetness: number;
  /** Visible/active street and farm fire candidates in viewport coordinates. */
  fires: readonly FireCandidate[];
  nowMs?: number;
}

const SFX_COOLDOWN_MS: Record<VoidSfxCue, number> = {
  uiClick: 30,
  uiToggle: 30,
  towerPlace: 45,
  towerSell: 45,
  towerUpgrade: 55,
  cannonFire: 65,
  shellImpact: 75,
  collapse: 130,
  voidConsume: 165,
  unitDeath: 100,
  strikeCast: 120,
  victory: 400,
  defeat: 400,
};

const FIRE_POOL_SIZE = 4;

interface FireVoice {
  assignedId: number;
  src: AudioBufferSourceNode;
  bp: BiquadFilterNode;
  bodyLp: BiquadFilterNode;
  bodyGain: GainNode;
  panner: StereoPannerNode | null;
  gain: GainNode;
  lastPopAtMs: number;
  currentGain: number;
  currentPan: number;
}

function nowMillis(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class VoidSoundEngine {
  private readonly rand = createAudioRng(0x501d0002);
  private active = false;
  private graph: SharedAudioGraph | null = null;
  private volMaster = 0.8;
  private volSfx = 0.85;
  private volAmbience = 0.65;
  private volMusic = 0.5;

  private lastSfxAt = new Map<VoidSfxCue, number>();
  private lastImpactAt = 0;
  private lastAnimalSoundAt = 0;
  private activeVoices = 0;
  private readonly maxVoices = 12;

  // Shared procedural noise buffers (created once on graph init)
  private brownBuf: AudioBuffer | null = null;
  private pinkBuf: AudioBuffer | null = null;
  private shortNoiseBuf: AudioBuffer | null = null;

  // --- Living Void Bed nodes ---
  private bedMaster: GainNode | null = null;
  private bedPanner: StereoPannerNode | null = null;
  private bedDryGain: GainNode | null = null;
  private bedSideGain: GainNode | null = null;
  private bedVerbSend: GainNode | null = null;

  private rumbleSrc: AudioBufferSourceNode | null = null;
  private rumbleHp: BiquadFilterNode | null = null;
  private rumbleLp: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;

  private bodySrc: AudioBufferSourceNode | null = null;
  private bodyBp: BiquadFilterNode | null = null;
  private bodyGain: GainNode | null = null;

  private airySrc: AudioBufferSourceNode | null = null;
  private airyBp: BiquadFilterNode | null = null;
  private airyGain: GainNode | null = null;

  private padOscs: OscillatorNode[] = [];
  private padLp: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;

  private lfoOscs: OscillatorNode[] = [];

  // Distant earthquake / deep groan timer
  private nextQuakeAtMs = 0;

  // --- Zoom-gated Fire Pool ---
  private fireMaster: GainNode | null = null;
  private fireVoices: FireVoice[] = [];

  // --- Zoom-gated City Neon Hum ---
  private cityOscA: OscillatorNode | null = null;
  private cityOscB: OscillatorNode | null = null;
  private cityGain: GainNode | null = null;

  // --- Weather Rain Bed ---
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;

  private lastBedUpdateMs = 0;

  /** Updates master, SFX, ambience, and optional music volume levels (`0..1`). */
  setVolumes(master: number, sfx: number, ambience: number, music?: number): void {
    this.volMaster = clamp(master, 0, 1);
    this.volSfx = clamp(sfx, 0, 1);
    this.volAmbience = clamp(ambience, 0, 1);
    if (typeof music === "number") this.volMusic = clamp(music, 0, 1);
    setBusVolumes(this.volMaster, this.volSfx, this.volAmbience, this.volMusic);
  }

  /** Legacy-compatible update signature (used when only basic state is available). */
  update(
    cityPreservedPct: number,
    contactEdges: number,
    inBattle: boolean,
    fallingChunks = 0,
  ): void {
    this.updateAmbience({
      cityPreservedPct,
      contactEdges,
      inBattle,
      paused: !inBattle,
      fallingChunks,
      voidExtentX: clamp((100 - cityPreservedPct) / 100, 0, 1),
      voidCentroidX: 0.5,
      zoom: 1,
      viewW: 1,
      viewH: 1,
      rainWetness: 0,
      fires: [],
    });
  }

  /** Updates the Void bed, zoom-gated fires, city hum, and rain bed at ~12 Hz. */
  updateAmbience(input: AmbienceFrameInput): void {
    const nowMs = input.nowMs ?? nowMillis();
    if (!soundOn() || this.volMaster <= 0 || this.volAmbience <= 0) {
      this.fadeQuiet();
      return;
    }

    if (!input.inBattle && input.rainWetness <= 0.01) {
      this.fadeQuiet();
      return;
    }

    if (!this.active) {
      this.initGraph();
    }
    if (!this.graph || !this.bedMaster) return;
    if (this.graph.ctx.state !== "running") return;

    // Throttle smooth bed updates to ~12 Hz so per-frame CPU cost is negligible
    if (nowMs - this.lastBedUpdateMs < 80) return;
    this.lastBedUpdateMs = nowMs;

    const ctx = this.graph.ctx;
    const now = ctx.currentTime;

    // 1. Living Void Bed (fades out when paused or not in battle)
    if (input.inBattle && !input.paused) {
      const p = computeVoidBedParams(
        input.cityPreservedPct,
        input.contactEdges,
        input.fallingChunks,
        input.voidExtentX,
        input.voidCentroidX,
        input.zoom,
      );

      this.bedMaster.gain.setTargetAtTime(1.0, now, 0.6);
      this.rumbleGain?.gain.setTargetAtTime(p.rumbleGain, now, 0.7);
      this.bodyGain?.gain.setTargetAtTime(p.bodyGain, now, 0.65);
      this.airyGain?.gain.setTargetAtTime(p.airyGain, now, 0.7);
      this.padGain?.gain.setTargetAtTime(p.padGain, now, 0.9);
      this.bodyBp?.frequency.setTargetAtTime(p.bodyCutoffHz, now, 0.65);
      this.rumbleLp?.frequency.setTargetAtTime(62 + p.quakeIntensity * 48, now, 0.8);
      this.padLp?.frequency.setTargetAtTime(155 + p.quakeIntensity * 145, now, 1.1);

      // Stereo width via mid/side Haas widener (0.08 = near-mono, 0.95 = wide)
      this.bedSideGain?.gain.setTargetAtTime(p.width * 0.85, now, 0.75);
      this.bedDryGain?.gain.setTargetAtTime(1.0 - p.width * 0.18, now, 0.75);
      this.bedVerbSend?.gain.setTargetAtTime(0.18 + p.width * 0.34, now, 0.8);
      if (this.bedPanner) {
        this.bedPanner.pan.setTargetAtTime(p.pan, now, 0.8);
      }

      // Schedule distant earthquake swells & deep groans when Void has grown
      if (p.quakeIntensity > 0.08 && nowMs >= this.nextQuakeAtMs) {
        if (this.nextQuakeAtMs > 0) {
          this.triggerDistantQuake(p.quakeIntensity, p.pan);
        }
        const intervalSec = 9 + this.rand() * 17 * (1.2 - p.quakeIntensity * 0.45);
        this.nextQuakeAtMs = nowMs + intervalSec * 1000;
      }
    } else {
      this.bedMaster.gain.setTargetAtTime(0.0001, now, 0.5);
    }

    // 2. Zoom-gated Fires (silent at overview, silent when paused or outside battle)
    if (this.fireMaster) {
      if (input.inBattle && !input.paused) {
        this.fireMaster.gain.setTargetAtTime(1.0, now, 0.18);
        this.updateFirePool(input, now, nowMs);
      } else {
        this.fireMaster.gain.setTargetAtTime(0.0001, now, 0.22);
      }
    }

    // 3. Zoom-gated City Neon Hum (subtle electrical presence up close on surviving city)
    if (this.cityGain) {
      const cityAlive = clamp(input.cityPreservedPct / 100, 0, 1);
      const cZoom = cityDetailZoomGain(input.zoom);
      const targetCity = input.inBattle && !input.paused ? cZoom * cityAlive * 0.045 : 0.0001;
      this.cityGain.gain.setTargetAtTime(targetCity, now, 0.45);
    }

    // 4. Weather Rain Bed (follows wetness, brighter and closer when zoomed in)
    if (this.rainGain && this.rainFilter) {
      const wet = clamp(input.rainWetness, 0, 1);
      const cZoom = cityDetailZoomGain(input.zoom);
      const rainTarget = !input.paused && wet > 0.01 ? wet * (0.09 + cZoom * 0.07) : 0.0001;
      this.rainGain.gain.setTargetAtTime(rainTarget, now, 0.55);
      // Overview: soft distant wash (~1.4 kHz); Zoomed in: brighter rooftop patter (~3.6 kHz)
      this.rainFilter.frequency.setTargetAtTime(1400 + cZoom * 2200, now, 0.45);
    }
  }

  private updateFirePool(input: AmbienceFrameInput, now: number, nowMs: number): void {
    const selected = selectFireVoices(input.fires, input.viewW, input.viewH, input.zoom, FIRE_POOL_SIZE);
    const usedVoice = new Uint8Array(this.fireVoices.length);
    const assigned = new Map<number, number>(); // fireId -> voiceIdx

    // Pass 1: keep voices already tracking the same fire id (no clicks)
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      for (let v = 0; v < this.fireVoices.length; v++) {
        if (!usedVoice[v] && this.fireVoices[v].assignedId === s.id) {
          usedVoice[v] = 1;
          assigned.set(s.id, v);
          break;
        }
      }
    }

    // Pass 2: assign remaining selected fires to free voices
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      if (assigned.has(s.id)) continue;
      for (let v = 0; v < this.fireVoices.length; v++) {
        if (!usedVoice[v]) {
          usedVoice[v] = 1;
          this.fireVoices[v].assignedId = s.id;
          assigned.set(s.id, v);
          break;
        }
      }
    }

    // Apply targets to assigned voices
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      const vIdx = assigned.get(s.id);
      if (vIdx === undefined) continue;
      const voice = this.fireVoices[vIdx];
      voice.currentGain = s.gain;
      voice.currentPan = s.pan;
      voice.bp.frequency.setTargetAtTime(s.centerHz, now, 0.14);
      voice.gain.gain.setTargetAtTime(s.gain * 0.13, now, 0.14);
      voice.bodyGain.gain.setTargetAtTime(s.isLarge ? s.gain * 0.075 : 0.0001, now, 0.18);
      if (voice.panner) {
        voice.panner.pan.setTargetAtTime(s.pan, now, 0.12);
      }
      // Subtle stochastic crackle pops on audible fires
      if (s.gain > 0.18 && nowMs - voice.lastPopAtMs > 180 + this.rand() * 480) {
        voice.lastPopAtMs = nowMs;
        this.triggerFireCrackle(s.pan, s.gain, s.centerHz);
      }
    }

    // Fade unused voices down cleanly
    for (let v = 0; v < this.fireVoices.length; v++) {
      if (!usedVoice[v]) {
        const voice = this.fireVoices[v];
        voice.assignedId = -1;
        voice.currentGain = 0;
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.16);
        voice.bodyGain.gain.setTargetAtTime(0.0001, now, 0.16);
      }
    }
  }

  private triggerFireCrackle(pan: number, gain: number, centerHz: number): void {
    if (!this.graph || !this.shortNoiseBuf || this.activeVoices >= this.maxVoices) return;
    const { ctx, ambienceBus } = this.graph;
    const now = ctx.currentTime;
    this.activeVoices++;

    const src = ctx.createBufferSource();
    src.buffer = this.shortNoiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(centerHz * (1.2 + this.rand() * 0.9), now);
    bp.Q.setValueAtTime(3.2, now);

    const g = ctx.createGain();
    const dur = 0.012 + this.rand() * 0.018;
    const peak = clamp(gain * (0.045 + this.rand() * 0.045), 0.005, 0.1);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(g);
    this.connectPanned(ctx, g, ambienceBus, pan);

    const offset = this.rand() * Math.max(0.05, this.shortNoiseBuf.duration - 0.06);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(now, offset, dur + 0.01);
  }

  /** Triggers a distant tectonic earthquake swell + deep groan sent heavily into dark reverb. */
  private triggerDistantQuake(intensity: number, pan: number): void {
    if (!this.graph || !this.brownBuf || this.activeVoices >= this.maxVoices - 1) return;
    const { ctx, ambienceBus, darkVerb } = this.graph;
    const now = ctx.currentTime;
    this.activeVoices++;

    const attack = 1.4 + this.rand() * 1.2;
    const hold = 0.8 + this.rand() * 1.4;
    const release = 2.8 + this.rand() * 2.2;
    const total = attack + hold + release;

    // 1. Filtered brown-noise seismic swell
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(28, now);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    const peakCut = 75 + intensity * 65 + this.rand() * 25;
    lp.frequency.setValueAtTime(48, now);
    lp.frequency.linearRampToValueAtTime(peakCut, now + attack);
    lp.frequency.exponentialRampToValueAtTime(42, now + total);
    lp.Q.setValueAtTime(1.4, now);

    const env = ctx.createGain();
    const peak = 0.14 * clamp(intensity, 0.1, 1);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + attack);
    env.gain.setValueAtTime(peak * 0.88, now + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, now + total);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(env);

    const quakePan = clamp(pan + (this.rand() - 0.5) * 0.35, -0.55, 0.55);
    this.connectPanned(ctx, env, ambienceBus, quakePan);

    // Heavy dark reverb send so it feels vast and distant
    const verbSend = ctx.createGain();
    verbSend.gain.setValueAtTime(0.75, now);
    env.connect(verbSend);
    verbSend.connect(darkVerb);

    const offset = this.rand() * Math.max(1, this.brownBuf.duration - 2);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(now, offset, total + 0.1);

    // 2. Occasional low resonant "groan" harmonic underneath
    if (this.rand() < 0.65 && this.activeVoices < this.maxVoices) {
      this.activeVoices++;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const f0 = 58 + this.rand() * 22;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.74, now + total);

      const gLp = ctx.createBiquadFilter();
      gLp.type = "lowpass";
      gLp.frequency.setValueAtTime(130, now);
      gLp.Q.setValueAtTime(2.6, now);

      const gEnv = ctx.createGain();
      gEnv.gain.setValueAtTime(0.0001, now);
      gEnv.gain.linearRampToValueAtTime(peak * 0.28, now + attack * 1.1);
      gEnv.gain.exponentialRampToValueAtTime(0.0001, now + total);

      osc.connect(gLp);
      gLp.connect(gEnv);
      gEnv.connect(darkVerb);
      this.connectPanned(ctx, gEnv, ambienceBus, quakePan);

      osc.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      };
      osc.start(now);
      osc.stop(now + total + 0.08);
    }
  }

  private initGraph(): void {
    const graph = audioGraph();
    if (!graph) return;
    this.graph = graph;
    setBusVolumes(this.volMaster, this.volSfx, this.volAmbience, this.volMusic);

    const { ctx, ambienceBus, darkVerb } = graph;
    const now = ctx.currentTime;

    // Build long 14-second seamless decorrelated noise buffers once
    this.brownBuf = this.createLoopingNoiseBuffer(ctx, 14, "brown");
    this.pinkBuf = this.createLoopingNoiseBuffer(ctx, 14, "pink");
    this.shortNoiseBuf = this.createShortWhiteBuffer(ctx, 1.5);

    // --- 1. Living Void Bed ---
    this.bedMaster = ctx.createGain();
    this.bedMaster.gain.setValueAtTime(0.0001, now);

    // Haas + mid/side stereo widener: mono/dry path + delayed/inverted side path
    this.bedDryGain = ctx.createGain();
    this.bedDryGain.gain.setValueAtTime(0.95, now);

    this.bedSideGain = ctx.createGain();
    this.bedSideGain.gain.setValueAtTime(0.12, now);

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const sideDelayR = ctx.createDelay(0.05);
    sideDelayR.delayTime.setValueAtTime(0.011, now); // 11 ms Haas decorrelation
    const sideDelayL = ctx.createDelay(0.05);
    sideDelayL.delayTime.setValueAtTime(0.007, now);

    const bedSum = ctx.createGain();
    bedSum.gain.setValueAtTime(1, now);

    // Direct path
    bedSum.connect(this.bedDryGain);
    this.bedDryGain.connect(this.bedMaster);

    // Widened decorrelated path
    bedSum.connect(splitter);
    splitter.connect(sideDelayL, 0);
    splitter.connect(sideDelayR, 1);
    sideDelayL.connect(merger, 0, 1); // cross-feed delayed L -> R
    sideDelayR.connect(merger, 0, 0); // cross-feed delayed R -> L
    merger.connect(this.bedSideGain);
    this.bedSideGain.connect(this.bedMaster);

    if (typeof ctx.createStereoPanner === "function") {
      this.bedPanner = ctx.createStereoPanner();
      this.bedPanner.pan.setValueAtTime(0, now);
      this.bedMaster.connect(this.bedPanner);
      this.bedPanner.connect(ambienceBus);
    } else {
      this.bedMaster.connect(ambienceBus);
    }

    this.bedVerbSend = ctx.createGain();
    this.bedVerbSend.gain.setValueAtTime(0.22, now);
    this.bedMaster.connect(this.bedVerbSend);
    this.bedVerbSend.connect(darkVerb);

    // Layer A: Deep rumble (30-95 Hz brown noise, high-passed at 28 Hz to prevent ear pressure)
    this.rumbleSrc = ctx.createBufferSource();
    this.rumbleSrc.buffer = this.brownBuf;
    this.rumbleSrc.loop = true;
    this.rumbleHp = ctx.createBiquadFilter();
    this.rumbleHp.type = "highpass";
    this.rumbleHp.frequency.setValueAtTime(28, now);
    this.rumbleLp = ctx.createBiquadFilter();
    this.rumbleLp.type = "lowpass";
    this.rumbleLp.frequency.setValueAtTime(72, now);
    this.rumbleLp.Q.setValueAtTime(0.9, now);
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.setValueAtTime(0.04, now);
    this.rumbleSrc.connect(this.rumbleHp);
    this.rumbleHp.connect(this.rumbleLp);
    this.rumbleLp.connect(this.rumbleGain);
    this.rumbleGain.connect(bedSum);

    // Layer B: Tectonic body (90-300 Hz band-passed pink/brown noise, clearly audible on phone speakers)
    this.bodySrc = ctx.createBufferSource();
    this.bodySrc.buffer = this.pinkBuf;
    this.bodySrc.loop = true;
    this.bodyBp = ctx.createBiquadFilter();
    this.bodyBp.type = "bandpass";
    this.bodyBp.frequency.setValueAtTime(165, now);
    this.bodyBp.Q.setValueAtTime(0.85, now);
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.setValueAtTime(0.06, now);
    this.bodySrc.connect(this.bodyBp);
    this.bodyBp.connect(this.bodyGain);
    this.bodyGain.connect(bedSum);

    // Layer C: Faint airy cosmic wind (1.1-3.8 kHz band-passed pink noise)
    this.airySrc = ctx.createBufferSource();
    this.airySrc.buffer = this.pinkBuf;
    this.airySrc.loop = true;
    this.airyBp = ctx.createBiquadFilter();
    this.airyBp.type = "bandpass";
    this.airyBp.frequency.setValueAtTime(2100, now);
    this.airyBp.Q.setValueAtTime(1.1, now);
    this.airyGain = ctx.createGain();
    this.airyGain.gain.setValueAtTime(0.06, now);
    this.airySrc.connect(this.airyBp);
    this.airyBp.connect(this.airyGain);
    this.airyGain.connect(bedSum);

    // Layer D: Soft harmonic pad (summed mono before widener — NO L/R binaural beat)
    this.padLp = ctx.createBiquadFilter();
    this.padLp.type = "lowpass";
    this.padLp.frequency.setValueAtTime(185, now);
    this.padLp.Q.setValueAtTime(0.8, now);
    this.padGain = ctx.createGain();
    this.padGain.gain.setValueAtTime(0.05, now);
    this.padLp.connect(this.padGain);
    this.padGain.connect(bedSum);

    const padSpecs: [OscillatorType, number, number][] = [
      ["sawtooth", 73.42, -4],  // D2
      ["triangle", 110.0, 3],   // A2
      ["sawtooth", 146.83, 5],  // D3 (soft fifth/octave warmth above 80 Hz)
    ];
    this.padOscs = padSpecs.map(([type, freq, detune]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime(detune, now);
      const voiceG = ctx.createGain();
      voiceG.gain.setValueAtTime(0.32, now);
      osc.connect(voiceG);
      voiceG.connect(this.padLp!);
      osc.start(now);
      return osc;
    });

    // Incommensurate slow LFOs (periods 11.3 s, 23.7 s, 41.1 s) for living evolution
    const addLfo = (periodSec: number, depth: number, target: AudioParam) => {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(1 / periodSec, now);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(depth, now);
      lfo.connect(lg);
      lg.connect(target);
      lfo.start(now);
      this.lfoOscs.push(lfo);
    };
    addLfo(11.3, 28, this.bodyBp.frequency);
    addLfo(23.7, 460, this.airyBp.frequency);
    addLfo(41.1, 32, this.padLp.frequency);

    this.rumbleSrc.start(now, 0);
    this.bodySrc.start(now, 3.7);
    this.airySrc.start(now, 7.9);

    // --- 2. Zoom-gated Fire Pool (4 voices) ---
    this.fireMaster = ctx.createGain();
    this.fireMaster.gain.setValueAtTime(0.0001, now);
    this.fireMaster.connect(ambienceBus);

    this.fireVoices = [];
    for (let i = 0; i < FIRE_POOL_SIZE; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.pinkBuf;
      src.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(1350, now);
      bp.Q.setValueAtTime(1.2, now);

      const bodyLp = ctx.createBiquadFilter();
      bodyLp.type = "lowpass";
      bodyLp.frequency.setValueAtTime(220, now);

      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);

      const voiceOut = ctx.createGain();
      voiceOut.gain.setValueAtTime(1, now);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(voiceOut);

      src.connect(bodyLp);
      bodyLp.connect(bodyGain);
      bodyGain.connect(voiceOut);

      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(0, now);
        voiceOut.connect(panner);
        panner.connect(this.fireMaster);
      } else {
        voiceOut.connect(this.fireMaster);
      }

      src.start(now, (i * 3.1) % this.pinkBuf.duration);
      this.fireVoices.push({
        assignedId: -1,
        src,
        bp,
        bodyLp,
        bodyGain,
        panner,
        gain,
        lastPopAtMs: 0,
        currentGain: 0,
        currentPan: 0,
      });
    }

    // --- 3. Zoom-gated City Neon Hum ---
    const cityLp = ctx.createBiquadFilter();
    cityLp.type = "lowpass";
    cityLp.frequency.setValueAtTime(420, now);
    this.cityGain = ctx.createGain();
    this.cityGain.gain.setValueAtTime(0.0001, now);
    cityLp.connect(this.cityGain);
    this.cityGain.connect(ambienceBus);

    this.cityOscA = ctx.createOscillator();
    this.cityOscA.type = "triangle";
    this.cityOscA.frequency.setValueAtTime(120, now);
    this.cityOscA.connect(cityLp);

    this.cityOscB = ctx.createOscillator();
    this.cityOscB.type = "sawtooth";
    this.cityOscB.frequency.setValueAtTime(240, now);
    const cityBVol = ctx.createGain();
    cityBVol.gain.setValueAtTime(0.28, now);
    this.cityOscB.connect(cityBVol);
    cityBVol.connect(cityLp);

    this.cityOscA.start(now);
    this.cityOscB.start(now);

    // --- 4. Weather Rain Bed ---
    this.rainSrc = ctx.createBufferSource();
    this.rainSrc.buffer = this.pinkBuf;
    this.rainSrc.loop = true;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = "highpass";
    rainHp.frequency.setValueAtTime(420, now);
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = "lowpass";
    this.rainFilter.frequency.setValueAtTime(1800, now);
    this.rainGain = ctx.createGain();
    this.rainGain.gain.setValueAtTime(0.0001, now);

    this.rainSrc.connect(rainHp);
    rainHp.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(ambienceBus);
    this.rainSrc.start(now, 1.9);

    this.nextQuakeAtMs = nowMillis() + (6 + this.rand() * 8) * 1000;
    this.active = true;
  }

  /** Creates a seamless crossfaded stereo brown or pink noise buffer (zero loop seam). */
  private createLoopingNoiseBuffer(
    ac: AudioContext,
    durationSec: number,
    color: "brown" | "pink",
  ): AudioBuffer {
    const sr = ac.sampleRate;
    const len = Math.floor(sr * durationSec);
    const fadeLen = Math.min(Math.floor(sr * 0.6), Math.floor(len * 0.15));
    const buf = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const raw = new Float32Array(len + fadeLen);
      if (color === "brown") {
        let last = 0;
        for (let i = 0; i < raw.length; i++) {
          const w = this.rand() * 2 - 1;
          last = (last + 0.024 * w) / 1.024;
          raw[i] = clamp(last * 3.4, -1, 1);
        }
      } else {
        // Paul Kellet's pink noise filter
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < raw.length; i++) {
          const w = this.rand() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520;
          b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.0168980;
          const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
          raw[i] = clamp(pink, -1, 1);
        }
      }
      for (let i = 0; i < len; i++) data[i] = raw[i];
      // Equal-power crossfade tail into head so loop is completely seamless
      for (let i = 0; i < fadeLen; i++) {
        const t = i / fadeLen;
        const a = Math.cos(t * Math.PI * 0.5);
        const b = Math.sin(t * Math.PI * 0.5);
        data[i] = raw[len + i] * a + raw[i] * b;
      }
    }
    return buf;
  }

  private createShortWhiteBuffer(ac: AudioContext, durationSec: number): AudioBuffer {
    const len = Math.floor(ac.sampleRate * durationSec);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = this.rand() * 2 - 1;
    }
    return buf;
  }

  /** Gently fades out all continuous ambience when paused, hidden, or between runs. */
  private fadeQuiet(): void {
    if (!this.active || !this.graph) return;
    const now = this.graph.ctx.currentTime;
    this.bedMaster?.gain.setTargetAtTime(0.0001, now, 0.35);
    this.fireMaster?.gain.setTargetAtTime(0.0001, now, 0.2);
    this.cityGain?.gain.setTargetAtTime(0.0001, now, 0.25);
    this.rainGain?.gain.setTargetAtTime(0.0001, now, 0.35);
  }

  /** Releases continuous audio nodes when completely stopped. */
  dispose(): void {
    if (!this.active) return;
    const stopSafe = (n: { stop: () => void } | null) => {
      try { n?.stop(); } catch { /* ignore */ }
    };
    stopSafe(this.rumbleSrc);
    stopSafe(this.bodySrc);
    stopSafe(this.airySrc);
    stopSafe(this.cityOscA);
    stopSafe(this.cityOscB);
    stopSafe(this.rainSrc);
    for (const o of this.padOscs) stopSafe(o);
    for (const o of this.lfoOscs) stopSafe(o);
    for (const v of this.fireVoices) stopSafe(v.src);
    this.padOscs = [];
    this.lfoOscs = [];
    this.fireVoices = [];
    this.active = false;
  }

  private ensureReady(): SharedAudioGraph | null {
    if (!soundOn()) return null;
    if (!this.active) this.initGraph();
    if (!this.graph) return null;
    const state = this.graph.ctx.state as string;
    if (state === "suspended" || state === "interrupted") {
      void this.graph.ctx.resume().catch(() => {});
    }
    return this.graph.ctx.state === "running" ? this.graph : null;
  }

  private connectPanned(
    ctx: AudioContext,
    src: AudioNode,
    dest: AudioNode,
    pan: number,
  ): void {
    if (Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(pan, -0.65, 0.65), ctx.currentTime);
      src.connect(p);
      p.connect(dest);
    } else {
      src.connect(dest);
    }
  }

  /** Plays a rate-limited, voice-capped, optionally positional procedural SFX cue. */
  playSfx(cue: VoidSfxCue, intensity = 1, spatial?: SpatialParams): void {
    if (!soundOn()) return;
    const nowMs = nowMillis();
    const prev = this.lastSfxAt.get(cue) ?? 0;
    if (nowMs - prev < SFX_COOLDOWN_MS[cue]) return;
    if (this.activeVoices >= this.maxVoices) return;

    const g = this.ensureReady();
    if (!g) return;
    this.lastSfxAt.set(cue, nowMs);

    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 1;
    const scale = clamp(intensity, 0.25, 1.8) * distGain;
    const pitchJitter = 0.94 + this.rand() * 0.12;

    switch (cue) {
      case "uiClick":
        this.playUiClick(g, false);
        break;
      case "uiToggle":
        this.playUiClick(g, true);
        break;
      case "towerPlace":
        this.playTowerPlace(g, pan, scale, pitchJitter);
        break;
      case "towerSell":
        this.playToneLayer(g, "triangle", 460 * pitchJitter, 180, 0.14, 0.12 * scale, 0, pan, 0.15);
        this.playNoiseBurst(g, 900, 1.4, 0.06, 0.06 * scale, 0, pan, 0.1);
        break;
      case "towerUpgrade":
        this.playToneLayer(g, "triangle", 440, 660, 0.12, 0.11 * scale, 0, pan, 0.2);
        this.playToneLayer(g, "sine", 660, 990, 0.18, 0.1 * scale, 0.06, pan, 0.25);
        this.playNoiseBurst(g, 2400, 2.0, 0.05, 0.04 * scale, 0.04, pan, 0.2);
        break;
      case "cannonFire":
        this.playTowerShot("matterCannon", spatial, intensity);
        break;
      case "shellImpact":
        this.playToneLayer(g, "triangle", 190 * pitchJitter, 62, 0.11, 0.1 * scale, 0, pan, 0.18);
        this.playNoiseBurst(g, 680 * pitchJitter, 1.1, 0.09, 0.08 * scale, 0, pan, 0.15);
        break;
      case "collapse":
        this.playCollapse(Math.max(1, intensity * 6), spatial);
        break;
      case "voidConsume":
        this.playVoidSwallow(g, pan, scale, pitchJitter);
        break;
      case "unitDeath":
        this.playNoiseBurst(g, 1100 * pitchJitter, 1.8, 0.07, 0.05 * scale, 0, pan, 0.12);
        this.playToneLayer(g, "triangle", 260 * pitchJitter, 95, 0.08, 0.045 * scale, 0, pan, 0.1);
        break;
      case "strikeCast":
        this.playStrike("containmentPulse", spatial);
        break;
      case "victory":
        g.duck(-3.5, 0.04, 1.2);
        this.playToneLayer(g, "triangle", 293.66, 293.66, 0.45, 0.13, 0, -0.15, 0.45, true);
        this.playToneLayer(g, "triangle", 440.0, 440.0, 0.55, 0.13, 0.11, 0.15, 0.45, true);
        this.playToneLayer(g, "sine", 587.33, 587.33, 0.85, 0.15, 0.22, 0, 0.55, true);
        break;
      case "defeat":
        g.duck(-4.5, 0.05, 1.5);
        this.playToneLayer(g, "sawtooth", 146.83, 130.81, 0.55, 0.12, 0, -0.2, 0.55, true);
        this.playToneLayer(g, "triangle", 110.0, 73.42, 0.95, 0.15, 0.16, 0.2, 0.65, true);
        break;
    }
  }

  /** Layered building collapse: crack transient + groaning creak + size-scaled rumble + debris clatter. */
  playCollapse(size: number, spatial?: SpatialParams): void {
    if (!soundOn()) return;
    const nowMs = nowMillis();
    const prev = this.lastSfxAt.get("collapse") ?? 0;
    if (nowMs - prev < SFX_COOLDOWN_MS.collapse) return;
    if (this.activeVoices >= this.maxVoices - 1) return;

    const g = this.ensureReady();
    if (!g) return;
    this.lastSfxAt.set("collapse", nowMs);

    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 1;
    // Normalize size: 1..3 = small spall, 6..12 = mid building, 14+ = skyscraper
    const mag = clamp(size / 14, 0.18, 1.35);
    const gain = clamp((0.35 + mag * 0.65) * distGain, 0.08, 1.15);
    const pitchJitter = 0.9 + this.rand() * 0.2;

    if (mag >= 0.55) {
      g.duck(-2.5 - mag * 2.2, 0.03, 0.8 + mag * 0.6);
    }

    // 1. Crack transient (short sharp filtered noise burst)
    this.playNoiseBurst(
      g,
      (900 + (1 - clamp(mag, 0, 1)) * 700) * pitchJitter,
      1.6,
      0.045 + mag * 0.035,
      0.16 * gain,
      0,
      pan,
      0.28,
      false,
    );

    // 2. Groaning structural creak (slowly falling resonant tone + bandpass grit)
    const creakDur = 0.28 + mag * 0.55;
    this.playToneLayer(
      g,
      "sawtooth",
      (135 - mag * 35) * pitchJitter,
      Math.max(32, (62 - mag * 18) * pitchJitter),
      creakDur,
      0.095 * gain,
      0.02,
      pan,
      0.45,
      true,
    );

    // 3. Heavy rumbling body (low-passed brown noise scaled by building size)
    const rumbleDur = 0.4 + mag * 1.15;
    this.playBrownRumble(
      g,
      110 + mag * 120,
      rumbleDur,
      0.22 * gain,
      0.03,
      pan,
      0.55 + mag * 0.25,
    );

    // 4. Scattered debris clatter (2-4 tiny delayed randomised clicks/thuds)
    const clatterCount = Math.min(4, 2 + Math.floor(mag * 2));
    for (let i = 0; i < clatterCount; i++) {
      const delay = 0.14 + i * (0.07 + this.rand() * 0.09);
      const cPan = clamp(pan + (this.rand() - 0.5) * 0.22, -0.6, 0.6);
      this.playNoiseBurst(
        g,
        650 + this.rand() * 1400,
        2.2,
        0.025 + this.rand() * 0.03,
        (0.055 + this.rand() * 0.04) * gain,
        delay,
        cPan,
        0.2,
        false,
      );
    }
  }

  /** Plays a landing thud when a falling masonry chunk impacts solid ground. */
  playChunkImpact(radius: number, damage: number, spatial?: SpatialParams): void {
    if (!soundOn()) return;
    const nowMs = nowMillis();
    if (nowMs - this.lastImpactAt < 95) return;
    if (this.activeVoices >= this.maxVoices) return;

    const g = this.ensureReady();
    if (!g) return;
    this.lastImpactAt = nowMs;

    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 1;
    const weight = clamp((radius * 0.35 + damage * 0.015), 0.3, 1.2) * distGain;
    const jitter = 0.9 + this.rand() * 0.2;

    this.playToneLayer(g, "sine", 95 * jitter, 38, 0.14, 0.14 * weight, 0, pan, 0.25, true);
    this.playNoiseBurst(g, 420 * jitter, 1.3, 0.08, 0.09 * weight, 0, pan, 0.2, false);
  }

  /** Distinct tower firing voices grouped by weapon family. */
  playTowerShot(towerType: TowerTypeId, spatial?: SpatialParams, intensity = 1): void {
    if (!soundOn()) return;
    const nowMs = nowMillis();
    const prev = this.lastSfxAt.get("cannonFire") ?? 0;
    if (nowMs - prev < SFX_COOLDOWN_MS.cannonFire) return;
    if (this.activeVoices >= this.maxVoices) return;

    const g = this.ensureReady();
    if (!g) return;
    this.lastSfxAt.set("cannonFire", nowMs);

    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 1;
    const scale = clamp(intensity, 0.3, 1.3) * distGain;
    const jitter = 0.92 + this.rand() * 0.16;

    switch (towerType) {
      case "matterCannon":
      case "rocketTeam":
        // Weighty kinetic thump + crisp air puff
        this.playToneLayer(g, "triangle", 165 * jitter, 52, 0.12, 0.13 * scale, 0, pan, 0.22);
        this.playNoiseBurst(g, 950 * jitter, 1.4, 0.045, 0.065 * scale, 0, pan, 0.15);
        break;
      case "chronoCannon":
      case "boundaryPrism":
      case "lanternBearer":
        // Crystalline harmonic shimmer
        this.playToneLayer(g, "sine", 740 * jitter, 980 * jitter, 0.15, 0.075 * scale, 0, pan, 0.35);
        this.playToneLayer(g, "triangle", 1110 * jitter, 880 * jitter, 0.12, 0.045 * scale, 0.02, pan, 0.35);
        break;
      case "shieldProjector":
      case "gravityAnchor":
      case "countervoidHeart":
        // Warm resonant pulse hum
        this.playToneLayer(g, "sine", 210 * jitter, 160 * jitter, 0.18, 0.09 * scale, 0, pan, 0.32);
        this.playToneLayer(g, "triangle", 315 * jitter, 240 * jitter, 0.14, 0.05 * scale, 0.01, pan, 0.25);
        break;
      case "voidSiphon":
      case "echoMine":
        // Low vacuum suction / kinetic thud
        this.playToneLayer(g, "sine", 110 * jitter, 220 * jitter, 0.15, 0.095 * scale, 0, pan, 0.25);
        this.playNoiseBurst(g, 380 * jitter, 2.0, 0.11, 0.06 * scale, 0, pan, 0.2);
        break;
      default:
        // Tactical infantry/mech/drone crisp shot
        this.playNoiseBurst(g, 1650 * jitter, 2.2, 0.032, 0.055 * scale, 0, pan, 0.12);
        this.playToneLayer(g, "triangle", 260 * jitter, 110, 0.06, 0.065 * scale, 0, pan, 0.12);
        break;
    }
  }

  /** Distinct big-moment strike cues with ducking and dark reverb tail. */
  playStrike(strikeId: StrikeId, spatial?: SpatialParams): void {
    if (!soundOn()) return;
    const nowMs = nowMillis();
    const prev = this.lastSfxAt.get("strikeCast") ?? 0;
    if (nowMs - prev < SFX_COOLDOWN_MS.strikeCast) return;

    const g = this.ensureReady();
    if (!g) return;
    this.lastSfxAt.set("strikeCast", nowMs);

    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 1;
    const gain = clamp(0.75 + distGain * 0.35, 0.5, 1.15);

    g.duck(-4.2, 0.03, 1.1);

    switch (strikeId) {
      case "quarantineBell": {
        // True synthesized bell with inharmonic partials and long shimmering decay
        const base = 311.13 * (0.98 + this.rand() * 0.04); // Eb4
        const partials: [number, number, number][] = [
          [1.0, 1.9, 0.14],
          [2.0, 1.4, 0.08],
          [2.42, 1.15, 0.065],
          [3.01, 0.85, 0.045],
          [4.18, 0.55, 0.03],
        ];
        for (const [ratio, dur, amp] of partials) {
          this.playToneLayer(g, "sine", base * ratio, base * ratio * 0.996, dur, amp * gain, 0, pan, 0.65, true);
        }
        this.playNoiseBurst(g, 2800, 3.0, 0.025, 0.07 * gain, 0, pan, 0.35, false);
        break;
      }
      case "landfall":
        // Heavy orbital land drop: whistling descent + massive tectonic thump
        this.playToneLayer(g, "sine", 420, 48, 0.42, 0.2 * gain, 0, pan, 0.65, true);
        this.playBrownRumble(g, 210, 0.95, 0.24 * gain, 0.05, pan, 0.75);
        this.playNoiseBurst(g, 1100, 1.4, 0.08, 0.14 * gain, 0.04, pan, 0.35, false);
        break;
      case "seismicFrame":
        // Heavy structural lock-in thud + metallic resonance
        this.playToneLayer(g, "sawtooth", 110, 44, 0.45, 0.16 * gain, 0, pan, 0.55, true);
        this.playToneLayer(g, "triangle", 330, 220, 0.55, 0.09 * gain, 0.03, pan, 0.5, true);
        this.playBrownRumble(g, 160, 0.75, 0.18 * gain, 0, pan, 0.6);
        break;
      case "genesis":
        // Rising harmonic terraform bloom
        this.playToneLayer(g, "sine", 146.83, 293.66, 0.75, 0.13 * gain, 0, pan, 0.6, true);
        this.playToneLayer(g, "triangle", 220.0, 440.0, 0.85, 0.1 * gain, 0.08, pan, 0.6, true);
        this.playNoiseBurst(g, 1400, 1.2, 0.35, 0.07 * gain, 0.05, pan, 0.45, true);
        break;
      case "orbitalReinforcement":
        // Pod descent whoosh + crisp landing cluster
        this.playNoiseBurst(g, 1800, 1.5, 0.18, 0.11 * gain, 0, pan, 0.35, false);
        this.playToneLayer(g, "triangle", 520, 120, 0.22, 0.12 * gain, 0.02, pan, 0.3, false);
        this.playToneLayer(g, "sine", 130, 55, 0.2, 0.13 * gain, 0.16, pan, 0.4, true);
        break;
      case "containmentPulse":
      default:
        // Wide shockwave pulse + sub drop
        this.playToneLayer(g, "sawtooth", 260, 58, 0.42, 0.16 * gain, 0, pan, 0.6, true);
        this.playToneLayer(g, "sine", 520, 140, 0.35, 0.1 * gain, 0.04, pan, 0.55, true);
        this.playBrownRumble(g, 240, 0.7, 0.18 * gain, 0.02, pan, 0.65);
        break;
    }
  }

  /** Plays a short, quiet, positional sheep ("baa") or cow ("moo") routed through the SFX bus. */
  playAnimalSound(kind: "sheep" | "cow", spatial?: SpatialParams): void {
    const g = this.ensureReady();
    if (!g) return;
    const nowMs = nowMillis();
    if (nowMs - this.lastAnimalSoundAt < 380) return;
    if (this.activeVoices >= this.maxVoices) return;
    this.lastAnimalSoundAt = nowMs;

    const { ctx, sfxBus, roomVerb } = g;
    const now = ctx.currentTime;
    const pan = spatial ? spatial.pan : 0;
    const distGain = spatial ? spatial.distGain : 0.8;
    const jitter = 0.94 + this.rand() * 0.12;

    this.activeVoices++;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    osc.type = "sawtooth";

    const dur = kind === "sheep" ? 0.24 : 0.36;
    if (kind === "sheep") {
      osc.frequency.setValueAtTime(340 * jitter, now);
      osc.frequency.linearRampToValueAtTime(385 * jitter, now + 0.08);
      osc.frequency.linearRampToValueAtTime(305 * jitter, now + dur);
      filter.frequency.setValueAtTime(1050, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.045 * distGain, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } else {
      osc.frequency.setValueAtTime(155 * jitter, now);
      osc.frequency.linearRampToValueAtTime(138 * jitter, now + 0.14);
      osc.frequency.linearRampToValueAtTime(115 * jitter, now + dur);
      filter.frequency.setValueAtTime(480, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.055 * distGain, now + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    }

    osc.connect(filter);
    filter.connect(gain);
    this.connectPanned(ctx, gain, sfxBus, pan);

    const verbSend = ctx.createGain();
    verbSend.gain.setValueAtTime(0.18, now);
    gain.connect(verbSend);
    verbSend.connect(roomVerb);

    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  // --- Low-level SFX synthesis helpers ---

  private playUiClick(g: SharedAudioGraph, isToggle: boolean): void {
    const { ctx, sfxBus } = g;
    const now = ctx.currentTime;
    this.activeVoices++;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isToggle ? "sine" : "triangle";
    const f0 = isToggle ? 600 : 760;
    const f1 = isToggle ? 460 : 520;
    const dur = isToggle ? 0.038 : 0.045;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(isToggle ? 0.055 : 0.065, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(sfxBus);
    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  private playTowerPlace(g: SharedAudioGraph, pan: number, scale: number, jitter: number): void {
    // Low mechanical anchor thump + short metallic lock click + subtle harmonic confirmation
    this.playToneLayer(g, "sine", 135 * jitter, 58, 0.14, 0.16 * scale, 0, pan, 0.22);
    this.playNoiseBurst(g, 1300 * jitter, 1.8, 0.035, 0.06 * scale, 0.005, pan, 0.15);
    this.playToneLayer(g, "triangle", 480 * jitter, 680 * jitter, 0.09, 0.065 * scale, 0.025, pan, 0.2);
  }

  private playVoidSwallow(g: SharedAudioGraph, pan: number, scale: number, jitter: number): void {
    if (!this.shortNoiseBuf || this.activeVoices >= this.maxVoices) return;
    const { ctx, sfxBus, darkVerb } = g;
    const now = ctx.currentTime;
    this.activeVoices++;

    const src = ctx.createBufferSource();
    src.buffer = this.shortNoiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(240 * jitter, now);
    bp.frequency.exponentialRampToValueAtTime(88 * jitter, now + 0.16);
    bp.Q.setValueAtTime(2.6, now);

    const env = ctx.createGain();
    const peak = 0.085 * scale;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    src.connect(bp);
    bp.connect(env);
    this.connectPanned(ctx, env, sfxBus, pan);

    const send = ctx.createGain();
    send.gain.setValueAtTime(0.32, now);
    env.connect(send);
    send.connect(darkVerb);

    const offset = this.rand() * Math.max(0.1, this.shortNoiseBuf.duration - 0.25);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(now, offset, 0.2);
  }

  private playToneLayer(
    g: SharedAudioGraph,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    delay: number,
    pan: number,
    verbAmt: number,
    useDarkVerb = false,
  ): void {
    if (this.activeVoices >= this.maxVoices) return;
    const { ctx, sfxBus, roomVerb, darkVerb } = g;
    const t0 = ctx.currentTime + delay;
    this.activeVoices++;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 !== f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    }
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.015, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env);
    this.connectPanned(ctx, env, sfxBus, pan);

    if (verbAmt > 0.01) {
      const send = ctx.createGain();
      send.gain.setValueAtTime(verbAmt, t0);
      env.connect(send);
      send.connect(useDarkVerb ? darkVerb : roomVerb);
    }

    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private playNoiseBurst(
    g: SharedAudioGraph,
    centerHz: number,
    q: number,
    dur: number,
    peak: number,
    delay: number,
    pan: number,
    verbAmt: number,
    useDarkVerb = false,
  ): void {
    if (!this.shortNoiseBuf || this.activeVoices >= this.maxVoices) return;
    const { ctx, sfxBus, roomVerb, darkVerb } = g;
    const t0 = ctx.currentTime + delay;
    this.activeVoices++;

    const src = ctx.createBufferSource();
    src.buffer = this.shortNoiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(clamp(centerHz, 60, 8000), t0);
    bp.Q.setValueAtTime(q, t0);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.008, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bp);
    bp.connect(env);
    this.connectPanned(ctx, env, sfxBus, pan);

    if (verbAmt > 0.01) {
      const send = ctx.createGain();
      send.gain.setValueAtTime(verbAmt, t0);
      env.connect(send);
      send.connect(useDarkVerb ? darkVerb : roomVerb);
    }

    const offset = this.rand() * Math.max(0.05, this.shortNoiseBuf.duration - dur - 0.05);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(t0, offset, dur + 0.02);
  }

  private playBrownRumble(
    g: SharedAudioGraph,
    cutoffHz: number,
    dur: number,
    peak: number,
    delay: number,
    pan: number,
    verbAmt: number,
  ): void {
    if (!this.brownBuf || this.activeVoices >= this.maxVoices) return;
    const { ctx, sfxBus, darkVerb } = g;
    const t0 = ctx.currentTime + delay;
    this.activeVoices++;

    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(30, t0);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoffHz, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(45, cutoffHz * 0.45), t0 + dur);

    const env = ctx.createGain();
    const atk = Math.min(0.09, dur * 0.18);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(env);
    this.connectPanned(ctx, env, sfxBus, pan);

    if (verbAmt > 0.01) {
      const send = ctx.createGain();
      send.gain.setValueAtTime(verbAmt, t0);
      env.connect(send);
      send.connect(darkVerb);
    }

    const offset = this.rand() * Math.max(0.5, this.brownBuf.duration - 1.5);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(t0, offset, dur + 0.05);
  }
}
