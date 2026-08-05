import type { StreamHealthPhase } from '@cknerv/cache';
import type { StreamHealthSummary } from '../../derives/streamHealth.derive';
import {
  formatStreamAge,
  formatStreamChannels,
} from '../../derives/streamHealth.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

const PRESENTATION: Record<
  Exclude<StreamHealthPhase, 'live'>,
  { title: string; color: string }
> = {
  connecting: { title: 'CONNECTING DATA PLANE', color: HUD_COLORS.cyanWire },
  retrying: { title: 'STREAM INTERRUPTED', color: HUD_COLORS.warning },
  resyncing: { title: 'RECONCILING SNAPSHOT', color: HUD_COLORS.rebuild },
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
      <div
        role="status"
        aria-live="polite"
        data-stream-health-banner
        data-stream-phase={summary.phase}
        style={{
          position: 'absolute',
          zIndex: 3,
          top,
          left: 0,
          right: 0,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          boxSizing: 'border-box',
          background: `linear-gradient(90deg,transparent,${rgba(visual.color, 0.13)} 28%,rgba(0,0,0,.78) 50%,${rgba(visual.color, 0.13)} 72%,transparent)`,
          borderBottom: `1px solid ${rgba(visual.color, 0.45)}`,
          color: visual.color,
          animation: reducedMotion || summary.phase !== 'stale'
            ? undefined
            : 'cknerv-hud-breathe 1.4s ease-in-out infinite',
        }}
      >
        <span aria-hidden style={{ fontSize: 9 }}>◇</span>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 10, letterSpacing: 2.1 }}>
          {visual.title}
        </span>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: rgba(visual.color, 0.82) }}>
          {channel}{retry}{age}
        </span>
      </div>
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
