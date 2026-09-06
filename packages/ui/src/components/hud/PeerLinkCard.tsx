// LINK PROBE — the peer dialect of the floating inspection constellation.
//
// The Cell card is a specimen scan; this one is communications telemetry. It
// is DOM/SVG only and renders as a Canvas sibling, so nothing here may touch
// three.js. Every instrument decodes an encoding the colony is already drawing
// (ring = latency, bearing = id hash, tint = version/direction), which is what
// makes the card an explanation of the scene rather than a second opinion.
//
// Instruments update at data cadence only — the 4s adapter poll and the block
// pulse; the shared HUD clock's 1 Hz tick reaches only the two spans that
// print a time. No animation loops: motion is CSS transitions, so an open
// card costs nothing per frame beyond the shared anchor transform write.
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Peer } from '@cknerv/types';
import { useHudClockSelector } from './hudClock';
import { CJK_BASELINE_LIFT, COMPANION_OPACITY, HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba, STALE_OPACITY } from './hudTheme';
import {
  CloseButton,
  DiamondMark,
  moduleTag,
  PLATE_ROW_RAIL_ALPHA,
  PlateReadoutRow,
  plateStateChip,
  SpatialPlateHeader,
  spatialPlate,
  stackedSatelliteBase,
} from './primitives';
import PeerSightingPlate, { type PeerSightingState } from './PeerSightingPlate';
import { NODE_SELF_ACCENT } from './NodeSelfCard';
import { MiningCandidacyStamp } from './MinerNodeCard';
import type { PeerMiningCandidacy } from '../../derives/blockProducers.derive';
import { PEER_LATENCY_CAP_MS } from '../../derives/peers.derive';
import {
  derivePeerLinkInstrument,
  formatLinkUptime,
  PEER_LINK_FACETS,
  PEER_LINK_UNKNOWN,
  type PeerLinkFacet,
  type PeerLinkFactRow,
} from '../../derives/peerLinkInstrument.derive';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the probe is a readout, not a specimen scan; it stays narrow
 *  enough to sit beside its node without covering the colony. */
const CARD_WIDTH_PX = 340;

/** Compass viewBox is square; the rim is the latency cap ring. */
const COMPASS_VIEW_PX = 128;
const COMPASS_CENTER = COMPASS_VIEW_PX / 2;
const COMPASS_RIM = 52;
const COMPASS_RINGS = [0.25, 0.5, 0.75, 1] as const;
/** Where the direction arrow sits along the center↔blip chord. */
const COMPASS_ARROW_T = 0.58;

const PING_HISTORY_CAP = 24;
const PING_VIEW_W = 120;
const PING_VIEW_H = 26;
/** The first sample's own form. A series of one has no shape and no scale —
 *  its single value IS the peak, so a bar drawn against it fills the strip
 *  edge to edge and top to bottom, and a solid block is what a reader sees on
 *  every card they open in the first four seconds of a link. A tick says the
 *  same true thing (one sample has landed, at the head of the series) and
 *  claims nothing about a magnitude the instrument cannot yet draw; the
 *  header, one line up, prints the number itself. */
const PING_TICK_W = 2;
const PING_TICK_H = 9;

export type PeerLinkLayoutSide = SceneInspectorPlacementSide;

export interface PeerLinkCardProps {
  peer: Peer;
  /** Local chain tip the sync ladder measures the peer against. */
  tip: number;
  /** Our own client version — the reference every mismatch is judged from. */
  localVersion: string;
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: PeerLinkLayoutSide;
  /** The peer has left `peers[]`; the card is showing a retained snapshot.
   *  Presentation only — retention and dismissal live with the overlay. */
  linkLost?: boolean;
  /** How the source's crawler last saw this peer. Omitted whenever the source
   *  advertises no `peer_sighting` capability — the dossier is additive, and a
   *  CKB-only probe is a complete card without it. */
  sighting?: PeerSightingState;
  /** Whether this peer runs a build one of the chain's recent producers
   *  declared. Absent for all but a handful of peers, and never a claim that
   *  this one mines — see `MiningCandidacyStamp`. */
  candidacy?: PeerMiningCandidacy | null;
  /** Mirrors the selected fact into the scene-to-card connector tint. */
  onFacetChange?: (facet: PeerLinkFacet | null) => void;
  onClose: () => void;
  style?: CSSProperties;
}

