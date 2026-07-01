import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { CHAIN_Y, chainNodeWorldPosition } from '../layout';
import { FONT_MONO } from '../ui/fonts';
import { fnv1a } from '../geometry/edgeBezier';
import { phaseFor } from './GlowNode';
import type { Peer } from '@cknerv/types';
import type { Vec3 } from '../types';
import {
  peerWorldPosition,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  peerCrystalSize,
  peerCrystalBrightness,
  PEER_COLORS,
  PEER_OUTER_RADIUS,
  rankPeers,
} from '../derives/peers.derive';
import CrystalGlow from './CrystalGlow';
import FlowBeam, { type FlowStyle } from './FlowBeam';
import BlockCourierLayer from './BlockCourierLayer';
import BlockDeliveryLayer from './BlockDeliveryLayer';

/** Fade-in / fade-out duration for peer churn (seconds). */
const FADE_S = 0.6;
/** World position of the local hub — peer belts flow to/from here. */
const HUB_POS: Vec3 = [0, CHAIN_Y, 0];
/** Forward (hub→peer) particle color = the LOCAL node's cyan. Shared. */
const LOCAL_FLOW_COLOR = new THREE.Color('#7df9ff');
/** Visual character of a peer's particle belt (tuned in the visual pass). */
const PEER_FLOW_STYLE: FlowStyle = {
  particleSize: 0.7,
  count: 84,
  speed: 0.08,
  jitter: 0.6,
  intensity: 1.3,
};
/** One unit-radius octahedron shared by every peer crystal (CrystalGlow
 *  scales it per-peer). Simpler/smaller than the LOCAL icosahedron so
 *  "peer vs local" reads at a glance. */
const PEER_GEOM = new THREE.OctahedronGeometry(1, 0);

interface RenderPeer {
  peer: Peer;
  pos: [number, number, number];
  bornAt: number; // simClock seconds
  deadAt: number | null;
}

interface PeerConstellationProps {
  peers: Peer[];
  /** Chain tip — drives per-peer sync size/brightness. */
  tip: number;
  /** Local node version — drives version-mismatch coloring. */
  localVersion: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Increments on each new block; triggers the inward convergence pulse. */
  blockPulseAtMs?: number;
  /** node_id of the peer that relays us this block (from blockArrivalSchedule). The
   *  entry peer animates the receive courier; null = none / no peers. */
  entryPeerId?: string | null;
  /** Per-peer arrival age (s since pulse) keyed by node_id (blockArrivalSchedule).
   *  Drives per-peer arrival timing in the courier + delivery layers. */
  arrivals?: Record<string, number>;
  /** Broadcast cascade (blockArrivalSchedule): node_id → the node its courier flies
   *  FROM. Drives the node→node broadcast couriers; entry peer maps to null. */
  senders?: Record<string, string | null>;
  /** Observed CKB node ids — their world positions are the delivery origins
   *  (boluses lob up from each into the cell canopy). Optional (default []) so
   *  the existing mount-smoke tests render without it; App always supplies it. */
  ckbNodeIds?: string[];
  /** Local node's delivery start age (s since pulse); from blockArrivalSchedule.
   *  Optional (default 0) for the same test-compat reason as `ckbNodeIds`. */
  localReceiveDelayS?: number;
  /** Galaxy flash buffers shared with CellGalaxy (cell.id → scene-seconds, and a
   *  dirty flag). When supplied, each delivered bolus ignites the cells it lands
   *  on. Optional: standalone mounts (tests) fall back to inert local refs. */
  cellFlashRef?: React.MutableRefObject<Map<number, number>>;
  flashDirtyRef?: React.MutableRefObject<boolean>;
}

