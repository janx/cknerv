// Deterministic cell-galaxy positioning — TS twin of `cknerv-core::helix`.
//
// **Determinism is contract**: `helixSeed(id)` here MUST produce the same
// xyz as the Rust port for every id. The shared cross-language fixture
// at `<repo-root>/tests/fixtures/helix_seed.json` anchors this; the parity
// test in `__tests__/helix-parity.test.ts` exercises every entry.
//
// All numeric constants and operation order must stay aligned with
// `crates/cknerv-core/src/helix.rs`. The fixture is the source of truth.

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

/** `(id * salt) mod 2^32`, without JS Number precision loss. */
function idSeed(id: number | bigint, salt: number): number {
  const idBig = typeof id === 'bigint' ? id : BigInt(id);
  const saltBig = BigInt(salt >>> 0);
  return Number((idBig * saltBig) & 0xffffffffn);
}

/** Tissue footprint half-extents (galaxy-local). This module is the authority
 * on where the Cell field ends: layers that must respect the rim — delivery
 * landings, the contact front's extinction band — derive from these two
 * numbers instead of restating them. (Density thins from ~0.61 of this
 * ellipse outward and a ~4.5% halo drifts a little past it, so the rim is a
 * band, not a wall — but the band is anchored here.) */
export const FIELD_HALF_X = 60;
export const FIELD_HALF_Z = 54;
const SAMPLE_ATTEMPTS = 10;
const HALO_FRACTION = 0.045;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Integer avalanche shared with the Rust port. */
function latticeValue(ix: number, iz: number, salt: number): number {
  let h = (
    Math.imul(ix | 0, 0x1f123bb5)
    ^ Math.imul(iz | 0, 0x5f356495)
    ^ (salt >>> 0)
  ) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffff_ffff * 2 - 1;
}

/** Smooth deterministic 2D value noise in [-1, 1]. No transcendental branch
 * decisions: Rust and JS therefore choose the same rejection-sampling path. */
function valueNoise2(x: number, z: number, scale: number, salt: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = gx - ix;
  const tz = gz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = latticeValue(ix, iz, salt);
  const b = latticeValue(ix + 1, iz, salt);
  const c = latticeValue(ix, iz + 1, salt);
  const d = latticeValue(ix + 1, iz + 1, salt);
  const nx0 = a + (b - a) * sx;
  const nx1 = c + (d - c) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

interface TissueField {
  density: number;
  ridge: number;
  qx: number;
  qz: number;
}

/**
 * Domain-warped, multi-scale tissue density. Broad noise makes unequal organs,
 * a ridged octave makes branching growth corridors, and an independent field
 * carves cavities. Unlike fixed lobe/tendril tables, denser sampling reveals
 * more irregular structure instead of converging on a small repeated template.
 */
function tissueField(x: number, z: number): TissueField {
  const warpX = valueNoise2(x, z, 34, 0x68bc21eb) * 11
    + valueNoise2(x, z, 17, 0x02e5be93) * 3.5;
  const warpZ = valueNoise2(x, z, 37, 0x967a889b) * 10
    + valueNoise2(x, z, 19, 0x4f1bbcdc) * 3.5;
  const qx = x + warpX;
  const qz = z + warpZ;

  const broad = 0.5 + 0.5 * valueNoise2(qx, qz, 35, 0x9e3779b9);
  const middle = 0.5 + 0.5 * valueNoise2(qx, qz, 17, 0x243f6a88);
  const broadRidgeBase = 1 - Math.abs(valueNoise2(qx, qz, 23, 0x3c6ef372));
  const broadRidge = broadRidgeBase * broadRidgeBase * broadRidgeBase;
  const ridgeBase = 1 - Math.abs(valueNoise2(qx, qz, 11, 0xb7e15162));
  const ridge2 = ridgeBase * ridgeBase;
  const ridge = ridge2 * ridge2;
  const voidField = 0.5 + 0.5 * valueNoise2(qx - 13, qz + 9, 19, 0xdeadbeef);
  const cavity = smoothstep(0.64, 0.88, voidField);

  const nx = x / FIELD_HALF_X;
  const nz = z / FIELD_HALF_Z;
  const radial = Math.sqrt(nx * nx + nz * nz);
  const boundaryWarp = valueNoise2(x, z, 42, 0xa341316c) * 0.13
    + valueNoise2(x, z, 21, 0xc8013ea4) * 0.055;
  const envelope = 1 - smoothstep(0.61, 1.04, radial + boundaryWarp);
  const core = Math.max(0, 1 - radial / 0.52);
  const broad2 = broad * broad;
  const body = 0.015
    + broad2 * 0.55
    + middle * 0.08
    + broadRidge * 0.28
    + ridge * 0.52
    + core * 0.10
    - cavity * 0.68;

  return { density: clamp01(envelope * body), ridge, qx, qz };
}

/**
 * Deterministic multi-scale Cell tissue sample as JS f64 values.
 * Consumers that need byte-parity with Rust's `helix_seed_for` (f32)
 * should use {@link helixSeed} instead.
 */
export function helixSeedF64(id: number | bigint): [number, number, number] {
  const idBig = typeof id === 'bigint' ? id : BigInt(id);
  const rand = mulberry32(idSeed(idBig, 2654435761));

  let x = 0;
  let z = 0;
  let field = tissueField(0, 0);
  let bestDensity = -1;
  let accepted = false;

  // Rejection sampling turns the continuous field into stable Cell positions.
  // Keeping the best candidate avoids a hard fallback shape at rare misses.
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt += 1) {
    const candidateX = (rand() * 2 - 1) * FIELD_HALF_X;
    const candidateZ = (rand() * 2 - 1) * FIELD_HALF_Z;
    const threshold = rand();
    const candidateField = tissueField(candidateX, candidateZ);
    if (candidateField.density > bestDensity) {
      x = candidateX;
      z = candidateZ;
      field = candidateField;
      bestDensity = candidateField.density;
    }
    if (threshold < candidateField.density) {
      x = candidateX;
      z = candidateZ;
      field = candidateField;
      accepted = true;
      break;
    }
  }

  // An extremely rare all-zero miss belongs near the organism, not on a box
  // corner. This branch is deterministic and normally unreachable in 20K.
  if (!accepted && bestDensity <= 0) {
    x *= 0.55;
    z *= 0.55;
    field = tissueField(x, z);
  }

  const verticalMass = 0.5
    + 0.5 * valueNoise2(field.qx, field.qz, 23, 0x13198a2e);
  const thickness = 2.1 + verticalMass * 3.4 + field.ridge * 1.8;
  const fold = valueNoise2(field.qx, field.qz, 31, 0x03707344) * 4.6
    + valueNoise2(field.qx, field.qz, 13, 0xa4093822) * 1.7;
  let y = fold + gauss(rand) * thickness;

  // A few real outliers keep the silhouette alive at the rim without fixed
  // spokes. They inherit the same local field before drifting outward.
  if (rand() < HALO_FRACTION) {
    const scale = 1.08 + Math.abs(gauss(rand)) * 0.17;
    x *= scale;
    z *= scale;
    y += gauss(rand) * 3.2;
  }

  return [x, y, z];
}

