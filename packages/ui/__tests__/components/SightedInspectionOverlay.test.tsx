import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterNode } from '@cknerv/types';
import SightedInspectionOverlay, {
  createSightedInspectionHandles,
} from '../../src/components/SightedInspectionOverlay';
import { SIGHTED_NODE_ACCENT } from '../../src/components/hud/SightedNodeCard';
import { PEER_NETWORK_HEX } from '../../src/visualPalette';

function rosterNode(overrides: Partial<RosterNode> = {}): RosterNode {
  return {
    node_id: 'QmSightedAlpha0123456789',
    addr: '/ip4/203.0.113.44/tcp/8115',
    version: '0.116.1',
    country: 'Germany',
    asn: 'AS24940',
    reachable: true,
    last_seen_ms: 1_700_000_000_000,
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

function mount(props: Partial<Parameters<typeof SightedInspectionOverlay>[0]> = {}) {
  const handles = props.handles ?? createSightedInspectionHandles();
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <SightedInspectionOverlay
      handles={handles}
      node={props.node ?? rosterNode()}
      sighting={props.sighting}
      onClose={onClose}
    />,
  );
  return { handles, onClose, view };
}

describe('sighted inspection handles', () => {
  it('places by the shortest card box under the sighted dialect vocabulary', () => {
    const handles = createSightedInspectionHandles();
    expect(handles.defaultSize).toEqual({ width: 340, height: 380 });
    expect(handles.measured).toEqual({ width: 340, height: 380 });
    expect(handles.placementDataKey).toBe('sightedProbePlacement');
    expect(handles.connectorDataKey).toBe('sightedProbeConnectorDirection');
  });
});

describe('SightedInspectionOverlay', () => {
  it('registers the card and connector into the anchor channel', () => {
    const { handles, view } = mount();
    const card = view.container.querySelector('[data-sighted-probe-overlay]');
    expect(handles.card).toBe(card);
    expect(handles.leader).toBe(
      view.container.querySelector('[data-sighted-probe-leader]'),
    );
    expect(handles.leaderDot).toBe(
      view.container.querySelector('[data-sighted-probe-anchor]'),
    );
    // jsdom lays nothing out, so the zero box keeps the dialect default.
    expect(handles.measured).toEqual({ width: 340, height: 380 });
    expect(card?.getAttribute('role')).toBe('region');
    expect(card?.getAttribute('aria-label')).toContain('QmSightedAlpha0123456789');
  });

  it('releases the card on unmount so no frame can write into it', () => {
    const { handles, view } = mount();
    view.unmount();
    expect(handles.card).toBeNull();
    expect(handles.visible).toBe(false);
  });

  it('tethers in the tier cyan the sighted cloud itself is drawn with', () => {
    const { handles } = mount();
    expect(handles.accent).toBe(SIGHTED_NODE_ACCENT);
    expect(handles.accent).toBe(PEER_NETWORK_HEX.scaffold);
  });

  it('keeps pointer interaction inside the card and dismisses outside it', () => {
    const { onClose, view } = mount();
    const card = view.container.querySelector('[data-sighted-probe-overlay]');
    pointerClick(card as Element);
    expect(onClose).not.toHaveBeenCalled();
    pointerClick(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the card DOM outside the Canvas and off the scene pointer path', () => {
    const { view } = mount();
    const layer = view.container.querySelector<HTMLElement>('[data-sighted-probe-layer]');
    const card = view.container.querySelector<HTMLElement>('[data-sighted-probe-overlay]');
    expect(view.container.querySelector('canvas')).toBeNull();
    expect(layer?.style.pointerEvents).toBe('none');
    // No honest screen position until the anchor has projected the node once.
    expect(card?.style.opacity).toBe('0');
  });

  it('carries the roster row it was handed into the card', () => {
    const { view } = mount({ node: rosterNode({ rtt_ms: 41 }) });
    const text = view.container.textContent ?? '';
    expect(text).toContain('SIGHTED // QmSighte');
    expect(text).toContain('NOT LINKED');
    expect(text).toContain('NO LIVE LINK · POSITION IS SCENE PLACEMENT');
    expect(view.container.querySelector('[data-sighted-probe-value="dial"]')?.textContent)
      .toBe('41 MS');
  });
});

describe('SightedInspectionOverlay dossier', () => {
  it('hands the crawler dossier down in the crawler-only dialect', () => {
    const { view } = mount({
      sighting: { phase: 'unsighted', record: null, reason: 'never_sighted' },
    });
    expect(view.container.querySelector('[data-sighting-variant="sighted"]')).not.toBeNull();
    expect(view.container.textContent).toContain('NO CRAWLER SIGHTING');
  });

  it('draws no dossier when the source offered none', () => {
    const { view } = mount();
    expect(view.container.querySelector('[data-sighting-plate]')).toBeNull();
  });
});
