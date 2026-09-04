import { memo, type CSSProperties } from 'react';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import type { NetworkSummary } from '../../derives/peers.derive';
import type { FleetConsensus } from '../../derives/fleetTelemetry';
import type { BlockProducerView } from '../../derives/blockProducers.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { DirectionMark, HudPanel, PanelHeader, StatRow } from './primitives';
import { producerFleetText, producerFleetTitle } from './producerReadout';
import NetworkAtlasReadout from './NetworkAtlasReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

// Our catch-up is status by exception: at the tip `syncRatio` is a permanently
// full gauge that reports nothing the head-consensus bar has not already said,
// so the row exists only below this. Proportional, so the one-block gap between
// arrivals never trips it while a real backlog always does.
const AT_TIP_SYNC_RATIO = 0.999;

// PEER·02 reports the network, never the scene: every number here is either
// measured by the local node or indexed by the crawler. The colony count the
// stage draws (measured peers + inferred ghosts + us) is a rendering fact and
// lives with the other stage readouts, in STAGE·07.
//
// It reports the fleet, never one peer. Per-peer client version and RTT are on
// the floating PEER card and the reference version is on the NODE card, so a
// rail aggregate of the same two numbers was only duplicate telemetry.
/** Kept in step with `CellsPanel`: the two mesh panels are a pair and a pair
 *  that collapsed to two different measures would read as two instruments. */
const PANEL_WIDTH_PX = 302;
const DENSE_PANEL_WIDTH_PX = 210;

