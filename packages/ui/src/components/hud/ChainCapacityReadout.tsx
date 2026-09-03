import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  assetEcosystemVisualState,
  deriveAssetEcosystemBuckets,
} from '../../derives/assetEcosystem.derive';
import { formatCkb, formatExactCkb } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { ReadoutHeader, StatRow } from './primitives';
import { chainLiveRow } from './cellPopulation.presentation';

const CATEGORY_LABELS: Record<string, string> = {
  dao: 'DAO',
  tokens: 'TOKENS',
  objects: 'OBJECTS',
  other: 'OTHER',
};

function formatCkbAmount(shannons: string): string {
  try {
    return formatCkb(BigInt(shannons));
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

/** The measure both 字节元 rows reserve for their figure, so the two companions
 *  standing in front of those figures land on one x.
 *
 *  MEASURED, not guessed: `57.95 G·CKB` renders 75.9px and `152.8 MB` 55.2px in
 *  the mono voice at `HUD_TYPE.value`, live in the browser — jsdom has no font
 *  and answers zero for both. 84 covers the widest either row can print:
 *  capacity tops out around `99.99 G·CKB` on a chain whose whole supply is tens
 *  of billions of CKB, and knowledge at `999.9 MB`; both are 12 characters or
 *  fewer at the ~6.9px the mono voice advances per character.
 *
 *  It is a floor rather than a cap (see `StatRow`), so the day a figure does
 *  outgrow it that row's companion steps left and the number still reads. */
const CKB_ROW_VALUE_W = 84;

function shareLabel(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace(/0$/, '')}%`;
}

/**
 * Everything true of the whole chain, and nothing true of this dashboard's
 * local slice — that slice is the STAGE CAPACITY panel's whole subject.
 *
 * Two independent measurements meet here: the indexed asset-ecosystem record
 * and the validated Cell census. Each is exact at its own anchor. The section
 * header states the record's anchor once for every record row; the census row
 * carries its own anchor whenever it differs, because a count must never
 * inherit an anchor that is not its own. Either measurement can be missing;
 * the section renders when at least one exists, and renders nothing sooner
 * than a number it cannot prove.
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
  // The same accent its two siblings wear, and for the same reason they wear
  // it: CHAIN CAPACITY, TX HORIZON and ACTIVITY are three stacked sections of
  // one panel about the chain, and not one of them is reporting health. This
  // one opened in `nominal` — so of three identical headers, the top one had a
  // green lamp beside it and the two under it did not, which reads as a
  // verdict about the section rather than as the section's own colour.
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;
  const headerAnchor = usableRecord?.as_of ?? census!.as_of;
  const liveCells = chainLiveRow(census, censusStale, headerAnchor.block);

  return (
    <section
      aria-label="Chain capacity"
      data-chain-capacity
      data-asset-ecosystem-state={visualState ?? undefined}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
      }}
    >
      <ReadoutHeader
        title="CHAIN CAPACITY"
        meta={`AS OF #${headerAnchor.block.toLocaleString('en-US')}`}
        accent={accent}
        stale={stale}
      />
      {usableRecord ? (
        <div data-indexed-context data-chain-byte-rows style={{ opacity: stale ? 0.68 : 1 }}>
          {/* ⭐ TWO ROWS, ONE UNIT, AND THAT IS WHY THE COMPANION IS SHARED.
            * These are the chain's state budget read from both ends: capacity
            * is the bytes the chain has SOLD, knowledge is the bytes actually
            * STANDING in them. At one byte per CKB they are the same quantity
            * in two notations, so 字节元 is not a decoration on each row — it
            * is the one thing both rows are counted in, said once per row and
            * lined up so the pair reads as a column rather than as two labels
            * that happen to end in Chinese.
            *
            * ⚠️ Which is what `CKB_ROW_VALUE_W` is for. The companion stands
            * in FRONT OF THE FIGURE, because that is what it is the unit of —
            * beside the label it read as a second label and sat a third of the
            * row away from the number. The figures are right-aligned and of
            * different lengths, so the column is pinned by reserving one
            * measure for the value on both rows; if a third row joins them it
            * reserves it too. */}
          <StatRow label="Live capacity" cjk="字节元" valueWidth={CKB_ROW_VALUE_W}>
            <span title={`${formatExactCkb(usableRecord.total_live_capacity_shannons)} · 1 CKB = 1 CKByte of state`}>
              {formatCkbAmount(usableRecord.total_live_capacity_shannons)}
            </span>
          </StatRow>
          <StatRow label="Knowledge" cjk="字节元" valueWidth={CKB_ROW_VALUE_W}>
            <span title="Bytes standing in the capacity above · 1 CKB = 1 CKByte of state">
              {formatBytes(usableRecord.total_knowledge_bytes)}
            </span>
          </StatRow>
        </div>
      ) : null}
      <div
        data-population-row="Chain live"
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 17, whiteSpace: 'nowrap', opacity: liveCells.dim ? 0.6 : 1 }}
      >
        <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: HUD_TYPE.tech, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
          Live cells
        </span>
        {liveCells.tag ? (
          <span
            data-population-scope
            style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, textTransform: 'uppercase', opacity: 0.8 }}
          >
            {liveCells.tag}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.value, color: HUD_COLORS.ink }}>
          {liveCells.value}
        </span>
      </div>
      {usableRecord && buckets && buckets.length > 0 ? (
        <div data-indexed-context style={{ marginTop: 6, opacity: stale ? 0.68 : 1 }}>
          <div
            title={buckets.map((bucket) => `${bucket.category} ${shareLabel(bucket.shareBps)}`).join(' · ')}
            style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(accent, 0.14)}` }}
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
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.45 }}>
            {buckets
              .filter((bucket) => bucket.shareBps > 0)
              .map((bucket) => `${CATEGORY_LABELS[bucket.category.toLowerCase()] ?? bucket.category.toUpperCase()} ${shareLabel(bucket.shareBps)}`)
              .join(' · ')}
          </div>
        </div>
      ) : null}
      {usableRecord && usableRecord.top_assets.length > 0 ? (
        <div data-indexed-context style={{ marginTop: 6, opacity: stale ? 0.68 : 1 }}>
          <div style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
            TOP ASSETS
          </div>
          {usableRecord.top_assets.slice(0, 3).map((asset) => (
            <div
              key={asset.type_script_hash}
              title={asset.type_script_hash}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, padding: '1px 0' }}
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
    </section>
  );
}
