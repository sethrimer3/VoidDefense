/** Pure, Node-safe audio math and spatialization helpers for Void Defense.
 *
 * Kept separate from Web Audio nodes so every mapping curve, panning calculation,
 * voice selector, and event merger can be unit-tested deterministically without
 * a browser environment. */

import { random } from "../random.ts";

/** Creates a private seeded RNG for audio variation, never touching shared game/effects streams. */
export function createAudioRng(seed: number): () => number {
  return random(seed);
}

/** Clamps `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Smooth Hermite interpolation from 0 to 1 between `edge0` and `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface SpatialParams {
  /** Subtle stereo pan in `[-maxPan, +maxPan]`, 0 at viewport centre. */
  pan: number;
  /** Distance-based gain attenuation in `[0.18, 1]`. */
  distGain: number;
  /** Suggested low-pass cutoff (Hz) for subtle off-centre/off-screen muffling. */
  lpfHz: number;
  /** Whether the source lies inside the visible viewport. */
  onScreen: boolean;
}

/** Maps a viewport-space point `(screenX, screenY)` in `[0..viewW, 0..viewH]`
 * to gentle stereo pan, distance gain, and optional low-pass frequency. */
export function screenToSpatial(
  screenX: number,
  screenY: number,
  viewW: number,
  viewH: number,
  maxPan = 0.6,
): SpatialParams {
  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const halfW = safeW * 0.5;
  const halfH = safeH * 0.5;
  const nx = (screenX - halfW) / halfW; // -1 at left edge, 0 centre, +1 right edge
  const ny = (screenY - halfH) / halfH; // -1 at top edge, 0 centre, +1 bottom edge
  const pan = clamp(nx, -1, 1) * maxPan;
  const onScreen = screenX >= 0 && screenX <= safeW && screenY >= 0 && screenY <= safeH;
  const radial = Math.hypot(nx, ny); // 0 at centre, ~1.41 at corners, >1.41 off-screen
  const distGain = onScreen
    ? clamp(1 - Math.max(0, radial - 0.35) * 0.28, 0.55, 1)
    : clamp(0.55 / (1 + Math.max(0, radial - 1.0) * 0.9), 0.18, 0.55);
  const lpfHz = onScreen
    ? Math.round(16000 - clamp(radial, 0, 1.5) * 3500)
    : Math.round(clamp(9000 / (1 + Math.max(0, radial - 1.0) * 1.1), 1600, 9000));
  return { pan, distGain, lpfHz, onScreen };
}

/** Zoom-gated audibility for street and farm fires.
 * Silent at full-city overview (`zoom <= 1.4`), smoothly rising to 1.0 by `zoom >= 5.0`. */
export function fireZoomGain(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 1.4) return 0;
  return smoothstep(1.4, 5.0, zoom);
}

/** Zoom-gated audibility for close-up city neon hum and rooftop rain detail. */
export function cityDetailZoomGain(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 1.25) return 0;
  return smoothstep(1.25, 4.5, zoom);
}

export interface VoidBedParams {
  /** Stereo width in `[0.08, 0.95]`: narrow/mono when Void is small, wide when large. */
  width: number;
  /** Subtle horizontal pan in `[-0.35, 0.35]` weighted toward where the Void actually is. */
  pan: number;
  /** Deep tectonic rumble layer gain (30-95 Hz). */
  rumbleGain: number;
  /** Mid-low body layer gain (90-300 Hz, audible on phone/laptop speakers). */
  bodyGain: number;
  /** Faint airy cosmic wind layer gain (1.1-3.8 kHz). */
  airyGain: number;
  /** Soft harmonic pad gain. */
  padGain: number;
  /** Main bed low-pass filter target (Hz). */
  bodyCutoffHz: number;
  /** Distant earthquake swell / groan intensity in `[0, 1]`. */
  quakeIntensity: number;
}

/** Computes target parameters for the living Void bed from game state. */
export function computeVoidBedParams(
  cityPreservedPct: number,
  contactEdges: number,
  fallingChunks: number,
  horizontalExtent: number,
  centroidXNorm: number,
  zoom = 1,
): VoidBedParams {
  const takeover = clamp((100 - cityPreservedPct) / 100, 0, 1);
  const contactNorm = clamp(contactEdges / 1400, 0, 1);
  const chunkNorm = clamp(fallingChunks / 36, 0, 1);
  const extent = clamp(horizontalExtent, 0, 1);
  // Slight pullback of vast Void rumble when zoomed way into city details
  const zoomPullback = 1 - smoothstep(2.0, 6.0, zoom) * 0.22;

  // Width grows monotonically with takeover and horizontal span across the board
  const width = clamp(0.08 + takeover * 0.52 + extent * 0.35, 0.08, 0.95);
  // Gentle pan toward where the Void's horizontal centroid sits
  const pan = clamp((clamp(centroidXNorm, 0, 1) - 0.5) * 2, -1, 1) * 0.35 * (0.3 + 0.7 * (1 - extent * 0.6));

  // Small Void: quiet, mostly airy wind + soft body hum; Large Void: deep rumble + wide presence
  const rumbleGain = (0.04 + Math.pow(takeover, 1.15) * 0.34 + contactNorm * 0.09 + chunkNorm * 0.08) * zoomPullback;
  const bodyGain = (0.06 + takeover * 0.26 + contactNorm * 0.14 + chunkNorm * 0.06) * zoomPullback;
  const airyGain = (0.07 + takeover * 0.1 + contactNorm * 0.08) * (0.85 + 0.15 * zoomPullback);
  const padGain = (0.05 + takeover * 0.15 + contactNorm * 0.04) * zoomPullback;
  const bodyCutoffHz = 135 + Math.pow(takeover, 1.2) * 185 + contactNorm * 75 + chunkNorm * 45;
  const quakeIntensity = clamp((takeover - 0.06) * 1.15 + extent * 0.25 + chunkNorm * 0.2, 0, 1);

  return {
    width,
    pan,
    rumbleGain,
    bodyGain,
    airyGain,
    padGain,
    bodyCutoffHz,
    quakeIntensity,
  };
}

