import type {
  EnrichmentSourceStatus,
  TransactionHorizonRecord,
} from '@cknerv/types';
import {
  deriveTransactionHorizonVisual,
  transactionHorizonVisualState,
} from '../../derives/transactionHorizon.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba, STALE_OPACITY } from './hudTheme';
import { ReadoutHeader } from './primitives';

function compactCount(value: number): string {
  if (value < 1_000) return value.toLocaleString('en-US');
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

export default function TransactionHorizonReadout({ source, record, compact = false, folded = false }: {
  source?: EnrichmentSourceStatus;
  record?: TransactionHorizonRecord | null;
  /** Header-only summary that preserves section order on short viewports. */
  compact?: boolean;
  /** The rail has collapsed (`RAILS_COLLAPSE_MAX_WIDTH_PX`): the section is
   *  its own header and the
   *  count in it, nothing more. Distinct from `compact`, which is the SHORT
   *  viewport's answer and keeps whatever the section can still afford —
   *  a narrow stage and a short one are two different shortages, and a panel
   *  that answered both with the same form would be guessing at one of them. */
  folded?: boolean;
}) {
  if (!source || !record) return null;
  const visualState = transactionHorizonVisualState(source, record);
  const visual = deriveTransactionHorizonVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;

  if (compact || folded) {
    return (
      <section
        aria-label="Transaction horizon"
        title={visual.title}
        data-transaction-horizon-state={visualState}
        style={{
          marginTop: 6,
          paddingTop: 5,
          borderTop: `1px solid ${rgba(accent, 0.16)}`,
          opacity: stale ? STALE_OPACITY : 0.9,
        }}
      >
        <ReadoutHeader
          title="TX HORIZON"
          meta={`H${compactCount(visual.currentHour)}/D${compactCount(visual.currentDay)} · AS OF #${record.as_of.block.toLocaleString('en-US')}`}
          accent={accent}
          stale={stale}
          compact
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Transaction horizon"
      title={visual.title}
      data-transaction-horizon-state={visualState}
      style={{
        marginTop: 8,
        paddingTop: 7,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
        opacity: stale ? STALE_OPACITY : 1,
      }}
    >
      <ReadoutHeader
        title="TX HORIZON"
        meta={`${visual.hourlyCounts.length}/24H · AS OF #${record.as_of.block.toLocaleString('en-US')}`}
        accent={accent}
        stale={stale}
        compact
      />
      <div
        aria-hidden="true"
        style={{
          height: 16,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          padding: '2px 3px',
          background: HUD_COLORS.trackGround,
          border: `1px solid ${rgba(accent, 0.14)}`,
        }}
      >
        {visual.hourlyRatios.map((ratio, index) => (
          <span
            // Position is the stable identity of a fixed ordered time bucket.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            data-transaction-hour-count={visual.hourlyCounts[index]}
            style={{
              flex: 1,
              minWidth: 1,
              height: `${Math.max(1, ratio * 100)}%`,
              background: accent,
              boxShadow: ratio > 0.65 ? `0 0 4px ${rgba(accent, 0.38)}` : undefined,
              opacity: ratio === 0 ? 0.16 : 0.32 + ratio * 0.68,
            }}
          />
        ))}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 3,
        fontFamily: HUD_FONTS.mono,
        fontSize: HUD_TYPE.nav,
        color: HUD_COLORS.dim,
      }}>
        <span>HOUR <b style={{ color: HUD_COLORS.ink, fontWeight: 400 }}>{visual.currentHour.toLocaleString('en-US')}</b></span>
        <span>DAY <b style={{ color: HUD_COLORS.ink, fontWeight: 400 }}>{visual.currentDay.toLocaleString('en-US')}</b></span>
        <span>PEAK/H <b style={{ color: HUD_COLORS.ink, fontWeight: 400 }}>{visual.maxHourly.toLocaleString('en-US')}</b></span>
      </div>
    </section>
  );
}
