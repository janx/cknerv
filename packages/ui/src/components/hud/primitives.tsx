import { useState, type CSSProperties, type ReactNode } from 'react';
import { CJK_BASELINE_LIFT, COMPANION_OPACITY, DIAMOND_ROTATION, HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba } from './hudTheme';

// ——— The shape grammar ————————————————————————————————————————————————
//
// A HUD surface announces what KIND of thing it is with its corners, before a
// reader has taken in a single word of it. Four forms, and every surface in the
// overlay belongs to exactly one:
//
//   DOCKED PANEL — two corner brackets, top-left and bottom-right. The rails
//     are furniture: bolted to an edge of the frame, present the whole session,
//     read at rest. `HudPanel` below is the only way to draw one.
//
//   FLOATING / TRANSIENT OBJECT — one cut corner at the top right, `PLATE_CUT_PX`
//     deep, over an accent left edge. Anything that arrived because something
//     happened and leaves when it stops: the scene-anchored inspection plates
//     (`spatialPlate` further down), the replay banner (`BackfillBar.tsx`). The
//     cut is the whole tell — a clipped corner reads as a card laid ON the
//     instrument, where brackets read as part of it.
//
//   LIVE VIEWPORT / RETICLE — FOUR corner brackets. Not a panel at all but a
//     viewfinder: the CELL SCAN square in `CellDetailPanel.tsx`
//     (`portraitBracket`), which frames a live render you can drag. Two brackets
//     say "this is a surface"; four say "you are looking THROUGH this at
//     something". They are two idioms on purpose — nobody should ever "fix"
//     either one into the other.
//
//   EDGE-BOUND BAR — no corner treatment at all, because it owns no corners to
//     treat: it spans the viewport and is cut off by it (`StreamHealthBanner.tsx`).
//     Neither docked nor floating; it is the frame itself raising its voice.
//
// One cut, one number, written once. Every clipped corner in the HUD comes from
// here, so a banner and a satellite plate can never disagree about the angle.

export const PLATE_CUT_PX = 12;

export const PLATE_CUT_CLIP = `polygon(0 0,calc(100% - ${PLATE_CUT_PX}px) 0,100% ${PLATE_CUT_PX}px,100% 100%,0 100%)`;

// ——— The marks ————————————————————————————————————————————————————————
//
// The other half of the shape grammar, and the half that spent its life being
// typed instead of drawn. A lamp, a caret, a direction, a menu icon, a drag
// affordance: none of these is a word, and every one of them shipped as a
// character — `●`, `▲`, `▼`, `▦`, `↔` — inside a text run.
//
// That is not a style opinion, it is a bug. The HUD's Latin faces are Google's
// pre-built `latin`-range woff2, and that range stops before the Geometric
// Shapes block entirely: not one of `● ▲ ▼ ▦ ↔` is in any face this repo
// ships, and none of them is in the upstream faces either. Every one of them
// was resolving out of whatever the reader's machine happened to have — the
// same silent fallback the Chinese subset is inventoried against in
// `src/fonts/README.md`, arriving from the side nobody had checked. A mark
// drawn here also gets what a borrowed glyph never had: an exact size, an
// exact colour, and a baseline it sits on rather than near.
//
// Three forms, and the vocabulary is deliberately small so a reader can learn
// it once:
//
//   LAMP — a condition. Lit is a filled disc, unlit is a ring, and the colour
//     is the reading. Wherever something can be well or unwell: the cadence
//     monitor's `FINE`/`FLATLINE`, a Cell's `LIVE`/`SPENT`.
//
//   DIRECTION — which way a quantity moved, or which way a disclosure opens.
//     A triangle, never an arrow: arrows are characters and belong in
//     sentences (see `HUD_FONTS`), triangles are marks and belong here.
//
//   PANEL GRID — the one icon in the overlay, on the control that shows and
//     hides panels. It draws what it opens.
//
// All four are `aria-hidden` by construction, and that is a claim each call
// site has to keep: a mark may only carry a meaning some WORD beside it also
// carries. `BORN`/`DIED` say the direction, `FINE` says the condition,
// `aria-expanded` says the disclosure. Nothing here is the sole carrier of
// anything, which is why nothing here needs a label.

