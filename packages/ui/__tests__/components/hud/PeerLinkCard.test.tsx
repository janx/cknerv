import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '@cknerv/types';
import PeerLinkCard from '../../../src/components/hud/PeerLinkCard';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';
import { PEER_LATENCY_CAP_MS } from '../../../src/derives/peers.derive';
import { PEER_NETWORK_HEX } from '../../../src/visualPalette';

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

/** Reduced motion freezes the probe walk at CLASSIFIED, so the facts are
 *  interactive on the first frame — no timer choreography in the assertions. */
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

function renderCard(props: Partial<Parameters<typeof PeerLinkCard>[0]> = {}) {
  return render(
    <PeerLinkCard
      peer={peer()}
      tip={TIP}
      localVersion={LOCAL_VERSION}
      layoutSide="left"
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('PeerLinkCard header', () => {
  it('names the peer by its first eight id characters with a direction badge', () => {
    const { container } = renderCard();
    const text = container.textContent ?? '';
    expect(text).toContain('PEER // QmPeerAl');
    expect(text).toContain('对端');
    expect(container.querySelector('[data-peer-probe-direction="out"]')?.textContent)
      .toBe('OUT');
    expect(text).toContain('LINKED · 1h 2m');
  });

  it('flips the badge for a peer that dialed us', () => {
    const { container } = renderCard({ peer: peer({ direction: 'inbound' }) });
    expect(container.querySelector('[data-peer-probe-direction="in"]')?.textContent)
      .toBe('IN');
    expect(container.querySelector('[data-peer-probe-compass-arrow]')
      ?.getAttribute('data-peer-probe-compass-arrow')).toBe('inbound');
  });

  it('advances the linked age on its own 1 Hz tick', () => {
    vi.useFakeTimers();
    const { container } = renderCard();
    expect(container.querySelector('[data-peer-probe-uptime]')?.textContent)
      .toContain('1h 2m');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(container.querySelector('[data-peer-probe-uptime]')?.textContent)
      .toContain('1h 3m');
  });
});

describe('PeerLinkCard signal compass', () => {
  it('plots a blip on the peer ring and names the cap rim', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-peer-probe-compass-state="measured"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-peer-probe-blip]')).not.toBeNull();
    expect(container.textContent).toContain(`${PEER_LATENCY_CAP_MS}MS RIM`);
  });

  it('shows the dashed mid ring and UNMEASURED instead of a fabricated blip', () => {
    const { container } = renderCard({ peer: peer({ latency_ms: null }) });
    expect(container.querySelector('[data-peer-probe-compass-state="unmeasured"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-peer-probe-unmeasured-ring]')).not.toBeNull();
    expect(container.querySelector('[data-peer-probe-blip]')).toBeNull();
    expect(container.textContent).toContain('UNMEASURED');
  });

  it('accumulates one ping sample per observed latency change', () => {
    const { container, rerender } = renderCard();
    const strip = () => container.querySelector('[data-peer-probe-ping]');
    expect(strip()?.textContent).toContain('1/24');

    rerender(
      <PeerLinkCard
        peer={peer({ latency_ms: 120 })}
        tip={TIP}
        localVersion={LOCAL_VERSION}
        layoutSide="left"
        onClose={() => {}}
      />,
    );
    expect(strip()?.textContent).toContain('2/24');
    expect(strip()?.textContent).toContain('84–120 MS');
  });

  it('starts an empty strip for an unmeasured link', () => {
    const { container } = renderCard({ peer: peer({ latency_ms: null }) });
    expect(container.querySelector('[data-peer-probe-ping-state="empty"]')).not.toBeNull();
    expect(container.textContent).toContain('AWAITING SAMPLES');
  });
});

describe('PeerLinkCard sync ladder', () => {
  it('prints both heights grouped and locks at tip', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-peer-probe-sync-local]')?.textContent)
      .toBe('#16,204,887');
    expect(container.querySelector('[data-peer-probe-sync-peer]')?.textContent)
      .toBe('#16,204,887');
    expect(container.querySelector('[data-peer-probe-sync-state="at-tip"]')?.textContent)
      .toBe('AT TIP');
  });

  it('reports a lagging peer as BEHIND', () => {
    const { container } = renderCard({ peer: peer({ best_known: TIP - 7 }) });
    expect(container.querySelector('[data-peer-probe-sync-state="behind"]')?.textContent)
      .toBe('7 BEHIND');
  });

  it('reports a leading peer as AHEAD rather than at tip', () => {
    const { container } = renderCard({ peer: peer({ best_known: TIP + 4 }) });
    expect(container.querySelector('[data-peer-probe-sync-state="ahead"]')?.textContent)
      .toBe('4 AHEAD');
    expect(container.querySelector('[data-peer-probe-sync-state="at-tip"]')).toBeNull();
  });

  it('reports an unknown height as UNCHARTED', () => {
    const { container } = renderCard({ peer: peer({ best_known: null }) });
    expect(container.querySelector('[data-peer-probe-sync-state="unknown"]')?.textContent)
      .toBe('UNCHARTED');
    expect(container.querySelector('[data-peer-probe-sync-peer]')?.textContent).toBe('—');
  });
});

