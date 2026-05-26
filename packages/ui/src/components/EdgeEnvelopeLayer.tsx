import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { bezierAt, bezierControl, fnv1a } from '../geometry/edgeBezier';

/**
 * One in-flight tx propagation between two chain nodes. Consumers
 * (e.g. simulator's `pages/Topology.tsx`) build these from `tx_relayed`
 * events; the layer renders each as a glowing mesh translating along
 * the FlowEdge bezier between the two anchor positions.
 */
export type EdgeEnvelope = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  startMs: number;
  durationMs: number;
  originNodeIdx: number;
};

type Props = {
  envelopes: EdgeEnvelope[];
  nodePositions: Map<string, [number, number, number]>;
  /** Number of chain nodes (used to spread origin-tint hues evenly).
   *  Optional so existing tests that don't supply it still mount; falls
   *  back to a single anchor color when absent or <= 1. */
  chainNodeCount?: number;
};

const ENVELOPE_RADIUS = 0.55;
const FALLBACK_COLOR = new THREE.Color('#7bdcff');
const ORIGIN_COLOR_S = 0.78;
const ORIGIN_COLOR_L = 0.62;

/**
 * Pick a color for an envelope based on which chain node it came from.
 * Hues spread evenly around the wheel so that with N chain nodes each
 * origin reads as a distinct color. The user can answer "this burst
 * came from node X" by glance alone.
 *
 * Falls back to the static FALLBACK_COLOR when count <= 1, since there's
 * nothing to distinguish.
 */
export function colorForOriginIdx(idx: number, count: number): THREE.Color {
  if (count <= 1) return FALLBACK_COLOR.clone();
  const h = (((idx % count) + count) % count) / count;
  return new THREE.Color().setHSL(h, ORIGIN_COLOR_S, ORIGIN_COLOR_L);
}

export type Trajectory = {
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
};

/**
 * Pure helper: for each envelope whose from/to are both present in
 * `nodePositions`, compute the (p0, control, p2) triple used to
 * sample the bezier each frame. Envelopes with a missing endpoint
 * are dropped (and reported once via `onMiss`).
 *
 * The control-point seed mirrors the FlowEdge convention: canonical
 * (lo, hi) ordering on the endpoint ids, FNV-1a over `lo\x00hi`. Same
 * edge → same curve as the asteroid belt that envelopes sit on top of.
 *
 * Exported separately so it can be unit-tested without mounting
 * an r3f Canvas.
 */
export function buildTrajectories(
  envelopes: EdgeEnvelope[],
  nodePositions: Map<string, [number, number, number]>,
  onMiss?: (envId: string, fromId: string, toId: string) => void,
): Map<string, Trajectory> {
  const out = new Map<string, Trajectory>();
  for (const env of envelopes) {
    const from = nodePositions.get(env.fromNodeId);
    const to = nodePositions.get(env.toNodeId);
    if (!from || !to) {
      onMiss?.(env.id, env.fromNodeId, env.toNodeId);
      continue;
    }
    const lo = env.fromNodeId < env.toNodeId ? env.fromNodeId : env.toNodeId;
    const hi = env.fromNodeId < env.toNodeId ? env.toNodeId : env.fromNodeId;
    const seed = fnv1a(`${lo}\x00${hi}`);
    const ctrl = bezierControl(
      from[0], from[1], from[2],
      to[0], to[1], to[2],
      seed,
    );
    out.set(env.id, { p0: from, p1: ctrl, p2: to });
  }
  return out;
}

/**
 * Renders one glowing mesh per active envelope, translating along
 * the same bezier curve used by FlowEdge between the from/to chain
 * nodes.
 */
export default function EdgeEnvelopeLayer({
  envelopes,
  nodePositions,
  chainNodeCount = 0,
}: Props) {
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const warnedRef = useRef<Set<string>>(new Set());

  const trajectories = useMemo(
    () =>
      buildTrajectories(envelopes, nodePositions, (envId, fromId, toId) => {
        if (warnedRef.current.has(envId)) return;
        warnedRef.current.add(envId);
        // eslint-disable-next-line no-console
        console.warn(
          `[EdgeEnvelopeLayer] missing node position for envelope ${envId} ` +
            `(from=${fromId}, to=${toId})`,
        );
      }),
    [envelopes, nodePositions],
  );

  // Cache one color per origin-idx; reused across all envelopes from
  // the same node within this render pass.
  const colorByOrigin = useMemo(() => {
    const m = new Map<number, THREE.Color>();
    for (const env of envelopes) {
      if (!m.has(env.originNodeIdx)) {
        m.set(env.originNodeIdx, colorForOriginIdx(env.originNodeIdx, chainNodeCount));
      }
    }
    return m;
  }, [envelopes, chainNodeCount]);

  useFrame(() => {
    const now = performance.now();
    for (const env of envelopes) {
      const mesh = meshRefs.current.get(env.id);
      const tr = trajectories.get(env.id);
      if (!mesh || !tr) continue;
      const tRaw = (now - env.startMs) / env.durationMs;
      if (tRaw < 0 || tRaw > 1) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const [x, y, z] = bezierAt(
        tr.p0[0], tr.p0[1], tr.p0[2],
        tr.p1[0], tr.p1[1], tr.p1[2],
        tr.p2[0], tr.p2[1], tr.p2[2],
        tRaw,
      );
      mesh.position.set(x, y, z);
      const ease = tRaw < 0.15 ? tRaw / 0.15 : tRaw > 0.85 ? (1 - tRaw) / 0.15 : 1;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.65 + 0.35 * ease;
    }
  });

  // Drop stale mesh refs for envelopes no longer in the list (cap=200 → cheap).
  const liveIds = new Set(envelopes.map((e) => e.id));
  for (const id of Array.from(meshRefs.current.keys())) {
    if (!liveIds.has(id)) meshRefs.current.delete(id);
  }

  return (
    <group>
      {envelopes.map((env) => {
        if (!trajectories.has(env.id)) return null;
        return (
          <mesh
            key={env.id}
            ref={(m) => {
              if (m) meshRefs.current.set(env.id, m);
            }}
            visible={false}
          >
            <octahedronGeometry args={[ENVELOPE_RADIUS, 0]} />
            <meshBasicMaterial
              color={colorByOrigin.get(env.originNodeIdx) ?? FALLBACK_COLOR}
              transparent
              opacity={0.9}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