/** A condition light. `lit` fills it; unlit leaves the ring, which is the
 *  off-state of a lamp rather than a second symbol standing in for one. */
export function StatusLamp({ color, lit = true, size = 5 }: {
  color: string;
  lit?: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-status-lamp={lit ? 'lit' : 'unlit'}
      style={{
        flex: '0 0 auto',
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: lit ? undefined : `1px solid ${color}`,
        background: lit ? color : 'transparent',
        boxShadow: lit ? `0 0 ${size}px ${color}` : undefined,
        boxSizing: 'border-box',
      }}
    />
  );
}

/** Which way. A CSS triangle, so it is the size it is asked to be at 7.5px —
 *  the rung where a borrowed glyph's own optical sizing stopped agreeing with
 *  the type beside it. */
export function DirectionMark({ direction, color, size = 5 }: {
  direction: 'up' | 'down';
  color: string;
  size?: number;
}) {
  const edge = `${size / 2}px solid transparent`;
  const point = `${size * 0.82}px solid ${color}`;
  return (
    <span
      aria-hidden="true"
      data-direction-mark={direction}
      style={{
        flex: '0 0 auto',
        display: 'inline-block',
        width: 0,
        height: 0,
        borderLeft: edge,
        borderRight: edge,
        borderTop: direction === 'down' ? point : undefined,
        borderBottom: direction === 'up' ? point : undefined,
      }}
    />
  );
}

/** The panels control's icon: four cells of a grid, the first one lit, drawn
 *  in the button's own ink so it can never disagree with the word beside it. */
export function PanelGridMark({ size = 7 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      data-panel-grid-mark
      style={{
        flex: '0 0 auto',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        width: size,
        height: size,
      }}
    >
      {[0, 1, 2, 3].map((cell) => (
        <span key={cell} style={{ background: 'currentColor', opacity: cell === 0 ? 1 : 0.5 }} />
      ))}
    </span>
  );
}

/** A DIAMOND. The fifth mark, and the one that was never drawn: eleven hand-cut
 *  `rotate(45deg)` spans in five files (report F, F-12), at four sizes, six
 *  glow alphas and four different ways of filling the same shape.
 *
 *  What it means, everywhere it appears: A POINT ON A LINE. The scrubber's
 *  position on its track, the locked hop on its route, a stage on the read
 *  ladder, the sync ladder's two ends. That is why it is a diamond and not a
 *  lamp: a lamp is a condition, and a condition has no place on a scale.
 *
 *  Four fills, and the fill is what the point is doing:
 *
 *    none     a marker on nothing — the outline alone.
 *    ground   a HOLE. The mark sits ON its track rather than over it, which is
 *             the same knockout the strip's scrubber beads use and the reason
 *             `HUD_COLORS.ground` exists.
 *    wash     present but not reached — the outline with a tint inside it.
 *    solid    reached.
 *
 *  ONE GLOW, sized to the mark rather than chosen per site. The eleven sites
 *  spent 0.53, 0.55, 0.65, 0.67, 0.7, 0.72 and 1.0 on the same halo; none of
 *  them is a decision, and a halo that grows with its mark is the rule the
 *  numbers were groping for. */
export function DiamondMark({ color, size = 5, fill = 'none', glow = true, centered, attrs, style }: {
  color: string;
  size?: number;
  fill?: 'none' | 'ground' | 'wash' | 'solid';
  glow?: boolean;
  /** Which axes the mark is centred on its own position. The transform is the
   *  primitive's, so a caller positions with `left`/`top` and never writes the
   *  rotation itself — that is what let eleven of these drift. */
  centered?: 'x' | 'both';
  /** The site's own `data-*` hooks, the way `TopBand` takes its tenants'. A
   *  mark that names a scrubber or a route position is queried by tests and by
   *  the capture driver, and a primitive that swallowed those hooks would make
   *  itself unusable at exactly the sites that most need one. */
  attrs?: Record<string, string>;
  style?: CSSProperties;
}) {
  const translate = centered === 'both'
    ? 'translate(-50%, -50%) '
    : centered === 'x' ? 'translateX(-50%) ' : '';
  return (
    <span
      aria-hidden="true"
      data-diamond-mark={fill}
      {...attrs}
      style={{
        flex: '0 0 auto',
        boxSizing: 'border-box',
        width: size,
        height: size,
        border: `1px solid ${color}`,
        background: fill === 'ground'
          ? HUD_COLORS.ground
          : fill === 'wash' ? rgba(color, 0.18) : fill === 'solid' ? color : 'transparent',
        boxShadow: glow ? `0 0 ${size + 2}px ${rgba(color, 0.62)}` : undefined,
        transform: `${translate}${DIAMOND_ROTATION}`,
        ...style,
      }}
    />
  );
}

