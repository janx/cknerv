import type { QualityPreset } from './qualityPresets';
import { HUD_MOTION } from '../components/hud/hudTheme';

export const ADAPTIVE_SAMPLE_WINDOW_MS = 750;
export const ADAPTIVE_WARMUP_MS = 4_000;
export const ADAPTIVE_SWITCH_COOLDOWN_MS = 6_000;
export const ADAPTIVE_EMA_TIME_MS = 1_500;

/**
 * The longest a single frame may be before its window stops being evidence.
 *
 * NOT a tier threshold and deliberately an order of magnitude above one:
 * `high` steps down at a 22 ms MEAN, and nothing this renderer does takes a
 * quarter of a second. A frame that did was the machine doing something else —
 * a shader compile, a worker delivery, a screenshot, the debugger — and a MEAN
 * cannot tell that window apart from a genuinely slow one. At 60 fps with a
 * single 500 ms stop in it a 1.5 s window reads 24 ms, past `high`'s deadband,
 * and the controller used to act on it (pinned in
 * `AdaptiveQualityController.test.tsx`, where the old code walks a 60 fps page
 * to `low`).
 *
 * ⚠️ AND IT IS NOT THE EXPLANATION FOR THE HEADLESS STEP, which is what this
 * was written to chase. Measured (E7, 117 sample windows over 90 s of headless
 * Vulkan at 1920×1080 with the page forced visible): the longest single frame
 * in the whole session was 156 ms, NO window was dropped by this rule, and the
 * page stepped `high` → `med` anyway — because a third of its windows really
 * did mean 25–49 ms. The median was 17.1 ms, which is the "60 fps" a spot
 * check sees; the distribution is bimodal and the controller is reading it
 * correctly. So the tier step is the controller working, not a sampler
 * artefact, and this constant guards a case that measurement rules OUT for
 * headless and cannot rule out for a machine that compiles a shader mid-session.
 *
 * Fixing the input rather than the threshold is still the rule: raising the
 * deadband to cover stalls would also stop the controller noticing a machine
 * that really is at 40 fps — which, measured, is what headless is.
 */
export const ADAPTIVE_STALL_FRAME_MS = 250;

/**
 * The share of a sample window's wall clock above which the MAIN THREAD, not
 * the renderer, owned its frame time — and past which the window may not step
 * the tier DOWN.
 *
 * Every rung of the cascade buys GPU time and nothing else: raster density,
 * DPR, ambient counts, transient concurrency. A window whose frames were long
 * because the main thread was busy is therefore not evidence that the tier is
 * too expensive — a step down would leave exactly the same main-thread cost on
 * the next frame, and the page would have given up a tier and kept its frame
 * time. It is the argument the post-block window already makes
 * (`recentBlockActiveRef`), generalised: there the cause is named by a
 * sentinel, here it is measured.
 *
 * Measured 2026-09-12 with 24 normal-priority busy loops beside the page
 * (/proc/loadavg 63–71): AUTO walked high → med → low inside 70 s of idle, on
 * windows whose mean frame was 51 ms and whose main thread was busy for ~85 %
 * of the wall clock (probe busy p50 40.6 ms against a 47.9 ms mean interval;
 * CDP's own TaskDuration read 47.3 ms a frame, 99 %). Those windows are the
 * replay fixture behind `adaptiveQualityBusyGate.test.ts`. On the same page
 * left quiet the reading is 15–20 %, which is the safety property: a real GPU
 * limit must still be able to spend a tier.
 *
 * Sixty percent rather than a tighter line because the reading is a LOWER
 * BOUND — `AdaptiveQualityController` measures each frame's begin to the end
 * of the R3F loop, not the tasks after it — and because the gate can only
 * ever WITHHOLD a step: an under-measured window must land on today's
 * behaviour, and only a window plainly owned by the main thread should be
 * refused. Measured per 750 ms window on the dev build: at load 64, 48 of 50
 * windows read past the line (run share 0.816); left quiet, 12 of 52 do (run
 * share 0.425) — and those twelve gate nothing, because a 16.7 ms window has
 * no slow evidence for the gate to hold. The rule only ever bites on a
 * window that is BOTH slow and the main thread's.
 */
export const BUSY_DOWN_GATE_SHARE = 0.6;

/**
 * Did the main thread own this window? Strictly past the share, so a window
 * exactly at the line is still the renderer's: the rule has to be able to NAME
 * the main thread, and an absent or nonsensical reading (no bracket installed,
 * a zero-length window) names nothing.
 */
export function mainThreadOwnsWindow(busyMs: number, windowMs: number): boolean {
  if (!Number.isFinite(busyMs) || !Number.isFinite(windowMs)) return false;
  if (windowMs <= 0) return false;
  return busyMs > windowMs * BUSY_DOWN_GATE_SHARE;
}

/** Calibration ends once the tier has held this long without a switch. What is
 * decided at the door is the CEILING: no sample after the lock may raise the
 * tier, so this window only has to be long enough to catch a machine that
 * cannot carry the tier it started at. Falling further stays possible for the
 * life of the page — see {@link POST_LOCK_DOWN_HOLD_MUL}. */
