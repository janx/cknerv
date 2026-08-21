import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '@cknerv/types';
import PeerInspectionOverlay, {
  createPeerInspectionHandles,
} from '../../src/components/PeerInspectionOverlay';
import { HUD_COLORS } from '../../src/components/hud/hudTheme';
import { PEER_NETWORK_HEX } from '../../src/visualPalette';

const LOCAL_VERSION = '0.201.0';
const TIP = 16_204_887;

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

function mount(props: Partial<Parameters<typeof PeerInspectionOverlay>[0]> = {}) {
  const handles = props.handles ?? createPeerInspectionHandles();
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <PeerInspectionOverlay
      handles={handles}
      peer={props.peer ?? peer()}
      tip={props.tip ?? TIP}
      localVersion={props.localVersion ?? LOCAL_VERSION}
      linkLost={props.linkLost ?? false}
      onClose={onClose}
    />,
  );
  return { handles, onClose, view };
}

describe('peer inspection handles', () => {
  it('places by the probe card box under the peer dialect vocabulary', () => {
    const handles = createPeerInspectionHandles();
    expect(handles.defaultSize).toEqual({ width: 340, height: 460 });
    expect(handles.measured).toEqual({ width: 340, height: 460 });
    expect(handles.placementDataKey).toBe('peerProbePlacement');
    expect(handles.connectorDataKey).toBe('peerProbeConnectorDirection');
  });
});

describe('PeerInspectionOverlay', () => {
  it('registers the card and connector into the anchor channel', () => {
    const { handles, view } = mount();
    const card = view.container.querySelector('[data-peer-probe-overlay]');
    expect(handles.card).toBe(card);
    expect(handles.leader).toBe(
      view.container.querySelector('[data-peer-probe-leader]'),
    );
    expect(handles.leaderDot).toBe(
      view.container.querySelector('[data-peer-probe-anchor]'),
    );
    // jsdom lays nothing out, so the zero box keeps the dialect default.
    expect(handles.measured).toEqual({ width: 340, height: 460 });
    expect(card?.getAttribute('role')).toBe('region');
    expect(card?.getAttribute('aria-label')).toContain('QmPeerAlpha0123456789');
  });

  it('releases the card on unmount so no frame can write into it', () => {
    const { handles, view } = mount();
    view.unmount();
    expect(handles.card).toBeNull();
    expect(handles.visible).toBe(false);
  });

  it('tints the connector with the peer the card is reading', () => {
    const { handles } = mount();
    expect(handles.accent).toBe(PEER_NETWORK_HEX.outbound);
    cleanup();
    const mismatched = mount({ peer: peer({ version: '0.114.0' }) });
    expect(mismatched.handles.accent).toBe(PEER_NETWORK_HEX.version);
  });

  it('carries the retained snapshot into its lost state, tether included', () => {
    const { handles, view } = mount({ linkLost: true });
    const card = view.container.querySelector('[data-peer-probe-card]');
    expect(card?.getAttribute('data-peer-probe-link')).toBe('lost');
    expect(view.container.textContent).toContain('LINK LOST');
    expect(handles.accent).toBe(HUD_COLORS.caution);
  });

  it('keeps pointer interaction inside the card and dismisses outside it', () => {
    const { onClose, view } = mount();
    const card = view.container.querySelector('[data-peer-probe-overlay]');
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
    const layer = view.container.querySelector<HTMLElement>('[data-peer-probe-layer]');
    const card = view.container.querySelector<HTMLElement>('[data-peer-probe-overlay]');
    expect(view.container.querySelector('canvas')).toBeNull();
    expect(layer?.style.pointerEvents).toBe('none');
    // No honest screen position until the anchor has projected the node once.
    expect(card?.style.opacity).toBe('0');
  });
});
