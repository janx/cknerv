import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  activityFeedVisualState,
  deriveActivityRows,
} from '../../derives/activityFeed.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba, STALE_OPACITY } from './hudTheme';
import { ReadoutHeader } from './primitives';

/**
 * What each kind of thing on the chain did, in the last hour.
 *
 * ⚠️ This section used to be a sample: the newest eight transactions, a
 * stacked fingerprint of their categories and a legend under it. The chain's
 * newest transactions are two keepers writing state every block — 43 of the
 * latest 64 were `.bit Time Index State` — so the bar was one colour, the
 * legend said `SCRIPT 8`, and the reading never changed. Everything slower
 * than one a minute (a DAO withdrawal at six an hour, a token mint at one a
 * week, a Fiber channel closing) could not appear in eight rows at all.
 *
 * So the fingerprint and its legend are gone and the TABLE is the reading:
 * seven fixed rows, one per kind, each with what that kind did this hour, how
 * long ago the newest one of it was, and what that one was. A kind at 240 an
 * hour prints a floor; a kind that last happened five days ago says so. Both
 * are signal, and neither was visible before.
 */
export default function ActivityFeedReadout({ source, record, compact = false, folded = false }: {
  source?: EnrichmentSourceStatus;
  record?: ActivityFeedRecord | null;
  /** Short viewport. The seven rows ARE the section — there is no bar left to
   *  keep instead of them — so this only tightens the frame. */
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
  const visualState = activityFeedVisualState(source, record);
  const rows = deriveActivityRows(record);
  if (!visualState || !rows) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;
  // The hour's whole traffic, and whether any kind of it was a floor rather
  // than a count — a `+` on the total says the same thing the `+` on a row
  // says, which is the only honest way to add a floor to an exact figure.
  const total = record.kinds.reduce((sum, kind) => sum + kind.in_window, 0);
  const anyCapped = record.kinds.some((kind) => kind.in_window_capped);
  const seen = rows.some((row) => row.latest !== null);

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
        opacity: stale ? STALE_OPACITY : 1,
      }}
    >
      <ReadoutHeader
        title="ACTIVITY"
        meta={folded ? `${total}${anyCapped ? '+' : ''}/H` : 'LAST HOUR'}
        accent={accent}
        stale={stale}
        compact={compact || folded}
      />
      {folded ? null : seen ? (
        <div>
          {rows.map((row) => (
            <div
              key={row.kind}
              data-activity-kind={row.kind}
              title={row.latest
                ? `#${row.latest.block.toLocaleString('en-US')} · ${row.latest.tx_hash}`
                  + ` · ${row.latest.participant_count} participant${row.latest.participant_count === 1 ? '' : 's'}`
                : 'never seen'}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 40px 52px minmax(0, 1fr)',
                gap: 5,
                alignItems: 'baseline',
                fontFamily: HUD_FONTS.mono,
                fontSize: HUD_TYPE.nav,
                padding: '1px 0',
              }}
            >
              <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.tech, letterSpacing: 1.2, textTransform: 'uppercase', color: row.color }}>
                {row.label}
              </span>
              {/* A count of nothing is still a reading — it is how a reader
                  knows the kind was looked for — so the row keeps its place
                  and the figure steps back into `dim` rather than vanishing. */}
              <span style={{ textAlign: 'right', color: row.countIsZero ? HUD_COLORS.dim : HUD_COLORS.ink }}>
                {row.count}
              </span>
              {/* One case, units included: the age is authored on the rail,
                  so it is uppercased here the way `StatRow` uppercases a
                  label — in CSS, leaving the derive its own vocabulary. */}
              <span style={{ textTransform: 'uppercase', color: HUD_COLORS.dim }}>
                {row.age ?? '—'}
              </span>
              <span style={{ color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.what ?? ''}
              </span>
            </div>
          ))}
        </div>
      ) : (
        // Not "no recent activity": the rows carry the newest event of every
        // kind at ANY age, so an empty table means the index has never seen
        // one of anything, which is a statement about the index rather than
        // about the hour.
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.dim }}>
          NO ACTIVITY SEEN
        </div>
      )}
    </section>
  );
}
