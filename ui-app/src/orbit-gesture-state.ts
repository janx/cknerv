export const ORBIT_POINTER_MISS_SUPPRESS_MS = 180;

export interface OrbitGestureState {
  active: boolean;
  moved: boolean;
  revisionNoted: boolean;
  suppressPointerMissUntilMs: number;
}

export function createOrbitGestureState(): OrbitGestureState {
  return {
    active: false,
    moved: false,
    revisionNoted: false,
    suppressPointerMissUntilMs: 0,
  };
}

export function beginOrbitGesture(state: OrbitGestureState): void {
  state.active = true;
  state.moved = false;
  state.revisionNoted = false;
}

/** Returns true once per real gesture, when camera automation should yield. */
export function changeOrbitGesture(state: OrbitGestureState): boolean {
  if (!state.active) return false;
  state.moved = true;
  if (state.revisionNoted) return false;
  state.revisionNoted = true;
  return true;
}

export function endOrbitGesture(
  state: OrbitGestureState,
  atMs: number,
): void {
  state.active = false;
  if (!state.moved) return;
  const safeAtMs = Number.isFinite(atMs) ? atMs : 0;
  state.suppressPointerMissUntilMs = Math.max(
    state.suppressPointerMissUntilMs,
    safeAtMs + ORBIT_POINTER_MISS_SUPPRESS_MS,
  );
}

/** A drag may release before or after R3F reports the missed pointer target. */
export function orbitGestureSuppressesPointerMiss(
  state: OrbitGestureState,
  atMs: number,
): boolean {
  const safeAtMs = Number.isFinite(atMs) ? atMs : 0;
  return (state.active && state.moved)
    || safeAtMs < state.suppressPointerMissUntilMs;
}
