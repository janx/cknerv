import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { defaultsFrom, applyTweaks, LIVE } from '../../src/tweaks/liveTweaks';
import TweakSync from '../../src/tweaks/TweakSync';
import {
  galaxySchema, deliverySchema, peerSchema, cellSchema, nerveSchema,
} from '../../src/tweaks/tweakSchema';

describe('defaultsFrom', () => {
  it('extracts the numeric value from each knob def', () => {
    expect(defaultsFrom(galaxySchema)).toMatchObject({ rotationRate: 0.00125 });
    expect(defaultsFrom(peerSchema)).toMatchObject({
      colorCeil: 1.4,
      alphaCeil: 1.1,
    });
  });
});

describe('LIVE', () => {
  it('is initialized to the schema defaults', () => {
    expect(LIVE.galaxy.rotationRate).toBe(0.00125);
    expect(LIVE.delivery.moteHero).toBe(2.2);
    expect(LIVE.peer.surgeAmp).toBe(1.1);
    expect(LIVE.peer.colorBoost).toBe(3.75);
    expect(LIVE.cell.activeColorG).toBe(1);
  });
});

describe('applyTweaks', () => {
  it('merges present folders in place without reallocating LIVE or its folders', () => {
    const live = { galaxy: { rotationRate: 0.0025 }, delivery: { moteHero: 0.82 } } as any;
    const galaxyRef = live.galaxy;
    applyTweaks(live, { galaxy: { rotationRate: 0.01 } });
    expect(live.galaxy.rotationRate).toBe(0.01); // updated
    expect(live.delivery.moteHero).toBe(0.82);   // untouched folder unchanged
    expect(live.galaxy).toBe(galaxyRef);         // same object identity (no realloc)
  });

  it('ignores folders not present in the update', () => {
    const live = { galaxy: { rotationRate: 1 }, cell: { fabricAlpha: 0.12 } } as any;
    applyTweaks(live, { cell: { fabricAlpha: 0.3 } });
    expect(live.galaxy.rotationRate).toBe(1);
    expect(live.cell.fabricAlpha).toBe(0.3);
  });
});

describe('LIVE stands on the schema defaults with no bridge mounted', () => {
  // What makes it safe to mount `TweakSync` only when someone asks for the
  // panel: every frame-loop consumer reads `LIVE.<folder>.<key>` on every
  // frame, and if the BRIDGE were the thing that put the defaults there, an
  // unopened panel would leave the scene reading an empty store.
  it('is initialised from the schemas themselves', () => {
    expect(LIVE.galaxy).toEqual(defaultsFrom(galaxySchema));
    expect(LIVE.delivery).toEqual(defaultsFrom(deliverySchema));
    expect(LIVE.peer).toEqual(defaultsFrom(peerSchema));
    expect(LIVE.cell).toEqual(defaultsFrom(cellSchema));
    expect(LIVE.nerve).toEqual(defaultsFrom(nerveSchema));
  });

  it('is unmoved by the bridge arriving at those same defaults', () => {
    const folders = () => structuredClone({
      galaxy: LIVE.galaxy,
      delivery: LIVE.delivery,
      peer: LIVE.peer,
      cell: LIVE.cell,
      nerve: LIVE.nerve,
    });
    const before = folders();

    render(<TweakSync />);

    expect(folders()).toEqual(before);
  });
});
