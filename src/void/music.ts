/** Procedural, breathing cosmic ambient score for Void Defense.
 *
 * Replaces static continuous drone oscillators with a sparse, event-driven
 * generative score in D Dorian / D minor:
 * - Title & pre-battle: slow, warm chord swells with long attack/release
 *   envelopes and breathing space between phrases, paired with occasional
 *   delicate glass-bell motif notes drifting through the dark reverb.
 * - Battle: tighter harmonic motion plus contact-driven low cinematic pulses
 *   that add urgency without clashing with the Void bed.
 * - Outcome: lush resolved D-major shimmer on victory or melancholic
 *   descending cadence on defeat.
 *
 * Uses a private deterministic RNG so music never touches shared `"game"` or
 * `"effects"` streams, and routes through `musicBus` (with ducking) + `darkVerb`. */

import { random } from "../random.ts";
import { audioGraph, soundOn, type SharedAudioGraph } from "../sound.ts";

const musicRand = random(0x501d0003);

export type MusicPhase = "title" | "battle" | "outcome";

/** Melancholic, vast D-minor / D-Dorian chord voicings (Hz), mid-range for headphone & phone clarity. */
export const MUSIC_CHORDS: readonly (readonly number[])[] = [
  [146.83, 220.0, 261.63, 329.63], // Dm9 (D3, A3, C4, E4)
  [116.54, 174.61, 220.0, 293.66], // BbMaj7 (Bb2, F3, A3, D4)
  [130.81, 196.0, 246.94, 293.66], // C6/9-ish (C3, G3, B3, D4)
  [110.0, 164.81, 220.0, 261.63],  // Am7 (A2, E3, A3, C4)
  [146.83, 196.0, 261.63, 349.23], // Dm11 (D3, G3, C4, F4)
  [174.61, 220.0, 261.63, 329.63], // FMaj7 (F3, A3, C4, E4)
];

/** Sparse upper motif notes (D Dorian: D4, E4, F4, A4, C5, D5, E5). */
const MOTIF_NOTES = [293.66, 329.63, 349.23, 440.0, 523.25, 587.33, 659.25] as const;

export class VoidMusicEngine {
  private graph: SharedAudioGraph | null = null;
  private localGain: GainNode | null = null;
  private active = false;
  private volMaster = 0.8;
  private volMusic = 0.5;
  private lastPhase: MusicPhase | null = null;
  private lastOutcome: "won" | "lost" | null = null;

  private chordIdx = 0;
  private nextChordAtMs = 0;
  private nextMotifAtMs = 0;
  private nextPulseAtMs = 0;
  private activeVoices = 0;
  private readonly maxVoices = 10;

  setVolumes(master: number, music: number): void {
    this.volMaster = Math.max(0, Math.min(1, master));
    this.volMusic = Math.max(0, Math.min(1, music));
    if (this.graph && this.localGain) {
      const target = soundOn() && this.volMaster > 0 && this.volMusic > 0 ? 0.42 : 0;
      this.localGain.gain.setTargetAtTime(target, this.graph.ctx.currentTime, 0.12);
    }
  }

  update(
    phase: MusicPhase,
    contactEdges: number,
    nowMs = typeof performance !== "undefined" ? performance.now() : 0,
  ): void {
    if (!soundOn() || this.volMaster <= 0 || this.volMusic <= 0) {
      if (this.graph && this.localGain) {
        this.localGain.gain.setTargetAtTime(0, this.graph.ctx.currentTime, 0.25);
      }
      return;
    }

    if (!this.active) {
      this.initGraph(nowMs);
    }
    if (!this.graph || !this.localGain || this.graph.ctx.state !== "running") return;

    const now = this.graph.ctx.currentTime;
    this.localGain.gain.setTargetAtTime(0.42, now, 0.35);

    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (phase !== "outcome") this.lastOutcome = null;
      // Nudge next chord softly on phase change without cutting off tails
      if (this.nextChordAtMs > nowMs + 1800) {
        this.nextChordAtMs = nowMs + 900;
      }
    }

