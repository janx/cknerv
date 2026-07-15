import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  capacityMass,
  contentHashSeeds,
  deriveCellVisual,
  observedDataBytes,
  payloadDensity,
} from '../../src/derives/cellVisual.derive';

const CELL: Cell = {
  id: 7,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 42,
  tag: null,
  pos_seed: [1, 2, 3],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
  capacity: 61e8,
  data_hex: '0xdeadbeef',
  content_hash: '0x12345678abcdef0101020304ffffffff00000000000000000000000000000000',
  lock_kind: 'multisig',
  asset_kind: 'dao',
};

describe('cellVisual derive', () => {
  it('maps chain semantics to stable compact shader values', () => {
    const visual = deriveCellVisual(CELL);
    expect(visual.assetClass).toBe(3);
    expect(visual.lockClass).toBe(1);
    expect(visual.payload).toBeGreaterThan(0);
    expect(visual.mass).toBeGreaterThanOrEqual(0.84);
    expect(visual.seeds).toEqual(contentHashSeeds(CELL.content_hash));
  });

  it('uses tag only as an accent override', () => {
    const base = deriveCellVisual(CELL);
    const tagged = deriveCellVisual({ ...CELL, tag: 'wallet' });
    expect(tagged.assetClass).toBe(base.assetClass);
    expect(tagged.lockClass).toBe(base.lockClass);
    expect(tagged.accent).not.toEqual(base.accent);
  });

  it('compresses capacity monotonically into a restrained mass range', () => {
    const small = capacityMass(61e8);
    const medium = capacityMass(10_000e8);
    const whale = capacityMass(10_000_000e8);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThanOrEqual(whale);
    expect(whale).toBeLessThanOrEqual(1.2);
  });

  it('treats a truncated data string as its observed prefix only', () => {
    expect(observedDataBytes('0xdeadbeef…')).toBe(4);
    expect(payloadDensity('0x')).toBe(0);
    expect(payloadDensity(`0x${'aa'.repeat(1024)}…`)).toBe(1);
  });
});
