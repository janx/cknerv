import { describe, expect, it } from 'vitest';
import { consensusMemoryCoreEnergy } from '../../src/derives/consensusMemoryCore.derive';

describe('consensusMemoryCoreEnergy', () => {
  it('hands energy from the moving read into retained agreement', () => {
    const reading = consensusMemoryCoreEnergy(1, 0);
    const converging = consensusMemoryCoreEnergy(1, 0.5);
    const retained = consensusMemoryCoreEnergy(1, 1);

    expect(reading).toEqual({ reading: 1, retained: 0 });
    expect(converging.reading).toBeLessThan(reading.reading);
    expect(converging.retained).toBeGreaterThan(reading.retained);
    expect(retained.reading).toBeCloseTo(0.1);
    expect(retained.retained).toBe(1);
  });

  it('holds the resolved Cell above a linearly fading route until release', () => {
    const releasing = consensusMemoryCoreEnergy(0.25, 1);

    expect(releasing.reading).toBeCloseTo(0.025);
    expect(releasing.retained).toBe(0.5);
    expect(releasing.retained).toBeGreaterThan(0.25);
    expect(consensusMemoryCoreEnergy(0, 1)).toEqual({
      reading: 0,
      retained: 0,
    });
  });

  it('clamps malformed inputs without inventing stored information', () => {
    expect(consensusMemoryCoreEnergy(Number.NaN, 1)).toEqual({
      reading: 0,
      retained: 0,
    });
    expect(consensusMemoryCoreEnergy(1, Number.POSITIVE_INFINITY)).toEqual({
      reading: 1,
      retained: 0,
    });
    expect(consensusMemoryCoreEnergy(2, -1)).toEqual({
      reading: 1,
      retained: 0,
    });
  });
});
