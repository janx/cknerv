import type {
  ActivityFeedItem,
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import { CONTENT_BANDS } from '../components/hud/cellFormat';

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

// Seven words the feed shares with the house's content bands, and for the life
// of the file it disagreed with the bands about five of them. `identity` was
// the loudest: blue in the CELLS asset bar and PINK here, 196 apart, so the
// same word named two colours on one screen — and the feed's pink sat 33.7
// from the band system's `artifact` magenta, inside the separation floor, so
// the feed's "identity" and the asset bar's "digital object" were very nearly
// one colour meaning two things. `dao` was worse in the other direction: its
// `#ff9d52` was 34.4 from chrome orange, which put an ordinary DAO deposit in
// the instrument's own frame colour.
//
// A feed category IS a content category — it names what a transaction did, not
// whether anything is wrong — so it takes the bands rather than a palette of
// its own. The one that needed thinking about is `protocol`, which has no band
// named for it: a protocol action is a rule about who may act, which is what
// `authority` means, and it is the reading the band's own comment already
// gives. All 21 pairs clear the separation floor, which is the binding
// constraint here because these seven share ONE stacked bar.
export const ACTIVITY_CATEGORY_COLORS: Record<string, string> = {
  transfer: CONTENT_BANDS.consensus,
  dao: CONTENT_BANDS.value,
  token: CONTENT_BANDS.token,
  object: CONTENT_BANDS.artifact,
  identity: CONTENT_BANDS.identity,
  script: CONTENT_BANDS.script,
  protocol: CONTENT_BANDS.authority,
};

/** A category the feed's vocabulary does not carry. It used to take the six
 *  digits that are now `HUD_COLORS.legendInk` — a TEXT tier, the caption under
 *  a bucket bar — so the one bucket the feed could say least about was painted
 *  in the colour that belongs to the words underneath it. `unlisted` is the
 *  band that exists for exactly this: present, but claiming no family colour it
 *  has not earned.
 *
 *  Spelled by token rather than by value on purpose: `hudDiscipline.test.ts`
 *  reads this file RAW, and a comment that types the banned hex out is a hit,
 *  which is the right answer — a value that has a name has a name in prose
 *  too. */
export const ACTIVITY_UNLISTED_COLOR = CONTENT_BANDS.unlisted;

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
    color: ACTIVITY_CATEGORY_COLORS[category] ?? ACTIVITY_UNLISTED_COLOR,
  }));
  return { items: record.activities, buckets };
}

export function activityCategoryColor(category: string): string {
  return ACTIVITY_CATEGORY_COLORS[category.trim().toLowerCase()]
    ?? ACTIVITY_UNLISTED_COLOR;
}
