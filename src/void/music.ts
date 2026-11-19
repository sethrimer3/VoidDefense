/** Procedural, low-CPU Web Audio ambient score for Void Defense.
 * Crossfades between a calm title/inter-run pad, a tension layer driven by
 * Void frontier contacts during battle, and a short victory/defeat resolve. */

import { stream } from "../random.ts";
import { audioGraph, soundOn } from "../sound.ts";

const rand = stream("effects");

export type MusicPhase = "title" | "battle" | "outcome";

export class VoidMusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private tensionGain: GainNode | null = null;
  private tensionFilter: BiquadFilterNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private oscPadA: OscillatorNode | null = null;
  private oscPadB: OscillatorNode | null = null;
  private oscTension: OscillatorNode | null = null;
  private oscPulse: OscillatorNode | null = null;
  private active = false;
  private volMaster = 0.8;
  private volMusic = 0.5;
  private lastPhase: MusicPhase | null = null;
  private lastUpdateAt = 0;
  private lastOutcome: "won" | "lost" | null = null;

  setVolumes(master: number, music: number): void {
    this.volMaster = Math.max(0, Math.min(1, master));
    this.volMusic = Math.max(0, Math.min(1, music));
    if (this.ctx && this.masterGain) {
      const target = soundOn() ? this.volMaster * this.volMusic * 0.22 : 0;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    }
  }

  update(phase: MusicPhase, contactEdges: number, nowMs = performance.now()): void {
    if (!soundOn() || this.volMaster <= 0 || this.volMusic <= 0) {
      if (this.ctx && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      }
      return;
    }

    if (!this.active) {
      this.initGraph();
    }
    if (!this.ctx || !this.masterGain || !this.padGain || !this.tensionGain) return;
    if (this.ctx.state !== "running") return;

    if (phase === this.lastPhase && nowMs - this.lastUpdateAt < 250) return;
    this.lastUpdateAt = nowMs;
    this.lastPhase = phase;
    if (phase !== "outcome") this.lastOutcome = null;

    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.volMaster * this.volMusic * 0.22, now, 0.2);

    const contactNorm = Math.min(1, Math.max(0, contactEdges / 700));
    if (phase === "title") {
      this.padGain.gain.setTargetAtTime(0.65, now, 0.6);
      this.tensionGain.gain.setTargetAtTime(0.0, now, 0.5);
      this.padFilter?.frequency.setTargetAtTime(420, now, 0.6);
    } else if (phase === "battle") {
      this.padGain.gain.setTargetAtTime(0.45, now, 0.5);
      this.tensionGain.gain.setTargetAtTime(0.12 + contactNorm * 0.48, now, 0.4);
      this.padFilter?.frequency.setTargetAtTime(520 + contactNorm * 260, now, 0.5);
      this.tensionFilter?.frequency.setTargetAtTime(240 + contactNorm * 620, now, 0.35);
    } else {
      this.padGain.gain.setTargetAtTime(0.35, now, 0.6);
      this.tensionGain.gain.setTargetAtTime(0.0, now, 0.4);
      this.padFilter?.frequency.setTargetAtTime(340, now, 0.6);
    }
  }

  triggerOutcome(status: "won" | "lost"): void {
    if (!soundOn() || this.volMaster <= 0 || this.volMusic <= 0) return;
    if (this.lastOutcome === status) return;
    this.lastOutcome = status;
    if (!this.active) this.initGraph();
    if (!this.ctx || !this.masterGain || this.ctx.state !== "running") return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = status === "won" ? [220, 277.18, 329.63, 440] : [196, 174.61, 146.83];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.linearRampToValueAtTime(0.28, now + i * 0.14 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 1.1);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 1.15);
    });
  }

  private initGraph(): void {
    const graph = audioGraph();
    if (!graph) return;
    const { ctx, out } = graph;
    this.ctx = ctx;
    const now = ctx.currentTime;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0001, now);
    this.masterGain.connect(out);

    // Calm pad layer (D2 + A2 fifth with subtle detune)
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.setValueAtTime(420, now);

    this.padGain = ctx.createGain();
    this.padGain.gain.setValueAtTime(0.5, now);
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.masterGain);

    const detune = (rand() - 0.5) * 4;
    this.oscPadA = ctx.createOscillator();
    this.oscPadA.type = "sine";
    this.oscPadA.frequency.setValueAtTime(146.83, now); // D3
    this.oscPadA.detune.setValueAtTime(detune, now);
    this.oscPadA.connect(this.padFilter);

    this.oscPadB = ctx.createOscillator();
    this.oscPadB.type = "triangle";
    this.oscPadB.frequency.setValueAtTime(220.0, now); // A3
    this.oscPadB.detune.setValueAtTime(-detune, now);
    this.oscPadB.connect(this.padFilter);

    // Battle tension layer (filtered low saw + minor-second pulse)
    this.tensionFilter = ctx.createBiquadFilter();
    this.tensionFilter.type = "lowpass";
    this.tensionFilter.frequency.setValueAtTime(260, now);
    this.tensionFilter.Q.setValueAtTime(2.5, now);

    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.setValueAtTime(0.0, now);
    this.tensionFilter.connect(this.tensionGain);
    this.tensionGain.connect(this.masterGain);

    this.oscTension = ctx.createOscillator();
    this.oscTension.type = "sawtooth";
    this.oscTension.frequency.setValueAtTime(73.42, now); // D2
    this.oscTension.connect(this.tensionFilter);

    this.oscPulse = ctx.createOscillator();
    this.oscPulse.type = "triangle";
    this.oscPulse.frequency.setValueAtTime(155.56, now); // Eb3 tension interval
    this.oscPulse.connect(this.tensionFilter);

    this.oscPadA.start(now);
    this.oscPadB.start(now);
    this.oscTension.start(now);
    this.oscPulse.start(now);
    this.active = true;
  }

  destroy(): void {
    try {
      this.oscPadA?.stop();
      this.oscPadB?.stop();
      this.oscTension?.stop();
      this.oscPulse?.stop();
    } catch {
      // ignore if already stopped
    }
    this.active = false;
  }
}
