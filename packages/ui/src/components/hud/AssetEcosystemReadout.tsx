import type { ReactNode } from 'react';
import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  assetEcosystemVisualState,
  deriveAssetEcosystemBuckets,
} from '../../derives/assetEcosystem.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { ScopeStage, StatRow } from './primitives';

const CATEGORY_LABELS: Record<string, string> = {
  dao: 'DAO',
  tokens: 'TOKENS',
  objects: 'OBJECTS',
  other: 'OTHER',
};

function formatCapacity(shannons: string): string {
  try {
    const amount = BigInt(shannons);
    const whole = amount / 100_000_000n;
    const hundredths = (amount % 100_000_000n) / 1_000_000n;
    return `${whole.toLocaleString('en-US')}${
      hundredths === 0n ? '' : `.${hundredths.toString().padStart(2, '0')}`
    } CKB`;
  } catch {
    return `${shannons} sh`;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function shareLabel(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace(/0$/, '')}%`;
}

export default function AssetEcosystemReadout({ source, record, fallback = null, retainedContext = null }: {
  source?: EnrichmentSourceStatus;
  record?: AssetEcosystemRecord | null;
  /** Base CKB-only capacity view used until a valid indexed record exists. */
  fallback?: ReactNode;
  /** The complete direct-node Galaxy window, nested below indexed chain scope. */
  retainedContext?: ReactNode;
}) {
  if (!source || !record) return fallback;
  const visualState = assetEcosystemVisualState(source, record);
  const buckets = deriveAssetEcosystemBuckets(record);
  if (!visualState || !buckets) return fallback;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.nominal;

  return (
    <section
      aria-label="Asset ecosystem"
      data-cell-capacity-mode="indexed"
      data-asset-ecosystem-state={visualState}
      style={{
        marginTop: 11,
        paddingTop: 9,
        borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.13)}`,
      }}
    >
      <ScopeStage
        id="indexed-chain"
        label="CHAIN CAPACITY"
        meta={`AS OF #${record.as_of.block.toLocaleString('en-US')}${stale ? ' · STALE' : ''}`}
        accent={accent}
        terminal={retainedContext == null}
        style={{ opacity: stale ? 0.68 : 1 }}
      >
        <StatRow label="Live capacity">{formatCapacity(record.total_live_capacity_shannons)}</StatRow>
        <StatRow label="Knowledge">{formatBytes(record.total_knowledge_bytes)}</StatRow>
        {buckets.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div
              title={buckets.map((bucket) => `${bucket.category} ${shareLabel(bucket.shareBps)}`).join(' · ')}
              style={{ display: 'flex', height: 6, background: '#0a0a0a', border: `1px solid ${rgba(accent, 0.14)}` }}
            >
              {buckets.map((bucket) => bucket.shareBps > 0 ? (
                <span
                  key={bucket.category}
                  data-asset-capacity-category={bucket.category}
                  style={{
                    width: `${bucket.shareBps / 100}%`,
                    background: bucket.color,
                    boxShadow: `0 0 5px ${rgba(bucket.color, 0.28)}`,
                  }}
                />
              ) : null)}
            </div>
            <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, color: '#9fb0bd', marginTop: 3, lineHeight: 1.45 }}>
              {buckets
                .filter((bucket) => bucket.shareBps > 0)
                .map((bucket) => `${CATEGORY_LABELS[bucket.category.toLowerCase()] ?? bucket.category.toUpperCase()} ${shareLabel(bucket.shareBps)}`)
                .join(' · ')}
            </div>
          </div>
        ) : null}
        {record.top_assets.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
              TOP ASSETS
            </div>
            {record.top_assets.slice(0, 3).map((asset) => (
              <div
                key={asset.type_script_hash}
                title={asset.type_script_hash}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontFamily: HUD_FONTS.mono, fontSize: 8, padding: '1px 0' }}
              >
                <span style={{ color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.symbol ?? asset.name ?? `${asset.type_script_hash.slice(0, 10)}…`}
                </span>
                <span style={{ color: HUD_COLORS.dim }}>
                  {Number.isSafeInteger(asset.holders_count)
                    ? `${asset.holders_count.toLocaleString('en-US')} HOLDERS`
                    : 'HOLDERS ?'}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </ScopeStage>
      {retainedContext}
    </section>
  );
}