/** "This drags sideways." The one mark that is a drawing rather than a form —
 *  a double-headed arrow has no CSS shorthand, and `↔` is carried by no face
 *  the HUD ships or could ship: the upstream Latin faces do not have it
 *  either. */
export function DragAxisMark({ width = 11 }: { width?: number }) {
  return (
    <svg
      aria-hidden="true"
      data-drag-axis-mark
      width={width}
      height={5}
      viewBox="0 0 11 5"
      fill="none"
      style={{ flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path
        d="M0.5 2.5h10M2.6 0.6 0.5 2.5l2.1 1.9M8.4 0.6 10.5 2.5 8.4 4.4"
        stroke="currentColor"
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HudPanel({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      data-hud-occlusion="true"
      style={{ position: 'absolute', padding: '13px 15px', background: HUD_COLORS.panel, ...style }}
    >
      <span style={bracket('tl')} /><span style={bracket('br')} />
      {children}
    </div>
  );
}

function bracket(corner: 'tl' | 'br'): CSSProperties {
  const base: CSSProperties = { position: 'absolute', width: 11, height: 11, borderColor: HUD_COLORS.orange, borderStyle: 'solid', opacity: 0.8 };
  return corner === 'tl'
    ? { ...base, top: 0, left: 0, borderWidth: '1px 0 0 1px' }
    : { ...base, bottom: 0, right: 0, borderWidth: '0 1px 1px 0' };
}

export function PanelHeader({ en, cjk, idx, accent, compact = false }: {
  en: string; cjk: string; idx: string;
  /** Mesh identity color — tints the index tag. */
  accent?: string;
  /** Tighter header-to-content gap for short instrument panels. */
  compact?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: compact ? 6 : 11 }}>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: HUD_TYPE.panelTitle, letterSpacing: 3, color: HUD_COLORS.orange, textTransform: 'uppercase', textShadow: `0 0 9px ${rgba(HUD_COLORS.orange, 0.45)}` }}>{en}</span>
      {/* ⚠️ `nowrap`, and it is the collapsed rail that makes it necessary: at
          CKB·01's folded 268px measure the English title takes two lines, and
          a flex line that has run out of room squeezes THIS span to a column —
          which broke 共识基 across two lines mid-word. A CJK companion is a
          name, and a name does not break. The English title beside it may
          wrap; it is words. */}
      <span style={{ ...CJK_BASELINE_LIFT, flex: '0 0 auto', whiteSpace: 'nowrap', fontFamily: HUD_FONTS.cjk, fontWeight: 400, fontSize: HUD_TYPE.section, color: HUD_COLORS.orangeDeep, opacity: COMPANION_OPACITY }}>{cjk}</span>
      <span style={{ marginLeft: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: accent ?? HUD_COLORS.moduleSlate, letterSpacing: 0.9, textShadow: accent ? `0 0 7px ${rgba(accent, 0.4)}` : undefined }}>{idx}</span>
    </div>
  );
}

