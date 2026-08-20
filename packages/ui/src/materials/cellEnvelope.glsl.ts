// Shared GLSL fragments consumed by the cell, flare, and shell materials in
// the topology scene. Single Calculation Path: every birth/death/flash
// envelope resolves to these exact functions.

export const HASH11_GLSL = /* glsl */ `
  float hash11(float p) { return fract(sin(p * 12.9898) * 43758.5453); }
`;

export const BIRTH_DEATH_GLSL = /* glsl */ `
  float birthEase(float r) { return 1.0 - pow(1.0 - r, 3.0); }
  float deathEase(float r) { return pow(r, 3.0); }
`;

/** Sprite scale a cell is resolved IN from, and released OUT to. Both stay
 *  well clear of 0: the gesture is a fade with a hint of approach, not a
 *  second birth or a second death. */
export const STAGE_ENTER_SCALE_FROM = 0.65;
export const STAGE_EXIT_SCALE_TO = 0.75;

// Stage-resolution envelope, shared by every layer that draws a Cell body so
// the dot and its write flare resolve as one object. Enter/exit are VIEW
// events, so they compose MULTIPLICATIVELY with the record's own birth/death
// rather than replacing it:
//   scale = enterScale × birthEase × (1 − deathEase) × exitScale
//   alpha = enterEase × (1 − exitEase)
// Sentinel stamps (aEnterAt −1e9, aExitAt +1e9) drive their ramp to the inert
// end with no branch, exactly as aDeathAt = 1e9 already does for withering.
export const STAGE_ENVELOPE_GLSL = /* glsl */ `
  float stageRamp(float t, float at, float durS) {
    return clamp((t - at) / durS, 0.0, 1.0);
  }
  float stageEase(float r) { return smoothstep(0.0, 1.0, r); }
  // x = sprite scale factor, y = alpha factor.
  vec2 stageEnvelope(float enterEased, float exitEased) {
    return vec2(
      mix(${STAGE_ENTER_SCALE_FROM.toFixed(2)}, 1.0, enterEased)
        * mix(1.0, ${STAGE_EXIT_SCALE_TO.toFixed(2)}, exitEased),
      enterEased * (1.0 - exitEased)
    );
  }
`;

export const CELL_FLASH_DURATION_S = 0.5;

// Returns 0 outside the flash window so callers do not have to
// gate on age themselves. Inside the window: attack × decay.
export const FLASH_ENV_GLSL = /* glsl */ `
  float flashEnv(float age) {
    if (age < 0.0 || age >= ${CELL_FLASH_DURATION_S.toFixed(1)}) return 0.0;
    return smoothstep(0.0, 0.035, age) * exp(-age * 7.0);
  }
`;
