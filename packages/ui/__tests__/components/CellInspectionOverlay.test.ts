import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cellInspectorPlacement,
  selectedCellScanAccent,
  useCellInspectionDismiss,
} from '../../src/components/CellInspectionOverlay';

const INSPECTION_OVERLAY_SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/CellInspectionOverlay.tsx',
), 'utf8');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function pointerDown(target: Element, button: number): void {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  target.dispatchEvent(event);
}

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
  data_bytes: 1,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_shape_seed: [1, 2],
  type_shape_seed: null,
  data_shape_seed: [3, 4],
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

  it('changes the detail connector accent with the focused Cell facet', () => {
    const resting = selectedCellScanAccent({ cell: selected }, null);
    const lock = selectedCellScanAccent({ cell: selected }, 'lock');
    const data = selectedCellScanAccent({ cell: selected }, 'data');

    expect(lock).not.toBe(resting);
    expect(data).not.toBe(lock);
    expect(selectedCellScanAccent({
      cell: { ...selected, death_at_ms: 1 },
    }, 'state')).not.toBe(selectedCellScanAccent({ cell: selected }, 'state'));
  });

  it('tethers details without rebuilding a scanning apparatus around the Cell', () => {
    expect(INSPECTION_OVERLAY_SOURCE).toContain('data-cell-detail-connector');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('data-cell-detail-anchor');
    expect(INSPECTION_OVERLAY_SOURCE).toContain(
      'cknerv-cell-detail-anchor-enter',
    );
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('scanPlaneRef');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<torusGeometry');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<cylinderGeometry');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<octahedronGeometry');
  });

  it('projects once from cached ResizeObserver measurements', () => {
    expect(INSPECTION_OVERLAY_SOURCE).toContain('new ResizeObserver');
    expect(INSPECTION_OVERLAY_SOURCE).toContain(
      'const cardX = anchorX + placement.x',
    );
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('card.offsetWidth');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('card.offsetHeight');
  });

  it('keeps the card DOM outside the Canvas container', () => {
    // The card is a viewport-fixed Canvas sibling driven through the handles
    // channel — no drei Html wrapper, no in-Canvas DOM, no click shims.
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('@react-three/drei');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('data-cell-inspection-layer');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('createCellInspectionHandles');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('CellInspectionAnchor');
    // The Escape handler still stops propagation; the card itself needs no
    // click shim against the R3F root anymore.
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain(
      'onClick={(event) => event.stopPropagation()}',
    );
  });
});

describe('Cell inspection dismissal', () => {
  it('keeps pointer interaction inside a detail window and closes outside it', () => {
    const boundary = document.createElement('div');
    const inside = document.createElement('button');
    const outside = document.createElement('button');
    boundary.append(inside);
    document.body.append(boundary, outside);
    const onDismiss = vi.fn();

    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));

    pointerDown(inside, 0);
    expect(onDismiss).not.toHaveBeenCalled();
    pointerDown(outside, 2);
    expect(onDismiss).not.toHaveBeenCalled();
    pointerDown(outside, 0);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('closes the complete details view on Escape', () => {
    const boundary = document.createElement('div');
    document.body.append(boundary);
    const onDismiss = vi.fn();
    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(escape);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
  });
});
