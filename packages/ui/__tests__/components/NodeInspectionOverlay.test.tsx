import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import NodeInspectionOverlay, {
  createNodeInspectionHandles,
} from '../../src/components/NodeInspectionOverlay';
import { NODE_SELF_ACCENT } from '../../src/components/hud/NodeSelfCard';
import { CHAIN_ANCHOR_HEX } from '../../src/visualPalette';

const LOCAL_VERSION = '0.201.0';
const TIP = 16_204_887;

const node: ChainNode = {
  id: 'ckb:local',
  label: 'CKB',
  is_miner: false,
  version: LOCAL_VERSION,
  connections: 3,
};

const chain = {
  tip: TIP,
  chain_name: 'ckb_dev',
  epoch: { number: 11042, index: 842, length: 1800 },
  best_known_block: TIP,
  ibd: false,
} as unknown as ChainEntry;

const peers: Peer[] = [
  {
    node_id: 'QmPeerAlpha0123456789',
    addr: '10.0.0.1:8115',
    direction: 'outbound',
    version: LOCAL_VERSION,
    latency_ms: 84,
    best_known: TIP,
    connected_ms: 3_725_000,
  },
];

/** Reduced motion freezes the probe walk, so the card mounts without timers. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function pointerDown(target: Element, button = 0): void {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  target.dispatchEvent(event);
}

function mount(props: Partial<Parameters<typeof NodeInspectionOverlay>[0]> = {}) {
  const handles = props.handles ?? createNodeInspectionHandles();
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <NodeInspectionOverlay
      handles={handles}
      node={props.node ?? node}
      chain={props.chain ?? chain}
      peers={props.peers ?? peers}
      sighting={props.sighting}
      onClose={onClose}
    />,
  );
  return { handles, onClose, view };
}

describe('node inspection handles', () => {
  it('places by the self-probe card box under the node dialect vocabulary', () => {
    const handles = createNodeInspectionHandles();
    expect(handles.defaultSize).toEqual({ width: 340, height: 420 });
    expect(handles.measured).toEqual({ width: 340, height: 420 });
    expect(handles.placementDataKey).toBe('nodeProbePlacement');
    expect(handles.connectorDataKey).toBe('nodeProbeConnectorDirection');
  });
});

describe('NodeInspectionOverlay', () => {
  it('registers the card and connector into the anchor channel', () => {
    const { handles, view } = mount();
    const card = view.container.querySelector('[data-node-probe-overlay]');
    expect(handles.card).toBe(card);
    expect(handles.leader).toBe(
      view.container.querySelector('[data-node-probe-leader]'),
    );
    expect(handles.leaderDot).toBe(
      view.container.querySelector('[data-node-probe-anchor]'),
    );
    // jsdom lays nothing out, so the zero box keeps the dialect default.
    expect(handles.measured).toEqual({ width: 340, height: 420 });
    expect(card?.getAttribute('role')).toBe('region');
    expect(card?.getAttribute('aria-label')).toContain('ckb:local');
  });

  it('releases the card on unmount so no frame can write into it', () => {
    const { handles, view } = mount();
    view.unmount();
    expect(handles.card).toBeNull();
    expect(handles.visible).toBe(false);
  });

  it('tethers in the chain anchor cyan the icosahedron itself is drawn with', () => {
    const { handles } = mount();
    expect(handles.accent).toBe(NODE_SELF_ACCENT);
    expect(handles.accent).toBe(CHAIN_ANCHOR_HEX.edge);
  });

  it('keeps pointer interaction inside the card and dismisses outside it', () => {
    const { onClose, view } = mount();
    const card = view.container.querySelector('[data-node-probe-overlay]');
    pointerDown(card as Element);
    expect(onClose).not.toHaveBeenCalled();
    pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the card DOM outside the Canvas and off the scene pointer path', () => {
    const { view } = mount();
    const layer = view.container.querySelector<HTMLElement>('[data-node-probe-layer]');
    const card = view.container.querySelector<HTMLElement>('[data-node-probe-overlay]');
    expect(view.container.querySelector('canvas')).toBeNull();
    expect(layer?.style.pointerEvents).toBe('none');
    // No honest screen position until the anchor has projected the node once.
    expect(card?.style.opacity).toBe('0');
  });

  it('carries the node vitals it was handed into the card', () => {
    const { view } = mount();
    const text = view.container.textContent ?? '';
    expect(text).toContain('NODE // CKB');
    expect(text).toContain('#16,204,887');
    expect(view.container.querySelector('[data-node-probe-value="peers"]')?.textContent)
      .toBe('1');
  });
});

describe('NodeInspectionOverlay dossier', () => {
  it('hands the crawler\'s account of us down to the self probe', () => {
    const { view } = mount({
      sighting: { phase: 'unsighted', record: null, reason: 'no_crawler' },
    });
    expect(view.container.querySelector('[data-sighting-variant="self"]')).not.toBeNull();
    expect(view.container.textContent).toContain('HOW THE NETWORK SEES YOU');
    expect(view.container.textContent).toContain('NO CRAWLER ON SOURCE');
  });

  it('draws no dossier when the source offered none', () => {
    const { view } = mount();
    expect(view.container.querySelector('[data-sighting-plate]')).toBeNull();
  });
});
