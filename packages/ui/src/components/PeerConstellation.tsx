import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { CHAIN_Y, CELLS_Y } from '../layout';
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
  courierLeg,
  beamShapeJitter,
  PEER_COLORS,
  PEER_OUTER_RADIUS,
  rankPeers,
  BLOCK_BROADCAST_HOP_S,
  BLOCK_RELAY_HOP_S,
} from '../derives/peers.derive';
import { BEAM_GROW_DUR_S, BEAM_HOLD_DUR_S, BEAM_STRIKE_DUR_S } from '../ui/topologyConstants';
import { BEAM_FLOW_SPEED } from '../materials/blockBeamMaterial';
import CrystalGlow from './CrystalGlow';
import FlowBeam, { type FlowStyle } from './FlowBeam';
import BlockBeam from './BlockBeam';

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
/** Block courier: a wireframe cube ("a block") that flies node→node via CrystalGlow
 *  — the nodes-layer language, distinct from the soft particles. One unit cube shared
 *  by all couriers; sized up so the broadcast flights are easy to follow. */
const BLOCK_GEOM = new THREE.BoxGeometry(1, 1, 1);
const BLOCK_SIZE = 1.6;
const BLOCK_COLOR = new THREE.Color('#d8faff');

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
   *  Each peer fires its tributary beam at pulse + its arrival; spread wide so the
   *  ignitions read as an outward sweep, not one flash. */
  arrivals?: Record<string, number>;
  /** Broadcast cascade (blockArrivalSchedule): node_id → the node its courier flies
   *  FROM. Drives the node→node broadcast couriers; entry peer maps to null. */
  senders?: Record<string, string | null>;
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
}: PeerConstellationProps) {
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

  return (
    <group>
      {render.map((rp) => {
        const senderId = senders[rp.peer.node_id];
        const senderPos = senderId ? posById.get(senderId) ?? null : null;
        return (
          <PeerNode
            key={rp.peer.node_id}
            rp={rp}
            tip={tip}
            localVersion={localVersion}
            selected={selectedId === `peer:${rp.peer.node_id}`}
            onSelect={onSelect}
            pulseRef={pulseRef}
            blockPulseAtMs={blockPulseAtMs}
            arrivalAge={arrivals[rp.peer.node_id] ?? 0}
            senderPos={senderPos}
            onExpire={onExpire}
          />
        );
      })}
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
  arrivalAge,
  senderPos,
  onExpire,
}: {
  rp: RenderPeer;
  tip: number;
  localVersion: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  pulseRef: React.MutableRefObject<{ at: number; entryId: string | null } | null>;
  blockPulseAtMs: number;
  arrivalAge: number;
  senderPos: Vec3 | null;
  onExpire: (nodeId: string) => void;
}) {
  // Crystal + ambient-flow intensity (churn fade × sync brightness), each read
  // every frame by its child via the ref so fades don't trigger React
  // re-renders. The block pulse is carried by the courier refs, not these.
  const intensityRef = useRef(1);
  const flowIntensityRef = useRef(1);

  const color = useMemo(() => {
    const [r, g, b] = PEER_COLORS[peerColorKind(rp.peer, localVersion)];
    return new THREE.Color(r, g, b);
  }, [rp.peer, localVersion]);

  // Deterministic per-peer Bezier seed + twinkle phase.
  const seed = useMemo(() => fnv1a(rp.peer.node_id), [rp.peer.node_id]);
  const phase = useMemo(() => phaseFor(rp.peer.node_id), [rp.peer.node_id]);

  // Block courier cube: a group positioned each frame along a straight node→node
  // flight, fading via its own intensity ref.
  const courierRef = useRef<THREE.Group>(null);
  const courierIntensityRef = useRef(0);
  // Tributary beam: fired when this peer hears the block (latency-derived
  // arrival); a future-dated firedAt sits idle until then.
  const peerBeamFireRef = useRef<{ firedAt: number } | null>(null);
  const lastBeamPulseRef = useRef(-1);
  // This peer's arrival age for the current block (set on each pulse), reused by the
  // entry courier each frame.
  const arrivalAgeRef = useRef(0);

  const jit = useMemo(
    () => beamShapeJitter(rp.peer.node_id, blockPulseAtMs),
    [rp.peer.node_id, blockPulseAtMs],
  );

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

    // New-block arrival: schedule this peer's tributary beam to fire when it hears
    // the block (its set-relative arrival), which also lands the courier below.
    const pulse = pulseRef.current;
    if (pulse && pulse.at !== lastBeamPulseRef.current) {
      lastBeamPulseRef.current = pulse.at;
      arrivalAgeRef.current = arrivalAge;
      peerBeamFireRef.current = { firedAt: pulse.at + arrivalAge };
    }
    // Broadcast courier: a cube flies node→node, landing exactly as this peer's beam
    // fires. The entry (source) peer instead relays its cube inward to the local node
    // (we receive). Many couriers overlap in flight → the visible broadcast wave.
    const courier = courierRef.current;
    if (courier) {
      let leg = { visible: false, t: 0 };
      let from: Vec3 = rp.pos;
      let to: Vec3 = rp.pos;
      if (pulse) {
        const ageSec = now - pulse.at;
        const arr = arrivalAgeRef.current;
        if (pulse.entryId === rp.peer.node_id) {
          leg = courierLeg(arr, BLOCK_RELAY_HOP_S, ageSec); // source → local center
          from = rp.pos;
          to = HUB_POS;
        } else if (senderPos) {
          const start = Math.max(0, arr - BLOCK_BROADCAST_HOP_S); // sender → this peer
          leg = courierLeg(start, arr - start, ageSec);
          from = senderPos;
          to = rp.pos;
        }
      }
      if (!leg.visible) {
        courier.visible = false;
        courierIntensityRef.current = 0;
      } else {
        courier.visible = true;
        courier.position.set(
          from[0] + (to[0] - from[0]) * leg.t,
          from[1] + (to[1] - from[1]) * leg.t,
          from[2] + (to[2] - from[2]) * leg.t,
        );
        // Fade in on departure, out on arrival; peak mid-flight.
        courierIntensityRef.current = Math.sin(Math.PI * leg.t) * alpha;
      }
    }
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
      <group ref={courierRef} visible={false}>
        <CrystalGlow
          geom={BLOCK_GEOM}
          size={BLOCK_SIZE}
          color={BLOCK_COLOR}
          intensityRef={courierIntensityRef}
          seed={rp.peer.node_id}
        />
      </group>
      {/* Light "tributary" beam: when this peer hears the block it
          fires a thin column up into the shared cells canopy — every node
          confirms the block, not just the local hero beam. Small charge
          glow, no outer-glow, smaller splash; drives no canopy shockwave
          (the one canonical ripple is the local node's). */}
      <BlockBeam
        originWorld={rp.pos}
        targetY={CELLS_Y}
        fireRef={peerBeamFireRef}
        coreRadius={0.1 * jit.coreMul}
        haloRadius={0.38}
        showOuterGlow={false}
        splashPeakSize={1.6 * jit.splashMul}
        growDur={BEAM_GROW_DUR_S * jit.growMul}
        holdDur={BEAM_HOLD_DUR_S * jit.tailMul}
        strikeDur={BEAM_STRIKE_DUR_S * jit.tailMul}
        flowSpeed={BEAM_FLOW_SPEED * jit.flowMul}
        chargeRadius={0.6 * jit.coreMul}
      />
    </group>
  );
}
