// Pure data shapers for the peer colony + NETWORK HUD. No React,
// no three.js — unit-tested directly.

import type { ChainEntry, ChainNode, Peer, PeerDirection } from '@cknerv/types';
import type { Vec3 } from '../types';
import {
  PEER_NETWORK_PALETTE,
  type SceneColor,
} from '../visualPalette';

/** Latency at/above this (ms) maps to the outer rim. */
export const PEER_LATENCY_CAP_MS = 400;
/** Annulus radius bounds (pre-ellipse), matching the chain-node scatter band. */
export const PEER_INNER_RADIUS = 34;
export const PEER_OUTER_RADIUS = 56;
/** Lag (blocks) at which a peer's sync proximity bottoms out. */
export const PEER_SYNC_LAG_FLOOR = 2000;

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

/** Relay-hop margin (s): in the generic relay model, how long the local node
 *  trails the block's entry peer (so local is never first). Referenced by
 *  CellGalaxy's wave-timing comments. */
export const BLOCK_RELAY_HOP_S = 0.7;

/** Cubic ease-out: fast launch, decelerate to rest. The "thrown" courier velocity —
 *  the block is flung off the sender and coasts to a stop at the receiver. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Accelerate-in carrier easing: some launch velocity (0.15) plus acceleration,
 *  so the signal is fastest at the Cell-field boundary, unlike easeOutCubic.
 *  f(0)=0, f(1)=1; slope grows from 0.15 to 1.85 (accelerating). */
export function easeInLob(t: number): number {
  return 0.15 * t + 0.85 * t * t;
}

export interface Delivery {
  /** Stable per-node key for the pooled protocol-carrier child. */
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
  /** Pre-roll contributor gather before launch (rides the legacy beam window). */
  chargeDur: number;
  /** Carrier transit (node → Cell field) duration. */
  lobDur: number;
  /** Field-commit duration. */
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
  /** Legacy API name; describes the carrier's field-commit envelope. */
  /** Carrier glyph scale multiplier: 1 at impact → 0 at commit. */
  bodyScale: number;
  /** Body + bloom opacity: 1 at impact → 0. */
  bodyOpacity: number;
  /** Agreement flash opacity: bright at contact, resolved at t=1. */
  flashOpacity: number;
  /** Hash-stable carrier hue → pale agreement lerp param, 0→1. */
  colorT: number;
}

/** Per-frame field-commit envelope for the protocol carrier (t∈[0,1]).
 *  The compatibility export name remains `bolusIngest`, but the visual is a
 *  layered octagonal energy field: it contracts at field contact while the
 *  agreement flash resolves from the block's stable warm hue to pale consensus.
 *  Pure. */
export function bolusIngest(t: number): BolusIngest {
  const k = 1 - t; // 1 → 0 collapse factor
  return {
    bodyScale: k * k, // fast initial dissolve, exactly 0 at t=1
    bodyOpacity: k, // linear fade, exactly 0 at t=1
    flashOpacity: Math.exp(-3.0 * t) * k, // bright strike → pale agreement tail; ×k pins a clean 0 at t=1
    colorT: easeOutCubic(t), // moving carrier hue → pale committed information
  };
}

interface NearestCellCandidate {
  id: number;
  d2: number;
  order: number;
}

/** Max-heap ordering: farther candidates are worse; input order breaks exact
 * distance ties so the result preserves the stable ordering of the previous
 * full-sort implementation. */
function nearestCandidateWorse(
  left: NearestCellCandidate,
  right: NearestCellCandidate,
): boolean {
  return left.d2 > right.d2
    || (left.d2 === right.d2 && left.order > right.order);
}

function siftNearestCandidateDown(
  heap: NearestCellCandidate[],
  start: number,
): void {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    const right = left + 1;
    const worseChild = right < heap.length
      && nearestCandidateWorse(heap[right], heap[left])
      ? right
      : left;
    if (!nearestCandidateWorse(heap[worseChild], heap[index])) return;
    [heap[index], heap[worseChild]] = [heap[worseChild], heap[index]];
    index = worseChild;
  }
}

/** The `k` Cell ids nearest (in the xz plane) to a carrier `landing`,
 *  nearest first. Cells live in the galaxy group's rotating LOCAL frame
 *  (`pos_seed`), so the world landing is projected back through the group's
 *  `rotationY` before comparing. Used to illuminate the Cells a carrier reaches so
 *  the galaxy visibly RECEIVES each delivery (sparse-rim-safe: "nearest k"
 *  always finds cells, unlike a fixed radius). Pure. O(n log min(k,n)) time
 *  and O(min(k,n)) memory — called per block, not per frame. */
export function nearestCellIds(
  landing: [number, number],
  rotationY: number,
  cells: Iterable<{ id: number; pos_seed: [number, number, number] }>,
  k: number,
): number[] {
  const limit = Number.isFinite(k)
    ? Math.max(0, Math.floor(k))
    : k === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : 0;
  if (limit === 0) return [];
  // Inverse-rotate the world landing into the cells' local frame.
  const c = Math.cos(-rotationY);
  const s = Math.sin(-rotationY);
  const lx = landing[0] * c - landing[1] * s;
  const lz = landing[0] * s + landing[1] * c;
  const nearest: NearestCellCandidate[] = [];
  let order = 0;
  for (const cell of cells) {
    const dx = cell.pos_seed[0] - lx;
    const dz = cell.pos_seed[2] - lz;
    const d2 = dx * dx + dz * dz;
    if (nearest.length < limit) {
      nearest.push({ id: cell.id, d2, order });
      let index = nearest.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!nearestCandidateWorse(nearest[index], nearest[parent])) break;
        [nearest[index], nearest[parent]] = [nearest[parent], nearest[index]];
        index = parent;
      }
    } else {
      const worst = nearest[0];
      if (d2 < worst.d2 || (d2 === worst.d2 && order < worst.order)) {
        // Reuse the bounded heap slot instead of allocating once per Cell.
        worst.id = cell.id;
        worst.d2 = d2;
        worst.order = order;
        siftNearestCandidateDown(nearest, 0);
      }
    }
    order += 1;
  }
  nearest.sort((a, b) => a.d2 - b.d2 || a.order - b.order);
  return nearest.map((entry) => entry.id);
}

export type PeerColorKind = PeerDirection | 'version';

/** Color class: version-mismatch wins, else direction. */
export function peerColorKind(peer: Peer, localVersion: string): PeerColorKind {
  if (localVersion && peer.version && peer.version !== localVersion) return 'version';
  return peer.direction;
}

/** RGB triples (0..1) for each color class. */
export const PEER_COLORS: Readonly<Record<PeerColorKind, SceneColor>> = {
  outbound: PEER_NETWORK_PALETTE.outbound,
  inbound: PEER_NETWORK_PALETTE.inbound,
  version: PEER_NETWORK_PALETTE.version,
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
