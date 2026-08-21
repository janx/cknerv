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
// The accent is the chain anchor's own cyan and never moves, so the card has
// no facet machinery: the probe walk is a reveal, not a selector.
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
import { CloseButton, SpatialPlateHeader, spatialPlate } from './primitives';
import { PROBE_STEP_S, probeScan } from './probeScan';
import { useReducedMotion } from './useReducedMotion';
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

/** Reveal order of the probe walk — the node's own body first, then the
 *  colony it is standing in. */
const NODE_SELF_ROWS = ['tip', 'epoch', 'version', 'peers', 'consensus'] as const;
export type NodeSelfRow = typeof NODE_SELF_ROWS[number];

export type NodeSelfLayoutSide = SceneInspectorPlacementSide;

export interface NodeSelfCardProps {
  node: ChainNode;
  chain: ChainEntry;
  /** The live peer list the STANCE plate measures the colony from. */
  peers: Peer[];
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: NodeSelfLayoutSide;
  onClose: () => void;
  style?: CSSProperties;
}

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function blocks(n: number): string {
  return n.toLocaleString('en-US');
}

function moduleTag(tag: string) {
  return (
    <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 1, color: '#5a6470' }}>
      {tag}
    </span>
  );
}

/** One vital. Dark until the probe reaches it, then held — the node card has
 *  nothing to select, so a row is a readout and never a button. */
