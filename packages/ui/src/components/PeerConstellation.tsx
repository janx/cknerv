import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { CHAIN_Y } from '../layout';
import { FONT_MONO } from '../ui/fonts';
import type { Peer } from '@cknerv/types';
import {
  peerWorldPosition,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  peerCrystalSize,
  peerCrystalBrightness,
  PEER_COLORS,
  PEER_OUTER_RADIUS,
} from '../derives/peers.derive';
import CrystalGlow from './CrystalGlow';

/** Max peers rendered; the rest are summarized in the NETWORK HUD. */
export const PEER_RENDER_CAP = 80;
/** Fade-in / fade-out duration for peer churn (seconds). */
const FADE_S = 0.6;
const HUB = new THREE.Vector3(0, CHAIN_Y, 0);

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
      // `pos` reference when latency is unchanged so the child's
      // edgeGeom memo stays stable across no-op polls (no churn/realloc).
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

  // Per-block convergence pulse: a 0→1 progress that the frame loop reads.
  const pulseRef = useRef<{ at: number } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs > lastPulseRef.current) {
      lastPulseRef.current = blockPulseAtMs;
      pulseRef.current = { at: simClock.elapsedSec };
    }
  }, [blockPulseAtMs]);

  // When a dropped peer finishes fading, drop it from the retain map and
  // re-render so its PeerNode unmounts promptly (firing edgeGeom dispose)
  // instead of lingering until the next ~4s [peers] snapshot.
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
  pulseRef: React.MutableRefObject<{ at: number } | null>;
  onExpire: (nodeId: string) => void;
}) {
  const beadRef = useRef<THREE.Mesh>(null);
  const edgeMatRef = useRef<THREE.LineBasicMaterial>(null);
  // Overall crystal intensity (churn fade × sync brightness), read each frame
  // by CrystalGlow via the ref so fades don't trigger React re-renders.
  const intensityRef = useRef(1);

  const color = useMemo(() => {
    const [r, g, b] = PEER_COLORS[peerColorKind(rp.peer, localVersion)];
    return new THREE.Color(r, g, b);
  }, [rp.peer, localVersion]);

  const edgeGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setFromPoints([HUB, new THREE.Vector3(...rp.pos)]);
    return g;
  }, [rp.pos]);
  useEffect(() => () => edgeGeom.dispose(), [edgeGeom]);

  const sync = syncProximity(rp.peer.best_known, tip);
  const size = peerCrystalSize(sync);
  const brightness = peerCrystalBrightness(sync);
  const baseEdgeOpacity = rp.peer.direction === 'outbound' ? 0.45 : 0.28;

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
    if (edgeMatRef.current) edgeMatRef.current.opacity = baseEdgeOpacity * alpha;
    // Block convergence bead: travels peer → hub once per pulse.
    const pulse = pulseRef.current;
    if (beadRef.current && pulse) {
      const u = (now - pulse.at) / 0.7;
      if (u >= 0 && u <= 1) {
        beadRef.current.visible = true;
        beadRef.current.position.set(
          rp.pos[0] + (HUB.x - rp.pos[0]) * u,
          rp.pos[1] + (HUB.y - rp.pos[1]) * u,
          rp.pos[2] + (HUB.z - rp.pos[2]) * u,
        );
        const bm = beadRef.current.material as THREE.MeshBasicMaterial;
        bm.opacity = Math.sin(u * Math.PI) * alpha;
      } else {
        beadRef.current.visible = false;
      }
    }
  });

  return (
    <group>
      <lineSegments geometry={edgeGeom}>
        <lineBasicMaterial
          ref={edgeMatRef}
          color={color}
          transparent
          opacity={baseEdgeOpacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
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
      <mesh ref={beadRef} visible={false}>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial
          color="#eaffff"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
