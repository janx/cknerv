import { describe, it, expect } from 'vitest';
import { emptyChainEntityCache } from '../src/entityStream';
import { applyEntityDelta, fromEntitiesSnapshot } from '../src/entityStream';
import type { Peer, RevisionedMutation } from '@cknerv/types';

const peerA: Peer = {
  node_id: 'QmA', addr: '1.2.3.4:8115', direction: 'outbound',
  version: '0.116.1', latency_ms: 20, best_known: 50, connected_ms: 1000,
};

describe('entity stream peer handling', () => {
  it('updates hosted names across snapshots without replacing node identity or telemetry', () => {
    let cache = fromEntitiesSnapshot(7, {
      chain: { ...emptyChainEntityCache().chain, tip: 99 },
      chain_nodes: [{
        id: 'ckb:local', label: 'ckb-local', is_miner: false,
        version: '0.116.1', connections: 24, p2p_node_id: 'QmObserver',
      }],
      peers: [peerA],
    });
    for (const label of ['Little Otter', '小水獭 CKB', 'ckb-local']) {
      cache = fromEntitiesSnapshot(cache.revision, {
        chain: cache.chain, chain_nodes: cache.chainNodes, peers: cache.peers,
      });
      cache = applyEntityDelta(cache, [{
        revision: cache.revision + 1,
        mutation: { type: 'chain_node_registered', id: 'ckb:local', label, is_miner: false, at: 1000 },
      }]);
      expect(cache.chainNodes).toEqual([{
        id: 'ckb:local', label, is_miner: false, version: '0.116.1',
        connections: 24, p2p_node_id: 'QmObserver',
      }]);
      expect(cache.chain.tip).toBe(99);
      expect(cache.peers).toEqual([peerA]);
    }
  });

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
        mutation: {
          type: 'chain_node_info_updated',
          id: 'ckb:local',
          version: '0.116.1',
          connections: 24,
          p2p_node_id: 'QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd',
        },
      },
    ]);
    expect(cache.chainNodes[0].version).toBe('0.116.1');
    expect(cache.chainNodes[0].connections).toBe(24);
    // cknerv's key for the endpoint is untouched; the name the network knows
    // it by arrives beside it.
    expect(cache.chainNodes[0].id).toBe('ckb:local');
    expect(cache.chainNodes[0].p2p_node_id).toBe(
      'QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd',
    );

    // A re-registration (the adapter re-registers whenever the label or
    // miner flag moves) must not forget the identity only the info poll can
    // learn.
    cache = applyEntityDelta(cache, [
      {
        revision: 3,
        mutation: {
          type: 'chain_node_registered',
          id: 'ckb:local',
          label: 'ckb-local-renamed',
          is_miner: false,
          at: 3,
        },
      },
    ]);
    expect(cache.chainNodes[0].label).toBe('ckb-local-renamed');
    expect(cache.chainNodes[0].p2p_node_id).toBe(
      'QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd',
    );
  });

  it('a server that carries no network identity leaves the node unnamed', () => {
    let cache = fromEntitiesSnapshot(1, {
      chain: emptyChainEntityCache().chain,
      chain_nodes: [
        { id: 'ckb:local', label: 'ckb-local', is_miner: false, version: '', connections: 0 },
      ],
      peers: [],
    });
    // The pre-field wire shape: no `p2p_node_id` key at all. Reading it as
    // absent is what keeps the node card's dossier honest on an old server.
    cache = applyEntityDelta(cache, [
      {
        revision: 2,
        mutation: {
          type: 'chain_node_info_updated',
          id: 'ckb:local',
          version: '0.116.1',
          connections: 24,
        },
      },
    ]);
    expect(cache.chainNodes[0].version).toBe('0.116.1');
    expect(cache.chainNodes[0].p2p_node_id).toBeUndefined();
  });

  it('preserves chainNodes/peers references when a batch touches neither', () => {
    const cache = fromEntitiesSnapshot(1, {
      chain: emptyChainEntityCache().chain,
      chain_nodes: [
        { id: 'ckb:local', label: 'ckb-local', is_miner: false, version: '', connections: 0 },
      ],
      peers: [peerA],
    });
    // A chain-only delta must not churn the node/peer slice identities —
    // React selectors reading those slices should not re-render.
    const next = applyEntityDelta(cache, [
      { revision: 2, mutation: { type: 'chain_sync_updated', ibd: false, best_known_block: 5 } },
    ]);
    expect(next.chainNodes).toBe(cache.chainNodes);
    expect(next.peers).toBe(cache.peers);
    expect(next.chain.best_known_block).toBe(5); // chain slice did update
    expect(next.revision).toBe(2);
  });
});
