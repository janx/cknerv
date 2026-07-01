// Pure data shapers for the peer constellation + NETWORK HUD. No React,
// no three.js — unit-tested directly.

import type { ChainEntry, ChainNode, Peer, PeerDirection } from '@cknerv/types';
import type { Vec3 } from '../types';
import { CHAIN_Y, mulberry32 } from '../layout';
import { fnv1a } from '../geometry/edgeBezier';

/** Latency at/above this (ms) maps to the outer rim. */
export const PEER_LATENCY_CAP_MS = 400;
/** Annulus radius bounds (pre-ellipse), matching the chain-node scatter band. */
export const PEER_INNER_RADIUS = 34;
export const PEER_OUTER_RADIUS = 56;
/** Lag (blocks) at which a peer's sync proximity bottoms out. */
export const PEER_SYNC_LAG_FLOOR = 2000;
const PEER_ELLIPSE_X = 1.25;
const PEER_ELLIPSE_Z = 0.85;

/** Normalize latency to [0,1]. null/undefined → 0.5 (unknown = mid ring). */
export function latencyToRadius01(latencyMs: number | null | undefined): number {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return 0.5;
  const c = Math.min(Math.max(latencyMs, 0), PEER_LATENCY_CAP_MS);
  return c / PEER_LATENCY_CAP_MS;
}

/** Deterministic angle [0, 2π) from a node id — stable per peer. */
export function peerAngle(nodeId: string): number {
  let h = 0;
  for (let i = 0; i < nodeId.length; i += 1) h = (h * 31 + nodeId.charCodeAt(i)) >>> 0;
  return ((h % 100000) / 100000) * Math.PI * 2;
}

/** World position [x, y, z] of a peer on the chain plane (y = CHAIN_Y). */
export function peerWorldPosition(peer: Peer): [number, number, number] {
  const t = latencyToRadius01(peer.latency_ms);
  const r = PEER_INNER_RADIUS + t * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
  const a = peerAngle(peer.node_id);
  return [Math.cos(a) * r * PEER_ELLIPSE_X, CHAIN_Y, Math.sin(a) * r * PEER_ELLIPSE_Z];
}

/** Sync proximity [0,1]: 1 at/above tip, → 0 as the peer lags. Unknown → 0.5. */
export function syncProximity(bestKnown: number | null | undefined, tip: number): number {
  if (bestKnown == null || !Number.isFinite(bestKnown)) return 0.5;
  if (tip <= 0) return 1;
  const lag = Math.max(0, tip - bestKnown);
  return Math.max(0, 1 - lag / PEER_SYNC_LAG_FLOOR);
}

/** Crystal radius from sync proximity [0,1]: in-sync peers render larger.
 *  Range ≈ 0.55 (lagging) .. 1.65 (at tip) — well under the LOCAL node's 2.5. */
export function peerCrystalSize(sync: number): number {
  return 0.55 + sync * 1.1;
}

/** Pre-fade brightness multiplier from sync proximity [0,1]: in-sync peers
 *  glow brighter. Multiplied by the churn fade alpha at render time. */
export function peerCrystalBrightness(sync: number): number {
  return 0.45 + sync * 0.5;
}

// ─── New-block propagation: latency-based arrival (no hub) ───────────────
// A block is mined elsewhere and reaches each node at a time positioned across the
// rendered peer set by latency — inner/low-latency first, outer last — so the beam
// ignitions read as an outward sweep. A peer's position blends rank-even spacing
// (so clustered real latencies still separate, not all at once) with latency
// magnitude (so genuinely large gaps stretch), then jitter per block (seeded by
// fnv1a(node_id) ⊕ lastPulseAtMs) reshuffles the fine order every block.

/** Earliest peer's base delay after the pulse (s): even the nearest node takes a
 *  beat to hear the block. */
export const BLOCK_ARRIVAL_BASE_S = 0.12;
/** Total spread of arrival times across the rendered peer set (s): the farthest
 *  peer hears the block ~this long after the nearest. Kept well above the beam
 *  lifetime (~2.2s) so ignitions sweep outward instead of flashing together. */
export const BLOCK_ARRIVAL_SPREAD_S = 2.4;
/** Blend of rank-even spacing (→1) vs latency-magnitude spacing (→0) for a peer's
 *  position in the spread. Rank guarantees a readable gap even when latencies
 *  cluster; magnitude lets large latency gaps stretch the pause. */
