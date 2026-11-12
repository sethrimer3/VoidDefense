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

export class VoidSoundEngine {
  private active = false;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

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
    const targetGain = 0.08 + takeover * 0.45 + chunkNorm * 0.08;
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
}
