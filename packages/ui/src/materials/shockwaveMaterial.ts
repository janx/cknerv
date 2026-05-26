/**
 * Shared block-shockwave uniforms for materials that render real topology
 * geometry: cell cores and cell shells. Nebula gas and other decorative
 * particle fields must not import these, otherwise block waves read as
 * new stars appearing instead of existing cells/nerves brightening.
 */

/**
 * Ring-buffer size for in-flight shockwaves. The `mesh` profile fires
 * blocks at ~2 s effective cadence (3 miners x ~6 s/miner with phase
 * spread) while each wave lives `uShockwaveDurS = 5 s`, so up to ~3
 * waves can be alive at once. 8 slots give comfortable headroom and
 * survive even denser cadences (e.g. dust-stress profiles). Older
 * slots are overwritten round-robin in CellGalaxy.
 *
 * Without this ring buffer, `uShockwaveAt` was a single scalar uniform:
 * every new block trigger overwrote the in-flight wave and cancelled
 * it visually, which read as "the shockwave dies the moment another
 * NervePulses-bearing block trigger fires".
 */
export const SHOCKWAVE_SLOTS = 8;
export const SHOCKWAVE_BAND_BASE = 3.2;
export const SHOCKWAVE_BAND_GROW = 1.25;
export const SHOCKWAVE_COLOR_BOOST = 3.5;
export const SHOCKWAVE_ALPHA_BOOST = 2.0;
export const SHOCKWAVE_SIZE_BOOST = 0.095;
export const SHOCKWAVE_TRAIL_BOOST = 0.055;

export function makeShockwaveAtArray(): Float32Array {
  const a = new Float32Array(SHOCKWAVE_SLOTS);
  a.fill(-1e6);
  return a;
}

export function makeShockwaveOriginArray(): Float32Array {
  return new Float32Array(SHOCKWAVE_SLOTS * 2);
}

/**
 * Shared uniform record for shockwave-aware materials. Each call returns a
 * fresh `{ value }` wrapper so different materials don't share mutable
 * state — `uShockwaveAt` / `uShockwaveOriginXZ` are mutated in place each
 * frame by the trigger code (round-robin into the ring buffer).
 *
 * `uShockwaveSizeBoost` is included unconditionally even though only the
 * core (point-sprite) material reads it; on the shell material it sits as
 * unused state, costing nothing at the GPU level.
 */
export function makeShockwaveUniforms() {
  return {
    uShockwaveAt: { value: makeShockwaveAtArray() },
    uShockwaveOriginXZ: { value: makeShockwaveOriginArray() },
    uShockwaveSpeed: { value: 36 },
    uShockwaveDurS: { value: 5.0 },
    uShockwaveBandBase: { value: SHOCKWAVE_BAND_BASE },
    uShockwaveBandGrow: { value: SHOCKWAVE_BAND_GROW },
    uShockwaveColorBoost: { value: SHOCKWAVE_COLOR_BOOST },
    uShockwaveAlphaBoost: { value: SHOCKWAVE_ALPHA_BOOST },
    uShockwaveSizeBoost: { value: SHOCKWAVE_SIZE_BOOST },
    uShockwaveTrailBoost: { value: SHOCKWAVE_TRAIL_BOOST },
  };
}
