import type { CSSProperties } from 'react';
import type { ActiveReplayProgress } from '@cknerv/cache';
import {
  HUD_COLORS,
  HUD_FONTS,
  HUD_TYPE,
  rgba,
  viewportMinusSafeArea,
} from './hudTheme';
import { Gauge, PLATE_CUT_CLIP, plateStateChip } from './primitives';
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
        width: `min(320px, ${viewportMinusSafeArea('width', 24)})`,
        boxSizing: 'border-box',
        padding: '9px 13px 10px',
        // A replay banner is a floating object — it arrives because something
        // happened to the chain and leaves when the catch-up ends — so it wears
        // the house floating shape: the single top-right cut, over the accent
        // left rail it already had. It used to cut BOTH diagonals at 9px, which
        // was a third corner dialect nothing else in the HUD spoke.
        //
        // Only the shape is shared with `spatialPlate`. The satellite plates are
        // anchored IN the scene and have to be near-opaque so lit HUD text
        // cannot print through them; this one floats over the stage at the top
        // centre, and a banner that heavy would read as a panel that had grown
        // there. So it keeps its own flat, translucent ground.
        background: `linear-gradient(90deg,${rgba(visual.color, 0.11)},${HUD_COLORS.panel} 34%,${rgba(HUD_COLORS.ground, 0.68)})`,
        border: `1px solid ${rgba(visual.color, 0.32)}`,
        borderLeft: `3px solid ${visual.color}`,
        boxShadow: `inset 0 0 18px ${rgba(visual.color, 0.05)}`,
        clipPath: PLATE_CUT_CLIP,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span aria-hidden style={{ color: visual.color, fontSize: HUD_TYPE.section }}>◇</span>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: HUD_TYPE.section, letterSpacing: 1.6, color: visual.color, textTransform: 'uppercase' }}>{visual.title}</span>
        {/* BOOT · CATCHUP · REORG · REBUILD — a state word beside the thing
            it is a state of, which is exactly what `plateStateChip` is and
            what four cards already wear. This was the family's only hand-cut
            outline: 1px 4px of padding against the house's 1px 5px, a 0.36
            border against 0.55, `nav` against `micro`, weight 400 against
            700, tracking 0.9 against 1.4. Six properties, six differences,
            none of them argued anywhere — which is how a grammar becomes two
            grammars. */}
        <span style={{ marginLeft: 'auto', ...plateStateChip(visual.color) }}>{visual.tag}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
        {visual.subtitle && (
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.9, color: visual.color, textShadow: `0 0 7px ${rgba(visual.color, 0.42)}` }}>{visual.subtitle}</span>
        )}
        {/* The counted form wants NO tracking — a run of mono digits either
            side of a slash reads as one measurement, and spacing it out turns
            it into two. The waiting sentence is words, so it gets a rung. */}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: waiting ? 0.6 : 0, color: waiting ? visual.color : HUD_COLORS.dim }}>
          {waiting ? visual.waiting : `${fmt(done)} / ${fmt(total)} blocks`}
        </span>
        {/* Full alpha here and on the subtitle above, for the reason
            `StreamHealthBanner` states at length: the REORG bar's two smallest
            readings were the two least legible things in the HUD (3.7 and 3.1
            at 8 px, report F, F-10), and they are the ones printed while
            consensus is being repaired. The softening they were spending
            contrast on is a glow now. */}
        {!waiting && (
          <span style={{ marginLeft: 8, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: visual.color, textShadow: `0 0 7px ${rgba(visual.color, 0.42)}` }}>
            {`${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`}
          </span>
        )}
      </div>
      <Gauge ratio={ratio} color={visual.color} />
    </div>
  );
}
