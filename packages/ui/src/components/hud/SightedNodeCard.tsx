// SIGHTED — the crawler's dialect of the floating inspection constellation,
// and deliberately the shortest of the three.
//
// The link probe reads a connection and the self probe reads our own vitals.
// This card's subject is a node we have never spoken to: somebody else's
// crawler named it, and that is the whole of what we hold. So there is no
// compass (the bearing would be a hash), no ping strip (we never dialled it),
// no sync ladder (it never told us a height), no uptime (nothing is up). What
// is left is a short RECORD of the crawler's row, the shared DOSSIER plate
// underneath it, and one line saying what the scene is not claiming.
//
// ⭐ ONE CARD, TWO DIALECTS, AND THE SUBJECT PICKS. The colony stages a rung
// the crawler has never had an answer out of, and this card is what its mark
// opens too. For that subject VERSION and THEIR DIAL do not exist — not as
// "Unknown", which is the crawler's word for a lookup that came back empty on
// a node it DID reach, but structurally, because there was never a dial to
// read them off. So the record swaps them for the clock that does exist: when
// the crawler last TRIED. The evidence of that attempt — how far it got, at
// which address, out of how many, and how much of the network still repeats
// the address — is the DOSSIER's, one plate down, where the same rows serve
// the peer and the mirror dialects that have no RECORD of their own. Printing
// it in both places would give one crawler two voices on one card.
//
// Everything on it is known the moment it opens — the roster row arrived with
// the round that staged the node — so nothing reveals, nothing animates in and
// nothing is selectable. DOM only: nothing here may touch three.js.
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import type { RosterNode, RosterNodeState } from '@cknerv/types';
import type { PeerMiningCandidacy } from '../../derives/blockProducers.derive';
import { MiningCandidacyStamp } from './MinerNodeCard';
import { formatAge, midTruncate } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import {
  CloseButton,
  moduleTag,
  PlateReadoutCaption,
  PlateReadoutRow,
  plateStateChip,
  SpatialPlateHeader,
  spatialPlate,
  stackedSatelliteBase,
} from './primitives';
import PeerSightingPlate, { type PeerSightingState } from './PeerSightingPlate';
import { PEER_NETWORK_HEX } from '../../visualPalette';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the one narrow readout column all three floating dialects
 *  share, so a card swap never resizes the constellation. */
const CARD_WIDTH_PX = 340;

/** The sighted tier's own tint, read from the constant its point clouds are
 *  drawn with: `PEER_CLOUD_SIGHTED_TONE` sets brightness and size but no
 *  colour, so `makePeerCloudMaterial` falls back to
 *  `PEER_NETWORK_PALETTE.scaffold` — this hex, in scene-linear form. Card and
 *  sprite therefore cannot drift; the tier is one cyan at three stops, and
 *  this card is the readout for the middle one. */
export const SIGHTED_NODE_ACCENT = PEER_NETWORK_HEX.scaffold;

/** The crawler's row, printed as-is. No derivation anywhere: anything computed
 *  from these would be a claim the crawler did not make.
 *
 *  Four names for two dialects. `version` and `dial` exist only where the
 *  crawler holds a verification; `tried` exists only where it does not, and
 *  says when the last completed round dialed the node — which is the one thing
 *  a peer nobody answered has that a peer somebody answered states another
 *  way (in the masthead, as a sighting). No row is ever in both sets. */
export type SightedNodeRow = 'addr' | 'version' | 'dial' | 'tried';

/** Which of the two the subject is.
 *
 *  Read off `state` and never off the optional fields: `reachable` and
 *  `verified_unavailable` are both peers the crawler SPOKE to, and one of them
 *  routinely arrives with no dial time, so "has an rtt" would have sorted the
 *  same peer into different dialects on different rounds. The record's own
 *  discriminant is the discriminant. */
export type SightedNodeDialect = 'verified' | 'advertised';

export function sightedNodeDialect(state: RosterNodeState): SightedNodeDialect {
  return state === 'advertised_unverified' ? 'advertised' : 'verified';
}

/** The word each dialect wears in the masthead and in the accessible name.
 *
 *  ⚠️ THIS IS THE CARD'S ONE CLAIM THAT CAN GO FALSE. Every other line already
 *  says nothing rather than guessing — an absent version prints a dash, an
 *  absent dial prints no row at all — but a heading is not optional, and
 *  SIGHTED over a node nobody has ever spoken to is precisely the sentence the
 *  whole tier exists to refuse. It is one table so the masthead and the two
 *  accessible names cannot drift apart, which they had begun to: the same
 *  ternary was written out three times — the masthead, this card's own
 *  accessible name, and the overlay's. */
const DIALECT_WORD: Record<SightedNodeDialect, { masthead: string; spoken: string }> = {
  verified: { masthead: 'SIGHTED', spoken: 'Sighted' },
  advertised: { masthead: 'ADVERTISED', spoken: 'Advertised' },
};