export const QUALITY_LOCK_STABLE_MS = 10_000;

/** Absolute ceiling on calibration, measured from the end of warmup. Evidence
 * that oscillates without ever completing a hold would otherwise sample
 * forever; at this point the tier in hand is the answer. Wide enough that a
 * machine that needs `low` can still pass through `med` on the way — each step
 * re-arms its own stability window inside this cap. */
export const QUALITY_CALIBRATION_MAX_MS = 30_000;

const QUALITY_ORDER: readonly QualityPreset[] = ['low', 'med', 'high'];
const DOWN_FRAME_MS: Record<QualityPreset, number> = {
  high: 22,
  med: 30,
  low: Number.POSITIVE_INFINITY,
};
const DOWN_HOLD_MS: Record<QualityPreset, number> = {
  high: 5_000,
  med: 6_000,
  low: Number.POSITIVE_INFINITY,
};

/** Post-lock a downshift must clear a hold this many times longer than the
 * one calibration uses. Calibration is over ~34 s after a page opens, which on
 * a laptop falls entirely inside the GPU's cold-boost window; sustained load
 * then heats the silicon and drops the clocks by ~40% minutes later, and a
 * tier that fit at boost no longer fits. Measured 2026-08-22 on a 30 W iGPU:
 * `high` locked at 59 fps on cold silicon and ran 26-43 fps by minute five,
 * while `med` held 57-60. So the lock keeps listening downward. The stiffer
 * hold is the price of speaking after calibration already has: a settled page
 * gives up a tier only for pressure that is plainly the steady state, not for
 * one heavy minute. */
export const POST_LOCK_DOWN_HOLD_MUL = 2;

// There is no upshift, in any phase: during calibration only a downshift may
// fire, and after the lock only a downshift may fire — against the longer hold
// above. Each page therefore walks one way, and a monotone-down machine cannot
// limit-cycle, which is the whole reason the lock exists. The retired up/down
// controller oscillated six times in nine minutes at 4K because `high` sits ON
// the vsync deadline and a controller can only measure the tier it is in: at
// `med` it read fast, which says nothing about what `high` would have cost.

export interface AdaptiveQualityState {
  quality: QualityPreset;
  smoothedFrameMs: number;
  warmupRemainingMs: number;
  cooldownRemainingMs: number;
  slowEvidenceMs: number;
  /** Calibration is over — this tier is the page's ceiling. Sticky: once true
   * it never clears, and the tier may only step down from here. */
  locked: boolean;
  /** Sampled time since the last switch, warmup and cooldown excluded. */
  stableMs: number;
  /** Time advanced since the end of warmup, cooldown included. */
  calibrationMs: number;
}

export function createAdaptiveQualityState(
  quality: QualityPreset = 'high',
  warmupRemainingMs = ADAPTIVE_WARMUP_MS,
): AdaptiveQualityState {
  return {
    quality,
    smoothedFrameMs: 0,
    warmupRemainingMs: Math.max(0, warmupRemainingMs),
    cooldownRemainingMs: 0,
    slowEvidenceMs: 0,
    locked: false,
    stableMs: 0,
    calibrationMs: 0,
  };
}

/** Re-arm warmup and drop the evidence so far without giving up the lock. A
 * restart exists for frames the sampler must not trust — a replay storm and
 * the settle frames behind it — and untrustworthy evidence is no reason to
 * hand a settled page its ceiling back. `locked` therefore rides through, and
 * the fresh state may still only step down. */
export function restartAdaptiveQualityState(
  state: AdaptiveQualityState,
  quality: QualityPreset,
): AdaptiveQualityState {
  return { ...createAdaptiveQualityState(quality), locked: state.locked };
}

function lowerQuality(quality: QualityPreset): QualityPreset {
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)];
}

/** The hold a downshift must complete, stiffened once calibration has spoken.
 * `low` holds `Infinity` at either multiple, so the floor stays a floor. */
function downHoldMs(state: AdaptiveQualityState): number {
  const hold = DOWN_HOLD_MS[state.quality];
  return state.locked ? hold * POST_LOCK_DOWN_HOLD_MUL : hold;
}

/**
 * Advance one window-average sample. Evidence grows only outside the deadband
 * and decays twice as fast inside it. A single event spike therefore disappears
 * before it can trigger a switch, while sustained pressure eventually does.
 *
 * Calibration runs from the end of warmup to the lock and admits downshifts
 * only. The lock ends calibration, not measurement: the same machinery keeps
 * advancing afterwards and the one action still open to it is a downshift,
 * against the longer {@link POST_LOCK_DOWN_HOLD_MUL} hold. The caller keeps
 * sampling for the life of the page.
 *
 * `mainThreadBound` is the window's own verdict from
 * {@link mainThreadOwnsWindow}, and it gates the DOWNSHIFT alone — the
 * average, the stability clock and the lock all advance exactly as they would
 * without it. Absent, the rule is the one that predates the gate.
 */