/**
 * The rail's rhythm. A stat row is a fixed box with its label and its figure on
 * a shared baseline, so two rows running is 17 px of baseline-to-baseline and
 * a column of them reads as ONE instrument rather than a stack of lines.
 *
 * ⚠️ That only holds while every row's tallest ascent is the same. `alignItems:
 * 'baseline'` puts the shared baseline at the tallest ascent BELOW the row's
 * top edge, so what is left underneath it — which is what the next row's
 * baseline is measured across — is `height − ascent`. Give one row a bigger
 * numeral and that row alone pays for it: TIP → EPOCH measured **12 px** on a
 * 17 px rhythm because a 14 px numeral's ascent is 15.9 and only 1.1 px of the
 * row was left under it (report A, A-4). The lift bought size and spent the one
 * thing size needs.
 */
export const STAT_ROW_HEIGHT_PX = 17;

/**
 * …so a LIFTED row is as tall as the rhythm plus the ascent its numeral adds:
 *
 *     height = STAT_ROW_HEIGHT_PX + ascent(the numeral) − ascent(a plain value)
 *
 * The ascents are facts of the faces, and these are MEASURED in the page rather
 * than computed from the metrics — a probe of zero size appended to a line sits
 * on that line's baseline, and the browser rounds where the metrics do not:
 *
 *   | the row's figure               | ascent | height        | pitch below |
 *   |--------------------------------|--------|---------------|-------------|
 *   | plain — mono at `value` 11.5   | 10     | 17            | 17          |
 *   | `emphasis` 14, `lineHeight: 1` | 12     | 17 + 12 − 10 → **19** | 17 |
 *   | `hero` 22, `lineHeight: 1`     | 18     | 17 + 18 − 10 → **25** | 17 |
 *
 * A lifted figure is display-face at `lineHeight: 1` — the HUD's own hero
 * pattern, on PULSE and on CELL·03 — which is what keeps the ascent to 18 for a
 * 22 px numeral instead of the 25 its natural leading would take.
 *
 * Two rungs, one rule, and the rule is the reason the numbers are what they
 * are; a row lifted to a rung this table does not name has no answer for how
 * much air it owes the row below, which is why the prop names the rung rather
 * than taking a height.
 */
export const STAT_ROW_LIFTED_HEIGHT_PX = { emphasis: 19, hero: 25 } as const;

export type StatRowLift = keyof typeof STAT_ROW_LIFTED_HEIGHT_PX;

/** A label and the figure it names. A rail row carries no CJK companion: it is
 *  read for its NUMBER, and a word standing between the label and the figure is
 *  one more thing to read past on every glance. The unit's Chinese name lives
 *  on the dossier's `CKBYTE` zone, where naming the unit IS the subject. */
export function StatRow({ label, children, valueColor, title, lifted }: {
  label: string; children: ReactNode; valueColor?: string;
  /** Hover-only provenance for rows whose source differs from the panel's own. */
  title?: string;
  /** The rung this row's figure is lifted to. The row grows by the ascent that
   *  rung adds, so the rows under it keep the rail's rhythm; the figure itself
   *  is still the caller's to draw, because only the caller knows whether it is
   *  tabular, coloured or breathing. */
  lifted?: StatRowLift;
}) {
  return (
    <div
      title={title}
      data-hud-stat-lift={lifted}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        height: lifted === undefined ? STAT_ROW_HEIGHT_PX : STAT_ROW_LIFTED_HEIGHT_PX[lifted],
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: HUD_TYPE.tech, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.value, color: valueColor ?? HUD_COLORS.ink }}>{children}</span>
    </div>
  );
}

/** Shared heading for fused domain readouts. Provenance stays in transport
 * health; the heading carries only the domain, freshness, and useful scope. */
export function ReadoutHeader({ title, meta, accent, stale = false, compact = false }: {
  title: string;
  meta?: ReactNode;
  accent: string;
  stale?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 5,
        rowGap: 1,
        fontFamily: HUD_FONTS.tech,
        fontSize: HUD_TYPE.micro,
        letterSpacing: 1.2,
        color: accent,
        textTransform: 'uppercase',
        marginBottom: compact ? 3 : 5,
      }}
    >
      <span style={{ width: 5, height: 5, flex: '0 0 auto', borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
      <span data-readout-title>{title}</span>
      {meta != null ? <span data-readout-meta style={{ color: HUD_COLORS.dim }}>· {meta}</span> : null}
      {stale ? <span data-readout-stale>· STALE</span> : null}
    </div>
  );
}

