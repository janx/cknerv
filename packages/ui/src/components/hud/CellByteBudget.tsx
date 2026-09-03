import type { CSSProperties } from 'react';
import type { CommonKnowledgeBreakdown } from '@cknerv/types';
import {
  deriveCellByteBudget,
  formatUtilizationPercent,
  type ByteBudgetSegmentKey,
} from '../../derives/cellByteBudget.derive';
import {
  CONTENT_BANDS,
  SEGMENT_COLORS,
  formatCkb,
  formatDataSize,
  formatExactCkb,
} from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { REVEAL_GHOST_OPACITY } from './primitives';

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
        opacity: revealed ? 1 : REVEAL_GHOST_OPACITY,
        transition: 'opacity 260ms ease',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>
          BYTE BUDGET
        </span>
        {/* ⭐ THE UNIT'S OWN NAME, AND THIS IS THE ONE HEADING IN THE HUD
          * ENTITLED TO IT. `字节元` is the CKByte — a byte of state, bought and
          * held like a coin — and this zone is the only surface whose whole
          * subject IS that equivalence: capacity purchased in CKB, spent in
          * bytes, at one byte per CKB. Every OTHER reading in the overlay
          * merely COUNTS in the unit (a Cell's CAPACITY fact, STAGE·07's
          * Capacity, CKB·01's Live capacity, DAO·05's deposit hero), and a
          * unit tagged onto each of those is the same word printed five times
          * where the `CKB` suffix already stands.
          *
          * So it is a COMPANION TO A NAME, which is the only grammar this HUD
          * has for Chinese — the `cjk` of a `PanelHeader`, 细胞 on this card's
          * masthead — and never a suffix on a figure.
          *
          * ⚠️ `label` (9) is the floor for rendered Chinese here, and the
          * reason is the face rather than the rung: `micro` is the Latin
          * legibility floor because Chakra and Share Tech stop resolving their
          * counters, and a mincho glyph carries several times their stroke
          * count in the same em. Nothing in the HUD renders Han below 9 —
          * `StatusStrip`'s 状态 sits at exactly this rung. That puts the
          * companion one rung ABOVE the `micro` word it stands beside, which
          * is the arrangement `WarningBar` already ships: 警告 at `heroSub`
          * over a `panelTitle` chip. A zone heading is allowed to be quieter
          * than the name of the thing it is a heading for. */}
        <span
          data-byte-budget-unit="ckbyte"
          title="CKByte · one CKB of capacity buys one byte of state"
          style={{ fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, color: HUD_COLORS.dim, opacity: 0.7, whiteSpace: 'nowrap' }}
        >
          字节元
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
        * on the hover title, exact, where a restatement costs nothing.
        *
        * It was drawn in chrome. The bar above this one was re-cut off chrome
        * orange for exactly this reason — `SEGMENT_COLORS` says so where it
        * lives, that a byte decomposition wearing the frame's colours "look[ed]
        * like a status readout with an opinion about the Cell's health" — and
        * the strip promoted above it kept the orange, plus an orange-tinted
        * track that was not `trackGround`, plus an orange glow. So the reading
        * the whole line leads with was the one thing on it still speaking the
        * instrument's own frame colour.
        *
        * The track is `trackGround` now, like every other meter in the HUD.
        * The fill is `CONTENT_BANDS.value`, which is the band this house gives
        * capacity everywhere it appears — the CAP segment in the bar directly
        * above, the DAO class of the census, a cell's own amount. That is not
        * a collision with the CAP segment: this strip's denominator IS the
        * purchased capacity, and the FREE reading at the other end of the same
        * line is the same fact read backwards. One subject, one band. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, whiteSpace: 'nowrap' }}>
        <span
          data-byte-budget-ratio="true"
          data-byte-budget-capacity-shannons={model.capacityShannons.toString()}
          title={`${formatUtilizationPercent(model.utilization)} of ${formatExactCkb(model.capacityShannons)}`}
          style={{ position: 'relative', display: 'block', flex: '0 1 108px', height: 4, background: HUD_COLORS.trackGround }}
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
              background: CONTENT_BANDS.value,
              boxShadow: `0 0 6px ${rgba(CONTENT_BANDS.value, 0.55)}`,
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
          <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 1.4 }}>FREE</span>
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
