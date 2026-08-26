import type { CSSProperties } from 'react';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import type { NetworkSummary } from '../../derives/peers.derive';
import type { FleetConsensus } from '../../derives/fleetTelemetry';
import type { BlockProducerView } from '../../derives/blockProducers.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { DirectionMark, HudPanel, PanelHeader, StatRow } from './primitives';
import { producerFleetText } from './producerReadout';
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
export default function NetworkPanel({ summary, consensus, syncRatio, enrichmentSource, networkAtlas, producers, style }: {
  summary: NetworkSummary; consensus: FleetConsensus; syncRatio: number;
  enrichmentSource?: EnrichmentSourceStatus;
  networkAtlas?: NetworkAtlasRecord | null;
  /** Who has been making this network's blocks lately, off the chain itself.
   *  Absent only when the window contradicts itself — the derive refuses a
   *  window whose numerators do not add up to it — and a refusal prints
   *  nothing rather than a partial truth. */
  producers?: BlockProducerView | null;
  style?: CSSProperties;
}) {
  const total = Math.max(1, consensus.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <HudPanel watermark="节点场" style={{ width: 302, paddingTop: 14, ...style }}>
      <PanelHeader en="PEER MESH" cjk="节点场" idx="MESH·02" accent={HUD_COLORS.peerWire} />
      {/* The link-direction pair reads as `OUT n / IN n`, which is how
        * `NodeSelfCard` states the identical reading and how every other
        * legend in the HUD states any reading. This panel was the only surface
        * in the overlay that spoke lowercase, and it did it directly under its
        * own uppercase `StatRow` labels — five authored words (`out`, `in`,
        * and the three consensus tallies below) that read as a different
        * instrument's captions in the middle of this one's. */}
      <StatRow label="Peers"><span style={{ color: HUD_COLORS.peerWire }}>{summary.peerCount}</span> &nbsp; <span style={{ color: HUD_COLORS.dim }}>OUT</span> {summary.outbound} / <span style={{ color: HUD_COLORS.dim }}>IN</span> {summary.inbound}</StatRow>
      <StatRow label="Head consensus">{consensus.atTip} / {consensus.total}</StatRow>
      <div style={{ display: 'flex', height: 7, border: `1px solid ${rgba(HUD_COLORS.orange, 0.2)}`, background: HUD_COLORS.trackGround, margin: '4px 0' }}>
        <span style={{ width: seg(consensus.atTip), background: HUD_COLORS.nominal, boxShadow: `0 0 7px ${rgba(HUD_COLORS.nominal, 0.55)}` }} />
        <span style={{ width: seg(consensus.behind), background: HUD_COLORS.dim }} />
        <span style={{ width: seg(consensus.ahead), background: HUD_COLORS.caution }} />
      </div>
      <div style={{ display: 'flex', gap: 11, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.35, marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: HUD_COLORS.nominal }}>
          <DirectionMark direction="up" color={HUD_COLORS.nominal} size={4.5} />
          {consensus.atTip} AT-TIP
        </span>
        <span style={{ color: HUD_COLORS.dim }}>{consensus.behind} BEHIND</span>
        <span style={{ color: HUD_COLORS.caution }}>{consensus.ahead} AHEAD</span>
        {/* The height the three tallies are counted against — a reading, and
          * the only unqualified figure in the row. It was painted
          * `moduleSlate`, the module registry's grey, which the palette puts
          * below `dim` on purpose because a tag is an address and not a
          * reading. `dim` is spoken for one span to the left by the `behind`
          * tally, so plain ink is what is left and what this is. */}
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink }}>#{fmt(summary.bestKnown)}</span>
      </div>
      {syncRatio < AT_TIP_SYNC_RATIO ? (
        <div data-network-sync="catching-up">
          <StatRow label="Syncing" valueColor={HUD_COLORS.caution}>{(syncRatio * 100).toFixed(1)}% of #{fmt(summary.bestKnown)}</StatRow>
          <div style={{ height: 4, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.caution, 0.22)}`, margin: '2px 0 4px' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, syncRatio) * 100}%`, background: HUD_COLORS.caution, boxShadow: `0 0 6px ${rgba(HUD_COLORS.caution, 0.5)}` }} />
          </div>
        </div>
      ) : null}
      {/* Who is making the blocks. A fact about the NETWORK, read off the
        * chain by the local node and owed to nothing the crawler did — so it
        * stands above the atlas, on the near side of this panel's one line
        * between what the network is and what this crawl saw.
        *
        * ⚠️ ONE ROW, AND THE HEIGHT IS THE ARGUMENT. This panel was cut by 53%
        * when five StatRows became a bar, and that saving is not this feature's
        * to spend: a producer bar here would redraw the same ranking the colony
        * already draws as ring radii, one instrument away from the rings.
        *
        * The share and the window arrive as ONE string from one formatter, so
        * there is no arrangement of this row that prints a top share without
        * the window it is a share of. */}
      {producers ? (
        <div data-network-producers>
          <StatRow
            label="Producers"
            title="Distinct payout identities in the recent block window, read from each block's cellbase witness. Counted by payout identity, which may be one pool running many machines."
          >
            {producerFleetText(producers)}
          </StatRow>
        </div>
      ) : null}
      <NetworkAtlasReadout source={enrichmentSource} record={networkAtlas} />
    </HudPanel>
  );
}