export function advanceAdaptiveQuality(
  state: AdaptiveQualityState,
  frameMs: number,
  sampleDurationMs: number,
  mainThreadBound = false,
): AdaptiveQualityState {
  if (!Number.isFinite(frameMs) || frameMs <= 0) return state;
  if (!Number.isFinite(sampleDurationMs) || sampleDurationMs <= 0) return state;

  // A delayed callback must not contribute an arbitrarily large block of
  // evidence. The live controller rejects hidden-tab windows as well.
  const duration = Math.min(sampleDurationMs, ADAPTIVE_SAMPLE_WINDOW_MS * 2);
  const alpha = 1 - Math.exp(-duration / ADAPTIVE_EMA_TIME_MS);
  const smoothedFrameMs = state.smoothedFrameMs > 0
    ? state.smoothedFrameMs + (frameMs - state.smoothedFrameMs) * alpha
    : frameMs;

  if (state.warmupRemainingMs > 0) {
    return {
      ...state,
      smoothedFrameMs,
      warmupRemainingMs: Math.max(0, state.warmupRemainingMs - duration),
      slowEvidenceMs: 0,
    };
  }

  const calibrationMs = state.calibrationMs + duration;

  if (state.cooldownRemainingMs > 0) {
    // Cooldown is calibration time but not stability time: evidence is
    // deliberately ignored here, so counting it would spend six of the ten
    // stable seconds on a window that could not have noticed pressure — and
    // lock every weak machine one tier above the one it needs. The hard cap
    // still applies, since it measures wall time and nothing else.
    return {
      ...state,
      smoothedFrameMs,
      cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - duration),
      slowEvidenceMs: 0,
      calibrationMs,
      locked: state.locked || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
    };
  }

  const slow = smoothedFrameMs > DOWN_FRAME_MS[state.quality];
  // A window the main thread owned HOLDS the evidence clock rather than
  // resetting or dropping it: those frames say nothing about what this tier
  // costs the GPU (see {@link BUSY_DOWN_GATE_SHARE}), but they are also no
  // reason to forget what the windows before them said — the next window that
  // really is the renderer's finds the evidence where it left it, and a fast
  // window still decays it at the double rate below whoever owned the frames.
  // Holding it is also what makes the gate structural: evidence cannot reach
  // the hold on a gated window, so no downshift can fire from one.
  const slowEvidenceMs = slow
    ? (mainThreadBound ? state.slowEvidenceMs : state.slowEvidenceMs + duration)
    : Math.max(0, state.slowEvidenceMs - duration * 2);

  // A completed hold outranks a completed stability window: at that moment the
  // tier is proven wrong, and locking a tier known to be wrong is the worse
  // outcome. The new tier then gets a stability window of its own. Past the
  // lock this is the only branch that can still act, and the tier it hands
  // back cools down exactly as one from calibration does — so a long hot
  // session may legitimately walk high -> med -> low, a step at a time.
  if (slowEvidenceMs >= downHoldMs(state)) {
    return {
      quality: lowerQuality(state.quality),
      smoothedFrameMs,
      warmupRemainingMs: 0,
      cooldownRemainingMs: ADAPTIVE_SWITCH_COOLDOWN_MS,
      slowEvidenceMs: 0,
      locked: state.locked || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
      stableMs: 0,
      calibrationMs,
    };
  }

  const stableMs = state.stableMs + duration;
  return {
    ...state,
    smoothedFrameMs,
    slowEvidenceMs,
    stableMs,
    calibrationMs,
    locked: state.locked
      || stableMs >= QUALITY_LOCK_STABLE_MS
      || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
  };
}

// ——— A tier change is a change, and a change has a shape ————————————————
//
// A tier switch replaced the picture between two frames: the halo lost three
// quarters of its points, the stars two thirds, the DPR a third, all inside
// one raf. On a settled page that reads as a glitch — something broke — rather
// than as a control acting, which is the one thing an adaptive controller must
// never look like, because a reader who thinks the page broke reloads it and
// gets a fresh calibration.
//
// `HUD_MOTION.linger`, and report D's own suggestion was 600. The ladder's
// whole job is to stop a taste from becoming the twenty-seventh duration in
// the application, and 700 is the rung whose meaning already fits: A BEAT HELD
// TO BE READ. Long enough that the picture changing is legible as one motion,
// short enough to be over before a reader goes looking for its cause. The 100
// ms between the two numbers is not a design difference; having a rung is.
export const QUALITY_CROSSFADE_MS = HUD_MOTION.linger;

/** Where a crossfade stands, `0` at the switch and `1` when it is over.
 *  Smoothstep rather than linear for the reason every fade in the HUD eases:
 *  the ends are where a change is noticed, and a ramp that starts and stops at
 *  full speed is two edges with a slope between them. */
export function qualityCrossfade(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const t = Math.min(1, elapsedMs / QUALITY_CROSSFADE_MS);
  return t * t * (3 - 2 * t);
}

/** One knob, mid-crossfade. Geometric rather than linear, because these are
 *  MULTIPLIERS: the halfway point between a quarter and one is a half, not
 *  five eighths, and a linear blend spends most of the fade near the top. */
export function blendQualityMul(from: number, to: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const a = Math.max(0.0001, from);
  const b = Math.max(0.0001, to);
  return a * ((b / a) ** t);
}
