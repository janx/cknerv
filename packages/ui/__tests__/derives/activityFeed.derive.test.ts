import { describe, expect, it } from 'vitest';
import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  ACTIVITY_FEED_STALE_AFTER_MS,
  activityFeedVisualState,
  deriveActivityFeedVisual,
} from '../../src/derives/activityFeed.derive';

const record: ActivityFeedRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1,
  activities: [
    {
      tx_hash: `0x${'11'.repeat(32)}`,
      block: 100,
      timestamp_ms: 1,
      category: 'script',
      label: '.bit Time Info',
      participant_count: 1,
    },
    {
      tx_hash: `0x${'22'.repeat(32)}`,
      block: 99,
      timestamp_ms: 1,
      category: 'transfer',
      participant_count: 2,
    },
    {
      tx_hash: `0x${'33'.repeat(32)}`,
      block: 99,
      timestamp_ms: 1,
      category: 'script',
      participant_count: 1,
    },
  ],
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['activity_feed'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('activity feed visual derivation', () => {
  it('groups the exact fixed-size sample without claiming global shares', () => {
    const visual = deriveActivityFeedVisual(record);
    expect(visual?.buckets).toEqual([
      { category: 'script', count: 2, color: '#7da7ff' },
      { category: 'transfer', count: 1, color: '#69e7ff' },
    ]);
    expect(visual?.items).toHaveLength(3);
  });

  it('rejects duplicate, unbounded, or misordered feed data', () => {
    expect(deriveActivityFeedVisual({
      ...record,
      activities: [...record.activities, { ...record.activities[0] }],
    })).toBeNull();
    expect(deriveActivityFeedVisual({
      ...record,
      activities: [record.activities[1], record.activities[0]],
    })).toBeNull();
    expect(deriveActivityFeedVisual({
      ...record,
      activities: Array.from({ length: 9 }, (_, index) => ({
        ...record.activities[0],
        tx_hash: `0x${index.toString(16).padStart(64, '0')}`,
      })),
    })).toBeNull();
  });

  it('requires a usable source and compatible anchor', () => {
    expect(activityFeedVisualState(source, record, 1)).toBe('ready');
    expect(activityFeedVisualState({ ...source, status: 'stale' }, record, 1))
      .toBe('stale');
    expect(activityFeedVisualState({ ...source, status: 'error' }, record, 1))
      .toBeNull();
    expect(activityFeedVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, 1)).toBeNull();
  });

  it('dims the sample when its independent refresh stops', () => {
    expect(activityFeedVisualState(
      source,
      record,
      record.updated_at_ms + ACTIVITY_FEED_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
