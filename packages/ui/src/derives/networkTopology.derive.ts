// packages/ui/src/derives/networkTopology.derive.ts
// Pure data shapers for the P2P "colony" network. No React, no three.js —
// unit-tested directly. Everything is a pure function of (peers, seed, roster).

import { mulberry32, CHAIN_Y } from '../layout';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from './peers.derive';
import type { Vec3, NetworkNode, NetworkEdge, NetworkTopology, EdgeKind } from '../types';
import type { NetworkRosterRecord, Peer } from '@cknerv/types';

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

/** Mixing constants for a sighted node's placement hashes.
 *
 *  `peerAngle` runs its own `h * 31 + charCode` stream and supplies the ANGLE.
 *  Reusing that stream for the radius would stand every sighted node on one
 *  spiral, so radius and height each mix the id under a different odd
 *  multiplier and finish with an avalanche — three uncorrelated draws from one
 *  id, which is the whole placement budget a node with no link to us earns. */
const SIGHTED_RADIUS_MIX = 0x27220a95;
const SIGHTED_Y_MIX = 0x165667b1;

/** [0,1) from a node id under `mix`. Pure, order-independent, and stable for
 *  the life of the id — a sighted node must land on the same spot after a
 *  reconnect, a crawl round, or a roster that arrived in another order. */
