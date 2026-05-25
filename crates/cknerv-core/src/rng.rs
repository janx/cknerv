//! Small deterministic PRNG + helpers shared across cknerv.
//!
//! `Mulberry32` is a small sequential 32-bit PRNG with a JS implementation
//! that the cell-galaxy projection cross-checks against.
//! Keeping the Rust copy bit-exact with the JS reference is the reason
//! this PRNG is hand-rolled instead of pulled from `rand`.

/// mulberry32 PRNG — byte-exact match to the JS implementation in
/// `@cknerv/ui/src/helix.ts`. Each `next` call returns a uniform [0, 1) f64.
pub struct Mulberry32 {
    s: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { s: seed }
    }

    pub fn next(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6d2b79f5);
        let t = self.s;
        let mut t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        let out = t ^ (t >> 14);
        (out as f64) / 4_294_967_296.0
    }
}

/// Box-Muller transform from two `next()` uniforms. Matches the JS
/// `gauss` function in `@cknerv/ui/src/helix.ts`.
pub fn gauss(rng: &mut Mulberry32) -> f64 {
    let u1 = rng.next().max(1e-12);
    let u2 = rng.next();
    (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
}
