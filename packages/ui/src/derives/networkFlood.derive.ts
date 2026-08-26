// packages/ui/src/derives/networkFlood.derive.ts
// Pure graph-flood over the colony topology. No React, no three.js.

import { mulberry32 } from '../layout';
import { fnv1a } from '../geometry/edgeBezier';
import { attestedNodeId, dist2 } from './networkTopology.derive';
import type { NetworkTopology } from '../types';

/**
 * Pick a flood origin among the ANONYMOUS scatter, biased FAR from local so the
 * front travels to us. THE FALLBACK HALF of the origin rule: `colonyFlood` asks
 * `attestedOrigin` first, and lands here whenever the chain named nobody this
 * colony is standing a node for.
 *
 * ⭐ ORIGIN AND RELAY ARE DIFFERENT CLAIMS, and this comment used to run them
 * together. It said the origin may only ever be anonymous because "no source we
 * read reports who relayed a block". One half of that is still exactly true and
 * the other half is now false:
 *
 *   RELAY IS STILL UNREPORTED. Nothing cknerv reads says which node handed us a
 *   block. Every hop this flood draws is geometric fiction end to end
 *   (`provenance: 'inferred'`, every scaffold edge `kind: 'inferred'`), and
 *   named nodes light as the front crosses them only because RECEIVING a block
 *   is the true part — every peer really does.
 *
 *   ORIGIN IS NOW REPORTED. The cellbase witness names the block's CREATOR, and
 *   creating is not relaying: it is the chain stating which entity made this
 *   block, inside the block. `attestedOrigin` reads that name, and the wave
 *   starts where the block was made.
 *
 * ⭐⭐ THE 2026-08-24 SHOCKWAVE RULING (`45270d0`, "the block enters the colony
 * through no one's name") IS AMENDED, NOT EXCEPTED. It held that a named node
 * may RECEIVE a wave and may never SOURCE one, and it decided that on a stated
 * criterion — SINGLE-POINT ACCUSATION vs DIFFUSE FACT: a fiction may lie on
 * anonymous scatter, and may never be pinned onto an identity carrying real
 * crawler values. An `attested` node MEETS that criterion rather than escaping
 * it, on both halves at once:
 *
 *   - IT HAS NO IDENTITY TO ACCUSE. No base58 id, no address, no country, no
 *     ASN, no client version — `ProducerStanding` has no field one could land
 *     in. The only string on it is a payout key, which is what the chain
 *     attests, and a payout key is not a machine.
 *   - AND THE CLAIM IS BACKED. "This entity made this block" is the one origin
 *     statement in this whole scene that nobody invented.
 *
 * So the ruling stands UNCHANGED for `measured` and `sighted`, and the filter
 * below is where it stands: landing an origin on a `sighted` node would pin an
 * invented "first" onto a REAL base58 identity whose card carries real crawler
 * facts (country, ASN, client version, last_seen); landing it on a `measured`
 * peer would in addition leave `arrivals[id] = 0` below, launching a delivery
 * carrier into the Cell canopy at t=0 — the scene physically asserting that
 * named peer handed us this block. `attested` is a third evidence class the
 * ruling's author had no example of, not a hole in the ruling.
 *
 * ⚠️ THIS IS A LIVE PATH, not a defensive branch, and three ordinary things
 * arrive on it: a block whose cellbase names nobody; a producer that left the
 * rolling window between the pulse and this render; and a MID-SESSION RESYNC —
 * lag → reconnect `?since=0` → server re-snapshot, which restores a pulse stamp
 * and deliberately carries no producer across it, because a snapshot knows when
 * the server last pulsed and nothing whatever about who earned it.
 *
 * ⇒ Everything below — the anonymity filter, the distance weighting, the rng
 * seeding, the scatter-less fallback — is UNCHANGED and must stay so. With no
 * producer resolved this function chooses exactly what it chose before
 * producers existed, so an unnamed block still draws the wave it drew
 * yesterday, and a scatter-less topology (labs, fixtures, the degenerate
 * few-node case) still narrows the choice rather than collapsing the origin
 * onto local.
 */