function blocks(n: number): string {
  return n.toLocaleString('en-US');
}

type PeerScanFactProps = PeerLinkFactRow & {
  selected: boolean;
  onActivate: () => void;
};

/** One line fact, in the house's readout grammar (report C, C-7).
 *
 *  It used to be its own layout — a micro label stacked OVER a `label` value,
 *  two facts to a row — and the divergence was argued on MEASURE: at 340 px,
 *  two columns of address cannot carry cell-card type. That argument fell with
 *  its premise. One fact per line has the whole 340 px column, so the value
 *  sits at the probe tier every other row of every other network card is set
 *  in, right-aligned against a label on the left, on the same hairline rail.
 *  The same address that had to be shortened to share a line now prints whole.
 *
 *  What made it a different SHAPE was that it is a control — a fact tints the
 *  scene tether — and a readout row had no way to say so. It has one now: the
 *  rail's hot rung (C4) lives in `PlateReadoutRow`, so this is the house
 *  sentence with the house affordance rather than a second grammar carrying
 *  one. A sighted node promoted to a peer no longer re-lays its ADDR and
 *  VERSION as it crosses dialects. */
const PeerScanFact = memo(function PeerScanFact({
  facet,
  label,
  value,
  color,
  selected,
  onActivate,
}: PeerScanFactProps) {
  // A fact with no colour of its own — ADDR, UPTIME — is still a reading off
  // this link, so it falls back to the peer plane's own wire rather than to a
  // neutral cyan fifteen units away from it. That "neutral" was
  // indistinguishable from the family it sat inside, which made it drift
  // wearing a rule's clothes. Facts that DO carry a colour (direction, version
  // mismatch, sync state) keep speaking for themselves.
  const accent = color ?? HUD_COLORS.peerWire;
  return (
    <PlateReadoutRow
      accent={accent}
      label={label}
      value={value}
      valueColor={selected ? accent : color ?? HUD_COLORS.ink}
      rowAttributes={{
        'data-peer-probe-fact': facet,
        'data-peer-probe-fact-state': selected ? 'focused' : 'resolved',
      }}
      valueAttributes={{ 'data-peer-probe-fact-value': facet }}
      selected={selected}
      onActivate={onActivate}
    />
  );
}, (previous, next) => (
  previous.facet === next.facet
  && previous.label === next.label
  && previous.value === next.value
  && previous.color === next.color
  && previous.selected === next.selected
));

/** `LINKED · 1h 2m` as a leaf: the base is the last poll's snapshot, the rest
 *  is the shared HUD clock counting from the instant the card took it, and a
 *  lost link (`sinceMs` null) prints the base alone. */
function LinkUptimeReadout({ baseMs, sinceMs }: { baseMs: number; sinceMs: number | null }) {
  const text = useHudClockSelector((clock) => formatLinkUptime(
    baseMs + (sinceMs === null ? 0 : Math.max(0, clock - sinceMs)),
  ));
  return <>{text}</>;
}

/** The colony compass: our node at the center, the peer on its true latency
 *  ring at its true bearing. The scene lays measured peers out on the XZ plane
 *  (`measuredPeerPos`: x = cos·r, z = sin·r) under a top-down camera, so SVG's
 *  y-down axis already IS the scene's +Z — the bearing needs no remapping for
 *  the instrument to agree with the colony.
 *
 *  ⟨ruling 24⟩ The CENTRE agrees again as well: the belt hangs off the local
 *  anchor, so this diagram's middle is the scene's middle for the one reading
 *  it makes. A blip at four o'clock here is the mark at four o'clock out
 *  there, measured from us in both places. */
