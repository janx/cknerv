import type { CSSProperties, ReactNode } from 'react';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';

/** The band's height, and the offset every consumer below it adds. Exported
 *  because `HudOverlay` stacks the alarm on top of a band and both numbers
 *  have to be the same 30. */
export const TOP_BAND_HEIGHT = 30;

/** The house mark for a band reporting on something still in progress: the
 *  static shell opens with it, so does `BackfillBar`, and so does every tenant
 *  here. */
export const TOP_BAND_GLYPH = '◇';

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
 * cannot own is the shape: no brackets, no cut corner, the viewport ends it,
 * and the status strip above draws its top edge — this is the frame itself
 * speaking, not a card anybody opened (`primitives.tsx` argues the grammar).
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
    width: `${Math.max(0, Math.min(1, fill)) * 100}%`,
    background: accent,
    boxShadow: `0 0 8px ${accent}`,
  };
  return (
    <div
      role="status"
      aria-live="polite"
      {...attrs}
      style={{
        position: 'absolute',
        zIndex: 3,
        top,
        left: 0,
        right: 0,
        height: TOP_BAND_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: `linear-gradient(90deg,transparent,${rgba(accent, 0.13)} 28%,${rgba(HUD_COLORS.ground, 0.78)} 50%,${rgba(accent, 0.13)} 72%,transparent)`,
        borderBottom: `1px solid ${rgba(accent, 0.45)}`,
        color: accent,
        animation,
      }}
    >
      <span aria-hidden style={{ fontSize: HUD_TYPE.label }}>{TOP_BAND_GLYPH}</span>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.section, letterSpacing: 2 }}>
        {title}
      </span>
      {children}
      {/* The progress mark, and the whole of it: the band's own edge thickening
          and lighting up. A tenant that needs to show how far along it is gets
          this and not a plate with a gauge in it — one slot, one object, and an
          object does not sprout a second kind of body to carry a number. */}
      {bar ? <span aria-hidden data-top-band-fill style={bar} /> : null}
    </div>
  );
}