export default function PeerConstellation({
  peers,
  tip,
  localVersion,
  selectedId,
  onSelect,
  blockPulseAtMs = 0,
  entryPeerId = null,
  arrivals = {},
  senders = {},
  ckbNodeIds = [],
  localReceiveDelayS = 0,
  cellFlashRef,
  flashDirtyRef,
}: PeerConstellationProps) {
  // Standalone mounts (tests, galaxy-less scenes) get inert local buffers so
  // the delivery layer never sees undefined refs; the real app supplies the
  // shared CellGalaxy buffers so boluses ignite the cells they land on.
  const fallbackFlashRef = useRef<Map<number, number>>(new Map());
  const fallbackDirtyRef = useRef(false);
  const deliveryFlashRef = cellFlashRef ?? fallbackFlashRef;
  const deliveryDirtyRef = flashDirtyRef ?? fallbackDirtyRef;
  // Retain recently-dropped peers briefly so they can fade out.
  const retainRef = useRef<Map<string, RenderPeer>>(new Map());
  const [render, setRender] = useState<RenderPeer[]>([]);
  const prevPeersRef = useRef<Peer[]>([]);

  useEffect(() => {
    const ranked = rankPeers(peers);
    const churn = peerChurnDiff(prevPeersRef.current, ranked);
    prevPeersRef.current = ranked;
    const now = simClock.elapsedSec;
    const map = retainRef.current;
    // Upsert live peers (revive any that were fading out).
    for (const p of ranked) {
      const existing = map.get(p.node_id);
      // Position depends only on node_id + latency_ms; reuse the prior
      // `pos` reference when latency is unchanged so the child FlowBeam's
      // Bezier-control memo (and its per-frame curve reads) stay stable
      // across no-op polls (no churn/realloc).
      const pos =
        existing && existing.peer.latency_ms === p.latency_ms
          ? existing.pos
          : peerWorldPosition(p);
      map.set(p.node_id, {
        peer: p,
        pos,
        bornAt: existing && existing.deadAt === null ? existing.bornAt : now,
        deadAt: null,
      });
    }
    // Mark dropped peers as dying.
    for (const p of churn.dropped) {
      const existing = map.get(p.node_id);
      if (existing && existing.deadAt === null) existing.deadAt = now;
    }
    setRender(Array.from(map.values()));
  }, [peers]);

  // Per-block pulse: the frame loop reads `at` (when it fired) and `entryId` (which
  // peer relays us the block). Per-peer arrival times come from the `arrivals` prop.
  const pulseRef = useRef<{ at: number; entryId: string | null } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs > lastPulseRef.current) {
      lastPulseRef.current = blockPulseAtMs;
      pulseRef.current = {
        at: simClock.elapsedSec,
        entryId: entryPeerId ?? null,
      };
    }
    // entryPeerId is read from the latest closure when blockPulseAtMs advances (App
    // updates both from the same cells-cache render), so [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // When a dropped peer finishes fading, drop it from the retain map and
  // re-render so its PeerNode unmounts promptly (firing FlowBeam's
  // geometry/material dispose) instead of lingering until the next ~4s
  // [peers] snapshot.
  const onExpire = (nodeId: string) => {
    if (retainRef.current.delete(nodeId)) {
      setRender(Array.from(retainRef.current.values()));
    }
  };

  // Peers hidden by the render cap; surfaced as a faint rim marker so the
  // scene hints that the constellation is summarized (spec §6).
  const hiddenCount = peers.length - render.length;

  // node_id → world position, to resolve each peer's broadcast sender into a
  // start point for its inbound courier.
  const posById = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const rp of render) m.set(rp.peer.node_id, rp.pos);
    return m;
  }, [render]);

  // World positions of the observed CKB nodes — the bolus delivery origins.
  // Same seed/count contract as CellGalaxy's icosahedra so boluses launch from
  // exactly where the nodes are drawn.
  const localOrigins = useMemo(
    () =>
      ckbNodeIds.map((_, idx) =>
        chainNodeWorldPosition(idx, Math.max(1, ckbNodeIds.length)),
      ),
    [ckbNodeIds],
  );

  return (
    <group>
      {render.map((rp) => (
        <PeerNode
          key={rp.peer.node_id}
          rp={rp}
          tip={tip}
          localVersion={localVersion}
          selected={selectedId === `peer:${rp.peer.node_id}`}
          onSelect={onSelect}
          pulseRef={pulseRef}
          blockPulseAtMs={blockPulseAtMs}
          onExpire={onExpire}
        />
      ))}
      <BlockCourierLayer
        posById={posById}
        senders={senders}
        arrivals={arrivals}
        entryId={entryPeerId}
        pulseRef={pulseRef}
        hubPos={HUB_POS}
      />
      <BlockDeliveryLayer
        posById={posById}
        arrivals={arrivals}
        localOrigins={localOrigins}
        localReceiveDelayS={localReceiveDelayS}
        pulseRef={pulseRef}
        cellFlashRef={deliveryFlashRef}
        flashDirtyRef={deliveryDirtyRef}
      />
      {hiddenCount > 0 && (
        <Billboard position={[0, CHAIN_Y, PEER_OUTER_RADIUS * 0.9]}>
          <Text
            font={FONT_MONO}
            fontSize={3}
            color="#5b6b86"
            anchorX="center"
            anchorY="middle"
          >
            {`+${hiddenCount} more`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

function PeerNode({
  rp,
  tip,
  localVersion,
  selected,
  onSelect,
  pulseRef,
  blockPulseAtMs,
  onExpire,
}: {
  rp: RenderPeer;
  tip: number;
  localVersion: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  pulseRef: React.MutableRefObject<{ at: number; entryId: string | null } | null>;
  blockPulseAtMs: number;
  onExpire: (nodeId: string) => void;
}) {
  // Crystal + ambient-flow intensity (churn fade × sync brightness), each read
  // every frame by its child via the ref so fades don't trigger React
  // re-renders.
  const intensityRef = useRef(1);
  const flowIntensityRef = useRef(1);

  const color = useMemo(() => {
    const [r, g, b] = PEER_COLORS[peerColorKind(rp.peer, localVersion)];
    return new THREE.Color(r, g, b);
  }, [rp.peer, localVersion]);

  // Deterministic per-peer Bezier seed + twinkle phase.
  const seed = useMemo(() => fnv1a(rp.peer.node_id), [rp.peer.node_id]);
  const phase = useMemo(() => phaseFor(rp.peer.node_id), [rp.peer.node_id]);

  const sync = syncProximity(rp.peer.best_known, tip);
  const size = peerCrystalSize(sync);
  const brightness = peerCrystalBrightness(sync);

  // Fire onExpire exactly once, at the single frame a fade-out hits alpha 0.
  const expiredRef = useRef(false);

  useSimFrame(() => {
    const now = simClock.elapsedSec;
    // Fade in (bornAt) / out (deadAt); purge when fully faded.
    let alpha = Math.min(1, (now - rp.bornAt) / FADE_S);
    if (rp.deadAt !== null) {
      alpha = Math.max(0, 1 - (now - rp.deadAt) / FADE_S);
      if (alpha <= 0) {
        if (!expiredRef.current) {
          expiredRef.current = true;
          onExpire(rp.peer.node_id);
        }
        return;
      }
    }
    intensityRef.current = alpha * brightness;
    flowIntensityRef.current = alpha * brightness; // ambient flow (no surge)
  });

  return (
    <group>
      <FlowBeam
        from={HUB_POS}
        to={rp.pos}
        colorSource={LOCAL_FLOW_COLOR}
        colorTarget={color}
        style={PEER_FLOW_STYLE}
        seed={seed}
        phase={phase}
        intensityRef={flowIntensityRef}
      />
      <group position={rp.pos}>
        <CrystalGlow
          geom={PEER_GEOM}
          size={size}
          color={color}
          intensityRef={intensityRef}
          seed={rp.peer.node_id}
          selected={selected}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(`peer:${rp.peer.node_id}`);
          }}
        />
      </group>
    </group>
  );
}
