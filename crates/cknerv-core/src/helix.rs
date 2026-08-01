//! Deterministic cell-galaxy positioning.
//!
//! `helix_seed_for(id)` returns a deterministic 3-axis position for the given
//! cell id, sampled from a multi-scale organic tissue field. The reducer lives
//! in the server; this module is only the pure positioning helper.
//!
//! **Determinism is contract**: this implementation MUST match
//! `@cknerv/ui/src/helix.ts`, byte-identical after both reduce to f32. The
//! shared `tests/fixtures/helix_seed.json` fixture anchors that contract.

use crate::rng::{gauss, Mulberry32};

const FIELD_HALF_X: f64 = 60.0;
const FIELD_HALF_Z: f64 = 54.0;
const SAMPLE_ATTEMPTS: usize = 10;
const HALO_FRACTION: f64 = 0.045;

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = clamp01((value - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

fn lattice_value(ix: i32, iz: i32, salt: u32) -> f64 {
    let mut h =
        (ix as u32).wrapping_mul(0x1f12_3bb5) ^ (iz as u32).wrapping_mul(0x5f35_6495) ^ salt;
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^= h >> 16;
    (h as f64) / 4_294_967_295.0 * 2.0 - 1.0
}

fn value_noise_2(x: f64, z: f64, scale: f64, salt: u32) -> f64 {
    let gx = x / scale;
    let gz = z / scale;
    let ix = gx.floor() as i32;
    let iz = gz.floor() as i32;
    let tx = gx - ix as f64;
    let tz = gz - iz as f64;
    let sx = tx * tx * (3.0 - 2.0 * tx);
    let sz = tz * tz * (3.0 - 2.0 * tz);
    let a = lattice_value(ix, iz, salt);
    let b = lattice_value(ix + 1, iz, salt);
    let c = lattice_value(ix, iz + 1, salt);
    let d = lattice_value(ix + 1, iz + 1, salt);
    let nx0 = a + (b - a) * sx;
    let nx1 = c + (d - c) * sx;
    nx0 + (nx1 - nx0) * sz
}

#[derive(Clone, Copy)]
struct TissueField {
    density: f64,
    ridge: f64,
    qx: f64,
    qz: f64,
}

fn tissue_field(x: f64, z: f64) -> TissueField {
    let warp_x = value_noise_2(x, z, 34.0, 0x68bc_21eb) * 11.0
        + value_noise_2(x, z, 17.0, 0x02e5_be93) * 3.5;
    let warp_z = value_noise_2(x, z, 37.0, 0x967a_889b) * 10.0
        + value_noise_2(x, z, 19.0, 0x4f1b_bcdc) * 3.5;
    let qx = x + warp_x;
    let qz = z + warp_z;

    let broad = 0.5 + 0.5 * value_noise_2(qx, qz, 35.0, 0x9e37_79b9);
    let middle = 0.5 + 0.5 * value_noise_2(qx, qz, 17.0, 0x243f_6a88);
    let broad_ridge_base = 1.0 - value_noise_2(qx, qz, 23.0, 0x3c6e_f372).abs();
    let broad_ridge = broad_ridge_base * broad_ridge_base * broad_ridge_base;
    let ridge_base = 1.0 - value_noise_2(qx, qz, 11.0, 0xb7e1_5162).abs();
    let ridge_2 = ridge_base * ridge_base;
    let ridge = ridge_2 * ridge_2;
    let void_field = 0.5 + 0.5 * value_noise_2(qx - 13.0, qz + 9.0, 19.0, 0xdead_beef);
    let cavity = smoothstep(0.64, 0.88, void_field);

    let nx = x / FIELD_HALF_X;
    let nz = z / FIELD_HALF_Z;
    let radial = (nx * nx + nz * nz).sqrt();
    let boundary_warp = value_noise_2(x, z, 42.0, 0xa341_316c) * 0.13
        + value_noise_2(x, z, 21.0, 0xc801_3ea4) * 0.055;
    let envelope = 1.0 - smoothstep(0.61, 1.04, radial + boundary_warp);
    let core = (1.0 - radial / 0.52).max(0.0);
    let broad_2 = broad * broad;
    let body =
        0.015 + broad_2 * 0.55 + middle * 0.08 + broad_ridge * 0.28 + ridge * 0.52 + core * 0.10
            - cavity * 0.68;

    TissueField {
        density: clamp01(envelope * body),
        ridge,
        qx,
        qz,
    }
}

/// `(id * salt) mod 2^32`, matching the JS BigInt implementation.
fn id_seed(id: u64, salt: u32) -> u32 {
    id.wrapping_mul(salt as u64) as u32
}

/// Deterministic multi-scale Cell-tissue sample. Returns f64; consumers
/// downcast only at the wire boundary.
pub fn helix_seed_f64(id: u64) -> [f64; 3] {
    let mut rng = Mulberry32::new(id_seed(id, 2_654_435_761));

    let mut x = 0.0;
    let mut z = 0.0;
    let mut field = tissue_field(0.0, 0.0);
    let mut best_density = -1.0;
    let mut accepted = false;

    for _ in 0..SAMPLE_ATTEMPTS {
        let candidate_x = (rng.next_f64() * 2.0 - 1.0) * FIELD_HALF_X;
        let candidate_z = (rng.next_f64() * 2.0 - 1.0) * FIELD_HALF_Z;
        let threshold = rng.next_f64();
        let candidate_field = tissue_field(candidate_x, candidate_z);
        if candidate_field.density > best_density {
            x = candidate_x;
            z = candidate_z;
            field = candidate_field;
            best_density = candidate_field.density;
        }
        if threshold < candidate_field.density {
            x = candidate_x;
            z = candidate_z;
            field = candidate_field;
            accepted = true;
            break;
        }
    }

    if !accepted && best_density <= 0.0 {
        x *= 0.55;
        z *= 0.55;
        field = tissue_field(x, z);
    }

    let vertical_mass = 0.5 + 0.5 * value_noise_2(field.qx, field.qz, 23.0, 0x1319_8a2e);
    let thickness = 2.1 + vertical_mass * 3.4 + field.ridge * 1.8;
    let fold = value_noise_2(field.qx, field.qz, 31.0, 0x0370_7344) * 4.6
        + value_noise_2(field.qx, field.qz, 13.0, 0xa409_3822) * 1.7;
    let mut y = fold + gauss(&mut rng) * thickness;

    if rng.next_f64() < HALO_FRACTION {
        let scale = 1.08 + gauss(&mut rng).abs() * 0.17;
        x *= scale;
        z *= scale;
        y += gauss(&mut rng) * 3.2;
    }

    [x, y, z]
}

/// f32 wire-boundary version of [`helix_seed_f64`].
pub fn helix_seed_for(id: u64) -> [f32; 3] {
    let [x, y, z] = helix_seed_f64(id);
    [x as f32, y as f32, z as f32]
}
