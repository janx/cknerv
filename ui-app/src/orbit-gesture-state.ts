import { CELL_CLICK_MAX_POINTER_DELTA_PX, pointerClickSlopPx } from '@cknerv/ui';

export const ORBIT_POINTER_ACTION_SUPPRESS_MS = 180;

/**
 * What separates a drag from a click — the scene's one vocabulary for that
 * question, shared with the Cell picker.
 *
 * OrbitControls turns a SINGLE pixel of pointer travel into a camera change and
 * reports it, so "did the camera move" answers a different question than "did
 * the user drag". Gating selection on the former throws away an ordinary click
 * whose pointer wobbled one pixel between press and release — which is most
 * real clicks, and every one of them on a small target like a peer node.
 *
 * ⚠️ THIS IS THE MOUSE'S TRAVEL AND NO LONGER THE WHOLE RULE. A finger's is
 * wider (`pointerClickSlopPx`), and the two layers must agree on it or one
 * accepts what the other drops — so the live figure rides on the gesture
 * itself, fixed at the press, and this constant is what a state that has seen
 * no pointer yet stands on.
 */
export const ORBIT_DRAG_MIN_TRAVEL_PX = CELL_CLICK_MAX_POINTER_DELTA_PX;

/**
 * Per-frame projected drift, in CSS px at the orbit target's depth, at or
 * under which the camera counts as STILL — the threshold the motion window
 * closes on.
 *
 * One pixel, where the leaders take two, because this window has more to lose
 * by staying open than by closing early: what it costs is the hover
 * affordance and the sampler's evidence, and what closing early risks is a
 * hit index up to a pixel of camera stale — inside the picker's own 1.5 px
 * drift envelope, which it re-validates against on the first probe it
 * answers anyway. A pixel is also where the reading stops being a reading:
 * `poseDriftPx` sums translation and rotation conservatively, so sub-pixel
 * answers are noise about a picture nobody can see change.
 */
export const ORBIT_CAMERA_REST_DRIFT_PX = 1;
/**
 * Consecutive still frames before the window closes. Three, as everywhere
 * else a camera in this scene is declared at rest, and enough that one
 * unlucky frame (a dropped delta, a queued rAF) cannot pass for stillness.
 *
 * One threshold is enough here where the leaders needed two: a damped tail
 * decays geometrically, so drift that has fallen under a pixel cannot climb
 * back over one on its own, and rest once declared is not withdrawn by the
 * tail. A hand that moves again re-opens the window through
 * {@link orbitInMotion}'s `active` (it never closed for a held gesture) or
 * through the next frame's drift, which is what a hand produces.
 */
export const ORBIT_CAMERA_SETTLE_FRAMES = 3;

export interface OrbitGestureState {
  active: boolean;
  /** The pointer travelled past the click tolerance: this is a real drag. */
  dragged: boolean;
  revisionNoted: boolean;
  /** Where the press landed. NaN until a pointer-down has been seen. */
  originX: number;
  originY: number;
  /** How far THIS gesture may travel and still be a click — the pressing
   *  pointer's own tolerance, taken at the press and held for the gesture's
   *  life. A finger that lands beside a stylus must not retune a press
   *  already in flight, and the picker resolves the same click against the
   *  same instrument (`pointerClickSlopPx`). */
  clickSlopPx: number;
  suppressPointerActionUntilMs: number;
  /** OrbitControls reported a camera change since the last frame settled.
   *  Latched by `change`, read and cleared once per frame. */
  cameraChangedSinceFrame: boolean;
  /** The camera moved during the frame that last settled — by the hand, or
   *  by the damping tail OrbitControls runs after the hand lets go, and only
   *  while that tail still moves the PICTURE
   *  ({@link ORBIT_CAMERA_REST_DRIFT_PX}). */
  cameraMoving: boolean;
  /** Consecutive settled frames whose drift stayed at or under the rest
   *  threshold, while the controls kept reporting a change. */
  restFrames: number;
}

export function createOrbitGestureState(): OrbitGestureState {
  return {
    active: false,
    dragged: false,
    revisionNoted: false,
    originX: Number.NaN,
    originY: Number.NaN,
    clickSlopPx: ORBIT_DRAG_MIN_TRAVEL_PX,
    suppressPointerActionUntilMs: 0,
    cameraChangedSinceFrame: false,
    cameraMoving: false,
    restFrames: 0,
  };
}

/**
 * A press lands. This runs before OrbitControls has decided whether it owns the
 * pointer at all, so it only records where the gesture started — and retires
 * the previous gesture's suppression window, whose one job (covering the drag's
 * own release) is finished by the time the next press arrives.
 *
 * `pointerType` is the DOM event's own — the press is the moment the gesture
 * learns which instrument is making it, and the only moment it may ask.
 */
export function noteOrbitPointerDown(
  state: OrbitGestureState,
  x: number,
  y: number,
  pointerType?: string | null,
): void {
  state.originX = x;
  state.originY = y;
  state.dragged = false;
  state.clickSlopPx = pointerClickSlopPx(pointerType);
  state.suppressPointerActionUntilMs = 0;
}

/** The pointer moved inside a gesture. Returns true on the one move that turns
 *  it into a drag. */
