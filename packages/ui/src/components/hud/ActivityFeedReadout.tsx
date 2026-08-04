import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  activityCategoryColor,
  activityFeedVisualState,
  deriveActivityFeedVisual,
} from '../../derives/activityFeed.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

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

export default function ActivityFeedReadout({ source, record }: {
  source?: EnrichmentSourceStatus;
  record?: ActivityFeedRecord | null;
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
      aria-label="Indexed recent activity"
      data-activity-feed-state={visualState}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
        opacity: stale ? 0.68 : 1,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: HUD_FONTS.tech,
        fontSize: 7.5,
        letterSpacing: 1.35,
        color: accent,
        textTransform: 'uppercase',
        marginBottom: 5,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
        INDEXED ACTIVITY · LATEST {total} · #{record.as_of.block.toLocaleString('en-US')}
        {stale ? ' · STALE' : ''}
      </div>
      {total > 0 ? (
        <>
          <div
            title={visual.buckets.map((bucket) => `${bucket.category} ${bucket.count}`).join(' · ')}
            style={{ display: 'flex', height: 6, background: '#0a0a0a', border: `1px solid ${rgba(accent, 0.14)}` }}
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
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, color: '#9fb0bd', marginTop: 3, lineHeight: 1.45 }}>
            {visual.buckets
              .map((bucket) => `${CATEGORY_LABELS[bucket.category] ?? bucket.category.toUpperCase()} ${bucket.count}`)
              .join(' · ')}
          </div>
          <div style={{ marginTop: 6 }}>
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
                    fontSize: 8,
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
          </div>
        </>
      ) : (
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, color: HUD_COLORS.dim }}>
          NO INDEXED ACTIVITY
        </div>
      )}
    </section>
  );
}
