import type {
  EnrichmentSourceStatus,
  NetworkAtlasBucket,
  NetworkAtlasRecord,
} from '@cknerv/types';
import {
  deriveNetworkAtlasVisual,
  networkAtlasVisualState,
} from '../../derives/networkAtlas.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { StatRow } from './primitives';

const fmt = (value: number) => value.toLocaleString('en-US');

function legend(buckets: NetworkAtlasBucket[]): string {
  const visible = buckets.slice(0, 4).map((bucket) => `${bucket.label} ${bucket.count}`);
  if (buckets.length > 4) visible.push(`+${buckets.length - 4} groups`);
  return visible.join(' · ');
}

function BucketStrip({ label, buckets, total, provenance }: {
  label: string;
  buckets: Array<NetworkAtlasBucket & { color: string }>;
  total: number;
  provenance: string;
}) {
  if (total === 0) return null;
  const detail = buckets.map((bucket) => `${bucket.label} ${bucket.count}`).join(' · ');
  return (
    <div style={{ marginTop: 6 }} title={`${provenance} · ${detail}`}>
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.14)}` }}>
        {buckets.map((bucket) => (
          <span
            key={bucket.label}
            style={{
              width: `${(bucket.count / total) * 100}%`,
              background: bucket.color,
              boxShadow: `0 0 5px ${rgba(bucket.color, 0.25)}`,
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.45 }}>
        {legend(buckets)}
      </div>
    </div>
  );
}

// MESH·02 has one subject, seen from two distances: the rows above are measured
// over our own links, these are indexed by the crawler's last round. Same
// network, so they join the panel flow as ordinary rows — a titled sub-frame
// would only split one subject into two instruments. The provenance every
// indexed number shares waits on hover instead of spending a line, and
// staleness speaks only when it is true.
//
// Strictly additive: with no usable crawler record the panel's own measured
// rows are the whole story, so absence renders nothing rather than a substitute
// readout. Crawler run telemetry (candidates considered, peers verified for the
// first time) is ckbadger's own operational view, not the pilot's — what
// survives here is the shape of the network the crawl saw.
export default function NetworkAtlasReadout({ source, record }: {
  source?: EnrichmentSourceStatus;
  record?: NetworkAtlasRecord | null;
}) {
  if (!source || !record) return null;
  const visualState = networkAtlasVisualState(source, record);
  const visual = deriveNetworkAtlasVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const provenance = `Crawler atlas · round ${fmt(record.crawl_round)} · as of #${fmt(record.as_of.block)}`;

  return (
    <div
      data-network-detail-mode="indexed"
      data-network-atlas-state={visualState}
      style={{ marginTop: 6 }}
    >
      <div data-network-atlas-rows style={{ opacity: stale ? 0.68 : 1 }}>
        {/* The peers the crawler still holds a verification for — the set it
            has actually reached, which is what this row has always counted.
            The number upstream used to answer with was that same set under a
            name that also read as "every peer anyone has named", and it was
            deleted for it. */}
        <StatRow label="Known nodes" title={provenance}>{fmt(record.verified_retained_peers)}</StatRow>
        <StatRow label="Median RTT" title={provenance}>
          {record.median_rtt_ms == null ? '—' : `${fmt(record.median_rtt_ms)}ms`}
        </StatRow>
        <BucketStrip
          label={`SAMPLE COUNTRIES · ${fmt(record.sample_size)} NODES${record.sample_truncated ? ' · BOUNDED' : ''}`}
          buckets={visual.countries}
          total={record.sample_size}
          provenance={provenance}
        />
        <BucketStrip
          label="SAMPLE CLIENT VERSIONS"
          buckets={visual.versions}
          total={record.sample_size}
          provenance={provenance}
        />
      </div>
      {stale ? (
        <div
          data-network-atlas-caution
          style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.35, color: HUD_COLORS.caution, marginTop: 5 }}
        >
          ATLAS STALE · AS OF #{fmt(record.as_of.block)}
        </div>
      ) : null}
    </div>
  );
}
