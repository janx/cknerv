import { describe, expect, it } from 'vitest';
import type {
  EnrichmentSourceStatus,
  ScriptCensus,
  ScriptFamilyCensusRecord,
  ScriptRegistryRecord,
} from '@cknerv/types';
import {
  assetFamilyBuckets,
  chainAssetFamilyBuckets,
  chainLockFamilyBuckets,
  hasScriptCensus,
  lockFamilyBuckets,
  scriptFamilyCensusVisualState,
  scriptLabel,
  SCRIPT_BAR_FAMILIES,
  SCRIPT_FAMILY_CENSUS_STALE_AFTER_MS,
  SCRIPT_FAMILY_COLORS,
} from '../../src/derives/scriptFamilies.derive';
import { CONTENT_BANDS } from '../../src/components/hud/cellFormat';
import { QUALITATIVE_BUCKET_COLORS } from '../../src/components/hud/hudTheme';

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
      '0xeeee…eee',
      // The census's own tail, in one segment that says how many families it
      // stands for. Under the six-family cut nothing ranked joins it here.
      '+2 more',
      'unidentified',
    ]);
    expect(buckets.map((b) => b.named))
      .toEqual([true, true, false, false, false, false, false]);
  });

  it('sums to every alive cell so the bar cannot silently drop one', () => {
    const alive = 500 + 300 + 120 + 60 + 20 + 7 + 13;
    expect(lockFamilyBuckets(census, registry).reduce((n, b) => n + b.count, 0))
      .toBe(alive);
    // Six ranks fit, so the remainder is the census's own tail alone.
    expect(lockFamilyBuckets(census, registry).find((b) => b.key === 'rest')?.count)
      .toBe(7);
    // Cut shallower and the ranks that no longer fit join it. The sum is the
    // invariant; the cut only decides where the names stop.
    const shallow = lockFamilyBuckets(census, registry, 3);
    expect(shallow.reduce((n, b) => n + b.count, 0)).toBe(alive);
    expect(shallow.find((b) => b.key === 'rest')?.count).toBe(60 + 20 + 7);
  });

  it('keeps neighbouring segments visually distinct', () => {
    const colors = lockFamilyBuckets(census, registry).map((b) => b.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('ranks are positional slots, never content bands', () => {
    // The ruling this table used to break. A rank is a POSITION — the census
    // ranking is stable, which is the entire reason the bar colours by rank
    // rather than by a hash of the identity — so rank 0 is not "consensus
    // content", it is just first. Painting it in a band would tell a reader
    // something about the family that the bar does not know.
    //
    // Four of the six slots used to be borrowed anyway: chrome cyan, chrome
    // orange, `caution` — a HEALTH tone naming a script family — and a
    // character-for-character copy of `CONTENT_BANDS.script`. They come out of
    // the house's qualitative ramp now, the one the peer atlas's country and
    // version bars read for exactly the same reason.
    const ranked = lockFamilyBuckets(census, registry)
      .filter((bucket) => bucket.key !== 'rest' && bucket.key !== 'unidentified')
      .map((bucket) => bucket.color);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.filter((color) => !QUALITATIVE_BUCKET_COLORS.includes(color)))
      .toEqual([]);
    const bands = new Set<string>(Object.values(CONTENT_BANDS));
    expect(QUALITATIVE_BUCKET_COLORS.filter((color) => bands.has(color))).toEqual([]);

    // The bar names six families before the rest fold, and the slots are taken
    // modulo the ramp's length: a ramp shorter than the cut would wrap the last
    // family back onto the first's hue, and two segments of one colour in one
    // bar is a bar that reads as a bug.
    expect(QUALITATIVE_BUCKET_COLORS.length).toBeGreaterThanOrEqual(SCRIPT_BAR_FAMILIES);

    // And the segments that are NOT slots take the band they mean, because
    // those three do mean something: bare CKB is plain consensus content, and
    // a family nothing could place is what `unlisted` is for. Both were typed
    // out longhand rather than read — one of them digit for digit.
    expect(SCRIPT_FAMILY_COLORS.native).toBe(CONTENT_BANDS.consensus);
    expect(SCRIPT_FAMILY_COLORS.rest).toBe(CONTENT_BANDS.unlisted);
    expect(lockFamilyBuckets(census, registry)
      .find((bucket) => bucket.key === 'rest')?.color)
      .toBe(CONTENT_BANDS.unlisted);
  });

  it('never spends CKB\u2019s colour twice in one bar', () => {
    // The plain segment takes one of the six rank colours, so it also takes
    // one of the six named slots: a full asset bar that wrapped its last
    // family back onto CKB\u2019s hue would read as one family drawn twice.
    const many: ScriptCensus = {
      ...census,
      types: ['11', '22', '33', '44', '55', '66', '77'].map((byte, index) => ({
        script: { code_hash: hash(byte), hash_type: 'data1' as const },
        count: 100 - index,
      })),
      types_absent: 800,
    };
    const buckets = assetFamilyBuckets(many, registry);
    const colors = buckets.map((bucket) => bucket.color);

    expect(buckets[0].label).toBe('CKB');
    expect(new Set(colors).size).toBe(colors.length);
    // The families past the reserved slot fold rather than repeat a colour.
    expect(buckets.map((bucket) => bucket.key)).toContain('rest');
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

  it('merges the versions of one family instead of repeating its name', () => {
    // Mainnet runs three Default Multisig deployments and two xUDTs. The
    // census counts each separately because they are separate scripts; a bar
    // showing "Default Multisig 1% · Default Multisig 1%" reads as a bug.
    const versioned: ScriptCensus = {
      ...census,
      locks: [
        { script: { code_hash: hash('aa'), hash_type: 'type' }, count: 40 },
        { script: { code_hash: hash('bb'), hash_type: 'type' }, count: 30 },
        { script: { code_hash: hash('cc'), hash_type: 'type' }, count: 25 },
      ],
      locks_tail_cells: 0,
      locks_tail_scripts: 0,
      unidentified: 0,
    };
    const twoVersions: ScriptRegistryRecord = {
      ...registry,
      entries: [
        { code_hash: hash('bb'), hash_type: 'type', name: 'Default Multisig', deprecated: false },
        { code_hash: hash('cc'), hash_type: 'type', name: 'Default Multisig', deprecated: false },
      ],
    };
    const buckets = lockFamilyBuckets(versioned, twoVersions);
    expect(buckets).toHaveLength(2);
    // Merged, and the merge re-ranks: 30 + 25 outranks the 40 above them.
    expect(buckets[0]).toMatchObject({ label: 'Default Multisig', count: 55 });
    expect(buckets[1].count).toBe(40);
    // Two unnamed identities are already distinct labels and stay separate.
    expect(lockFamilyBuckets(versioned, null)).toHaveLength(3);
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

describe('scriptFamilies.derive at chain scope', () => {
  const familyRecord: ScriptFamilyCensusRecord = {
    source: 'ckbadger',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: 1,
    live_cells: 1_000,
    types_absent: 663,
    types_unlisted: 17,
    locks_unlisted: 9,
    families: [
      // Named already — the index counts families, not deployments — and in
      // the index's own order, which the bar must not inherit.
      { name: 'Nervos DAO', kind: 'type', live_cells: 15 },
      { name: '.bit Income Cell', kind: 'type', live_cells: 158 },
      { name: 'xUDT', kind: 'type', live_cells: 39 },
      { name: 'COTA', kind: 'type', live_cells: 36 },
      { name: 'M-NFT', kind: 'type', live_cells: 31 },
      { name: 'Spore', kind: 'type', live_cells: 25 },
      { name: 'Simple UDT', kind: 'type', live_cells: 3 },
      { name: 'Spore Cluster', kind: 'type', live_cells: 1 },
      { name: 'M-NFT Class', kind: 'type', live_cells: 4 },
      { name: '.bit Reverse Record', kind: 'type', live_cells: 8 },
      { name: 'COTA Registry', kind: 'type', live_cells: 0 },
      { name: 'Default Lock', kind: 'lock', live_cells: 604 },
      { name: '.bit Lock', kind: 'lock', live_cells: 175 },
      { name: 'JoyID', kind: 'lock', live_cells: 109 },
      { name: 'FlashSigner', kind: 'lock', live_cells: 28 },
      { name: 'PW Lock', kind: 'lock', live_cells: 20 },
      { name: 'Force Bridge', kind: 'lock', live_cells: 18 },
      { name: 'OMNI Lock', kind: 'lock', live_cells: 17 },
      { name: 'UniPass', kind: 'lock', live_cells: 15 },
      { name: 'RGB++', kind: 'lock', live_cells: 4 },
      { name: 'Default Multisig', kind: 'lock', live_cells: 1 },
    ],
  };

  it('takes the shape the stage’s ASSETS bar takes, over the whole chain', () => {
    const buckets = chainAssetFamilyBuckets(familyRecord);
    expect(buckets.map((b) => b.label)).toEqual([
      // CKB first: a cell with no type script is not an unnamed family.
      'CKB',
      // Ranked by Cell count, never in the index's order; the DAO is the
      // seventh type family on this chain and folds off a six-slot bar.
      '.bit Income Cell',
      'xUDT',
      'COTA',
      'M-NFT',
      'Spore',
      '+5 more',
      // Typed Cells the index has no family for: not a gap in cknerv's
      // records, so not `unidentified` — a different fact under a
      // different word.
      'unlisted',
    ]);
    expect(buckets.map((b) => b.named))
      .toEqual([true, true, true, true, true, true, false, false]);
    // A family counted at zero is no segment, and no member of the fold.
    expect(buckets.find((b) => b.key === 'rest')?.families).toBe(5);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(familyRecord.live_cells);
  });

  it('ranks the lock families and counts the unlisted remainder last', () => {
    const buckets = chainLockFamilyBuckets(familyRecord);
    expect(buckets.map((b) => b.label)).toEqual([
      'Default Lock',
      '.bit Lock',
      'JoyID',
      'FlashSigner',
      'PW Lock',
      'Force Bridge',
      '+4 more',
      'unlisted',
    ]);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(familyRecord.live_cells);
    // The plain segment and the unnamed tail wear the hues the stage's bars
    // wear for the same two facts; the ranks walk the same qualitative ramp.
    const assets = chainAssetFamilyBuckets(familyRecord);
    expect(assets[0].color).toBe(CONTENT_BANDS.consensus);
    expect(assets[1].color).toBe(QUALITATIVE_BUCKET_COLORS[1]);
    expect(buckets[0].color).toBe(QUALITATIVE_BUCKET_COLORS[0]);
    expect(buckets[buckets.length - 1].color).toBe(SCRIPT_FAMILY_COLORS.unidentified);
  });

  it('omits a remainder the record does not carry', () => {
    const clean = chainLockFamilyBuckets({ ...familyRecord, locks_unlisted: 0 });
    expect(clean.map((b) => b.key)).not.toContain('unlisted');
    const bare = chainAssetFamilyBuckets({ ...familyRecord, types_absent: 0, types_unlisted: 0 });
    expect(bare[0].label).toBe('.bit Income Cell');
    // Without CKB on the bar the sixth slot goes back to a family.
    expect(bare.map((b) => b.label)).toContain('+4 more');
  });

  it('exposes the record only while its source and anchor still hold', () => {
    const source: EnrichmentSourceStatus = {
      source: 'ckbadger',
      status: 'ready',
      capabilities: ['script_family_census'],
      validated_anchor: { block: 100, hash: '0xblock100' },
    };
    expect(scriptFamilyCensusVisualState(source, familyRecord, 1)).toBe('ready');
    expect(scriptFamilyCensusVisualState({ ...source, status: 'stale' }, familyRecord, 1))
      .toBe('stale');
    expect(scriptFamilyCensusVisualState(
      source,
      familyRecord,
      familyRecord.updated_at_ms + SCRIPT_FAMILY_CENSUS_STALE_AFTER_MS + 1,
    )).toBe('stale');
    expect(scriptFamilyCensusVisualState({ ...source, status: 'error' }, familyRecord, 1))
      .toBeNull();
    // A record from past the proven anchor is a record from nowhere.
    expect(scriptFamilyCensusVisualState(
      { ...source, validated_anchor: { block: 99, hash: '0xblock99' } },
      familyRecord,
      1,
    )).toBeNull();
  });
});
