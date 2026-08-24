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
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { formatEpochReadout } from './epochReadout';
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
import { summarizeNetwork } from '../../derives/peers.derive';
import { CHAIN_ANCHOR_HEX } from '../../visualPalette';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the same narrow readout column the link probe uses, so the
 *  two dialects sit at one width beside their nodes. */
const CARD_WIDTH_PX = 340;

/** The structural chain anchor's own wireframe cyan, read from the constant
 *  `CkbNodeAnchor` is drawn with. Card and icosahedron cannot drift. */
export const NODE_SELF_ACCENT = CHAIN_ANCHOR_HEX.edge;

/** The vitals this card prints — the node's own body first, then the colony
 *  it is standing in. */
export type NodeSelfRow = 'tip' | 'epoch' | 'version' | 'peers' | 'consensus';

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
  const epoch = useMemo(() => formatEpochReadout(chain.epoch), [chain.epoch]);
  const epochRatio = chain.epoch.length > 0
    ? Math.max(0, Math.min(1, chain.epoch.index / chain.epoch.length))
    : 0;
  // Both reused from the panels that already print them, so the floating card
  // and the rail's PEER MESH summary can never disagree about the colony.
  const summary = useMemo(
    () => summarizeNetwork(peers, chain, node),
    [peers, chain, node],
  );
  const consensus = useMemo(
    () => fleetConsensus(peers, chain.tip),
    [peers, chain.tip],
  );

  // The self probe counts no duration of its own — a node holds no link to
  // itself — so it runs no wall clock until the dossier brings ages that have
  // to keep moving. The tick lives exactly as long as one is on screen.
  const sightingRecord = sighting?.phase === 'ready' ? sighting.record ?? null : null;
  const [dossierNowMs, setDossierNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!sightingRecord) return;
    setDossierNowMs(Date.now());
    const interval = window.setInterval(() => setDossierNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sightingRecord]);

  // Peers past our head are the one reading on this card that indicts us: it
  // is the local node that lags. The link probe gives AHEAD the same danger
  // tint on its sync ladder; the two cards agree on which rung is loud.
  const lagging = consensus.ahead > 0;
  const consensusTotal = Math.max(1, consensus.total);
  const segment = (n: number) => `${(n / consensusTotal) * 100}%`;

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
        <span style={{ color: accent, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
          节点
        </span>
        <span
          data-node-probe-role={node.is_miner ? 'miner' : 'observer'}
          style={plateStateChip(
            node.is_miner ? HUD_COLORS.lockedGold : accent,
          )}
        >
          {node.is_miner ? 'MINER' : 'OBSERVER'}
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
            row="tip"
            label="TIP"
            // Live: the chain entry re-renders on every block, so this height
            // is the node's own pulse rather than a snapshot taken on open.
            value={`#${blocks(chain.tip)}`}
            valueColor={HUD_COLORS.cyanInk}
          />
          <SelfReadout
            row="epoch"
            label="EPOCH"
            value={epoch.number}
          >
            <div
              data-node-probe-epoch-bar
              aria-hidden="true"
              style={{
                display: 'flex',
                height: 5,
                marginTop: 4,
                border: `1px solid ${rgba(accent, 0.22)}`,
                background: HUD_COLORS.trackGround,
              }}
            >
              <span
                style={{
                  width: `${epochRatio * 100}%`,
                  background: accent,
                  boxShadow: `0 0 7px ${rgba(accent, 0.55)}`,
                  transition: 'width 420ms ease',
                }}
              />
            </div>
            <ReadoutCaption>BLOCK {epoch.progress} OF THIS EPOCH</ReadoutCaption>
          </SelfReadout>
          <SelfReadout
            row="version"
            label="VERSION"
            value={node.version || '—'}
          >
            <ReadoutCaption>
              THE REFERENCE — PEER MISMATCHES ARE JUDGED AGAINST IT
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
        <div style={{ display: 'grid', rowGap: 3 }}>
          <SelfReadout
            row="peers"
            label="PEERS"
            value={blocks(summary.peerCount)}
            valueColor={HUD_COLORS.peerWire}
          >
            <div
              data-node-probe-peer-split
              style={{
                display: 'flex',
                gap: 11,
                marginTop: 2,
                fontSize: HUD_TYPE.micro,
                letterSpacing: 0.9,
                color: HUD_COLORS.dim,
              }}
            >
              <span>OUT {summary.outbound}</span>
              <span>IN {summary.inbound}</span>
            </div>
          </SelfReadout>
          <SelfReadout
            row="consensus"
            label="COLONY HEAD"
            value={`${blocks(consensus.atTip)} / ${blocks(consensus.total)} AT TIP`}
            valueColor={lagging ? HUD_COLORS.danger : HUD_COLORS.nominal}
          >
            <div
              data-node-probe-consensus-bar
              aria-hidden="true"
              style={{
                display: 'flex',
                height: 5,
                marginTop: 4,
                border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.22)}`,
                background: HUD_COLORS.trackGround,
              }}
            >
              <span style={{ width: segment(consensus.atTip), background: HUD_COLORS.nominal }} />
              <span style={{ width: segment(consensus.behind), background: HUD_COLORS.dim }} />
              <span style={{ width: segment(consensus.ahead), background: HUD_COLORS.danger }} />
            </div>
            <div
              data-node-probe-consensus-counts
              style={{
                display: 'flex',
                gap: 11,
                marginTop: 3,
                fontSize: HUD_TYPE.micro,
                letterSpacing: 0.9,
              }}
            >
              <span style={{ color: HUD_COLORS.nominal }}>{consensus.atTip} AT TIP</span>
              <span style={{ color: HUD_COLORS.dim }}>{consensus.behind} BEHIND</span>
              <span style={{ color: lagging ? HUD_COLORS.danger : HUD_COLORS.dim }}>
                {consensus.ahead} AHEAD
              </span>
            </div>
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
                  letterSpacing: 1.4,
                  textAlign: 'center',
                }}
              >
                WE LAG · {blocks(consensus.maxAhead)} BLOCKS BEHIND THE FURTHEST PEER
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
          nowMs={dossierNowMs}
          liveVersion={node.version}
        />
      ) : null}
    </div>
  );
}
