import type {
  EnrichmentSourceStatus,
  NetworkAtlasBucket,
  NetworkAtlasRecord,
} from '@cknerv/types';

export type NetworkAtlasVisualState = 'ready' | 'stale';

export const NETWORK_ATLAS_STALE_AFTER_MS = 180_000;
export const NETWORK_ATLAS_MAX_SAMPLE = 64;

export interface NetworkAtlasBucketVisual extends NetworkAtlasBucket {
  color: string;
}

export interface NetworkAtlasVisual {
  countries: NetworkAtlasBucketVisual[];
  versions: NetworkAtlasBucketVisual[];
}

// The atlas's two bars are the one place in the HUD where a colour means
// NOTHING. A country and a client version are qualitative buckets handed a
// slot by a hash of their own label — `DE` is not a lock family, `v0.201.0`
// is not an asset class — so mapping them onto the content bands would be a
// lie in the other direction from the one this ramp replaces: it would tell a
// reader that a country belongs to a family of things it has nothing to do
// with. What the buckets owe is only that they can be told apart, and that
// none of them impersonates a layer that does mean something.
//
// So: five hues of its own, checked against every reserved tone, every content
// band and every text tier rather than borrowed from any of them. Closest pair
// inside the ramp is 118.9, and the nearest any member comes to anything
// outside it is 47.2 — both clear of the separation floor.
//
// The green sector is excluded on purpose and that is the load-bearing part of
// this comment. Green is spoken for by `nominal`, and a country must never
// read as health: a bar where Germany is green and Singapore is amber is a bar
// that appears to be grading nations.
//
// One ramp for both bars, not two. They used to be two arrays that shared
// three of their five values anyway, and the first slot of the version ramp
// was `#ff9d52` — 34.4 from chrome orange, the same near-frame colour the byte
// orbit and the activity feed had each arrived at separately.
export const ATLAS_BUCKET_COLORS: readonly string[] = [
  '#465EB8',
  '#D0B846',
  '#CA94D0',
  '#B24670',
  '#5ED0D0',
];

function labelColor(label: string): string {
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return ATLAS_BUCKET_COLORS[hash % ATLAS_BUCKET_COLORS.length];
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function deriveBuckets(
  buckets: NetworkAtlasBucket[],
  sampleSize: number,
): NetworkAtlasBucketVisual[] | null {
  if (buckets.length > NETWORK_ATLAS_MAX_SAMPLE) return null;
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
    if (total > sampleSize) return null;
    seen.add(label);
    visual.push({ ...bucket, label, color: labelColor(label) });
  }
  if (total !== sampleSize) return null;
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

/** Validate the fixed-size sample before deriving its two visual fingerprints. */
export function deriveNetworkAtlasVisual(
  record: NetworkAtlasRecord,
): NetworkAtlasVisual | null {
  const summaryCounts = [
    record.crawl_round,
    record.crawl_finished_at_s,
    record.total_known,
    record.last_round_attempted,
    record.last_round_reachable,
    record.new_nodes,
    record.sample_size,
    record.sample_reachable,
  ];
  if (!summaryCounts.every(safeNonnegativeInteger)) return null;
  if (typeof record.sample_truncated !== 'boolean') return null;
  if (record.last_round_reachable > record.last_round_attempted
    || record.new_nodes > record.total_known
    || record.sample_size > NETWORK_ATLAS_MAX_SAMPLE
    || record.sample_size > record.total_known
    || record.sample_reachable > record.sample_size) return null;
  if (record.median_rtt_ms !== undefined
    && (!safeNonnegativeInteger(record.median_rtt_ms)
      || record.median_rtt_ms > 0xffff_ffff)) return null;

  const countries = deriveBuckets(record.countries, record.sample_size);
  const versions = deriveBuckets(record.versions, record.sample_size);
  return countries && versions ? { countries, versions } : null;
}
