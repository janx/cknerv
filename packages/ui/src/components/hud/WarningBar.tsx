import type { CSSProperties } from 'react';
import type { AlertLevel } from '../../derives/alertLevel';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { severityChip } from './primitives';

const SHOWN: AlertLevel[] = ['warning', 'danger', 'crit'];

/** Whether the alarm is standing in the top slot at this level — the bar's own
 *  render decision, exported because the layout below it has to reach the same
 *  answer. Asking the question twice, in two dialects, is how the rails came to
 *  believe the slot was empty while the band was flashing in it. */
export function warningBarStanding(level: AlertLevel): boolean {
  return SHOWN.includes(level);
}

/** The band's own height. Exported for the same reason: the alarm is placed
 *  UNDER whichever banner holds the slot, and everything below it — the rails,
 *  the replay plate, the composition chip — has to start clear of its bottom
 *  edge. It shipped as a literal that lived only here, so nothing below ever
 *  moved: on any reorg or at-tip stall the CKB and PULSE panels printed their
 *  top brackets and the first third of their headers straight through 34px of
 *  flashing amber, in every configuration, since the band was written. */
export const WARNING_BAR_HEIGHT = 34;

/** Once the bar is already red there is no louder color left, so `crit` escalates
 *  in shape instead: 4px of 45° bands laid along the bar's own edges, the
 *  physical world's sign for do-not-cross. Static by construction — it is the one
 *  part of the alarm that still speaks when the flash is switched off for
 *  reduced motion. */
const HAZARD_BAND_PX = 4;

function hazardBand(color: string, edge: 'top' | 'bottom'): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    top: edge === 'top' ? 0 : undefined,
    bottom: edge === 'bottom' ? 0 : undefined,
    height: HAZARD_BAND_PX,
    background: `repeating-linear-gradient(45deg, ${color} 0 6px, transparent 6px 12px)`,
    pointerEvents: 'none',
  };
}

export default function WarningBar({ level, trigger, reducedMotion = false, top = 30 }: { level: AlertLevel; trigger: string | null; reducedMotion?: boolean; top?: number }) {
  if (!warningBarStanding(level)) return null;
  const color = level === 'warning' ? HUD_COLORS.warning : HUD_COLORS.danger;
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, height: WARNING_BAR_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, background: rgba(level === 'crit' ? HUD_COLORS.crit : HUD_COLORS.ground, level === 'crit' ? 0.35 : 0.5), borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}`, animation: reducedMotion ? undefined : 'cknerv-hud-flash 0.6s steps(2) infinite' }}>
      {level === 'crit' ? (
        <>
          <span aria-hidden data-hazard-band="top" style={hazardBand(color, 'top')} />
          <span aria-hidden data-hazard-band="bottom" style={hazardBand(color, 'bottom')} />
        </>
      ) : null}
      {/* No fontWeight here: the Huiwen subset ships one weight, so asking for
        * 700 only gets a synthesized bold — the browser smears the mincho
        * strokes sideways and the two glyphs lose their serifs. Weight comes
        * from the glow instead.
        *
        * The CJK stays outline on purpose. It is the siren — it says only that
        * something happened — and the filled block beside it says what, in the
        * same inverted grammar the status strip escalates into.
        *
        * The 4 of tracking is a declared exception to the tracking table in
        * `hudTheme.ts`: two mincho glyphs sitting on the top rung need air
        * between them or they fuse into one dense mark. */}
      <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.heroSub, color, letterSpacing: 4, textShadow: `0 0 12px ${color}` }}>警告</span>
      <span data-warning-trigger style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.panelTitle, textTransform: 'uppercase', ...severityChip(color) }}>{(trigger ?? level).toUpperCase()}</span>
    </div>
  );
}
