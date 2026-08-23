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

const COUNTRY_COLORS = ['#69e7ff', '#78f2b3', '#d8b4ff', '#7da7ff', '#ff78c6'];
const VERSION_COLORS = ['#ff9d52', '#ffd36b', '#69e7ff', '#78f2b3', '#d8b4ff'];

function labelColor(label: string, palette: readonly string[]): string {
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function deriveBuckets(
  buckets: NetworkAtlasBucket[],
  sampleSize: number,
  palette: readonly string[],
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
    visual.push({ ...bucket, label, color: labelColor(label, palette) });
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

  const countries = deriveBuckets(record.countries, record.sample_size, COUNTRY_COLORS);
  const versions = deriveBuckets(record.versions, record.sample_size, VERSION_COLORS);
  return countries && versions ? { countries, versions } : null;
}
