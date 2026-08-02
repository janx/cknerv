// ColonyEdges — the colony's links rendered as ONE glow-line primitive that is the
// PEER NETWORK'S OWN VISUAL LANGUAGE: a *data-flow mesh*. Deliberately unlike the
// cells' neural galaxy (sharp white spike-heads racing along CURVED dendrites), the
// peer links are STRAIGHT and carry a soft luminous current:
//   • base — a static confidence gradient (measured brighter, inferred fainter):
//     the honest observed-vs-possible structure.
//   • ambient drift — a soft energy band slides slowly ALONG each straight link,
//     continuously, per-edge phase-offset so the mesh is alive but not synced. This
//     is the "current flowing through the wires" that gives the mesh its flow.
//   • block surge — on each new block a BRIGHT band flows OUTWARD along the
//     shortest-path propagation tree (colonyPredecessor), timed by the flood
//     arrivals (parent lights, then the band travels to the child). The surge is
//     the block's edge-flow — the couriers are now only a faint glint accent on top.
//
// ALL edges live in a single additive <lineSegments> (~600, one draw). Per-vertex:
//   position, aBright (base confidence), aEdgeParam (0 at a, 1 at b — position
//   along the link), aPhase (ambient de-sync). Per-block-DYNAMIC: aSurgeT0/T1
//   (parent/child ABSOLUTE simClock arrival seconds; sentinel −1e9 ⇒ not a tree
//   edge this block) + aSurgeP0 (the parent's aEdgeParam, so the surge flows the
//   right way down an undirected line). Ambient is driven by `uTime`; the surge by
//   comparing `uTime` to the absolute arrival stamps.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { fnv1a } from '../geometry/edgeBezier';
import type { NetworkTopology } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import { consensusBlockColor } from '../derives/consensusFlow.derive';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

// Gossamer line color for the whole mesh — the faint blue that matches ColonyNodes'
// inferred ghost cloud so edges + cloud read as one structure. Confidence lives in
// per-edge brightness (`aBright`), not tint.
// Base line brightness. Inferred edges are the faint "possible network" scaffold;
// measured edges glow brighter (the honesty gradient). Raised from the original
// barely-there values so the mesh reads as persistent structure. Tune live.
const INFERRED_LINE_BASE = 0.42;
const MEASURED_LINE_BRIGHT = 0.72;

/** Per-edge ambient phase in [0,1): a stable hash of the endpoints so each link's
 *  drift starts at a different point (the mesh flows, but isn't a synced pulse). */
function edgePhase(a: string, b: string): number {
  return (fnv1a(`${a}|${b}`) >>> 0) / 4294967296;
}

/**
 * The colony's links as a single additive <lineSegments> over ALL edges (measured
 * + inferred). Static confidence/geometry attributes are built once off the
 * topology (this component owns the geometry); the surge attributes are rewritten
 * per block. A glow-line ShaderMaterial folds base + ambient drift + block surge
 * into an additive current. The flood props are OPTIONAL — without them the mesh
 * still carries the ambient drift (standalone / galaxy-less scenes just don't surge).
 */