export const BLOCK_ARRIVAL_RANK_MIX = 0.6;
/** Per-block jitter on the arrival ORDER, in latency-fraction (latency01) units, so
 *  near-equal-latency peers reshuffle which fires first each block (no identical
 *  sweep). Peers within ~2× this in latency01 can swap; beyond that order is stable. */
export const BLOCK_ARRIVAL_ORDER_JITTER = 0.1;
/** Per-block jitter amplitude (±, s) on each peer's arrival TIME so arrivals don't
 *  snap to exact rank positions. Small vs the spread so the latency sweep dominates. */
export const BLOCK_ARRIVAL_JITTER_S = 0.12;
/** Broadcast-courier flight time (s): a node's inbound courier flies from an
 *  earlier-received node ≈ this long before it. Long enough that several couriers
 *  overlap in flight (the broadcast) and each is slow enough to follow. */
export const BLOCK_BROADCAST_HOP_S = 1.0;
/** Entry-peer → local courier flight time (s); also the margin by which the local
 *  node trails the entry peer (so local is never first). Slow enough that the
 *  "we received it" cube is followable. */
export const BLOCK_RELAY_HOP_S = 0.7;

/** Cubic ease-out: fast launch, decelerate to rest. The "thrown" courier velocity —
 *  the block is flung off the sender and coasts to a stop at the receiver. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Accelerate-in lob easing: some launch velocity (0.15) plus acceleration, so the
 *  bolus is fastest AT the membrane (slams in), unlike easeOutCubic which decelerates.
 *  f(0)=0, f(1)=1; slope grows from 0.15 to 1.85 (accelerating). */
export function easeInLob(t: number): number {
  return 0.15 * t + 0.85 * t * t;
}

export interface CourierFlight {
  from: Vec3;
  to: Vec3;
  /** Age (s since pulse) at which the courier departs. */
  startAge: number;
  /** Flight duration (s). */
  dur: number;
}

export interface CourierSchedule {
  entryId: string | null;
  senders: Record<string, string | null>;
  arrivals: Record<string, number>;
}

/** Resolve one peer's courier flight for the current block. The entry peer relays
 *  inward to the hub over BLOCK_RELAY_HOP_S; every other peer receives a broadcast
 *  hop from its sender, departing ≈ BLOCK_BROADCAST_HOP_S before its arrival.
 *  Returns null when the peer has no arrival or a referenced position is missing. */
export function courierFlight(
  id: string,
  schedule: CourierSchedule,
  posById: Map<string, Vec3>,
  hubPos: Vec3,
): CourierFlight | null {
  const { entryId, senders, arrivals } = schedule;
  const arr = arrivals[id];
  if (arr === undefined) return null;
  const self = posById.get(id);
  if (!self) return null;
  if (id === entryId) {
    return { from: self, to: hubPos, startAge: arr, dur: BLOCK_RELAY_HOP_S };
  }
  const senderId = senders[id];
  if (!senderId) return null;
  const from = posById.get(senderId);
  if (!from) return null;
  const startAge = Math.max(0, arr - BLOCK_BROADCAST_HOP_S);
  const dur = arr - startAge;
  if (dur <= 0) return null;
  return { from, to: self, startAge, dur };
}

/** Deterministic generator for one peer × one block: fold the node-id hash with
 *  the per-block nonce so the same (node, block) always yields the same stream,
 *  and a new block reshuffles. Floors the (ms-timestamp) nonce to a uint first. */
function peerBlockRng(nodeId: string, nonce: number): () => number {
  return mulberry32((fnv1a(nodeId) ^ (Math.floor(nonce) >>> 0)) >>> 0);
}

/** Max peers rendered; the rest are summarized in the NETWORK HUD. */
export const PEER_RENDER_CAP = 80;

/** Order peers deterministically (outbound first, then lowest latency) and cap
 *  the count so a high-degree node stays legible. Shared by PeerConstellation
 *  (what it renders) and App (what the schedule is computed over) so both agree. */
export function rankPeers(peers: Peer[]): Peer[] {
  return [...peers]
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'outbound' ? -1 : 1;
      return (a.latency_ms ?? 1e9) - (b.latency_ms ?? 1e9);
    })
    .slice(0, PEER_RENDER_CAP);
}

