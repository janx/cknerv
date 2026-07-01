// ColonyEdges — the colony's connections rendered in two honesty classes:
//   • measured belts — one live <FlowBeam> per local↔peer edge (~dozens): the
//     honest, bidirectional particle exchange between "you" and each real peer.
//   • inferred mesh  — ONE additive <lineSegments> over every inferred edge
//     (~1–2k): a faint gossamer scaffold of the "possible network." Inert until
//     Task 9 (M3) swaps in a pulse shader driven through `edgePulseRef`
//     (absolute simClock seconds per edge; sentinel -1e9 ⇒ "never").
//
// Sibling to ColonyNodes: same inferred/measured split, same palette, and the
// same StrictMode-safe buffer handoff — own the pulse Float32Array in a stable
// memo and bind the ref in a useLayoutEffect, so `edgePulseRef.current` always
// points at the exact array bound to the geometry attribute before the next
// frame. Does not wire into the app (Task 8).
import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { fnv1a } from '../geometry/edgeBezier';
import { PEER_COLORS } from '../derives/peers.derive';
import FlowBeam, { type FlowStyle } from './FlowBeam';
import type { NetworkNode, NetworkTopology } from '../types';

// Forward (local→peer) particle color = the LOCAL node's cyan. Copied from the
// retired PeerConstellation (:33) rather than imported — that module goes away
// in Task 8, so ColonyEdges carries its own copy.
const LOCAL_FLOW_COLOR = new THREE.Color('#7df9ff');

// Visual character of a peer's particle belt. Copied verbatim from
// PeerConstellation (:35-41) so the measured belts read identically.
const PEER_FLOW_STYLE: FlowStyle = {
  particleSize: 0.7,
  count: 84,
  speed: 0.08,
  jitter: 0.6,
  intensity: 1.3,
};

// Gossamer line color for the inferred scaffold — the same faint blue as
// ColonyNodes' inferred ghost cloud so the mesh + cloud read as one structure.
const INFERRED_LINE_COLOR = new THREE.Color('#8fb7ff');
// Base line opacity — barely-there so ~1–2k edges read as gossamer structure,
// not a solid mass. Tune live in the visual pass; Task 9's pulse shader
// supersedes this flat material.
const INFERRED_LINE_OPACITY = 0.06;

/** Measured belt target tint = the real peer palette, keyed by connection
 *  direction (single-sourced from peers.derive, matching ColonyNodes). */
function peerDirectionColor(node: NetworkNode): THREE.Color {
  const [r, g, b] = PEER_COLORS[node.peer!.direction];
  return new THREE.Color(r, g, b);
}

/**
 * The inferred scaffold as a single additive <lineSegments>. `position` (2
 * verts/edge) + `aPulseAt` (1 float PER VERTEX, both verts of an edge share the
 * value) are allocated once; the pulse buffer is handed out via `edgePulseRef`
 * so Task 9's flood layer can ignite edges in place without touching React.
 * The material is a flat faint additive line for now — inert; Task 9 upgrades
 * it to a pulse ShaderMaterial that reads `aPulseAt`.
 */
function InferredMesh({
  topology,
  edgePulseRef,
}: {
  topology: NetworkTopology;
  edgePulseRef: React.MutableRefObject<Float32Array>;
}) {
  const infEdges = useMemo(
    () => topology.edges.filter((e) => e.kind === 'inferred'),
    [topology],
  );

  // Per-vertex pulse peak time, ABSOLUTE simClock seconds; -1e9 ⇒ "never." Held
  // in its own stable memo (not written from render) so it survives StrictMode's
  // double-invoked factories and stays the exact array bound to `aPulseAt`.
  const pulse = useMemo(
    () => new Float32Array(infEdges.length * 2).fill(-1e9),
    [infEdges],
  );

  const geom = useMemo(() => {
    const posById = new Map(topology.nodes.map((n) => [n.id, n.pos] as const));
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(infEdges.length * 6);
    infEdges.forEach((e, i) => {
      const a = posById.get(e.a)!;
      const b = posById.get(e.b)!;
      pos.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPulseAt', new THREE.BufferAttribute(pulse, 1));
    return g;
  }, [infEdges, topology.nodes, pulse]);

  // Hand the live pulse buffer to the flood layer (Task 9) AFTER commit, so
  // `edgePulseRef.current` is always the array actually bound to `aPulseAt`.
  // useLayoutEffect (NOT useMemo, NOT useEffect) matches ColonyNodes' flashRef.
  useLayoutEffect(() => {
    edgePulseRef.current = pulse;
  }, [pulse, edgePulseRef]);

  const mat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: INFERRED_LINE_COLOR,
        transparent: true,
        opacity: INFERRED_LINE_OPACITY,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  // Dispose the OWNED geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and thrash a needless recompile each ~4s peer poll.
  useEffect(() => () => mat.dispose(), [mat]);

  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
}

/**
 * Composes the colony's edges: one live FlowBeam per measured (local↔peer) edge
 * plus the single inferred gossamer mesh. Does not wire into the app (Task 8).
 */
export default function ColonyEdges({
  topology,
  edgePulseRef,
}: {
  topology: NetworkTopology;
  edgePulseRef: React.MutableRefObject<Float32Array>;
}) {
  // One live belt per measured (local↔peer) edge. Resolve endpoint positions +
  // the peer's direction tint once per topology; FlowBeam owns each belt's
  // per-frame particle churn. `from` = the local node's pos, `to` = the peer's.
  const beams = useMemo(() => {
    const nodeById = new Map(topology.nodes.map((n) => [n.id, n] as const));
    const localNode = nodeById.get(topology.localId);
    return topology.edges
      .filter((e) => e.kind === 'measured')
      .map((e) => {
        const peerId = e.a === topology.localId ? e.b : e.a;
        const peerNode = nodeById.get(peerId);
        if (!localNode || !peerNode || !peerNode.peer) return null;
        return {
          key: `${e.a}|${e.b}`,
          from: localNode.pos,
          to: peerNode.pos,
          color: peerDirectionColor(peerNode),
          seed: fnv1a(e.a + e.b),
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [topology]);

  return (
    <group>
      {beams.map((b) => (
        <FlowBeam
          key={b.key}
          from={b.from}
          to={b.to}
          colorSource={LOCAL_FLOW_COLOR}
          colorTarget={b.color}
          style={PEER_FLOW_STYLE}
          seed={b.seed}
        />
      ))}
      <InferredMesh topology={topology} edgePulseRef={edgePulseRef} />
    </group>
  );
}
