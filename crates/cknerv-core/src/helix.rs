//! Deterministic cell-galaxy positioning.
//!
//! `helix_seed_for(id)` returns a deterministic 3-axis position for the
//! given cell id, sampled from a hybrid Crab + Milky-Way nebula
//! distribution. The reducer (birth / death / tag) lives in the server;
//! this module is just the pure positioning helper.
//!
//! **Determinism is contract**: `helix_seed_for(id)` here MUST produce
//! the same xyz as the TS implementation in `@cknerv/ui/src/helix.ts` for
//! every id, byte-identical when both reduce to f32. This is anchored by
//! the JSON fixture at `tests/fixtures/helix_seed.json` (cknerv repo
//! root) that both languages compare against.

use crate::rng::{gauss, Mulberry32};

// ── helix_seed_for parameters ────────────────────────────────────────
// Central bulge fraction. Cut 0.28 → 0.16 live: the σ=7 core packed ~28% of all
// cells into the centre, which both blew out the middle (too-bright blob) and
// starved the disk fill. The freed budget goes to DISK_FRACTION below.
const CORE_FRACTION: f64 = 0.16;
const CORE_SIGMA: f64 = 7.0;
const SPIRAL_ARM_COUNT: u64 = 6;
const SPIRAL_ARM_MIN_R: f64 = 0.5;
const SPIRAL_ARM_MAX_R: f64 = 58.0;
const SPIRAL_ARM_PITCH: f64 = 0.95;
const SPIRAL_ARM_THICKNESS: f64 = 0.16;
const SPIRAL_FRACTION: f64 = 0.45;
// Smooth axisymmetric disk fill. Keeps the 6 arms exactly as-is (over-density
// ridges) but lifts the dark inter-arm gaps off black: cells here share the
// arms' radial profile with a UNIFORM angle, so they fill the whole disc evenly
// and the arms read as brighter structure floating in a continuous disc rather
// than isolated spokes. Budget taken from FILAMENT (0.20 → 0.03), the halo
// (0.07 → 0.00) and the core (0.28 → 0.16), so core+spiral+disk+filament == 1.0.
// 0.24 → 0.36 tuned live: the neural-fabric mesh amplifies the arm/gap density
// contrast, so the inter-arm gaps needed a much fuller disc to close.
const DISK_FRACTION: f64 = 0.36;
const FILAMENT_COUNT: u64 = 9;
const FILAMENT_MIN_R: f64 = 1.0;
const FILAMENT_MAX_R: f64 = 55.0;
const FILAMENT_THICKNESS: f64 = 0.05;
const FILAMENT_FRACTION: f64 = 0.03;
const HALO_MIN_R: f64 = 12.0;
const HALO_MAX_R: f64 = 55.0;
const NEBULA_RADIAL_MIN: f64 = 1.0;
const NEBULA_DISK_SIGMA: f64 = 1.5;
const NEBULA_ELLIPSE_X: f64 = 1.12;
const NEBULA_ELLIPSE_Z: f64 = 0.93;
// Universal rim softening — Gaussian scatter scaled by (r/50)² capped at
// 1, so inner cells barely move while rim cells get a noticeable push.
// Turns the disc boundary into a wispy taper instead of a clean ellipse.
const RIM_SOFTNESS_REF_R: f64 = 50.0;
const RIM_SOFTNESS_SCALE: f64 = 3.0;

/// JS uses `id * 2654435761` then `>>> 0` truncates to u32. Match that:
/// full multiply in u64 (no precision loss for id < 2^21 — well within
/// any reasonable cell count), then truncate to low 32 bits.
fn id_seed(id: u64, salt: u32) -> u32 {
    (id.wrapping_mul(salt as u64)) as u32
}

