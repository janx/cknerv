import { describe, it, expect } from 'vitest';
import { nucleusBoundingRadius, framingScale } from '../../../src/components/hud/nucleusFraming';

describe('nucleusFraming', () => {
  it('bounding radius is the farthest vertex distance from origin', () => {
    // two segment endpoints: (3,4,0) → r=5, and (0,0,1) → r=1
    expect(nucleusBoundingRadius([3, 4, 0, 0, 0, 1])).toBeCloseTo(5, 6);
  });
  it('bounding radius of empty is 0', () => {
    expect(nucleusBoundingRadius([])).toBe(0);
  });
  it('framingScale maps radius to the target world radius', () => {
    expect(framingScale(2, 1)).toBeCloseTo(0.5, 6);
    expect(framingScale(0.5)).toBeCloseTo(2, 6); // default target 1.0
  });
  it('framingScale guards a zero radius', () => {
    expect(framingScale(0)).toBe(1);
  });
});
