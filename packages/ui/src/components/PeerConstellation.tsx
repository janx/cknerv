import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { CHAIN_Y } from '../layout';
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
  blockPropagationPhase,
  PEER_COLORS,
  PEER_OUTER_RADIUS,
} from '../derives/peers.derive';
import CrystalGlow from './CrystalGlow';
import FlowBeam, { type FlowStyle } from './FlowBeam';

/** Max peers rendered; the rest are summarized in the NETWORK HUD. */
export const PEER_RENDER_CAP = 80;
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
/** Peak extra brightness of the block-propagation wave band on a belt. */
const WAVE_GAIN = 7;

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
}

/** Order peers deterministically (outbound first, then lowest latency) and
 *  cap the count so a high-degree node stays legible. */
function rankPeers(peers: Peer[]): Peer[] {
  return [...peers]
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'outbound' ? -1 : 1;
      return (a.latency_ms ?? 1e9) - (b.latency_ms ?? 1e9);
    })
    .slice(0, PEER_RENDER_CAP);
}

/** The peer most plausibly relaying us a new block: the alive peer with the
 *  lowest latency. Drives the inbound "receive" wave. null if no peers. */
function pickPropagationSource(map: Map<string, RenderPeer>): string | null {
  let bestId: string | null = null;
  let bestLatency = Infinity;
  for (const rp of map.values()) {
    if (rp.deadAt !== null) continue;
    const lat = rp.peer.latency_ms ?? Infinity;
    if (bestId === null || lat < bestLatency) {
      bestId = rp.peer.node_id;
      bestLatency = lat;
    }
  }
  return bestId;
}

export default function PeerConstellation({
  peers,
  tip,
  localVersion,
  selectedId,
  onSelect,
  blockPulseAtMs = 0,
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

  // Per-block propagation pulse: the frame loop reads `at` (when it fired) and
  // `sourceId` (which peer relayed us the block) to choreograph the
  // receive→relay wave bands.
  const pulseRef = useRef<{ at: number; sourceId: string | null } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs > lastPulseRef.current) {
      lastPulseRef.current = blockPulseAtMs;
      pulseRef.current = {
        at: simClock.elapsedSec,
        sourceId: pickPropagationSource(retainRef.current),
      };
    }
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
  onExpire,
}: {
  rp: RenderPeer;
  tip: number;
  localVersion: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  pulseRef: React.MutableRefObject<{ at: number; sourceId: string | null } | null>;
  onExpire: (nodeId: string) => void;
}) {
  // Crystal + ambient-flow intensity (churn fade × sync brightness), each read
  // every frame by its child via the ref so fades don't trigger React
  // re-renders. The block pulse is carried by `waveRef`, not these.
  const intensityRef = useRef(1);
  const flowIntensityRef = useRef(1);

  const color = useMemo(() => {
    const [r, g, b] = PEER_COLORS[peerColorKind(rp.peer, localVersion)];
    return new THREE.Color(r, g, b);
  }, [rp.peer, localVersion]);

  // Deterministic per-peer Bezier seed + twinkle phase.
  const seed = useMemo(() => fnv1a(rp.peer.node_id), [rp.peer.node_id]);
  const phase = useMemo(() => phaseFor(rp.peer.node_id), [rp.peer.node_id]);

  // Traveling block-propagation wave along the belt (null = no wave).
  const waveRef = useRef<{ pos: number; gain: number } | null>(null);

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

    // Block propagation as a traveling light band along the belt: it sweeps
    // source-peer→hub (we receive the block), then hub→peer on every belt (we
    // relay it). FlowBeam brightens its particles near `pos`.
    const pulse = pulseRef.current;
    const ev = blockPropagationPhase(pulse ? now - pulse.at : -1);
    const isSource = pulse?.sourceId === rp.peer.node_id;
    if (ev.phase === 'relay') {
      waveRef.current = { pos: ev.t, gain: WAVE_GAIN * alpha }; // hub → peer
    } else if (ev.phase === 'receive' && isSource) {
      waveRef.current = { pos: 1 - ev.t, gain: WAVE_GAIN * alpha }; // peer → hub
    } else {
      waveRef.current = null;
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
        waveRef={waveRef}
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
