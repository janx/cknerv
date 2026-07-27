import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';

import {
  canonicalRewriteEchoSeed,
  deriveCanonicalRewriteArrivals,
} from '../../src/derives/canonicalRewrite.derive';

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1_000,
    death_at_ms: null,
    birth_block: 10,
    tag: null,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: id },
    capacity: 100,
    data_hex: '0x',
    content_hash: `0x${String(id).padStart(64, '0')}`,
    ...overrides,
  };
}

describe('deriveCanonicalRewriteArrivals', () => {
  it('finds only new replacement-suffix records', () => {
    const retained = cell(1, { birth_block: 4 });
    const previous = new Map([[1, retained]]);
    const replacement = cell(2, { birth_block: 10 });
    const current = new Map([
      [1, retained],
      [2, replacement],
    ]);

    expect(deriveCanonicalRewriteArrivals(previous, current, 10)).toEqual([2]);
  });

  it('finds restored pre-boundary Cells and changed slot identities', () => {
    const spent = cell(1, { birth_block: 3, death_at_ms: 2_000 });
    const priorIdentity = cell(2, {
      content_hash: `0x${'11'.repeat(32)}`,
    });
    const previous = new Map([
      [1, spent],
      [2, priorIdentity],
    ]);
    const current = new Map([
      [1, { ...spent, death_at_ms: null }],
      [2, cell(2, { content_hash: `0x${'22'.repeat(32)}` })],
    ]);

    expect(deriveCanonicalRewriteArrivals(previous, current, 10)).toEqual([1, 2]);
  });

  it('never treats initial snapshot hydration as replacement activity', () => {
    expect(
      deriveCanonicalRewriteArrivals(null, new Map([[1, cell(1)]]), 0),
    ).toEqual([]);
  });
});

describe('canonicalRewriteEchoSeed', () => {
  it('is deterministic, bounded, and content-sensitive', () => {
    const first = canonicalRewriteEchoSeed(`0x${'11'.repeat(32)}`);
    expect(first).toBe(canonicalRewriteEchoSeed(`0x${'11'.repeat(32)}`));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
    expect(first).not.toBe(canonicalRewriteEchoSeed(`0x${'22'.repeat(32)}`));
  });
});
