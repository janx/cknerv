import type { CSSProperties } from 'react';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { ChurnRates } from '../../derives/cellChurn';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

function FlowRow({ label, color, width, value }: { label: string; color: string; width: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 16 }}>
      <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8, letterSpacing: 1, width: 54, color }}>{label}</span>
      <span style={{ flex: 1, height: 6, background: '#0a0a0a', border: '1px solid rgba(255,152,48,.12)', position: 'relative' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width, background: color, boxShadow: `0 0 7px ${color}66` }} />
      </span>
      <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 9.5, width: 30, textAlign: 'right', color }}>{value.toFixed(1)}</span>
    </div>
  );
}

export default function CellsPanel({ stats, churn, reducedMotion = false, style }: {
  stats: CellsStats;
  churn: ChurnRates;
  reducedMotion?: boolean;
  style?: CSSProperties;
}) {
  const maxRate = Math.max(churn.bornPerBlock, churn.spentPerBlock, 0.001);
  const bornW = `${Math.min(100, (churn.bornPerBlock / maxRate) * 100)}%`;
  const spentW = `${Math.min(100, (churn.spentPerBlock / maxRate) * 100)}%`;
  const netColor = churn.netPerBlock >= 0 ? HUD_COLORS.cyanWire : HUD_COLORS.caution;
  return (
    <HudPanel style={{ width: 302, ...style }}>
      <PanelHeader en="CELL MESH" cjk="神经元" idx="MESH·03" accent={HUD_COLORS.cyanWire} />
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.dim, letterSpacing: 1.2, marginBottom: 2 }}>METABOLISM · per block</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 24, color: netColor, lineHeight: 1, textShadow: `0 0 12px ${netColor}66`, animation: reducedMotion ? undefined : 'cknerv-hud-breathe 3.2s ease-in-out infinite' }}>{fmtSigned(churn.netPerBlock)}</span>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, color: HUD_COLORS.dim, marginBottom: 4 }}>net /blk</span>
      </div>
      <FlowRow label="▲ BORN" color={HUD_COLORS.nominal} width={bornW} value={churn.bornPerBlock} />
      <div style={{ height: 5 }} />
      <FlowRow label="▼ DIED" color={HUD_COLORS.danger} width={spentW} value={churn.spentPerBlock} />
      {/* `stats.live` is births minus deaths in the BACKEND'S OBSERVATION
          WINDOW — never a live-chain total. That was merely imprecise while
          nothing else on screen implied a chain-wide number; with a medium
          standing for millions of unresolved Cells beside it, an unqualified
          "Live cells" becomes actively contradictory. The whole-chain count
          lives in CELL POPULATION, under its own validated anchor. */}
      <div style={{ marginTop: 11 }}>
        <StatRow label="Observed live"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 14, color: '#fff' }}>{fmt(stats.live)}</span></StatRow>
        <StatRow label="Total observed">{fmt(stats.born)}</StatRow>
        <StatRow label="Dead" valueColor={HUD_COLORS.danger}>{fmt(stats.dead)}</StatRow>
      </div>
    </HudPanel>
  );
}
