import type { CSSProperties, ReactNode } from 'react';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';

/** The band's height. Exported because `HudOverlay` stacks the alarm on top of
 *  a band and both numbers have to be the same 30.
 *
 *  ⚠️ It is NOT what anything below the band clears any more. The band is an
 *  overlay: `contentTop` ignores it, the rails stand where they stand whether
 *  or not it is speaking, and this height moves the ALARM and nothing else. */
export const TOP_BAND_HEIGHT = 30;

/** The house mark for a band reporting on something still in progress: the
 *  static shell opens with it, so does `BackfillBar`, and so does every tenant
 *  here. */
export const TOP_BAND_GLYPH = '◇';

/**
 * How far in from each edge the band's rule has gone out completely.
 *
 * The band no longer moves an instrument — see `TOP_BAND_HEIGHT` — so it now
 * passes over the top 18px of both rails, and the one hard edge it draws must
 * not reach one. A hairline at 0.45 crossing CKB·01's bracket and the top of
 * its title is the whole reason the old arrangement had to reserve the room.
 *
 * The number is the left rail's own measure, restated: `RAIL_INSET_PX` 14 +
 * `CHAIN_PANEL_WIDTH_PX` 340 + `HUD_PANEL_FRAME_PX` 30. Restated rather than
 * imported, on the same bargain `HudOverlay` strikes for `MESH_PANEL_WIDTH_PX`
 * — the toll is an oracle in `hudDiscipline` that reads all three out of the
 * files that own them. The mesh rail is the narrower of the two (346) and
 * takes this same clearance: the band is one symmetric object, and 38px of
 * over-clearance on the right is a thing nobody can see.
 *
 * ⚠️ The percentage is a floor under it, not a second opinion. Below about
 * 1,200px the two rails have most of the width between them and a clearance
 * measured in pixels would leave no band to light at all; at that size the
 * text still reads (nothing masks it) and the wash under it just gives up.
 */
export const TOP_BAND_RULE_CLEAR_PX = 384;
const RULE_CLEAR = `min(${TOP_BAND_RULE_CLEAR_PX}px, 32%)`;
/** How long the rule takes to come up out of that clearance, as a share of the
 *  track it runs on — long enough that it reads as the edge fading in over the
 *  stage rather than being cut off at a rail. A share and not a measure so the
 *  ramp stays in proportion to the stage it is drawn on: ~150px of fade on a
 *  desktop, ~50 on an iPad, where the corridor between the rails is a third of
 *  the width. */
const RULE_RAMP_PCT = 12;
/**
 * The stage between the two rails — the band's own track, and a BOX rather
 * than an arithmetic expression on each thing that rides it.
 *
 * ⭐ Everything the band paints in its ACCENT lives in here, and that is the
 * whole division of the object: the ground below is the frame's and runs to
 * both viewport edges; the accent is the stage's and never leaves it. The band
 * used to be measured in two units at once — a ground fading on viewport
 * percentages, an edge clearing the rails in pixels — and the two diverged as
 * the viewport narrowed. Measured at 1,024px, where the rails take a third of
 * the width: the accent shoulder that lands at 0.089 over CKB·01 on a desktop
 * reached its full 0.13 there, and a teal haze over the top third of a panel
 * is a tint on somebody else's instrument. Now there is one number
 * (`RULE_CLEAR`) and nothing accented outside it.
 */
const TRACK: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: RULE_CLEAR,
  right: RULE_CLEAR,
};

/** The wash's own bottom edge, gone soft. The other half of the clearance: what
 *  still crosses a rail is the GROUND, which is black on a panel that is itself
 *  45% black and so has nothing to show — but black-on-black ending on a
 *  straight horizontal line halfway down a panel is a seam, and a seam is
 *  visible at any alpha. Feathered, there is no line to see. */
const WASH_FEATHER = `linear-gradient(180deg,${rgba(HUD_COLORS.ground, 1)} 0,${rgba(HUD_COLORS.ground, 1)} 66%,transparent 100%)`;

/**
 * The edge-bound band under the status strip — the one formula, once.
 *
 * Three readouts take this slot and never two at a time: the page's boot
 * record, the stage still composing after it, and the data plane being unwell.
 * They are one OBJECT changing what it says, which is a claim a reader settles
 * in a tenth of a second and the code has to earn: the band was previously
 * copied verbatim into each tenant, and `hudDiscipline` guarded the copies by
 * re-reading the formula out of both files, which holds an agreement exactly
 * as long as nobody edits one of them. Now there is nothing to agree about.
 *
 * What a tenant still owns is its accent, its title, and its trail. What it
 * cannot own is the shape: no brackets, no cut corner, the viewport ends its
 * ground, and the status strip above draws its top edge — this is the frame
 * itself speaking, not a card anybody opened (`primitives.tsx` argues the
 * grammar, and carries the one qualification the paragraph below buys).
 *
 * ⭐ AND IT NEVER MOVES AN INSTRUMENT. The band used to push both rails down
 * by its 30px and let them spring back up when it stopped speaking, which on
 * an ordinary cold start is one 30px jump of the entire HUD somewhere around
 * fifty seconds in — the composing chapter's settle clock re-arms on every
 * convergence burst, so the band stands for the whole of it and then leaves.
 * A reader who has spent that time finding TIP and EPOCH gets them moved out
 * from under their eye at the one moment nothing is happening.
 *
 * So the band is chrome over the stage: it costs no layout, it paints in tree
 * order (no `zIndex` — the rails arrive later and stand in front of it), and
 * the two hard edges it used to draw across the whole viewport are gone. What
 * lands on a panel is a whisper of the accent with no edge in it.
 */