function ColonyCompass({
  ring01,
  bearingRad,
  inbound,
  measured,
  accent,
  dimmed,
}: {
  ring01: number;
  bearingRad: number;
  inbound: boolean;
  measured: boolean;
  accent: string;
  dimmed: boolean;
}) {
  const radius = COMPASS_RIM * ring01;
  const blipX = COMPASS_CENTER + Math.cos(bearingRad) * radius;
  const blipY = COMPASS_CENTER + Math.sin(bearingRad) * radius;
  const arrowX = COMPASS_CENTER + Math.cos(bearingRad) * radius * COMPASS_ARROW_T;
  const arrowY = COMPASS_CENTER + Math.sin(bearingRad) * radius * COMPASS_ARROW_T;
  // Inbound: they dialed us, so the arrow runs toward the center.
  const arrowDeg = ((inbound ? bearingRad + Math.PI : bearingRad) * 180) / Math.PI;
  return (
    <svg
      data-peer-probe-compass
      data-peer-probe-compass-state={measured ? 'measured' : 'unmeasured'}
      viewBox={`0 0 ${COMPASS_VIEW_PX} ${COMPASS_VIEW_PX}`}
      width={COMPASS_VIEW_PX}
      height={COMPASS_VIEW_PX}
      role="img"
      aria-label={measured ? 'Peer position on the latency compass' : 'Peer latency unmeasured'}
      style={{ display: 'block', margin: '0 auto', opacity: dimmed ? STALE_OPACITY : 1, transition: `opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.fadeEase}` }}
    >
      {COMPASS_RINGS.map((ring) => (
        <circle
          key={ring}
          cx={COMPASS_CENTER}
          cy={COMPASS_CENTER}
          r={COMPASS_RIM * ring}
          fill="none"
          stroke={rgba(HUD_COLORS.peerWire, ring === 1 ? 0.34 : 0.14)}
          strokeWidth={ring === 1 ? 1 : 0.6}
        />
      ))}
      {measured ? null : (
        // The scene parks unmeasured peers on the mid ring; the dashed rim
        // says that ring is a fallback, not a measurement. The DASH is the
        // whole argument and it stays; the HUE was the unexamined half. It was
        // `caution`, which said a peer whose first ping has not come back is a
        // degraded link — and a live peer we have not timed yet is neither
        // broken nor anybody's to fix. Steel, for the reason `SightedNodeCard`
        // states outright: the alarm colours belong to links that broke, and
        // this one has not. Carried at a higher alpha than the yellow it
        // replaces because steel is the darker token — the rim keeps the
        // weight it had, on a layer that is not making a claim.
        <circle
          data-peer-probe-unmeasured-ring
          cx={COMPASS_CENTER}
          cy={COMPASS_CENTER}
          r={COMPASS_RIM * 0.5}
          fill="none"
          stroke={rgba(HUD_COLORS.dim, 0.7)}
          strokeWidth={1}
          strokeDasharray="3 4"
        />
      )}
      {/* US. The dot at the middle of the compass is this node, the same
          entity the NODE card is a dossier of and the same icosahedron the
          scene draws — so it wears `NODE_SELF_ACCENT`, the chain anchor's own
          edge, rather than a generic instrument cyan. One entity, one colour,
          across every card that draws it.

          And that colour is `#7DF9FF` to the byte, which is also
          `PEER_NETWORK_HEX.outbound`: on the compass of any outbound peer the
          two ends of the link resolve to one hex, on the one instrument whose
          whole job is to show two ends of a link. Separating them in the
          PALETTE is a ruling of its own and is not this one — the cyan/teal
          corridor is full (cyanWire, peerWire, outbound, inbound, coldWhite,
          cyanInk), every bright candidate there reads as status green, and the
          one clear cyan left is too dark for a frame carrying a text glow.

          So they are told apart by FORM, which is the escalation this HUD
          already uses when it has run out of colour — `crit` gives up on being
          a louder red and grows hazard banding instead. Us is a HOLE: the
          ground read back through a ringed mark, which is exactly what the
          status strip's scrubber markers do to sit on their track as a hole
          rather than a bead. The peer is a bead. Two marks, one hex, and a
          reader can say which is which without being told. */}
      <circle
        data-peer-probe-self
        data-peer-probe-self-form="hole"
        cx={COMPASS_CENTER}
        cy={COMPASS_CENTER}
        r={3.2}
        fill={HUD_COLORS.ground}
        stroke={NODE_SELF_ACCENT}
        strokeWidth={1.4}
      />
      <circle
        cx={COMPASS_CENTER}
        cy={COMPASS_CENTER}
        r={6.5}
        fill="none"
        stroke={rgba(NODE_SELF_ACCENT, 0.4)}
        strokeWidth={0.7}
      />
      {measured ? (
        <>
          <line
            x1={COMPASS_CENTER}
            y1={COMPASS_CENTER}
            x2={blipX}
            y2={blipY}
            stroke={rgba(accent, 0.45)}
            strokeWidth={0.8}
          />
          <polygon
            data-peer-probe-compass-arrow={inbound ? 'inbound' : 'outbound'}
            points="-4,-3.1 4.2,0 -4,3.1"
            fill={accent}
            opacity={0.9}
            transform={`translate(${arrowX} ${arrowY}) rotate(${arrowDeg})`}
          />
          <circle
            data-peer-probe-blip
            cx={blipX}
            cy={blipY}
            r={4.2}
            fill={accent}
            stroke={rgba(accent, 0.35)}
            strokeWidth={4}
          />
        </>
      ) : (
        <text
          x={COMPASS_CENTER}
          y={COMPASS_CENTER + COMPASS_RIM * 0.5 + 12}
          textAnchor="middle"
          fill={HUD_COLORS.dim}
          fontFamily={HUD_FONTS.mono}
          fontSize={HUD_TYPE.micro}
          letterSpacing={0.9}
        >
          UNMEASURED
        </text>
      )}
      <text
        x={COMPASS_CENTER}
        y={COMPASS_CENTER - COMPASS_RIM - 3}
        textAnchor="middle"
        fill={HUD_COLORS.dim}
        fontFamily={HUD_FONTS.mono}
        fontSize={HUD_TYPE.micro}
        letterSpacing={0.9}
      >
        {PEER_LATENCY_CAP_MS}MS RIM
      </text>
      {/* What the two axes of this instrument MEAN (report C, C-12). The ring
          was labelled and the angle was not, so a reader had every reason to
          take a blip at four o'clock for a direction — and it is a hash of the
          node id, which is also how the scene places the mark. The other two
          dialects disclaim their placement in a footer (`POSITION IS SCENE
          PLACEMENT`); this card's angle is equally invented and said nothing.
          Under the rim rather than in a footer because it is a legend for the
          instrument above it, not a caveat about the card. */}
      <text
        data-peer-probe-compass-legend
        x={COMPASS_CENTER}
        y={COMPASS_VIEW_PX - 1.5}
        textAnchor="middle"
        fill={HUD_COLORS.dim}
        fontFamily={HUD_FONTS.mono}
        fontSize={HUD_TYPE.micro}
        letterSpacing={0.9}
      >
        RING · PING · BEARING · ID HASH
      </text>
    </svg>
  );
}

