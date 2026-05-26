// Shared GLSL fragments consumed by cellHybridMaterial.ts and
// cellShellMaterial.ts. Single Calculation Path: every birth/death/flash
// envelope in the topology scene resolves to these exact functions.

export const HASH11_GLSL = /* glsl */ `
  float hash11(float p) { return fract(sin(p * 12.9898) * 43758.5453); }
`;

export const BIRTH_DEATH_GLSL = /* glsl */ `
  float birthEase(float r) { return 1.0 - pow(1.0 - r, 3.0); }
  float deathEase(float r) { return pow(r, 3.0); }
`;

// Returns 0 outside the [0, 0.5s) flash window so callers do not have to
// gate on age themselves. Inside the window: attack × decay.
export const FLASH_ENV_GLSL = /* glsl */ `
  float flashEnv(float age) {
    if (age < 0.0 || age >= 0.5) return 0.0;
    return smoothstep(0.0, 0.035, age) * exp(-age * 7.0);
  }
`;
