// Pure data shapers for the peer constellation + NETWORK HUD. No React,
// no three.js — unit-tested directly.

import type { ChainEntry, ChainNode, Peer, PeerDirection } from '@cknerv/types';
import { CHAIN_Y } from '../layout';

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

/** Seconds a block surge takes to decay back to ambient flow. */
export const PEER_FLOW_SURGE_S = 0.7;
/** Peak extra intensity multiplier at the instant a block arrives. */
export const PEER_FLOW_SURGE_PEAK = 2.0;

/** Block-arrival surge factor from the age (sec) of the last block pulse:
 *  PEAK at age 0, linearly → 0 at PEER_FLOW_SURGE_S, 0 outside the window.
 *  A peer belt's intensity is multiplied by (1 + peerFlowSurge(age)) so the
 *  whole belt briefly brightens when a block arrives, then settles. */
export function peerFlowSurge(ageSec: number): number {
  if (ageSec < 0 || ageSec > PEER_FLOW_SURGE_S) return 0;
  return PEER_FLOW_SURGE_PEAK * (1 - ageSec / PEER_FLOW_SURGE_S);
}

/** Duration (sec) of the inbound "receive" packet (source peer → hub). */
export const BLOCK_RECEIVE_S = 0.3;
/** Duration (sec) of the outbound "relay" broadcast (hub → every peer). */
export const BLOCK_RELAY_S = 0.6;

export interface BlockPropagationPhase {
  /** 'receive' = one packet rides source-peer→hub; 'relay' = packets ride
   *  hub→every peer; 'idle' = no packet in flight. */
  phase: 'receive' | 'relay' | 'idle';
  /** Progress [0,1] within the current phase (0 when idle). */
  t: number;
}

/** Two-phase block-propagation choreography from the age (sec) of the last
 *  block pulse: first a "receive" packet (the source peer relaying the block
 *  to us, peer→hub), then a "relay" broadcast (us forwarding it, hub→all
 *  peers). Idle before the pulse and after both phases complete. */
export function blockPropagationPhase(ageSec: number): BlockPropagationPhase {
  if (ageSec < 0) return { phase: 'idle', t: 0 };
  if (ageSec < BLOCK_RECEIVE_S) return { phase: 'receive', t: ageSec / BLOCK_RECEIVE_S };
  const relayAge = ageSec - BLOCK_RECEIVE_S;
  if (relayAge < BLOCK_RELAY_S) return { phase: 'relay', t: relayAge / BLOCK_RELAY_S };
  return { phase: 'idle', t: 0 };
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
