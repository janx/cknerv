import type { CSSProperties } from 'react';
import type { NetworkSummary } from '../../derives/peers.derive';
import type { FleetConsensus, PingStats, VersionSpread } from '../../derives/fleetTelemetry';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, Gauge } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function NetworkPanel({ summary, consensus, ping, vers, syncRatio, colonyCount, style }: {
  summary: NetworkSummary; consensus: FleetConsensus; ping: PingStats | null; vers: VersionSpread; syncRatio: number;
  /** Whole-colony node count (measured + inferred + local) for the honest
   *  "inferred" footnote below the measured stats. Omitted ⇒ line not shown. */
  colonyCount?: number; style?: CSSProperties;
}) {
  const total = Math.max(1, consensus.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <HudPanel style={{ width: 302, paddingTop: 14, ...style }}>
      <PanelHeader en="PEER MESH" cjk="全节点网络" idx="MESH·02" accent={HUD_COLORS.peerWire} />
      <StatRow label="Peers"><span style={{ color: HUD_COLORS.peerWire }}>{summary.peerCount}</span> &nbsp; <span style={{ color: HUD_COLORS.dim }}>out</span> {summary.outbound} / <span style={{ color: HUD_COLORS.dim }}>in</span> {summary.inbound}</StatRow>
      <StatRow label="Head consensus">{consensus.atTip} / {consensus.total}</StatRow>
      <div style={{ display: 'flex', height: 7, border: '1px solid rgba(255,152,48,.2)', background: '#0a0a0a', margin: '4px 0' }}>
        <span style={{ width: seg(consensus.atTip), background: HUD_COLORS.nominal, boxShadow: '0 0 7px rgba(39,255,90,.55)' }} />
        <span style={{ width: seg(consensus.behind), background: HUD_COLORS.dim }} />
        <span style={{ width: seg(consensus.ahead), background: HUD_COLORS.caution }} />
      </div>
      <div style={{ display: 'flex', gap: 11, fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 0.4, marginBottom: 8 }}>
        <span style={{ color: HUD_COLORS.nominal }}>▲{consensus.atTip} at-tip</span>
        <span style={{ color: HUD_COLORS.dim }}>{consensus.behind} behind</span>
        <span style={{ color: HUD_COLORS.caution }}>{consensus.ahead} ahead</span>
        <span style={{ marginLeft: 'auto', color: '#5a6470' }}>#{fmt(summary.bestKnown)}</span>
      </div>
      <StatRow label="Sync ratio">{(syncRatio * 100).toFixed(1)}%</StatRow>
      <Gauge ratio={syncRatio} color={HUD_COLORS.nominal} />
      <StatRow label="Version">{vers.majorityVersion} ×{vers.majorityCount}{vers.otherCount > 0 ? ` · ×${vers.otherCount} other` : ''}</StatRow>
      <StatRow label="Ping">{ping ? `${ping.medianMs}ms med · ${ping.minMs}–${ping.maxMs}` : '—'}</StatRow>
      <StatRow label="Best">#{fmt(summary.bestKnown)}</StatRow>
      {colonyCount != null && (
        <div style={{ marginTop: 5, fontFamily: HUD_FONTS.mono, fontSize: 8.5, letterSpacing: 0.4, color: HUD_COLORS.peerWire, opacity: 0.85 }}>
          colony ~ {fmt(colonyCount)} nodes (inferred)
        </div>
      )}
    </HudPanel>
  );
}