function SelfReadout({
  row,
  label,
  value,
  valueColor,
  revealed,
  children,
}: {
  row: NodeSelfRow;
  label: string;
  value: string;
  valueColor?: string;
  revealed: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-node-probe-fact={row}
      data-node-probe-fact-state={revealed ? 'resolved' : 'scanning'}
      style={{
        minWidth: 0,
        padding: '3px 0 4px 9px',
        borderLeft: `1px solid ${rgba(NODE_SELF_ACCENT, revealed ? 0.34 : 0.1)}`,
        opacity: revealed ? 1 : 0.18,
        transition: 'opacity 260ms ease, border-color 260ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ flex: '0 0 auto', fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
          {label}
        </span>
        <span
          data-node-probe-value={row}
          title={value}
          style={{
            marginLeft: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: HUD_TYPE.value,
            color: valueColor ?? HUD_COLORS.ink,
          }}
        >
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A caption in the micro tier — used where a value needs a sentence, not a
 *  second number. */
function ReadoutCaption({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 2,
        fontFamily: HUD_FONTS.tech,
        fontSize: HUD_TYPE.micro,
        letterSpacing: 0.9,
        lineHeight: 1.35,
        color: HUD_COLORS.dim,
      }}
    >
      {children}
    </div>
  );
}

export default function NodeSelfCard({
  node,
  chain,
  peers,
  layoutSide = 'left',
  onClose,
  style,
}: NodeSelfCardProps) {
  const reduced = useReducedMotion();
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

  const revealSteps = NODE_SELF_ROWS.length;
  const [scanClock, setScanClock] = useState(() => {
    const atMs = nowPerf();
    return { nodeId: node.id, epochMs: atMs, nowMs: atMs };
  });

  useEffect(() => {
    if (reduced) return;
    const epochMs = nowPerf();
    const update = () => setScanClock({
      nodeId: node.id,
      epochMs,
      nowMs: nowPerf(),
    });
    setScanClock({ nodeId: node.id, epochMs, nowMs: epochMs });
    const interval = window.setInterval(update, 80);
    const stop = window.setTimeout(() => {
      window.clearInterval(interval);
      update();
    }, revealSteps * PROBE_STEP_S * 1000 + 80);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [node.id, reduced, revealSteps]);

  const activeClock = scanClock.nodeId === node.id
    ? scanClock
    : { nodeId: node.id, epochMs: scanClock.nowMs, nowMs: scanClock.nowMs };
  const scan = probeScan(
    activeClock.epochMs,
    reduced ? 0 : activeClock.nowMs,
    revealSteps,
    reduced,
  );
  const revealed = (row: NodeSelfRow): boolean =>
    reduced || NODE_SELF_ROWS.indexOf(row) < scan.reveal;

  // Peers past our head are the one reading on this card that indicts us: it
  // is the local node that lags. The link probe gives AHEAD the same danger
  // tint on its sync ladder; the two cards agree on which rung is loud.
  const lagging = consensus.ahead > 0;
  const consensusTotal = Math.max(1, consensus.total);
  const segment = (n: number) => `${(n / consensusTotal) * 100}%`;

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';
  const satelliteBase: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  };

  return (
    <div
      data-node-probe-card
      data-node-probe-layout={verticalLayout ? 'vertical' : layoutSide}
      data-node-probe-scan-state={scan.classified ? 'locked' : 'scanning'}
      data-node-probe-scan-progress={scan.pct}
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
        filter: `drop-shadow(0 8px 16px rgba(0,0,0,.56)) drop-shadow(0 0 14px ${rgba(accent, 0.06)})`,
        ...style,
      }}
    >
      <section
        data-node-probe-module="header"
        style={{
          ...satelliteBase,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 8px',
          padding: '9px 34px 8px 14px',
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
          style={{
            padding: '1px 5px',
            border: `1px solid ${rgba(node.is_miner ? HUD_COLORS.lockedGold : accent, 0.55)}`,
            color: node.is_miner ? HUD_COLORS.lockedGold : accent,
            fontFamily: HUD_FONTS.tech,
            fontSize: HUD_TYPE.micro,
            fontWeight: 700,
            letterSpacing: 1.4,
          }}
        >
          {node.is_miner ? 'MINER' : 'OBSERVER'}
        </span>
        <span
          data-node-probe-chain
          style={{
            marginLeft: 'auto',
            color: HUD_COLORS.dim,
            fontSize: HUD_TYPE.label,
            letterSpacing: 0.9,
            whiteSpace: 'nowrap',
          }}
        >
          {chain.chain_name.toUpperCase()}
        </span>
        <span style={{ position: 'absolute', top: 7, right: 28 }}>
          {moduleTag('SELF·01')}
        </span>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      <section
        aria-label="Node vitals"
        data-node-probe-module="vitals"
        style={{
          ...satelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(accent),
        }}
      >
        <SpatialPlateHeader
          en="VITALS"
          accent={accent}
          status={(
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ color: scan.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire, fontSize: HUD_TYPE.micro, letterSpacing: 0.72 }}>
                {scan.classified ? 'LOCKED' : `SCANNING ${scan.pct}%`}
              </span>
              {moduleTag('SELF·02')}
            </span>
          )}
        />
        <div style={{ display: 'grid', rowGap: 3 }}>
          <SelfReadout
            row="tip"
            label="TIP"
            // Live: the chain entry re-renders on every block, so this height
            // is the node's own pulse rather than a snapshot taken on open.
            value={`#${blocks(chain.tip)}`}
            valueColor={HUD_COLORS.cyanInk}
            revealed={revealed('tip')}
          />
          <SelfReadout
            row="epoch"
            label="EPOCH"
            value={epoch.number}
            revealed={revealed('epoch')}
          >
            <div
              data-node-probe-epoch-bar
              aria-hidden="true"
              style={{
                display: 'flex',
                height: 5,
                marginTop: 4,
                border: `1px solid ${rgba(accent, 0.22)}`,
                background: '#050a10',
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
            revealed={revealed('version')}
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
          ...satelliteBase,
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
            revealed={revealed('peers')}
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
            revealed={revealed('consensus')}
          >
            <div
              data-node-probe-consensus-bar
              aria-hidden="true"
              style={{
                display: 'flex',
                height: 5,
                marginTop: 4,
                border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.22)}`,
                background: '#050a10',
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
    </div>
  );
}