    // Outcome phase lets triggerOutcome's cadence ring out without spawning new phrases
    if (phase === "outcome") return;

    const contactNorm = Math.min(1, Math.max(0, contactEdges / 900));

    // 1. Slow breathing chord swells (with open space between swells so it never drones)
    if (nowMs >= this.nextChordAtMs) {
      const chord = MUSIC_CHORDS[this.chordIdx % MUSIC_CHORDS.length];
      // Step forward by 1 or 2 chords for organic non-mechanical motion
      this.chordIdx = (this.chordIdx + (musicRand() < 0.72 ? 1 : 2)) % MUSIC_CHORDS.length;
      const swellDur = phase === "battle" ? 5.2 + musicRand() * 2.0 : 6.4 + musicRand() * 2.4;
      const gapSec = phase === "battle" ? 1.4 + musicRand() * 1.8 : 2.6 + musicRand() * 2.8;
      this.playChordSwell(chord, swellDur, phase === "battle" ? 0.12 + contactNorm * 0.04 : 0.11);
      this.nextChordAtMs = nowMs + (swellDur + gapSec) * 1000;
    }

    // 2. Sparse cosmic glass-bell motif notes
    if (nowMs >= this.nextMotifAtMs) {
      const idx = Math.floor(musicRand() * MOTIF_NOTES.length);
      const freq = MOTIF_NOTES[idx];
      const pan = (musicRand() - 0.5) * 0.65;
      this.playMotifNote(freq, pan, phase === "battle" ? 0.055 : 0.075);
      const waitSec = phase === "battle" ? 3.2 + musicRand() * 4.5 : 4.2 + musicRand() * 5.2;
      this.nextMotifAtMs = nowMs + waitSec * 1000;
    }

