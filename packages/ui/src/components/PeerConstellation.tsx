import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { CHAIN_Y, CELLS_Y } from '../layout';
import { FONT_MONO } from '../ui/fonts';
import { fnv1a, bezierControl, bezierAt } from '../geometry/edgeBezier';
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
  peerArrivalAge,
  entryCourierState,
  beamShapeJitter,
  PEER_COLORS,
  PEER_OUTER_RADIUS,
  rankPeers,
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
/** Block courier: a small wireframe cube ("a block") that couriers between
 *  nodes via CrystalGlow — the nodes-layer language, distinct from the soft
 *  particles. One unit cube shared by all couriers. */
const BLOCK_GEOM = new THREE.BoxGeometry(1, 1, 1);
const BLOCK_SIZE = 0.9;
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
}

export default function PeerConstellation({
  peers,
  tip,
  localVersion,
  selectedId,
  onSelect,
  blockPulseAtMs = 0,
  entryPeerId = null,
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

  // Per-block pulse: the frame loop reads `at` (when it fired), `nonce` (the block
  // id, for seeding arrival + shape), and `entryId` (which peer relays us the block).
  const pulseRef = useRef<{ at: number; nonce: number; entryId: string | null } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs > lastPulseRef.current) {
      lastPulseRef.current = blockPulseAtMs;
      pulseRef.current = {
        at: simClock.elapsedSec,
        nonce: blockPulseAtMs,
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
  pulseRef: React.MutableRefObject<{ at: number; nonce: number; entryId: string | null } | null>;
  blockPulseAtMs: number;
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

  // Block courier cube: a group positioned along the bezier each frame, fading
  // via its own intensity ref; rides the same curve the belt does.
  const ctrl = useMemo(
    () =>
      bezierControl(
        HUB_POS[0], HUB_POS[1], HUB_POS[2],
        rp.pos[0], rp.pos[1], rp.pos[2],
        seed,
      ),
    [rp.pos, seed],
  );
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
    // the block (latency-derived arrival), and — if it is the entry peer — animate a
    // receive courier riding peer → local over the relay hop.
    const pulse = pulseRef.current;
    if (pulse && pulse.at !== lastBeamPulseRef.current) {
      lastBeamPulseRef.current = pulse.at;
      arrivalAgeRef.current = peerArrivalAge(rp.peer, pulse.nonce);
      peerBeamFireRef.current = { firedAt: pulse.at + arrivalAgeRef.current };
    }
    const courier = courierRef.current;
    if (courier) {
      const isEntry = pulse?.entryId === rp.peer.node_id;
      const ev = pulse && isEntry
        ? entryCourierState(arrivalAgeRef.current, now - pulse.at)
        : { visible: false, pos: 0 };
      if (!ev.visible) {
        courier.visible = false;
        courierIntensityRef.current = 0;
      } else {
        const [cx, cy, cz] = bezierAt(
          HUB_POS[0], HUB_POS[1], HUB_POS[2],
          ctrl[0], ctrl[1], ctrl[2],
          rp.pos[0], rp.pos[1], rp.pos[2],
          ev.pos,
        );
        courier.visible = true;
        courier.position.set(cx, cy, cz);
        // Fade in on departure (pos→1), out on arrival (pos→0); peak mid-flight.
        courierIntensityRef.current = Math.sin(Math.PI * (1 - ev.pos)) * alpha;
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
          confirms the block, not just the local hero beam. No charge, no
          outer-glow, smaller splash; drives no canopy shockwave (the one
          canonical ripple is the local node's). */}
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
      />
    </group>
  );
}
