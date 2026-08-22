import type { AlertLevel } from '../../derives/alertLevel';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const SHOWN: AlertLevel[] = ['warning', 'danger', 'crit'];

export default function WarningBar({ level, trigger, reducedMotion = false, top = 30 }: { level: AlertLevel; trigger: string | null; reducedMotion?: boolean; top?: number }) {
  if (!SHOWN.includes(level)) return null;
  const color = level === 'warning' ? HUD_COLORS.warning : HUD_COLORS.danger;
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, background: level === 'crit' ? 'rgba(139,0,0,.35)' : 'rgba(0,0,0,.5)', borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}`, animation: reducedMotion ? undefined : 'cknerv-hud-flash 0.6s steps(2) infinite' }}>
      {/* No fontWeight here: the Huiwen subset ships one weight, so asking for
        * 700 only gets a synthesized bold — the browser smears the mincho
        * strokes sideways and the two glyphs lose their serifs. Weight comes
        * from the glow instead. */}
      <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 18, color, letterSpacing: 4, textShadow: `0 0 12px ${color}` }}>警告</span>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 12, letterSpacing: 3, color, textTransform: 'uppercase' }}>{(trigger ?? level).toUpperCase()}</span>
    </div>
  );
}
