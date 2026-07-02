// packages/ui/src/derives/networkTopology.derive.ts
// Pure data shapers for the P2P "colony" network. No React, no three.js —
// unit-tested directly. Everything is a pure function of (peers, seed).

import { mulberry32, CHAIN_Y } from '../layout';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from './peers.derive';
import type { Vec3, NetworkNode, NetworkEdge, NetworkTopology, EdgeKind } from '../types';
import type { Peer } from '@cknerv/types';

/** Peer-independent inferred-node count (seeded ±). Tune live. */
export const COLONY_INFERRED_COUNT = 240;
export const COLONY_INFERRED_JITTER = 30;
/** XZ extent of the colony volume; the measured core sits well inside. */
export const COLONY_RADIUS = 92;
export const COLONY_ELLIPSE_X = 1.25;    // echo the cells-canopy footprint
export const COLONY_ELLIPSE_Z = 0.85;
export const COLONY_Y = CHAIN_Y;         // colony centered on the chain plane
export const COLONY_Y_THICKNESS = 14;    // shallow vertical spread
export const COLONY_MIN_SPACING = 6;     // min distance between inferred nodes
export const COLONY_KNN = 4;             // geometric base degree
export const COLONY_LONGRANGE_PROB = 0.35; // expected long-range links / node
export const LOCAL_ANCHOR_OFFSET = 30;   // local sits ~this far off-center
export const LOCAL_ID_FALLBACK = 'ckb:local';

export function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Local node's seeded anchor — offset from center so it isn't a hub. */
export function localAnchor(seed: number): Vec3 {
  const rng = mulberry32(seed >>> 0);
  const a = rng() * Math.PI * 2;
  return [
    Math.cos(a) * LOCAL_ANCHOR_OFFSET * COLONY_ELLIPSE_X,
    COLONY_Y,
    Math.sin(a) * LOCAL_ANCHOR_OFFSET * COLONY_ELLIPSE_Z,
  ];
}

/** Measured peer position: latency→radius, id-hash→angle, around the anchor. */
export function measuredPeerPos(anchor: Vec3, p: Peer): Vec3 {
  const t = latencyToRadius01(p.latency_ms);
  const r = PEER_INNER_RADIUS + t * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
  const a = peerAngle(p.node_id);
  return [
    anchor[0] + Math.cos(a) * r * COLONY_ELLIPSE_X,
    COLONY_Y,
    anchor[2] + Math.sin(a) * r * COLONY_ELLIPSE_Z,
  ];
}

/**
 * Peer-INDEPENDENT inferred node scatter — rejection sampling with a min-spacing
 * constraint over the elliptical colony disc. Pure function of `seed` ONLY: this
 * is what makes the ⭐ churn-stability invariant hold. Never reference peers here.
 */
export function scatterInferred(seed: number): Vec3[] {
  // decorrelate this stream from localAnchor's stream
  const rng = mulberry32((seed ^ 0x9e3779b1) >>> 0);
  const target = COLONY_INFERRED_COUNT + Math.floor((rng() - 0.5) * 2 * COLONY_INFERRED_JITTER);
  const out: Vec3[] = [];
  const min2 = COLONY_MIN_SPACING * COLONY_MIN_SPACING;
  const maxAttempts = target * 40;
  let attempts = 0;
  while (out.length < target && attempts < maxAttempts) {
    attempts += 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * COLONY_RADIUS;   // sqrt → uniform over the disc
    const cand: Vec3 = [
      Math.cos(a) * r * COLONY_ELLIPSE_X,
      COLONY_Y + (rng() - 0.5) * COLONY_Y_THICKNESS,
      Math.sin(a) * r * COLONY_ELLIPSE_Z,
    ];
    let ok = true;
    for (let i = 0; i < out.length; i++) {
      if (dist2(out[i], cand) < min2) { ok = false; break; }
    }
    if (ok) out.push(cand);
  }
  return out;
}

export function buildAdjacency(
  nodes: NetworkNode[], edges: NetworkEdge[],
): Map<string, { to: string; weight: number }[]> {
  const adj = new Map<string, { to: string; weight: number }[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.a)?.push({ to: e.b, weight: e.weight });
    adj.get(e.b)?.push({ to: e.a, weight: e.weight });
  }
  return adj;
}