export interface FireCandidate {
  id: number;
  screenX: number;
  screenY: number;
  /** 0 = trash can (brighter), 1 = debris pile (mid), 2 = trash heap / farm fire (warmer/larger). */
  kind: 0 | 1 | 2;
  /** Optional relative scale (1 for street fires, >1 for large farm fire clusters). */
  scale?: number;
}

export interface SelectedFireVoice {
  id: number;
  pan: number;
  gain: number;
  /** Bandpass centre frequency (Hz) reflecting fire kind. */
  centerHz: number;
  /** Whether this fire merits a soft low "whoomph" body layer. */
  isLarge: boolean;
}

/** Selects up to `maxVoices` nearest visible fires weighted by viewport centre distance and zoom. */
export function selectFireVoices(
  candidates: readonly FireCandidate[],
  viewW: number,
  viewH: number,
  zoom: number,
  maxVoices = 4,
): SelectedFireVoice[] {
  const zGain = fireZoomGain(zoom);
  if (zGain <= 0 || maxVoices <= 0 || candidates.length === 0) return [];

  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const halfW = safeW * 0.5;
  const halfH = safeH * 0.5;
  const marginX = safeW * 0.12;
  const marginY = safeH * 0.12;

  const scored: { voice: SelectedFireVoice; score: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (
      c.screenX < -marginX ||
      c.screenX > safeW + marginX ||
      c.screenY < -marginY ||
      c.screenY > safeH + marginY
    ) {
      continue;
    }
    const nx = (c.screenX - halfW) / halfW;
    const ny = (c.screenY - halfH) / halfH;
    const radial = Math.hypot(nx, ny);
    // Smooth falloff from centre to edge + fade off-screen
    const distWeight = clamp(1 - radial * 0.62, 0, 1);
    if (distWeight <= 0.02) continue;
    const scale = clamp(c.scale ?? 1, 0.7, 2.2);
    const gain = clamp(zGain * distWeight * (0.55 + 0.3 * scale), 0, 1);
    const pan = clamp(nx, -1, 1) * 0.6;
    const centerHz = c.kind === 0 ? 1850 : c.kind === 1 ? 1320 : 920;
    const isLarge = c.kind === 2 || scale > 1.25;
    scored.push({
      voice: { id: c.id, pan, gain, centerHz, isLarge },
      score: gain,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.voice.id - b.voice.id);
  const count = Math.min(maxVoices, scored.length);
  const out: SelectedFireVoice[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = scored[i].voice;
  return out;
}

export interface CollapseEventInput {
  x: number;
  y: number;
  /** Number of columns/chunks or relative building size (1 = small spall, 10+ = skyscraper). */
  size: number;
}

export interface MergedCollapseEvent {
  x: number;
  y: number;
  /** Combined magnitude, capped at 24. */
  size: number;
  count: number;
}

/** Merges simultaneous collapse events into a single weighted event (or at most `maxEvents`)
 * so mass collapses sound like one huge roar rather than stacking voices. */
export function mergeCollapseEvents(
  events: readonly CollapseEventInput[],
  maxEvents = 1,
): MergedCollapseEvent[] {
  if (events.length === 0 || maxEvents <= 0) return [];
  if (maxEvents === 1 || events.length === 1) {
    let wx = 0;
    let wy = 0;
    let totalSize = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const w = Math.max(0.5, e.size);
      wx += e.x * w;
      wy += e.y * w;
      totalSize += w;
    }
    return [
      {
        x: wx / totalSize,
        y: wy / totalSize,
        size: Math.min(24, totalSize),
        count: events.length,
      },
    ];
  }

  // Sort largest first, keep up to maxEvents by merging tail into the nearest kept event
  const sorted = [...events].sort((a, b) => b.size - a.size);
  const kept: MergedCollapseEvent[] = [];
  for (let i = 0; i < Math.min(maxEvents, sorted.length); i++) {
    kept.push({ x: sorted[i].x, y: sorted[i].y, size: Math.max(0.5, sorted[i].size), count: 1 });
  }
  for (let i = maxEvents; i < sorted.length; i++) {
    const e = sorted[i];
    let bestIdx = 0;
    let bestD = Infinity;
    for (let j = 0; j < kept.length; j++) {
      const d = Math.hypot(e.x - kept[j].x, e.y - kept[j].y);
      if (d < bestD) {
        bestD = d;
        bestIdx = j;
      }
    }
    const target = kept[bestIdx];
    const w = Math.max(0.5, e.size);
    const nextSize = target.size + w;
    target.x = (target.x * target.size + e.x * w) / nextSize;
    target.y = (target.y * target.size + e.y * w) / nextSize;
    target.size = Math.min(24, nextSize);
    target.count++;
  }
  return kept;
}
