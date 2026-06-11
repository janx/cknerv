// Pure data shapers for the peer constellation + NETWORK HUD. No React,
// no three.js — unit-tested directly.

import type { ChainEntry, ChainNode, Peer, PeerDirection } from '@cknerv/types';
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
// A block is mined elsewhere and reaches each node at a time derived from real
// network latency (latency-to-local, the only signal we have) plus per-block
// jitter, so the ordering reshuffles every block. Seeded by fnv1a(node_id) ⊕
// nonce (the block's lastPulseAtMs) — per-block-varying yet reproducible.

/** Total spread of block-arrival times across peers, seconds: the most
 *  network-distant peer hears a block ~this long after the nearest. */
export const BLOCK_ARRIVAL_SPREAD_S = 0.8;
/** Per-block jitter amplitude (±, seconds) layered on each peer's arrival so the
 *  order reshuffles block-to-block instead of being a rigid latency sort. */
export const BLOCK_ARRIVAL_JITTER_S = 0.15;
/** Visible courier flight time entry-peer → local; also the margin by which the
 *  local node trails the first peer to relay it the block (so local is never first). */
export const BLOCK_RELAY_HOP_S = 0.27;
/** Floor on a peer's latency fraction so even the lowest-latency peer has a small
 *  non-zero base delay (the block still had to reach our neighbourhood). */
const ARRIVAL_BASE_FRAC = 0.15;

/** Deterministic generator for one peer × one block: fold the node-id hash with
 *  the per-block nonce so the same (node, block) always yields the same stream,
 *  and a new block reshuffles. Floors the (ms-timestamp) nonce to a uint first. */
function peerBlockRng(nodeId: string, nonce: number): () => number {
  return mulberry32((fnv1a(nodeId) ^ (Math.floor(nonce) >>> 0)) >>> 0);
}

/** Age (seconds since the block pulse) at which `peer` hears the block: a
 *  latency-proportional base + per-block jitter. Lower latency → earlier on
 *  average; `nonce` reshuffles each block. Clamped ≥ 0. The jitter draw is the
 *  FIRST value of peerBlockRng so beamShapeJitter can take subsequent draws from
 *  the same (re-seeded) stream without colliding. */
export function peerArrivalAge(peer: Peer, nonce: number): number {
  const lat01 = latencyToRadius01(peer.latency_ms);
  const base =
    BLOCK_ARRIVAL_SPREAD_S * (ARRIVAL_BASE_FRAC + (1 - ARRIVAL_BASE_FRAC) * lat01);
  const jit = (peerBlockRng(peer.node_id, nonce)() - 0.5) * 2 * BLOCK_ARRIVAL_JITTER_S;
  return Math.max(0, base + jit);
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
   *  arrival + BLOCK_RELAY_HOP_S. 0 when there are no peers (degenerate: nothing to
   *  receive from → hero fires at t=0). */
  localReceiveDelayS: number;
}

/** Per-block schedule shared by both layers. `peers` is the ranked + capped set
 *  PeerConstellation actually renders (so entryId is always on-screen). entryId =
 *  argmin peerArrivalAge; ties broken by lexicographically-lowest node_id. */
export function blockArrivalSchedule(peers: Peer[], nonce: number): BlockArrivalSchedule {
  let entryId: string | null = null;
  let bestAge = Infinity;
  for (const p of peers) {
    const age = peerArrivalAge(p, nonce);
    if (age < bestAge || (age === bestAge && entryId !== null && p.node_id < entryId)) {
      bestAge = age;
      entryId = p.node_id;
    }
  }
  return {
    entryId,
    localReceiveDelayS: entryId === null ? 0 : bestAge + BLOCK_RELAY_HOP_S,
  };
}

export interface BeamShapeJitter {
  growMul: number;   // ×BEAM_GROW_DUR_S  (grow speed)
  tailMul: number;   // ×BEAM_HOLD_DUR_S AND ×BEAM_STRIKE_DUR_S together (tail tempo)
  flowMul: number;   // ×uFlowSpeed (core streaks)
  splashMul: number; // ×splashPeakSize
  coreMul: number;   // ×coreRadius
}

/** Deterministic per-(node, block) beam-shape multipliers so no two peer beams
 *  move in lockstep. Draws from the SAME re-seeded stream as peerArrivalAge,
 *  consuming the arrival draw first so the two stay mutually consistent. tailMul
 *  scales hold AND strike by one factor so the retract window (strike − hold)
 *  stays positive — independent jitter could invert it. */
export function beamShapeJitter(nodeId: string, nonce: number): BeamShapeJitter {
  const r = peerBlockRng(nodeId, nonce);
  r(); // consume the arrival-jitter draw (keeps this in step with peerArrivalAge)
  const j = (amp: number) => 1 + (r() - 0.5) * 2 * amp;
  return {
    growMul: j(0.2),
    tailMul: j(0.2),
    flowMul: j(0.25),
    splashMul: j(0.15),
    coreMul: j(0.15),
  };
}

/** Inbound "receive" leg duration (source peer → hub), seconds. */
export const BLOCK_RECEIVE_S = 0.3;
/** Each courier's outbound "relay" leg duration (hub → peer), seconds. */
export const BLOCK_RELAY_S = 0.6;

/** Max spread of relay-courier departures across peers, seconds (fan-out). */
export const BLOCK_STAGGER_S = 0.35;

export interface BlockCourier {
  /** 'receive' = source→hub leg; 'relay' = hub→peer leg; 'idle' = no courier. */
  phase: 'receive' | 'relay' | 'idle';
  /** Position along the path: 0 = hub, 1 = peer. */
  pos: number;
}

/** Courier state for one peer at `ageSec` since the block pulse, given the peer's
 *  relay-departure `stagger` (0..BLOCK_STAGGER_S) and whether it is the source:
 *  - source, age < BLOCK_RECEIVE_S → 'receive', pos 1→0 (peer→hub)
 *  - any peer, after BLOCK_RECEIVE_S + stagger → 'relay', pos 0→1 (hub→peer)
 *  - otherwise 'idle'. */
export function blockCourierState(
  ageSec: number,
  stagger: number,
  isSource: boolean,
): BlockCourier {
  if (ageSec < 0) return { phase: 'idle', pos: 0 };
  if (isSource && ageSec < BLOCK_RECEIVE_S) {
    return { phase: 'receive', pos: 1 - ageSec / BLOCK_RECEIVE_S };
  }
  const relayStart = BLOCK_RECEIVE_S + stagger;
  if (ageSec >= relayStart && ageSec < relayStart + BLOCK_RELAY_S) {
    return { phase: 'relay', pos: (ageSec - relayStart) / BLOCK_RELAY_S };
  }
  return { phase: 'idle', pos: 0 };
}

/** Age (since the block pulse) at which a peer with relay `stagger` receives the
 *  relayed block — i.e. its hub→peer courier lands and its tributary beam fires.
 *  Mirrors blockCourierState's relay-arrival edge: relayStart + BLOCK_RELAY_S
 *  where relayStart = BLOCK_RECEIVE_S + stagger. */
export function peerBeamFiredAge(stagger: number): number {
  return BLOCK_RECEIVE_S + stagger + BLOCK_RELAY_S;
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
