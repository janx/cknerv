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

export const CELL_FLASH_DURATION_S = 0.5;

// Returns 0 outside the flash window so callers do not have to
// gate on age themselves. Inside the window: attack × decay.
export const FLASH_ENV_GLSL = /* glsl */ `
  float flashEnv(float age) {
    if (age < 0.0 || age >= ${CELL_FLASH_DURATION_S.toFixed(1)}) return 0.0;
    return smoothstep(0.0, 0.035, age) * exp(-age * 7.0);
  }
`;
