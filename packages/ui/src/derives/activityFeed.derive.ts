import type {
  ActivityFeedItem,
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import { CONTENT_BANDS, formatCkb } from '../components/hud/cellFormat';
import {
  anchoredRecordVisualState,
  type AnchoredRecordVisualState,
} from './anchoredRecord.derive';

export type ActivityFeedVisualState = AnchoredRecordVisualState;

/** The record re-reads seven filtered pages once a minute, so three missed
 *  turns is the point at which the reading stopped being about now. */
export const ACTIVITY_FEED_STALE_AFTER_MS = 180_000;

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
// gives. All 21 pairs clear the separation floor, which used to bind because
// these seven shared ONE stacked bar; they are seven rows now, and the floor
// still binds because a reader picks a row out by its word's colour.
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
  return anchoredRecordVisualState(source, record, ACTIVITY_FEED_STALE_AFTER_MS, nowMs);
}

/**
 * The seven kinds, in the ONE order a reader learns once.
 *
 * ⚠️ The order is the reading, not a convenience. The section used to print
 * the newest eight transactions on the chain, and the chain's newest
 * transactions are two keepers writing state every block: 43 of the latest 64
 * were `.bit Time Index State`, so the panel said `SCRIPT 8` and nothing else,
 * every time anybody looked. Anything slower than one a minute — a DAO
 * withdrawal, a token mint, a Fiber channel closing — was never in the sample
 * at all. Seven fixed rows say what each kind DID; a kind that has done
 * nothing this hour still says when it last did anything.
 */
export const ACTIVITY_KINDS = [
  'transfer', 'dao', 'token', 'object', 'identity', 'protocol', 'script',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The wire's word, and the word the rail prints. `transfer` is CKB because
 *  that is what moved — the row beneath it that says `TOKEN` is a transfer
 *  too, and naming this one "transfer" would make the other six look like
 *  something else. */
const KIND_LABELS: Record<ActivityKind, string> = {
  transfer: 'CKB',
  dao: 'DAO',
  token: 'TOKEN',
  object: 'OBJECT',
  identity: 'IDENTITY',
  protocol: 'PROTOCOL',
  script: 'SCRIPT',
};

/** One printed row: a kind, what it did this hour, and the newest one of it. */
export interface ActivityKindRow {
  kind: ActivityKind;
  /** `CKB` · `DAO` · `TOKEN` · `OBJECT` · `IDENTITY` · `PROTOCOL` · `SCRIPT`. */
  label: string;
  color: string;
  /** `'42'`, or `'100+'` when the index's page ran out inside the window and
   *  the count is a floor, or `'0'`. */
  count: string;
  countIsZero: boolean;
  /** How old the newest event of this kind is — `now`, `3 min`, `2 h`, `5 d` —
   *  or null when the index has never seen one. */
  age: string | null;
  /** What that event was, in words a reader reads: `526.69 CKB`, `withdraw
   *  complete · 10 K·CKB`, `0.0005 BTC`, `burn`, `fiber · channel close`. */
  what: string | null;
  latest: ActivityFeedItem | null;
}

const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^\d+$/;

/** The page size the adapter asks for, and therefore the largest count a kind
 *  can honestly claim in one turn. A record over it is not this record. */
const MAX_IN_WINDOW = 100;

const MAX_LABEL_CHARS = 96;
const MAX_PARTICIPANTS = 512;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How long ago, at the coarseness the reading is worth.
 *
 * A rate per hour beside an age in seconds would be a false precision: the
 * record is rebuilt once a minute, so a minute is the finest true unit, and
 * anything inside one is `now`. The ladder stops at days because the kinds
 * this exists for — a token mint, an object burn — are days apart, and a
 * reader who needs the exact moment has the transaction hash on the hover.
 */
export function activityAge(timestampMs: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - timestampMs);
  if (elapsed < MINUTE_MS) return 'now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  return `${Math.floor(elapsed / DAY_MS)} d`;
}

function validItem(item: ActivityFeedItem, kind: ActivityKind, record: ActivityFeedRecord): boolean {
  if (!HASH32.test(item.tx_hash)) return false;
  if (!Number.isSafeInteger(item.block) || item.block < 0) return false;
  // The safe-suffix rule: nothing is drawn past the anchor the source
  // revalidated, because past it there is no proof the chain still holds it.
  if (item.block > record.as_of.block) return false;
  if (!Number.isSafeInteger(item.timestamp_ms) || item.timestamp_ms < 0) return false;
  if (!Number.isSafeInteger(item.participant_count)
    || item.participant_count < 0
    || item.participant_count > MAX_PARTICIPANTS) return false;
  if (item.category !== kind) return false;
  if (item.label !== undefined) {
    const label = item.label.trim();
    if (!label || [...label].length > MAX_LABEL_CHARS) return false;
  }
  if (item.amount_shannons !== undefined && !DECIMAL.test(item.amount_shannons)) return false;
  return true;
}

/** The amount and the label are two halves of one sentence, and either half
 *  may be missing: a CKB transfer has only the figure, an object burn has only
 *  the verb, a DAO withdrawal has both. */
function activityWhat(item: ActivityFeedItem): string | null {
  const parts: string[] = [];
  const label = item.label?.trim();
  if (label) parts.push(label);
  if (item.amount_shannons !== undefined) parts.push(formatCkb(BigInt(item.amount_shannons)));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Validate the seven summaries and turn them into the seven rows, or draw
 * nothing at all.
 *
 * Null is the whole safety story of this section: the panel prints nothing it
 * cannot prove, and a record whose kinds are not exactly the seven in order,
 * or whose newest event names a block the anchor does not cover, is a record
 * this browser does not understand. Half a table drawn from it would be worse
 * than no table, because a reader cannot tell which half.
 */
export function deriveActivityRows(
  record: ActivityFeedRecord,
  nowMs = Date.now(),
): ActivityKindRow[] | null {
  if (!Number.isSafeInteger(record.window_ms) || record.window_ms <= 0) return null;
  if (!Array.isArray(record.kinds) || record.kinds.length !== ACTIVITY_KINDS.length) return null;

  const rows: ActivityKindRow[] = [];
  for (let index = 0; index < ACTIVITY_KINDS.length; index += 1) {
    const kind = ACTIVITY_KINDS[index];
    const summary = record.kinds[index];
    if (summary.kind !== kind) return null;
    if (!Number.isSafeInteger(summary.in_window)
      || summary.in_window < 0
      || summary.in_window > MAX_IN_WINDOW) return null;
    const latest = summary.latest ?? null;
    if (latest !== null && !validItem(latest, kind, record)) return null;
    rows.push({
      kind,
      label: KIND_LABELS[kind],
      color: activityCategoryColor(kind),
      count: `${summary.in_window}${summary.in_window_capped ? '+' : ''}`,
      countIsZero: summary.in_window === 0,
      age: latest ? activityAge(latest.timestamp_ms, nowMs) : null,
      what: latest ? activityWhat(latest) : null,
      latest,
    });
  }
  return rows;
}

export function activityCategoryColor(category: string): string {
  return ACTIVITY_CATEGORY_COLORS[category.trim().toLowerCase()]
    ?? ACTIVITY_UNLISTED_COLOR;
}
