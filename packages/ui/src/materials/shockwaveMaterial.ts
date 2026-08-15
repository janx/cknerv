/**
 * Shared block-shockwave state for materials that render real topology.
 *
 * The production owner is the P2P colony: a new block stamps one wave at its
 * network entry node, and the existing peer nodes brighten as the front crosses
 * them. Decorative particle fields must not import this; otherwise the event
 * reads as new stars appearing instead of network structure carrying a block.
 */
import { SHOCKWAVE_SPEED } from '../ui/topologyConstants';

/**
 * Ring-buffer size for in-flight shockwaves. The `mesh` profile fires
 * blocks at ~2 s effective cadence (3 miners x ~6 s/miner with phase
 * spread) while each wave lives `uShockwaveDurS = 5 s`, so up to ~3
 * waves can be alive at once. 8 slots give comfortable headroom and
 * survive even denser cadences (e.g. dust-stress profiles). Older
 * slots are overwritten round-robin in ColonyNodes.
 *
 * Without this ring buffer, `uShockwaveAt` was a single scalar uniform:
 * every new block trigger overwrote the in-flight wave and cancelled
 * it visually, which read as "the shockwave dies the moment another
 * NervePulses-bearing block trigger fires".
 */
export const SHOCKWAVE_SLOTS = 8;

// Block-shockwave intensities. The wave renders on the actual peer nodes — the
// dense "nebula gas" surface it once painted was removed, and on sparse
// point-sprites the original gas-era boosts
// (color 22 / alpha 14) blew out, so they were dampened. But they were
// dampened so far (color 3.5 / alpha 2.0 / size 0.095) that the spreading
// wave became imperceptible. These mid-range values restore a clearly
// visible, coherent expanding front without white-blobbing the lit peers.
// A wider band lights more nodes at once, so the ring reads as a spreading
// front rather than isolated twinkles. Tune here; inferred and measured
// peer-node materials read these through the same shared uniform record.
export const SHOCKWAVE_BAND_BASE = 5.5;
export const SHOCKWAVE_BAND_GROW = 1.5;
// Halved 2026-07-08 (7.5/5.5 → 3.75/2.75, with the ceils below halved too):
// new-block flash brightness reduced 50% for the blue-white palette. Boost/ceil
// ratio kept, so the onset feel is unchanged and the amplitude is exactly halved.
export const SHOCKWAVE_COLOR_BOOST = 3.75;
export const SHOCKWAVE_ALPHA_BOOST = 2.75;
export const SHOCKWAVE_SIZE_BOOST = 0.5;
export const SHOCKWAVE_TRAIL_BOOST = 0.18;

// Soft-knee ceilings for the wave's brightness/alpha response. The *_BOOST
// values above act as the response's initial slope; these cap how far the peak
// may climb before it rolls off. The shader applies
//   factor = 1 + CEIL * (1 - exp(-shock * BOOST / CEIL))
// so at small shock it matches the old linear `1 + BOOST*shock` (the wave's
// onset/reach — its "punch" — is unchanged), while the bright leading edge
// saturates toward `1 + CEIL` instead of railing past white and hard-clipping.
// This is what takes the searing 刺眼 sting off without dulling the wave. A
// lower CEIL rolls off sooner (softer); raise it toward BOOST to approach the
// old hard-clip look. Tuned by eye in the ui-app harness (shock-check).
//
// At the wavefront (shock ≈ 0.6) these cut the peak boost ~40% vs the old
// linear response — color 5.5×→3.2×, alpha 4.3×→2.7× — so the searing white
// area shrinks and warms, while the front still boosts ~3.2×/2.7× over rest
// (punch preserved). Raise both toward BOOST for less de-glare, lower for more.
export const SHOCKWAVE_COLOR_CEIL = 1.4;
export const SHOCKWAVE_ALPHA_CEIL = 1.1;

/** Wake length as a multiple of the crest half-width — one number for both
 *  planes of the block event (the peer shockwave here, the Cell-field contact
 *  front in contactWaveMaterial). */
export const WAVE_WAKE_LENGTH = 3.2;

/**
 * The ONE crest+wake waveform of a block event, at any scale: a gaussian
 * band `offset` half-widths from the crest, plus an exponential wake gated to
 * the side the wave came from (`signedBehind` > 0). The peer-plane shockwave
 * and the scale-divided Cell-field front both draw THIS profile — the tests
 * pin them as one shape at two sizes, and the shape math living twice is how
 * they had already drifted (wake 3.4 vs 3.2) within a single feature.
 */
export const WAVE_CREST_WAKE_GLSL = /* glsl */ `
  float waveCrestWake(
    float offset,
    float signedBehind,
    float halfWidth,
    float wakeLength,
    float wakeAmp
  ) {
    float crest = exp(-offset * offset);
    float wake = wakeAmp
      * exp(-max(signedBehind, 0.0) / max(halfWidth * wakeLength, 1e-4))
      * step(0.0, signedBehind);
    return crest + wake;
  }
`;

/**
 * GLSL declarations and the single wave-sampling calculation used by both peer
 * node materials. Keeping the ring math here prevents inferred and measured
 * nodes from drifting into two different wavefronts.
 */
