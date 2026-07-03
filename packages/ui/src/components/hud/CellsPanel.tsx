import type { CSSProperties } from 'react';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { ChurnRates } from '../../derives/cellChurn';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

function formatStateBytes(shannons: number): string {
  const b = shannons / 1e8; // 1 CKByte of capacity = 1 byte of on-chain state
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${Math.round(b)} B`;
}

type Bucket = { key: string; label: string; color: string; count: number };

function TaxonomyBar({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total <= 0) return null;
  const nonZero = buckets.filter((b) => b.count > 0);
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.5, color: '#6b7f8e', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', height: 6, border: '1px solid rgba(255,152,48,.2)', background: '#0a0a0a' }}>
        {buckets.map((b) => b.count > 0 ? <span key={b.key} style={{ width: `${(b.count / total) * 100}%`, background: b.color }} /> : null)}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#9fb0bd', marginTop: 3, lineHeight: 1.5 }}>
        {nonZero.map((b) => `${b.label} ${Math.round((b.count / total) * 100)}%`).join(' · ')}
      </div>
    </div>
  );
}

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
  stats: CellsStats; churn: ChurnRates; reducedMotion?: boolean; style?: CSSProperties;
}) {
  const maxRate = Math.max(churn.bornPerBlock, churn.spentPerBlock, 0.001);
  const bornW = `${Math.min(100, (churn.bornPerBlock / maxRate) * 100)}%`;
  const spentW = `${Math.min(100, (churn.spentPerBlock / maxRate) * 100)}%`;
  const netColor = churn.netPerBlock >= 0 ? HUD_COLORS.cyanWire : HUD_COLORS.caution;
  return (
    <HudPanel style={{ width: 248, ...style }}>
      <PanelHeader en="CELL MESH" cjk="细胞" idx="MESH·03" accent={HUD_COLORS.cyanWire} sig="cell" />
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.dim, letterSpacing: 1.2, marginBottom: 2 }}>METABOLISM · per block</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 24, color: netColor, lineHeight: 1, textShadow: `0 0 12px ${netColor}66`, animation: reducedMotion ? undefined : 'cknerv-hud-breathe 3.2s ease-in-out infinite' }}>{fmtSigned(churn.netPerBlock)}</span>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 9, color: HUD_COLORS.dim, marginBottom: 4 }}>net /blk</span>
      </div>
      <FlowRow label="▲ BORN" color={HUD_COLORS.nominal} width={bornW} value={churn.bornPerBlock} />
      <div style={{ height: 5 }} />
      <FlowRow label="▼ DIED" color={HUD_COLORS.danger} width={spentW} value={churn.spentPerBlock} />
      <div style={{ marginTop: 11 }}>
        <StatRow label="Live cells"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 14, color: '#fff' }}>{fmt(stats.live)}</span></StatRow>
        <StatRow label="Total observed">{fmt(stats.born)}</StatRow>
        <StatRow label="Dead" valueColor={HUD_COLORS.danger}>{fmt(stats.dead)}</StatRow>
      </div>
      <div style={{ marginTop: 11, paddingTop: 9, borderTop: '1px solid rgba(255,152,48,.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.5, color: '#5f7384', textTransform: 'uppercase', marginBottom: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: HUD_COLORS.cyanWire, boxShadow: `0 0 6px ${HUD_COLORS.cyanWire}` }} />
          In view · {fmt(stats.inView)} cells
        </div>
        <StatRow label="Capacity">{formatStateBytes(stats.capacityShannons)} state</StatRow>
        <TaxonomyBar title="ASSETS" buckets={[
          { key: 'native', label: 'CKB', color: HUD_COLORS.cyanWire, count: stats.byAsset.native },
          { key: 'sudt', label: 'sUDT', color: HUD_COLORS.orange, count: stats.byAsset.sudt },
          { key: 'xudt', label: 'xUDT', color: '#ffb84d', count: stats.byAsset.xudt },
          { key: 'dao', label: 'DAO', color: HUD_COLORS.caution, count: stats.byAsset.dao },
          { key: 'spore', label: 'NFT', color: '#9d7bd8', count: stats.byAsset.spore },
          { key: 'other', label: '?', color: '#33424f', count: stats.byAsset.other },
        ]} />
        <TaxonomyBar title="LOCKS" buckets={[
          { key: 'sighash', label: 'sighash', color: HUD_COLORS.cyanWire, count: stats.byLock.sighash },
          { key: 'multisig', label: 'multisig', color: HUD_COLORS.orange, count: stats.byLock.multisig },
          { key: 'acp', label: 'ACP', color: HUD_COLORS.caution, count: stats.byLock.acp },
          { key: 'omnilock', label: 'omni', color: '#9d7bd8', count: stats.byLock.omnilock },
          { key: 'other', label: '?', color: '#33424f', count: stats.byLock.other },
        ]} />
      </div>
    </HudPanel>
  );
}
