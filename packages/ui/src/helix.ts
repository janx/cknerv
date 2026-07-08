// Deterministic cell-galaxy positioning — TS twin of `cknerv-core::helix`.
//
// **Determinism is contract**: `helixSeed(id)` here MUST produce the same
// xyz as the Rust port for every id. The shared cross-language fixture
// at `<repo-root>/tests/fixtures/helix_seed.json` anchors this; the parity
// test in `__tests__/helix-parity.test.ts` exercises every entry.
//
// All numeric constants must stay byte-identical to the Rust copy in
// `crates/cknerv-core/src/helix.rs` — do not "simplify" forms (e.g. don't
// turn 0.28 into a fraction). The fixture is the source of truth.

/** mulberry32 PRNG — byte-exact match to the Rust implementation. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Box-Muller transform from two `rand()` uniforms. */
function gauss(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Rust does `(id as u64).wrapping_mul(salt as u64) as u32`. JS Numbers
 * cannot represent the full u64 product above 2^53; use BigInt for the
 * multiplication then truncate to u32 via `& 0xFFFFFFFFn`. The PRNG's
 * own `>>> 0` would also truncate, but doing it here matches the Rust
 * signature exactly and keeps `idSeed` available as a building block.
 */
function idSeed(id: number | bigint, salt: number): number {
  const idBig = typeof id === 'bigint' ? id : BigInt(id);
  const saltBig = BigInt(salt >>> 0);
  return Number((idBig * saltBig) & 0xffffffffn);
}

const CORE_FRACTION = 0.28;
const CORE_SIGMA = 7;
const SPIRAL_ARM_COUNT = 6;
const SPIRAL_ARM_MIN_R = 0.5;
const SPIRAL_ARM_MAX_R = 58;
const SPIRAL_ARM_PITCH = 0.95;
const SPIRAL_ARM_THICKNESS = 0.16;
const SPIRAL_FRACTION = 0.45;
// Smooth axisymmetric disk fill — see the Rust twin (crates/cknerv-core/src/
// helix.rs). Keeps the 6 arms as-is and lifts the inter-arm gaps off black by
// scattering cells at the arms' radial profile but UNIFORM angle. Budget taken
// from FILAMENT (0.20 → 0.03); total cell count unchanged.
const DISK_FRACTION = 0.17;
const FILAMENT_COUNT = 9;
const FILAMENT_MIN_R = 1;
const FILAMENT_MAX_R = 55;
const FILAMENT_THICKNESS = 0.05;
const FILAMENT_FRACTION = 0.03;
const HALO_MIN_R = 12;
const HALO_MAX_R = 55;
const NEBULA_RADIAL_MIN = 1;
const NEBULA_DISK_SIGMA = 1.5;
const NEBULA_ELLIPSE_X = 1.12;
const NEBULA_ELLIPSE_Z = 0.93;
// Universal rim softening — Gaussian scatter scaled by (r/50)² capped at
// 1, so inner cells barely move while rim cells get a noticeable push.
// Turns the disc boundary into a wispy taper instead of a clean ellipse.
const RIM_SOFTNESS_REF_R = 50;
const RIM_SOFTNESS_SCALE = 3;

/**
 * Deterministic Crab + Milky-Way nebula sample as JS f64 values.
 * Consumers that need byte-parity with Rust's `helix_seed_for` (f32)
 * should use {@link helixSeed} instead.
 */
export function helixSeedF64(id: number | bigint): [number, number, number] {
  // Bigint-safe modulus / division for the per-arm and per-filament
  // bucketing. The arms and filaments only depend on `id % small_count`,
  // which yields a small number convertible to Number losslessly.
  const idBig = typeof id === 'bigint' ? id : BigInt(id);
  const armIndex = Number(idBig % BigInt(SPIRAL_ARM_COUNT));
  const filamentIndex = Number(idBig % BigInt(FILAMENT_COUNT));

  const rand = mulberry32(idSeed(idBig, 2654435761));
  const u = rand();

  let r: number;
  let theta: number;

  const coreEnd = CORE_FRACTION;
  const spiralEnd = coreEnd + SPIRAL_FRACTION;
  const diskEnd = spiralEnd + DISK_FRACTION;
  const filamentEnd = diskEnd + FILAMENT_FRACTION;

  if (u < coreEnd) {
    r = Math.abs(gauss(rand)) * CORE_SIGMA;
    theta = rand() * Math.PI * 2;
  } else if (u < spiralEnd) {
    const armOffset = (armIndex / SPIRAL_ARM_COUNT) * Math.PI * 2;
    const radialEased = 1 - Math.pow(2 * rand() - 1, 2);
    r =
      SPIRAL_ARM_MIN_R +
      Math.pow(rand(), 0.7) * (SPIRAL_ARM_MAX_R - SPIRAL_ARM_MIN_R) +
      (radialEased - 0.5) * 2;
    const spiralAngle = SPIRAL_ARM_PITCH * Math.log(Math.max(r, 1));
    const tangentialJitter = gauss(rand) * SPIRAL_ARM_THICKNESS;
    theta = armOffset + spiralAngle + tangentialJitter;
  } else if (u < diskEnd) {
    // Smooth disk fill — arms' radial profile, UNIFORM angle. Two rand() calls
    // (r, theta); order MUST match the Rust twin exactly.
    r = SPIRAL_ARM_MIN_R + Math.pow(rand(), 0.7) * (SPIRAL_ARM_MAX_R - SPIRAL_ARM_MIN_R);
    theta = rand() * Math.PI * 2;
  } else if (u < filamentEnd) {
    const baseAngle = (filamentIndex / FILAMENT_COUNT) * Math.PI * 2;
    r = FILAMENT_MIN_R + rand() * (FILAMENT_MAX_R - FILAMENT_MIN_R);
    const driftSign = filamentIndex % 2 === 0 ? 1 : -1;
    const drift = driftSign * 0.005 * (r - 30);
    theta = baseAngle + drift + gauss(rand) * FILAMENT_THICKNESS;
  } else {
    // Gaussian-tail halo: cells cluster near the inner halo rim and
    // taper out smoothly with rare extreme outliers, so the outer
    // boundary reads as a soft fall-off rather than a hard disc edge.
    const halfRange = (HALO_MAX_R - HALO_MIN_R) / 2;
    r = HALO_MIN_R + Math.abs(gauss(rand)) * halfRange;
    theta = rand() * Math.PI * 2;
  }

  // Universal rim softening — apply BEFORE the lower clamp so any
  // inward-scattered cells still get pulled back to NEBULA_RADIAL_MIN.
  // Outward extreme tail is intentionally unbounded; the rim is meant
  // to feather out into a wisp rather than terminate cleanly.
  const softness = Math.min(1, (r / RIM_SOFTNESS_REF_R) ** 2);
  r = r + gauss(rand) * RIM_SOFTNESS_SCALE * softness;

  if (r < NEBULA_RADIAL_MIN) r = NEBULA_RADIAL_MIN;

  const y = gauss(rand) * NEBULA_DISK_SIGMA;
  return [
    Math.cos(theta) * r * NEBULA_ELLIPSE_X,
    y,
    Math.sin(theta) * r * NEBULA_ELLIPSE_Z,
  ];
}

/**
 * f32 wire-boundary version of {@link helixSeedF64}. Uses `Math.fround`
 * to mirror Rust's `as f32` downcast — without this, JS would return f64
 * values that drift from the Rust port at the f32-precision boundary
 * and the cross-language parity test would fail.
 */
export function helixSeed(id: number | bigint): [number, number, number] {
  const [x, y, z] = helixSeedF64(id);
  return [Math.fround(x), Math.fround(y), Math.fround(z)];
}
