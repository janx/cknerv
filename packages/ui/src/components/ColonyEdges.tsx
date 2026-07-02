// ColonyEdges — the colony's connections rendered in two honesty classes:
//   • measured belts — one live <FlowBeam> per local↔peer edge (~dozens): the
//     honest, bidirectional particle exchange between "you" and each real peer.
//   • inferred mesh  — ONE additive <lineSegments> over every inferred edge
//     (~1–2k): a faint gossamer scaffold of the "possible network." Each block
//     ignites a wavefront: per-edge pulse times are written into `aPulseAt`
//     (absolute simClock seconds; sentinel -1e9 ⇒ "never"), and a pulse
//     ShaderMaterial brightens each edge as the front crosses it.
//
// Sibling to ColonyNodes: same inferred/measured split, same palette, and the
// same COMPONENT-OWNED flood write — InferredMesh owns the pulse Float32Array +
// geometry, so it captures the flood t0 in its OWN pulse effect (never a
// parent-set ref → no child-before-parent trap) and sets needsUpdate itself.
// t0 = simClock.elapsedSec, mutated only in the r3f loop, so this matches
// ColonyNodes' captures in the same pulse's effect flush (perfectly synced).
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { fnv1a } from '../geometry/edgeBezier';
import { PEER_COLORS, peerColorKind } from '../derives/peers.derive';
import { FLASH_ENV_GLSL } from '../materials/cellEnvelope.glsl';
import FlowBeam, { type FlowStyle } from './FlowBeam';
import type { NetworkNode, NetworkTopology } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';

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
// Base line brightness — barely-there so ~1–2k edges read as gossamer structure,
// not a solid mass (matches the old flat-material opacity under additive
// blending). Tune live in the visual pass.
const INFERRED_LINE_BASE = 0.06;
// Pulse ceiling as the wavefront crosses an edge (scaled by the flash envelope,
// which peaks ~0.78, so effective peak brightness ≈ base + 0.78·(peak−base)).
const INFERRED_LINE_PEAK = 2.5;

/** Measured belt target tint = the real peer palette: version-mismatch (violet)
 *  wins, else connection direction — single-sourced via peerColorKind, matching
 *  ColonyNodes. */
function peerBeltColor(node: NetworkNode, localVersion: string): THREE.Color {
  const [r, g, b] = PEER_COLORS[peerColorKind(node.peer!, localVersion)];
  return new THREE.Color(r, g, b);
}

/**
 * The inferred scaffold as a single additive <lineSegments>. `position` (2
 * verts/edge) + `aPulseAt` (1 float PER VERTEX, both verts of an edge share the
 * value) are allocated once; the pulse buffer is written IN PLACE on each block
 * (this component owns the geometry, so it captures the flood t0 and sets
 * needsUpdate itself). A pulse ShaderMaterial brightens each edge by
 * `flashEnv(uTime - aPulseAt)` — a whole-edge brighten as the front crosses it.
 */
function InferredMesh({
  topology,
  cf,
  blockPulseAtMs,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
}) {
  const infEdges = useMemo(
    () => topology.edges.filter((e) => e.kind === 'inferred'),
    [topology],
  );

  // Per-vertex pulse peak time, ABSOLUTE simClock seconds; -1e9 ⇒ "never." Held
  // in its own stable memo (not written from render) so it survives StrictMode's
  // double-invoked factories and stays the exact array bound to `aPulseAt`. Edge
  // i → verts 2i, 2i+1 (the SAME memoized array that builds the geometry below).
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

  // Ignite the wavefront on each NEW block: an edge lights when the front crosses
  // it, i.e. when its LATER endpoint arrives (max of the two node arrivals). Both
  // verts of edge i get the same time. t0 is captured HERE (the buffer owner's
  // own effect), never read from a parent ref, so it can't go stale before a
  // parent effect runs (child effects flush first).
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs;
    const t0 = simClock.elapsedSec;
    for (let i = 0; i < infEdges.length; i++) {
      const e = infEdges[i];
      const t =
        t0 + Math.max(cf.colonyArrivalS[e.a] ?? 0, cf.colonyArrivalS[e.b] ?? 0);
      pulse[2 * i] = t;
      pulse[2 * i + 1] = t;
    }
    geom.getAttribute('aPulseAt').needsUpdate = true;
    // cf + infEdges/pulse/geom are read from the render that bumped
    // blockPulseAtMs (App recomputes cf + bumps the pulse together), so
    // [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: INFERRED_LINE_COLOR },
          uDim: { value: INFERRED_LINE_BASE },
          uPeak: { value: INFERRED_LINE_PEAK },
        },
        vertexShader: /* glsl */ `
          attribute float aPulseAt;
          uniform float uTime;
          varying float vAge;
          void main() {
            vAge = uTime - aPulseAt;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform vec3 uColor;
          uniform float uDim, uPeak;
          varying float vAge;

          ${FLASH_ENV_GLSL}

          void main() {
            float e = flashEnv(vAge);
            float b = uDim + (uPeak - uDim) * e;
            // Additive: fold brightness into rgb (alpha 1) so the quiescent mesh
            // (b = uDim) matches the old flat gossamer contribution uColor·0.06.
            gl_FragColor = vec4(uColor * b, 1.0);
          }
        `,
      }),
    [],
  );

  // Dispose the OWNED geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and thrash a needless recompile each ~4s peer poll.
  useEffect(() => () => mat.dispose(), [mat]);

  // Drive the shader clock off the sim clock (shared time base with aPulseAt).
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
  });

  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
}

/**
 * Composes the colony's edges: one live FlowBeam per measured (local↔peer) edge
 * plus the single inferred gossamer mesh (which pulses on each block).
 */
export default function ColonyEdges({
  topology,
  cf,
  blockPulseAtMs,
  localVersion,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
  localVersion: string;
}) {
  // One live belt per measured (local↔peer) edge. Resolve endpoint positions +
  // the peer's tint once per topology; FlowBeam owns each belt's per-frame
  // particle churn. `from` = the local node's pos, `to` = the peer's.
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
          color: peerBeltColor(peerNode, localVersion),
          seed: fnv1a(e.a + e.b),
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [topology, localVersion]);

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
      <InferredMesh topology={topology} cf={cf} blockPulseAtMs={blockPulseAtMs} />
    </group>
  );
}
