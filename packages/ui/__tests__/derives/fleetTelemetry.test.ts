import { describe, it, expect } from 'vitest';
import type { Peer } from '@cknerv/types';
import { fleetConsensus } from '../../src/derives/fleetTelemetry';

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
