// Usage-driven self-organization (自发秩序) for the cell fabric.
//
// Each fabric edge carries a `usage` weight. A pulse traversing the edge bumps
// it (`reinforceUsage`); idle time fades it (`decayUsage`); a sparse overlay
// adds only the incremental brightness above ①'s arbor baseline
// (`warmRouteBrightnessGain`). Frequently-travelled veins therefore glow and
// persist while cold ones relax back to the resting venation — the network
// self-organizes toward where real block/tx activity flows.
//
// Purely ADDITIVE: with no activity every edge's usage is 0, the boost is
// exactly ×1, and the fabric is byte-identical to ① (zero-drift preserved).
//
// Pure module — the reinforcement STATE lives on NeuralFabric's EdgeStates and
// the pulse driver calls in, but all the math is here and unit-tested (R3F
// effects can't be jsdom-tested).

/** Usage added per pulse traversal of an edge. ~3 crossings saturate it. */
export const REINFORCE_AMOUNT = 0.34;
/** Saturation ceiling — usage is normalized to [0, USAGE_CAP]. */
export const USAGE_CAP = 1.0;
/** Brightness multiplier a fully-saturated edge adds: ×(1 + USAGE_GAIN). */
export const USAGE_GAIN = 1.6;
/** Seconds for an idle edge's usage to halve — its activity "memory". */
export const USAGE_DECAY_HALF_LIFE_S = 3.0;
/** Below this, usage snaps to 0 so the fabric can stop animating and settle.
 *  The floor is a VISIBILITY threshold, not a numerical one: at 0.02 one
 *  crossing's incremental energy is ~1.2% of the resting stroke it rides on —
 *  under the display's own quantization — while every frame below it still
 *  cost the warm overlay a full re-sample and re-upload. Raising it from the
 *  historical 0.002 shortens one crossing's warm tail from ~22 s to ~12 s and
 *  changes nothing anyone can see. */
export const USAGE_EPSILON = 0.02;

/** Usage under which the per-frame colour delta of the warm overlay is a
 *  fraction of a percent of an already faint stroke. The overlay quantizes
 *  its upload in this band (see WARM_TAIL_COMMIT_INTERVAL_S); the decay
 *  itself stays frame-accurate, because decay is bookkeeping and upload is
 *  presentation. */
export const WARM_TAIL_USAGE = 0.1;
/** Sim seconds between warm-overlay uploads inside the deep tail — ~10 Hz.
 *  One crossing decays from WARM_TAIL_USAGE to USAGE_EPSILON over ~7 s, so
 *  this is where most of the tail's bytes were. */
export const WARM_TAIL_COMMIT_INTERVAL_S = 0.1;

/** One pulse crossing: bump usage by `amount`, clamped to the cap. `amount`
 *  defaults to the shipped constant; callers pass the live-tuned value. */
export function reinforceUsage(usage: number, amount = REINFORCE_AMOUNT): number {
  const u = usage + amount;
  return u > USAGE_CAP ? USAGE_CAP : u;
}

/** Exponential decay over `dtSec` with the given half-life (default shipped),
 *  snapping a near-zero remnant to exactly 0. */
export function decayUsage(
  usage: number,
  dtSec: number,
  halfLifeS = USAGE_DECAY_HALF_LIFE_S,
): number {
  if (usage <= USAGE_EPSILON) return 0;
  if (dtSec <= 0) return usage;
  const decayed = usage * Math.pow(2, -dtSec / halfLifeS);
  return decayed <= USAGE_EPSILON ? 0 : decayed;
}

/** Brightness multiplier from usage: 1 (cold, ① unchanged) → 1 + `gain`
 *  (saturated). Linear in normalized usage; `gain` defaults to shipped. */
export function usageBrightnessBoost(usage: number, gain = USAGE_GAIN): number {
  return 1 + gain * (usage / USAGE_CAP);
}

/** Incremental route energy rendered above the immutable passive baseline.
 * Exactly zero for a cold edge, so an idle warm-route layer emits no geometry
 * and cannot force the complete fabric through another GPU upload. */
export function warmRouteBrightnessGain(
  usage: number,
  gain = USAGE_GAIN,
): number {
  return Math.max(0, usageBrightnessBoost(usage, gain) - 1);
}
