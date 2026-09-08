import { describe, expect, it } from 'vitest';
import type {
  ActivityFeedItem,
  ActivityFeedRecord,
  ActivityKindSummary,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  ACTIVITY_CATEGORY_COLORS,
  ACTIVITY_FEED_STALE_AFTER_MS,
  ACTIVITY_KINDS,
  activityAge,
  activityCategoryColor,
  activityFeedVisualState,
  deriveActivityRows,
} from '../../src/derives/activityFeed.derive';
import { CONTENT_BANDS } from '../../src/components/hud/cellFormat';

const NOW = 1_700_000_000_005;

function item(over: Partial<ActivityFeedItem> & { category: string }): ActivityFeedItem {
  return {
    tx_hash: `0x${'11'.repeat(32)}`,
    block: 100,
    timestamp_ms: NOW,
    participant_count: 1,
    ...over,
  };
}

function kind(
  name: string,
  in_window: number,
  latest?: ActivityFeedItem,
  in_window_capped = false,
): ActivityKindSummary {
  return { kind: name, in_window, in_window_capped, latest };
}

/** The shape the adapter measured on the user's own index: CKB and SCRIPT
 *  running, DAO at six an hour, and four kinds whose newest event is days
 *  old — which is the entire reason the section stopped sampling eight rows. */
const record: ActivityFeedRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: NOW,
  window_ms: 3_600_000,
  kinds: [
    kind('transfer', 42, item({
      category: 'transfer',
      tx_hash: `0x${'44'.repeat(32)}`,
      participant_count: 2,
      amount_shannons: '52668983337',
    })),
    kind('dao', 6, item({
      category: 'dao',
      tx_hash: `0x${'55'.repeat(32)}`,
      block: 99,
      timestamp_ms: NOW - 60_000,
      label: 'withdraw complete',
      amount_shannons: '1000000000000',
    })),
    kind('token', 0, item({
      category: 'token',
      tx_hash: `0x${'66'.repeat(32)}`,
      block: 91,
      timestamp_ms: NOW - 5 * 86_400_000,
      label: '0.0005 BTC',
      participant_count: 2,
    })),
    kind('object', 0, item({
      category: 'object',
      tx_hash: `0x${'77'.repeat(32)}`,
      block: 93,
      timestamp_ms: NOW - 4 * 86_400_000,
      label: 'burn',
    })),
    kind('identity', 0, item({
      category: 'identity',
      tx_hash: `0x${'88'.repeat(32)}`,
      block: 94,
      timestamp_ms: NOW - 2 * 86_400_000,
      label: 'release',
    })),
    kind('protocol', 0, item({
      category: 'protocol',
      tx_hash: `0x${'99'.repeat(32)}`,
      block: 96,
      timestamp_ms: NOW - 23 * 3_600_000,
      label: 'fiber · channel close',
      participant_count: 2,
    })),
    kind('script', 100, item({
      category: 'script',
      tx_hash: `0x${'aa'.repeat(32)}`,
      label: '.bit Time Index State',
    }), true),
  ],
};

/** The same record with one kind's summary replaced — every null case below is
 *  one field away from a record that draws. */
