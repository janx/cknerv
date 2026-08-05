import { describe, expect, it } from 'vitest';
import type {
  EnrichmentSourceStatus,
  TransactionHorizonRecord,
} from '@cknerv/types';
import {
  deriveTransactionHorizonVisual,
  TRANSACTION_HORIZON_STALE_AFTER_MS,
  transactionHorizonVisualState,
} from '../../src/derives/transactionHorizon.derive';

const hash = `0x${'aa'.repeat(32)}`;
const record: TransactionHorizonRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash },
  updated_at_ms: 1,
  current_hour: 12,
  current_day: 345,
  hourly_counts: [0, 6, 12],
  daily_counts: [300, 321, 345],
};
const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['transaction_horizon'],
  validated_anchor: { block: 100, hash },
};

describe('transaction horizon visual derivation', () => {
  it('normalizes the bounded oldest-to-newest hourly fingerprint', () => {
    expect(deriveTransactionHorizonVisual(record)).toMatchObject({
      currentHour: 12,
      currentDay: 345,
      hourlyCounts: [0, 6, 12],
      hourlyRatios: [0, 0.5, 1],
      maxHourly: 12,
    });
  });

  it('rejects unsafe counts and source-sized arrays', () => {
    expect(deriveTransactionHorizonVisual({
      ...record,
      current_hour: -1,
    })).toBeNull();
    expect(deriveTransactionHorizonVisual({
      ...record,
      hourly_counts: Array.from({ length: 25 }, () => 1),
    })).toBeNull();
    expect(deriveTransactionHorizonVisual({
      ...record,
      daily_counts: Array.from({ length: 15 }, () => 1),
    })).toBeNull();
  });

  it('requires the capability and an exact compatible anchor', () => {
    expect(transactionHorizonVisualState(source, record, 1)).toBe('ready');
    expect(transactionHorizonVisualState({
      ...source,
      capabilities: [],
    }, record, 1)).toBeNull();
    expect(transactionHorizonVisualState(source, {
      ...record,
      as_of: { block: 100, hash: `0x${'bb'.repeat(32)}` },
    }, 1)).toBeNull();
  });

  it('dims after three missed refresh windows or stale source health', () => {
    expect(transactionHorizonVisualState(
      source,
      record,
      record.updated_at_ms + TRANSACTION_HORIZON_STALE_AFTER_MS + 1,
    )).toBe('stale');
    expect(transactionHorizonVisualState({
      ...source,
      status: 'stale',
    }, record, 1)).toBe('stale');
  });
});
