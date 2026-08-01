//! Deterministic cell-galaxy positioning.
//!
//! `helix_seed_for(id)` returns a deterministic 3-axis position for the
//! given cell id, sampled from an irregular organic-tissue distribution.
//! The reducer (birth / death / tag) lives in the server;
//! this module is just the pure positioning helper.
//!
//! **Determinism is contract**: `helix_seed_for(id)` here MUST produce
//! the same xyz as the TS implementation in `@cknerv/ui/src/helix.ts` for
//! every id, byte-identical when both reduce to f32. This is anchored by
//! the JSON fixture at `tests/fixtures/helix_seed.json` (cknerv repo
//! root) that both languages compare against.

use crate::rng::{gauss, Mulberry32};

// Organic tissue mixture. Unlike the former six-arm galaxy, no category uses
// `id % symmetry_count`: deterministic randomness chooses irregular overlapping
// lobes, background tissue, a few curling tendrils and a soft halo.
const CORE_FRACTION: f64 = 0.12;
const LOBE_FRACTION: f64 = 0.60;
const TISSUE_FRACTION: f64 = 0.18;
const TENDRIL_FRACTION: f64 = 0.07;

const LOBE_CENTER_X: [f64; 8] = [-24.0, -13.0, 2.0, 18.0, 27.0, 14.0, -7.0, -28.0];
const LOBE_CENTER_Y: [f64; 8] = [3.5, -2.5, 1.0, 4.0, -3.5, 0.5, -4.0, 1.5];
const LOBE_CENTER_Z: [f64; 8] = [-9.0, 15.0, 24.0, 14.0, -6.0, -25.0, -24.0, 8.0];
const LOBE_MAJOR: [f64; 8] = [15.0, 13.0, 14.0, 12.0, 11.0, 15.0, 13.0, 10.0];
const LOBE_MINOR: [f64; 8] = [6.5, 5.5, 7.0, 5.0, 4.5, 6.0, 5.5, 4.5];
const LOBE_ANGLE: [f64; 8] = [0.18, 1.05, 2.35, -0.72, 0.45, 2.75, -1.35, 1.62];
const LOBE_THICKNESS: [f64; 8] = [3.8, 4.6, 3.4, 4.2, 3.2, 4.8, 3.6, 4.1];
// Repeated indices are deliberate unequal lobe weights. A uniform picker made
// even irregular centres converge into another visually balanced oval.
const LOBE_PICK: [usize; 16] = [0, 0, 0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5, 6, 6, 7];

const TENDRIL_ANGLE: [f64; 5] = [-2.65, -1.25, -0.18, 1.15, 2.52];
const TENDRIL_BEND: [f64; 5] = [0.42, -0.58, 0.31, -0.36, 0.53];
const TENDRIL_LENGTH: [f64; 5] = [47.0, 56.0, 43.0, 52.0, 49.0];
const TENDRIL_Y: [f64; 5] = [2.5, -3.0, 4.0, -1.5, 1.0];

fn tissue_boundary(theta: f64) -> f64 {
    46.0 * (1.0
        + 0.15 * (3.0 * theta + 0.7).sin()
        + 0.09 * (5.0 * theta - 1.1).sin()
        + 0.06 * (9.0 * theta + 0.2).sin())
}

/// JS uses `id * 2654435761` then `>>> 0` truncates to u32. Match that:
/// full multiply in u64 (no precision loss for id < 2^21 — well within
/// any reasonable cell count), then truncate to low 32 bits.
fn id_seed(id: u64, salt: u32) -> u32 {
    (id.wrapping_mul(salt as u64)) as u32
}