export interface BlockArrivalSchedule {
  /** node_id of the earliest-arriving peer this block (the one we hear it from);
   *  null when there are no peers. */
  entryId: string | null;
  /** Age (s since pulse) at which the LOCAL node applies the block = entry peer's
   *  arrival + BLOCK_RELAY_HOP_S. 0 when there are no peers (hero fires at t=0). */
  localReceiveDelayS: number;
  /** Per-peer arrival age (s since pulse), keyed by node_id — when each peer's
   *  tributary beam fires. Computed set-relative so clustered latencies still sweep. */
  arrivals: Record<string, number>;
  /** Broadcast cascade: for each peer, the node_id its courier flies FROM (an
   *  earlier-received node ≈ one hop before it). The entry/source peer → null (it
   *  relays to local instead). Drives the node→node broadcast couriers. */
  senders: Record<string, string | null>;
}

/** Per-block schedule over the ranked + capped peer set (so entryId is always
 *  on-screen). Each peer is positioned across [BASE, BASE+SPREAD] by a blend of its
 *  latency RANK (even spacing — a readable sweep even when latencies cluster) and
 *  latency MAGNITUDE (large gaps stretch), then jittered per block. entryId = argmin
 *  arrival; the local node applies one relay-hop later (never first). */
export function blockArrivalSchedule(peers: Peer[], nonce: number): BlockArrivalSchedule {
  const arrivals: Record<string, number> = {};
  if (peers.length === 0) return { entryId: null, localReceiveDelayS: 0, arrivals, senders: {} };

  // One jitter draw per peer (draw #1 of its stream) perturbs BOTH the arrival order
  // and the time, so near-equal-latency peers reshuffle every block (no identical
  // sweep).
  const items = peers.map((p) => ({
    p,
    l01: latencyToRadius01(p.latency_ms),
    j: (peerBlockRng(p.node_id, nonce)() - 0.5) * 2, // [-1, 1]
  }));
  let l01min = Infinity;
  let l01max = -Infinity;
  for (const it of items) {
    if (it.l01 < l01min) l01min = it.l01;
    if (it.l01 > l01max) l01max = it.l01;
  }
  const span01 = l01max - l01min;

  // Inner / low-latency first, with per-block order jitter so near-equal peers swap;
  // stable node_id tiebreak keeps it deterministic.
  items.sort((a, b) => {
    const ka = a.l01 + BLOCK_ARRIVAL_ORDER_JITTER * a.j;
    const kb = b.l01 + BLOCK_ARRIVAL_ORDER_JITTER * b.j;
    return ka !== kb ? ka - kb : a.p.node_id < b.p.node_id ? -1 : 1;
  });

  const n = items.length;
  let entryId: string | null = null;
  let bestAge = Infinity;
  for (let i = 0; i < n; i += 1) {
    const { p, l01, j } = items[i];
    const rankFrac = n === 1 ? 0 : i / (n - 1);
    const magFrac = span01 > 1e-6 ? (l01 - l01min) / span01 : rankFrac;
    const pos = BLOCK_ARRIVAL_RANK_MIX * rankFrac + (1 - BLOCK_ARRIVAL_RANK_MIX) * magFrac;
    const age = Math.max(
      0,
      BLOCK_ARRIVAL_BASE_S + BLOCK_ARRIVAL_SPREAD_S * pos + BLOCK_ARRIVAL_JITTER_S * j,
    );
    arrivals[p.node_id] = age;
    if (age < bestAge) {
      bestAge = age;
      entryId = p.node_id;
    }
  }

  // Broadcast cascade: order by actual arrival; each node after the source receives
  // its courier from the earlier node whose arrival is closest to one hop before it,
  // so couriers flow node→node (generally inner→outer) in arrival order.
  const byArrival = [...items].sort(
    (a, b) => arrivals[a.p.node_id] - arrivals[b.p.node_id],
  );
  const senders: Record<string, string | null> = {};
  for (let j = 0; j < n; j += 1) {
    const id = byArrival[j].p.node_id;
    if (j === 0) {
      senders[id] = null; // the source — no inbound courier; it relays to local
      continue;
    }
    const target = arrivals[id] - BLOCK_BROADCAST_HOP_S;
    let bestId = byArrival[0].p.node_id;
    let bestD = Infinity;
    for (let i = 0; i < j; i += 1) {
      const d = Math.abs(arrivals[byArrival[i].p.node_id] - target);
      if (d < bestD) {
        bestD = d;
        bestId = byArrival[i].p.node_id;
      }
    }
    senders[id] = bestId;
  }

  return { entryId, localReceiveDelayS: bestAge + BLOCK_RELAY_HOP_S, arrivals, senders };
}