function broken(index: number, over: Partial<ActivityKindSummary>): ActivityFeedRecord {
  const kinds = [...record.kinds];
  kinds[index] = { ...kinds[index], ...over };
  return { ...record, kinds };
}

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['activity_feed'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('activity rows', () => {
  it('draws one row per kind, in the order a reader learns once', () => {
    // The order is the contract. It is stated in the module and asserted here
    // against the record's own words, so a source that reorders its seven
    // pages is a null rather than a table whose colours moved.
    const rows = deriveActivityRows(record, NOW);
    expect(rows?.map((row) => row.kind)).toEqual([...ACTIVITY_KINDS]);
    expect(rows?.map((row) => row.label)).toEqual([
      'CKB', 'DAO', 'TOKEN', 'OBJECT', 'IDENTITY', 'PROTOCOL', 'SCRIPT',
    ]);
    expect(rows?.map((row) => row.color)).toEqual([
      CONTENT_BANDS.consensus,
      CONTENT_BANDS.value,
      CONTENT_BANDS.token,
      CONTENT_BANDS.artifact,
      CONTENT_BANDS.identity,
      CONTENT_BANDS.authority,
      CONTENT_BANDS.script,
    ]);
  });

  it('prints a count, a floor when the page ran out, and a zero that stays', () => {
    const rows = deriveActivityRows(record, NOW)!;
    expect(rows.map((row) => row.count))
      .toEqual(['42', '6', '0', '0', '0', '0', '100+']);
    // The zero is a reading — the kind was looked for and did nothing — so it
    // is marked rather than dropped.
    expect(rows.map((row) => row.countIsZero))
      .toEqual([false, false, true, true, true, true, false]);
  });

  it('ages the newest event of each kind at a fixed now', () => {
    const rows = deriveActivityRows(record, NOW)!;
    expect(rows.map((row) => row.age))
      .toEqual(['now', '1 min', '5 d', '4 d', '2 d', '23 h', 'now']);
  });

  it('reads the label and the amount as one sentence, or as whichever half exists', () => {
    const rows = deriveActivityRows(record, NOW)!;
    expect(rows.map((row) => row.what)).toEqual([
      // A CKB transfer has no label: the figure IS the reading, and it comes
      // out of the house's own K/M/G·CKB family rather than in shannons.
      '526.69 CKB',
      'withdraw complete · 10 K·CKB',
      '0.0005 BTC',
      'burn',
      'release',
      'fiber · channel close',
      '.bit Time Index State',
    ]);
  });

  it('says nothing about a kind the index has never seen', () => {
    const never = deriveActivityRows(broken(2, { latest: undefined }), NOW)!;
    expect(never[2]).toMatchObject({
      kind: 'token', count: '0', countIsZero: true, age: null, what: null, latest: null,
    });
  });

  it('says the same word about a category the rest of the HUD does', () => {
    // The feed shares seven words with the house's content bands and disagreed
    // with them about five. Asserted as a whole map rather than one row,
    // because the failure mode is a single category being retuned in place —
    // which reads as a deliberate tweak right up until you see the asset bar.
    expect(ACTIVITY_CATEGORY_COLORS).toEqual({
      transfer: CONTENT_BANDS.consensus,
      dao: CONTENT_BANDS.value,
      token: CONTENT_BANDS.token,
      object: CONTENT_BANDS.artifact,
      identity: CONTENT_BANDS.identity,
      script: CONTENT_BANDS.script,
      protocol: CONTENT_BANDS.authority,
    });
  });

  it('claims no family colour for a category it cannot name', () => {
    // The band that means "present, and claiming nothing" — it used to be a
    // text tier, which is a different layer entirely.
    expect(activityCategoryColor('a category nothing names'))
      .toBe(CONTENT_BANDS.unlisted);
  });
});

describe('activityAge', () => {
  it('is as coarse as the record is honest', () => {
    // The record is rebuilt once a minute, so a minute is the finest true
    // unit and everything inside one is `now`.
    expect(activityAge(NOW, NOW)).toBe('now');
    expect(activityAge(NOW - 59_999, NOW)).toBe('now');
    expect(activityAge(NOW - 60_000, NOW)).toBe('1 min');
    expect(activityAge(NOW - 59 * 60_000, NOW)).toBe('59 min');
    expect(activityAge(NOW - 3_600_000, NOW)).toBe('1 h');
    expect(activityAge(NOW - 23 * 3_600_000, NOW)).toBe('23 h');
    expect(activityAge(NOW - 86_400_000, NOW)).toBe('1 d');
    expect(activityAge(NOW - 5 * 86_400_000, NOW)).toBe('5 d');
  });

  it('never reads a clock skew as the future', () => {
    expect(activityAge(NOW + 10_000, NOW)).toBe('now');
  });
});

describe('a record this browser does not understand draws nothing', () => {
  it('refuses a table that is not the seven kinds in order', () => {
    expect(deriveActivityRows({ ...record, kinds: record.kinds.slice(0, 6) }, NOW))
      .toBeNull();
    expect(deriveActivityRows({
      ...record,
      kinds: [record.kinds[1], record.kinds[0], ...record.kinds.slice(2)],
    }, NOW)).toBeNull();
    expect(deriveActivityRows(broken(3, { kind: 'wormhole' }), NOW)).toBeNull();
  });

  it('refuses a window it cannot state and a count over the page it came from', () => {
    expect(deriveActivityRows({ ...record, window_ms: 0 }, NOW)).toBeNull();
    expect(deriveActivityRows({ ...record, window_ms: 1.5 }, NOW)).toBeNull();
    expect(deriveActivityRows(broken(0, { in_window: 101 }), NOW)).toBeNull();
    expect(deriveActivityRows(broken(0, { in_window: -1 }), NOW)).toBeNull();
  });

  it('refuses a newest event it cannot prove', () => {
    const latest = record.kinds[0].latest!;
    // Past the validated anchor there is no proof the chain still holds it.
    expect(deriveActivityRows(broken(0, { latest: { ...latest, block: 101 } }), NOW))
      .toBeNull();
    expect(deriveActivityRows(broken(0, { latest: { ...latest, tx_hash: '0xshort' } }), NOW))
      .toBeNull();
    expect(deriveActivityRows(broken(0, { latest: { ...latest, participant_count: 513 } }), NOW))
      .toBeNull();
    // The item's category and the summary carrying it are one word.
    expect(deriveActivityRows(broken(0, { latest: { ...latest, category: 'dao' } }), NOW))
      .toBeNull();
    expect(deriveActivityRows(broken(0, { latest: { ...latest, label: 'x'.repeat(97) } }), NOW))
      .toBeNull();
    // An amount is exact shannons or it is not an amount: `formatCkb` takes a
    // BigInt, and a string that is not a decimal integer throws inside it.
    expect(deriveActivityRows(broken(0, { latest: { ...latest, amount_shannons: '1.5' } }), NOW))
      .toBeNull();
  });
});

describe('the record has to be usable before any of it is drawn', () => {
  it('requires a usable source and compatible anchor', () => {
    expect(activityFeedVisualState(source, record, NOW)).toBe('ready');
    expect(activityFeedVisualState({ ...source, status: 'stale' }, record, NOW))
      .toBe('stale');
    expect(activityFeedVisualState({ ...source, status: 'error' }, record, NOW))
      .toBeNull();
    expect(activityFeedVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, NOW)).toBeNull();
  });

  it('dims the reading three missed turns after the last one', () => {
    // The adapter rebuilds the seven pages once a minute; three of those is
    // the point at which "the last hour" stopped being about now.
    expect(ACTIVITY_FEED_STALE_AFTER_MS).toBe(180_000);
    expect(activityFeedVisualState(
      source,
      record,
      record.updated_at_ms + ACTIVITY_FEED_STALE_AFTER_MS + 1,
    )).toBe('stale');
    expect(activityFeedVisualState(
      source,
      record,
      record.updated_at_ms + ACTIVITY_FEED_STALE_AFTER_MS - 1,
    )).toBe('ready');
  });
});