export default function ColonyEdges({
  topology,
  cf,
  blockPulseAtMs,
  backfillActive = false,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  cf?: ColonyFlood;
  /** Increments on each new block; the surge stamps its own arrival clock off this. */
  blockPulseAtMs?: number;
  /** Calm catch-up: consume-then-bail so no surge replays post-backfill. */
  backfillActive?: boolean;
  /** Cell inspection lowers passive P2P context while event surges bypass it. */
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const edges = topology.edges;

  const geom = useMemo(() => {
    const posById = new Map(topology.nodes.map((n) => [n.id, n.pos] as const));
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(edges.length * 6);
    // Per-vertex attributes; edge i → verts 2i (endpoint a), 2i+1 (endpoint b).
    const bright = new Float32Array(edges.length * 2); // base confidence brightness
    const param = new Float32Array(edges.length * 2);  // 0 at a, 1 at b
    const phase = new Float32Array(edges.length * 2);  // ambient drift phase (edge-shared)
    // Surge stamps — sentinel −1e9 = "no surge on this edge this block".
    const surgeT0 = new Float32Array(edges.length * 2).fill(-1e9);
    const surgeT1 = new Float32Array(edges.length * 2).fill(-1e9);
    const surgeP0 = new Float32Array(edges.length * 2);
    edges.forEach((e, i) => {
      const a = posById.get(e.a)!;
      const b = posById.get(e.b)!;
      pos.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6);
      const v = e.kind === 'measured' ? MEASURED_LINE_BRIGHT : INFERRED_LINE_BASE;
      bright[2 * i] = v;
      bright[2 * i + 1] = v;
      param[2 * i] = 0;
      param[2 * i + 1] = 1;
      const ph = edgePhase(e.a, e.b);
      phase[2 * i] = ph;
      phase[2 * i + 1] = ph;
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    g.setAttribute('aEdgeParam', new THREE.BufferAttribute(param, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSurgeT0', new THREE.BufferAttribute(surgeT0, 1));
    g.setAttribute('aSurgeT1', new THREE.BufferAttribute(surgeT1, 1));
    g.setAttribute('aSurgeP0', new THREE.BufferAttribute(surgeP0, 1));
    return g;
  }, [topology, edges]);

  // Undirected edge-key → edge index, for mapping a tree edge (parent→child) back
  // to its line. Both directions stored so `${parent}|${child}` hits directly.
  const edgeIndex = useMemo(() => {
    const m = new Map<string, number>();
    edges.forEach((e, i) => {
      m.set(`${e.a}|${e.b}`, i);
      m.set(`${e.b}|${e.a}`, i);
    });
    return m;
  }, [edges]);

  // Additive glow-line material — base + ambient drift + block surge, all folded
  // into an additive current (rgb premultiplied by intensity in the alpha, so with
  // ambient=surge=0 it is byte-identical to the old static `vec4(uColor*vB, vB)`).
  // Memoized on [] (stable for the component's life) so it survives topology
  // re-clones without a shader recompile; uTime/surge live in mutable uniforms.
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uColor: {
            value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
          },
          uSurgeColor: {
            value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
          },
          uTime: { value: 0 },
          // Zero-drift defaults (seeded once; refreshed per-frame from LIVE.peer.* below).
          uAmbientAmp: { value: 0.22 },
          uAmbientSpeed: { value: 0.05 },
          uAmbientSigma: { value: 0.17 },
          uSurgeAmp: { value: 1.1 },
          uSurgeSigma: { value: 0.13 },
          uSurgeEase: { value: 0.12 },
          uContextEnergy: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aBright;
          attribute float aEdgeParam;
          attribute float aPhase;
          attribute float aSurgeT0;
          attribute float aSurgeT1;
          attribute float aSurgeP0;
          varying float vB;
          varying float vParam;
          varying float vPhase;
          varying float vS0;
          varying float vS1;
          varying float vSP0;
          void main() {
            vB = aBright;
            vParam = aEdgeParam;
            vPhase = aPhase;
            vS0 = aSurgeT0;
            vS1 = aSurgeT1;
            vSP0 = aSurgeP0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uColor;
          uniform vec3 uSurgeColor;
          uniform float uTime;
          uniform float uAmbientAmp;
          uniform float uAmbientSpeed;
          uniform float uAmbientSigma;
          uniform float uSurgeAmp;
          uniform float uSurgeSigma;
          uniform float uSurgeEase;
          uniform float uContextEnergy;
          varying float vB;
          varying float vParam;
          varying float vPhase;
          varying float vS0;
          varying float vS1;
          varying float vSP0;

          // Looping band: wrap-around distance so a link's drift never seams at 0/1.
          float wrapBump(float p, float center, float sigma) {
            float d = abs(p - center);
            d = min(d, 1.0 - d);
            return exp(-(d * d) / (2.0 * sigma * sigma));
          }
          // One-shot band (no wrap): the surge travels the link exactly once.
          float bump(float p, float center, float sigma) {
            float d = p - center;
            return exp(-(d * d) / (2.0 * sigma * sigma));
          }

          void main() {
            float base = vB;

            // Ambient current — a soft band drifting along the link, scaled by base
            // (honesty) with a floor so even inferred links visibly flow.
            float ac = fract(uTime * uAmbientSpeed + vPhase);
            float ambient = uAmbientAmp * wrapBump(vParam, ac, uAmbientSigma) * (0.45 + 0.55 * vB);

            // Block surge — bright band flowing parent→child over [vS0, vS1]. Only
            // tree edges carry a real window (sentinel vS1 <= vS0 disables it).
            float surge = 0.0;
            if (vS1 > vS0) {
              float frac = clamp((uTime - vS0) / (vS1 - vS0), 0.0, 1.0);
              // parent at param 0 → band travels 0→1; parent at 1 → travels 1→0.
              float center = vSP0 + frac * (1.0 - 2.0 * vSP0);
              float env = smoothstep(vS0 - uSurgeEase, vS0, uTime)
                        * (1.0 - smoothstep(vS1, vS1 + uSurgeEase * 2.0, uTime));
              surge = uSurgeAmp * bump(vParam, center, uSurgeSigma) * env;
            }

            // AdditiveBlending applies source alpha to RGB once more. Keep the
            // unscaled passive shape in alpha so uContextEnergy controls screen
            // contribution linearly instead of being squared into invisibility.
            float passiveShape = base + ambient;
            float passive = passiveShape * uContextEnergy;
            float intensity = passiveShape + surge;
            vec3 col = uColor * passive + uSurgeColor * surge;
            gl_FragColor = vec4(col, intensity);
          }
        `,
      }),
    [],
  );

  // Drive the ambient current every frame (surge reads the same uTime vs its stamps).
  // Ambient/surge tunables are refreshed from LIVE.peer.* each frame (panel drags
  // land next frame; closed panel keeps the zero-drift defaults above).
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
    mat.uniforms.uAmbientAmp.value = LIVE.peer.ambientAmp;
    mat.uniforms.uAmbientSpeed.value = LIVE.peer.ambientSpeed;
    mat.uniforms.uAmbientSigma.value = LIVE.peer.ambientSigma;
    mat.uniforms.uSurgeAmp.value = LIVE.peer.surgeAmp;
    mat.uniforms.uSurgeSigma.value = LIVE.peer.surgeSigma;
    mat.uniforms.uSurgeEase.value = LIVE.peer.surgeEase;
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
  });

  // Per-block surge stamp: on each blockPulseAtMs increase, rewrite the tree edges'
  // arrival windows into the dynamic attributes (ABSOLUTE simClock seconds, captured
  // here in the effect flush — synced with the courier layer's own t0). Backfill:
  // consume-then-bail so a restore backlog can't replay as one surge strobe.
  const lastPulseRef = useRef(blockPulseAtMs ?? 0);
  useEffect(() => {
    if (blockPulseAtMs === undefined || cf === undefined) return;
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs; // consume even while backfilling…
    if (backfillActive) return; //           …but don't stamp → no surge

    // The active tree keeps the exact block carrier identity that will later
    // appear on the peer-node shockwave and the vertical delivery.
    mat.uniforms.uSurgeColor.value.setRGB(...consensusBlockColor(blockPulseAtMs));

    const t0 = simClock.elapsedSec;
    const arr = cf.colonyArrivalS;
    const pred = cf.colonyPredecessor;
    const aS0 = geom.getAttribute('aSurgeT0') as THREE.BufferAttribute;
    const aS1 = geom.getAttribute('aSurgeT1') as THREE.BufferAttribute;
    const aSP0 = geom.getAttribute('aSurgeP0') as THREE.BufferAttribute;
    const s0 = aS0.array as Float32Array;
    const s1 = aS1.array as Float32Array;
    const sp0 = aSP0.array as Float32Array;
    // Reset all edges to "no surge" for this block, then arm the tree edges.
    s0.fill(-1e9);
    s1.fill(-1e9);
    for (const [child, parent] of Object.entries(pred)) {
      if (!parent) continue; // origin / unreachable → no incoming edge
      const ei = edgeIndex.get(`${parent}|${child}`);
      if (ei === undefined) continue; // predecessor came from an edge; guard anyway
      const e = edges[ei];
      const parentParam = e.a === parent ? 0 : 1;
      const t0p = t0 + (arr[parent] ?? 0);
      const t1c = t0 + (arr[child] ?? 0);
      s0[2 * ei] = t0p;
      s0[2 * ei + 1] = t0p;
      s1[2 * ei] = t1c;
      s1[2 * ei + 1] = t1c;
      sp0[2 * ei] = parentParam;
      sp0[2 * ei + 1] = parentParam;
    }
    aS0.needsUpdate = true;
    aS1.needsUpdate = true;
    aSP0.needsUpdate = true;
    // cf + backfillActive are read from the latest closure when blockPulseAtMs
    // advances (App recomputes cf + backfill + bumps blockPulseAtMs from the same
    // cells-cache render), so [blockPulseAtMs] suffices — matching the courier layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // Dispose the OWNED geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose it
  // on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the live,
  // reused material and force a needless shader recompile on every re-clone.
  useEffect(() => () => mat.dispose(), [mat]);

  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
}
