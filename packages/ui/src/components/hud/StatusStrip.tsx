import type { AlertLevel } from '../../derives/alertLevel';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const LEVEL_COLOR: Record<AlertLevel, string> = {
  nominal: HUD_COLORS.nominal, caution: HUD_COLORS.caution, warning: HUD_COLORS.warning,
  danger: HUD_COLORS.danger, crit: HUD_COLORS.danger,
};

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `UP ${hh}:${mm}:${ss}`;
}

export default function StatusStrip({ level, uptimeMs }: { level: AlertLevel; uptimeMs: number }) {
  const color = LEVEL_COLOR[level];
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 30, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', borderBottom: '1px solid rgba(255,152,48,.18)', background: 'linear-gradient(180deg,rgba(255,152,48,.05),transparent)' }}>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 12, letterSpacing: 5, color: HUD_COLORS.orange, textShadow: '0 0 8px rgba(255,152,48,.5)' }}>CKNERV</span>
      <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 2, color: HUD_COLORS.dim }}>OPERATION MONITOR</span>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: HUD_FONTS.tech, fontWeight: 600, fontSize: 10, letterSpacing: 2, color }}>
        <span style={{ fontFamily: HUD_FONTS.cjk, color: HUD_COLORS.dim }}>状态</span>
        <span data-dot data-level={level} style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
        {level.toUpperCase()}
      </span>
      <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 10, color: HUD_COLORS.dim, letterSpacing: 1 }}>{fmtUptime(uptimeMs)}</span>
    </div>
  );
}