export function inferredTopology(
  peers: Peer[], seed: number, localId: string = LOCAL_ID_FALLBACK, localPos?: Vec3,
): NetworkTopology {
  const nodes: NetworkNode[] = [];

  // 1) local anchor. When a `localPos` is supplied (App pins it onto the galaxy's
  //    labeled CkbNodeAnchor so there's a single "you"), it IS the local node's
  //    position AND the anchor the measured peers scatter around. Otherwise fall
  //    back to the seed-only localAnchor(seed) — preserving every existing caller.
  //    NB: this only moves the local + measured core; the inferred scaffold below
  //    stays seed-ONLY, so the ⭐ churn-stability invariant holds regardless of
  //    peers OR localPos.
  const anchor = localPos ?? localAnchor(seed);
  nodes.push({ id: localId, kind: 'local', pos: anchor });
  const localIdx = 0;

  // 2) measured core overlaid (peer-dependent)
  const measuredIdx: number[] = [];
  for (const p of peers) {
    measuredIdx.push(nodes.length);
    nodes.push({ id: p.node_id, kind: 'measured', pos: measuredPeerPos(anchor, p), peer: p });
  }

  // 3) inferred scaffold (seed-only)
  const infStart = nodes.length;
  const infPts = scatterInferred(seed);
  infPts.forEach((pos, n) => nodes.push({ id: `inf:${n}`, kind: 'inferred', pos }));

  // --- edges ---
  const edges: NetworkEdge[] = [];
  const seen = new Set<string>();
  const key = (i: number, j: number) => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const add = (i: number, j: number, kind: EdgeKind) => {
    if (i === j) return;
    const k = key(i, j);
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: nodes[i].id, b: nodes[j].id, kind, weight: Math.sqrt(dist2(nodes[i].pos, nodes[j].pos)) });
  };

  // 3a) inferred↔inferred: kNN base over ONLY the inferred scaffold (seed-only)
  const rng = mulberry32((seed ^ 0x85ebca77) >>> 0);
  const infNodes = nodes.slice(infStart);
  const kNearestInf = (localI: number, k: number): number[] => {
    const ds: { j: number; d: number }[] = [];
    for (let j = 0; j < infNodes.length; j++) if (j !== localI) ds.push({ j, d: dist2(infNodes[localI].pos, infNodes[j].pos) });
    ds.sort((a, b) => a.d - b.d);
    return ds.slice(0, k).map((o) => o.j);
  };
  for (let i = 0; i < infNodes.length; i++) {
    for (const j of kNearestInf(i, COLONY_KNN)) add(infStart + i, infStart + j, 'inferred');
  }
  // 3b) inferred long-range small-world links (seed-only)
  for (let i = 0; i < infNodes.length; i++) {
    if (rng() < COLONY_LONGRANGE_PROB && infNodes.length > 1) {
      add(infStart + i, infStart + Math.floor(rng() * infNodes.length), 'inferred');
    }
  }
  // 3c) connectivity: bridge any island of the inferred scaffold to its nearest earlier node
  ensureConnectedFrom(nodes, infStart, buildAdjacency(nodes, edges), add);

  // 4) measured edges local↔peer (observed) + stitch core into the scaffold
  for (const mi of measuredIdx) add(localIdx, mi, 'measured');
  const nearestInferred = (i: number): number => {
    let best = -1, bestD = Infinity;
    for (let j = infStart; j < nodes.length; j++) {
      const d = dist2(nodes[i].pos, nodes[j].pos);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  };
  for (const i of [localIdx, ...measuredIdx]) {
    const j = nearestInferred(i);
    if (j >= 0) add(i, j, 'inferred'); // relay edge into the colony (not "observed")
  }

  return { provenance: 'inferred', localId, nodes, edges, adjacency: buildAdjacency(nodes, edges) };
}

/** Union islands (restricted to nodes at index ≥ `start`) into one component by
 *  bridging each extra island's representative to the nearest node in component 0.
 *  Exported for out-of-band testing: the real inferred scaffold is always already
 *  connected, so this multi-island bridge branch never fires in production. */
export function ensureConnectedFrom(
  nodes: NetworkNode[], start: number,
  adj: Map<string, { to: string; weight: number }[]>,
  add: (i: number, j: number, kind: EdgeKind) => void,
): void {
  const idxById = new Map(nodes.map((n, i) => [n.id, i]));
  const comp = new Map<string, number>();
  let c = 0;
  for (let i = start; i < nodes.length; i++) {
    const id = nodes[i].id;
    if (comp.has(id)) continue;
    const stack = [id];
    while (stack.length) {
      const u = stack.pop()!;
      if (comp.has(u)) continue;
      comp.set(u, c);
      for (const { to } of adj.get(u) ?? []) if ((idxById.get(to) ?? -1) >= start && !comp.has(to)) stack.push(to);
    }
    c += 1;
  }
  if (c <= 1) return;
  // connect representative of each component>0 to nearest node in component 0
  const comp0 = nodes.filter((n) => comp.get(n.id) === 0);
  for (let k = 1; k < c; k++) {
    const rep = nodes.find((n) => comp.get(n.id) === k)!;
    let best = comp0[0], bestD = Infinity;
    for (const q of comp0) { const d = dist2(rep.pos, q.pos); if (d < bestD) { bestD = d; best = q; } }
    add(idxById.get(rep.id)!, idxById.get(best.id)!, 'inferred');
  }
}