export function pickOrigin(topology: NetworkTopology, nonce: number): string {
  const rng = mulberry32((fnv1a(topology.localId) ^ (Math.floor(nonce) >>> 0)) >>> 0);
  const local = topology.nodes.find((n) => n.id === topology.localId)!;
  const anonymous = topology.nodes.filter((n) => n.kind === 'inferred');
  const cands = anonymous.length > 0
    ? anonymous
    : topology.nodes.filter((n) => n.id !== topology.localId);
  if (cands.length === 0) return topology.localId;
  // weight ∝ geometric distance from local (farther = more likely origin)
  const weights = cands.map((n) => Math.sqrt(dist2(n.pos, local.pos)) + 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i].id; }
  return cands[cands.length - 1].id;
}

/**
 * The origin the CHAIN named, when the colony is standing a node for it.
 *
 * `producerKey` rides the block pulse BY VALUE (`CellDelta::Pulse`), because
 * the producer window lives on the `Chain` entity and reaches a client on a
 * DIFFERENT stream with its own revision and its own flush — resolving a name
 * at draw time is a race whose wrong answers are rare, plausible and silent.
 * `pickOrigin` above carries the argument for why an `attested` node may hold
 * an origin at all, and why no other named tier ever may.
 *
 * ⚠️ A KEY THAT IS PRESENT BUT NOT STAGED FALLS BACK. It must never throw and
 * must never invent the node, and that is not defensive coding: the pulse's
 * producer and the colony's producer window are two readings of one rolling
 * window taken at different moments on different streams, so a producer that
 * fired this wave and then left the window before this render is an ORDINARY
 * event. So is a key that arrives before the chain stream has caught up. An
 * anonymous wave is the honest answer to both, and it is the answer
 * `pickOrigin` has always given.
 *
 * The `kind` is asked for as well as the id. `attestedNodeId` already files the
 * key under a namespace no peer id wears, so matching the id alone would be
 * safe today — but the rule is "the node the chain attests", and asking the
 * graph for the rule costs one field read and does not rest on an alphabet.
 */
export function attestedOrigin(
  topology: NetworkTopology, producerKey?: string | null,
): string | null {
  if (typeof producerKey !== 'string' || producerKey.length === 0) return null;
  const id = attestedNodeId(producerKey);
  const node = topology.nodes.find((n) => n.id === id);
  return node !== undefined && node.kind === 'attested' ? node.id : null;
}

/**
 * Dijkstra shortest-path arrival times from origin over the weighted graph.
 *
 * Runs on integer node indices in typed arrays behind a binary heap. This is on
 * the render path — re-run for every block pulse and every topology rebuild, at
 * V≈250-460 and E≈700 — so the frontier may not be found by re-scanning every
 * node's distance on every settle.
 *
 * ⭐ Ties settle in NODE ORDER, lowest `topology.nodes` index first, which is
 * why the heap carries the index as a second key instead of leaving equal
 * distances to heap shape. Equal-cost routes are routine on a scaffold whose
 * edges are mirrored geometry, and the winner is the `predecessor` an edge
 * pulse draws its direction from — leave it to chance and the colony's relay
 * arrows reshuffle between two identical floods.
 *
 * ⚠️ WHICH MAKES NODE ORDER LOAD-BEARING ALL THE WAY BACK TO WHOEVER SEQUENCED
 * THE STAGED TAILS. The producer tail arrives in `BlockProducerView`'s
 * `staging` order — key ascending — precisely so this tie-break is a function
 * of WHICH miners exist. While that array was sequenced by blocks, two miners
 * trading rank permuted the tail and re-decided every tie among them, for a set
 * that had not changed; it also missed the scaffold memo, so the edges being
 * tied over were rebuilt at the same time. Under a key order the tail moves
 * only when the set does, which is the one occasion a reshuffle is honest.
 */
