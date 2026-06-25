import type { CSSProperties } from 'react';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { Gauge } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BackfillBar({ backfill, style }: {
  backfill: { done: number; total: number } | null; style?: CSSProperties;
}) {
  if (!backfill || backfill.total <= 0) return null;
  const { done, total } = backfill;
  return (
    <div style={{ position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)', width: 280, padding: '8px 12px', background: HUD_COLORS.panel, border: '1px solid rgba(255,152,48,.2)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 10, letterSpacing: 2, color: HUD_COLORS.orange, textTransform: 'uppercase' }}>SEEDING LIVE CELLS</span>
        <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 9, color: HUD_COLORS.orangeDeep }}>播种</span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 9, color: HUD_COLORS.dim }}>{fmt(done)} / {fmt(total)} blocks</span>
      </div>
      <Gauge ratio={done / total} color={HUD_COLORS.orange} />
    </div>
  );
}