/** The accessible name for a card or overlay about this node, in the dialect
 *  its evidence earns. Exported because the scene half names the same subject
 *  and must name it the same way. */
export function sightedNodeSpokenWord(state: RosterNodeState): string {
  return DIALECT_WORD[sightedNodeDialect(state)].spoken;
}

export type SightedNodeLayoutSide = SceneInspectorPlacementSide;

export interface SightedNodeCardProps {
  /** The crawler's roster row for this node — real identity, invented
   *  position, no link of ours. */
  node: RosterNode;
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: SightedNodeLayoutSide;
  /** Wall clock both the header age and the dossier's ages are measured from.
   *  Supplied by a host that already runs a clock; otherwise the card keeps
   *  its own 1 Hz tick, which is the only timer it ever starts. */
  nowMs?: number;
  /** The crawler's fuller dossier on the same node, fetched lazily. The roster
   *  row above is instant and this is not, so the card is already complete
   *  before it lands. */
  sighting?: PeerSightingState;
  /** Whether this node runs a build one of the chain's recent producers
   *  declared. Absent for all but a handful of peers, and never a claim that
   *  this one mines — see `MiningCandidacyStamp`. */
  candidacy?: PeerMiningCandidacy | null;
  onClose: () => void;
  style?: CSSProperties;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** One line of the crawler's record. A readout, never a button: none of it
 *  re-tints the scene, because none of it is a measurement of ours. */
function SightedReadout({
  row,
  label,
  value,
  title,
  children,
}: {
  row: SightedNodeRow;
  label: string;
  value: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <PlateReadoutRow
      accent={SIGHTED_NODE_ACCENT}
      label={label}
      value={value}
      title={title ?? value}
      rowAttributes={{ 'data-sighted-probe-fact': row }}
      valueAttributes={{ 'data-sighted-probe-value': row }}
    >
      {children}
    </PlateReadoutRow>
  );
}

/** A sentence under a value, in the micro tier — the caption grammar the other
 *  two dialects already use. */
function ReadoutCaption({ children }: { children: ReactNode }) {
  return <PlateReadoutCaption>{children}</PlateReadoutCaption>;
}

export default function SightedNodeCard({
  node,
  layoutSide = 'left',
  nowMs,
  sighting,
  candidacy,
  onClose,
  style,
}: SightedNodeCardProps) {
  const accent = SIGHTED_NODE_ACCENT;
  const id8 = node.node_id.slice(0, 8);
  const dialect = sightedNodeDialect(node.state);
  const word = DIALECT_WORD[dialect];

  // The card prints one age and lends it to the dossier's ages, so it needs a
  // wall clock that keeps moving. A host that already runs one hands it down
  // and no interval starts here at all; on its own the card runs exactly one,
  // at the 1 Hz the other dialects tick at.
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs != null) return;
    setTickNowMs(Date.now());
    const interval = window.setInterval(() => setTickNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [nowMs, node.node_id]);
  const atMs = nowMs ?? tickNowMs;

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';

