import { describe, expect, it } from 'vitest';
import {
  CELL_HOVER_FOCUS,
  CELL_INSPECTION_GALAXY_ROTATION_SCALE,
  CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S,
  CELL_SELECTED_FOCUS,
  CONSENSUS_BRAID_BASE_SCALE,
  cellGalaxyRotationScaleTarget,
  cellFocusTarget,
  cellNucleusLodRefreshDue,
  consensusBraidRenderScale,
  dampCellGalaxyRotationScale,
  dampCellFocus,
  focusedBraidScale,
  selectedCellNumericId,
} from '../../src/derives/cellInteraction.derive';

describe('cell interaction derivation', () => {
  it('decodes only valid cell selection ids', () => {
    expect(selectedCellNumericId('cell:42')).toBe(42);
    expect(selectedCellNumericId('ckb:local')).toBeNull();
    expect(selectedCellNumericId('cell:')).toBeNull();
    expect(selectedCellNumericId('cell:-1')).toBeNull();
    expect(selectedCellNumericId('cell:nope')).toBeNull();
    expect(selectedCellNumericId(null)).toBeNull();
  });

  it('gives selection precedence over hover', () => {
    expect(cellFocusTarget(7, null, 7)).toBe(CELL_HOVER_FOCUS);
    expect(cellFocusTarget(7, 7, 7)).toBe(CELL_SELECTED_FOCUS);
    expect(cellFocusTarget(7, 8, 9)).toBe(0);
  });

  it('eases the galaxy into a slower inspection tempo and back out', () => {
    expect(cellGalaxyRotationScaleTarget(null)).toBe(1);
    expect(cellGalaxyRotationScaleTarget(7))
      .toBe(CELL_INSPECTION_GALAXY_ROTATION_SCALE);

    const entering = dampCellGalaxyRotationScale(
      1,
      cellGalaxyRotationScaleTarget(7),
      1 / 60,
    );
    const leaving = dampCellGalaxyRotationScale(
      CELL_INSPECTION_GALAXY_ROTATION_SCALE,
      cellGalaxyRotationScaleTarget(null),
      1 / 60,
    );
    expect(entering).toBeLessThan(1);
    expect(entering).toBeGreaterThan(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(leaving).toBeGreaterThan(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(dampCellGalaxyRotationScale(Number.NaN, 3, -1)).toBe(1);
  });

  it('eases focus in faster than it releases', () => {
    const attack = dampCellFocus(0, 1, 1 / 60);
    const release = 1 - dampCellFocus(1, 0, 1 / 60);

    expect(attack).toBeGreaterThan(release);
    expect(attack).toBeGreaterThan(0);
    expect(dampCellFocus(0.9999, 1, 1 / 60)).toBe(1);
  });

  it('retains physical scale nearby and screen-compensates distant focus', () => {
    expect(focusedBraidScale(3, 1000, 2.1, 1)).toBe(CONSENSUS_BRAID_BASE_SCALE);
    expect(focusedBraidScale(150, 1000, 2.1, 0)).toBe(CONSENSUS_BRAID_BASE_SCALE);
    expect(focusedBraidScale(150, 1000, 2.1, 1)).toBeGreaterThan(3);
    expect(focusedBraidScale(10_000, 100, 0.1, 1)).toBeLessThanOrEqual(6);
  });

  it('applies the same capacity presence multiplier to render and hit scale', () => {
    const base = focusedBraidScale(3, 1000, 2.1, 1);

    expect(consensusBraidRenderScale(3, 1000, 2.1, 1, 1.12)).toBeCloseTo(
      base * 1.12,
    );
    expect(consensusBraidRenderScale(3, 1000, 2.1, 1, -1)).toBe(0);
  });

  it('samples passive nucleus LOD at 12 Hz but refreshes semantic changes immediately', () => {
    expect(cellNucleusLodRefreshDue(
      CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S * 0.99,
      false,
      false,
    )).toBe(false);
    expect(cellNucleusLodRefreshDue(
      CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S,
      false,
      false,
    )).toBe(true);
    expect(cellNucleusLodRefreshDue(0, true, false)).toBe(true);
    expect(cellNucleusLodRefreshDue(0, false, true)).toBe(true);
  });
});
