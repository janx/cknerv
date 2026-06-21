import { describe, it, expect } from 'vitest';
import type { Peer } from '@cknerv/types';
import { fleetConsensus, pingStats, versionSpread } from '../../src/derives/fleetTelemetry';

function mkPeer(p: Partial<Peer>): Peer {
  return { node_id: 'n', addr: 'a', direction: 'outbound', version: '0.201.0', connected_ms: 1000, ...p };
}

describe('fleetConsensus', () => {
  it('buckets peers by best_known height vs tip', () => {
    const peers = [
      mkPeer({ best_known: 100 }), // at-tip
      mkPeer({ best_known: 101 }), // at-tip (within tolerance 1)
      mkPeer({ best_known: 90 }),  // behind
      mkPeer({ best_known: 105 }), // ahead
      mkPeer({ best_known: null }),// unknown
    ];
    const c = fleetConsensus(peers, 100);
    expect(c).toMatchObject({ atTip: 2, behind: 1, ahead: 1, unknown: 1, total: 5, maxAhead: 5 });
    expect(c.aheadRatio).toBeCloseTo(0.2);
  });
});

describe('pingStats', () => {
  it('returns median/min/max over finite latencies', () => {
    const peers = [mkPeer({ latency_ms: 10 }), mkPeer({ latency_ms: 30 }), mkPeer({ latency_ms: 20 }), mkPeer({ latency_ms: null })];
    expect(pingStats(peers)).toEqual({ medianMs: 20, minMs: 10, maxMs: 30 });
  });
  it('returns null when no latencies', () => {
    expect(pingStats([mkPeer({ latency_ms: null })])).toBeNull();
  });
});

describe('versionSpread', () => {
  it('reports majority version and the rest', () => {
    const peers = [mkPeer({ version: '0.201.0' }), mkPeer({ version: '0.201.0' }), mkPeer({ version: '0.200.0' })];
    expect(versionSpread(peers)).toEqual({ majorityVersion: '0.201.0', majorityCount: 2, otherCount: 1, total: 3 });
  });
});
