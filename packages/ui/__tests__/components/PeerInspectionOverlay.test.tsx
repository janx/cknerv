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

/** Reduced motion keeps the connector's entry dot static — the overlay is
 *  the only thing on screen that consults it. */
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

function pointerEvent(
  type: string,
  target: Element,
  { button = 0, x = 0, y = 0 }: { button?: number; x?: number; y?: number } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  target.dispatchEvent(event);
}

/** A click: pressed and released on the same spot. */
function pointerClick(target: Element, button = 0): void {
  pointerEvent('pointerdown', target, { button });
  pointerEvent('pointerup', target, { button });
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
      sighting={props.sighting}
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

  it('forgets the sticky placement offset when the probed peer changes', () => {
    const { handles, view } = mount();
    // A frame has already locked where this card opened...
    handles.placementLock.family = 'beside';
    handles.placementLock.y = -150;

    view.rerender(
      <PeerInspectionOverlay
        handles={handles}
        peer={peer({ node_id: 'QmPeerBeta9876543210' })}
        tip={TIP}
        localVersion={LOCAL_VERSION}
        linkLost={false}
        onClose={vi.fn()}
      />,
    );

    // ...and probing a different peer clears it, so the next card centres
    // itself beside its own node instead of inheriting this one's offset.
    expect(handles.placementLock).toEqual({ family: null, y: null, x: null });
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
    pointerClick(card as Element);
    expect(onClose).not.toHaveBeenCalled();
    pointerClick(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('survives a camera drag started outside it', () => {
    const { onClose } = mount();

    // The PING STRIP fills over ~96s. A reader cannot watch it fill and
    // reframe the constellation around it if the first pixel of the drag
    // closes the card — and the close button promises a CLICK outside.
    pointerEvent('pointerdown', document.body);
    pointerEvent('pointermove', document.body, { x: 90, y: 30 });
    pointerEvent('pointerup', document.body, { x: 90, y: 30 });

    expect(onClose).not.toHaveBeenCalled();
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

describe('PeerInspectionOverlay dossier', () => {
  it('hands the crawler dossier down to the card it belongs on', () => {
    const { view } = mount({
      sighting: { phase: 'unsighted', record: null, reason: 'never_sighted' },
    });
    expect(view.container.querySelector('[data-sighting-plate]')).not.toBeNull();
    expect(view.container.textContent).toContain('NO CRAWLER SIGHTING');
  });

  it('draws no dossier when the source offered none', () => {
    const { view } = mount();
    expect(view.container.querySelector('[data-sighting-plate]')).toBeNull();
  });
});