describe('PeerLinkCard line facts', () => {
  it('renders all six facts', () => {
    const { container } = renderCard();
    for (const facet of ['addr', 'direction', 'version', 'ping', 'sync', 'uptime']) {
      expect(container.querySelector(`[data-peer-probe-fact="${facet}"]`)).not.toBeNull();
    }
    const text = container.textContent ?? '';
    for (const label of ['ADDR', 'DIRECTION', 'VERSION', 'PING', 'SYNC', 'UPTIME']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('10.0.0.1:8115');
    expect(text).toContain('84 MS');
  });

  it('reports the selected facet and toggles it back off', () => {
    const onFacetChange = vi.fn();
    const { container } = renderCard({ onFacetChange });
    expect(onFacetChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(container.querySelector('[data-peer-probe-fact="sync"]')!);
    expect(onFacetChange).toHaveBeenLastCalledWith('sync');
    expect(container.querySelector('[data-peer-probe-fact="sync"]')
      ?.getAttribute('data-peer-probe-fact-state')).toBe('focused');

    fireEvent.click(container.querySelector('[data-peer-probe-fact="ping"]')!);
    expect(onFacetChange).toHaveBeenLastCalledWith('ping');

    fireEvent.click(container.querySelector('[data-peer-probe-fact="ping"]')!);
    expect(onFacetChange).toHaveBeenLastCalledWith(null);
  });

  it('holds the facts inert until the probe walk classifies the link', () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const onFacetChange = vi.fn();
    const { container } = renderCard({ onFacetChange });
    const fact = () => container.querySelector('[data-peer-probe-fact="addr"]')!;
    expect(container.querySelector('[data-peer-probe-scan-state="scanning"]')).not.toBeNull();
    expect(fact().hasAttribute('disabled')).toBe(true);
    fireEvent.click(fact());
    expect(onFacetChange).toHaveBeenLastCalledWith(null);

    performanceNow.mockReturnValue(PROBE_STEP_S * 6 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(container.querySelector('[data-peer-probe-scan-state="locked"]')).not.toBeNull();
    expect(fact().hasAttribute('disabled')).toBe(false);
    fireEvent.click(fact());
    expect(onFacetChange).toHaveBeenLastCalledWith('addr');
    performanceNow.mockRestore();
  });
});

describe('PeerLinkCard link loss', () => {
  it('banners the loss, flatlines the strip and keeps the facts readable', () => {
    const { container } = renderCard({ linkLost: true, peer: peer({ best_known: TIP - 2 }) });
    expect(container.querySelector('[data-peer-probe-card]')
      ?.getAttribute('data-peer-probe-link')).toBe('lost');
    expect(container.querySelector('[data-peer-probe-banner="link-lost"]')?.textContent)
      .toBe('LINK LOST');
    expect(container.querySelector('[data-peer-probe-ping-state="flatlined"]')).not.toBeNull();
    expect(container.querySelector('[data-peer-probe-ping-flatline]')).not.toBeNull();
    // The retained snapshot stays legible — only the tint says it is history.
    expect(container.textContent).toContain('10.0.0.1:8115');
    expect(container.querySelector('[data-peer-probe-sync-state="behind"]')?.textContent)
      .toBe('2 BEHIND');
  });

  it('carries no banner while the link is live', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-peer-probe-banner="link-lost"]')).toBeNull();
    expect(container.querySelector('[data-peer-probe-card]')
      ?.getAttribute('data-peer-probe-link')).toBe('live');
  });
});

describe('PeerLinkCard identity', () => {
  it('speaks the peer dialect only — never a Cell data attribute', () => {
    const { container } = renderCard({ linkLost: true });
    expect(container.innerHTML).not.toContain('data-cell-');
    expect(container.querySelector('[data-peer-probe-card]')).not.toBeNull();
    for (const module of ['header', 'signal', 'sync', 'facts']) {
      expect(container.querySelector(`[data-peer-probe-module="${module}"]`)).not.toBeNull();
    }
  });

  it('exposes the card as a labelled region and closes on demand', () => {
    const onClose = vi.fn();
    const { container, getByRole } = renderCard({ onClose });
    // The plates are named regions too; the card is the one that names the peer.
    expect(getByRole('region', { name: 'Peer QmPeerAl link probe' }))
      .toBe(container.querySelector('[data-peer-probe-card]'));
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-peer-probe-layout="left"]')).not.toBeNull();
  });

  it('wears the scene violet when the peer disagrees on version', () => {
    const { container } = renderCard({ peer: peer({ version: '0.114.0' }) });
    const blip = container.querySelector('[data-peer-probe-blip]');
    expect(blip?.getAttribute('fill')).toBe(PEER_NETWORK_HEX.version);
  });
});