export function floodArrivalTimes(
  topology: NetworkTopology, originId: string,
): { arrival: Map<string, number>; predecessor: Map<string, string | null> } {
  // One slot per DISTINCT id, in first-appearance order: the returned maps are
  // keyed and ordered exactly as the node list presents them, and a repeated id
  // is one node rather than two.
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  for (const n of topology.nodes) {
    if (indexById.has(n.id)) continue;
    indexById.set(n.id, ids.length);
    ids.push(n.id);
  }
  // An origin the node list never mentioned still floods, and still reports no
  // predecessor row of its own — it is not one of the topology's nodes.
  const nodeCount = ids.length;
  let origin = indexById.get(originId);
  if (origin === undefined) {
    origin = ids.length;
    indexById.set(originId, origin);
    ids.push(originId);
  }
  const count = ids.length;
  const dist = new Float64Array(count).fill(Infinity);
  const pred = new Int32Array(count).fill(-1);
  const settled = new Uint8Array(count);
  dist[origin] = 0;

  // Lazy-deletion heap: a relaxed node is pushed again rather than sifted in
  // place, and the stale copy is dropped when it surfaces already settled.
  let cap = Math.max(16, count);
  let heapDist = new Float64Array(cap);
  let heapNode = new Int32Array(cap);
  let heapSize = 0;
  const before = (ad: number, ai: number, bd: number, bi: number): boolean => (
    ad !== bd ? ad < bd : ai < bi
  );
  const push = (d: number, node: number): void => {
    if (heapSize === cap) {
      cap *= 2;
      const grownDist = new Float64Array(cap); grownDist.set(heapDist); heapDist = grownDist;
      const grownNode = new Int32Array(cap); grownNode.set(heapNode); heapNode = grownNode;
    }
    let i = heapSize;
    heapSize += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(d, node, heapDist[parent], heapNode[parent])) break;
      heapDist[i] = heapDist[parent]; heapNode[i] = heapNode[parent];
      i = parent;
    }
    heapDist[i] = d; heapNode[i] = node;
  };
  const pop = (): number => {
    const top = heapNode[0];
    heapSize -= 1;
    if (heapSize > 0) {
      const d = heapDist[heapSize], node = heapNode[heapSize];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= heapSize) break;
        const right = left + 1;
        const child = right < heapSize
          && before(heapDist[right], heapNode[right], heapDist[left], heapNode[left])
          ? right : left;
        if (!before(heapDist[child], heapNode[child], d, node)) break;
        heapDist[i] = heapDist[child]; heapNode[i] = heapNode[child];
        i = child;
      }
      heapDist[i] = d; heapNode[i] = node;
    }
    return top;
  };

  push(0, origin);
  while (heapSize > 0) {
    const u = pop();
    if (settled[u]) continue;
    settled[u] = 1;
    const base = dist[u];
    for (const { to, weight } of topology.adjacency.get(ids[u]) ?? []) {
      const v = indexById.get(to);
      // `adjacency` is built from the node list, so a neighbour nobody declared
      // is a malformed topology, not a node the flood may invent.
      if (v === undefined || settled[v] === 1) continue;
      const nd = base + weight;
      if (nd < dist[v]) { dist[v] = nd; pred[v] = u; push(nd, v); }
    }
  }

  const arrival = new Map<string, number>();
  const predecessor = new Map<string, string | null>();
  for (let i = 0; i < count; i += 1) {
    arrival.set(ids[i], dist[i]);
    if (i < nodeCount) predecessor.set(ids[i], pred[i] >= 0 ? ids[pred[i]] : null);
  }
  return { arrival, predecessor };
}

/** Total wall-clock span of a flood (seconds since the block pulse). Tune live. */
export const FLOOD_DURATION_S = 2.0;
export const HERO_MIN_FRAC = 0.15;   // never commit locally before this fraction
export const HERO_MAX_FRAC = 0.85;   // …nor after this (commit before the flood ends)

