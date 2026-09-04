import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainEntry, ChainNode, Peer, PeerSightingRecord } from '@cknerv/types';
import NodeSelfCard from '../../../src/components/hud/NodeSelfCard';
import type { PeerSightingState } from '../../../src/components/hud/PeerSightingPlate';
import { CHAIN_ANCHOR_HEX } from '../../../src/visualPalette';

const LOCAL_VERSION = '0.201.0';
const TIP = 16_204_887;

const node: ChainNode = {
  id: 'ckb:local',
  label: 'CKB',
  is_miner: false,
  version: LOCAL_VERSION,
  connections: 12,
};

const chain = {
  tip: TIP,
  chain_name: 'ckb_dev',
  epoch: { number: 11042, index: 842, length: 1800 },
  best_known_block: TIP,
  ibd: false,
} as unknown as ChainEntry;

function peer(overrides: Partial<Peer> = {}): Peer {
  return {
    node_id: 'QmPeerAlpha0123456789',
    addr: '10.0.0.1:8115',
    direction: 'outbound',
    version: LOCAL_VERSION,
    latency_ms: 84,
    best_known: TIP,
    connected_ms: 3_725_000,
    ...overrides,
  };
}

/** A colony with one peer past our head: the reading that says WE lag. */
const PEERS: Peer[] = [
  peer({ node_id: 'QmOutA', direction: 'outbound' }),
  peer({ node_id: 'QmOutB', direction: 'outbound', best_known: TIP - 9 }),
  peer({ node_id: 'QmInA', direction: 'inbound' }),
  peer({ node_id: 'QmInB', direction: 'inbound', best_known: TIP + 6 }),
  peer({ node_id: 'QmInC', direction: 'inbound', best_known: null }),
];

