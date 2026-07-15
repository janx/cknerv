import { describe, expect, it } from 'vitest';
import { hasQuerySwitch, resolveCanvasDpr } from '../src/render-quality';

describe('render quality route helpers', () => {
  it('enables review switches only for an explicit one', () => {
    expect(hasQuerySwitch('?render-stats=1', 'render-stats')).toBe(true);
    expect(hasQuerySwitch('?adaptive-quality=1', 'adaptive-quality')).toBe(true);
    expect(hasQuerySwitch('?adaptive-quality=0', 'adaptive-quality')).toBe(false);
    expect(hasQuerySwitch('', 'adaptive-quality')).toBe(false);
  });

  it('caps high-density displays at the effective quality DPR', () => {
    expect(resolveCanvasDpr(3, 2)).toBe(2);
    expect(resolveCanvasDpr(3, 1.5)).toBe(1.5);
    expect(resolveCanvasDpr(3, 1)).toBe(1);
  });

  it('normalizes invalid and sub-one browser DPR readings', () => {
    expect(resolveCanvasDpr(Number.NaN, 2)).toBe(1);
    expect(resolveCanvasDpr(0.75, 2)).toBe(1);
  });
});
