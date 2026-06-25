import { describe, it, expect } from 'vitest';
import { cellChurnRates } from '../../src/derives/cellChurn';

describe('cellChurnRates', () => {
  it('returns zeros for fewer than two samples', () => {
    expect(cellChurnRates([])).toEqual({ bornPerBlock: 0, spentPerBlock: 0, netPerBlock: 0 });
    expect(cellChurnRates([{ tip: 100, born: 10, dead: 5 }])).toEqual({ bornPerBlock: 0, spentPerBlock: 0, netPerBlock: 0 });
  });
  it('computes per-block rates across the window', () => {
    const r = cellChurnRates([
      { tip: 100, born: 10, dead: 5 },
      { tip: 108, born: 36, dead: 21 }, // span 8: born +26, dead +16
    ]);
    expect(r.bornPerBlock).toBeCloseTo(3.25);
    expect(r.spentPerBlock).toBeCloseTo(2.0);
    expect(r.netPerBlock).toBeCloseTo(1.25);
  });
  it('returns zeros when the tip span is zero (no new block)', () => {
    expect(cellChurnRates([
      { tip: 100, born: 10, dead: 5 },
      { tip: 100, born: 12, dead: 6 },
    ])).toEqual({ bornPerBlock: 0, spentPerBlock: 0, netPerBlock: 0 });
  });
});
