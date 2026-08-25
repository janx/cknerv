import {
  PEER_PROBE_HANDSHAKE_AXIS,
  type EnrichmentSourceStatus,
  type NetworkAtlasBucket,
  type NetworkAtlasRecord,
  type PeerHandshakeAxisRung,
} from '@cknerv/types';
import { ORDINAL_DEPTH_RAMP, QUALITATIVE_BUCKET_COLORS } from '../components/hud/hudTheme';

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

export interface NetworkAtlasHandshakeRung {
  /** Narrowed to the axis's own six. The wire's `result` is the whole
   *  `PeerProbeResult` union because a wire may carry anything; by the time a
   *  rung is here it has been checked against the axis, so a surface that names
   *  the rungs is exhaustive over six rather than carrying a seventh row
   *  nothing can reach. */
  result: PeerHandshakeAxisRung;
  attempts: number;
  color: string;
}

export interface NetworkAtlasVisual {
  /** The round's address dials, along the handshake axis. Ordered by the axis
   *  and NEVER by size — unlike the three histograms beside it, whose order is
   *  a rendering choice. */
  handshake: NetworkAtlasHandshakeRung[];
  countries: NetworkAtlasBucketVisual[];
  versions: NetworkAtlasBucketVisual[];
  asns: NetworkAtlasBucketVisual[];
}

// A country, a client version and an autonomous system are qualitative
// buckets: `DE` is not a lock family, `v0.201.0` is not an asset class, and
// each is handed its colour by a hash of its own label. That is the house's
// `QUALITATIVE_BUCKET_COLORS` ramp exactly — the argument for why these bars
// may not read `CONTENT_BANDS`, and why the green sector stays shut, is
// written where the ramp lives. The STAGE script-family bar hands out the same
// slots for the same reason.
function labelColor(label: string): string {
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return QUALITATIVE_BUCKET_COLORS[hash % QUALITATIVE_BUCKET_COLORS.length];
}

// A rung's colour is its POSITION on the axis, and nothing else — which is why
// it is an index into the ramp rather than a lookup keyed by the result. The
// three bars above hash a label into `QUALITATIVE_BUCKET_COLORS` because a
// country has no order; this one has nothing but order, so it takes the ramp
// that steps in brightness. See `ORDINAL_DEPTH_RAMP` for why one hue at six
// alphas rather than six hues.
function rungColor(rung: number): string {
  return ORDINAL_DEPTH_RAMP[rung];
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

/** The round's address dials, checked against the dials the round says it made.
 *
 *  `deriveBuckets`'s sibling, and every difference between them is a difference
 *  in what the two histograms are. The adapter refuses a record that fails any
 *  of this; it is asked again here for the same reason the three census strips
 *  are, which is that this side draws the bar and a bar of the wrong widths is
 *  worse than no bar.
 *
 *  Four rules, and the last three are the opposite of that function's:
 *
 *  - The population is `address_attempts`, not a peer count. A peer is dialed
 *    once per address anybody advertised for it, so this partitions a
 *    several-times-larger set and would refuse instantly against
 *    `candidate_peers` or `indexed_peers`.
 *  - A zero rung is KEPT. `deriveBuckets` refuses a zero-count bucket because
 *    upstream's label histograms never emit one — a country with no peers in it
 *    is a country nobody named. This histogram always emits all six counters,
 *    and "no dial ended with an unreadable identify" is a result.
 *  - Nothing is sorted. The order IS the reading.
 *  - The rungs must be the whole axis, in the axis's order. That single check
 *    does four jobs: it rejects a missing rung, a duplicated one, a reordered
 *    one, and `unknown` — which is cknerv's word for an observation it could
 *    not read on one peer and can never be a bucket of a round's histogram. */
function deriveHandshake(record: NetworkAtlasRecord): NetworkAtlasHandshakeRung[] | null {
  const rungs = record.handshake_depth;
  if (rungs.length !== PEER_PROBE_HANDSHAKE_AXIS.length) return null;
  let total = 0;
  const visual: NetworkAtlasHandshakeRung[] = [];
  // Walked over the AXIS rather than over the record, so the rung that comes
  // out is the axis's own literal and the narrowing above is earned rather than
  // asserted.
  for (const [index, expected] of PEER_PROBE_HANDSHAKE_AXIS.entries()) {
    const rung = rungs[index];
    if (rung.result !== expected) return null;
    if (!safeNonnegativeInteger(rung.attempts)) return null;
    total += rung.attempts;
    if (total > record.address_attempts) return null;
    visual.push({ result: expected, attempts: rung.attempts, color: rungColor(index) });
  }
  if (total !== record.address_attempts) return null;
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

/** Validate the round's ladder and the census under it, then derive the three
 *  visual fingerprints.
 *
 *  Both halves have to hold for either to render. The panel prints them as one
 *  block of numbers about one network, so a ladder whose rungs contradict each
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
    record.address_attempts,
    record.indexed_peers,
  ];
  if (!summaryCounts.every(safeNonnegativeInteger)) return null;
  // The round's arithmetic, which is exact rather than merely bounded.
  // Upstream reads every one of these counts off ONE disjoint outcome matrix,
  // so they are not separate measurements that happen to agree.
  //
  // A completed candidate ends in exactly one of three ways: it answered on
  // this network, it answered on another one, or the round ran out of
  // addresses to try. Those three ARE the candidates, which is what lets the
  // ladder print them under the number they belong to.
  if (record.last_round_reachable + record.exhausted_candidates + record.foreign_peers
    !== record.candidate_peers) return null;
  // And the cross-cut. A peer the crawler still holds a verification for was
  // either reached this round or it was not, with no third case — so this is
  // an equality too, and it is why the panel may print the unavailable count
  // beside the reachable one without implying they are parts of the
  // candidates. `verified_unavailable_peers` is drawn from the exhausted and
  // foreign cohorts and would double-count against them.
  if (record.last_round_reachable + record.verified_unavailable_peers
    !== record.verified_retained_peers) return null;
  if (record.new_verified_peers > record.verified_retained_peers) return null;

  // Deliberately NOT checked against `verified_retained_peers`. They mean the
  // same words on two clocks — a scan of the crawler's node store as this
  // request arrived, against what the last round's matrix added up to when it
  // finished — and an equality between them would be an invariant that fails
  // on a healthy source the first time a round lands between the two reads.
  const population = record.indexed_peers;

  const countries = deriveBuckets(record.countries, population);
  const versions = deriveBuckets(record.versions, population);
  const asns = deriveBuckets(record.asns, population);
  // The round's own histogram, on the round's own population. It is validated
  // here beside the census rather than after it because the panel prints all of
  // it as one block of numbers about one network: a record whose parts
  // contradict each other is not a reason to draw the parts that happen to
  // close.
  const handshake = deriveHandshake(record);
  return countries && versions && asns && handshake
    ? { handshake, countries, versions, asns }
    : null;
}
