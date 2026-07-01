import { useState } from 'react';
import type { AlertLevel } from '../../derives/alertLevel';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

export type BuildInfo = { version: string; href: string };

const LEVEL_COLOR: Record<AlertLevel, string> = {
  nominal: HUD_COLORS.nominal, syncing: HUD_COLORS.cyanWire, caution: HUD_COLORS.caution,
  warning: HUD_COLORS.warning, danger: HUD_COLORS.danger, crit: HUD_COLORS.danger,
};

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `UP ${hh}:${mm}:${ss}`;
}

// Build tag rendered as a hairline capsule right after the wordmark. `version`
// is opaque (built in ui-app); we split on the first `@` only for two-tone
// display — the leading segment reads bright, the `@…` tail dim — and fall back
// to a single bright run when there's no `@`. The whole capsule is a commit
// deep-link that warms to an orange glow on hover.
function BuildChip({ build }: { build: BuildInfo }) {
  const [hot, setHot] = useState(false);
  const at = build.version.indexOf('@');
  const head = at >= 0 ? build.version.slice(0, at) : build.version;
  const tail = at >= 0 ? build.version.slice(at) : '';
  return (
    <a
      href={build.href}
      target="_blank"
      rel="noreferrer"
      aria-label={build.version}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 8px', borderRadius: 999,
        border: `1px solid ${rgba(HUD_COLORS.orange, hot ? 0.55 : 0.22)}`,
        background: rgba(HUD_COLORS.orange, hot ? 0.1 : 0.045),
        boxShadow: hot ? `0 0 10px ${rgba(HUD_COLORS.orange, 0.35)}` : 'none',
        fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.5, lineHeight: 1,
        textDecoration: 'none', pointerEvents: 'auto',
        transition: 'border-color .18s, background .18s, box-shadow .18s',
      }}
    >
      <span style={{ color: hot ? HUD_COLORS.orange : HUD_COLORS.ink, textShadow: hot ? `0 0 6px ${rgba(HUD_COLORS.orange, 0.5)}` : 'none', transition: 'color .18s, text-shadow .18s' }}>{head}</span>
      {tail ? <span style={{ color: hot ? rgba(HUD_COLORS.orange, 0.6) : HUD_COLORS.dim, transition: 'color .18s' }}>{tail}</span> : null}
    </a>
  );
}

export default function StatusStrip({ level, uptimeMs, build }: { level: AlertLevel; uptimeMs: number; build?: BuildInfo }) {
  const color = LEVEL_COLOR[level];
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 30, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', borderBottom: '1px solid rgba(255,152,48,.18)', background: 'linear-gradient(180deg,rgba(255,152,48,.05),transparent)' }}>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 12, letterSpacing: 5, color: HUD_COLORS.orange, textShadow: '0 0 8px rgba(255,152,48,.5)' }}>CKNERV</span>
      {build ? <BuildChip build={build} /> : null}
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
