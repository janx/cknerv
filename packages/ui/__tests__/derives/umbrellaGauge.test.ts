import { describe, it, expect } from 'vitest';
import { umbrellaWedges } from '../../src/derives/umbrellaGauge';

describe('umbrellaWedges', () => {
  it('produces 8 wedge paths', () => {
    expect(umbrellaWedges(0.5).paths).toHaveLength(8);
  });
  it('lights wedges proportional to alive ratio', () => {
    expect(umbrellaWedges(0).litCount).toBe(0);
    expect(umbrellaWedges(0.5).litCount).toBe(4);
    expect(umbrellaWedges(1).litCount).toBe(8);
  });
  it('clamps out-of-range ratios', () => {
    expect(umbrellaWedges(-1).litCount).toBe(0);
    expect(umbrellaWedges(2).litCount).toBe(8);
    expect(umbrellaWedges(Number.NaN).litCount).toBe(0);
  });
});
