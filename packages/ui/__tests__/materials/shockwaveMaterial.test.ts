import { describe, expect, it } from 'vitest';
import {
  makeShockwaveAtArray,
  makeShockwaveColorArray,
  makeShockwaveOriginArray,
  makeShockwaveUniforms,
  SHOCKWAVE_SIGNAL_GLSL,
  SHOCKWAVE_SLOTS,
  WAVE_CREST_WAKE_GLSL,
  WAVE_WAKE_LENGTH,
  writeShockwaveSlot,
} from '../../src/materials/shockwaveMaterial';

describe('protocol shockwave slots', () => {
  it('owns the one crest+wake waveform both planes of the block event draw', () => {
    expect(WAVE_CREST_WAKE_GLSL).toContain('float waveCrestWake');
    // The peer-plane sampler draws through it — not a private re-derivation.
    expect(SHOCKWAVE_SIGNAL_GLSL).toContain('waveCrestWake(');
    expect(SHOCKWAVE_SIGNAL_GLSL).not.toMatch(/pow\(\(dist - ringR\)/);
    // One wake length for the shockwave and the quarter-scale contact front.
    expect(WAVE_WAKE_LENGTH).toBe(3.2);
  });

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
