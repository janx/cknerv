import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_CELL_DISPLAY_BUDGETS,
  CELL_DISPLAY_MAX,
  CELL_DISPLAY_MIN,
  automaticCellDisplayLimit,
  cellDisplayLimitToSliderValue,
  cellDisplaySliderMaximum,
  cellDisplaySliderValueToLimit,
  getCellDisplayRuntimeSnapshot,
  normalizeCellDisplayCapacity,
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
  it('resolves the AUTO budget from the quality tier rungs', () => {
    // Explicit product decision (2026-08-10): quality adjusts membership
    // within the rungs; `low` preserves the historical 6K budget.
    expect(AUTO_CELL_DISPLAY_BUDGETS.low).toBe(6_000);
    expect(automaticCellDisplayLimit('high')).toBe(50_000);
    expect(automaticCellDisplayLimit('med')).toBe(20_000);
    expect(automaticCellDisplayLimit('low')).toBe(6_000);
    // Nested rungs: a lower tier's budget never exceeds a higher tier's.
    expect(AUTO_CELL_DISPLAY_BUDGETS.low)
      .toBeLessThanOrEqual(AUTO_CELL_DISPLAY_BUDGETS.med);
    expect(AUTO_CELL_DISPLAY_BUDGETS.med)
      .toBeLessThanOrEqual(AUTO_CELL_DISPLAY_BUDGETS.high);

    // The server's retained capacity still bounds every tier.
    expect(automaticCellDisplayLimit('high', 2_000)).toBe(2_000);
    expect(automaticCellDisplayLimit('med', 2_000)).toBe(2_000);
    expect(automaticCellDisplayLimit('low', 2_000)).toBe(2_000);
  });

  it('normalizes manual values to a safe renderer step and capacity', () => {
    expect(normalizeCellDisplayLimit(2_749)).toBe(2_700);
    expect(normalizeCellDisplayLimit(9_124)).toBe(9_000);
    expect(normalizeCellDisplayLimit(-1)).toBe(CELL_DISPLAY_MIN);
    expect(normalizeCellDisplayLimit(99_999)).toBe(CELL_DISPLAY_MAX);
    expect(normalizeCellDisplayLimit(Number.NaN)).toBe(CELL_DISPLAY_MAX);
    expect(normalizeCellDisplayCapacity(99_999)).toBe(CELL_DISPLAY_MAX);
    expect(normalizeCellDisplayLimit(9_000, 3_333)).toBe(3_333);
  });

  it('uses a piecewise slider scale that preserves low-count precision', () => {
    expect(cellDisplaySliderMaximum()).toBe(229);
    expect(cellDisplayLimitToSliderValue(100)).toBe(0);
    expect(cellDisplayLimitToSliderValue(5_000)).toBe(49);
    expect(cellDisplayLimitToSliderValue(6_000)).toBe(53);
    expect(cellDisplayLimitToSliderValue(20_000)).toBe(109);
    expect(cellDisplayLimitToSliderValue(50_000)).toBe(229);
    expect(cellDisplaySliderValueToLimit(0)).toBe(100);
    expect(cellDisplaySliderValueToLimit(49)).toBe(5_000);
    expect(cellDisplaySliderValueToLimit(53)).toBe(6_000);
    expect(cellDisplaySliderValueToLimit(109)).toBe(20_000);
    expect(cellDisplaySliderValueToLimit(229)).toBe(50_000);

    expect(cellDisplaySliderMaximum(3_333)).toBe(33);
    expect(cellDisplaySliderValueToLimit(33, 3_333)).toBe(3_333);
  });

  it('lets manual Cell capacity override quality without changing its tier', () => {
    setCellDisplayLimit(2_700);
    const manual = getCellDisplayRuntimeSnapshot();

    expect(manual).toEqual({ mode: 'manual', manualLimit: 2_700 });
    expect(resolveCellDisplayLimit(manual, 'high')).toBe(2_700);
    expect(resolveCellDisplayLimit(manual, 'low')).toBe(2_700);
    expect(resolveCellDisplayLimit(manual, 'low', 2_000)).toBe(2_700);

    setCellDisplayMode('auto');
    const automatic = getCellDisplayRuntimeSnapshot();
    expect(resolveCellDisplayLimit(automatic, 'low')).toBe(6_000);
    expect(resolveCellDisplayLimit(automatic, 'high')).toBe(50_000);
    expect(automatic.manualLimit).toBe(2_700);
  });
});
