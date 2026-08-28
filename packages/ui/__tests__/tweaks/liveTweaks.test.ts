import { describe, it, expect } from 'vitest';
import { defaultsFrom, applyTweaks, LIVE } from '../../src/tweaks/liveTweaks';
import { galaxySchema, peerSchema } from '../../src/tweaks/tweakSchema';

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
    expect(LIVE.delivery.moteHero).toBe(1.6);
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
