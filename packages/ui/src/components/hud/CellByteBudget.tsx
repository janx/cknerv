import type { CSSProperties } from 'react';
import type { CommonKnowledgeBreakdown } from '@cknerv/types';
import {
  deriveCellByteBudget,
  formatUtilizationPercent,
  type ByteBudgetSegmentKey,
} from '../../derives/cellByteBudget.derive';
import { CONTENT_BANDS, formatCkb, formatDataSize, formatExactCkb } from './cellFormat';
import { HUD_COLORS, HUD_TYPE, rgba } from './hudTheme';

// Each segment wears the content band of the axis it measures, so the bar
// says the same four words the register above it does: CAP is value, LOCK is
// authorization, TYPE is the token family, DATA is knowledge. It used to wear
// chrome orange, nominal green and caution yellow at once — a four-segment bar
// carrying three reserved layers, which made every cell's byte composition
// look like a status readout with an opinion about the Cell's health.
//
// The LOCK segment takes the authority BAND rather than the cyan the default
// lock borrows: cyan belongs to the DATA segment here, and one bar cannot
// spend the same color twice.
export const SEGMENT_COLORS: Record<ByteBudgetSegmentKey, string> = {
  cap: CONTENT_BANDS.value,
  lock: CONTENT_BANDS.authority,
  type: CONTENT_BANDS.token,
  data: CONTENT_BANDS.consensus,
};

export interface CellByteBudgetProps {
  /** Shannons, exactly as `cell.capacity` carries them. */
  capacityShannons: number | bigint;
  knowledge: CommonKnowledgeBreakdown | null | undefined;
  /** The data hex we hold ends in DATA_HEX_TRUNCATION_MARKER — the byte
   *  counts stay authoritative (enrichment-side), but our observation of the
   *  content is partial and the DATA segment must admit it. */
  dataTruncated?: boolean;
  /** Semantics gate: 0 = still scanning (ghosted like an unrevealed scan
   *  fact), 1 = lit. */
  reveal?: 0 | 1;
  style?: CSSProperties;
}

/** The CKBytes equivalence made visible: 1 CKB of capacity is 1 byte of
 *  state budget. The composition bar decomposes the OCCUPIED bytes
 *  (CAP·LOCK·TYPE·DATA) against themselves so tiny occupancy stays legible;
 *  the ratio strip below tells the rest of the story — how much of the
 *  purchased budget is spent, and how much of it is still FREE. */