export default function TopBand({
  accent,
  title,
  top,
  fill = null,
  animation,
  attrs,
  children,
}: {
  accent: string;
  title: string;
  top: number;
  /**
   * A measured fraction (0…1) riding the band's own bottom edge, or `null`.
   *
   * `null` means indeterminate and draws NOTHING — the same rule the snapshot
   * phase follows when a response carries no length. A band that invented a
   * denominator would be lying in the one place a reader takes on trust,
   * and the tenant that needed a bar is exactly the tenant whose numerator
   * spends part of its life without one.
   */
  fill?: number | null;
  /** Reserved for the one tenant that escalates (a frozen data plane), so the
   *  breathing lives with the band it belongs to rather than with the shape. */
  animation?: string;
  /** The tenant's own hooks — `data-boot-banner`, `data-stream-phase`. Spread
   *  rather than enumerated: the shape has no opinion about what a tenant
   *  needs to be found by. */
  attrs?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  const bar: CSSProperties | null = fill === null ? null : {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    // A fraction of the TRACK, not of the viewport: the bar is this edge
    // lighting up, and an edge that has gone out over a rail cannot be brighter
    // there than it is. Its own left end comes up out of the dark over the same
    // ramp the rule does, so the lit part and the dark part are one line.
    width: `${Math.max(0, Math.min(1, fill)) * 100}%`,
    background: `linear-gradient(90deg,transparent,${accent} ${RULE_RAMP_PCT}%)`,
    // A softer halo than the plate gauge's: that one sits inside a boxed plate
    // and can afford to glow, while this runs the width of the stage and the
    // chapter it belongs to is the quiet one.
    boxShadow: `0 0 6px ${rgba(accent, 0.55)}`,
  };
  return (
    <div
      role="status"
      aria-live="polite"
      {...attrs}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: TOP_BAND_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        color: accent,
        animation,
      }}
    >
      {/* The band's ground — the frame's half. Full bleed, so the viewport
          really is what ends it, and BLACK ONLY, so what it lays over the top
          of a rail is a deepening of a panel's own near-black rather than a
          colour. In its own box rather than on the band, because the feather is
          a mask and a mask on the band would take the type down with it. */}
      <span
        aria-hidden
        data-top-band-ground
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(90deg,transparent,${rgba(HUD_COLORS.ground, 0.78)} 50%,transparent)`,
          WebkitMaskImage: WASH_FEATHER,
          maskImage: WASH_FEATHER,
        }}
      />
      {/* …and the accent's half, on the track: two faint shoulders either side
          of the ground's dark core, coming up over the same ramp the rule does,
          so one number puts every accented thing in this band on the stage. */}
      <span
        aria-hidden
        data-top-band-tint
        style={{
          ...TRACK,
          background: `linear-gradient(90deg,transparent,${rgba(accent, 0.13)} ${RULE_RAMP_PCT}%,transparent 50%,${rgba(accent, 0.13)} ${100 - RULE_RAMP_PCT}%,transparent)`,
          WebkitMaskImage: WASH_FEATHER,
          maskImage: WASH_FEATHER,
        }}
      />
      {/* The bottom edge — the band's one hard line, and the only thing here
          drawn at a rung. It lights over the stage and is out by the time it
          reaches either rail, and the fill that rides it is its other half:
          both are children of the track, so neither can drift off the other. */}
      <span aria-hidden data-top-band-edge style={{ ...TRACK, top: 'auto', height: 2 }}>
        <span
          data-top-band-rule
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background: `linear-gradient(90deg,transparent,${rgba(accent, 0.45)} ${RULE_RAMP_PCT}%,${rgba(accent, 0.45)} ${100 - RULE_RAMP_PCT}%,transparent)`,
          }}
        />
        {/* The progress mark, and the whole of it: the band's own edge
            thickening and lighting up. A tenant that needs to show how far
            along it is gets this and not a plate with a gauge in it — one slot,
            one object, and an object does not sprout a second kind of body to
            carry a number. */}
        {bar ? <span data-top-band-fill style={bar} /> : null}
      </span>
      {/* The row, and it is `relative` for the same reason the ground is a box:
          a static child paints under a positioned sibling, so the type has to
          be positioned to stand on its own band.
          ⭐ THE TITLE STANDS ON THE CENTRE AND NOTHING MOVES IT. A centred flex
          row put the WHOLE row on the centre, so the title sat at
          `centre − rowWidth / 2` and slid sideways every time the trail beside
          it changed length — which is continuously: the boot record grows a
          phase at a time (`INSTRUMENT` → `· SNAPSHOT 62%` → `· DECODE` …) and
          the composing chapter rewrites its whole line twice as it advances.
          The one word a reader is trying to hold on to was the one thing in
          motion. Three grid columns instead: two equal shoulders and an `auto`
          middle, so the title lands on the viewport's centre line whatever is
          beside it, the mark hangs off its left, and the trail runs right and
          is ended by the band's own clip if it ever gets that far. (The
          shoulders are `minmax(0,1fr)` so a long trail overflows its column
          rather than pushing the middle off centre.) */}
      <span
        data-top-band-row
        style={{
          position: 'relative',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
          alignItems: 'center',
        }}
      >
        <span
          aria-hidden
          data-top-band-glyph
          style={{ justifySelf: 'end', marginRight: 10, fontSize: HUD_TYPE.label }}
        >
          {TOP_BAND_GLYPH}
        </span>
        <span
          data-top-band-title
          style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.section, letterSpacing: 2, whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
        <span data-top-band-trail style={{ justifySelf: 'start', marginLeft: 10, minWidth: 0 }}>
          {children}
        </span>
      </span>
    </div>
  );
}
