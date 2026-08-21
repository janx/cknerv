import type {
  EnrichmentSourceStatus,
  NetworkAtlasBucket,
  NetworkAtlasRecord,
} from '@cknerv/types';
import {
  deriveNetworkAtlasVisual,
  networkAtlasVisualState,
} from '../../derives/networkAtlas.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { ScopeStage, StatRow } from './primitives';

const fmt = (value: number) => value.toLocaleString('en-US');

function legend(buckets: NetworkAtlasBucket[]): string {
  const visible = buckets.slice(0, 4).map((bucket) => `${bucket.label} ${bucket.count}`);
  if (buckets.length > 4) visible.push(`+${buckets.length - 4} groups`);
  return visible.join(' · ');
}

function BucketStrip({ label, buckets, total }: {
  label: string;
  buckets: Array<NetworkAtlasBucket & { color: string }>;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
        {label}
      </div>
      <div
        title={buckets.map((bucket) => `${bucket.label} ${bucket.count}`).join(' · ')}
        style={{ display: 'flex', height: 6, background: '#0a0a0a', border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.14)}` }}
      >
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
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, color: '#9fb0bd', marginTop: 3, lineHeight: 1.45 }}>
        {legend(buckets)}
      </div>
    </div>
  );
}

// Strictly additive: with no usable crawler record the panel's own measured
// rows are the whole story, so absence renders nothing rather than a substitute
// readout. Crawler run telemetry (dial counts, frontier state, new nodes) is
// ckbadger's own operational view, not the pilot's — what survives here is the
// shape of the network the crawl saw.
export default function NetworkAtlasReadout({ source, record }: {
  source?: EnrichmentSourceStatus;
  record?: NetworkAtlasRecord | null;
}) {
  if (!source || !record) return null;
  const visualState = networkAtlasVisualState(source, record);
  const visual = deriveNetworkAtlasVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.peerWire;

  return (
    <section
      aria-label="Network atlas"
      data-network-detail-mode="indexed"
      data-network-atlas-state={visualState}
      style={{
        marginTop: 11,
        paddingTop: 9,
        borderTop: `1px solid ${rgba(HUD_COLORS.peerWire, 0.14)}`,
      }}
    >
      <ScopeStage
        id="indexed-atlas"
        label="NETWORK ATLAS"
        meta={`ROUND ${fmt(record.crawl_round)} · AS OF #${fmt(record.as_of.block)}${stale ? ' · STALE' : ''}`}
        accent={accent}
        terminal
        style={{ opacity: stale ? 0.68 : 1 }}
      >
        <StatRow label="Known nodes">{fmt(record.total_known)}</StatRow>
        <StatRow label="Median RTT">{record.median_rtt_ms == null ? '—' : `${fmt(record.median_rtt_ms)}ms`}</StatRow>
        <BucketStrip
          label={`SAMPLE COUNTRIES · ${fmt(record.sample_size)} NODES${record.sample_truncated ? ' · BOUNDED' : ''}`}
          buckets={visual.countries}
          total={record.sample_size}
        />
        <BucketStrip label="SAMPLE CLIENT VERSIONS" buckets={visual.versions} total={record.sample_size} />
      </ScopeStage>
    </section>
  );
}
