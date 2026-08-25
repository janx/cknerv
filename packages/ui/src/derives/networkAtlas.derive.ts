import {
  type EnrichmentSourceStatus,
  type NetworkAtlasBucket,
  type NetworkAtlasRecord,
} from '@cknerv/types';
import { ORDINAL_REACH_RAMP, QUALITATIVE_BUCKET_COLORS } from '../components/hud/hudTheme';

export type NetworkAtlasVisualState = 'ready' | 'stale';

export const NETWORK_ATLAS_STALE_AFTER_MS = 180_000;

/** How many label buckets one histogram may carry.
 *
 * A hostility guard rather than a policy, and the mirror of the adapter's own.
 * The real bound is the population: every bucket is at least one peer and the
 * buckets have to add up to the peers they describe, so a verified set of N
 * peers can never answer with more than N of them. This sits far enough above
 * any network CKB has ever had that it can never be what refuses a real one —
 * which is exactly what the constant it replaced (`NETWORK_ATLAS_MAX_SAMPLE`,
 * 64) had become the day the buckets stopped being folded out of a 64-row
 * page. */
export const NETWORK_ATLAS_MAX_BUCKETS = 512;

export interface NetworkAtlasBucketVisual extends NetworkAtlasBucket {
  color: string;
}

/** The three ways a round can finish with a peer, in upstream's own words for
 *  them: it ran that peer's addresses out, it got an identify from another
 *  chain, or it got one from this chain. The colony spells the first and last
 *  the same way, so a reader meets one vocabulary rather than two. */
export type NetworkAtlasReachOutcome = 'exhausted' | 'foreign' | 'reachable';

/** The bar's segments, in the order they are drawn: least evidence first.
 *
 * The order IS the reading — how far the crawler got with a peer, coarsened
 * from a dial's handshake to the whole peer — so this is where it lives, and
 * both the segment list and the ramp that paints it are counted off it rather
 * than off two literals that could drift apart. There is no fourth entry
 * because a completed candidate ends in exactly one of these three ways, and
 * `deriveNetworkAtlasVisual` refuses a record whose three do not add up to the
 * peers it says it considered. */
export const NETWORK_ATLAS_REACH_ORDER = [
  'exhausted',
  'foreign',
  'reachable',
] as const satisfies readonly NetworkAtlasReachOutcome[];

export interface NetworkAtlasReachSegment {
  outcome: NetworkAtlasReachOutcome;
  peers: number;
  color: string;
}

export interface NetworkAtlasVisual {
  /** The round's candidates, split by outcome. Ordered by how far the crawler
   *  got and NEVER by size — unlike the two histograms beside it, whose order
   *  is a rendering choice. */
  reach: NetworkAtlasReachSegment[];
  countries: NetworkAtlasBucketVisual[];
  versions: NetworkAtlasBucketVisual[];
}

// A country and a client version are qualitative buckets: `DE` is not a lock
// family and `v0.201.0` is not an asset class, and each is handed its colour by
// a hash of its own label. That is the house's `QUALITATIVE_BUCKET_COLORS` ramp
// exactly — the argument for why these bars may not read `CONTENT_BANDS`, and
// why the green sector stays shut, is written where the ramp lives. The STAGE
// script-family bar hands out the same slots for the same reason.
function labelColor(label: string): string {
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return QUALITATIVE_BUCKET_COLORS[hash % QUALITATIVE_BUCKET_COLORS.length];
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function deriveBuckets(
  buckets: NetworkAtlasBucket[],
  population: number,
): NetworkAtlasBucketVisual[] | null {
  if (buckets.length > NETWORK_ATLAS_MAX_BUCKETS) return null;
  const seen = new Set<string>();
  let total = 0;
  const visual: NetworkAtlasBucketVisual[] = [];
  for (const bucket of buckets) {
    const label = bucket.label.trim();
    if (!label || label !== bucket.label || [...label].length > 96 || seen.has(label)) {
      return null;
    }
    if ([...label].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })) return null;
    if (!Number.isSafeInteger(bucket.count) || bucket.count <= 0) return null;
    total += bucket.count;
    if (total > population) return null;
    seen.add(label);
    visual.push({ ...bucket, label, color: labelColor(label) });
  }
  // The partition, and the reason each strip may be drawn as shares of one
  // number: a histogram that does not add up to the peers it describes is not
  // a staler answer to the same question, it is a different question, and
  // every bar drawn from it would be the wrong width rather than a short one.
  if (total !== population) return null;
  visual.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return visual;
}