export default function CellByteBudget({
  capacityShannons,
  knowledge,
  dataTruncated = false,
  reveal = 1,
  style,
}: CellByteBudgetProps) {
  const model = deriveCellByteBudget(knowledge, capacityShannons);
  if (!model) return null;
  const revealed = reveal >= 1;
  const partialData = (key: ByteBudgetSegmentKey) =>
    dataTruncated && key === 'data';
  return (
    <div
      data-cell-byte-budget="true"
      data-byte-budget-total-bytes={model.totalBytes}
      data-byte-budget-occupied-source={model.occupiedExact ? 'exact' : 'bytes'}
      data-byte-budget-reveal-state={revealed ? 'resolved' : 'scanning'}
      style={{
        minWidth: 0,
        opacity: revealed ? 1 : 0.18,
        transition: 'opacity 260ms ease',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9, whiteSpace: 'nowrap' }}>
          BYTE BUDGET
        </span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          <span
            data-byte-budget-occupied="true"
            style={{ color: HUD_COLORS.ink, fontSize: HUD_TYPE.label }}
          >
            {formatDataSize(model.totalBytes)}
          </span>
          <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9 }}>
            {' OCCUPIED'}
          </span>
        </span>
      </div>
      {/* The composition bar decomposes OCCUPIED against itself, so a Cell
        * using 4% of its budget still draws a full-width bar — at 9px of
        * saturated, glowing colour that made it the loudest object on a card
        * whose actual headline is the fact above it. Thin and quiet: it is
        * evidence for CAPACITY, and the reading that answers "how full" is
        * the utilisation strip below, which now carries the weight. */}
      <div
        data-byte-budget-composition="true"
        title={model.segments
          .map((segment) => `${segment.label} ${segment.bytes}B`)
          .join(' · ')}
        style={{ display: 'flex', height: 5, gap: 1, marginTop: 3 }}
      >
        {model.segments.map((segment) => {
          const color = SEGMENT_COLORS[segment.key];
          const partial = partialData(segment.key);
          return (
            <span
              key={segment.key}
              data-byte-budget-segment={segment.key}
              data-byte-budget-segment-bytes={segment.bytes}
              data-byte-budget-segment-observed={partial ? 'partial' : undefined}
              style={{
                boxSizing: 'border-box',
                width: `${segment.share * 100}%`,
                minWidth: 2,
                background: rgba(color, 0.62),
                opacity: partial ? 0.6 : 1,
                borderTop: partial ? `1px dashed ${rgba(color, 0.9)}` : undefined,
              }}
            />
          );
        })}
      </div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 9px', marginTop: 3, fontSize: HUD_TYPE.micro, letterSpacing: 0.6, whiteSpace: 'nowrap' }}
      >
        {model.segments.map((segment) => {
          const color = SEGMENT_COLORS[segment.key];
          const partial = partialData(segment.key);
          return (
            <span
              key={segment.key}
              data-byte-budget-legend={segment.key}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <span
                aria-hidden="true"
                style={{ width: 5, height: 5, background: color, boxShadow: `0 0 4px ${rgba(color, 0.45)}`, opacity: partial ? 0.6 : 1 }}
              />
              <span style={{ color }}>{segment.label}</span>
              <span style={{ color: HUD_COLORS.ink }}>{formatDataSize(segment.bytes)}</span>
              {partial ? (
                <span
                  data-byte-budget-legend-observed="partial"
                  title="data window truncated — bytes counted by enrichment, content only partially observed"
                  style={{ color: HUD_COLORS.dim }}
                >
                  OBSERVED
                </span>
              ) : null}
            </span>
          );
        })}
        {/* Occupied capacity the breakdown never itemized — script args, which
          * ckbadger calls Unindexed Script Args. It gets no swatch on purpose:
          * nothing in the bar above corresponds to it, and pretending
          * otherwise would make the composition lie about what it can name. */}
        {model.residualBytes > 0 ? (
          <span
            data-byte-budget-residual="true"
            data-byte-budget-residual-bytes={model.residualBytes}
            title="Unindexed Script Args — occupied capacity beyond the itemized bytes"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span style={{ color: HUD_COLORS.ink }}>
              {`+${formatDataSize(model.residualBytes)}`}
            </span>
            <span style={{ color: HUD_COLORS.dim }}>ARGS</span>
          </span>
        ) : null}
      </div>
      {/* Occupied over capacity, clamped — a 1M-CKB cell holding 102 B shows
        * a hairline of fill here while the composition bar above stays full.
        * This is the reading that answers "how full is it", so it leads the
        * line instead of trailing under it as a 2px afterthought — and the
        * capacity it is a percentage OF is the CAPACITY fact three lines up,
        * which is why this no longer prints the same figure again. It stays
        * on the hover title, exact, where a restatement costs nothing. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, whiteSpace: 'nowrap' }}>
        <span
          data-byte-budget-ratio="true"
          data-byte-budget-capacity-shannons={model.capacityShannons.toString()}
          title={`${formatUtilizationPercent(model.utilization)} of ${formatExactCkb(model.capacityShannons)}`}
          style={{ position: 'relative', display: 'block', flex: '0 1 108px', height: 4, background: rgba(HUD_COLORS.orange, 0.13) }}
        >
          <span
            data-byte-budget-ratio-fill="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${model.utilization * 100}%`,
              minWidth: model.utilization > 0 ? 1 : 0,
              background: HUD_COLORS.orange,
              boxShadow: `0 0 6px ${rgba(HUD_COLORS.orange, 0.55)}`,
            }}
          />
        </span>
        <span
          data-byte-budget-percent="true"
          title={`${formatUtilizationPercent(model.utilization)} of ${formatExactCkb(model.capacityShannons)}`}
          style={{ color: HUD_COLORS.ink, fontSize: HUD_TYPE.label }}
        >
          {formatUtilizationPercent(model.utilization)}
        </span>
        {/* What the Cell bought and nobody is standing on. The bar above
          * measures the spent side; this is the same reading from the other
          * end, and the only one that answers how much more could fit. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9 }}>FREE</span>
          <span
            data-byte-budget-free="true"
            data-byte-budget-free-shannons={model.freeShannons.toString()}
            title={`${formatExactCkb(model.freeShannons)} unspent · ${formatExactCkb(model.occupiedShannons)} occupied`}
            style={{ color: HUD_COLORS.ink, fontSize: HUD_TYPE.label }}
          >
            {formatCkb(model.freeShannons)}
          </span>
        </span>
      </div>
    </div>
  );
}