/** One point of the shared positional law, read directly instead of sampled.
 *
 * `helixSeedF64` rejection-samples `(x, z)` from {@link tissueField} and then
 * folds `y` around a local fold with a local Gaussian thickness. The three
 * numbers below are exactly the parameters of that fold — the same
 * expressions, in the same order, from the same noise fields — so a consumer
 * can evaluate the distribution a Cell WOULD be drawn from without drawing
 * one. The volume density is then
 *
 * ```text
 * rho(x, y, z) = density * N(y; foldY, thickness)
 *              = density * exp(-0.5 * ((y - foldY) / thickness) ** 2)
 *                        / (thickness * sqrt(2 * PI))
 * ```
 *
 * which is the analytic form of what the rejection sampler produces: `y` is
 * drawn as `foldY + gauss() * thickness`, so it is normally distributed about
 * the fold, and a vertical column of that volume integrates back to `density`
 * itself. The `1 / thickness` is load-bearing — without it a column would
 * integrate to `density * thickness` and the field would claim more matter
 * wherever the tissue happens to be thick.
 *
 * This is a distribution, never a location: it carries no id, no time, and no
 * universe seed, so it says where an unresolved Cell would be, never where a
 * particular one is. It deliberately omits the {@link HALO_FRACTION}
 * outliers, which scale `x, z` outward past the ellipse — a consumer of this
 * law stops inside the drawn rim rather than extending it.
 */
export interface TissueSample {
  /** Areal density in `[0, 1]` — the same value the sampler thresholds. */
  density: number;
  /** Centre of the local vertical fold, in galaxy-local y. */
  foldY: number;
  /** Gaussian half-thickness of the tissue at this point. */
  thickness: number;
}

/** Evaluate the shared positional law at one `(x, z)`. See
 *  {@link TissueSample}. Pure, static, and identical across universes. */
export function tissueSampleAt(x: number, z: number): TissueSample {
  const field = tissueField(x, z);
  const verticalMass = 0.5
    + 0.5 * valueNoise2(field.qx, field.qz, 23, 0x13198a2e);
  const thickness = 2.1 + verticalMass * 3.4 + field.ridge * 1.8;
  const foldY = valueNoise2(field.qx, field.qz, 31, 0x03707344) * 4.6
    + valueNoise2(field.qx, field.qz, 13, 0xa4093822) * 1.7;
  return { density: field.density, foldY, thickness };
}

/** f32 wire-boundary version of {@link helixSeedF64}. */
export function helixSeed(id: number | bigint): [number, number, number] {
  const [x, y, z] = helixSeedF64(id);
  return [Math.fround(x), Math.fround(y), Math.fround(z)];
}
