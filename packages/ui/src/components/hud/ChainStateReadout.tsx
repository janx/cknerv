import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import { assetEcosystemVisualState } from '../../derives/assetEcosystem.derive';
import { CLASS_MIX_COLORS, formatCkb, formatExactCkb } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba, COMPANION_OPACITY, STALE_OPACITY } from './hudTheme';
import { ReadoutHeader, StatRow } from './primitives';
import {
  chainClassShares,
  chainLiveRow,
  formatPopulationCount,
} from './cellPopulation.presentation';

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

/**
 * Everything true of the whole chain, and nothing true of this dashboard's
 * local slice — that slice is the STAGE CAPACITY panel's whole subject.
 *
 * It is a section of several readings, not one: the capacity the chain has
 * sold, the knowledge standing in it, the validated live-Cell census, that
 * census's class mix, and the biggest tenants. It was titled CHAIN CAPACITY
 * after the first of them, and the title made the bar under the census read
 * as a split of the count above it, when it was a split of the capacity two
 * rows up — DAO 14%, TOKENS 0.08%, OBJECTS 0.03%, OTHER 85%. True of the CKB
 * and silent about the Cells: a token Cell holds close to the least a Cell
 * can hold and a balance Cell holds some three hundred times that, so by
 * capacity a hundred and forty thousand token and object Cells weighed a
 * tenth of a percent. The section is CHAIN STATE now, and the bar splits the
 * census's COUNT — DAO, TYPED, PLAIN — under the same law as STAGE·07's
 * chain-mix row, so the one number never prints two ways.
 *
 * Two independent measurements meet here: the indexed asset-ecosystem record
 * and the validated Cell census. Each is exact at its own anchor. The section
 * header states the record's anchor once for every record row; the census row
 * carries its own anchor whenever it differs, because a count must never
 * inherit an anchor that is not its own — and the bar, being the census's own
 * partition, stands and dims with the census rather than with the index.
 * Either measurement can be missing; the section renders when at least one
 * exists, and renders nothing sooner than a number it cannot prove.
 */
