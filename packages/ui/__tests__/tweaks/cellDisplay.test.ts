import { afterEach, describe, expect, it } from 'vitest';
import {
  CELL_DISPLAY_MAX,
  CELL_DISPLAY_MIN,
  automaticCellDisplayLimit,
  getCellDisplayRuntimeSnapshot,
  normalizeCellDisplayLimit,
  resolveCellDisplayLimit,
  setCellDisplayLimit,
  setCellDisplayMode,
} from '../../src/tweaks/cellDisplay';

afterEach(() => {
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
});

describe('Cell display budget', () => {
  it('maps adaptive quality tiers to the existing visual capacity cascade', () => {
    expect(automaticCellDisplayLimit('high')).toBe(6_000);
    expect(automaticCellDisplayLimit('med')).toBe(4_200);
    expect(automaticCellDisplayLimit('low')).toBe(1_800);
  });

  it('normalizes manual values to a safe renderer step and capacity', () => {
    expect(normalizeCellDisplayLimit(2_749)).toBe(2_700);
    expect(normalizeCellDisplayLimit(-1)).toBe(CELL_DISPLAY_MIN);
    expect(normalizeCellDisplayLimit(99_999)).toBe(CELL_DISPLAY_MAX);
    expect(normalizeCellDisplayLimit(Number.NaN)).toBe(CELL_DISPLAY_MAX);
  });

  it('lets manual Cell capacity override quality without changing its tier', () => {
    setCellDisplayLimit(2_700);
    const manual = getCellDisplayRuntimeSnapshot();

    expect(manual).toEqual({ mode: 'manual', manualLimit: 2_700 });
    expect(resolveCellDisplayLimit(manual, 'high')).toBe(2_700);
    expect(resolveCellDisplayLimit(manual, 'low')).toBe(2_700);

    setCellDisplayMode('auto');
    const automatic = getCellDisplayRuntimeSnapshot();
    expect(resolveCellDisplayLimit(automatic, 'low')).toBe(1_800);
    expect(automatic.manualLimit).toBe(2_700);
  });
});