    // 3. Battle-only low tension pulse when the Void is actively pressing the frontier
    if (phase === "battle" && contactNorm > 0.08 && nowMs >= this.nextPulseAtMs) {
      const chord = MUSIC_CHORDS[this.chordIdx % MUSIC_CHORDS.length];
      const root = chord[0] * 0.5; // warm low root (~55–87 Hz)
      this.playTensionPulse(root, contactNorm);
      const intervalSec = 3.8 - contactNorm * 1.6 + musicRand() * 1.1;
      this.nextPulseAtMs = nowMs + intervalSec * 1000;
    }
  }

  triggerOutcome(status: "won" | "lost"): void {
    if (!soundOn() || this.volMaster <= 0 || this.volMusic <= 0) return;
    if (this.lastOutcome === status) return;
    this.lastOutcome = status;
    if (!this.active) this.initGraph(typeof performance !== "undefined" ? performance.now() : 0);
    if (!this.graph || !this.localGain || this.graph.ctx.state !== "running") return;

    const notes =
      status === "won"
        ? [220.0, 293.66, 369.99, 440.0, 659.25] // D major 9 shimmer
        : [220.0, 174.61, 146.83, 116.54];       // descending melancholic cadence
    notes.forEach((freq, i) => {
      const pan = (i / Math.max(1, notes.length - 1) - 0.5) * 0.5;
      this.playOutcomeNote(freq, i * 0.18, pan, status === "won" ? 0.14 : 0.12);
    });
  }

  private initGraph(nowMs: number): void {
    const graph = audioGraph();
    if (!graph) return;
    this.graph = graph;
    const { ctx, musicBus } = graph;
    const now = ctx.currentTime;

    this.localGain = ctx.createGain();
    this.localGain.gain.setValueAtTime(0.0001, now);
    this.localGain.connect(musicBus);

    // Stagger initial phrase entries so sound blooms gently after the first click
    this.nextChordAtMs = nowMs + 600;
    this.nextMotifAtMs = nowMs + 2800 + musicRand() * 2200;
    this.nextPulseAtMs = nowMs + 3500;
    this.active = true;
  }

  private playChordSwell(chord: readonly number[], durSec: number, peakPerVoice: number): void {
    if (!this.graph || !this.localGain) return;
    const { ctx, darkVerb } = this.graph;
    const now = ctx.currentTime;
    const attack = durSec * 0.38;
    const release = durSec * 0.62;

    // Play 3 notes from the voicing so polyphony stays light and airy
    const count = Math.min(3, chord.length);
    for (let i = 0; i < count; i++) {
      if (this.activeVoices >= this.maxVoices) break;
      this.activeVoices++;

      const freq = chord[i];
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((musicRand() - 0.5) * 7, now);

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(260, now);
      lp.frequency.linearRampToValueAtTime(640 + i * 140, now + attack);
      lp.frequency.exponentialRampToValueAtTime(220, now + durSec);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peakPerVoice, now + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

      osc.connect(lp);
      lp.connect(env);

      const panVal = (i - 1) * 0.24; // subtle spread: -0.24, 0, +0.24
      if (typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(panVal, now);
        env.connect(panner);
        panner.connect(this.localGain);
      } else {
        env.connect(this.localGain);
      }

      const verbSend = ctx.createGain();
      verbSend.gain.setValueAtTime(0.45, now);
      env.connect(verbSend);
      verbSend.connect(darkVerb);

      osc.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      };
      osc.start(now);
      osc.stop(now + durSec + 0.08);
    }
  }

  private playMotifNote(freq: number, pan: number, peak: number): void {
    if (!this.graph || !this.localGain || this.activeVoices >= this.maxVoices) return;
    const { ctx, darkVerb } = this.graph;
    const now = ctx.currentTime;
    const dur = 2.6 + musicRand() * 1.6;
    this.activeVoices++;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(env);
    if (typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(Math.max(-0.4, Math.min(0.4, pan)), now);
      env.connect(p);
      p.connect(this.localGain);
    } else {
      env.connect(this.localGain);
    }

    const verbSend = ctx.createGain();
    verbSend.gain.setValueAtTime(0.6, now);
    env.connect(verbSend);
    verbSend.connect(darkVerb);

    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(now);
    osc.stop(now + dur + 0.06);
  }

  private playTensionPulse(freq: number, intensity: number): void {
    if (!this.graph || !this.localGain || this.activeVoices >= this.maxVoices) return;
    const { ctx, darkVerb } = this.graph;
    const now = ctx.currentTime;
    const dur = 1.6 + musicRand() * 0.9;
    this.activeVoices++;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(Math.max(55, freq), now);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(140, now);
    lp.frequency.linearRampToValueAtTime(220 + intensity * 240, now + 0.45);
    lp.frequency.exponentialRampToValueAtTime(110, now + dur);
    lp.Q.setValueAtTime(1.6, now);

    const env = ctx.createGain();
    const peak = 0.06 + intensity * 0.08;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.42);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this.localGain);

    const verbSend = ctx.createGain();
    verbSend.gain.setValueAtTime(0.38, now);
    env.connect(verbSend);
    verbSend.connect(darkVerb);

    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(now);
    osc.stop(now + dur + 0.06);
  }

  private playOutcomeNote(freq: number, delay: number, pan: number, peak: number): void {
    if (!this.graph || !this.localGain) return;
    const { ctx, darkVerb } = this.graph;
    const t0 = ctx.currentTime + delay;
    const dur = 1.9;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1600, t0);
    lp.frequency.exponentialRampToValueAtTime(420, t0 + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(lp);
    lp.connect(env);
    if (typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(pan, t0);
      env.connect(p);
      p.connect(this.localGain);
    } else {
      env.connect(this.localGain);
    }

    const verbSend = ctx.createGain();
    verbSend.gain.setValueAtTime(0.55, t0);
    env.connect(verbSend);
    verbSend.connect(darkVerb);

    osc.start(t0);
    osc.stop(t0 + dur + 0.08);
  }

  destroy(): void {
    if (this.graph && this.localGain) {
      this.localGain.gain.setTargetAtTime(0, this.graph.ctx.currentTime, 0.08);
    }
    this.active = false;
  }
}
