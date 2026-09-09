import { describe, expect, it } from 'vitest';
import {
  ORBIT_DRAG_MIN_TRAVEL_PX,
  ORBIT_POINTER_ACTION_SUPPRESS_MS,
  beginOrbitGesture,
  changeOrbitGesture,
  createOrbitGestureState,
  endOrbitGesture,
  noteOrbitCameraChange,
  noteOrbitPointerDown,
  noteOrbitPointerMove,
  orbitCameraSuspendsPicking,
  orbitGestureSuppressesPointerAction,
  orbitInMotion,
  settleOrbitCameraFrame,
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

  it('measures a press with the instrument that made it', () => {
    const finger = createOrbitGestureState();
    // The slip that cost the shipped build every touch selection: measured on
    // an iPad-sized viewport, a 5 px slip was refused as a drag.
    noteOrbitPointerDown(finger, 400, 300, 'touch');
    beginOrbitGesture(finger);
    expect(noteOrbitPointerMove(finger, 404, 303)).toBe(false);
    expect(noteOrbitPointerMove(finger, 407, 305)).toBe(false);
    // And a finger that genuinely drags still drags.
    expect(noteOrbitPointerMove(finger, 412, 306)).toBe(true);

    // A stylus is precise and keeps the mouse's tolerance, and so does an
    // event that names no type at all.
    for (const pointerType of ['pen', 'mouse', undefined]) {
      const precise = createOrbitGestureState();
      noteOrbitPointerDown(precise, 400, 300, pointerType);
      beginOrbitGesture(precise);
      expect(noteOrbitPointerMove(precise, 404, 303)).toBe(true);
    }
  });

  it('holds one gesture to one tolerance, fixed at the press', () => {
    const state = createOrbitGestureState();
    noteOrbitPointerDown(state, 400, 300, 'touch');
    beginOrbitGesture(state);
    // A second pointer touching down elsewhere does not retune a press that
    // is already in flight; the finger's own gesture keeps the finger's slop.
    expect(state.clickSlopPx).toBe(10);
    expect(noteOrbitPointerMove(state, 406, 300)).toBe(false);
    // The NEXT press is the moment the tolerance may change.
    noteOrbitPointerDown(state, 100, 100, 'mouse');
    expect(state.clickSlopPx).toBe(ORBIT_DRAG_MIN_TRAVEL_PX);
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

describe('orbit camera motion latch', () => {
  it('settles a change into one frame of motion and clears the latch', () => {
    const state = createOrbitGestureState();
    expect(orbitCameraSuspendsPicking(state)).toBe(false);

    // The damping tail: `end` has fired, `change` keeps arriving per frame.
    noteOrbitCameraChange(state);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(state.cameraMoving).toBe(true);
    expect(orbitCameraSuspendsPicking(state)).toBe(true);
    // A frame with no change: at rest, on that very frame.
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
    // Two changes inside one frame are one frame of motion.
    noteOrbitCameraChange(state);
    noteOrbitCameraChange(state);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(settleOrbitCameraFrame(state)).toBe(false);
  });

  it('keeps a paused drag suspended until its release', () => {
    const state = createOrbitGestureState();
    noteOrbitPointerDown(state, 400, 300);
    beginOrbitGesture(state);
    // A press that has not moved the camera suspends nothing.
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
    // The first change of the gesture: suspended, and it stays so across a
    // frame the pointer paused in, so the drag resumes on the index it had.
    changeOrbitGesture(state);
    noteOrbitCameraChange(state);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(orbitCameraSuspendsPicking(state)).toBe(true);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(true);
    // Release with no tail: the next settled frame is at rest.
    endOrbitGesture(state, 100);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
  });

  it('treats a wheel notch as one frame of motion', () => {
    // start → change → end in one call: the latch is what outlives it.
    const state = createOrbitGestureState();
    beginOrbitGesture(state);
    changeOrbitGesture(state);
    noteOrbitCameraChange(state);
    endOrbitGesture(state, 10);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(orbitCameraSuspendsPicking(state)).toBe(true);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
  });
});

describe('orbit motion window', () => {
  it('opens at the press and closes on the first settled frame without a change', () => {
    const state = createOrbitGestureState();
    expect(orbitInMotion(state)).toBe(false);

    // A press that has not moved the camera: picking still answers it, the
    // sampler already looks away — the gesture has begun.
    noteOrbitPointerDown(state, 400, 300);
    beginOrbitGesture(state);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitCameraSuspendsPicking(state)).toBe(false);
    expect(orbitInMotion(state)).toBe(true);

    // The drag proper, and a frame the pointer paused in.
    changeOrbitGesture(state);
    noteOrbitCameraChange(state);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(orbitInMotion(state)).toBe(true);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitInMotion(state)).toBe(true);

    // Release into a damping tail: `end` has fired, `change` keeps coming.
    endOrbitGesture(state, 100);
    noteOrbitCameraChange(state);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(orbitInMotion(state)).toBe(true);

    // The first frame that passes without a change closes the window.
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitInMotion(state)).toBe(false);
  });

  it('is the picking suspension widened by exactly the un-moved press', () => {
    // Over the whole (active, revisionNoted, cameraMoving) space: whatever
    // suspends picking is in the motion window, and the only frames in the
    // window that picking still serves are a held press before its first
    // camera change.
    for (const active of [false, true]) {
      for (const revisionNoted of [false, true]) {
        for (const cameraMoving of [false, true]) {
          const state = {
            ...createOrbitGestureState(), active, revisionNoted, cameraMoving,
          };
          const picking = orbitCameraSuspendsPicking(state);
          const motion = orbitInMotion(state);
          if (picking) expect(motion).toBe(true);
          expect(motion && !picking)
            .toBe(active && !revisionNoted && !cameraMoving);
        }
      }
    }
  });

  it('treats a wheel notch as one frame of motion', () => {
    const state = createOrbitGestureState();
    beginOrbitGesture(state);
    changeOrbitGesture(state);
    noteOrbitCameraChange(state);
    endOrbitGesture(state, 10);
    expect(orbitInMotion(state)).toBe(false);
    expect(settleOrbitCameraFrame(state)).toBe(true);
    expect(orbitInMotion(state)).toBe(true);
    expect(settleOrbitCameraFrame(state)).toBe(false);
    expect(orbitInMotion(state)).toBe(false);
  });
});
