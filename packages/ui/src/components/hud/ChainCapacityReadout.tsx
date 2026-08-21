import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  assetEcosystemVisualState,
  deriveAssetEcosystemBuckets,
} from '../../derives/assetEcosystem.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { ScopeStage, StatRow } from './primitives';
import { chainLiveRow } from './cellPopulation.presentation';

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

/**
 * Everything true of the whole chain, and nothing true of this dashboard's
 * local slice — the stage block is the other stage on this rail.
 *
 * Two independent measurements meet here: the indexed asset-ecosystem record
 * and the validated Cell census. Each is exact at its own anchor. The block
 * header states the record's anchor once for every record row; the census row
 * carries its own anchor whenever it differs, because a count must never
 * inherit an anchor that is not its own. Either measurement can be missing;
 * the block renders when at least one exists, and renders nothing sooner than
 * a number it cannot prove.
 */
export default function ChainCapacityReadout({ source, record, census = null, censusStale = false }: {
  source?: EnrichmentSourceStatus;
  record?: AssetEcosystemRecord | null;
  census?: ChainCensus | null;
  censusStale?: boolean;
}) {
  const visualState = source && record ? assetEcosystemVisualState(source, record) : null;
  const buckets = visualState ? deriveAssetEcosystemBuckets(record!) : null;
  const usableRecord = visualState && buckets ? record! : null;
  if (!usableRecord && !census) return null;

  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.nominal;
  const headerAnchor = usableRecord?.as_of ?? census!.as_of;
  const liveCells = chainLiveRow(census, censusStale, headerAnchor.block);

  return (
    <ScopeStage
      id="chain-capacity"
      label="CHAIN CAPACITY"
      meta={`AS OF #${headerAnchor.block.toLocaleString('en-US')}${stale ? ' · STALE' : ''}`}
      accent={accent}
      flush
    >
      <div aria-label="Chain capacity" data-chain-capacity data-asset-ecosystem-state={visualState ?? undefined}>
        {usableRecord ? (
          <div data-indexed-context style={{ opacity: stale ? 0.68 : 1 }}>
            <StatRow label="Live capacity">{formatCapacity(usableRecord.total_live_capacity_shannons)}</StatRow>
            <StatRow label="Knowledge">{formatBytes(usableRecord.total_knowledge_bytes)}</StatRow>
          </div>
        ) : null}
        <div
          data-population-row="Chain live"
          style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 17, whiteSpace: 'nowrap', opacity: liveCells.dim ? 0.6 : 1 }}
        >
          <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8.5, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
            Live cells
          </span>
          {liveCells.tag ? (
            <span
              data-population-scope
              style={{ fontFamily: HUD_FONTS.tech, fontSize: 7, letterSpacing: 1.1, color: HUD_COLORS.dim, textTransform: 'uppercase', opacity: 0.8 }}
            >
              {liveCells.tag}
            </span>
          ) : null}
          <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 11, color: HUD_COLORS.ink }}>
            {liveCells.value}
          </span>
        </div>
        {usableRecord && buckets && buckets.length > 0 ? (
          <div data-indexed-context style={{ marginTop: 6, opacity: stale ? 0.68 : 1 }}>
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
        {usableRecord && usableRecord.top_assets.length > 0 ? (
          <div data-indexed-context style={{ marginTop: 6, opacity: stale ? 0.68 : 1 }}>
            <div style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
              TOP ASSETS
            </div>
            {usableRecord.top_assets.slice(0, 3).map((asset) => (
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
      </div>
    </ScopeStage>
  );
}
