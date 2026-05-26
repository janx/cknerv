/** Result of computeBeamPhase — the per-frame derivation BlockBeam
 *  applies to its sprites + cylinder mesh visibility. Pure function of
 *  (age, durations); test-friendly. The beam's vertex shader handles
 *  its own continuous phase blending from uAge, so this function only
 *  needs to expose visibility booleans and sprite size/alpha curves —
 *  the spatial deformation of the cylinder is shader-only. */
export interface BeamPhase {
  /** Whether the charging-light sprite at the miner should be drawn.
   *  True during the charge sub-phase (age < chargeDur + small tail
   *  into the burst so it visually "collapses into the launching
   *  beam"). */
  chargeVisible: boolean;
  /** Charging sprite size, normalized to [0, 1]. Grows 0 → 1 over
   *  the charge window, then collapses 1 → 0 sharply during the
   *  early-burst tail. The visual layer multiplies by a world-units
   *  peak size when setting sprite.scale. */
  chargeSize: number;
  /** Charging sprite alpha. Ramps 0 → 1 over the charge window, then
   *  fades to 0 during the early-burst tail. */
  chargeAlpha: number;

  /** Whether the cylinder mesh should be drawn this frame. False
   *  when idle (age < 0), still in pure charge (age < chargeDur — no
   *  beam yet, just the charging sprite), or expired
   *  (age ≥ growDur + strikeDur). */
  visible: boolean;
  /** Whether the strike-splash sprite should be drawn. True from
   *  when the beam reaches the cell plane (age ≥ growDur) through
   *  the end of the strike window. */
  spriteVisible: boolean;
  /** Strike-splash sprite size, normalized to [0, 1]. Ramps 0 → 1
   *  over the first ~half of the strike window, then holds. The
   *  visual layer multiplies by STRIKE_SPRITE_PEAK_SIZE. */
  spriteSize: number;
  /** Strike-splash sprite alpha. Holds 1 over the ramp-up, then
   *  fades to 0 over the second half. */
  spriteAlpha: number;
  /** True once age ≥ growDur + strikeDur — caller should null out
   *  the fireRef and skip the rest of the per-frame work. */
  expired: boolean;
}

/** Configuration for computeBeamPhase: absolute durations in seconds
 *  for each sub-phase. The shader needs the same numbers via its
 *  uniforms; this struct is the single source of truth on the JS
 *  side. */
export interface BeamPhaseConfig {
  /** Time the charging light point is visible at the miner before the
   *  beam launches. */
  chargeDur: number;
  /** Total grow window = chargeDur + burst duration. The beam reaches
   *  the cell plane at age = growDur. */
  growDur: number;
  /** Time the beam holds at full extension before retracting begins. */
  holdDur: number;
  /** Total strike window = holdDur + retract duration. The animation
   *  is fully expired at age = growDur + strikeDur. */
  strikeDur: number;
}

/**
 * Pure derivation of the per-frame BlockBeam state. `age` is
 * `simClock.elapsedSec - fireRef.firedAt`. A negative `age` means
 * fireRef has not yet been written (idle slot); the result is
 * "everything hidden + not expired" so the caller leaves the slot
 * null.
 */
export function computeBeamPhase(age: number, cfg: BeamPhaseConfig): BeamPhase {
  const empty: BeamPhase = {
    chargeVisible: false,
    chargeSize: 0,
    chargeAlpha: 0,
    visible: false,
    spriteVisible: false,
    spriteSize: 0,
    spriteAlpha: 0,
    expired: false,
  };

  if (age < 0) return empty;

  const total = cfg.growDur + cfg.strikeDur;
  if (age >= total) {
    return { ...empty, expired: true };
  }

  // ─── Charging light point at the miner ──────────────────────────
  // Visible during [0, chargeDur + collapseTail]. Grows 0 → 1 over
  // the charge window, then collapses 1 → 0 across a brief tail at
  // the start of the burst (so it visually "feeds into" the
  // launching beam). The tail is hard-coded as 30% of chargeDur to
  // avoid yet another config knob — same shape regardless of
  // absolute timing.
  const collapseTail = cfg.chargeDur * 0.3;
  const chargeEnd = cfg.chargeDur + collapseTail;
  let chargeVisible = false;
  let chargeSize = 0;
  let chargeAlpha = 0;
  if (age < chargeEnd) {
    chargeVisible = true;
    if (age <= cfg.chargeDur) {
      // Build-up: smoothstep so the gather feels accelerating into
      // a saturated peak.
      const t = cfg.chargeDur > 0 ? age / cfg.chargeDur : 1;
      const eased = t * t;
      chargeSize = eased;
      chargeAlpha = eased;
    } else {
      // Collapse tail: rapid shrink to zero as the beam launches.
      const t = (age - cfg.chargeDur) / Math.max(collapseTail, 1e-6);
      chargeSize = 1 - t;
      chargeAlpha = 1 - t;
    }
  }

  // ─── Cylinder mesh visibility ────────────────────────────────────
  // The beam itself only renders from the burst onward — during pure
  // charge the cylinder would be degenerate at the miner and add
  // nothing visually. After charge the shader produces the correct
  // topT / bottomT entirely from uAge, so this is just a visibility
  // gate.
  const beamVisible = age >= cfg.chargeDur;

  // ─── Strike-splash sprite ────────────────────────────────────────
  // Blooms from when the beam reaches the cell plane (age = growDur)
  // through to the end of the strike window. The splash's own size
  // ramp is concentrated in roughly the first third of the strike
  // window so the bloom is decisive rather than slowly inflating
  // across the whole long retract; alpha holds at 1 through the
  // ramp + a hold band, then fades over the back half.
  const inStrike = age >= cfg.growDur;
  let spriteSize = 0;
  let spriteAlpha = 0;
  if (inStrike) {
    const strikeT = cfg.strikeDur > 0 ? (age - cfg.growDur) / cfg.strikeDur : 1;
    // Size: 0 → 1 over [0, 0.33], holds at 1 over [0.33, 1).
    spriteSize = Math.min(1, strikeT / 0.33);
    // Alpha: 1 over [0, 0.5), fades 1 → 0 over [0.5, 1).
    spriteAlpha = strikeT < 0.5 ? 1 : 1 - (strikeT - 0.5) / 0.5;
  }

  return {
    chargeVisible,
    chargeSize,
    chargeAlpha,
    visible: beamVisible,
    spriteVisible: inStrike,
    spriteSize,
    spriteAlpha,
    expired: false,
  };
}
