import { describe, expect, it } from 'vitest';
import {
  makeShockwaveAtArray,
  makeShockwaveColorArray,
  makeShockwaveOriginArray,
  makeShockwaveUniforms,
  SHOCKWAVE_SLOTS,
  writeShockwaveSlot,
} from '../../src/materials/shockwaveMaterial';

describe('protocol shockwave slots', () => {
  it('allocates one colour beside every time/origin slot', () => {
    expect(makeShockwaveAtArray()).toHaveLength(SHOCKWAVE_SLOTS);
    expect(makeShockwaveOriginArray()).toHaveLength(SHOCKWAVE_SLOTS * 2);
    expect(makeShockwaveColorArray()).toHaveLength(SHOCKWAVE_SLOTS * 3);
    expect(makeShockwaveUniforms().uShockwaveColor).toBeDefined();
  });

  it('writes time, origin, and carrier colour atomically into one slot', () => {
    const at = makeShockwaveAtArray();
    const origin = makeShockwaveOriginArray();
    const color = makeShockwaveColorArray();

    writeShockwaveSlot(at, origin, color, 2, 4.5, [8, -3], [0.2, 0.8, 1]);

    expect(at[2]).toBe(4.5);
    expect(Array.from(origin.slice(4, 6))).toEqual([8, -3]);
    expect(Array.from(color.slice(6, 9))).toEqual([
      expect.closeTo(0.2),
      expect.closeTo(0.8),
      1,
    ]);
  });

  it('rejects an invalid slot instead of corrupting adjacent wave state', () => {
    expect(() => writeShockwaveSlot(
      makeShockwaveAtArray(),
      makeShockwaveOriginArray(),
      makeShockwaveColorArray(),
      SHOCKWAVE_SLOTS,
      0,
      [0, 0],
      [1, 1, 1],
    )).toThrow(RangeError);
  });
});