  return (
    <div
      data-sighted-probe-card
      data-sighted-probe-layout={verticalLayout ? 'vertical' : layoutSide}
      data-sighted-probe-dialect={dialect}
      role="region"
      aria-label={`${word.spoken} node ${id8} probe`}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        rowGap: 8,
        alignItems: 'start',
        width: CARD_WIDTH_PX,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow for the whole constellation, as on the link
        // and self cards — never a filter surface per plate.
        filter: `drop-shadow(0 8px 16px ${rgba(HUD_COLORS.ground, 0.56)}) drop-shadow(0 0 14px ${rgba(accent, 0.06)})`,
        ...style,
      }}
    >
      {/* No CJK companion here. 对端 is the link probe's word for the far end
          of a connection, and this card's whole point is that there is no
          connection — borrowing it would be the one lie on the card. The other
          two dialects keep theirs; no new glyph is asked of the subset. */}
      <section
        data-sighted-probe-module="header"
        style={{
          ...stackedSatelliteBase,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 8px',
          padding: '9px 20px 8px 14px',
          ...spatialPlate(accent),
        }}
      >
        <span
          title={node.node_id}
          style={{
            color: accent,
            fontFamily: HUD_FONTS.display,
            fontSize: HUD_TYPE.title,
            fontWeight: 600,
            letterSpacing: 1.6,
            textShadow: `0 0 9px ${rgba(accent, 0.45)}`,
          }}
        >
          {word.masthead} // {id8}
        </span>
        {/* Steel, not caution. Having no link to a node the crawler named is
            this card's normal condition, not a fault of anything — the alarm
            colours belong to links that broke. */}
        <span
          data-sighted-probe-link="none"
          style={plateStateChip(HUD_COLORS.dim)}
        >
          NOT LINKED
        </span>
        {/* One right-hand group in flow, as the CELL and PEER mastheads carry
          * theirs. An age is the longest thing this line can say — a node the
          * crawler last named days ago prints a whole phrase — and a flow span
          * pushed right by `marginLeft` used to run under an absolutely-placed
          * stamp instead of pushing it. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          {/* The crawler's reach clock, and only ever that one. Two other
              clocks ride this row now — when the network last named the node
              and when the crawler last tried it — and neither of them is a
              sighting, so neither may stand in for one here. A node this
              colony stages has been dialed, so the clock is normally there;
              when it is not, the line goes rather than dating a sighting from
              something else. */}
          {node.last_reachable_ms != null ? (
            <span
              data-sighted-probe-last-seen
              style={{
                color: HUD_COLORS.dim,
                fontSize: HUD_TYPE.label,
                letterSpacing: 0.9,
              }}
            >
              LAST SEEN {formatAge(node.last_reachable_ms, atMs)}
            </span>
          ) : null}
          {moduleTag('SGHT·01')}
        </span>
        {/* The mining question, on its own line under the masthead — the same
            place `NodeSelfCard` stamps the role it can actually MEASURE, which
            is the point of putting it here rather than in the record below:
            RECORD prints the crawler's row as-is and nothing derived, and this
            is derived from a chain fact the crawler never saw. It is a
            question and it carries the size of the set it is asked over; there
            is no arrangement of it that says this node mines. */}
        {candidacy ? <MiningCandidacyStamp candidacy={candidacy} /> : null}
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      {/* The roster row, exactly as the round that staged this node carried
          it. Whereabouts, exposure and the network's own ages are the
          dossier's to print; repeating them here would give one crawler two
          voices on the same card. */}
      <section
        aria-label="Crawler record"
        data-sighted-probe-module="record"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(accent),
        }}
      >
        <SpatialPlateHeader
          en="RECORD"
          accent={accent}
          status={moduleTag('SGHT·02')}
        />
        <div style={{ display: 'grid', rowGap: 3 }}>
          <SightedReadout
            row="addr"
            label="ADDR"
            value={midTruncate(node.addr, 14, 13)}
            title={node.addr}
          />
          {/* The two rows that exist only where a verification does. Not
              "Unknown" for the other dialect and not an em dash either: the
              crawler never dialed that node, so there was no lookup to come
              back empty and no round trip to be missing. A row that is not
              there is the honest form of a fact that is not there. */}
          {dialect === 'verified' ? (
            <SightedReadout
              row="version"
              label="VERSION"
              value={node.version || '—'}
            />
          ) : null}
          {/* THEIR dial, never OUR ping: the number is a round trip from the
              crawler's vantage to this node, and it measures a link this
              dashboard does not have. The dossier's own copy of it stands
              down in this dialect so the figure prints once. */}
          {dialect === 'verified' && node.rtt_ms != null ? (
            <SightedReadout
              row="dial"
              label="THEIR DIAL"
              value={`${count(node.rtt_ms)} MS`}
            >
              <ReadoutCaption>
                THE CRAWLER'S ROUND TRIP FROM ITS OWN VANTAGE
              </ReadoutCaption>
            </SightedReadout>
          ) : null}
          {/* And the row that exists only where one does not. It is a clock
              the dossier never prints — that plate dates the report by when
              the NETWORK last named the peer, which is a statement about the
              network; this is when the CRAWLER last dialed it, which is what
              says whether the failure below is current or a fortnight old.
              Three clocks ride the roster row and none may stand in for
              another, so this one is labelled for the only thing it means. */}
          {dialect === 'advertised' && node.last_observed_ms != null ? (
            <SightedReadout
              row="tried"
              label="LAST TRIED"
              value={formatAge(node.last_observed_ms, atMs)}
            >
              <ReadoutCaption>
                THE LAST COMPLETED ROUND THAT DIALED IT
              </ReadoutCaption>
            </SightedReadout>
          ) : null}
        </div>
      </section>

      {/* Same plate as the other two cards, in the dialect for a subject we
          hold nothing live about: no RPC version to cross-check the crawler
          against, no link of ours to age, no ping of ours to set beside its
          dial. */}
      {sighting ? (
        <PeerSightingPlate
          {...sighting}
          module="SGHT·03"
          variant="sighted"
          nowMs={atMs}
        />
      ) : null}

      {/* The one thing the scene cannot say for itself. The node is really out
          there and really has this id; where it stands in the colony is the
          renderer's arrangement and means nothing about the network. */}
      <div
        data-sighted-probe-footer
        style={{
          ...stackedSatelliteBase,
          padding: '5px 12px 6px 14px',
          fontFamily: HUD_FONTS.tech,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 1.2,
          lineHeight: 1.4,
          color: HUD_COLORS.dim,
          ...spatialPlate(HUD_COLORS.dim),
        }}
      >
        NO LIVE LINK · POSITION IS SCENE PLACEMENT
      </div>
    </div>
  );
}
