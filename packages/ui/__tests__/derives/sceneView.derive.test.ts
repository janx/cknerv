import { describe, expect, it } from 'vitest';
import {
  CELL_DETAIL_VIEW_FABRIC_ENERGY_GAIN,
  CELL_DETAIL_VIEW_FABRIC_WIDTH_SCALE,
  CELL_DETAIL_VIEW_FAR_DISTANCE,
  CELL_DETAIL_VIEW_NEAR_DISTANCE,
  CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR,
  cellDetailFabricEnergyGain,
  cellDetailFabricWidthScale,
  cellDetailPeerContextEnergy,
  cellDetailViewFocus,
} from '../../src/derives/sceneView.derive';

describe('scene view hierarchy', () => {
  it('hands off smoothly from overview to Cell detail', () => {
    expect(cellDetailViewFocus(CELL_DETAIL_VIEW_FAR_DISTANCE)).toBe(0);
    expect(cellDetailViewFocus(CELL_DETAIL_VIEW_NEAR_DISTANCE)).toBe(1);
    expect(cellDetailViewFocus(
      (CELL_DETAIL_VIEW_NEAR_DISTANCE + CELL_DETAIL_VIEW_FAR_DISTANCE) / 2,
    )).toBeCloseTo(0.5);
    expect(cellDetailViewFocus(Number.NaN)).toBe(0);
  });

  it('raises passive Cell weight while lowering only passive peer context', () => {
    expect(cellDetailFabricEnergyGain(0)).toBe(1);
    expect(cellDetailFabricWidthScale(0)).toBe(1);
    expect(cellDetailPeerContextEnergy(0)).toBe(1);
    expect(cellDetailFabricEnergyGain(1))
      .toBe(CELL_DETAIL_VIEW_FABRIC_ENERGY_GAIN);
    expect(cellDetailFabricWidthScale(1))
      .toBe(CELL_DETAIL_VIEW_FABRIC_WIDTH_SCALE);
    expect(cellDetailPeerContextEnergy(1))
      .toBe(CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR);
  });

  it('clamps external focus values to the intended presentation range', () => {
    expect(cellDetailFabricEnergyGain(2))
      .toBe(CELL_DETAIL_VIEW_FABRIC_ENERGY_GAIN);
    expect(cellDetailFabricWidthScale(-1)).toBe(1);
    expect(cellDetailPeerContextEnergy(2))
      .toBe(CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR);
  });
});
