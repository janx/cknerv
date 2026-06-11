import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import PeerConstellation from '../../src/components/PeerConstellation';
import { resetSimClock } from '../../src/tweaks/simClock';
import type { Peer } from '@cknerv/types';

function peer(p: Partial<Peer>): Peer {
  return {
    node_id: 'Qm',
    addr: '1.2.3.4:8115',
    direction: 'outbound',
    version: '0.116.1',
    connected_ms: 0,
    ...p,
  };
}

describe('PeerConstellation mount', () => {
  beforeEach(() => {
    resetSimClock();
  });

  it('mounts a handful of peers inside a Canvas without throwing', () => {
    const peers = [
      peer({ node_id: 'A', direction: 'outbound', latency_ms: 20, best_known: 100 }),
      peer({ node_id: 'B', direction: 'inbound', latency_ms: 120, best_known: 98 }),
      peer({ node_id: 'C', direction: 'outbound', version: '0.115.0', latency_ms: 200 }),
    ];
    expect(() =>
      render(
        <Canvas>
          <PeerConstellation
            peers={peers}
            tip={100}
            localVersion="0.116.1"
            selectedId="peer:A"
            onSelect={() => {}}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('mounts with a fired block pulse + entry peer (tributary beams + courier) without throwing', () => {
    const peers = [
      peer({ node_id: 'A', direction: 'outbound', latency_ms: 20, best_known: 100 }),
      peer({ node_id: 'B', direction: 'inbound', latency_ms: 120, best_known: 98 }),
    ];
    expect(() =>
      render(
        <Canvas>
          <PeerConstellation
            peers={peers}
            tip={100}
            localVersion="0.116.1"
            selectedId={null}
            onSelect={() => {}}
            blockPulseAtMs={1234}
            entryPeerId="A"
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('re-renders on a new block pulse with a different entry peer (reshuffle) without throwing', () => {
    const peers = [
      peer({ node_id: 'A', direction: 'outbound', latency_ms: 20, best_known: 100 }),
      peer({ node_id: 'B', direction: 'inbound', latency_ms: 120, best_known: 98 }),
    ];
    const { rerender } = render(
      <Canvas>
        <PeerConstellation
          peers={peers}
          tip={100}
          localVersion="0.116.1"
          selectedId={null}
          onSelect={() => {}}
          blockPulseAtMs={1234}
          entryPeerId="A"
        />
      </Canvas>,
    );
    expect(() =>
      rerender(
        <Canvas>
          <PeerConstellation
            peers={peers}
            tip={100}
            localVersion="0.116.1"
            selectedId={null}
            onSelect={() => {}}
            blockPulseAtMs={5678}
            entryPeerId="B"
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});
