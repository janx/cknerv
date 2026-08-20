// Shared GLSL fragments consumed by the cell, flare, and shell materials in
// the topology scene. Single Calculation Path: every birth/death/flash
// envelope resolves to these exact functions.

export const HASH11_GLSL = /* glsl */ `
  float hash11(float p) { return fract(sin(p * 12.9898) * 43758.5453); }
`;

/** Ramp fraction the growth springs past resting size at, and the gain it
 *  springs by. A birth is an unfolding, not a pop: the body creeps out while
 *  the ramp is young, expands fastest around the midpoint, overshoots here,
 *  and is back at rest by ramp end. The peak must sit late enough to read as
 *  a spring and early enough to leave the settle room. */
export const BIRTH_OVERSHOOT_AT = 0.78;
export const BIRTH_OVERSHOOT_GAIN = 0.06;

/** Ramp fraction the withering keeps FULL size through. Scale loss spread
 *  evenly over the window reads as a balloon deflating; weighting it into the
 *  tail lets the corpse cool and gutter at size, then crumble. */
export const DEATH_SCALE_KNEE = 0.4;

// Chain birth/death scale curves. Both must be exactly 0 at ramp 0 and
// exactly 1 at ramp 1: the unborn state and the settled state are pixels the
// curve may leave no residue on.
export const BIRTH_DEATH_GLSL = /* glsl */ `
  float birthEase(float r) {
    float t = r / ${BIRTH_OVERSHOOT_AT.toFixed(2)};
    float grow = smoothstep(0.0, 1.0, t * t);
    float settle = smoothstep(${BIRTH_OVERSHOOT_AT.toFixed(2)}, 1.0, r);
    return grow + ${BIRTH_OVERSHOOT_GAIN.toFixed(2)} * (grow - settle);
  }
  float deathEase(float r) {
    float crumble = smoothstep(${DEATH_SCALE_KNEE.toFixed(1)}, 1.0, r);
    return crumble * crumble;
  }
`;

// TS mirror of the two curves above. The GLSL is the render truth — nothing
// on screen ever calls these — and no test can compare the two across the
// language boundary, so the mirror earns its place only by staying
// STRUCTURALLY identical line for line: same constants, same intermediate
// names, same order. Review diffs the two blocks; the shape assertions in
// __tests__/materials/cellEnvelope.glsl.test.ts then hold the mirror (and
// therefore the intent) to the gesture the plan specified.
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function birthEase(r: number): number {
  const t = r / BIRTH_OVERSHOOT_AT;
  const grow = smoothstep(0, 1, t * t);
  const settle = smoothstep(BIRTH_OVERSHOOT_AT, 1, r);
  return grow + BIRTH_OVERSHOOT_GAIN * (grow - settle);
}

export function deathEase(r: number): number {
  const crumble = smoothstep(DEATH_SCALE_KNEE, 1, r);
  return crumble * crumble;
}

/** What the vertex stage actually multiplies the sprite by while withering.
 *  Kept beside its ease so the "holds size, then crumbles" property is
 *  assertable as one number instead of being re-derived per call site. */
export function deathScale(r: number): number {
  return 1 - deathEase(r);
}

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
