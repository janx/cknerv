import { describe, expect, it } from 'vitest';
import type { ScriptCensus, ScriptRegistryRecord } from '@cknerv/types';
import {
  assetFamilyBuckets,
  hasScriptCensus,
  lockFamilyBuckets,
  scriptLabel,
} from '../../src/derives/scriptFamilies.derive';

const hash = (byte: string) => `0x${byte.repeat(32)}`;

const census: ScriptCensus = {
  locks: [
    { script: { code_hash: hash('aa'), hash_type: 'type' }, count: 500 },
    { script: { code_hash: hash('bb'), hash_type: 'type' }, count: 300 },
    { script: { code_hash: hash('cc'), hash_type: 'type' }, count: 120 },
    { script: { code_hash: hash('dd'), hash_type: 'type' }, count: 60 },
    { script: { code_hash: hash('ee'), hash_type: 'type' }, count: 20 },
  ],
  locks_tail_cells: 7,
  locks_tail_scripts: 2,
  types: [
    { script: { code_hash: hash('11'), hash_type: 'data1' }, count: 90 },
  ],
  types_tail_cells: 0,
  types_tail_scripts: 0,
  types_absent: 800,
  unidentified: 13,
};

const registry: ScriptRegistryRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: 1,
  entries: [
    { code_hash: hash('aa'), hash_type: 'type', name: 'Default Lock', deprecated: false },
    { code_hash: hash('bb'), hash_type: 'type', name: 'JoyID', deprecated: false },
    { code_hash: hash('11'), hash_type: 'data1', name: 'xUDT', deprecated: false },
  ],
  unresolved: 4,
};

describe('scriptFamilies.derive', () => {
  it('names what the index named and shows the code hash for the rest', () => {
    const buckets = lockFamilyBuckets(census, registry);
    expect(buckets.map((b) => b.label)).toEqual([
      'Default Lock',
      'JoyID',
      // Unnamed families keep their identity rather than becoming "other".
      '0xcccc…ccc',
      '0xdddd…ddd',
      // Ranks past the cut, plus the census's own tail, in one segment that
      // says how many families it stands for.
      '+3 more',
      'unidentified',
    ]);
    expect(buckets.map((b) => b.named)).toEqual([true, true, false, false, false, false]);
  });

  it('sums to every alive cell so the bar cannot silently drop one', () => {
    const alive = 500 + 300 + 120 + 60 + 20 + 7 + 13;
    expect(lockFamilyBuckets(census, registry).reduce((n, b) => n + b.count, 0))
      .toBe(alive);
    // The remainder is the ranks past the cut (20) plus the census tail (7).
    expect(lockFamilyBuckets(census, registry).find((b) => b.key === 'rest')?.count)
      .toBe(27);
  });

  it('keeps neighbouring segments visually distinct', () => {
    const colors = lockFamilyBuckets(census, registry).map((b) => b.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('carries plain cells as CKB rather than as an unnamed family', () => {
    const buckets = assetFamilyBuckets(census, registry);
    expect(buckets[0]).toMatchObject({ key: 'native', label: 'CKB', count: 800 });
    expect(buckets[1]).toMatchObject({ label: 'xUDT', count: 90 });
    // No type-script tail here, and unidentified belongs to the lock bar only.
    expect(buckets).toHaveLength(2);
  });

  it('works with no registry at all, which is the CKB-only dashboard', () => {
    const buckets = lockFamilyBuckets(census, null);
    expect(buckets.every((b) => !b.named)).toBe(true);
    expect(buckets[0].label).toBe('0xaaaa…aaa');
    expect(buckets[0].count).toBe(500);
  });

  it('reports whether a census exists at all', () => {
    expect(hasScriptCensus(census)).toBe(true);
    expect(hasScriptCensus(undefined)).toBe(false);
    expect(hasScriptCensus({
      locks: [],
      locks_tail_cells: 0,
      locks_tail_scripts: 0,
      types: [],
      types_tail_cells: 0,
      types_tail_scripts: 0,
      types_absent: 0,
      unidentified: 0,
    })).toBe(false);
  });

  it('matches identities on the hash type too', () => {
    const names = new Map([[`${hash('aa')}:type`, 'Default Lock']]);
    expect(scriptLabel({ code_hash: hash('aa'), hash_type: 'type' }, names))
      .toEqual({ label: 'Default Lock', named: true });
    // Same 32 bytes, different hash type: a different script, not this one.
    expect(scriptLabel({ code_hash: hash('aa'), hash_type: 'data1' }, names).named)
      .toBe(false);
  });
});
