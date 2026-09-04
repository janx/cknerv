// SELF PROBE — the local node's dialect of the floating inspection
// constellation.
//
// The peer card reads a link: two ends, a bearing, a round trip. This one has
// no counterpart to measure, so there is no direction, no ping, no churn. Its
// subject is the organism's own vitals — the head it stands on, the epoch it
// stands in, the version every peer mismatch is judged against — and then how
// the colony around it is sitting relative to that head.
//
// DOM/SVG only, rendered as a Canvas sibling: nothing here may touch three.js.
// The accent is the chain anchor's own cyan and never moves, and every vital
// is already known when the card opens, so there is nothing to select and
// nothing to wait for: the plates print at once.
import {
  type CSSProperties,
  type ReactNode,
  useMemo,
} from 'react';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import { CJK_BASELINE_LIFT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
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
import { fleetConsensus } from '../../derives/fleetTelemetry';
import { localRoundTrip } from '../../derives/peers.derive';
import { CHAIN_ANCHOR_HEX } from '../../visualPalette';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the same narrow readout column the link probe uses, so the
 *  two dialects sit at one width beside their nodes. */
const CARD_WIDTH_PX = 340;

/** The structural chain anchor's own wireframe cyan, read from the constant
 *  `CkbNodeAnchor` is drawn with. Card and icosahedron cannot drift. */
export const NODE_SELF_ACCENT = CHAIN_ANCHOR_HEX.edge;

/** The vitals this card prints — the node's own body first, then where it
 *  stands in the colony around it.
 *
 *  TIP and EPOCH are not here any more (report C, C-6). Both were `chain.tip`
 *  and `chain.epoch` printed a second time, off the same entry CKB·01 draws
 *  them from four hundred pixels to the left, with the epoch's progress bar
 *  duplicated under them — and neither is a fact about this NODE that the
 *  chain panel is not already making about the chain. What is left is what
 *  only the self can answer: the version every peer mismatch is judged
 *  against, our own round trips, and how many of the colony we are ahead of. */
export type NodeSelfRow = 'version' | 'roundtrip' | 'lead';

export type NodeSelfLayoutSide = SceneInspectorPlacementSide;

export interface NodeSelfCardProps {
  node: ChainNode;
  chain: ChainEntry;
  /** The live peer list the STANCE plate measures the colony from. */
  peers: Peer[];
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: NodeSelfLayoutSide;
  /** How the source's crawler last saw this node — the one account of it that
   *  comes from outside. Omitted whenever the source advertises no
   *  `peer_sighting` capability; the self probe is complete without it. */
  sighting?: PeerSightingState;
  onClose: () => void;
  style?: CSSProperties;
}

function blocks(n: number): string {
  return n.toLocaleString('en-US');
}

/** One vital, printed the moment the card opens — the node card has nothing
 *  to select, so a row is a readout and never a button. */
function SelfReadout({
  row,
  label,
  value,
  valueColor,
  children,
}: {
  row: NodeSelfRow;
  label: string;
  value: string;
  valueColor?: string;
  children?: ReactNode;
}) {
  return (
    <PlateReadoutRow
      accent={NODE_SELF_ACCENT}
      label={label}
      value={value}
      valueColor={valueColor}
      rowAttributes={{ 'data-node-probe-fact': row }}
      valueAttributes={{ 'data-node-probe-value': row }}
    >
      {children}
    </PlateReadoutRow>
  );
}

/** A caption in the micro tier — used where a value needs a sentence, not a
 *  second number. */
function ReadoutCaption({ children }: { children: ReactNode }) {
  return <PlateReadoutCaption>{children}</PlateReadoutCaption>;
}

export default function NodeSelfCard({
  node,
  chain,
  peers,
  layoutSide = 'left',
  sighting,
  onClose,
  style,
}: NodeSelfCardProps) {
  const accent = NODE_SELF_ACCENT;
  // The colony's heads, read through the same derive PEER·02 reads, so the
  // card and the rail can never disagree about the numbers. What differs is
  // the SUBJECT: the panel takes a census of the colony (n at tip, n behind,
  // n ahead); this card says where WE stand in it, which is the only reading a
  // dossier of the local node owes anybody.
  const consensus = useMemo(
    () => fleetConsensus(peers, chain.tip),
    [peers, chain.tip],
  );
  const roundTrip = useMemo(() => localRoundTrip(peers), [peers]);

  // The self probe counts no duration of its own — a node holds no link to
  // itself — so nothing here runs a clock. The dossier's ages are leaves on
  // the shared HUD clock and tick only while one is on screen.

  // Peers past our head are the one reading on this card that indicts us: it
  // is the local node that lags. The link probe gives AHEAD the same danger
  // tint on its sync ladder and PEER·02 gives it the same one on the rail;
  // all three surfaces agree on which rung is loud (the user's D-18 ruling).
  const lagging = consensus.ahead > 0;

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';

  return (
    <div
      data-node-probe-card
      data-node-probe-layout={verticalLayout ? 'vertical' : layoutSide}
      role="region"
      aria-label={`Node ${node.label} self probe`}
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
        // One composited shadow for the whole constellation, as on the Cell
        // and link cards — never a filter surface per plate.
        filter: `drop-shadow(0 8px 16px ${rgba(HUD_COLORS.ground, 0.56)}) drop-shadow(0 0 14px ${rgba(accent, 0.06)})`,
        ...style,
      }}
    >
      <section
        data-node-probe-module="header"
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
          title={node.id}
          style={{
            color: accent,
            fontFamily: HUD_FONTS.display,
            fontSize: HUD_TYPE.title,
            fontWeight: 600,
            letterSpacing: 1.6,
            textShadow: `0 0 9px ${rgba(accent, 0.45)}`,
          }}
        >
          NODE // {node.label}
        </span>
        <span style={{ ...CJK_BASELINE_LIFT, color: accent, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
          节点
        </span>
        {/* THE EVIDENCE CLASS, the one question this slot answers on all four
          * network dialects (report C, C-5): LINKED · SELF · NAMED · CHAIN
          * ATTESTED. SELF is the whole reason this card is a different dialect
          * at all — it is the only node in the app we hold no link to and know
          * everything about, because it is the instrument.
          *
          * The ROLE moved one group right, beside the chain it mines or
          * watches. It is a fact about this node and it is still printed; it
          * simply is not the evidence this card stands on, and a chip that
          * said MINER here while the sighted card's said NOT LINKED taught a
          * reader nothing about either. One ink for both roles stays the
          * ruling it was: `lockedGold` is value held under lock and never a
          * role, and a chip that sounds the ordinary case makes the ordinary
          * case look like a verdict. */}
        <span
          data-node-probe-evidence="self"
          style={plateStateChip(accent)}
        >
          SELF
        </span>
        {/* One right-hand group in flow, as the CELL and PEER mastheads carry
          * theirs: an absolutely-placed stamp beside a `marginLeft: auto` span
          * is two layout mechanisms competing for the same corner, and a chain
          * named at any length slid straight under it. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          <span
            data-node-probe-chain
            style={{
              color: HUD_COLORS.dim,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.9,
            }}
          >
            {chain.chain_name.toUpperCase()}
          </span>
          <span
            data-node-probe-role={node.is_miner ? 'miner' : 'observer'}
            style={{
              color: HUD_COLORS.dim,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.9,
            }}
          >
            · {node.is_miner ? 'MINER' : 'OBSERVER'}
          </span>
          {moduleTag('SELF·01')}
        </span>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      {/* Local RPC already answered every one of these before the card
          mounted, so the vitals print at once — a progress meter over data
          we are holding would be theatre. */}
      <section
        aria-label="Node vitals"
        data-node-probe-module="vitals"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(accent),
        }}
      >
        <SpatialPlateHeader
          en="VITALS"
          accent={accent}
          status={moduleTag('SELF·02')}
        />
        <div style={{ display: 'grid', rowGap: 3 }}>
          <SelfReadout
            row="version"
            label="VERSION"
            value={node.version || '—'}
          >
            <ReadoutCaption>
              THE REFERENCE — PEER MISMATCHES ARE JUDGED AGAINST IT
            </ReadoutCaption>
          </SelfReadout>
          {/* Our own reflex time, and the vital TIP and EPOCH were standing
              in the way of. A peer card knows one link; this is the spread
              over every peer we have timed, which nothing else in the app can
              say — and it is a reading of THIS node's connectivity rather than
              a description of the colony. */}
          <SelfReadout
            row="roundtrip"
            label="ROUND TRIP"
            value={roundTrip.bestMs === null || roundTrip.worstMs === null
              ? '—'
              : `${blocks(roundTrip.bestMs)}–${blocks(roundTrip.worstMs)} MS`}
            valueColor={HUD_COLORS.peerWire}
          >
            <ReadoutCaption>
              {roundTrip.measured === 0
                ? `NO PEER TIMED YET · ${blocks(roundTrip.total)} CONNECTED`
                : `BEST AND WORST OF ${blocks(roundTrip.measured)} TIMED · ${blocks(roundTrip.total)} CONNECTED`}
            </ReadoutCaption>
          </SelfReadout>
        </div>
      </section>

      <section
        aria-label="Colony stance"
        data-node-probe-module="stance"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(HUD_COLORS.peerWire),
        }}
      >
        <SpatialPlateHeader
          en="STANCE"
          accent={HUD_COLORS.peerWire}
          status={moduleTag('SELF·03')}
        />
        {/* This plate used to be PEER·02 with a card's border around it: the
            peer count with its OUT/IN split, the head-consensus bar, and the
            three tallies under it, all reading off the same two derives the
            rail reads — the card's own comment defended the reuse as "so the
            two can never disagree", which is an argument about VALUES and not
            about printing them twice (report C, C-6).
        
            What is left is the same data with the local node as its subject.
            The panel takes a census of the colony; this says where we stand in
            it — how many of them we are ahead of, and, when anybody is ahead
            of US, how far. That last line is the one thing here no rail can
            say, and it is why the plate exists. */}
        <div style={{ display: 'grid', rowGap: 3 }}>
          <SelfReadout
            row="lead"
            label="WE LEAD"
            value={`${blocks(consensus.behind)} OF ${blocks(consensus.total)} PEERS`}
            valueColor={HUD_COLORS.peerWire}
          >
            {/* Why the count is what it is, said about US and never as the
                colony's census: a colony entirely at our head reads `0 OF 12`,
                which on its own looks like a node in trouble. An unreported
                head is the other reason the count can be low, and it is the
                one a reader can do something about. */}
            <ReadoutCaption>
              {consensus.unknown > 0
                ? `${blocks(consensus.unknown)} HAVE NOT SAID WHERE THEIR HEAD IS`
                : lagging
                  ? 'THE REST STAND AT OUR HEAD'
                  : 'NOBODY IS PAST OUR HEAD'}
            </ReadoutCaption>
            {lagging ? (
              <div
                data-node-probe-lag
                style={{
                  marginTop: 5,
                  padding: '2px 7px',
                  border: `1px solid ${rgba(HUD_COLORS.danger, 0.6)}`,
                  background: rgba(HUD_COLORS.danger, 0.16),
                  boxShadow: `0 0 12px ${rgba(HUD_COLORS.danger, 0.32)}`,
                  color: HUD_COLORS.danger,
                  fontFamily: HUD_FONTS.tech,
                  fontSize: HUD_TYPE.label,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textAlign: 'center',
                }}
              >
                {blocks(consensus.ahead)} AHEAD · WE LAG {blocks(consensus.maxAhead)} BLOCKS
              </div>
            ) : null}
          </SelfReadout>
        </div>
      </section>

      {/* The vitals above are what this node knows about itself. This plate is
          the only thing on the card it cannot know: whether anyone outside can
          reach it, and how long the network has carried it. */}
      {sighting ? (
        <PeerSightingPlate
          {...sighting}
          module="SELF·04"
          variant="self"
          liveVersion={node.version}
        />
      ) : null}
    </div>
  );
}
