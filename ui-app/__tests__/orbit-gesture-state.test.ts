import { describe, expect, it } from 'vitest';
import {
  ORBIT_DRAG_MIN_TRAVEL_PX,
  ORBIT_POINTER_ACTION_SUPPRESS_MS,
  beginOrbitGesture,
  changeOrbitGesture,
  createOrbitGestureState,
  endOrbitGesture,
  noteOrbitPointerDown,
  noteOrbitPointerMove,
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

  it('lets a still-handed click through the camera changes it caused', () => {
    const state = createOrbitGestureState();

    // A press that wobbles inside the click tolerance: OrbitControls still
    // reports camera changes for it, and the selection must survive them.
    noteOrbitPointerDown(state, 400, 300);
    beginOrbitGesture(state);
    expect(changeOrbitGesture(state)).toBe(true);
    expect(noteOrbitPointerMove(state, 400 + ORBIT_DRAG_MIN_TRAVEL_PX, 300))
      .toBe(false);
    // R3F rounds its click delta, so 2.24px is still a click to the Cell
    // picker; a stricter rule here would drop what that layer accepts.
    expect(noteOrbitPointerMove(state, 402, 301)).toBe(false);
    expect(orbitGestureSuppressesPointerAction(state, 10)).toBe(false);

    endOrbitGesture(state, 100);
    expect(orbitGestureSuppressesPointerAction(state, 100)).toBe(false);
  });

  it('yields automation once and suppresses drag-release hit and miss actions', () => {
    const state = createOrbitGestureState();

    noteOrbitPointerDown(state, 400, 300);
    beginOrbitGesture(state);
    expect(changeOrbitGesture(state)).toBe(true);
    expect(changeOrbitGesture(state)).toBe(false);
    expect(noteOrbitPointerMove(state, 460, 340)).toBe(true);
    // Only the crossing move reports the drag; the rest of it is already known.
    expect(noteOrbitPointerMove(state, 480, 360)).toBe(false);
    expect(orbitGestureSuppressesPointerAction(state, 10)).toBe(true);

    endOrbitGesture(state, 100);
    expect(orbitGestureSuppressesPointerAction(state, 100)).toBe(true);
    expect(orbitGestureSuppressesPointerAction(
      state,
      100 + ORBIT_POINTER_ACTION_SUPPRESS_MS,
    )).toBe(false);
  });

  it('retires a drag window the moment the next press starts', () => {
    const state = createOrbitGestureState();

    noteOrbitPointerDown(state, 400, 300);
    beginOrbitGesture(state);
    noteOrbitPointerMove(state, 500, 400);
    endOrbitGesture(state, 100);
    expect(orbitGestureSuppressesPointerAction(state, 120)).toBe(true);

    // The window exists to cover the drag's OWN release, which is over by the
    // time a new press lands — a quick click after a drag is a real click.
    noteOrbitPointerDown(state, 500, 400);
    expect(orbitGestureSuppressesPointerAction(state, 120)).toBe(false);
  });

  it('never reads travel from a press that belongs to another gesture', () => {
    const state = createOrbitGestureState();

    // Moves outside a gesture (plain hover) and a gesture with no press of its
    // own (a wheel notch) both leave the drag verdict alone.
    expect(noteOrbitPointerMove(state, 900, 900)).toBe(false);
    beginOrbitGesture(state);
    expect(noteOrbitPointerMove(state, 900, 900)).toBe(false);
    endOrbitGesture(state, 50);
    expect(orbitGestureSuppressesPointerAction(state, 50)).toBe(false);
  });

  it('ignores change events emitted outside a user gesture', () => {
    const state = createOrbitGestureState();

    expect(changeOrbitGesture(state)).toBe(false);
    endOrbitGesture(state, Number.NaN);
    expect(orbitGestureSuppressesPointerAction(state, Number.NaN)).toBe(false);
  });
});
