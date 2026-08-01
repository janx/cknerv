import { describe, expect, it } from 'vitest';
import {
  ORBIT_POINTER_ACTION_SUPPRESS_MS,
  beginOrbitGesture,
  changeOrbitGesture,
  createOrbitGestureState,
  endOrbitGesture,
  orbitGestureSuppressesPointerAction,
} from '../src/orbit-gesture-state';

describe('orbit gesture state', () => {
  it('keeps an empty click available for clearing selection', () => {
    const state = createOrbitGestureState();

    beginOrbitGesture(state);
    expect(orbitGestureSuppressesPointerAction(state, 10)).toBe(false);
    endOrbitGesture(state, 20);
    expect(orbitGestureSuppressesPointerAction(state, 20)).toBe(false);
  });

  it('yields automation once and suppresses drag-release hit and miss actions', () => {
    const state = createOrbitGestureState();

    beginOrbitGesture(state);
    expect(changeOrbitGesture(state)).toBe(true);
    expect(changeOrbitGesture(state)).toBe(false);
    expect(orbitGestureSuppressesPointerAction(state, 10)).toBe(true);

    endOrbitGesture(state, 100);
    expect(orbitGestureSuppressesPointerAction(state, 100)).toBe(true);
    expect(orbitGestureSuppressesPointerAction(
      state,
      100 + ORBIT_POINTER_ACTION_SUPPRESS_MS,
    )).toBe(false);
  });

  it('ignores change events emitted outside a user gesture', () => {
    const state = createOrbitGestureState();

    expect(changeOrbitGesture(state)).toBe(false);
    endOrbitGesture(state, Number.NaN);
    expect(orbitGestureSuppressesPointerAction(state, Number.NaN)).toBe(false);
  });
});