/// Deterministic 3-axis organic Cell-tissue sample for cell `id`.
/// Returns f64; consumers downcast to f32 only at the wire boundary so
/// the cross-language fixture compares the 32-bit values both languages
/// emit.
pub fn helix_seed_f64(id: u64) -> [f64; 3] {
    let mut rng = Mulberry32::new(id_seed(id, 2_654_435_761));
    let u = rng.next_f64();

    let core_end = CORE_FRACTION;
    let lobe_end = core_end + LOBE_FRACTION;
    let tissue_end = lobe_end + TISSUE_FRACTION;
    let tendril_end = tissue_end + TENDRIL_FRACTION;

    let (mut x, mut y, mut z);

    if u < core_end {
        x = gauss(&mut rng) * 10.0;
        z = gauss(&mut rng) * 8.0;
        y = gauss(&mut rng) * 4.2;
    } else if u < lobe_end {
        let pick = (rng.next_f64() * LOBE_PICK.len() as f64).floor() as usize;
        let lobe = LOBE_PICK[pick];
        let along = gauss(&mut rng) * LOBE_MAJOR[lobe];
        let across = gauss(&mut rng) * LOBE_MINOR[lobe];
        let angle = LOBE_ANGLE[lobe];
        x = LOBE_CENTER_X[lobe] + angle.cos() * along - angle.sin() * across;
        z = LOBE_CENTER_Z[lobe] + angle.sin() * along + angle.cos() * across;
        y = LOBE_CENTER_Y[lobe] + gauss(&mut rng) * LOBE_THICKNESS[lobe] + along * 0.065;
    } else if u < tissue_end {
        let theta = rng.next_f64() * 2.0 * std::f64::consts::PI;
        let boundary = tissue_boundary(theta);
        let r = 2.0 + rng.next_f64().powf(0.62) * (boundary - 2.0);
        x = theta.cos() * r * 1.06;
        z = theta.sin() * r * 0.92;
        y = gauss(&mut rng) * (2.3 + 1.5 * (1.0 - r / boundary));
    } else if u < tendril_end {
        let tendril = (rng.next_f64() * TENDRIL_ANGLE.len() as f64).floor() as usize;
        let t = rng.next_f64();
        let r = 10.0 + t * TENDRIL_LENGTH[tendril] + gauss(&mut rng) * 1.8;
        let theta = TENDRIL_ANGLE[tendril]
            + TENDRIL_BEND[tendril] * (t - 0.2)
            + (t * std::f64::consts::PI).sin() * TENDRIL_BEND[tendril] * 0.42
            + gauss(&mut rng) * 0.045;
        x = theta.cos() * r * 1.04;
        z = theta.sin() * r * 0.94;
        y = TENDRIL_Y[tendril]
            + (t - 0.5) * TENDRIL_BEND[tendril] * 9.0
            + gauss(&mut rng) * (1.2 + 1.8 * t);
    } else {
        let theta = rng.next_f64() * 2.0 * std::f64::consts::PI;
        let r = tissue_boundary(theta) * 0.82 + gauss(&mut rng).abs() * 10.0;
        x = theta.cos() * r * 1.08;
        z = theta.sin() * r * 0.94;
        y = gauss(&mut rng) * 5.5;
    }

    // Low-frequency domain warp and vertical folding make neighbouring lobes
    // merge as tissue instead of reading as independent Gaussian blobs. Keep a
    // copy of the unwarped position so x/z updates do not affect one another.
    let base_x = x;
    let base_z = z;
    let radial = (base_x * base_x + base_z * base_z).sqrt();
    let warp_scale = 0.8 + radial.min(60.0) * 0.025;
    x = base_x + (base_z * 0.083 + (base_x * 0.029).sin() * 1.7).sin() * warp_scale;
    z = base_z + (base_x * 0.071 - base_z * 0.026).sin() * warp_scale * 0.9;
    y += 2.2 * (base_x * 0.052 + base_z * 0.019).sin()
        + 1.4 * (base_z * 0.079 - base_x * 0.024).sin();

    [x, y, z]
}

/// f32 wire-boundary version of [`helix_seed_f64`]. The cross-language
/// fixture parity test compares these 32-bit values byte-for-byte.
pub fn helix_seed_for(id: u64) -> [f32; 3] {
    let [x, y, z] = helix_seed_f64(id);
    [x as f32, y as f32, z as f32]
}