/** Every latency sample seen while the card has been open. The adapter polls
 *  every ~4s, so this fills at the rate the node actually re-pings. */
function PingStrip({
  samples,
  accent,
  flatlined,
}: {
  samples: readonly number[];
  accent: string;
  flatlined: boolean;
}) {
  const count = samples.length;
  const peak = count > 0 ? Math.max(...samples) : 0;
  const floor = count > 0 ? Math.min(...samples) : 0;
  const slot = PING_VIEW_W / Math.max(1, count);
  const scale = Math.max(peak, 1);
  // One sample is its own state, and the header says so too: `51–51 MS` is a
  // range with no width, which reads as a measurement that came back twice.
  const single = count === 1;
  const state = flatlined ? 'flatlined' : count === 0 ? 'empty' : single ? 'single' : 'live';
  return (
    <div data-peer-probe-ping data-peer-probe-ping-state={state}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.9, color: HUD_COLORS.dim }}>
        <span style={{ color: HUD_COLORS.cyanInk, fontFamily: HUD_FONTS.tech, letterSpacing: 1.2 }}>PING STRIP</span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {count === 0
            ? `AWAITING SAMPLES · 0/${PING_HISTORY_CAP}`
            : single
              ? `${peak} MS · 1/${PING_HISTORY_CAP}`
              : `${floor}–${peak} MS · ${count}/${PING_HISTORY_CAP}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${PING_VIEW_W} ${PING_VIEW_H}`}
        preserveAspectRatio="none"
        width="100%"
        height={PING_VIEW_H}
        aria-hidden="true"
        style={{ display: 'block', opacity: flatlined ? 0.32 : 1, transition: `opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.fadeEase}` }}
      >
        <line x1={0} y1={PING_VIEW_H - 0.5} x2={PING_VIEW_W} y2={PING_VIEW_H - 0.5} stroke={rgba(HUD_COLORS.peerWire, 0.22)} strokeWidth={1} />
        {flatlined ? (
          <line
            data-peer-probe-ping-flatline
            x1={0}
            y1={PING_VIEW_H / 2}
            x2={PING_VIEW_W}
            y2={PING_VIEW_H / 2}
            stroke={rgba(HUD_COLORS.caution, 0.72)}
            strokeWidth={1}
            strokeDasharray="5 3"
          />
        ) : null}
        {single ? (
          <rect
            data-peer-probe-ping-tick
            x={0.6}
            y={PING_VIEW_H - PING_TICK_H}
            width={PING_TICK_W}
            height={PING_TICK_H}
            fill={rgba(accent, 0.72)}
          />
        ) : samples.map((value, index) => {
          const height = 2 + (Math.min(value, scale) / scale) * (PING_VIEW_H - 4);
          return (
            <rect
              // Samples are a positional series: index IS the identity.
              key={index}
              x={index * slot + 0.6}
              y={PING_VIEW_H - height}
              width={Math.max(0.8, slot - 1.2)}
              height={height}
              fill={rgba(accent, 0.72)}
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function PeerLinkCard({
  peer,
  tip,
  localVersion,
  layoutSide = 'left',
  linkLost = false,
  sighting,
  candidacy,
  onFacetChange,
  onClose,
  style,
}: PeerLinkCardProps) {
  const instrument = useMemo(
    () => derivePeerLinkInstrument(peer, tip, localVersion),
    [peer, tip, localVersion],
  );
  // A lost link is no longer describable by its own tint: the card speaks
  // caution until the overlay retires it.
  const accent = linkLost ? HUD_COLORS.caution : instrument.accent;

  const [selectedFacetState, setSelectedFacetState] = useState<{
    nodeId: string;
    facet: PeerLinkFacet | null;
  }>(() => ({ nodeId: peer.node_id, facet: null }));
  const selectedFacet = selectedFacetState.nodeId === peer.node_id
    ? selectedFacetState.facet
    : null;

  const [pings, setPings] = useState<{ nodeId: string; samples: number[] }>(
    () => ({
      nodeId: peer.node_id,
      samples: instrument.latencyMs == null ? [] : [instrument.latencyMs],
    }),
  );
  // The uptime counts from the last poll's snapshot, and the count starts
  // over whenever that snapshot or the link changes — the instant the
  // interval this replaces took as its origin. A lost link freezes it: no
  // seconds are invented for a peer we are no longer connected to, and the
  // dossier's clock freezes at the same instant, exactly as it did when one
  // interval carried both. The seconds themselves are the shared HUD clock's,
  // read by the two spans that print them and by nothing else on the card.
  const [uptimeEpochMs, setUptimeEpochMs] = useState(() => Date.now());

  useEffect(() => {
    onFacetChange?.(selectedFacet);
  }, [onFacetChange, selectedFacet]);

  // One sample per observed latency change. The effect's own dependencies are
  // the dedupe: an unchanged reading is not a new measurement, and a peer swap
  // starts a fresh history rather than splicing two links into one series.
  const latencySample = instrument.latencyMs;
  useEffect(() => {
    setPings((current) => {
      if (current.nodeId !== peer.node_id) {
        return { nodeId: peer.node_id, samples: latencySample == null ? [] : [latencySample] };
      }
      if (latencySample == null) return current;
      if (current.samples[current.samples.length - 1] === latencySample) return current;
      const samples = [...current.samples, latencySample];
      return {
        nodeId: current.nodeId,
        samples: samples.length > PING_HISTORY_CAP
          ? samples.slice(samples.length - PING_HISTORY_CAP)
          : samples,
      };
    });
  }, [peer.node_id, latencySample]);

  useEffect(() => {
    setUptimeEpochMs(Date.now());
  }, [peer.node_id, instrument.uptimeMs, linkLost]);
  const uptimeSinceMs = linkLost ? null : uptimeEpochMs;

  const activateFacet = (facet: PeerLinkFacet) => {
    setSelectedFacetState((current) => ({
      nodeId: peer.node_id,
      facet: current.nodeId === peer.node_id && current.facet === facet ? null : facet,
    }));
  };

  const factByFacet = useMemo(() => {
    const map = new Map<PeerLinkFacet, PeerLinkFactRow>();
    instrument.facts.forEach((fact) => map.set(fact.facet, fact));
    return map;
  }, [instrument]);

  const pingSamples = pings.nodeId === peer.node_id ? pings.samples : [];
  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';

  return (
    <div
      data-peer-probe-card
      data-peer-probe-layout={verticalLayout ? 'vertical' : layoutSide}
      data-peer-probe-link={linkLost ? 'lost' : 'live'}
      role="region"
      aria-label={`Peer ${instrument.id8} link probe`}
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
        // card — never a filter surface per plate.
        filter: `drop-shadow(0 8px 16px ${rgba(HUD_COLORS.ground, 0.56)})`,
        ...style,
      }}
    >
      <section
        data-peer-probe-module="header"
        style={{
          ...stackedSatelliteBase,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 8px',
          padding: linkLost ? '22px 20px 8px 14px' : '9px 20px 8px 14px',
          ...spatialPlate(accent),
        }}
      >
        {linkLost ? (
          <span
            data-peer-probe-banner="link-lost"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              padding: '2px 10px',
              background: rgba(HUD_COLORS.caution, 0.16),
              borderBottom: `1px solid ${rgba(HUD_COLORS.caution, 0.5)}`,
              color: HUD_COLORS.caution,
              fontFamily: HUD_FONTS.tech,
              fontSize: HUD_TYPE.label,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            LINK LOST
          </span>
        ) : null}
        <span
          title={peer.node_id}
          style={{
            color: accent,
            fontFamily: HUD_FONTS.display,
            fontSize: HUD_TYPE.title,
            fontWeight: 600,
            letterSpacing: 1.6,
            textShadow: `0 0 9px ${rgba(accent, 0.45)}`,
          }}
        >
          PEER // {instrument.id8}
        </span>
        <span style={{ ...CJK_BASELINE_LIFT, color: accent, fontFamily: HUD_FONTS.cjk, fontWeight: 400, fontSize: HUD_TYPE.label, opacity: COMPANION_OPACITY }}>
          对端
        </span>
        {/* THE EVIDENCE CLASS, which is what this slot answers on all four
          * network dialects (report C, C-5): LINKED · SELF · NAMED · CHAIN
          * ATTESTED. It used to print IN/OUT, so the same bordered word was a
          * link DIRECTION here, a node's ROLE on the self card, a link STATE
          * on the sighted card and an evidence class on the cohort's — four
          * questions in one slot, and a reader learns the slot from whichever
          * card they open first.
          *
          * Nothing is lost: the direction is drawn by the compass arrow, which
          * points at us for an inbound link, and printed in full by the
          * DIRECTION row of LINE FACTS. It was the one fact on this card
          * already stated three times. */}
        <span
          data-peer-probe-evidence="linked"
          style={plateStateChip(accent)}
        >
          LINKED
        </span>
        {/* Status and module stamp travel as ONE right-hand group, in flow —
          * the CELL masthead's grammar (`CellDetailPanel.tsx`), and for the
          * reason it adopted it. The stamp used to be absolutely placed while
          * the uptime beside it was a flow span pushed right by `marginLeft`,
          * so the two were laid out by different mechanisms and a long enough
          * age simply slid underneath the tag. In one group they push each
          * other, and wrap together when the card runs out of measure. Only
          * the × stays absolute, and the padding clears only the ×. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          <span
            data-peer-probe-uptime
            style={{
              color: linkLost ? HUD_COLORS.caution : HUD_COLORS.dim,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.9,
            }}
          >
            LINKED · <LinkUptimeReadout baseMs={instrument.uptimeMs} sinceMs={uptimeSinceMs} />
          </span>
          {moduleTag('LINK·01')}
        </span>
        {/* The mining question, on its own line under the masthead — the same
            place `NodeSelfCard` stamps the role it can actually MEASURE. Not in
            LINE FACTS, which are readings off this link: nothing about this
            peer's connection says anything about mining, and the join that
            produced this sentence never touched the wire. It is a question and
            it carries the size of the set it is asked over; there is no
            arrangement of it that says this peer mines. */}
        {candidacy ? <MiningCandidacyStamp candidacy={candidacy} /> : null}
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      <section
        aria-label="Colony signal compass"
        data-peer-probe-module="signal"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(HUD_COLORS.peerWire),
        }}
      >
        <SpatialPlateHeader
          en="SIGNAL"
          accent={HUD_COLORS.peerWire}
          status={moduleTag('LINK·02')}
        />
        <ColonyCompass
          ring01={instrument.ring01}
          bearingRad={instrument.bearingRad}
          inbound={instrument.direction === 'inbound'}
          measured={instrument.latencyKnown}
          accent={accent}
          dimmed={linkLost}
        />
        <div style={{ marginTop: 6 }}>
          <PingStrip samples={pingSamples} accent={accent} flatlined={linkLost} />
        </div>
      </section>

      <section
        aria-label="Sync ladder"
        data-peer-probe-module="sync"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(instrument.sync.color),
        }}
      >
        <SpatialPlateHeader
          en="SYNC LADDER"
          accent={instrument.sync.color}
          status={moduleTag('LINK·03')}
        />
        <div
          style={{
            position: 'relative',
            paddingLeft: 11,
            borderLeft: `1px solid ${rgba(instrument.sync.color, PLATE_ROW_RAIL_ALPHA)}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
              LOCAL
            </span>
            <span data-peer-probe-sync-local style={{ marginLeft: 'auto', fontSize: HUD_TYPE.value, color: HUD_COLORS.cyanInk }}>
              #{blocks(instrument.localTip)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, marginTop: 2 }}>
            <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
              PEER
            </span>
            <span data-peer-probe-sync-peer style={{ marginLeft: 'auto', fontSize: HUD_TYPE.value, color: instrument.sync.color }}>
              {instrument.peerBest == null ? PEER_LINK_UNKNOWN : `#${blocks(instrument.peerBest)}`}
            </span>
          </div>
          {/* The LOCAL rung of the ladder is us again — same entity, same
              anchor colour as the compass centre and the NODE card, and now
              the same FORM (report C, C-8). It was a filled diamond in the
              anchor's cyan sitting twenty lines under a compass that draws us
              as a HOLE, so the card answered "which of these is us" two
              different ways: a hole above, a bead below, in one hex that every
              outbound peer also wears. Ground fill, accent stroke — us is the
              mark you can see through, everywhere on the card. */}
          <DiamondMark
            color={NODE_SELF_ACCENT}
            size={6}
            fill="ground"
            glow={false}
            attrs={{ 'data-peer-probe-self': 'true', 'data-peer-probe-self-form': 'hole' }}
            style={{ position: 'absolute', left: -3.5, top: 4 }}
          />
          <DiamondMark
            color={instrument.sync.color}
            size={6}
            fill="solid"
            glow={false}
            style={{ position: 'absolute', left: -3.5, top: 21 }}
          />
        </div>
        <div
          data-peer-probe-sync-state={instrument.sync.state}
          style={{
            marginTop: 7,
            padding: '2px 7px',
            border: `1px solid ${rgba(instrument.sync.color, 0.6)}`,
            background: rgba(instrument.sync.color, instrument.sync.state === 'ahead' ? 0.2 : 0.09),
            color: instrument.sync.color,
            fontFamily: HUD_FONTS.tech,
            fontSize: HUD_TYPE.label,
            fontWeight: 700,
            letterSpacing: 2,
            textAlign: 'center',
            // AHEAD is the loudest rung: the peer is past us, so WE are the
            // node that lags. Re-locking to the tip is a colour/box change,
            // never an animation loop.
            boxShadow: instrument.sync.state === 'ahead'
              ? `0 0 12px ${rgba(instrument.sync.color, 0.45)}`
              : undefined,
            transition: `background ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, box-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, color ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`,
          }}
        >
          {instrument.sync.label}
        </div>
      </section>

      {/* The poll that opened this card already carried every reading here,
          so the facts stand at once — a progress meter over data we hold
          would be a fiction, and it would gate the selector behind it. */}
      <section
        aria-label="Link facts"
        data-peer-probe-module="facts"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 10px 9px 14px',
          // LINE FACTS are network readings, so the plate joins SIGNAL and the
          // sighting dossier on `peerWire`. Three of this card's four plates
          // now speak the peer plane's colour and the fourth is the sync
          // ladder, which is coloured by a state on purpose.
          ...spatialPlate(HUD_COLORS.peerWire),
        }}
      >
        <SpatialPlateHeader
          en="LINE FACTS"
          accent={HUD_COLORS.peerWire}
          status={moduleTag('LINK·04')}
        />
        {/* One fact per line, the way every other plate of every other network
            card lays a reading out. Two to a row was what forced this card's
            own type rung; the column is the whole measure now. */}
        <div style={{ display: 'grid', rowGap: 3 }}>
          {PEER_LINK_FACETS.map((facet) => {
            const fact = factByFacet.get(facet);
            if (!fact) return null;
            return (
              <PeerScanFact
                key={facet}
                {...fact}
                selected={facet === selectedFacet}
                onActivate={() => activateFacet(facet)}
              />
            );
          })}
        </div>
      </section>

      {/* The link ends at LINE FACTS; everything below it was observed by
          someone else, from outside, at another time. A lost link keeps it:
          the dossier describes the node, not the connection that dropped. */}
      {sighting ? (
        <PeerSightingPlate
          {...sighting}
          module="LINK·05"
          nowMs={linkLost ? uptimeEpochMs : undefined}
          liveVersion={peer.version}
          linkAgeMs={instrument.uptimeMs}
          linkAgeSinceMs={uptimeSinceMs}
          liveRttMs={instrument.latencyMs}
        />
      ) : null}
    </div>
  );
}
