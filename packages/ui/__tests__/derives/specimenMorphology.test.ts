// packages/ui/__tests__/derives/specimenMorphology.test.ts
import { describe, it, expect } from 'vitest';
import type { Cell } from '@cknerv/types';
import { specimenMorphology } from '../../src/derives/specimenMorphology';

const base: Cell = {
  id: 1, born_at_ms: 0, death_at_ms: null, birth_block: 100, tag: 'dex', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'cd'.repeat(32), index: 0 }, capacity: 8000e8,
  data_hex: '0x' + 'ab'.repeat(64), content_hash: '0x' + '22'.repeat(32), lock_kind: 'multisig', asset_kind: 'xudt',
};

describe('specimenMorphology', () => {
  it('selects the phylum from asset_kind', () => {
    expect(specimenMorphology({ ...base, asset_kind: 'xudt' }, 0).phylum).toBe('colony');
    expect(specimenMorphology({ ...base, asset_kind: 'dao' }, 0).phylum).toBe('helix');
    expect(specimenMorphology({ ...base, asset_kind: undefined }, 0).phylum).toBe('plasmid');
  });
  it('grows organelles from data and none when bare', () => {
    expect(specimenMorphology(base, 0).organelles.length).toBeGreaterThan(0);
    const bare = specimenMorphology({ ...base, data_hex: '0x' }, 0);
    expect(bare.organelles.length).toBe(0);
    expect(bare.landmarks.organelle).toBeNull();
  });
  it('normalizes geometry within the framing radius (~1)', () => {
    const m = specimenMorphology(base, 0);
    let maxr = 0;
    for (let i = 0; i + 2 < m.segments.length; i += 3) maxr = Math.max(maxr, Math.hypot(m.segments[i], m.segments[i + 1], m.segments[i + 2]));
    expect(maxr).toBeLessThanOrEqual(1.01);
    expect(maxr).toBeGreaterThan(0.3);
  });
  it('drops viability for a dead cell and carries a habitat tint', () => {
    expect(specimenMorphology({ ...base, death_at_ms: 9 }, 0).viability).toBeLessThan(1);
    expect(specimenMorphology(base, 0).tint).toHaveLength(3);
  });
});
