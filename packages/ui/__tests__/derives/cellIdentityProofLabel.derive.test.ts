import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellIdentityProofLabelFrame,
  deriveCellIdentityProofLabel,
  deriveCellIdentityProofLabelPlacement,
} from '../../src/derives/cellIdentityProofLabel.derive';

const TX_HASH = `0x${'0123456789abcdef'.repeat(4)}`;
const CONTENT_HASH = `0x${'fedcba9876543210'.repeat(4)}`;
const CELL: Cell = {
  id: 42,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 16_204_800,
  tag: null,
  pos_seed: [1, 2, 3],
  out_point: {
    tx_hash: TX_HASH,
    index: 0x01020304,
  },
  capacity: 100,
  data_hex: '0x',
  data_bytes: 0,
  content_hash: CONTENT_HASH,
  lock_shape_seed: [1, 2],
  type_shape_seed: null,
  data_shape_seed: [3, 4],
};

describe('Cell identity proof label', () => {
  it('keeps WHERE tied to the exact outpoint', () => {
    expect(deriveCellIdentityProofLabel(CELL, 'address')).toMatchObject({
      kind: 'address',
      code: 'WHERE',
      detail: '0123456·CDEF#16909060',
      title: `${TX_HASH}#16909060`,
      color: '#9DF7FF',
    });
  });

  it('keeps WHAT tied to the exact content hash', () => {
    expect(deriveCellIdentityProofLabel(CELL, 'content')).toMatchObject({
      kind: 'content',
      code: 'WHAT',
      detail: 'FEDCBA9·3210',
      title: CONTENT_HASH,
      color: '#C7A7FF',
    });
  });

  it('keeps WHEN tied to the exact birth height', () => {
    expect(deriveCellIdentityProofLabel(CELL, 'anchor')).toMatchObject({
      kind: 'anchor',
      code: 'WHEN',
      detail: '#16204800',
      title: 'Birth block #16204800 · 0xF74400',
      color: '#FFD48C',
    });
  });

  it('reveals after the geometry and shares its bounded strength', () => {
    expect(cellIdentityProofLabelFrame(0, 1)).toEqual({
      opacity: 0,
      reveal: 0,
      driftPx: 4,
    });
    const revealing = cellIdentityProofLabelFrame(0.16, 1);
    expect(revealing.opacity).toBeCloseTo(0.47);
    expect(revealing.reveal).toBeCloseTo(0.5);
    expect(revealing.driftPx).toBeCloseTo(2);
    expect(cellIdentityProofLabelFrame(0.3, 1)).toEqual({
      opacity: 0.94,
      reveal: 1,
      driftPx: 0,
    });
    expect(cellIdentityProofLabelFrame(0.3, 0).opacity).toBe(0);
  });

  it('shows resolved evidence immediately under reduced motion', () => {
    expect(cellIdentityProofLabelFrame(0, 0.5, true)).toEqual({
      opacity: 0.47,
      reveal: 1,
      driftPx: 0,
    });
  });

  it('moves away from the inspection rail and the top edge', () => {
    expect(deriveCellIdentityProofLabelPlacement({
      screenX: 800,
      screenY: 300,
      viewportWidth: 1000,
      viewportHeight: 700,
      radiusPx: 30,
    })).toEqual({
      horizontal: 'left',
      vertical: 'above',
      gapPx: 38,
      yPx: -8,
    });
    expect(deriveCellIdentityProofLabelPlacement({
      screenX: 460,
      screenY: 300,
      viewportWidth: 1000,
      viewportHeight: 700,
      radiusPx: 20,
    }).horizontal).toBe('left');
    expect(deriveCellIdentityProofLabelPlacement({
      screenX: 100,
      screenY: 30,
      viewportWidth: 1000,
      viewportHeight: 700,
      radiusPx: 0,
    })).toEqual({
      horizontal: 'right',
      vertical: 'below',
      gapPx: 12,
      yPx: 7,
    });
  });
});
