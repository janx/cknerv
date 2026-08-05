import type {
  EnrichmentSourceStatus,
  TransactionHorizonRecord,
} from '@cknerv/types';

export type TransactionHorizonVisualState = 'ready' | 'stale';

export const TRANSACTION_HORIZON_STALE_AFTER_MS = 3 * 60 * 1_000;
export const TRANSACTION_HORIZON_MAX_HOURLY_BUCKETS = 24;
export const TRANSACTION_HORIZON_MAX_DAILY_BUCKETS = 14;

export interface TransactionHorizonVisual {
  currentHour: number;
  currentDay: number;
  hourlyCounts: number[];
  hourlyRatios: number[];
  maxHourly: number;
  title: string;
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Suppress indexed history whose optional source or canonical proof is unusable. */
export function transactionHorizonVisualState(
  source: EnrichmentSourceStatus,
  record: TransactionHorizonRecord,
  nowMs = Date.now(),
): TransactionHorizonVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (!source.capabilities.includes('transaction_horizon')) return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor
    || !safeCount(anchor.block)
    || !safeCount(record.as_of.block)
    || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!safeCount(record.updated_at_ms)) return null;
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > TRANSACTION_HORIZON_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

/** Validate fixed bounds and normalize the hourly fingerprint for rendering. */
export function deriveTransactionHorizonVisual(
  record: TransactionHorizonRecord,
): TransactionHorizonVisual | null {
  if (!safeCount(record.current_hour)
    || !safeCount(record.current_day)
    || record.hourly_counts.length > TRANSACTION_HORIZON_MAX_HOURLY_BUCKETS
    || record.daily_counts.length > TRANSACTION_HORIZON_MAX_DAILY_BUCKETS
    || record.hourly_counts.some((count) => !safeCount(count))
    || record.daily_counts.some((count) => !safeCount(count))) return null;

  const hourlyCounts = [...record.hourly_counts];
  const maxHourly = Math.max(0, ...hourlyCounts);
  const hourlyRatios = hourlyCounts.map((count) => (
    maxHourly === 0 ? 0 : count / maxHourly
  ));
  const title = `Transaction counts validated at block #${record.as_of.block.toLocaleString('en-US')}: current hour ${record.current_hour.toLocaleString('en-US')}, current day ${record.current_day.toLocaleString('en-US')}; ${hourlyCounts.length} oldest-to-newest hourly buckets, up to 24 hours`;

  return {
    currentHour: record.current_hour,
    currentDay: record.current_day,
    hourlyCounts,
    hourlyRatios,
    maxHourly,
    title,
  };
}