export default function ChainStateReadout({ source, record, census = null, censusStale = false, folded = false }: {
  source?: EnrichmentSourceStatus;
  record?: AssetEcosystemRecord | null;
  census?: ChainCensus | null;
  censusStale?: boolean;
  /** The rail has collapsed (`RAILS_COLLAPSE_MAX_WIDTH_PX`): the section is
   *  its own header and the
   *  count in it, nothing more. Distinct from `compact`, which is the SHORT
   *  viewport's answer and keeps whatever the section can still afford —
   *  a narrow stage and a short one are two different shortages, and a panel
   *  that answered both with the same form would be guessing at one of them. */
  folded?: boolean;
}) {
  const visualState = source && record ? assetEcosystemVisualState(source, record) : null;
  const usableRecord = visualState ? record! : null;
  if (!usableRecord && !census) return null;

  const stale = visualState === 'stale';
  // The same accent its two siblings wear, and for the same reason they wear
  // it: CHAIN STATE, TX HORIZON and ACTIVITY are three stacked sections of
  // one panel about the chain, and not one of them is reporting health. This
  // one opened in `nominal` — so of three identical headers, the top one had a
  // green lamp beside it and the two under it did not, which reads as a
  // verdict about the section rather than as the section's own colour.
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;
  const headerAnchor = usableRecord?.as_of ?? census!.as_of;
  const liveCells = chainLiveRow(census, censusStale, headerAnchor.block);
  // The census's own partition, in the hues the stage-versus-chain rows wear
  // for the same three classes. Empty when the census carries no proven
  // partition: the bar is then absent, never a guess under the census's anchor.
  const classes = chainClassShares(census)
    .map((cls) => ({ ...cls, color: CLASS_MIX_COLORS[cls.key] }));
  const classTotal = classes.reduce((sum, cls) => sum + cls.count, 0);

  if (folded) {
    // Header and the one count the section is read for. `LIVE n` rather than
    // the capacity/knowledge pair: a collapsed rail keeps the reading a reader
    // came to the panel for, and the census is the only figure here that is
    // not derivable from another section's.
    return (
      <section
        aria-label="Chain state"
        data-chain-state
        data-chain-state-folded="true"
        data-asset-ecosystem-state={visualState ?? undefined}
        style={{
          marginTop: 6,
          paddingTop: 5,
          borderTop: `1px solid ${rgba(accent, 0.16)}`,
        }}
      >
        <ReadoutHeader
          title="CHAIN STATE"
          meta={`${liveCells.value} LIVE · AS OF #${headerAnchor.block.toLocaleString('en-US')}`}
          accent={accent}
          stale={stale}
          compact
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Chain state"
      data-chain-state
      data-asset-ecosystem-state={visualState ?? undefined}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
      }}
    >
      <ReadoutHeader
        title="CHAIN STATE"
        meta={`AS OF #${headerAnchor.block.toLocaleString('en-US')}`}
        accent={accent}
        stale={stale}
      />
      {usableRecord ? (
        <div data-indexed-context style={{ opacity: stale ? STALE_OPACITY : 1 }}>
          {/* Both rows count in CKBytes — capacity is the bytes the chain has
            * SOLD and knowledge the bytes standing in them — and both say so
            * on hover rather than in the row. The unit carried its Chinese
            * name here for a while and it is the dossier's `CKBYTE` zone that
            * keeps that job: a rail row is read for its NUMBER, and a word
            * between the label and the figure is one more thing to read past
            * on every glance. */}
          <StatRow label="Live capacity">
            <span title={`${formatExactCkb(usableRecord.total_live_capacity_shannons)} · 1 CKB = 1 CKByte of state`}>
              {formatCkbAmount(usableRecord.total_live_capacity_shannons)}
            </span>
          </StatRow>
          <StatRow label="Knowledge">
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
            style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, textTransform: 'uppercase', opacity: COMPANION_OPACITY }}
          >
            {liveCells.tag}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.value, color: HUD_COLORS.ink }}>
          {liveCells.value}
        </span>
      </div>
      {classes.length > 0 ? (
        <div
          data-chain-class-mix
          // The census's partition, directly under the count it partitions,
          // and dimmed with that row rather than with the indexed rows above:
          // it is the census's own reading and shares the census's anchor and
          // staleness. Exact counts on hover, the way every value on this rail
          // keeps its figure on its tooltip; the legend carries the shares.
          title={`${classes.map((cls) => `${cls.label} ${formatPopulationCount(cls.count)}`).join(' · ')} · OF ${formatPopulationCount(classTotal)} LIVE CELLS`}
          style={{ marginTop: 6, opacity: liveCells.dim ? 0.6 : 1 }}
        >
          <div style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(accent, 0.14)}` }}>
            {classes.map((cls) => cls.count > 0 ? (
              <span
                key={cls.key}
                data-chain-class={cls.key}
                style={{
                  width: `${(cls.count / classTotal) * 100}%`,
                  // ⚠️ A BAR MAY NOT OMIT WHAT ITS LEGEND NAMES. The capacity
                  // bar this replaced printed `TOKENS 0.08% · OBJECTS 0.03%`
                  // and drew them 0.27 px and 0.10 px wide — invisible — so a
                  // reader checking the legend against the bar found two of
                  // its four names missing (report A, A-9). By count no class
                  // is that thin today, and the floor stays for the day one
                  // is: one pixel, the same floor STAGE·07's mix bar keeps.
                  minWidth: 1,
                  background: cls.color,
                  boxShadow: `0 0 5px ${rgba(cls.color, 0.28)}`,
                }}
              />
            ) : null)}
          </div>
          {/* Qualitative: three unrelated hues, so the hue IS the mapping and
              the legend's NAME carries it. The share stays in the caption
              tier — a caption beside a key. */}
          <div
            data-class-legend="qualitative"
            style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.45 }}
          >
            {classes
              .filter((cls) => cls.count > 0)
              .map((cls, index) => (
                <span key={cls.key}>
                  {index > 0 ? ' · ' : null}
                  <span data-class-legend-name style={{ color: cls.color }}>
                    {cls.label}
                  </span>
                  {` ${cls.text}`}
                </span>
              ))}
          </div>
        </div>
      ) : null}
      {usableRecord && usableRecord.top_assets.length > 0 ? (
        <div data-indexed-context style={{ marginTop: 6, opacity: stale ? STALE_OPACITY : 1 }}>
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
