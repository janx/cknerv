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
// Everything on it is known the moment it opens — the roster row arrived with
// the round that staged the node — so nothing reveals, nothing animates in and
// nothing is selectable. DOM only: nothing here may touch three.js.
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import type { RosterNode } from '@cknerv/types';
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

/** The crawler's row, printed as-is. Three facts and no derivation: anything
 *  computed from them would be a claim the crawler did not make. */
export type SightedNodeRow = 'addr' | 'version' | 'dial';

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
  onClose,
  style,
}: SightedNodeCardProps) {
  const accent = SIGHTED_NODE_ACCENT;
  const id8 = node.node_id.slice(0, 8);

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
      role="region"
      aria-label={`Sighted node ${id8} probe`}
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
        filter: `drop-shadow(0 8px 16px rgba(0,0,0,.56)) drop-shadow(0 0 14px ${rgba(accent, 0.06)})`,
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
          padding: '9px 34px 8px 14px',
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
          SIGHTED // {id8}
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
        <span
          data-sighted-probe-last-seen
          style={{
            marginLeft: 'auto',
            color: HUD_COLORS.dim,
            fontSize: HUD_TYPE.label,
            letterSpacing: 0.9,
            whiteSpace: 'nowrap',
          }}
        >
          LAST SEEN {formatAge(node.last_seen_ms, atMs)}
        </span>
        <span style={{ position: 'absolute', top: 7, right: 28 }}>
          {moduleTag('SGHT·01')}
        </span>
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
          <SightedReadout
            row="version"
            label="VERSION"
            value={node.version || '—'}
          />
          {/* THEIR dial, never OUR ping: the number is a round trip from the
              crawler's vantage to this node, and it measures a link this
              dashboard does not have. The dossier's own copy of it stands
              down in this dialect so the figure prints once. */}
          {node.rtt_ms != null ? (
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
