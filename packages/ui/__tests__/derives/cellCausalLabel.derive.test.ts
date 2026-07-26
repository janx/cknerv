import { describe, expect, it } from 'vitest';
import { deriveCellCausalLabelPlacement } from '../../src/derives/cellCausalLabel.derive';

describe('deriveCellCausalLabelPlacement', () => {
  it('continues the endpoint ray away from the transaction hub', () => {
    const placement = deriveCellCausalLabelPlacement({
      endpoint: { x: 700, y: 400 },
      hub: { x: 500, y: 400 },
      viewport: { width: 1000, height: 800 },
      label: { width: 120, height: 24 },
    });

    expect(placement.strategy).toBe('outward');
    expect(placement.rect.left).toBeGreaterThan(700);
    expect(placement.offsetX).toBeGreaterThan(0);
    expect(placement.offsetY).toBeCloseTo(0);
    expect(placement.avoidedOcclusion).toBe(true);
  });

  it('rotates around the marker when the outward ray enters HUD space', () => {
    const hud = {
      left: 760,
      top: 300,
      right: 1000,
      bottom: 560,
    };
    const placement = deriveCellCausalLabelPlacement({
      endpoint: { x: 720, y: 430 },
      hub: { x: 500, y: 430 },
      viewport: { width: 1000, height: 800 },
      label: { width: 132, height: 24 },
      occlusions: [hud],
    });

    expect(placement.strategy).not.toBe('outward');
    expect(placement.avoidedOcclusion).toBe(true);
    expect(placement.rect.right <= hud.left || placement.rect.bottom <= hud.top
      || placement.rect.top >= hud.bottom).toBe(true);
  });

  it('keeps the label and marker separate at a viewport edge', () => {
    const placement = deriveCellCausalLabelPlacement({
      endpoint: { x: 986, y: 400 },
      hub: { x: 600, y: 400 },
      viewport: { width: 1000, height: 800 },
      label: { width: 126, height: 24 },
    });

    expect(placement.rect.left).toBeGreaterThanOrEqual(8);
    expect(placement.rect.right).toBeLessThanOrEqual(992);
    expect(
      placement.rect.right <= 976
      || placement.rect.left >= 996
      || placement.rect.bottom <= 390
      || placement.rect.top >= 410,
    ).toBe(true);
  });

  it('uses a deterministic outward fallback for coincident projections', () => {
    const first = deriveCellCausalLabelPlacement({
      endpoint: { x: 400, y: 300 },
      hub: { x: 400, y: 300 },
      viewport: { width: 800, height: 600 },
      label: { width: 110, height: 22 },
    });
    const second = deriveCellCausalLabelPlacement({
      endpoint: { x: 400, y: 300 },
      hub: { x: 400, y: 300 },
      viewport: { width: 800, height: 600 },
      label: { width: 110, height: 22 },
    });

    expect(first).toEqual(second);
    expect(first.offsetX).toBeGreaterThan(0);
    expect(first.offsetY).toBeLessThan(0);
  });

  it('normalizes non-finite measurements before scoring candidates', () => {
    const placement = deriveCellCausalLabelPlacement({
      endpoint: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      hub: { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
      viewport: { width: 800, height: 600 },
      label: { width: Number.NaN, height: 22 },
      gap: Number.NaN,
      margin: Number.NaN,
    });

    expect(Object.values(placement.rect).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(placement.offsetX)).toBe(true);
    expect(Number.isFinite(placement.offsetY)).toBe(true);
  });
});
