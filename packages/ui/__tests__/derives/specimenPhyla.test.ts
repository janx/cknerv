import { describe, it, expect } from 'vitest';
import { genArbor } from '../../src/derives/specimenPhyla';

const H = '0x' + 'ab'.repeat(32);
describe('genArbor', () => {
  it('is deterministic and produces geometry + four landmarks', () => {
    const a = genArbor(H, { maturity: 0.7 }), b = genArbor(H, { maturity: 0.7 });
    expect(a.segments.length).toBe(b.segments.length);
    expect(a.segments.length).toBeGreaterThan(0);
    expect(a.nodes.length).toBeGreaterThan(0);
    for (const k of ['core', 'species', 'membrane', 'outer'] as const) {
      expect(a.landmarks[k]).toHaveLength(3);
    }
    expect(a.landmarks.core).toEqual([0, 0, 0]);
  });
});