export interface CourierLeg {
  visible: boolean;
  /** Fraction along the flight: 0 at the start node, 1 arrived at the destination. */
  t: number;
}

/** One courier leg's per-frame state: visible only while `ageSec` is within
 *  [startAge, startAge + durS), with `t` ramping 0→1 across it. Used for both the
 *  node→node broadcast couriers and the entry-peer → local relay. */
export function courierLeg(startAge: number, durS: number, ageSec: number): CourierLeg {
  if (durS <= 1e-9) return { visible: false, t: 0 };
  const t = (ageSec - startAge) / durS;
  if (t < 0 || t >= 1) return { visible: false, t: 0 };
  return { visible: true, t };
}

export interface Delivery {
  /** Stable per-node key for the pooled bolus child. */
  key: string;
  from: Vec3;
  to: Vec3;
  /** Age (s since pulse) at which this node starts its delivery. */
  startAge: number;
  hero: boolean;
}

/** Build one delivery per delivering node: the local/hero node(s) (offered from
 *  `localOrigins` at `localStartAge`) plus every rendered peer that has an
 *  arrival. Each rises straight up from its node to `cellsY`. Pure. */
export function planDeliveries(
  localOrigins: Vec3[],
  localStartAge: number,
  posById: Map<string, Vec3>,
  arrivals: Record<string, number>,
  cellsY: number,
): Delivery[] {
  const out: Delivery[] = [];
  localOrigins.forEach((from, i) => {
    out.push({
      key: `local:${i}`,
      from,
      to: [from[0], cellsY, from[2]],
      startAge: localStartAge,
      hero: true,
    });
  });
  for (const [id, from] of posById) {
    const a = arrivals[id];
    if (a === undefined) continue;
    out.push({
      key: `peer:${id}`,
      from,
      to: [from[0], cellsY, from[2]],
      startAge: a,
      hero: false,
    });
  }
  return out;
}

export interface DeliveryPhaseConfig {
  /** Pre-roll "gather" before the lob (rides the old beam charge window). */
  chargeDur: number;
  /** Lob (node → membrane) duration. Set to BEAM_GROW_DUR_S to land at the old strike. */
  lobDur: number;
  /** Soft membrane ingest duration. */
  ingestDur: number;
}
export type DeliveryPhaseName = 'idle' | 'gather' | 'lob' | 'ingest' | 'done';
export interface DeliveryPhaseState {
  phase: DeliveryPhaseName;
  /** 0→1 within gather / lob / ingest; 0 for idle; 1 for done. */
  t: number;
}

/** Pure per-node delivery phase from `localAge` (= ageSincePulse − startAge):
 *  gather over [−chargeDur, 0), lob over [0, lobDur), ingest over
 *  [lobDur, lobDur+ingestDur), done after. `idle` before the gather window
 *  keeps a far-future delivery hidden. */
export function deliveryPhase(localAge: number, cfg: DeliveryPhaseConfig): DeliveryPhaseState {
  const { chargeDur, lobDur, ingestDur } = cfg;
  if (localAge < -chargeDur) return { phase: 'idle', t: 0 };
  if (localAge < 0) {
    return { phase: 'gather', t: chargeDur > 1e-9 ? (localAge + chargeDur) / chargeDur : 1 };
  }
  if (localAge < lobDur) {
    return { phase: 'lob', t: lobDur > 1e-9 ? localAge / lobDur : 1 };
  }
  if (localAge < lobDur + ingestDur) {
    return { phase: 'ingest', t: ingestDur > 1e-9 ? (localAge - lobDur) / ingestDur : 1 };
  }
  return { phase: 'done', t: 1 };
}

export interface BolusIngest {
  /** Body + bloom scale multiplier: 1 at impact → 0 as the bolus dissolves. */
  bodyScale: number;
  /** Body + bloom opacity: 1 at impact → 0. */
  bodyOpacity: number;
  /** Draw toward the galaxy core, 0→1 (accelerating — the queen pulls it in). */
  pull: number;
  /** Membrane flash opacity: bright at the strike, gentle amber tail, 0 at t=1. */
  flashOpacity: number;
  /** White-hot → amber colour lerp param, 0→1. */
  colorT: number;
}

/** Per-frame "absorb" envelope for a bolus during the ingest phase (t∈[0,1]).
 *  Replaces the old hard cube-hide + ~2-frame white pop that read as the block
 *  *vanishing*: the body now dissolves (shrink + fade, reaching exactly 0 at
 *  t=1 so the phase→done hide is imperceptible) while being drawn toward the
 *  core, and the flash lingers into her amber instead of blinking out. Pure. */