export function sightedHash01(nodeId: string, mix: number): number {
  let h = (0x811c9dc5 ^ mix) >>> 0;
  for (let i = 0; i < nodeId.length; i += 1) {
    h = Math.imul(h ^ nodeId.charCodeAt(i), mix);
  }
  // Short base58 ids leave the low bits nearly constant without this.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Where the scene stands a sighted node: the same elliptical disc the ghost
 *  scatter fills, sampled purely from the id. It is placement, never geography
 *  and never latency — the crawler observed a node, not a location. */
export function sightedPos(nodeId: string): Vec3 {
  const a = peerAngle(nodeId);
  const r = Math.sqrt(sightedHash01(nodeId, SIGHTED_RADIUS_MIX)) * COLONY_RADIUS;
  return [
    Math.cos(a) * r * COLONY_ELLIPSE_X,
    COLONY_Y + (sightedHash01(nodeId, SIGHTED_Y_MIX) - 0.5) * COLONY_Y_THICKNESS,
    Math.sin(a) * r * COLONY_ELLIPSE_Z,
  ];
}

/**
 * The crawler's roster as stageable nodes, in the order it sent them.
 *
 * MEASURED WINS: an entry we hold a live link to is already on stage with its
 * real position and its real edge, so the sighted copy is dropped rather than
 * standing a second marker for one node. The local node is dropped for the
 * same reason. A repeated id inside one roster is dropped too — the cap and
 * the ordering are the server's contract, but a duplicate would double-book an
 * instance in the hit mesh, so tolerate it here.
 */
export function stageSighted(
  roster: NetworkRosterRecord | null | undefined,
  peers: Peer[],
  localId: string,
): NetworkNode[] {
  if (!roster || roster.entries.length === 0) return [];
  const linked = new Set<string>([localId]);
  for (const p of peers) linked.add(p.node_id);
  const out: NetworkNode[] = [];
  const staged = new Set<string>();
  for (const entry of roster.entries) {
    if (linked.has(entry.node_id) || staged.has(entry.node_id)) continue;
    staged.add(entry.node_id);
    out.push({
      id: entry.node_id, kind: 'sighted', pos: sightedPos(entry.node_id), sighted: entry,
    });
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

/** The linkless half of the colony: the ghost scatter plus every sighted node,
 *  and their internal edges. Immutable and shared across `inferredTopology`
 *  calls. `nodes` runs ghosts first, then sighted, so `ghostCount` splits it. */
interface InferredScaffold {
  nodes: readonly NetworkNode[];
  edges: readonly NetworkEdge[];
  ghostCount: number;
}

// Single-slot memo: the scaffold is a pure function of (`seed`, sighted ids),
// the app uses one seed for its lifetime, and rebuilding it is the O(V² log V)
// part of the topology (scatter rejection sampling + per-node kNN sorts).
// Latency-driven rebuilds of the measured overlay reuse the cached scaffold
// untouched, and so does a fresh crawl round that named the same nodes.
let scaffoldCacheSeed: number | null = null;
let scaffoldCacheSightedKey: string | null = null;
let scaffoldCache: InferredScaffold | null = null;

/** Cache key for the sighted half. Positions, edges and ghost count all follow
 *  from the ids alone, so ids alone decide whether the geometry can be reused
 *  (the crawler's payload rides along separately — see `inferredTopology`). */
function sightedKey(sighted: readonly NetworkNode[]): string {
  return sighted.map((n) => n.id).join(' ');
}

/** Build (or reuse) the linkless scaffold. The construction order — kNN edges,
 *  long-range links, connectivity bridges — and the rng stream are
 *  byte-identical to the pre-cache inline build, so every downstream layout
 *  and the ⭐ churn-stability invariant are preserved exactly.
 *
 *  Sighted nodes are laid into the SAME graph as the ghosts: a crawler tells us
 *  a node exists, never who it talks to, so its edges are the identical
 *  geometric fiction and every one of them stays `kind: 'inferred'`. With an
 *  empty sighted list this is the pre-roster build, node for node and edge for
 *  edge. */
function inferredScaffold(seed: number, sighted: readonly NetworkNode[]): InferredScaffold {
  const cacheKey = sightedKey(sighted);
  if (scaffoldCache !== null && scaffoldCacheSeed === seed && scaffoldCacheSightedKey === cacheKey) {
    return scaffoldCache;
  }
  const infPts = scatterInferred(seed);
  // ⭐ Prefix fill: sighted nodes take the ghosts' places one for one, and the
  // ghosts that remain are the FIRST points of the untouched seed-pure scatter.
  // Nothing is re-rolled and nothing is re-parameterized, so a ghost never
  // moves when the roster grows — the cloud only gets shorter from the tail.
  const ghostCount = Math.max(0, infPts.length - sighted.length);
  const nodes: NetworkNode[] = infPts.slice(0, ghostCount).map((pos, n) => (
    { id: `inf:${n}`, kind: 'inferred', pos }
  ));
  for (const s of sighted) nodes.push(s);

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

  // kNN base degree over the scaffold.
  const rng = mulberry32((seed ^ 0x85ebca77) >>> 0);
  const kNearestInf = (localI: number, k: number): number[] => {
    const ds: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) if (j !== localI) ds.push({ j, d: dist2(nodes[localI].pos, nodes[j].pos) });
    ds.sort((a, b) => a.d - b.d);
    return ds.slice(0, k).map((o) => o.j);
  };
  for (let i = 0; i < nodes.length; i++) {
    for (const j of kNearestInf(i, COLONY_KNN)) add(i, j, 'inferred');
  }
  // Long-range small-world links.
  for (let i = 0; i < nodes.length; i++) {
    if (rng() < COLONY_LONGRANGE_PROB && nodes.length > 1) {
      add(i, Math.floor(rng() * nodes.length), 'inferred');
    }
  }
  // Connectivity: bridge any island to its nearest node in component 0.
  ensureConnectedFrom(nodes, 0, buildAdjacency(nodes, edges), add);

  scaffoldCacheSeed = seed;
  scaffoldCacheSightedKey = cacheKey;
  scaffoldCache = { nodes, edges, ghostCount };
  return scaffoldCache;
}

export function inferredTopology(
  peers: Peer[], seed: number, localId: string = LOCAL_ID_FALLBACK, localPos?: Vec3,
  roster?: NetworkRosterRecord | null,
): NetworkTopology {
  // 1) local anchor. When a `localPos` is supplied (App pins it onto the galaxy's
  //    labeled CkbNodeAnchor so there's a single "you"), it IS the local node's
  //    position AND the anchor the measured peers scatter around. Otherwise fall
  //    back to the seed-only localAnchor(seed) — preserving every existing caller.
  //    NB: this only moves the local + measured core; the ghost scatter behind
  //    the cloud stays seed-ONLY (and cached), so the ⭐ churn-stability
  //    invariant holds regardless of peers OR localPos.
  const anchor = localPos ?? localAnchor(seed);
  const nodes: NetworkNode[] = [{ id: localId, kind: 'local', pos: anchor }];
  const localIdx = 0;

  // 2) measured core overlaid (peer-dependent)
  const measuredIdx: number[] = [];
  for (const p of peers) {
    measuredIdx.push(nodes.length);
    nodes.push({ id: p.node_id, kind: 'measured', pos: measuredPeerPos(anchor, p), peer: p });
  }

  // 3) the linkless cloud (cached): shared immutable node/edge objects appended
  //    after the measured core, preserving the historical node order (local,
  //    measured…, ghosts…, sighted…) and edge order (cloud internals first,
  //    then measured spokes, then relay stitches). Sighted nodes are staged
  //    from the roster the crawler sent, minus anyone we already hold a link to.
  const infStart = nodes.length;
  const sighted = stageSighted(roster, peers, localId);
  const scaffold = inferredScaffold(seed, sighted);
  for (let i = 0; i < scaffold.ghostCount; i += 1) nodes.push(scaffold.nodes[i]);
  // The cache holds GEOMETRY, not the crawler's report: the sighted tail is
  // re-staged from the current roster row every build, so a node going
  // unreachable or a fresher last_seen crosses without an O(V² log V) rebuild.
  // Ids are what the cache is keyed on, so this tail can never disagree with
  // the cached edges about who is standing where.
  for (const n of sighted) nodes.push(n);
  const edges: NetworkEdge[] = scaffold.edges.slice();

  // 4) measured edges local↔peer (observed) + stitch core into the cloud.
  //    These pairs (local/measured ↔ anything) cannot collide with the
  //    scaffold's internal set, and each is constructed at most once below,
  //    so no cross-set dedup is needed. The relay stitch may land on a sighted
  //    node — it is the same declared fiction either way.
  const addEdge = (i: number, j: number, kind: EdgeKind) => {
    if (i === j) return;
    edges.push({ a: nodes[i].id, b: nodes[j].id, kind, weight: Math.sqrt(dist2(nodes[i].pos, nodes[j].pos)) });
  };
  for (const mi of measuredIdx) addEdge(localIdx, mi, 'measured');
  const nearestCloudNode = (i: number): number => {
    let best = -1, bestD = Infinity;
    for (let j = infStart; j < nodes.length; j++) {
      const d = dist2(nodes[i].pos, nodes[j].pos);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  };
  for (const i of [localIdx, ...measuredIdx]) {
    const j = nearestCloudNode(i);
    if (j >= 0) addEdge(i, j, 'inferred'); // relay edge into the colony (not "observed")
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
