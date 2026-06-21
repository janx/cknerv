import type { CSSProperties } from 'react';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { formatCommonKnowledgeBytes } from '../CellsHud';
import { umbrellaWedges } from '../../derives/umbrellaGauge';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');
const KINDS: Array<[keyof CellsStats['byKind'], string]> = [['wallet', 'Wallet'], ['dex', 'Dex'], ['cf', 'CF'], ['ckbloom', 'Ckbloom'], ['generic', 'Generic']];

function UmbrellaGauge({ aliveRatio }: { aliveRatio: number }) {
  const { paths, litCount } = umbrellaWedges(aliveRatio);
  return (
    <svg viewBox="0 0 100 100" width={74} height={74} style={{ flex: '0 0 74px', filter: 'drop-shadow(0 0 6px rgba(255,48,48,.25))' }}>
      {paths.map((d, i) => {
        const lit = i < litCount;
        const fill = i % 2 === 0 ? (lit ? HUD_COLORS.danger : '#3a0d0d') : (lit ? '#f4f4f4' : '#2a2a2a');
        return <path key={i} d={d} fill={fill} stroke="#000" strokeWidth={1} />;
      })}
      <circle cx={50} cy={50} r={7} fill="#0a0a0a" stroke={HUD_COLORS.danger} strokeWidth={1.4} />
    </svg>
  );
}

export default function CellsUmbrella({ stats, style }: { stats: CellsStats; style?: CSSProperties }) {
  const totalSeen = stats.live + stats.dead;
  const aliveRatio = totalSeen > 0 ? stats.live / totalSeen : 0;
  return (
    <HudPanel style={{ width: 230, ...style }}>
      <PanelHeader en="CELLS" cjk="细胞" idx="BIO-03" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 11 }}>
        <UmbrellaGauge aliveRatio={aliveRatio} />
        <div>
          <div style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 21, color: '#fff', lineHeight: 1 }}>{fmt(stats.born)}</div>
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, color: HUD_COLORS.dim, marginTop: 3 }}>TOTAL OBSERVED</div>
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, marginTop: 3, color: HUD_COLORS.nominal }}>▲ {fmt(stats.live)} ALIVE</div>
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, color: HUD_COLORS.danger }}>▼ {fmt(stats.dead)} DEAD</div>
        </div>
      </div>
      <div style={{ paddingTop: 9, borderTop: '1px solid rgba(255,152,48,.12)' }}>
        {KINDS.filter(([k]) => k !== 'generic' || stats.byKind.generic > 0).map(([k, label]) => (
          <StatRow key={k} label={label}>{fmt(stats.byKind[k])}</StatRow>
        ))}
        <StatRow label="Knowledge">{formatCommonKnowledgeBytes(stats.capacityShannons)}</StatRow>
      </div>
    </HudPanel>
  );
}