/** Suppress crawler context whose source or canonical proof is unusable. */
export function networkAtlasVisualState(
  source: EnrichmentSourceStatus,
  record: NetworkAtlasRecord,
  nowMs = Date.now(),
): NetworkAtlasVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (!source.capabilities.includes('network_atlas')) return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!safeNonnegativeInteger(record.updated_at_ms)) return null;
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > NETWORK_ATLAS_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

/** Validate the round's arithmetic and the census under it, then derive the
 *  reach bar and the two label fingerprints.
 *
 *  Both halves have to hold for either to render. The panel prints them as one
 *  block of numbers about one network, so a round whose counts contradict each
 *  other is not a reason to draw the strips anyway — it is a reason to believe
 *  nothing the record says. */
export function deriveNetworkAtlasVisual(
  record: NetworkAtlasRecord,
): NetworkAtlasVisual | null {
  const summaryCounts = [
    record.crawl_round,
    record.crawl_finished_at_s,
    record.candidate_peers,
    record.last_round_reachable,
    record.foreign_peers,
    record.exhausted_candidates,
    record.verified_unavailable_peers,
    record.verified_retained_peers,
    record.new_verified_peers,
    record.indexed_peers,
  ];
  if (!summaryCounts.every(safeNonnegativeInteger)) return null;
  // The round's arithmetic, which is exact rather than merely bounded.
  // Upstream reads every one of these counts off ONE disjoint outcome matrix,
  // so they are not separate measurements that happen to agree.
  //
  // A completed candidate ends in exactly one of three ways: it answered on
  // this network, it answered on another one, or the round ran out of
  // addresses to try. Those three ARE the candidates, and this equality is
  // what earns the panel the right to draw them as three widths of one bar —
  // three parts that did not close would be drawn as shares of a whole they
  // are not parts of, and every segment would be wrong rather than one.
  if (record.last_round_reachable + record.exhausted_candidates + record.foreign_peers
    !== record.candidate_peers) return null;
  // And the cross-cut. A peer the crawler still holds a verification for was
  // either reached this round or it was not, with no third case — so this is
  // an equality too, and it is why the panel may state the unavailable count
  // beside the bar without implying it is a fourth segment of it.
  // `verified_unavailable_peers` is drawn from the exhausted and foreign
  // cohorts and would double-count against them.
  if (record.last_round_reachable + record.verified_unavailable_peers
    !== record.verified_retained_peers) return null;
  if (record.new_verified_peers > record.verified_retained_peers) return null;

  // The bar, walked over the ORDER rather than over the record, so the
  // sequence a reader sees comes out of the one place that states it. A zero
  // outcome keeps its place: "nobody answered from another chain" is a result,
  // and the panel's legend prints all three counts so a segment of no width is
  // still a number on screen.
  const peersOf: Record<NetworkAtlasReachOutcome, number> = {
    exhausted: record.exhausted_candidates,
    foreign: record.foreign_peers,
    reachable: record.last_round_reachable,
  };
  const reach: NetworkAtlasReachSegment[] = NETWORK_ATLAS_REACH_ORDER
    .map((outcome, index) => ({
      outcome,
      peers: peersOf[outcome],
      // Position on the axis, and nothing else — which is why it is an index
      // into the ramp rather than a lookup keyed by the outcome. The two bars
      // below hash a label into `QUALITATIVE_BUCKET_COLORS` because a country
      // has no order; this one has nothing but order. See `ORDINAL_REACH_RAMP`
      // for why one hue at three alphas rather than three hues.
      color: ORDINAL_REACH_RAMP[index],
    }));

  // Deliberately NOT checked against `verified_retained_peers`. They mean the
  // same words on two clocks — a scan of the crawler's node store as this
  // request arrived, against what the last round's matrix added up to when it
  // finished — and an equality between them would be an invariant that fails
  // on a healthy source the first time a round lands between the two reads.
  const population = record.indexed_peers;

  const countries = deriveBuckets(record.countries, population);
  const versions = deriveBuckets(record.versions, population);
  return countries && versions ? { reach, countries, versions } : null;
}
