import type { Peer } from '@cknerv/types';

export interface FleetConsensus {
  atTip: number; behind: number; ahead: number; unknown: number;
  total: number; aheadRatio: number; maxAhead: number;
}

export function fleetConsensus(peers: Peer[], tip: number, tolerance = 1): FleetConsensus {
  let atTip = 0, behind = 0, ahead = 0, unknown = 0, maxAhead = 0;
  for (const p of peers) {
    const h = p.best_known;
    if (h == null || !Number.isFinite(h)) { unknown++; continue; }
    if (h > tip + tolerance) { ahead++; maxAhead = Math.max(maxAhead, h - tip); }
    else if (h < tip - tolerance) { behind++; }
    else { atTip++; }
  }
  const total = peers.length;
  return { atTip, behind, ahead, unknown, total, aheadRatio: total ? ahead / total : 0, maxAhead };
}

export interface PingStats { medianMs: number; minMs: number; maxMs: number; }

export function pingStats(peers: Peer[]): PingStats | null {
  const xs = peers
    .map((p) => p.latency_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { medianMs: Math.round(median), minMs: xs[0], maxMs: xs[xs.length - 1] };
}

export interface VersionSpread { majorityVersion: string; majorityCount: number; otherCount: number; total: number; }

export function versionSpread(peers: Peer[]): VersionSpread {
  const counts = new Map<string, number>();
  for (const p of peers) if (p.version) counts.set(p.version, (counts.get(p.version) ?? 0) + 1);
  let majorityVersion = '', majorityCount = 0;
  for (const [v, c] of counts) if (c > majorityCount) { majorityVersion = v; majorityCount = c; }
  const total = peers.length;
  return { majorityVersion, majorityCount, otherCount: total - majorityCount, total };
}