function NetworkPanel({ summary, consensus, syncRatio, enrichmentSource, networkAtlas, producers, dense = false, style }: {
  summary: NetworkSummary; consensus: FleetConsensus; syncRatio: number;
  enrichmentSource?: EnrichmentSourceStatus;
  networkAtlas?: NetworkAtlasRecord | null;
  /** Who has been making this network's blocks lately, off the chain itself.
   *  Absent only when the window contradicts itself — the derive refuses a
   *  window whose numerators do not add up to it — and a refusal prints
   *  nothing rather than a partial truth. */
  producers?: BlockProducerView | null;
  /** The rail has collapsed (`RAILS_COLLAPSE_MAX_WIDTH_PX`): header, the peer
   *  count, and the head consensus bar the count is a count OF. Everything
   *  below it — the tallies, the catch-up gauge, the cohorts and the atlas — is
   *  reachable on a stage wide enough to hold the scene as well, and a rail
   *  that keeps them on a page too narrow for a card to stand beside its cell
   *  is a rail that has decided the HUD is the page. */
  dense?: boolean;
  style?: CSSProperties;
}) {
  const total = Math.max(1, consensus.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <HudPanel style={{ width: dense ? DENSE_PANEL_WIDTH_PX : PANEL_WIDTH_PX, paddingTop: 14, ...style }}>
      <PanelHeader en="PEER MESH" cjk="节点场" idx="PEER·02" accent={HUD_COLORS.peerWire} />
      {/* The link-direction pair reads as `OUT n / IN n`, which is how
        * `NodeSelfCard` states the identical reading and how every other
        * legend in the HUD states any reading. This panel was the only surface
        * in the overlay that spoke lowercase, and it did it directly under its
        * own uppercase `StatRow` labels — five authored words (`out`, `in`,
        * and the three consensus tallies below) that read as a different
        * instrument's captions in the middle of this one's. */}
      {/* ⭐ AND THE COUNT IS THIS PANEL'S LANDING POINT. PEER·02 was the one
        * module with no lifted number at all — it opened on a stat row, so the
        * loudest thing in it was the glowing consensus bar underneath, and the
        * eye arriving at the right rail met a BAR before it met a figure
        * (report A, A-3). The peer count is what the panel is a count of, so
        * it takes the `emphasis` rung in a lifted row, the arrangement CELL·03
        * uses one rail-slot down.
        *
        * ⚠️ `emphasis` and not `hero`: the four rungs of the split beside it —
        * `OUT n / IN n` — belong to the same reading and would be dwarfed by a
        * 22 px figure, and the bar below is still the panel's picture of the
        * colony. This is a landing point, not a claim to outrank it. */}
      <StatRow label="Peers" lifted="emphasis"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.emphasis, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: HUD_COLORS.peerWire }}>{summary.peerCount}</span> &nbsp; <span style={{ color: HUD_COLORS.dim }}>OUT</span> {summary.outbound} / <span style={{ color: HUD_COLORS.dim }}>IN</span> {summary.inbound}</StatRow>
      {dense ? null : (
        <StatRow label="Head consensus">{consensus.atTip} / {consensus.total}</StatRow>
      )}
      <div style={{ display: 'flex', height: 7, border: `1px solid ${rgba(HUD_COLORS.orange, 0.2)}`, background: HUD_COLORS.trackGround, margin: '4px 0' }}>
        <span style={{ width: seg(consensus.atTip), background: HUD_COLORS.nominal, boxShadow: `0 0 7px ${rgba(HUD_COLORS.nominal, 0.55)}` }} />
        <span style={{ width: seg(consensus.behind), background: HUD_COLORS.dim }} />
        {/* AHEAD is DANGER here, as it is on both cards (the user's D-18
          * ruling). A peer past our head is the one reading in this panel
          * that indicts the local node — it says WE are behind — and it wore
          * caution while the same fact wore danger one click away, on the
          * NODE card's lag box and the PEER card's sync ladder. One fact, one
          * severity, whichever surface a reader meets it on. */}
        <span style={{ width: seg(consensus.ahead), background: HUD_COLORS.danger }} />
      </div>
      {dense ? null : (
      <div style={{ display: 'flex', gap: 11, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.35, marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: HUD_COLORS.nominal }}>
          <DirectionMark direction="up" color={HUD_COLORS.nominal} size={4.5} />
          {consensus.atTip} AT-TIP
        </span>
        <span style={{ color: HUD_COLORS.dim }}>{consensus.behind} BEHIND</span>
        <span style={{ color: HUD_COLORS.danger }}>{consensus.ahead} AHEAD</span>
        {/* The height the three tallies are counted against — a reading, and
          * the only unqualified figure in the row. It was painted
          * `moduleSlate`, the module registry's grey, which the palette puts
          * below `dim` on purpose because a tag is an address and not a
          * reading. `dim` is spoken for one span to the left by the `behind`
          * tally, so plain ink is what is left and what this is. */}
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink }}>#{fmt(summary.bestKnown)}</span>
      </div>
      )}
      {!dense && syncRatio < AT_TIP_SYNC_RATIO ? (
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
        * ⭐⭐ THE WORD IS `POW COHORTS`, AND THAT IS A CORRECTION RATHER
        * THAN A RENAME. This row counts DISTINCT PAYOUT LOCK HASHES, and a
        * payout lock hash is a destination: one address pays every machine a
        * pool runs. `MINERS` therefore counted machines it had no evidence
        * about — six of them on the live shape, where at least one is plainly a
        * pool. A cohort is the set of machines behind one payout identity, so
        * the count is exact again: six payout identities is six cohorts,
        * whatever each of them turns out to contain.
        *
        * ⭐ THE HUD STILL ONLY GETS ONE WORD FOR IT. The card this row leads to
        * is masted `POW COHORT //`,
        * the stamp a peer may carry asks `IN A MINING COHORT?`, and the derive
        * keeps its own vocabulary (`BlockProducer`, `producer_key`, `attested`)
        * because those are names for code and never reach a reader. The local
        * node's own probe still says `MINER`, and correctly: that subject IS
        * one machine, and it is the only one in this app we can say that about.
        *
        * ⚠️ THE LABEL FITS, MEASURED RATHER THAN HOPED. `POW COHORTS` is
        * shorter than the previous label at `HUD_TYPE.tech` with this row's 1.6
        * tracking; the widest value this row can print is ~143px; the panel's
        * measure is 272px. `StatRow` is `nowrap` at a fixed 17px height, so
        * neither a wrap nor a taller row is reachable from here — the 53% cut
        * this panel took stands untouched.
        *
        * ⚠️ AND THE WEEK'S ROW IS THE SHORTER OF THE TWO, counted rather than
        * re-measured. The window prints `16 · TOP 100% · 240 BLK` at its
        * widest — 23 characters — and the week prints `16 · TOP 100% · 7 D` at
        * its widest, which is 19: the day count is one digit where the block
        * count is three, and `D` is two characters shorter than `BLK`. The
        * ~143px above was measured on the longer string and therefore still
        * bounds this row. The px reading against the 272px measure is L6's,
        * live, where a rendered width can actually be taken — jsdom has no
        * font and would answer zero for both.
        *
        * ⚠️ ONE ROW, AND THE HEIGHT IS THE ARGUMENT. This panel was cut by 53%
        * when five StatRows became a bar, and that saving is not this feature's
        * to spend: a share bar here would redraw a ranking the colony already
        * draws on the stage, one instrument away from it.
        *
        * The share and the window arrive as ONE string from one formatter, so
        * there is no arrangement of this row that prints a top share without
        * the window it is a share of.
        *
        * ⭐⭐ AND WHEN AN INDEXER'S WEEK IS THERE, THE ROW IS A READING OF THE
        * WEEK. `2 · TOP 60% · 5 BLK` fifty-six seconds after a boot was never
        * wrong — it was the true count of a window holding five blocks — but a
        * panel row that halves and doubles with the fill of a 240-block ring
        * is reporting how long this process has been up, in the slot where a
        * reader is looking for how many cohorts there are. The week is warm on
        * the first frame and survives a reorg that closed after it did.
        *
        * ⚠️ THE WINDOW DOES NOT VANISH WITH IT: it moves into the title,
        * whole, as the reading only this node vouches for. Both strings come
        * out of `producerReadout` — the title too, because it carries a
        * percentage and a percentage assembled in a component is the one thing
        * that module exists to make unreachable. */}
      {!dense && producers ? (
        <div data-network-producers>
          <StatRow
            label="POW COHORTS"
            title={producerFleetTitle(producers)}
          >
            {producerFleetText(producers)}
          </StatRow>
        </div>
      ) : null}
      {dense ? null : (
        <NetworkAtlasReadout source={enrichmentSource} record={networkAtlas} />
      )}
    </HudPanel>
  );
}

// Memoized with the other rail panels — see `BlockchainReadout`. `summary`
// and `consensus` are keyed upstream on the peer list and the chain fields
// they read, so a mempool tick leaves both where they were.
export default memo(NetworkPanel);
