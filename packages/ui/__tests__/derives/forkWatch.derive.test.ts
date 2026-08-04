import { describe, expect, it } from 'vitest';
import type {
  EnrichmentSourceStatus,
  ForkWatchRecord,
} from '@cknerv/types';
import {
  deriveForkWatchVisual,
  FORK_WATCH_STALE_AFTER_MS,
  forkWatchVisualState,
} from '../../src/derives/forkWatch.derive';

const record: ForkWatchRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1_700_000_100_000,
  recent_window_seconds: 86_400,
  recent_reorg: {
    detected_at_ms: 1_700_000_000_000,
    fork_point: 97,
    old_tip: 98,
    new_tip: 99,
    depth: 1,
    orphaned_blocks: 1,
    orphaned_transactions: 3,
    kind: 'reorg',
  },
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['fork_watch'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('fork-watch visual derivation', () => {
  it('keeps a recent indexed reorg separate from canonical counters', () => {
    const visual = deriveForkWatchVisual(record);
    expect(visual?.signal).toBe('recent');
    expect(visual?.recentReorg?.orphaned_transactions).toBe(3);
    expect(visual?.deepFork).toBeNull();
  });

  it('represents an active deep fork only when its persisted event agrees', () => {
    const deepRecord: ForkWatchRecord = {
      ...record,
      recent_reorg: {
        ...record.recent_reorg!,
        detected_at_ms: 1_700_000_050_000,
        fork_point: 95,
        old_tip: 102,
        new_tip: 100,
        depth: 3,
        orphaned_blocks: 0,
        orphaned_transactions: 0,
        kind: 'deep',
      },
      deep_fork: {
        detected_at_ms: 1_700_000_050_000,
        fork_point: 95,
        indexed_tip: 102,
        chain_tip: 100,
        depth: 3,
      },
    };
    expect(deriveForkWatchVisual(deepRecord)?.signal).toBe('deep');
    expect(deriveForkWatchVisual({
      ...deepRecord,
      deep_fork: { ...deepRecord.deep_fork!, depth: 4 },
    })).toBeNull();
    expect(forkWatchVisualState({
      ...source,
      status: 'incompatible',
      validated_anchor: undefined,
    }, deepRecord, deepRecord.updated_at_ms)).toBe('incompatible');
    expect(forkWatchVisualState({
      ...source,
      status: 'incompatible',
      validated_anchor: undefined,
    }, deepRecord, deepRecord.updated_at_ms + FORK_WATCH_STALE_AFTER_MS + 1)).toBeNull();
  });

  it('validates clear windows and rejects unanchored event bounds', () => {
    expect(deriveForkWatchVisual({
      ...record,
      recent_reorg: undefined,
    })?.signal).toBe('clear');
    expect(deriveForkWatchVisual({
      ...record,
      recent_reorg: { ...record.recent_reorg!, new_tip: 101 },
    })).toBeNull();
    expect(deriveForkWatchVisual({
      ...record,
      recent_window_seconds: 0,
    })).toBeNull();
  });

  it('requires the capability, usable source, compatible anchor, and freshness', () => {
    expect(forkWatchVisualState(source, record, record.updated_at_ms)).toBe('ready');
    expect(forkWatchVisualState({ ...source, capabilities: [] }, record, record.updated_at_ms))
      .toBeNull();
    expect(forkWatchVisualState({ ...source, status: 'error' }, record, record.updated_at_ms))
      .toBeNull();
    expect(forkWatchVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, record.updated_at_ms)).toBeNull();
    expect(forkWatchVisualState(
      source,
      record,
      record.updated_at_ms + FORK_WATCH_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
