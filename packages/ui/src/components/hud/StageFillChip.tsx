import type { CSSProperties } from 'react';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { Gauge, PLATE_CUT_CLIP } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * The boot readout's tail — a QUIET disclosure that the stage is still
 * composing (server restore / convergence landing after the page booted),
 * so the Cells and nerves sprouting right now are named rather than
 * unexplained. `boot/stageFill.ts` decides when this exists; this file is
 * only the form.
 *
 * Deliberately one register below `BackfillBar`: same floating plate shape
 * (single top-right cut, accent left rail), but a single row, narrower, and
 * spoken in the wire cyan of ordinary readouts — composition is the organism
 * living, not a fault, and nothing here may shout over one.
 */
export default function StageFillChip({ staged, budget, style }: {
  staged: number | null;
  budget: number | null;
  style?: CSSProperties;
}) {
  if (staged === null || budget === null || budget <= 0) return null;
  const ratio = Math.min(1, Math.max(0, staged / budget));
  const color = HUD_COLORS.cyanWire;
  return (
    <div
      role="status"
      aria-live="polite"
      data-stage-fill-chip
      style={{
        position: 'absolute',
        top: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(264px, calc(100vw - 24px))',
        boxSizing: 'border-box',
        padding: '7px 12px 8px',
        background: `linear-gradient(90deg,${rgba(color, 0.07)},${HUD_COLORS.panel} 34%,${rgba(HUD_COLORS.ground, 0.6)})`,
        border: `1px solid ${rgba(color, 0.22)}`,
        borderLeft: `3px solid ${rgba(color, 0.6)}`,
        clipPath: PLATE_CUT_CLIP,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 5 }}>
        <span aria-hidden style={{ color: rgba(color, 0.7), fontSize: HUD_TYPE.label }}>◇</span>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: HUD_TYPE.label, letterSpacing: 1.4, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
          Stage composing
        </span>
        {/* No tracking on the counted form — one measurement, not two words. */}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0, color }}>
          {`${fmt(staged)} / ${fmt(budget)}`}
        </span>
      </div>
      <Gauge ratio={ratio} color={color} />
    </div>
  );
}