export const SHOCKWAVE_UNIFORMS_GLSL = /* glsl */ `
  uniform float uShockwaveAt[${SHOCKWAVE_SLOTS}];
  uniform vec2  uShockwaveOriginXZ[${SHOCKWAVE_SLOTS}];
  uniform vec3  uShockwaveColor[${SHOCKWAVE_SLOTS}];
  uniform float uShockwaveSpeed;
  uniform float uShockwaveDurS;
  uniform float uShockwaveBandBase;
  uniform float uShockwaveBandGrow;
  uniform float uShockwaveColorBoost;
  uniform float uShockwaveAlphaBoost;
  uniform float uShockwaveColorCeil;
  uniform float uShockwaveAlphaCeil;
  uniform float uShockwaveSizeBoost;
  uniform float uShockwaveTrailBoost;
`;

export const SHOCKWAVE_SIGNAL_GLSL = /* glsl */ `
  ${WAVE_CREST_WAKE_GLSL}
  vec4 shockwaveSignalAt(vec2 worldXZ) {
    float total = 0.0;
    vec3 carrier = vec3(0.0);
    for (int i = 0; i < ${SHOCKWAVE_SLOTS}; i++) {
      float age = uTime - uShockwaveAt[i];
      if (age < 0.0 || age >= uShockwaveDurS) continue;
      float ringR = uShockwaveSpeed * age;
      float dist = length(worldXZ - uShockwaveOriginXZ[i]);
      float bandWidth = uShockwaveBandBase + uShockwaveBandGrow * age;
      float t = age / uShockwaveDurS;
      float life = sin(3.14159265 * t)
        * (1.0 - smoothstep(0.3, 1.0, t))
        * (1.0 - t);
      float signal = waveCrestWake(
        (dist - ringR) / bandWidth,
        ringR - dist,
        bandWidth,
        ${WAVE_WAKE_LENGTH.toFixed(1)},
        uShockwaveTrailBoost
      ) * life;
      total += signal;
      carrier += uShockwaveColor[i] * signal;
    }
    return vec4(carrier, total);
  }
`;

export function makeShockwaveAtArray(): Float32Array {
  const a = new Float32Array(SHOCKWAVE_SLOTS);
  a.fill(-1e6);
  return a;
}

export function makeShockwaveOriginArray(): Float32Array {
  return new Float32Array(SHOCKWAVE_SLOTS * 2);
}

export function makeShockwaveColorArray(): Float32Array {
  const colors = new Float32Array(SHOCKWAVE_SLOTS * 3);
  for (let slot = 0; slot < SHOCKWAVE_SLOTS; slot += 1) {
    colors[slot * 3 + 0] = 0.72;
    colors[slot * 3 + 1] = 0.96;
    colors[slot * 3 + 2] = 1.0;
  }
  return colors;
}

/** Write one complete protocol-wave slot without letting time/origin/hue drift. */
export function writeShockwaveSlot(
  at: Float32Array,
  originXZ: Float32Array,
  colors: Float32Array,
  slot: number,
  firedAt: number,
  origin: readonly [number, number],
  color: readonly [number, number, number],
): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SHOCKWAVE_SLOTS) {
    throw new RangeError(`shockwave slot ${slot} is outside 0..${SHOCKWAVE_SLOTS - 1}`);
  }
  at[slot] = firedAt;
  originXZ[slot * 2 + 0] = origin[0];
  originXZ[slot * 2 + 1] = origin[1];
  colors[slot * 3 + 0] = color[0];
  colors[slot * 3 + 1] = color[1];
  colors[slot * 3 + 2] = color[2];
}

/**
 * Shared uniform record for shockwave-aware materials. Each call returns a
 * fresh `{ value }` wrapper so different materials don't share mutable
 * state — `uShockwaveAt` / `uShockwaveOriginXZ` are mutated in place each
 * frame by the trigger code (round-robin into the ring buffer).
 *
 * `uShockwaveSizeBoost` expands both inferred point sprites and measured halo
 * planes at the same front.
 */
export function makeShockwaveUniforms() {
  return {
    uShockwaveAt: { value: makeShockwaveAtArray() },
    uShockwaveOriginXZ: { value: makeShockwaveOriginArray() },
    uShockwaveColor: { value: makeShockwaveColorArray() },
    uShockwaveSpeed: { value: SHOCKWAVE_SPEED },
    uShockwaveDurS: { value: 5.0 },
    uShockwaveBandBase: { value: SHOCKWAVE_BAND_BASE },
    uShockwaveBandGrow: { value: SHOCKWAVE_BAND_GROW },
    uShockwaveColorBoost: { value: SHOCKWAVE_COLOR_BOOST },
    uShockwaveAlphaBoost: { value: SHOCKWAVE_ALPHA_BOOST },
    uShockwaveColorCeil: { value: SHOCKWAVE_COLOR_CEIL },
    uShockwaveAlphaCeil: { value: SHOCKWAVE_ALPHA_CEIL },
    uShockwaveSizeBoost: { value: SHOCKWAVE_SIZE_BOOST },
    uShockwaveTrailBoost: { value: SHOCKWAVE_TRAIL_BOOST },
  };
}

export type ShockwaveUniforms = ReturnType<typeof makeShockwaveUniforms>;
