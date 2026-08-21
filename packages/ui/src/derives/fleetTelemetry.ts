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
