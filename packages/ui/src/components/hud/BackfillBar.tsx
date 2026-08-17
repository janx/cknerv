import type { CSSProperties } from 'react';
import type { ActiveReplayProgress } from '@cknerv/cache';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { Gauge } from './primitives';
import { replayPresentation } from './replayPresentation';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BackfillBar({ backfill, style }: {
  backfill: ActiveReplayProgress | null; style?: CSSProperties;
}) {
  if (!backfill) return null;
  const { done, total, phase } = backfill;
  const visual = replayPresentation(phase);
  const waiting = total <= 0;
  const ratio = waiting ? 0 : done / total;
  return (
    <div
      role="status"
      aria-live="polite"
      data-replay-phase={phase}
      style={{
        position: 'absolute',
        top: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(320px, calc(100vw - 24px))',
        boxSizing: 'border-box',
        padding: '9px 13px 10px',
        background: `linear-gradient(90deg,${rgba(visual.color, 0.11)},${HUD_COLORS.panel} 34%,rgba(0,0,0,.68))`,
        border: `1px solid ${rgba(visual.color, 0.32)}`,
        borderLeft: `3px solid ${visual.color}`,
        boxShadow: `inset 0 0 18px ${rgba(visual.color, 0.05)}`,
        clipPath: 'polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span aria-hidden style={{ color: visual.color, fontSize: 10 }}>◇</span>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 10, letterSpacing: 1.7, color: visual.color, textTransform: 'uppercase' }}>{visual.title}</span>
        <span style={{ marginLeft: 'auto', padding: '1px 4px', border: `1px solid ${rgba(visual.color, 0.36)}`, fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 1, color: visual.color }}>{visual.tag}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
        {visual.subtitle && (
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 1, color: rgba(visual.color, 0.78) }}>{visual.subtitle}</span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 9, letterSpacing: waiting ? 0.7 : 0, color: waiting ? visual.color : HUD_COLORS.dim }}>
          {waiting ? visual.waiting : `${fmt(done)} / ${fmt(total)} blocks`}
        </span>
        {!waiting && (
          <span style={{ marginLeft: 8, fontFamily: HUD_FONTS.mono, fontSize: 8, color: rgba(visual.color, 0.7) }}>
            {`${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`}
          </span>
        )}
      </div>
      <Gauge ratio={ratio} color={visual.color} />
    </div>
  );
}
