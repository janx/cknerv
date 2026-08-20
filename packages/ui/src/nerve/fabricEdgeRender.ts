// Pure per-edge render state for the fabric layer, extracted from
// emitFabric so it is unit-testable (the emit loop itself is Canvas-bound).
// Given an edge's lifecycle + the current sim time, returns the drawn
// Bezier interval [tStart, tEnd], alpha, a death flash, and reap/animating
// flags. Growth extends the tip; gc fades alpha at full length; death
// retracts the dead end with a semantic retirement flash envelope.

export type DeathKind = 'death' | 'gc';

export interface EdgeLifecycle {
  bornAt: number;               // sim seconds
  dyingAt: number | null;       // sim seconds, null while alive
  deathKind: DeathKind | null;  // set when dyingAt != null
  deadEnd: 'from' | 'to' | null;// which endpoint is the dead cell (death only)
  growDir: 1 | -1;              // 1: grow from->to; -1: grow to->from
}

export interface EdgeRender {
  visible: boolean;
  alphaMul: number;
  tStart: number;
  tEnd: number;
  flash: number;   // 0..1 retirement signal envelope (death only)
  reap: boolean;
  animating: boolean;
}

/** Tendril grow-in window (length + easeOutCubic alpha). Mirrors the
 *  previous inline GROWTH_MS. */
export const GROWTH_MS = 1200;
/** Quiet gc/reconciliation fade (alpha down, length stays = atrophy). This is
 *  also the window a fibre gets when its endpoint cell merely LEAVES THE
 *  STAGE, so it must stay LONGER than the dot's own `EXIT_FADE_MS` (900,
 *  `geometry/cellPositions`): the two run concurrently on one departure, and
 *  the withering order that reads as one gesture is dot first, fibres after —
 *  a fibre that outlived its dot is a retreating tendril, a dot left holding
 *  cut fibres is a glitch. Move this and check that relation. */
export const DECAY_MS = 1500;
/** Real-death retract window (dead end recedes toward the survivor). */
export const DEATH_RETRACT_MS = 900;
/** White-hot death flash falloff time-constant (exp(-t/τ) — spike at the
 *  moment of death, quick decay, but a positive tail across the retract). */
export const DEATH_FLASH_MS = 220;

const HIDDEN: EdgeRender = { visible: false, alphaMul: 0, tStart: 0, tEnd: 0, flash: 0, reap: false, animating: false };

export function fabricEdgeRenderState(st: EdgeLifecycle, nowSec: number): EdgeRender {
  if (st.dyingAt !== null) {
    // Clamp at 0 so a defensively future-dated dyingAt (dyingAt > nowSec)
    // can't drive decayMs negative — which would overdrive the death
    // flash (exp(-neg/τ) > 1) and invert the retract interval, or push
    // the gc alphaMul above 1. The live driver always passes now >= dyingAt,
    // so this is a no-op there; it closes the footgun against refactors.
    const decayMs = Math.max(0, (nowSec - st.dyingAt) * 1000);
    if (st.deathKind === 'death') {
      if (decayMs >= DEATH_RETRACT_MS) return { ...HIDDEN, reap: true };
      const r = decayMs / DEATH_RETRACT_MS;
      // Retirement spike at t=0 that falls off exponentially (τ=DEATH_FLASH_MS)
      // yet stays > 0 through the retract so the dying tendril keeps a hot tip.
      const flash = Math.exp(-decayMs / DEATH_FLASH_MS);
      const tStart = st.deadEnd === 'from' ? r : 0;
      const tEnd = st.deadEnd === 'to' ? 1 - r : 1;
      return { visible: tEnd > tStart, alphaMul: 1, tStart, tEnd, flash, reap: false, animating: true };
    }
    // gc / reconciliation: quiet fade, full length
    if (decayMs >= DECAY_MS) return { ...HIDDEN, reap: true };
    return { visible: true, alphaMul: 1 - decayMs / DECAY_MS, tStart: 0, tEnd: 1, flash: 0, reap: false, animating: true };
  }
  // growing / stable
  const ageMs = (nowSec - st.bornAt) * 1000;
  if (ageMs < 0) return { ...HIDDEN, animating: true }; // staggered start in the future
  if (ageMs < GROWTH_MS) {
    const p = ageMs / GROWTH_MS;
    const u = 1 - p;
    const alphaMul = 1 - u * u * u; // easeOutCubic
    const tStart = st.growDir === -1 ? 1 - p : 0;
    const tEnd = st.growDir === -1 ? 1 : p;
    return { visible: true, alphaMul, tStart, tEnd, flash: 0, reap: false, animating: true };
  }
  return { visible: true, alphaMul: 1, tStart: 0, tEnd: 1, flash: 0, reap: false, animating: false };
}