/** The track is derived from the fill, so a REORG-red or rebuild-violet gauge
 *  stops sitting inside a green frame — the hardcoded surround was a second,
 *  contradictory reading of the same bar. */
export function Gauge({ ratio, color }: { ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div style={{ height: 5, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(color, 0.2)}`, position: 'relative', margin: '2px 0 3px' }}>
      <span data-fill style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
    </div>
  );
}

/** The one control every card carries, and for the life of the file the one
 *  control no keyboard could reach: a `<span role="button">` with no
 *  `tabIndex` and no key handler, so a visitor who had tabbed into a card's
 *  facts had no way out of it but the mouse (report E, E-13).
 *
 *  A real `<button>` is the whole fix — it is focusable, it fires on Enter and
 *  Space, and it takes the theme's `button:focus-visible` ring with every
 *  other button in the overlay. What it also brings is a user-agent stylesheet
 *  that would give it a border, a grey ground and the OS font, so the reset
 *  below is not decoration: `appearance:none`, no border, no padding, the
 *  ground transparent. `type="button"` because a bare button inside a form
 *  submits it. */
export function CloseButton({ onClose, title }: { onClose: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-label="close"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.color = HUD_COLORS.danger; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.color = HUD_COLORS.dim; }}
      onBlur={(e) => { (e.currentTarget as HTMLElement).style.color = HUD_COLORS.dim; }}
      style={{
        appearance: 'none', border: 0, padding: 0, background: 'transparent',
        position: 'absolute', top: 6, right: 11, cursor: 'pointer', pointerEvents: 'auto',
        fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.emphasis, lineHeight: 1, color: HUD_COLORS.dim,
      }}
    >×</button>
  );
}

// ——— Spatial instrument grammar ————————————————————————————————————————
// The scene-anchored inspection satellites speak a directional-plate dialect
// of the floating form above: the house cut corner, plus a leading accent edge
// and a ~100° near-opaque gradient. Single-sourced so every plate agrees — and
// so the trailing edge can never thin out enough to let a full-brightness HUD
// panel print through the plate (the tail alpha floor is the load-bearing part:
// the rails no longer dim for an open card, so a plate may sit directly over
// lit text). A floating object that is NOT anchored in the scene wears the cut
// without the gradient — see `BackfillBar.tsx`.

/** Dark tail tinted faintly toward the accent — directional, never sheer.
 *
 *  ⚠️ The base is `stageGround`, READ, and that is the whole of the fix here:
 *  it was the arithmetic literal (4, 8, 14), a thirteenth spelling of the
 *  near-black this palette says is spelled once (report F, F-15) and 6.7 from
 *  the token. A value assembled by arithmetic is still a value, and it is the
 *  one shape the ink jurisdiction's sweep could not see — which is exactly why
 *  it survived the round that deleted the other twelve. */
export function spatialPlateTail(accent: string): string {
  const channels = (hex: string) => [0, 2, 4]
    .map((offset) => parseInt(hex.replace('#', '').slice(offset, offset + 2), 16));
  const [r, g, b] = channels(accent);
  const [gr, gg, gb] = channels(HUD_COLORS.stageGround);
  return `rgba(${Math.round(gr + r * 0.055)},${Math.round(gg + g * 0.055)},${Math.round(gb + b * 0.055)},0.95)`;
}

export function spatialPlateBackground(accent: string): string {
  return `linear-gradient(100deg,${rgba(HUD_COLORS.stageGround, 0.985)},${rgba(HUD_COLORS.stageGround, 0.965)} 72%,${spatialPlateTail(accent)})`;
}

/**
 * A PLATE'S OWN EDGE, and it is three numbers because the edge is lit.
 *
 * The plate is a surface catching light from the left: a bright rail, a top
 * that reads as the lit face turning away, an underside barely there. The
 * three were literals inside `spatialPlate` and the alpha ladder exempted them
 * on the grounds that a single-sourced edge cannot drift — true of this
 * function, and untrue of the overlay, because `ConsensusIdentityPlate` and
 * `CellCausalLensReadout` build plates of the same shape BY HAND and invented
 * seven more alphas between 0.102 and 0.478 doing it (report F, F-1).
 *
 * So the numbers are named and the hand-drawn plates read them. Nothing about
 * `spatialPlate` changes; what changes is that a second plate dialect can no
 * longer disagree with the first about which way the light comes from — two of
 * those seven had the top edge brighter than the left rail, which is the
 * lighting reversed.
 */
export const PLATE_EDGE_ALPHA = { rail: 0.46, top: 0.15, bottom: 0.09 } as const;

export function spatialPlate(accent: string): CSSProperties {
  return {
    borderLeft: `1px solid ${rgba(accent, PLATE_EDGE_ALPHA.rail)}`,
    borderTop: `1px solid ${rgba(accent, PLATE_EDGE_ALPHA.top)}`,
    borderBottom: `1px solid ${rgba(accent, PLATE_EDGE_ALPHA.bottom)}`,
    background: spatialPlateBackground(accent),
    clipPath: PLATE_CUT_CLIP,
  };
}

/** Base box for one plate of a scene-anchored card. The cell card's plates
 *  are siblings in a grid and stack in source order; the peer dialects lift
 *  theirs onto a paint layer of their own. */
export const satelliteBase: CSSProperties = {
  position: 'relative',
  minWidth: 0,
  boxSizing: 'border-box',
  pointerEvents: 'auto',
};

/** The same plate, one layer up — kept property-for-property as the peer
 *  dialects wrote it so a shared base cannot re-order their inline style. */
export const stackedSatelliteBase: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  pointerEvents: 'auto',
};

/** The same word with the color behind it instead of around it: at warning and
 *  above, a severity inverts into a solid block and reads the panel ground back
 *  out through its letters. Severity is the only thing allowed to fill (see the
 *  layer rule in `hudTheme.ts`) — chrome and identity wear the outline chip
 *  below. Type is left to the caller so the block can sit inside a strip's
 *  `tech` register or a banner's `panelTitle` one without changing its voice. */
export function severityChip(color: string): CSSProperties {
  return {
    padding: '1px 6px',
    background: color,
    color: HUD_COLORS.ground,
    letterSpacing: 1.4,
  };
}

/** The bordered state word a card sets beside an identity — MINER, INBOUND,
 *  NOT LINKED, ACTIVE, DEPRECATED. One chip grammar, tinted by the caller. */
export function plateStateChip(color: string): CSSProperties {
  return {
    padding: '1px 5px',
    border: `1px solid ${rgba(color, 0.55)}`,
    color,
    fontFamily: HUD_FONTS.tech,
    fontSize: HUD_TYPE.micro,
    fontWeight: 700,
    letterSpacing: 1.4,
  };
}

// ——— Rail-hung readout rows ——————————————————————————————————————————
// Every floating card states a fact the same way: a hairline rail in the
// plate's accent, a micro label at the left, the value pushed all the way to
// the right edge of the measure, and an optional micro caption underneath.
// The self probe, the crawler dossier, the sighted-node card and the Cell
// register all speak this one row — it is the house's readout sentence.

/** Rail alpha the probe dialects draw; the dossier goes one step fainter. */
export const PLATE_ROW_RAIL_ALPHA = 0.34;

/**
 * …and the one rail in the overlay that is deliberately louder than the plate
 * around it.
 *
 * The dossier's composition blocks hang on a 2px rail in the tier's own
 * colour, and the block's own comment says why: "this is a card among rows,
 * and the edge is what says so before the type does". A block that announced
 * itself at the row rung would be a row with a thick line, which is a
 * different sentence.
 *
 * It is a rung and not a literal because it was 0.55 in one file and nothing
 * anywhere said whether that was the row rail rounded up, the plate edge
 * rounded down, or a number. It is none of those: it is the one weight a rail
 * takes when the thing hanging on it is a BLOCK rather than a row.
 */
export const PLATE_ROW_RAIL_LIT_ALPHA = 0.55;

/**
 * …and what a rail on a PRESSABLE row does when the pointer reaches it.
 *
 * A register fact is a button — it tints the tether, re-weights the braid,
 * opens the knowledge ring and reads an identity proof — and it looked like a
 * readout: a rail at the rung above, a dim label, a value, and a cursor. The
 * selected state had a wash and a shadow; hover had nothing (report E, E-12).
 *
 * So the rail is the affordance, and this is its second rung: under the
 * pointer or a keyboard focus it takes the fact's OWN accent at full strength,
 * the label ink comes up, and the selected wash appears at half its weight — a
 * preview of what pressing does, in the language pressing speaks.
 *
 * ⚠️ Three numbers, one idea, so they are stated together: a card that lit its
 * rail without the wash would say something different from the card next to
 * it. `HOT` is 1 rather than a fourth alpha because a rail at its own accent
 * IS the full-strength statement the selected state makes.
 */
export const PLATE_ROW_RAIL_HOT_ALPHA = 1;
/** The selected row's wash, and half of it for a row merely pointed at. */
export const PLATE_ROW_SELECTED_WASH_ALPHA = 0.17;
export const PLATE_ROW_HOT_WASH_ALPHA = PLATE_ROW_SELECTED_WASH_ALPHA / 2;

export interface PlateReadoutRowProps {
  /** Plate accent — the rail's colour. */
  accent: string;
  railAlpha?: number;
  label: string;
  /** Right-aligned value. A node lets a row carry a chip beside its text. */
  value: ReactNode;
  valueColor?: string;
  /** House default is the probe tier; evidence rows step down to `label`. */
  valueSize?: number;
  /** Hover provenance — defaults to the value whenever it is plain text. */
  title?: string;
  /** State chip between the label and the value, filling the middle instead
   *  of floating off at the far edge. */
  badge?: ReactNode;
  /** `data-*` attributes this dialect stamps on the row and on its value. */
  rowAttributes?: Record<string, string>;
  valueAttributes?: Record<string, string>;
  style?: CSSProperties;
  /** Caption(s) under the value. */
  children?: ReactNode;
  /** A row that DOES something when pressed — the peer card's line facts tint
   *  the tether from here. Given, the row is a `<button>` and its rail takes
   *  the hot rung under a pointer or a keyboard focus; withheld, it is the
   *  readout it has always been. The affordance is the rail, so a readout and
   *  a control are the same sentence and only one of them lights. */
  onActivate?: () => void;
  /** Pressed state, for a row that is a control. Ignored otherwise. */
  selected?: boolean;
}

export function PlateReadoutRow({
  accent,
  railAlpha = PLATE_ROW_RAIL_ALPHA,
  label,
  value,
  valueColor,
  valueSize = HUD_TYPE.value,
  title,
  badge,
  rowAttributes,
  valueAttributes,
  style,
  children,
  onActivate,
  selected = false,
}: PlateReadoutRowProps) {
  // A LEAF's state, for `CellDetailPanel`'s reason: one row re-renders on a
  // pointer move, never the plate around it. Rows that are not controls never
  // set it, so they never re-render either.
  const [hot, setHot] = useState(false);
  const lit = onActivate !== undefined && (selected || hot);
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span
          data-hud-fact-label={onActivate === undefined ? undefined : 'true'}
          style={{ flex: '0 0 auto', fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: lit ? HUD_COLORS.ink : HUD_COLORS.dim }}
        >
          {label}
        </span>
        {badge}
        <span
          {...valueAttributes}
          title={title ?? (typeof value === 'string' ? value : undefined)}
          style={{
            marginLeft: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: valueSize,
            color: valueColor ?? HUD_COLORS.ink,
          }}
        >
          {value}
        </span>
      </div>
      {children}
    </>
  );
  const frame: CSSProperties = {
    minWidth: 0,
    padding: '3px 0 4px 9px',
    borderLeft: `1px solid ${rgba(accent, lit ? PLATE_ROW_RAIL_HOT_ALPHA : railAlpha)}`,
    ...style,
  };
  if (onActivate === undefined) {
    return <div {...rowAttributes} style={frame}>{body}</div>;
  }
  return (
    <button
      type="button"
      {...rowAttributes}
      data-hud-fact-rail={hot ? 'hot' : 'true'}
      aria-pressed={selected}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      onClick={onActivate}
      style={{
        ...frame,
        display: 'block',
        width: '100%',
        margin: 0,
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
        background: lit
          ? `linear-gradient(90deg,${rgba(
            accent,
            selected ? PLATE_ROW_SELECTED_WASH_ALPHA : PLATE_ROW_HOT_WASH_ALPHA,
          )},transparent 88%)`
          : 'transparent',
        boxShadow: selected ? `-3px 0 10px ${rgba(accent, 0.22)}` : undefined,
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition: `background ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, box-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`,
      }}
    >
      {body}
    </button>
  );
}

/** A sentence under a value, in the micro tier — never a second number. The
 *  optional style is for PLACEMENT only (a caption that has to span its
 *  parent's columns or claim a flex line); the type stays the house's. */
export function PlateReadoutCaption({ tone, style, children }: {
  tone?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 2,
        fontFamily: HUD_FONTS.tech,
        fontSize: HUD_TYPE.micro,
        letterSpacing: 0.9,
        lineHeight: 1.35,
        color: tone ?? HUD_COLORS.dim,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ——— Staged reveal —————————————————————————————————————————
// A card that reveals itself does it in INK, never in layout: everything the
// walk will light is mounted at final geometry on the first frame and only
// changes opacity from there. That is what keeps the window the same size and
// in the same place while it fills — a row that mounts late is a row that
// pushed everything under it down while somebody was reading it.

/** The ghost every unreached stage wears — present, placed, and plainly not
 *  read yet. One number so no two stages can disagree about what dark means. */
export const REVEAL_GHOST_OPACITY = 0.18;

/** The style of one staged reveal step. Ghosted stages are pointer-inert:
 *  nothing under the probe can be clicked before the probe reaches it. */
export function revealStageStyle(revealed: boolean): CSSProperties {
  return {
    opacity: revealed ? 1 : REVEAL_GHOST_OPACITY,
    transition: `opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.fadeEase}`,
    pointerEvents: revealed ? 'auto' : 'none',
  };
}

/** The attributes that take a ghosted stage out of the tab order and out of
 *  the accessibility tree. `inert` does both wherever it is supported (and is
 *  spread rather than typed, since React 18's DOM types predate it);
 *  `aria-hidden` states the same thing for everything that does not. */
export function revealStageAttributes(
  revealed: boolean,
): Record<string, string> {
  return revealed ? {} : { inert: '', 'aria-hidden': 'true' };
}

/** The `LINK·05` / `SELF·04` stamp a floating card's plates count off in.
 *  Single-sourced so the two dialects and the shared dossier plate can never
 *  print their module numbers in different type. */
export function moduleTag(tag: string) {
  return (
    <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.9, color: HUD_COLORS.moduleSlate }}>
      {tag}
    </span>
  );
}

/** Header row shared by the spatial plates: EN title, CJK companion, and a
 *  right-aligned live status the caller renders (keeps its data attributes). */
export function SpatialPlateHeader({ en, cjk, accent, titleColor = HUD_COLORS.cyanInk, status, marginBottom = 7 }: {
  en: string;
  cjk?: string;
  /** Plate accent — tints the CJK companion. */
  accent: string;
  titleColor?: string;
  status?: ReactNode;
  marginBottom?: number;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '3px 7px', marginBottom }}>
      <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', color: titleColor, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.section, fontWeight: 700, letterSpacing: 1.4 }}>
        {en}
      </span>
      {cjk ? (
        <span style={{ ...CJK_BASELINE_LIFT, flex: '0 0 auto', whiteSpace: 'nowrap', color: accent, fontFamily: HUD_FONTS.cjk, fontWeight: 400, fontSize: HUD_TYPE.label, opacity: COMPANION_OPACITY }}>
          {cjk}
        </span>
      ) : null}
      {status != null ? (
        <span style={{ marginLeft: 'auto', minWidth: 0, textAlign: 'right' }}>{status}</span>
      ) : null}
    </div>
  );
}
