import type { ReactNode } from 'react';
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

export default function NetworkAtlasReadout({ source, record, fallback = null, localContext = null }: {
  source?: EnrichmentSourceStatus;
  record?: NetworkAtlasRecord | null;
  /** Direct-node detail shown until a valid indexed atlas record exists. */
  fallback?: ReactNode;
  /** Complete local diagnostics shown as the first step of enhanced scope. */
  localContext?: ReactNode;
}) {
  if (!source || !record) return fallback;
  const visualState = networkAtlasVisualState(source, record);
  const visual = deriveNetworkAtlasVisual(record);
  if (!visualState || !visual) return fallback;
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
      {localContext}
      <ScopeStage
        id="indexed-atlas"
        label="NETWORK ATLAS"
        meta={`ROUND ${fmt(record.crawl_round)} · AS OF #${fmt(record.as_of.block)}${stale ? ' · STALE' : ''}`}
        accent={accent}
        terminal
        style={{ opacity: stale ? 0.68 : 1 }}
      >
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 7.5, color: HUD_COLORS.dim, letterSpacing: 0.35, marginBottom: 4 }}>
          LATEST {fmt(record.sample_size)} NODE SAMPLE{record.sample_truncated ? ' · BOUNDED' : ''}
        </div>
        <StatRow label="Known nodes">{fmt(record.total_known)}</StatRow>
        <StatRow label="Last crawl">{fmt(record.last_round_reachable)} reachable / {fmt(record.last_round_dialed)} dialed</StatRow>
        <StatRow label="Latest sample">{fmt(record.sample_reachable)} reachable / {fmt(record.sample_size)} nodes</StatRow>
        <StatRow label="Median RTT">{record.median_rtt_ms == null ? '—' : `${fmt(record.median_rtt_ms)}ms`}</StatRow>
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, color: HUD_COLORS.dim, marginTop: 3 }}>
          +{fmt(record.new_nodes)} NEW · {record.frontier_drained ? 'FRONTIER DRAINED' : 'FRONTIER ACTIVE'}
        </div>
        <BucketStrip label="SAMPLE COUNTRIES" buckets={visual.countries} total={record.sample_size} />
        <BucketStrip label="SAMPLE CLIENT VERSIONS" buckets={visual.versions} total={record.sample_size} />
      </ScopeStage>
    </section>
  );
}