/** Clamp the hero (local) receive delay into the flood window's hero band
 *  [FLOOD_DURATION_S·HERO_MIN_FRAC, FLOOD_DURATION_S·HERO_MAX_FRAC] = [0.3, 1.7]s,
 *  so the local Cell field commits neither at t≈0 nor after the flood ends. Exported so the
 *  bound math is unit-tested out-of-band (a swapped/mistyped bound would bite). */
export function clampHeroDelayS(rawSec: number): number {
  return Math.min(
    Math.max(rawSec, FLOOD_DURATION_S * HERO_MIN_FRAC),
    FLOOD_DURATION_S * HERO_MAX_FRAC,
  );
}

export interface ColonyFlood {
  // The block's producer when the chain named one we are standing a node
  // for, else the anonymous ghost pick — see `pickOrigin`.
  entryId: string | null;
  localReceiveDelayS: number;                        // hero timing (measured-worker feed)
  arrivals: Record<string, number>;                  // MEASURED peers → carrier arrival age
  senders: Record<string, string | null>;            // MEASURED peers → flood predecessor
  colonyArrivalS: Record<string, number>;            // ALL nodes → secondsSincePulse (node flash)
  colonyPredecessor: Record<string, string | null>;  // ALL nodes → predecessor (edge-pulse direction)
}

/**
 * The whole per-block schedule: where the wave starts, when it reaches every
 * node, and when the local Cell field commits.
 *
 * `producerKey` is the producer of the block that FIRED THIS PULSE, carried by
 * value on the pulse delta. Standing in this colony ⇒ the wave starts at that
 * node, which is the one origin claim in the scene the chain actually backs.
 * Absent, or naming a producer this topology holds no node for ⇒ the anonymous
 * ghost pick, unchanged in every detail. Both halves are argued on
 * `pickOrigin`; `attestedOrigin` is the one that decides between them.
 */
export function colonyFlood(
  topology: NetworkTopology, nonce: number, producerKey?: string | null,
): ColonyFlood {
  if (topology.nodes.length <= 1) {
    return { entryId: null, localReceiveDelayS: 0, arrivals: {}, senders: {}, colonyArrivalS: {}, colonyPredecessor: {} };
  }
  // The chain's name first, the anonymous scatter when there is none to
  // stand on. `nonce` still seeds the fallback exactly as it always did, so
  // an unnamed block draws the wave it drew before producers existed.
  const originId = attestedOrigin(topology, producerKey) ?? pickOrigin(topology, nonce);
  const { arrival, predecessor } = floodArrivalTimes(topology, originId);

  let maxA = 0;
  for (const d of arrival.values()) if (Number.isFinite(d) && d > maxA) maxA = d;
  const scale = maxA > 0 ? FLOOD_DURATION_S / maxA : 0;

  const colonyArrivalS: Record<string, number> = {};
  const colonyPredecessor: Record<string, string | null> = {};
  const arrivals: Record<string, number> = {};
  const senders: Record<string, string | null> = {};
  for (const n of topology.nodes) {
    const raw = arrival.get(n.id) ?? 0;
    const s = raw * scale;
    // Defense-in-depth: an unreachable node has arrival=Infinity (→ Infinity, or
    // NaN when scale=0); either would poison the GPU flash buffers downstream.
    // Unreachable is impossible on today's connected graph — guard at this source.
    const arrivalS = Number.isFinite(s) ? s : 0;
    colonyArrivalS[n.id] = arrivalS;
    colonyPredecessor[n.id] = predecessor.get(n.id) ?? null;
    if (n.kind === 'measured') { arrivals[n.id] = arrivalS; senders[n.id] = predecessor.get(n.id) ?? null; }
  }

  const rawLocal = colonyArrivalS[topology.localId] ?? 0;
  const localReceiveDelayS = clampHeroDelayS(rawLocal);

  return { entryId: originId, localReceiveDelayS, arrivals, senders, colonyArrivalS, colonyPredecessor };
}
