import type { CSSProperties } from 'react';
import type { AlertLevel } from '../../derives/alertLevel';
import { HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba } from './hudTheme';
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
 *  flashing amber, in every configuration, since the band was written.
 *
 *  WHY IT IS NOT 30, WHICH IS WHAT THE BANNERS ARE. `StreamHealthBanner` and
 *  `BootSequenceBanner` are one formula to the digit — 30px, a horizontal
 *  gradient ground, a single `rgba(accent,.45)` bottom edge — and they may be,
 *  because they are two TENANTS OF ONE SLOT: `HudOverlay` renders whichever of
 *  them applies and never both, so the one thing they must not do is read as
 *  two different kinds of object.
 *
 *  This band is not a third tenant of that slot. It is the SECOND BAND IN THE
 *  STACK: it stands at `topBarHeight + 30` whenever a banner is up, so the
 *  alarm and a banner are on screen together in the two states that matter
 *  most, which the two banners can never be with each other. Two stacked bands
 *  cut to one formula are one 64px band with a seam in it. Every way this one
 *  differs falls out of that, and each is load-bearing rather than incidental:
 *
 *    · It closes BOTH edges at full-strength colour. A banner draws only a
 *      bottom edge because its top edge is the status strip's bottom edge —
 *      it hangs off the chrome. This one has a band above it as often as not,
 *      so without its own top rule the two grounds run together.
 *
 *    · It lays a FLAT ground rather than the banners' gradient. The gradient
 *      fades to transparent at both ends; `crit` lays hazard banding along the
 *      full width of both edges, and banding whose outer thirds sit on nothing
 *      is a hazard stripe that stops at the edges of the hazard.
 *
 *    · And it is 4px taller, which is the one number here that is a judgement
 *      rather than a deduction. The alarm carries `heroSub` — 19px of mincho,
 *      nearly twice the banners' `section` title — behind 4px of banding top
 *      and bottom that the banners do not have. At 30 the 警告 line box clears
 *      the banding by about a pixel and a half; at 34 by about three and a
 *      half, and it is still the tighter of the two bands. What is checked
 *      rather than argued is the invariant underneath it, in
 *      `hudDiscipline.test.ts`: the banding may never cross the type. */
export const WARNING_BAR_HEIGHT = 34;

/** Once the bar is already red there is no louder color left, so `crit` escalates
 *  in shape instead: 4px of 45° bands laid along the bar's own edges, the
 *  physical world's sign for do-not-cross. Static by construction — it is the one
 *  part of the alarm that still speaks when the flash is switched off for
 *  reduced motion. */
export const HAZARD_BAND_PX = 4;

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

/**
 * TEMPO IS THE THIRD AXIS OF THE RAMP, and it was the missing one.
 *
 * The alarm escalated in HUE (amber → red) and in SHAPE (the hazard banding at
 * `crit`), and ran the identical 600 ms `steps(2)` blink at all three levels —
 * so the two loudest states on the instrument moved at exactly the speed of the
 * quietest one (report E, E-8). A ramp whose top rung moves no faster than its
 * bottom is a ramp in colour with a strobe bolted to it.
 *
 *   WARNING  still. A reorg two blocks deep is news, not an emergency, and the
 *            band's presence is already the loudest thing on the page. Nothing
 *            in the HUD blinks to say "read me" — the panels are lit, not
 *            flashing — and an amber band that does is borrowing an urgency
 *            the level does not have.
 *   DANGER   the HUD's one breathe, at `grow`. The same slow swell the DATA
 *            FROZEN band wears, because it means the same thing: a state that
 *            is ongoing and wrong. 1,200 ms rather than report E's suggested
 *            1,400 for the reason every other duration in this HUD is a rung —
 *            an alarm is exactly the wrong place to introduce a 27th number.
 *   CRIT     the reserved `alarmEase`, `steps(2)` at `linger`. A hard two-state
 *            flash, no interpolation: the one motion in the application that is
 *            not trying to look natural.
 *
 * `alarmEase` stays reserved to this file and this level; the breathe above is
 * the theme's single keyframe, not a second one.
 */
function alarmAnimation(level: AlertLevel, reducedMotion: boolean): string | undefined {
  if (reducedMotion || level === 'warning') return undefined;
  return level === 'crit'
    ? `cknerv-hud-flash ${HUD_MOTION.linger}ms ${HUD_MOTION.alarmEase} infinite`
    : `cknerv-hud-breathe ${HUD_MOTION.grow}ms ${HUD_MOTION.loopEase} infinite`;
}

export default function WarningBar({ level, trigger, reducedMotion = false, top = 30 }: { level: AlertLevel; trigger: string | null; reducedMotion?: boolean; top?: number }) {
  if (!warningBarStanding(level)) return null;
  const color = level === 'warning' ? HUD_COLORS.warning : HUD_COLORS.danger;
  return (
    <div data-warning-bar={level} style={{ position: 'absolute', top, left: 0, right: 0, height: WARNING_BAR_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, background: rgba(level === 'crit' ? HUD_COLORS.crit : HUD_COLORS.ground, level === 'crit' ? 0.35 : 0.5), borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}`, animation: alarmAnimation(level, reducedMotion) }}>
      {level === 'crit' ? (
        <>
          <span aria-hidden data-hazard-band="top" style={hazardBand(color, 'top')} />
          <span aria-hidden data-hazard-band="bottom" style={hazardBand(color, 'bottom')} />
        </>
      ) : null}
      {/* `fontWeight: 400` and never above it: the Huiwen subset ships one
        * weight, so asking for 700 gets a synthesized bold — the browser
        * smears the mincho strokes sideways and the two glyphs lose their
        * serifs. Weight comes from the glow instead.
        *
        * ⚠️ It SAYS 400 rather than saying nothing, which is the 2026-09-05
        * correction. Saying nothing was the same instruction only while no
        * ancestor said otherwise, and the status strip's 状态 sat inside a
        * container asking for 600 for the life of the file — synthesized
        * bold at 9 px, on the one face in the HUD that cannot be bolded
        * (report F, F-2). A companion cannot know what it will inherit, so
        * every one of them declares.
        *
        * The CJK stays outline on purpose. It is the siren — it says only that
        * something happened — and the filled block beside it says what, in the
        * same inverted grammar the status strip escalates into.
        *
        * The 4 of tracking is a declared exception to the tracking table in
        * `hudTheme.ts`: two mincho glyphs sitting on the top rung need air
        * between them or they fuse into one dense mark. */}
      <span style={{ fontFamily: HUD_FONTS.cjk, fontWeight: 400, fontSize: HUD_TYPE.heroSub, color, letterSpacing: 4, textShadow: `0 0 12px ${color}` }}>警告</span>
      <span data-warning-trigger style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.panelTitle, textTransform: 'uppercase', ...severityChip(color) }}>{(trigger ?? level).toUpperCase()}</span>
    </div>
  );
}
