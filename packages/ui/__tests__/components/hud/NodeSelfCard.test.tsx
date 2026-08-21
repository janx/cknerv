import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import NodeSelfCard from '../../../src/components/hud/NodeSelfCard';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';
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

/** Reduced motion freezes the probe walk at CLASSIFIED, so every vital is
 *  revealed on the first frame — no timer choreography in the assertions. */
function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => stubReducedMotion(true));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  it('names the node and stamps it OBSERVER on the chain it follows', () => {
    const { container } = renderCard();
    const text = container.textContent ?? '';
    expect(text).toContain('NODE // CKB');
    expect(text).toContain('节点');
    expect(container.querySelector('[data-node-probe-role="observer"]')?.textContent)
      .toBe('OBSERVER');
    expect(container.querySelector('[data-node-probe-chain]')?.textContent)
      .toBe('CKB_DEV');
  });

  it('stamps a mining node MINER instead', () => {
    const { container } = renderCard({ node: { ...node, is_miner: true } });
    expect(container.querySelector('[data-node-probe-role="miner"]')?.textContent)
      .toBe('MINER');
    expect(container.querySelector('[data-node-probe-role="observer"]')).toBeNull();
  });

  it('wears the chain anchor\'s own cyan, the icosahedron included', () => {
    const { container } = renderCard();
    const title = container.querySelector('[data-node-probe-module="header"] span');
    expect((title as HTMLElement).style.color)
      .toBe(rgbOf(CHAIN_ANCHOR_HEX.edge));
  });
});

describe('NodeSelfCard vitals', () => {
  it('prints the live head, the epoch and its progress', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="tip"]')?.textContent)
      .toBe('#16,204,887');
    expect(container.querySelector('[data-node-probe-value="epoch"]')?.textContent)
      .toBe('#11,042');
    expect(container.textContent).toContain('BLOCK 842 / 1,800 OF THIS EPOCH');
    const fill = container
      .querySelector('[data-node-probe-epoch-bar]')
      ?.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe(`${(842 / 1800) * 100}%`);
  });

  it('follows the head as blocks land', () => {
    const { container, rerender } = renderCard();
    rerender(
      <NodeSelfCard
        node={node}
        chain={{ ...chain, tip: TIP + 1 }}
        peers={PEERS}
        layoutSide="left"
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('[data-node-probe-value="tip"]')?.textContent)
      .toBe('#16,204,888');
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
  it('counts the colony and splits it by who dialed whom', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="peers"]')?.textContent)
      .toBe('5');
    const split = container.querySelector('[data-node-probe-peer-split]')?.textContent;
    expect(split).toContain('OUT 2');
    expect(split).toContain('IN 3');
  });

  it('reads the consensus posture back from the same fleet derive', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-value="consensus"]')?.textContent)
      .toBe('2 / 5 AT TIP');
    const counts = container
      .querySelector('[data-node-probe-consensus-counts]')?.textContent;
    expect(counts).toContain('2 AT TIP');
    expect(counts).toContain('1 BEHIND');
    expect(counts).toContain('1 AHEAD');
  });

  it('raises the lag alert with the furthest peer, because AHEAD means we lag', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-node-probe-lag]')?.textContent)
      .toBe('WE LAG · 6 BLOCKS BEHIND THE FURTHEST PEER');
  });

  it('stays quiet when nothing in the colony is past our head', () => {
    const atTipOnly = PEERS.filter((p) => (p.best_known ?? 0) <= TIP);
    const { container } = renderCard({ peers: atTipOnly });
    expect(container.querySelector('[data-node-probe-lag]')).toBeNull();
    expect(container.querySelector('[data-node-probe-consensus-counts]')?.textContent)
      .toContain('0 AHEAD');
  });

  it('survives a node with no peers at all', () => {
    const { container } = renderCard({ peers: [] });
    expect(container.querySelector('[data-node-probe-value="peers"]')?.textContent)
      .toBe('0');
    expect(container.querySelector('[data-node-probe-value="consensus"]')?.textContent)
      .toBe('0 / 0 AT TIP');
    expect(container.querySelector('[data-node-probe-lag]')).toBeNull();
  });
});

describe('NodeSelfCard probe walk', () => {
  it('reveals the vitals in order and holds them once the walk lands', () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = renderCard();
    const row = (name: string) => container
      .querySelector(`[data-node-probe-fact="${name}"]`)
      ?.getAttribute('data-node-probe-fact-state');

    expect(container.querySelector('[data-node-probe-scan-state="scanning"]'))
      .not.toBeNull();
    expect(row('tip')).toBe('scanning');
    expect(row('consensus')).toBe('scanning');

    performanceNow.mockReturnValue(PROBE_STEP_S * 5 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(container.querySelector('[data-node-probe-scan-state="locked"]'))
      .not.toBeNull();
    expect(row('tip')).toBe('resolved');
    expect(row('consensus')).toBe('resolved');
    performanceNow.mockRestore();
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
