import type { CSSProperties } from 'react';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import type { NetworkSummary } from '../../derives/peers.derive';
import type { FleetConsensus } from '../../derives/fleetTelemetry';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import NetworkAtlasReadout from './NetworkAtlasReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

// Our catch-up is status by exception: at the tip `syncRatio` is a permanently
// full gauge that reports nothing the head-consensus bar has not already said,
// so the row exists only below this. Proportional, so the one-block gap between
// arrivals never trips it while a real backlog always does.
const AT_TIP_SYNC_RATIO = 0.999;

// MESH·02 reports the network, never the scene: every number here is either
// measured by the local node or indexed by the crawler. The colony count the
// stage draws (measured peers + inferred ghosts + us) is a rendering fact and
// lives with the other stage readouts, in STAGE·07.
//
// It reports the fleet, never one peer. Per-peer client version and RTT are on
// the floating PEER card and the reference version is on the NODE card, so a
// rail aggregate of the same two numbers was only duplicate telemetry.
export default function NetworkPanel({ summary, consensus, syncRatio, enrichmentSource, networkAtlas, style }: {
  summary: NetworkSummary; consensus: FleetConsensus; syncRatio: number;
  enrichmentSource?: EnrichmentSourceStatus;
  networkAtlas?: NetworkAtlasRecord | null;
  style?: CSSProperties;
}) {
  const total = Math.max(1, consensus.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <HudPanel watermark="节点场" style={{ width: 302, paddingTop: 14, ...style }}>
      <PanelHeader en="PEER MESH" cjk="节点场" idx="MESH·02" accent={HUD_COLORS.peerWire} />
      <StatRow label="Peers"><span style={{ color: HUD_COLORS.peerWire }}>{summary.peerCount}</span> &nbsp; <span style={{ color: HUD_COLORS.dim }}>out</span> {summary.outbound} / <span style={{ color: HUD_COLORS.dim }}>in</span> {summary.inbound}</StatRow>
      <StatRow label="Head consensus">{consensus.atTip} / {consensus.total}</StatRow>
      <div style={{ display: 'flex', height: 7, border: '1px solid rgba(255,152,48,.2)', background: HUD_COLORS.trackGround, margin: '4px 0' }}>
        <span style={{ width: seg(consensus.atTip), background: HUD_COLORS.nominal, boxShadow: '0 0 7px rgba(39,255,90,.55)' }} />
        <span style={{ width: seg(consensus.behind), background: HUD_COLORS.dim }} />
        <span style={{ width: seg(consensus.ahead), background: HUD_COLORS.caution }} />
      </div>
      <div style={{ display: 'flex', gap: 11, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.35, marginBottom: 8 }}>
        <span style={{ color: HUD_COLORS.nominal }}>▲{consensus.atTip} at-tip</span>
        <span style={{ color: HUD_COLORS.dim }}>{consensus.behind} behind</span>
        <span style={{ color: HUD_COLORS.caution }}>{consensus.ahead} ahead</span>
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.moduleSlate }}>#{fmt(summary.bestKnown)}</span>
      </div>
      {syncRatio < AT_TIP_SYNC_RATIO ? (
        <div data-network-sync="catching-up">
          <StatRow label="Syncing" valueColor={HUD_COLORS.caution}>{(syncRatio * 100).toFixed(1)}% of #{fmt(summary.bestKnown)}</StatRow>
          <div style={{ height: 4, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.caution, 0.22)}`, margin: '2px 0 4px' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, syncRatio) * 100}%`, background: HUD_COLORS.caution, boxShadow: `0 0 6px ${rgba(HUD_COLORS.caution, 0.5)}` }} />
          </div>
        </div>
      ) : null}
      <NetworkAtlasReadout source={enrichmentSource} record={networkAtlas} />
    </HudPanel>
  );
}
