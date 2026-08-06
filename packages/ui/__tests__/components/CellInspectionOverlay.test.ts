import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellInspectorPlacement,
  selectedCellScanAccent,
} from '../../src/components/CellInspectionOverlay';

const selected: Cell = {
  id: 7,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 100,
  tag: 'wallet',
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 0 },
  capacity: 10_000_000_000,
  data_hex: '0x01',
  content_hash: `0x${'22'.repeat(32)}`,
  lock_kind: 'omnilock',
  asset_kind: 'xudt',
};

describe('cellInspectorPlacement', () => {
  it('opens beside the selected Cell when there is room', () => {
    expect(cellInspectorPlacement({
      anchorX: 300,
      anchorY: 400,
      panelWidth: 500,
      panelHeight: 300,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ side: 'right', x: 42, y: -150 });
  });

  it('flips to the left before the inspector crosses the viewport edge', () => {
    expect(cellInspectorPlacement({
      anchorX: 1000,
      anchorY: 400,
      panelWidth: 500,
      panelHeight: 300,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ side: 'left', x: -542, y: -150 });
  });

  it('respects the top HUD safe area while remaining Cell-tethered', () => {
    expect(cellInspectorPlacement({
      anchorX: 300,
      anchorY: 120,
      panelWidth: 500,
      panelHeight: 300,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ side: 'right', x: 42, y: -16 });
  });

  it('uses an above/below tether on a narrow screen', () => {
    const below = cellInspectorPlacement({
      anchorX: 195,
      anchorY: 400,
      panelWidth: 362,
      panelHeight: 300,
      viewportWidth: 390,
      viewportHeight: 800,
    });
    const above = cellInspectorPlacement({
      anchorX: 195,
      anchorY: 700,
      panelWidth: 362,
      panelHeight: 300,
      viewportWidth: 390,
      viewportHeight: 800,
    });

    expect(below).toEqual({ side: 'below', x: -181, y: 42 });
    expect(above).toEqual({ side: 'above', x: -181, y: -342 });
  });

  it('changes the physical scan field accent with the focused Cell facet', () => {
    const resting = selectedCellScanAccent({ cell: selected }, null);
    const lock = selectedCellScanAccent({ cell: selected }, 'lock');
    const data = selectedCellScanAccent({ cell: selected }, 'data');

    expect(lock).not.toBe(resting);
    expect(data).not.toBe(lock);
    expect(selectedCellScanAccent({
      cell: { ...selected, death_at_ms: 1 },
    }, 'state')).not.toBe(selectedCellScanAccent({ cell: selected }, 'state'));
  });
});
