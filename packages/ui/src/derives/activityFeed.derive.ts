import type {
  ActivityFeedItem,
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';

export type ActivityFeedVisualState = 'ready' | 'stale';

export const ACTIVITY_FEED_STALE_AFTER_MS = 45_000;
export const ACTIVITY_FEED_MAX_ITEMS = 8;

export interface ActivityFeedBucket {
  category: string;
  count: number;
  color: string;
}

export interface ActivityFeedVisual {
  items: ActivityFeedItem[];
  buckets: ActivityFeedBucket[];
}

const CATEGORY_COLORS: Record<string, string> = {
  transfer: '#69e7ff',
  dao: '#ff9d52',
  token: '#78f2b3',
  object: '#d8b4ff',
  identity: '#ff78c6',
  script: '#7da7ff',
  protocol: '#ffd36b',
};

/** Suppress samples whose source or canonical proof is no longer usable. */
export function activityFeedVisualState(
  source: EnrichmentSourceStatus,
  record: ActivityFeedRecord,
  nowMs = Date.now(),
): ActivityFeedVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!Number.isSafeInteger(record.updated_at_ms) || record.updated_at_ms < 0) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > ACTIVITY_FEED_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

/** Validate and group the fixed-size sample before drawing its fingerprint. */
export function deriveActivityFeedVisual(
  record: ActivityFeedRecord,
): ActivityFeedVisual | null {
  if (record.activities.length > ACTIVITY_FEED_MAX_ITEMS) return null;
  const seenTransactions = new Set<string>();
  const counts = new Map<string, number>();
  let previousBlock: number | null = null;

  for (const item of record.activities) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(item.tx_hash)) return null;
    if (seenTransactions.has(item.tx_hash)) return null;
    if (!Number.isSafeInteger(item.block) || item.block < 0) return null;
    if (item.block > record.as_of.block) return null;
    if (previousBlock !== null && item.block > previousBlock) return null;
    if (!Number.isSafeInteger(item.timestamp_ms) || item.timestamp_ms < 0) return null;
    if (!Number.isSafeInteger(item.participant_count)
      || item.participant_count < 0
      || item.participant_count > 512) return null;
    const category = item.category.trim().toLowerCase();
    if (!category || category.length > 32) return null;
    if (item.label !== undefined) {
      const label = item.label.trim();
      if (!label || [...label].length > 96) return null;
    }
    seenTransactions.add(item.tx_hash);
    previousBlock = item.block;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const buckets = [...counts].map(([category, count]) => ({
    category,
    count,
    color: CATEGORY_COLORS[category] ?? '#9fb0bd',
  }));
  return { items: record.activities, buckets };
}

export function activityCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.trim().toLowerCase()] ?? '#9fb0bd';
}