/// Deterministic 3-axis Crab+Milky-Way nebula sample for cell `id`.
/// Returns f64; consumers downcast to f32 only at the wire boundary so
/// the cross-language fixture compares the 32-bit values both languages
/// emit.
pub fn helix_seed_f64(id: u64) -> [f64; 3] {
    let mut rng = Mulberry32::new(id_seed(id, 2_654_435_761));
    let u = rng.next_f64();

    let core_end = CORE_FRACTION;
    let spiral_end = core_end + SPIRAL_FRACTION;
    let disk_end = spiral_end + DISK_FRACTION;
    let filament_end = disk_end + FILAMENT_FRACTION;

    let (mut r, theta);

    if u < core_end {
        r = gauss(&mut rng).abs() * CORE_SIGMA;
        theta = rng.next_f64() * 2.0 * std::f64::consts::PI;
    } else if u < spiral_end {
        let arm = id % SPIRAL_ARM_COUNT;
        let arm_offset = (arm as f64 / SPIRAL_ARM_COUNT as f64) * 2.0 * std::f64::consts::PI;
        let radial_eased = 1.0 - (2.0 * rng.next_f64() - 1.0).powi(2);
        r = SPIRAL_ARM_MIN_R
            + rng.next_f64().powf(0.7) * (SPIRAL_ARM_MAX_R - SPIRAL_ARM_MIN_R)
            + (radial_eased - 0.5) * 2.0;
        let spiral_angle = SPIRAL_ARM_PITCH * r.max(1.0).ln();
        let tangential_jitter = gauss(&mut rng) * SPIRAL_ARM_THICKNESS;
        theta = arm_offset + spiral_angle + tangential_jitter;
    } else if u < disk_end {
        // Smooth disk fill: the arms' radial profile (denser inward via
        // powf(0.7)) but a UNIFORM angle, so it lands everywhere — including the
        // inter-arm gaps — without adding angular structure of its own. Two
        // Two PRNG draws (r, theta); order MUST match the TS twin exactly.
        r = SPIRAL_ARM_MIN_R + rng.next_f64().powf(0.7) * (SPIRAL_ARM_MAX_R - SPIRAL_ARM_MIN_R);
        theta = rng.next_f64() * 2.0 * std::f64::consts::PI;
    } else if u < filament_end {
        let filament = id % FILAMENT_COUNT;
        let base_angle = (filament as f64 / FILAMENT_COUNT as f64) * 2.0 * std::f64::consts::PI;
        r = FILAMENT_MIN_R + rng.next_f64() * (FILAMENT_MAX_R - FILAMENT_MIN_R);
        let drift_sign = if filament.is_multiple_of(2) {
            1.0
        } else {
            -1.0
        };
        let drift = drift_sign * 0.005 * (r - 30.0);
        theta = base_angle + drift + gauss(&mut rng) * FILAMENT_THICKNESS;
    } else {
        // Gaussian-tail halo: cells cluster near the inner halo rim and
        // taper out smoothly with rare extreme outliers, so the outer
        // boundary reads as a soft fall-off rather than a hard disc edge.
        let half_range = (HALO_MAX_R - HALO_MIN_R) / 2.0;
        r = HALO_MIN_R + gauss(&mut rng).abs() * half_range;
        theta = rng.next_f64() * 2.0 * std::f64::consts::PI;
    }

    // Universal rim softening — apply BEFORE the lower clamp so any
    // inward-scattered cells still get pulled back to NEBULA_RADIAL_MIN.
    // Outward extreme tail is intentionally unbounded; the rim is meant
    // to feather out into a wisp rather than terminate cleanly.
    let softness = (r / RIM_SOFTNESS_REF_R).powi(2).min(1.0);
    r += gauss(&mut rng) * RIM_SOFTNESS_SCALE * softness;

    if r < NEBULA_RADIAL_MIN {
        r = NEBULA_RADIAL_MIN;
    }

    let y = gauss(&mut rng) * NEBULA_DISK_SIGMA;
    [
        theta.cos() * r * NEBULA_ELLIPSE_X,
        y,
        theta.sin() * r * NEBULA_ELLIPSE_Z,
    ]
}

/// f32 wire-boundary version of [`helix_seed_f64`]. The cross-language
/// fixture parity test compares these 32-bit values byte-for-byte.
pub fn helix_seed_for(id: u64) -> [f32; 3] {
    let [x, y, z] = helix_seed_f64(id);
    [x as f32, y as f32, z as f32]
}
