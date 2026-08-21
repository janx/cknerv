import type { CSSProperties } from 'react';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import type { NetworkSummary } from '../../derives/peers.derive';
import type { FleetConsensus, PingStats, VersionSpread } from '../../derives/fleetTelemetry';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, ScopeStage, StatRow, Gauge } from './primitives';
import NetworkAtlasReadout from './NetworkAtlasReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

function LocalPeerDetails({ ping, vers, embedded = false }: {
  ping: PingStats | null;
  vers: VersionSpread;
  embedded?: boolean;
}) {
  const version = <>{vers.majorityVersion} ×{vers.majorityCount}{vers.otherCount > 0 ? ` · ×${vers.otherCount} other` : ''}</>;
  const latency = ping ? `${ping.medianMs}ms med · ${ping.minMs}–${ping.maxMs}` : '—';
  if (embedded) {
    return (
      <div aria-label="Direct peer details" data-network-local-context>
        <StatRow label="Client">{version}</StatRow>
        <StatRow label="Peer RTT">{latency}</StatRow>
      </div>
    );
  }
  return (
    <section data-network-detail-mode="local" aria-label="Direct peer details">
      <StatRow label="Version">{version}</StatRow>
      <StatRow label="Ping">{latency}</StatRow>
    </section>
  );
}

// MESH·02 reports the network, never the scene: every number here is either
// measured by the local node or indexed by the crawler. The colony count the
// stage draws (measured peers + inferred ghosts + us) is a rendering fact and
// lives with the other stage readouts, in STAGE·07.
export default function NetworkPanel({ summary, consensus, ping, vers, syncRatio, enrichmentSource, networkAtlas, style }: {
  summary: NetworkSummary; consensus: FleetConsensus; ping: PingStats | null; vers: VersionSpread; syncRatio: number;
  enrichmentSource?: EnrichmentSourceStatus;
  networkAtlas?: NetworkAtlasRecord | null;
  style?: CSSProperties;
}) {
  const total = Math.max(1, consensus.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <HudPanel style={{ width: 302, paddingTop: 14, ...style }}>
      <PanelHeader en="PEER MESH" cjk="节点场" idx="MESH·02" accent={HUD_COLORS.peerWire} />
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
      <NetworkAtlasReadout
        source={enrichmentSource}
        record={networkAtlas}
        fallback={<LocalPeerDetails ping={ping} vers={vers} />}
        localContext={(
          <ScopeStage
            id="local-node"
            label="LOCAL NODE VIEW"
            meta="DIRECT CKB"
            accent={HUD_COLORS.peerWire}
          >
            <LocalPeerDetails ping={ping} vers={vers} embedded />
          </ScopeStage>
        )}
      />
    </HudPanel>
  );
}
