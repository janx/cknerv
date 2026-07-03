import type { CSSProperties, ReactNode } from 'react';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

export function HudPanel({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', padding: '13px 15px', background: HUD_COLORS.panel, ...style }}>
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

export function PanelHeader({ en, cjk, idx, accent }: {
  en: string; cjk: string; idx: string;
  /** Mesh identity color — tints the index tag. */
  accent?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 12, letterSpacing: 3, color: HUD_COLORS.orange, textTransform: 'uppercase', textShadow: '0 0 9px rgba(255,152,48,.45)' }}>{en}</span>
      <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 10, color: HUD_COLORS.orangeDeep, opacity: 0.7 }}>{cjk}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: accent ?? '#5a6470', letterSpacing: 1, textShadow: accent ? `0 0 7px ${accent}66` : undefined }}>{idx}</span>
    </div>
  );
}

export function StatRow({ label, children, valueColor }: { label: string; children: ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', height: 17, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8.5, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 11, color: valueColor ?? HUD_COLORS.ink }}>{children}</span>
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

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <span
      role="button"
      aria-label="close"
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