/** jsdom hands inline colours back in `rgb()` form, so read the constant the
 *  card and the icosahedron share through the same conversion. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCard(props: Partial<Parameters<typeof NodeSelfCard>[0]> = {}) {
  return render(
    <NodeSelfCard
      node={node}
      chain={chain}
      peers={PEERS}
      layoutSide="left"
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('NodeSelfCard header', () => {
  it('names the node, claims SELF, and puts the role beside the chain', () => {
    const { container } = renderCard();
    const text = container.textContent ?? '';
    expect(text).toContain('NODE // CKB');
    expect(text).toContain('节点');
    // The chip is the EVIDENCE CLASS on all four network dialects (C-5). The
    // role is still printed — one group right, beside the chain it watches.
    expect(container.querySelector('[data-node-probe-evidence="self"]')?.textContent)
      .toBe('SELF');
    expect(container.querySelector('[data-node-probe-role="observer"]')?.textContent)
      .toBe('· OBSERVER');
    expect(container.querySelector('[data-node-probe-chain]')?.textContent)
      .toBe('CKB_DEV');
  });

  it('stamps a mining node MINER instead', () => {
    const { container } = renderCard({ node: { ...node, is_miner: true } });
    expect(container.querySelector('[data-node-probe-role="miner"]')?.textContent)
      .toBe('· MINER');
    expect(container.querySelector('[data-node-probe-role="observer"]')).toBeNull();
    // …and the evidence class does not move with the role.
    expect(container.querySelector('[data-node-probe-evidence="self"]')?.textContent)
      .toBe('SELF');
  });

  it('wears the chain anchor\'s own cyan, the icosahedron included', () => {
    const { container } = renderCard();
    const title = container.querySelector('[data-node-probe-module="header"] span');
    expect((title as HTMLElement).style.color)
      .toBe(rgbOf(CHAIN_ANCHOR_HEX.edge));
  });
});

describe('NodeSelfCard vitals', () => {
  it('prints neither the tip nor the epoch — CKB·01 states both', () => {
    // C-6: the head and the epoch on this card were `chain.tip` and
    // `chain.epoch` off the same entry the chain panel draws them from, with
    // the epoch's progress bar duplicated under them. A dossier of the local
    // node owes a reader what only this node can say.
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="tip"]')).toBeNull();
    expect(container.querySelector('[data-node-probe-value="epoch"]')).toBeNull();
    expect(container.querySelector('[data-node-probe-epoch-bar]')).toBeNull();
    expect(container.textContent).not.toContain('OF THIS EPOCH');
    expect(container.textContent).not.toContain('#16,204,887');
  });

  it('brackets our own round trips across the peers we have timed', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="roundtrip"]')?.textContent)
      .toBe('84–84 MS');
    expect(container.textContent).toContain('BEST AND WORST OF 5 TIMED · 5 CONNECTED');
  });

  it('says so when no peer has been timed yet', () => {
    const untimed = PEERS.map((p) => ({ ...p, latency_ms: null }));
    const { container } = renderCard({ peers: untimed });
    expect(container.querySelector('[data-node-probe-value="roundtrip"]')?.textContent)
      .toBe('—');
    expect(container.textContent).toContain('NO PEER TIMED YET · 5 CONNECTED');
  });

  it('names the version as the reference every peer is judged against', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="version"]')?.textContent)
      .toBe(LOCAL_VERSION);
    expect(container.textContent)
      .toContain('THE REFERENCE — PEER MISMATCHES ARE JUDGED AGAINST IT');
  });
});

describe('NodeSelfCard stance', () => {
  it('states where WE stand instead of taking the colony\'s census', () => {
    // C-6: this plate used to be PEER·02 with a card's border around it — the
    // peer count with its OUT/IN split, the head-consensus bar and its three
    // tallies, all off the derives the rail reads. The subject is the local
    // node now: how many of them we are ahead of.
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="lead"]')?.textContent)
      .toBe('1 OF 5 PEERS');
    expect(container.querySelector('[data-node-probe-value="peers"]')).toBeNull();
    expect(container.querySelector('[data-node-probe-peer-split]')).toBeNull();
    expect(container.querySelector('[data-node-probe-consensus-bar]')).toBeNull();
    expect(container.querySelector('[data-node-probe-consensus-counts]')).toBeNull();
    expect(container.textContent).toContain('1 HAVE NOT SAID WHERE THEIR HEAD IS');
  });

  it('raises the lag alert with the furthest peer, because AHEAD means we lag', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-lag]')?.textContent)
      .toBe('1 AHEAD · WE LAG 6 BLOCKS');
  });

  it('stays quiet when nothing in the colony is past our head', () => {
    // …and says why a low count is low, so `0 OF n` never reads as trouble.
    const atTipOnly = PEERS.filter((p) => p.best_known != null && p.best_known <= TIP);
    const { container } = renderCard({ peers: atTipOnly });
    expect(container.querySelector('[data-node-probe-lag]')).toBeNull();
    expect(container.textContent).not.toContain('AHEAD');
    expect(container.textContent).toContain('NOBODY IS PAST OUR HEAD');
  });

  it('survives a node with no peers at all', () => {
    const { container } = renderCard({ peers: [] });
    expect(container.querySelector('[data-node-probe-value="lead"]')?.textContent)
      .toBe('0 OF 0 PEERS');
    expect(container.querySelector('[data-node-probe-value="roundtrip"]')?.textContent)
      .toBe('—');
    expect(container.querySelector('[data-node-probe-lag]')).toBeNull();
  });
});

describe('NodeSelfCard first frame', () => {
  it('prints every vital on the first frame, with no clock to wait on', () => {
    const { container } = renderCard();
    for (const row of ['version', 'roundtrip', 'lead']) {
      const value = container.querySelector(`[data-node-probe-value="${row}"]`);
      expect(value, row).not.toBeNull();
      expect(value?.textContent, row).not.toBe('');
    }
    // No reveal state to carry, so no reveal vocabulary in the DOM either.
    expect(container.querySelector('[data-node-probe-scan-state]')).toBeNull();
    expect(container.querySelector('[data-node-probe-scan-progress]')).toBeNull();
    expect(container.querySelector('[data-node-probe-fact-state]')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toContain('SCANNING');
    expect(text).toContain('SELF·02');
  });
});

describe('NodeSelfCard identity', () => {
  it('speaks the self dialect only — no Cell and no peer vocabulary', () => {
    const { container } = renderCard();
    expect(container.innerHTML).not.toContain('data-cell-');
    expect(container.innerHTML).not.toContain('data-peer-');
    expect(container.querySelector('[data-node-probe-card]')).not.toBeNull();
    for (const module of ['header', 'vitals', 'stance']) {
      expect(container.querySelector(`[data-node-probe-module="${module}"]`))
        .not.toBeNull();
    }
    // The self probe has nothing to select: every vital is a readout.
    expect(container.querySelector('[data-node-probe-fact] button')).toBeNull();
  });

  it('exposes the card as a labelled region and closes on demand', () => {
    const onClose = vi.fn();
    const { container, getByRole } = renderCard({ onClose });
    expect(getByRole('region', { name: 'Node CKB self probe' }))
      .toBe(container.querySelector('[data-node-probe-card]'));
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-node-probe-layout="left"]')).not.toBeNull();
  });

  it('folds the above/below placements into one vertical layout', () => {
    const { container } = renderCard({ layoutSide: 'below' });
    expect(container.querySelector('[data-node-probe-layout="vertical"]'))
      .not.toBeNull();
  });
});

/** How the outside world last saw this node, as the App hands it down. */
function sighting(overrides: Partial<PeerSightingRecord> = {}): PeerSightingState {
  return {
    phase: 'ready',
    record: {
      source: 'ckbadger',
      as_of: { block: TIP, hash: '0xanchor' },
      updated_at_ms: Date.now(),
      node_id: 'QmLocalNode0123456789',
      country: 'DE',
      asn: 'AS24940 Hetzner Online GmbH',
      client_version: LOCAL_VERSION,
      protocols: ['/ckb/syn'],
      first_seen_ms: Date.now() - 400 * 86_400_000,
      last_seen_ms: Date.now() - 60_000,
      reachable: false,
      advertiser_peer_count: 45,
      advertised_address_count: 5_727,
      ...overrides,
    },
  };
}

