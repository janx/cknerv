import type { CSSProperties, ReactNode } from 'react';
import { CJK_BASELINE_LIFT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';

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
      <span style={{ ...CJK_BASELINE_LIFT, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.section, color: HUD_COLORS.orangeDeep, opacity: 0.7 }}>{cjk}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: accent ?? HUD_COLORS.moduleSlate, letterSpacing: 0.9, textShadow: accent ? `0 0 7px ${accent}66` : undefined }}>{idx}</span>
    </div>
  );
}

/** A label and the figure it names. A rail row carries no CJK companion: it is
 *  read for its NUMBER, and a word standing between the label and the figure is
 *  one more thing to read past on every glance. The unit's Chinese name lives
 *  on the dossier's `CKBYTE` zone, where naming the unit IS the subject. */
export function StatRow({ label, children, valueColor, title }: {
  label: string; children: ReactNode; valueColor?: string;
  /** Hover-only provenance for rows whose source differs from the panel's own. */
  title?: string;
}) {
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'baseline', height: 17, whiteSpace: 'nowrap' }}>
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

/** One step in a base-to-enhanced information scope. The rail makes source
 * expansion read as one hierarchy instead of independent panels stacked
 * together. */
export function ScopeStage({ id, label, meta, accent, terminal = false, flush = false, style, children }: {
  id: string;
  label: string;
  meta?: ReactNode;
  accent: string;
  terminal?: boolean;
  /** Keep headings and values on the parent panel's columns. The scope rail is
   * drawn just outside the content instead of consuming an inset column. */
  flush?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (flush) {
    return (
      <div
        data-scope-stage={id}
        data-scope-layout="flush"
        style={{ position: 'relative', paddingBottom: terminal ? 0 : 9, ...style }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -8,
            top: 4,
            width: 5,
            height: 5,
            border: `1px solid ${accent}`,
            background: rgba(accent, 0.18),
            boxShadow: `0 0 6px ${rgba(accent, 0.55)}`,
            transform: 'rotate(45deg)',
          }}
        />
        {!terminal ? (
          <span
            data-scope-connector
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: -5.5,
              top: 12,
              bottom: -1,
              width: 1,
              background: `linear-gradient(180deg,${rgba(accent, 0.55)},${rgba(accent, 0.1)})`,
            }}
          />
        ) : null}
        <div
          data-scope-header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            minWidth: 0,
            marginBottom: 4,
            fontFamily: HUD_FONTS.tech,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: accent, whiteSpace: 'nowrap' }}>{label}</span>
          {meta != null ? (
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta}
            </span>
          ) : null}
        </div>
        <div data-scope-content style={{ minWidth: 0 }}>{children}</div>
      </div>
    );
  }

  return (
    <div
      data-scope-stage={id}
      style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr)', columnGap: 7, ...style }}
    >
      <span aria-hidden="true" style={{ position: 'relative', minHeight: 18 }}>
        <span style={{ position: 'absolute', left: 2, top: 5, width: 5, height: 5, border: `1px solid ${accent}`, background: rgba(accent, 0.18), boxShadow: `0 0 6px ${rgba(accent, 0.55)}`, transform: 'rotate(45deg)' }} />
        {!terminal ? (
          <span data-scope-connector style={{ position: 'absolute', left: 4.5, top: 12, bottom: -8, width: 1, background: `linear-gradient(180deg,${rgba(accent, 0.55)},${rgba(accent, 0.1)})` }} />
        ) : null}
      </span>
      <div style={{ minWidth: 0, paddingBottom: terminal ? 0 : 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, marginBottom: 4, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          <span style={{ color: accent, whiteSpace: 'nowrap' }}>{label}</span>
          {meta != null ? (
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta}
            </span>
          ) : null}
        </div>
        {children}
      </div>
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

export function CloseButton({ onClose, title }: { onClose: () => void; title?: string }) {
  return (
    <span
      role="button"
      aria-label="close"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.color = HUD_COLORS.danger; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.color = HUD_COLORS.dim; }}
      style={{
        position: 'absolute', top: 6, right: 11, cursor: 'pointer', pointerEvents: 'auto',
        fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.emphasis, lineHeight: 1, color: HUD_COLORS.dim,
      }}
    >×</span>
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

/** Dark tail tinted faintly toward the accent — directional, never sheer. */
export function spatialPlateTail(accent: string): string {
  const h = accent.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${Math.round(4 + r * 0.055)},${Math.round(8 + g * 0.055)},${Math.round(14 + b * 0.055)},0.95)`;
}

export function spatialPlateBackground(accent: string): string {
  return `linear-gradient(100deg,${rgba(HUD_COLORS.stageGround, 0.985)},${rgba(HUD_COLORS.stageGround, 0.965)} 72%,${spatialPlateTail(accent)})`;
}

export function spatialPlate(accent: string): CSSProperties {
  return {
    borderLeft: `1px solid ${rgba(accent, 0.46)}`,
    borderTop: `1px solid ${rgba(accent, 0.15)}`,
    borderBottom: `1px solid ${rgba(accent, 0.09)}`,
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
}: PlateReadoutRowProps) {
  return (
    <div
      {...rowAttributes}
      style={{
        minWidth: 0,
        padding: '3px 0 4px 9px',
        borderLeft: `1px solid ${rgba(accent, railAlpha)}`,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ flex: '0 0 auto', fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
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
    </div>
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
    transition: 'opacity 260ms ease',
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
        <span style={{ ...CJK_BASELINE_LIFT, flex: '0 0 auto', whiteSpace: 'nowrap', color: accent, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
          {cjk}
        </span>
      ) : null}
      {status != null ? (
        <span style={{ marginLeft: 'auto', minWidth: 0, textAlign: 'right' }}>{status}</span>
      ) : null}
    </div>
  );
}