export function noteOrbitPointerMove(
  state: OrbitGestureState,
  x: number,
  y: number,
): boolean {
  if (!state.active || state.dragged) return false;
  if (!Number.isFinite(state.originX) || !Number.isFinite(state.originY)) return false;
  const dx = x - state.originX;
  const dy = y - state.originY;
  // Rounded, exactly as R3F rounds its own click delta: the two must agree on
  // where a click stops being a click, or one layer accepts what another drops.
  if (Math.round(Math.sqrt(dx * dx + dy * dy)) <= state.clickSlopPx) return false;
  state.dragged = true;
  return true;
}

export function beginOrbitGesture(state: OrbitGestureState): void {
  state.active = true;
  state.dragged = false;
  state.revisionNoted = false;
}

/** Returns true once per real gesture, when camera automation should yield.
 *  A one-pixel nudge and a wheel notch are both genuine intent for the CAMERA;
 *  only selection needs the stricter drag test. */
export function changeOrbitGesture(state: OrbitGestureState): boolean {
  if (!state.active) return false;
  if (state.revisionNoted) return false;
  state.revisionNoted = true;
  return true;
}

export function endOrbitGesture(
  state: OrbitGestureState,
  atMs: number,
): void {
  state.active = false;
  if (!state.dragged) return;
  const safeAtMs = Number.isFinite(atMs) ? atMs : 0;
  state.suppressPointerActionUntilMs = Math.max(
    state.suppressPointerActionUntilMs,
    safeAtMs + ORBIT_POINTER_ACTION_SUPPRESS_MS,
  );
}

/** A drag may release before or after R3F reports its hit or missed click. */
export function orbitGestureSuppressesPointerAction(
  state: OrbitGestureState,
  atMs: number,
): boolean {
  const safeAtMs = Number.isFinite(atMs) ? atMs : 0;
  return (state.active && state.dragged)
    || safeAtMs < state.suppressPointerActionUntilMs;
}

/**
 * OrbitControls reported a camera change — inside a gesture or not. `end`
 * fires at pointer-up, but with damping the camera keeps moving for a second
 * or two afterwards and `update()` keeps reporting `change` every frame it
 * does; this latch is how the frame loop learns that, since the events
 * themselves carry no "still moving" bit.
 */
export function noteOrbitCameraChange(state: OrbitGestureState): void {
  state.cameraChangedSinceFrame = true;
}

/**
 * Once per frame, after OrbitControls has had its update: settle the latch
 * against the frame's projected drift and return the verdict. A frame that
 * passes with no change at all is the camera at rest, as it always was; a
 * frame that reports a change is motion until the drift has been at or under
 * {@link ORBIT_CAMERA_REST_DRIFT_PX} for {@link ORBIT_CAMERA_SETTLE_FRAMES}
 * frames running.
 *
 * `driftPx` is `orbitCameraDriftPx`'s reading. Its default is the absence of
 * one — a Lab with no sentinel, a caller that has no camera to measure — and
 * it lands on the latch rule this function had before the drift existed: the
 * window then runs for the controls' whole tail.
 */
export function settleOrbitCameraFrame(
  state: OrbitGestureState,
  driftPx: number = Number.POSITIVE_INFINITY,
): boolean {
  const changed = state.cameraChangedSinceFrame;
  state.cameraChangedSinceFrame = false;
  if (!changed) {
    state.restFrames = 0;
    state.cameraMoving = false;
    return false;
  }
  // `!(drift <= rest)` rather than `drift > rest`: a NaN reading is not
  // stillness.
  if (!(driftPx <= ORBIT_CAMERA_REST_DRIFT_PX)) {
    state.restFrames = 0;
    state.cameraMoving = true;
    return true;
  }
  state.restFrames += 1;
  state.cameraMoving = state.restFrames < ORBIT_CAMERA_SETTLE_FRAMES;
  return state.cameraMoving;
}

/**
 * Whether the Cell picker should skip hover probes for the frame that just
 * settled: the camera is moving, or a gesture that has already moved it is
 * still held (a paused drag keeps its suspension until release, so the drag
 * resumes without a rebuild). Automation — a route flight — is the third
 * source, and is OR'd in by the caller from the camera controller's own flag.
 */
export function orbitCameraSuspendsPicking(state: OrbitGestureState): boolean {
  return state.cameraMoving || (state.active && state.revisionNoted);
}

/**
 * Whether the frame that just settled lies inside a MOTION WINDOW: a pointer
 * gesture is held (`start` to `end` — a press that has not yet moved the
 * camera included), or the camera moved during that frame, by the hand or by
 * the damping tail after it let go. This is what the adaptive-quality sampler
 * reads, and it is {@link orbitCameraSuspendsPicking} widened by exactly the
 * un-moved press: picking must keep answering a still hand, but the sampler
 * is asking "may these frames be counted", and a press is the opening of a
 * gesture whose frames it must not count — so the window closes at the press
 * rather than one settled frame after the first change. Route automation is
 * the third source and is OR'd in by the caller, as for picking.
 *
 * Bounded by construction, and no longer by the controls' own threshold: the
 * tail decays geometrically (`dampingFactor` 0.08, so the pending delta
 * shrinks by 8% an update) and the window closes three frames after the drift
 * it produces falls under a pixel — frame 19 to 66 after a release of 0.02 to
 * 1.0 radians, where `change` itself ran for 104 to 151
 * (`__tests__/orbit-camera-drift.test.ts` plays the curve out). Only a hand
 * that never lets go keeps it open.
 */
export function orbitInMotion(state: OrbitGestureState): boolean {
  return state.active || state.cameraMoving;
}
