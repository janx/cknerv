// ColonyEdges — the colony's connections rendered as ONE glow-line primitive
// across two honesty classes, separated only by a confidence gradient (never two
// visual languages — mirrors ColonyNodes' unified glow):
//   • measured edges (local↔peer) — brighter glow-lines: the honest, observed
//     connections between "you" and each real peer.
//   • inferred edges — fainter glow-lines: a gossamer scaffold of the "possible
//     network."
// ALL edges live in a single additive <lineSegments> (~600, one draw). Per-edge
// brightness = confidence: measured → MEASURED_LINE_BRIGHT, inferred →
// INFERRED_LINE_BASE (both verts of an edge share the value via `aBright`). The
// lines are STATIC — no per-block pulse. The block flood (the spreading wavefront)
// is owned entirely by the courier / BlockDeliveryLayer now, so nothing block-timed
// flows through here: ColonyEdges takes only `topology`.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { NetworkTopology } from '../types';

// Gossamer line color for the whole mesh — the same faint blue as ColonyNodes'
// inferred ghost cloud so the edges + cloud read as one structure. One `uColor`
// for every edge; confidence lives in per-edge brightness (`aBright`), not tint.
const INFERRED_LINE_COLOR = '#8fb7ff';
// Base line brightness for inferred edges — barely-there so the ~1–2k gossamer
// edges read as faint structure, not a solid mass (additive). Tune live.
const INFERRED_LINE_BASE = 0.3;
// Measured edges glow brighter — the honesty gradient (observed > inferred),
// mirroring ColonyNodes' bright measured cores over the faint ghost haze. Tune live.
const MEASURED_LINE_BRIGHT = 0.7;

/**
 * The colony's edges as a single additive <lineSegments> over ALL edges
 * (measured + inferred). `position` (2 verts × 3 = 6 floats/edge) + a per-vertex
 * `aBright` (1 float PER VERTEX, both verts of an edge share the value) are
 * allocated once off the topology (this component owns the geometry). A static
 * glow-line ShaderMaterial reads `aBright` → the per-edge confidence brightness.
 * No pulse, no uTime — STATIC.
 */
export default function ColonyEdges({ topology }: { topology: NetworkTopology }) {
  const geom = useMemo(() => {
    const posById = new Map(topology.nodes.map((n) => [n.id, n.pos] as const));
    const edges = topology.edges;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(edges.length * 6);
    // Per-vertex confidence brightness; edge i → verts 2i, 2i+1 (both share the
    // edge's value). The SAME buffer layout as `position` (2 verts/edge).
    const bright = new Float32Array(edges.length * 2);
    edges.forEach((e, i) => {
      const a = posById.get(e.a)!;
      const b = posById.get(e.b)!;
      pos.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6);
      const v = e.kind === 'measured' ? MEASURED_LINE_BRIGHT : INFERRED_LINE_BASE;
      bright[2 * i] = v;
      bright[2 * i + 1] = v;
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    return g;
  }, [topology]);

  // Static glow-line material — additive, per-vertex brightness (`aBright`) folded
  // into both color and alpha (matching ColonyNodes' inferred cloud). Memoized on
  // [] (stable for the component's life) so it survives topology re-clones without
  // a shader recompile.
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uColor: { value: new THREE.Color(INFERRED_LINE_COLOR) },
        },
        vertexShader: /* glsl */ `
          attribute float aBright;
          varying float vB;
          void main() {
            vB = aBright;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uColor;
          varying float vB;
          void main() {
            gl_FragColor = vec4(uColor * vB, vB);
          }
        `,
      }),
    [],
  );

  // Dispose the OWNED geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and force a needless shader recompile on every re-clone.
  useEffect(() => () => mat.dispose(), [mat]);

  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
}
