import { CELL_CLICK_MAX_POINTER_DELTA_PX } from '@cknerv/ui';

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
 */
export const ORBIT_DRAG_MIN_TRAVEL_PX = CELL_CLICK_MAX_POINTER_DELTA_PX;

export interface OrbitGestureState {
  active: boolean;
  /** The pointer travelled past the click tolerance: this is a real drag. */
  dragged: boolean;
  revisionNoted: boolean;
  /** Where the press landed. NaN until a pointer-down has been seen. */
  originX: number;
  originY: number;
  suppressPointerActionUntilMs: number;
  /** OrbitControls reported a camera change since the last frame settled.
   *  Latched by `change`, read and cleared once per frame. */
  cameraChangedSinceFrame: boolean;
  /** The camera moved during the frame that last settled — by the hand, or
   *  by the damping tail OrbitControls runs after the hand lets go. */
  cameraMoving: boolean;
}

export function createOrbitGestureState(): OrbitGestureState {
  return {
    active: false,
    dragged: false,
    revisionNoted: false,
    originX: Number.NaN,
    originY: Number.NaN,
    suppressPointerActionUntilMs: 0,
    cameraChangedSinceFrame: false,
    cameraMoving: false,
  };
}

/**
 * A press lands. This runs before OrbitControls has decided whether it owns the
 * pointer at all, so it only records where the gesture started — and retires
 * the previous gesture's suppression window, whose one job (covering the drag's
 * own release) is finished by the time the next press arrives.
 */
export function noteOrbitPointerDown(
  state: OrbitGestureState,
  x: number,
  y: number,
): void {
  state.originX = x;
  state.originY = y;
  state.dragged = false;
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
  if (Math.round(Math.sqrt(dx * dx + dy * dy)) <= ORBIT_DRAG_MIN_TRAVEL_PX) return false;
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

/** Once per frame, after OrbitControls has had its update: settle the latch
 *  into `cameraMoving` and return it. A frame that passes with no change is
 *  the camera at rest. */
export function settleOrbitCameraFrame(state: OrbitGestureState): boolean {
  state.cameraMoving = state.cameraChangedSinceFrame;
  state.cameraChangedSinceFrame = false;
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
 * Bounded by construction: the tail decays geometrically (`dampingFactor`
 * 0.08, so the pending delta shrinks by 8% an update) and OrbitControls stops
 * reporting `change` once the camera moves less than 1e-3 units or radians
 * a frame — about 100–130 frames after a release of any strength, the last
 * ~30 of them sporadic. Only a hand that never lets go keeps it open.
 */
export function orbitInMotion(state: OrbitGestureState): boolean {
  return state.active || state.cameraMoving;
}
