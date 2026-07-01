// packages/ui/src/derives/networkFlood.derive.ts
// Pure graph-flood over the colony topology. No React, no three.js.

import { mulberry32 } from '../layout';
import { fnv1a } from '../geometry/edgeBezier';
import { dist2 } from './networkTopology.derive';
import type { NetworkTopology } from '../types';

/** Pick a non-local flood origin, biased FAR from local so the front travels to us. */
export function pickOrigin(topology: NetworkTopology, nonce: number): string {
  const rng = mulberry32((fnv1a(topology.localId) ^ (Math.floor(nonce) >>> 0)) >>> 0);
  const local = topology.nodes.find((n) => n.id === topology.localId)!;
  const cands = topology.nodes.filter((n) => n.id !== topology.localId);
  if (cands.length === 0) return topology.localId;
  // weight ∝ geometric distance from local (farther = more likely origin)
  const weights = cands.map((n) => Math.sqrt(dist2(n.pos, local.pos)) + 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i].id; }
  return cands[cands.length - 1].id;
}

/** Dijkstra shortest-path arrival times from origin over the weighted graph. */
export function floodArrivalTimes(
  topology: NetworkTopology, originId: string,
): { arrival: Map<string, number>; predecessor: Map<string, string | null> } {
  const arrival = new Map<string, number>();
  const predecessor = new Map<string, string | null>();
  const visited = new Set<string>();
  for (const n of topology.nodes) { arrival.set(n.id, Infinity); predecessor.set(n.id, null); }
  arrival.set(originId, 0);
  // O(V^2) is fine for a few hundred nodes and avoids a heap dependency.
  for (let iter = 0; iter < topology.nodes.length; iter++) {
    let u: string | null = null, best = Infinity;
    for (const [id, d] of arrival) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null || best === Infinity) break;
    visited.add(u);
    for (const { to, weight } of topology.adjacency.get(u) ?? []) {
      if (visited.has(to)) continue;
      const nd = best + weight;
      if (nd < (arrival.get(to) ?? Infinity)) { arrival.set(to, nd); predecessor.set(to, u); }
    }
  }
  return { arrival, predecessor };
}

/** Total wall-clock span of a flood (seconds since the block pulse). Tune live. */
export const FLOOD_DURATION_S = 2.0;
export const HERO_MIN_FRAC = 0.15;   // never feed the queen before this fraction
export const HERO_MAX_FRAC = 0.85;   // …nor after this (so she's fed before the flood ends)

export interface ColonyFlood {
  entryId: string | null;                            // flood origin (may be inferred)
  localReceiveDelayS: number;                        // hero timing (measured-worker feed)
  arrivals: Record<string, number>;                  // MEASURED peers → secondsSincePulse (boluses)
  senders: Record<string, string | null>;            // MEASURED peers → flood predecessor
  colonyArrivalS: Record<string, number>;            // ALL nodes → secondsSincePulse (node flash)
  colonyPredecessor: Record<string, string | null>;  // ALL nodes → predecessor (edge-pulse direction)
}

export function colonyFlood(topology: NetworkTopology, nonce: number): ColonyFlood {
  if (topology.nodes.length <= 1) {
    return { entryId: null, localReceiveDelayS: 0, arrivals: {}, senders: {}, colonyArrivalS: {}, colonyPredecessor: {} };
  }
  const originId = pickOrigin(topology, nonce);
  const { arrival, predecessor } = floodArrivalTimes(topology, originId);

  let maxA = 0;
  for (const d of arrival.values()) if (Number.isFinite(d) && d > maxA) maxA = d;
  const scale = maxA > 0 ? FLOOD_DURATION_S / maxA : 0;

  const colonyArrivalS: Record<string, number> = {};
  const colonyPredecessor: Record<string, string | null> = {};
  const arrivals: Record<string, number> = {};
  const senders: Record<string, string | null> = {};
  for (const n of topology.nodes) {
    const s = (arrival.get(n.id) ?? 0) * scale;
    colonyArrivalS[n.id] = s;
    colonyPredecessor[n.id] = predecessor.get(n.id) ?? null;
    if (n.kind === 'measured') { arrivals[n.id] = s; senders[n.id] = predecessor.get(n.id) ?? null; }
  }

  const rawLocal = colonyArrivalS[topology.localId] ?? 0;
  const localReceiveDelayS = Math.min(
    Math.max(rawLocal, FLOOD_DURATION_S * HERO_MIN_FRAC),
    FLOOD_DURATION_S * HERO_MAX_FRAC,
  );

  return { entryId: originId, localReceiveDelayS, arrivals, senders, colonyArrivalS, colonyPredecessor };
}
