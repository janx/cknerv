import type { CSSProperties, ReactNode } from 'react';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';

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
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 12, letterSpacing: 3, color: HUD_COLORS.orange, textTransform: 'uppercase', textShadow: '0 0 9px rgba(255,152,48,.45)' }}>{en}</span>
      <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 10, color: HUD_COLORS.orangeDeep, opacity: 0.7 }}>{cjk}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: accent ?? '#5a6470', letterSpacing: 1, textShadow: accent ? `0 0 7px ${accent}66` : undefined }}>{idx}</span>
    </div>
  );
}

export function StatRow({ label, children, valueColor, title }: {
  label: string; children: ReactNode; valueColor?: string;
  /** Hover-only provenance for rows whose source differs from the panel's own. */
  title?: string;
}) {
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'baseline', height: 17, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8.5, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 11, color: valueColor ?? HUD_COLORS.ink }}>{children}</span>
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
        fontSize: 7.5,
        letterSpacing: 1.25,
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
            fontSize: 7.5,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: accent, whiteSpace: 'nowrap' }}>{label}</span>
          {meta != null ? (
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: 7.5, letterSpacing: 0.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, marginBottom: 4, fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          <span style={{ color: accent, whiteSpace: 'nowrap' }}>{label}</span>
          {meta != null ? (
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: 7.5, letterSpacing: 0.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Gauge({ ratio, color }: { ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div style={{ height: 5, background: '#0e1a10', border: '1px solid rgba(39,255,90,.2)', position: 'relative', margin: '2px 0 3px' }}>
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
        fontFamily: HUD_FONTS.mono, fontSize: 14, lineHeight: 1, color: HUD_COLORS.dim,
      }}
    >×</span>
  );
}

// ——— Spatial instrument grammar ————————————————————————————————————————
// The scene-anchored inspection satellites speak a directional-plate dialect
// of the house language: a leading accent edge, a ~100° near-opaque gradient,
// one cut corner. Single-sourced so every plate agrees — and so the trailing
// edge can never thin out enough to let a full-brightness HUD panel print
// through the plate (the tail alpha floor is the load-bearing part: the rails
// no longer dim for an open card, so a plate may sit directly over lit text).

const SPATIAL_PLATE_CUT_PX = 12;

/** Dark tail tinted faintly toward the accent — directional, never sheer. */
export function spatialPlateTail(accent: string): string {
  const h = accent.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${Math.round(4 + r * 0.055)},${Math.round(8 + g * 0.055)},${Math.round(14 + b * 0.055)},0.95)`;
}

export function spatialPlateBackground(accent: string): string {
  return `linear-gradient(100deg,rgba(2,5,12,.985),rgba(3,8,17,.965) 72%,${spatialPlateTail(accent)})`;
}

export function spatialPlate(accent: string): CSSProperties {
  return {
    borderLeft: `1px solid ${rgba(accent, 0.46)}`,
    borderTop: `1px solid ${rgba(accent, 0.15)}`,
    borderBottom: `1px solid ${rgba(accent, 0.09)}`,
    background: spatialPlateBackground(accent),
    clipPath: `polygon(0 0,calc(100% - ${SPATIAL_PLATE_CUT_PX}px) 0,100% ${SPATIAL_PLATE_CUT_PX}px,100% 100%,0 100%)`,
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

/** The `LINK·05` / `SELF·04` stamp a floating card's plates count off in.
 *  Single-sourced so the two dialects and the shared dossier plate can never
 *  print their module numbers in different type. */
export function moduleTag(tag: string) {
  return (
    <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 1, color: '#5a6470' }}>
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
      <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', color: titleColor, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.section, fontWeight: 700, letterSpacing: 1.35 }}>
        {en}
      </span>
      {cjk ? (
        <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', color: accent, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
          {cjk}
        </span>
      ) : null}
      {status != null ? (
        <span style={{ marginLeft: 'auto', minWidth: 0, textAlign: 'right' }}>{status}</span>
      ) : null}
    </div>
  );
}