describe('NodeSelfCard dossier', () => {
  it('carries no dossier plate when the source cannot offer one', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-sighting-plate]')).toBeNull();
  });

  it('closes the card with the one account of itself it cannot write', () => {
    const { container } = renderCard({ sighting: sighting() });
    const modules = Array.from(container.querySelectorAll('[data-node-probe-module],[data-sighting-plate]'))
      .map((node) => node.getAttribute('data-node-probe-module') ?? 'dossier');
    expect(modules).toEqual(['header', 'vitals', 'stance', 'dossier']);
    expect(container.textContent).toContain('SELF·04');
    expect(container.querySelector('[data-sighting-caption]')?.textContent)
      .toBe('HOW THE NETWORK SEES YOU');
  });

  it('leads with reachability — the question local RPC cannot ask', () => {
    const { container } = renderCard({ sighting: sighting() });
    const first = container.querySelector('[data-sighting-row]');
    expect(first?.getAttribute('data-sighting-row')).toBe('exposure');
    expect(first?.textContent).toContain('UNREACHABLE FROM OUTSIDE');
  });

  it('ages the crawler stamp on a clock of its own', () => {
    vi.useFakeTimers();
    const { container } = renderCard({ sighting: sighting() });
    const stamp = () => container.querySelector('[data-sighting-stamp]')?.textContent;
    expect(stamp()).toBe('SIGHTED 1m 0s AGO');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(stamp()).toBe('SIGHTED 2m 0s AGO');
  });

  it('states the crawler\'s silence about us as an answer', () => {
    const { container } = renderCard({
      sighting: { phase: 'unsighted', record: null, reason: 'never_sighted' },
    });
    expect(container.textContent).toContain('NO CRAWLER SIGHTING');
    // Still no peer vocabulary: the plate speaks its own namespace.
    expect(container.innerHTML).not.toContain('data-peer-');
  });
});
