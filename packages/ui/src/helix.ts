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

// Organic tissue mixture. Unlike the former six-arm galaxy, no category uses
// `id % symmetry_count`: deterministic randomness chooses irregular overlapping
// lobes, background tissue, a few curling tendrils and a soft halo.
const CORE_FRACTION = 0.12;
const LOBE_FRACTION = 0.60;
const TISSUE_FRACTION = 0.18;
const TENDRIL_FRACTION = 0.07;

const LOBE_CENTER_X = [-24, -13, 2, 18, 27, 14, -7, -28] as const;
const LOBE_CENTER_Y = [3.5, -2.5, 1, 4, -3.5, 0.5, -4, 1.5] as const;
const LOBE_CENTER_Z = [-9, 15, 24, 14, -6, -25, -24, 8] as const;
const LOBE_MAJOR = [15, 13, 14, 12, 11, 15, 13, 10] as const;
const LOBE_MINOR = [6.5, 5.5, 7, 5, 4.5, 6, 5.5, 4.5] as const;
const LOBE_ANGLE = [0.18, 1.05, 2.35, -0.72, 0.45, 2.75, -1.35, 1.62] as const;
const LOBE_THICKNESS = [3.8, 4.6, 3.4, 4.2, 3.2, 4.8, 3.6, 4.1] as const;
// Repeated indices are deliberate unequal lobe weights. A uniform picker made
// even irregular centres converge into another visually balanced oval.
const LOBE_PICK = [0, 0, 0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5, 6, 6, 7] as const;

const TENDRIL_ANGLE = [-2.65, -1.25, -0.18, 1.15, 2.52] as const;
const TENDRIL_BEND = [0.42, -0.58, 0.31, -0.36, 0.53] as const;
const TENDRIL_LENGTH = [47, 56, 43, 52, 49] as const;
const TENDRIL_Y = [2.5, -3, 4, -1.5, 1] as const;

function tissueBoundary(theta: number): number {
  return 46 * (
    1
    + 0.15 * Math.sin(3 * theta + 0.7)
    + 0.09 * Math.sin(5 * theta - 1.1)
    + 0.06 * Math.sin(9 * theta + 0.2)
  );
}

/**
 * Deterministic organic Cell-tissue sample as JS f64 values.
 * Consumers that need byte-parity with Rust's `helix_seed_for` (f32)
 * should use {@link helixSeed} instead.
 */
export function helixSeedF64(id: number | bigint): [number, number, number] {
  const idBig = typeof id === 'bigint' ? id : BigInt(id);
  const rand = mulberry32(idSeed(idBig, 2654435761));
  const u = rand();

  const coreEnd = CORE_FRACTION;
  const lobeEnd = coreEnd + LOBE_FRACTION;
  const tissueEnd = lobeEnd + TISSUE_FRACTION;
  const tendrilEnd = tissueEnd + TENDRIL_FRACTION;

  let x: number;
  let y: number;
  let z: number;

  if (u < coreEnd) {
    x = gauss(rand) * 10;
    z = gauss(rand) * 8;
    y = gauss(rand) * 4.2;
  } else if (u < lobeEnd) {
    const lobe = LOBE_PICK[Math.min(
      LOBE_PICK.length - 1,
      Math.floor(rand() * LOBE_PICK.length),
    )];
    const along = gauss(rand) * LOBE_MAJOR[lobe];
    const across = gauss(rand) * LOBE_MINOR[lobe];
    const angle = LOBE_ANGLE[lobe];
    x = LOBE_CENTER_X[lobe]
      + Math.cos(angle) * along
      - Math.sin(angle) * across;
    z = LOBE_CENTER_Z[lobe]
      + Math.sin(angle) * along
      + Math.cos(angle) * across;
    y = LOBE_CENTER_Y[lobe]
      + gauss(rand) * LOBE_THICKNESS[lobe]
      + along * 0.065;
  } else if (u < tissueEnd) {
    const theta = rand() * Math.PI * 2;
    const boundary = tissueBoundary(theta);
    const r = 2 + Math.pow(rand(), 0.62) * (boundary - 2);
    x = Math.cos(theta) * r * 1.06;
    z = Math.sin(theta) * r * 0.92;
    y = gauss(rand) * (2.3 + 1.5 * (1 - r / boundary));
  } else if (u < tendrilEnd) {
    const tendril = Math.min(
      TENDRIL_ANGLE.length - 1,
      Math.floor(rand() * TENDRIL_ANGLE.length),
    );
    const t = rand();
    const r = 10 + t * TENDRIL_LENGTH[tendril] + gauss(rand) * 1.8;
    const theta = TENDRIL_ANGLE[tendril]
      + TENDRIL_BEND[tendril] * (t - 0.2)
      + Math.sin(t * Math.PI) * TENDRIL_BEND[tendril] * 0.42
      + gauss(rand) * 0.045;
    x = Math.cos(theta) * r * 1.04;
    z = Math.sin(theta) * r * 0.94;
    y = TENDRIL_Y[tendril]
      + (t - 0.5) * TENDRIL_BEND[tendril] * 9
      + gauss(rand) * (1.2 + 1.8 * t);
  } else {
    const theta = rand() * Math.PI * 2;
    const r = tissueBoundary(theta) * 0.82 + Math.abs(gauss(rand)) * 10;
    x = Math.cos(theta) * r * 1.08;
    z = Math.sin(theta) * r * 0.94;
    y = gauss(rand) * 5.5;
  }

  // Low-frequency domain warp and vertical folding make neighbouring lobes
  // merge as tissue instead of reading as independent Gaussian blobs. Keep a
  // copy of the unwarped position so x/z updates do not affect one another.
  const baseX = x;
  const baseZ = z;
  const radial = Math.sqrt(baseX * baseX + baseZ * baseZ);
  const warpScale = 0.8 + Math.min(radial, 60) * 0.025;
  x = baseX
    + Math.sin(baseZ * 0.083 + Math.sin(baseX * 0.029) * 1.7) * warpScale;
  z = baseZ
    + Math.sin(baseX * 0.071 - baseZ * 0.026) * warpScale * 0.9;
  y += 2.2 * Math.sin(baseX * 0.052 + baseZ * 0.019)
    + 1.4 * Math.sin(baseZ * 0.079 - baseX * 0.024);

  return [x, y, z];
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
