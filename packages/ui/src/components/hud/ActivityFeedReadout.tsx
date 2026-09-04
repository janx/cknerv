import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  activityCategoryColor,
  activityFeedVisualState,
  deriveActivityFeedVisual,
} from '../../derives/activityFeed.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { ReadoutHeader } from './primitives';

const CATEGORY_LABELS: Record<string, string> = {
  transfer: 'CKB',
  dao: 'DAO',
  token: 'TOKEN',
  object: 'OBJECT',
  identity: 'IDENTITY',
  script: 'SCRIPT',
  protocol: 'PROTOCOL',
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export default function ActivityFeedReadout({ source, record, compact = false, folded = false }: {
  source?: EnrichmentSourceStatus;
  record?: ActivityFeedRecord | null;
  /** Keep the bounded category fingerprint but omit rows on short viewports. */
  compact?: boolean;
  /** The rail has collapsed (≤1280): the section is its own header and the
   *  count in it, nothing more. Distinct from `compact`, which is the SHORT
   *  viewport's answer and keeps whatever the section can still afford —
   *  a narrow stage and a short one are two different shortages, and a panel
   *  that answered both with the same form would be guessing at one of them. */
  folded?: boolean;
}) {
  if (!source || !record) return null;
  const visualState = activityFeedVisualState(source, record);
  const visual = deriveActivityFeedVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;
  const total = visual.items.length;

  return (
    <section
      aria-label="Recent activity"
      data-activity-feed-state={visualState}
      data-activity-feed-compact={compact ? 'true' : undefined}
      data-activity-feed-folded={folded ? 'true' : undefined}
      style={{
        marginTop: compact || folded ? 6 : 10,
        paddingTop: compact || folded ? 5 : 8,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
        opacity: stale ? 0.68 : 1,
      }}
    >
      <ReadoutHeader
        title="ACTIVITY"
        meta={`LATEST ${total} · AS OF #${record.as_of.block.toLocaleString('en-US')}`}
        accent={accent}
        stale={stale}
        compact={compact || folded}
      />
      {folded ? null : total > 0 ? (
        <>
          <div
            title={visual.buckets.map((bucket) => `${bucket.category} ${bucket.count}`).join(' · ')}
            style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(accent, 0.14)}` }}
          >
            {visual.buckets.map((bucket) => (
              <span
                key={bucket.category}
                data-activity-category={bucket.category}
                style={{
                  width: `${(bucket.count / total) * 100}%`,
                  background: bucket.color,
                  boxShadow: `0 0 5px ${rgba(bucket.color, 0.28)}`,
                }}
              />
            ))}
          </div>
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: compact ? 2 : 3, lineHeight: 1.45 }}>
            {visual.buckets
              .map((bucket) => `${CATEGORY_LABELS[bucket.category] ?? bucket.category.toUpperCase()} ${bucket.count}`)
              .join(' · ')}
          </div>
          {!compact ? <div style={{ marginTop: 6 }}>
            {visual.items.slice(0, 4).map((item) => {
              const category = item.category.trim().toLowerCase();
              const color = activityCategoryColor(category);
              return (
                <div
                  key={item.tx_hash}
                  title={`${item.tx_hash} · ${item.participant_count} participants`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '58px 52px minmax(0, 1fr) auto',
                    gap: 5,
                    alignItems: 'baseline',
                    fontFamily: HUD_FONTS.mono,
                    fontSize: HUD_TYPE.nav,
                    padding: '1px 0',
                  }}
                >
                  <span style={{ color: HUD_COLORS.dim }}>#{item.block.toLocaleString('en-US')}</span>
                  <span style={{ color }}>{CATEGORY_LABELS[category] ?? category.toUpperCase()}</span>
                  <span style={{ color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label ?? shortHash(item.tx_hash)}
                  </span>
                  <span style={{ color: HUD_COLORS.dim }}>{item.participant_count}P</span>
                </div>
              );
            })}
          </div> : null}
        </>
      ) : (
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.dim }}>
          NO RECENT ACTIVITY
        </div>
      )}
    </section>
  );
}
