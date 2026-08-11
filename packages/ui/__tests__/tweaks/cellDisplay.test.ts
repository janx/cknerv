import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_CELL_DISPLAY_BUDGET,
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
  it('resolves the fixed AUTO budget regardless of quality', () => {
    // Explicit product decision (2026-08-11): Galaxy membership is FIXED —
    // render quality adjusts presentation only, never composition.
    expect(AUTO_CELL_DISPLAY_BUDGET).toBe(12_000);
    expect(automaticCellDisplayLimit()).toBe(12_000);

    // The server's retained capacity still bounds the budget.
    expect(automaticCellDisplayLimit(2_000)).toBe(2_000);
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

  it('keeps manual capacity independent from AUTO and its server bound', () => {
    setCellDisplayLimit(2_700);
    const manual = getCellDisplayRuntimeSnapshot();

    expect(manual).toEqual({ mode: 'manual', manualLimit: 2_700 });
    expect(resolveCellDisplayLimit(manual)).toBe(2_700);
    // The automatic capacity bound applies to AUTO only, never to manual.
    expect(resolveCellDisplayLimit(manual, 2_000)).toBe(2_700);

    setCellDisplayMode('auto');
    const automatic = getCellDisplayRuntimeSnapshot();
    expect(resolveCellDisplayLimit(automatic)).toBe(12_000);
    expect(resolveCellDisplayLimit(automatic, 2_000)).toBe(2_000);
    expect(automatic.manualLimit).toBe(2_700);
  });
});
