import type { CSSProperties } from 'react';
import type { CommonKnowledgeBreakdown } from '@cknerv/types';
import {
  deriveCellByteBudget,
  formatByteCount,
  formatUtilizationPercent,
  type ByteBudgetSegmentKey,
} from '../../derives/cellByteBudget.derive';
import { formatCkb } from './cellFormat';
import { HUD_COLORS, HUD_TYPE, rgba } from './hudTheme';

// KnowledgeBar's segment palette, unchanged, so the budget bar reads as the
// same instrument the 3px afterthought was.
const SEGMENT_COLORS: Record<ByteBudgetSegmentKey, string> = {
  cap: HUD_COLORS.orange,
  lock: HUD_COLORS.cyanWire,
  type: HUD_COLORS.nominal,
  data: HUD_COLORS.caution,
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
 *  the ratio strip below tells the other half of the story — how much of the
 *  purchased budget those bytes actually use. */
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
            {formatByteCount(model.totalBytes)}
          </span>
          <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9 }}>
            {' OCCUPIED'}
          </span>
        </span>
      </div>
      <div
        data-byte-budget-composition="true"
        title={model.segments
          .map((segment) => `${segment.label} ${segment.bytes}B`)
          .join(' · ')}
        style={{ display: 'flex', height: 9, gap: 1, marginTop: 3 }}
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
                background: color,
                boxShadow: `0 0 6px ${rgba(color, 0.5)}`,
                opacity: partial ? 0.6 : 1,
                borderTop: partial ? `1px dashed ${rgba(color, 0.9)}` : undefined,
              }}
            />
          );
        })}
      </div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 9px', marginTop: 3, fontSize: HUD_TYPE.micro, letterSpacing: 0.7, whiteSpace: 'nowrap' }}
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
              <span style={{ color: HUD_COLORS.ink }}>{formatByteCount(segment.bytes)}</span>
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
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 5, whiteSpace: 'nowrap' }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9 }}>OF</span>
        <span
          data-byte-budget-capacity="true"
          style={{ color: HUD_COLORS.ink, fontSize: HUD_TYPE.label }}
        >
          {formatCkb(capacityShannons)}
        </span>
        <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro }}>·</span>
        <span
          data-byte-budget-percent="true"
          style={{ color: HUD_COLORS.ink, fontSize: HUD_TYPE.label }}
        >
          {formatUtilizationPercent(model.utilization)}
        </span>
      </div>
      {/* Occupied over capacity, clamped — a 1M-CKB cell holding 102 B must
        * show a hairline here while the composition bar above stays full. */}
      <div
        data-byte-budget-ratio="true"
        style={{ position: 'relative', height: 2, marginTop: 2, background: rgba(HUD_COLORS.orange, 0.1) }}
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
      </div>
    </div>
  );
}
