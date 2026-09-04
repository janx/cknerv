import type { StreamHealthPhase } from '@cknerv/cache';
import type { StreamHealthSummary } from '../../derives/streamHealth.derive';
import {
  formatStreamAge,
  formatStreamChannels,
} from '../../derives/streamHealth.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import TopBand from './TopBand';

const PRESENTATION: Record<
  Exclude<StreamHealthPhase, 'live'>,
  { title: string; color: string }
> = {
  connecting: { title: 'CONNECTING DATA PLANE', color: HUD_COLORS.cyanWire },
  retrying: { title: 'STREAM INTERRUPTED', color: HUD_COLORS.warning },
  resyncing: { title: 'RECONCILING SNAPSHOT', color: HUD_COLORS.memory },
  stale: { title: 'DATA FROZEN', color: HUD_COLORS.danger },
};

export default function StreamHealthBanner({
  summary,
  reducedMotion = false,
  top = 30,
}: {
  summary: StreamHealthSummary;
  reducedMotion?: boolean;
  top?: number;
}) {
  if (summary.phase === 'live') return null;
  const visual = PRESENTATION[summary.phase];
  const channel = formatStreamChannels(summary.affectedChannels);
  const retry = summary.phase === 'retrying' && summary.attempt > 0
    ? ` · RETRY ${summary.attempt}`
    : '';
  const age = summary.phase === 'stale'
    ? ` · LAST FRAME ${formatStreamAge(summary.lastMessageAgeMs)}`
    : '';
  return (
    <>
      {/* The third form in the house shape grammar (`primitives.tsx`): an
          edge-bound bar, and this file is one tenant of the single one the HUD
          draws (`TopBand`). It is neither docked nor floating, so it takes
          neither the panels' corner brackets nor the plates' cut corner — it
          runs the full width and the viewport ends it. Nothing about the data
          plane being unwell is a card you could have opened; this is the frame
          itself raising its voice. */}
      <TopBand
        accent={visual.color}
        title={visual.title}
        top={top}
        animation={reducedMotion || summary.phase !== 'stale'
          ? undefined
          : 'cknerv-hud-breathe 1.4s ease-in-out infinite'}
        attrs={{
          'data-stream-health-banner': 'true',
          'data-stream-phase': summary.phase,
        }}
      >
        {/* THE LETTERS ARE AT FULL AND THE SOFTENING IS THE GLOW.
          * This line was `rgba(visual.color, 0.82)`, which is a legibility
          * budget spent on tone: DATA FROZEN — the gravest thing this band
          * says — measured 3.9 : 1 over the band's centre and 2.2 over its
          * 28 % stop on a lit scene (report F, F-10). The two states that
          * clear 5 : 1 were the calm ones.
          *
          * An alarm may not be the quietest ink on screen, and the reason the
          * alpha was there — a bare `danger` at 9 px shouts — is a job for
          * atmosphere. So the ink is the reading and the halo is the tone,
          * which is the same division the whole palette runs on. */}
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 1.2, color: visual.color, textShadow: `0 0 7px ${rgba(visual.color, 0.42)}` }}>
          {channel}{retry}{age}
        </span>
      </TopBand>
      {summary.phase === 'stale' ? (
        <div
          aria-hidden
          data-stream-stale-frame
          style={{
            position: 'absolute',
            zIndex: 2,
            inset: 2,
            border: `1px solid ${rgba(visual.color, 0.32)}`,
            boxShadow: `inset 0 0 42px ${rgba(visual.color, 0.07)}`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
}