export function bolusIngest(t: number): BolusIngest {
  const k = 1 - t; // 1 → 0 collapse factor
  return {
    bodyScale: k * k, // fast initial dissolve, exactly 0 at t=1
    bodyOpacity: k, // linear fade, exactly 0 at t=1
    pull: t * t, // accelerating inward draw (sucked into the canopy)
    flashOpacity: Math.exp(-3.0 * t) * k, // bright strike → amber tail; ×k pins a clean 0 at t=1
    colorT: easeOutCubic(t), // white-hot impact → her cortex amber
  };
}

/** The `k` cell ids nearest (in the xz plane) to a world-space `landing`,
 *  nearest first. Cells live in the galaxy group's rotating LOCAL frame
 *  (`pos_seed`), so the world landing is projected back through the group's
 *  `rotationY` before comparing. Used to ignite the cells a bolus lands on so
 *  the galaxy visibly RECEIVES each delivery (sparse-rim-safe: "nearest k"
 *  always finds cells, unlike a fixed radius). Pure. O(n) — called per block,
 *  not per frame. */
export function nearestCellIds(
  landing: [number, number],
  rotationY: number,
  cells: Iterable<{ id: number; pos_seed: [number, number, number] }>,
  k: number,
): number[] {
  if (k <= 0) return [];
  // Inverse-rotate the world landing into the cells' local frame.
  const c = Math.cos(-rotationY);
  const s = Math.sin(-rotationY);
  const lx = landing[0] * c - landing[1] * s;
  const lz = landing[0] * s + landing[1] * c;
  const scored: { id: number; d2: number }[] = [];
  for (const cell of cells) {
    const dx = cell.pos_seed[0] - lx;
    const dz = cell.pos_seed[2] - lz;
    scored.push({ id: cell.id, d2: dx * dx + dz * dz });
  }
  scored.sort((a, b) => a.d2 - b.d2);
  return scored.slice(0, k).map((e) => e.id);
}

export type PeerColorKind = PeerDirection | 'version';

/** Color class: version-mismatch wins, else direction. */
export function peerColorKind(peer: Peer, localVersion: string): PeerColorKind {
  if (localVersion && peer.version && peer.version !== localVersion) return 'version';
  return peer.direction;
}

/** RGB triples (0..1) for each color class. */
export const PEER_COLORS: Record<PeerColorKind, [number, number, number]> = {
  outbound: [0.49, 0.976, 1.0], // #7df9ff
  inbound: [0.373, 0.745, 0.796], // #5fbecb
  version: [0.941, 0.671, 0.988], // #f0abfc
};

export interface PeerChurn {
  joined: Peer[];
  dropped: Peer[];
  stable: Peer[];
}

/** Diff two peer lists keyed by node_id. */
export function peerChurnDiff(prev: Peer[], next: Peer[]): PeerChurn {
  const prevIds = new Set(prev.map((p) => p.node_id));
  const nextIds = new Set(next.map((p) => p.node_id));
  return {
    joined: next.filter((p) => !prevIds.has(p.node_id)),
    dropped: prev.filter((p) => !nextIds.has(p.node_id)),
    stable: next.filter((p) => prevIds.has(p.node_id)),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface NetworkSummary {
  peerCount: number;
  outbound: number;
  inbound: number;
  version: string;
  connections: number;
  medianPingMs: number | null;
  syncLabel: string;
  bestKnown: number;
}

/** Summarize the network for the NETWORK HUD. */
export function summarizeNetwork(
  peers: Peer[],
  chain: ChainEntry,
  local: ChainNode | undefined,
): NetworkSummary {
  const outbound = peers.filter((p) => p.direction === 'outbound').length;
  const pings = peers
    .map((p) => p.latency_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const best = chain.best_known_block;
  let syncLabel: string;
  if (chain.ibd) syncLabel = 'IBD';
  else if (best > chain.tip) syncLabel = `SYNCING ${best - chain.tip} behind`;
  else syncLabel = 'AT TIP';
  return {
    peerCount: peers.length,
    outbound,
    inbound: peers.length - outbound,
    version: local?.version ?? '',
    connections: local?.connections ?? peers.length,
    medianPingMs: pings.length ? median(pings) : null,
    syncLabel,
    bestKnown: best,
  };
}
