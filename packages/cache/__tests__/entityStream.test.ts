import { describe, it, expect } from 'vitest';
import { emptyChainEntityCache } from '../src/entityStream';
import { applyEntityDelta, fromEntitiesSnapshot } from '../src/entityStream';
import type { Peer, RevisionedMutation } from '@cknerv/types';

const peerA: Peer = {
  node_id: 'QmA', addr: '1.2.3.4:8115', direction: 'outbound',
  version: '0.116.1', latency_ms: 20, best_known: 50, connected_ms: 1000,
};

describe('entity stream peer handling', () => {
  it('snapshot seeds peers', () => {
    const cache = fromEntitiesSnapshot(3, {
      chain: emptyChainEntityCache().chain,
      chain_nodes: [],
      peers: [peerA],
    });
    expect(cache.peers).toHaveLength(1);
    expect(cache.peers[0].node_id).toBe('QmA');
  });

  it('peers_updated delta replaces peers', () => {
    let cache = fromEntitiesSnapshot(1, {
      chain: emptyChainEntityCache().chain,
      chain_nodes: [],
      peers: [peerA],
    });
    const rms: RevisionedMutation[] = [
      { revision: 2, mutation: { type: 'peers_updated', peers: [] } },
    ];
    cache = applyEntityDelta(cache, rms);
    expect(cache.peers).toHaveLength(0);
    expect(cache.revision).toBe(2);
  });

  it('chain_node_info_updated delta enriches the node', () => {
    let cache = fromEntitiesSnapshot(1, {
      chain: emptyChainEntityCache().chain,
      chain_nodes: [
        { id: 'ckb:local', label: 'ckb-local', is_miner: false, version: '', connections: 0 },
      ],
      peers: [],
    });
    cache = applyEntityDelta(cache, [
      {
        revision: 2,
        mutation: { type: 'chain_node_info_updated', id: 'ckb:local', version: '0.116.1', connections: 24 },
      },
    ]);
    expect(cache.chainNodes[0].version).toBe('0.116.1');
    expect(cache.chainNodes[0].connections).toBe(24);
  });
});
