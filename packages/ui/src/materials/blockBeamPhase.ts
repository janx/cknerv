/** Result of computeBeamPhase — the per-frame derivation BlockBeam applies to
 *  its splash sprite + cylinder visibility. Pure function of (age, durations).
 *  The cylinder's spatial growth/retract is shader-only (from uAge); this
 *  exposes only visibility + the splash size/alpha curves. */
export interface BeamPhase {
  /** Whether the cylinder mesh should be drawn this frame. True from launch
   *  (age 0) until expiry; false when idle (age < 0) or expired. */
  visible: boolean;
  /** Whether the strike-splash sprite should be drawn (age ≥ growDur). */
  spriteVisible: boolean;
  /** Strike-splash size, normalized [0,1]: 0 → 1 over the first ~33% of the
   *  strike window, then holds. Caller multiplies by a world-units peak. */
  spriteSize: number;
  /** Strike-splash alpha: holds 1 over the first half, fades 1 → 0 over the
   *  second half of the strike window. */
  spriteAlpha: number;
  /** True once age ≥ growDur + strikeDur — caller nulls fireRef and skips. */
  expired: boolean;
}

/** Absolute sub-phase durations in seconds. The shader needs the same numbers
 *  via uniforms; this struct is the single source of truth JS-side. */
export interface BeamPhaseConfig {
  /** Time from launch to the beam reaching the cell plane (age = growDur). */
  growDur: number;
  /** Time the beam holds at full extension before retracting. */
  holdDur: number;
  /** Total strike window = holdDur + retract. Expired at growDur + strikeDur. */
  strikeDur: number;
}

/**
 * Pure derivation of the per-frame BlockBeam state. `age` is
 * `simClock.elapsedSec - fireRef.firedAt`. A negative `age` (slot not yet
 * written, or a future-dated receive trigger) returns "everything hidden, not
 * expired" so the caller leaves the slot intact. There is no charge pre-roll:
 * a received block is applied immediately, so the beam is visible from age 0.
 */
export function computeBeamPhase(age: number, cfg: BeamPhaseConfig): BeamPhase {
  const empty: BeamPhase = {
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

  // ─── Strike-splash sprite ────────────────────────────────────────
  // Blooms from when the beam reaches the cell plane (age = growDur) through
  // the end of the strike window. Size ramps over the first ~third; alpha
  // holds then fades over the back half.
  const inStrike = age >= cfg.growDur;
  let spriteSize = 0;
  let spriteAlpha = 0;
  if (inStrike) {
    const strikeT = cfg.strikeDur > 0 ? (age - cfg.growDur) / cfg.strikeDur : 1;
    spriteSize = Math.min(1, strikeT / 0.33);
    spriteAlpha = strikeT < 0.5 ? 1 : 1 - (strikeT - 0.5) / 0.5;
  }

  return {
    visible: true,
    spriteVisible: inStrike,
    spriteSize,
    spriteAlpha,
    expired: false,
  };
}
