import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Peer, PeerSightingRecord } from '@cknerv/types';
import PeerLinkCard from '../../../src/components/hud/PeerLinkCard';
import { NODE_SELF_ACCENT } from '../../../src/components/hud/NodeSelfCard';
import type { PeerSightingState } from '../../../src/components/hud/PeerSightingPlate';
import type { PeerMiningCandidacy } from '../../../src/derives/blockProducers.derive';
import { PEER_LATENCY_CAP_MS } from '../../../src/derives/peers.derive';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('draws US in the anchor colour wherever this card draws us', () => {
    // E5: our own node appears twice on this card — the compass centre and the
    // LOCAL rung of the sync ladder — and it is the same entity the NODE card
    // is a whole dossier of. All three used to disagree. One entity, one
    // colour, and it survives whatever the cell/peer cyan question settles on.
    // SVG keeps the hex on an attribute; jsdom rewrites an inline background
    // to `rgb(…)`. Compare on the channels, not the spelling.
    //
    // Read from `stroke` before `fill`, because the compass mark is a HOLE:
    // the anchor colour is its rim and the knockout is its middle. The claim
    // is unchanged — whatever paints the mark is the anchor's own edge — and
    // the test below is what says the mark is a hole in the first place.
    const channels = (paint: string): number[] => {
      const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(paint);
      if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
      const hex = paint.replace('#', '');
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    };

    const { container } = renderCard();
    const marks = Array.from(container.querySelectorAll('[data-peer-probe-self]'));
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      const painted = mark.getAttribute('stroke')
        ?? mark.getAttribute('fill')
        ?? (mark as HTMLElement).style.background;
      expect(channels(painted)).toEqual(channels(NODE_SELF_ACCENT));
    }
  });

  it('tells the two ends of a link apart while they share one hex', () => {
    // The compass is the one instrument on this card whose entire job is to
    // show two ends of a link, and on any OUTBOUND peer both ends resolve to
    // `#7DF9FF`: `NODE_SELF_ACCENT` is `CHAIN_ANCHOR_HEX.edge` and the blip is
    // `PEER_NETWORK_HEX.outbound`, byte for byte. The self dot was documented
    // as deliberately not a generic instrument cyan precisely so it would be
    // distinguishable, and against this peer it was not.
    //
    // Separating them in the palette is a ruling of its own and is deferred;
    // the cyan/teal corridor has no bright value left that does not read as
    // status green. So they are separated by FORM, the way `crit` escalates
    // when there is no louder red — and the form is the house's own: a hole
    // rather than a bead, which is what the status strip does to a marker that
    // has to be told apart from what it sits among.
    expect(NODE_SELF_ACCENT.toLowerCase())
      .toBe(PEER_NETWORK_HEX.outbound.toLowerCase());

    const { container } = renderCard();
    const self = container.querySelector('[data-peer-probe-self]')!;
    const blip = container.querySelector('[data-peer-probe-blip]')!;

    // A mark is a BEAD when its body is painted and a HOLE when its body is
    // the ground and only its rim is. Stated as the general question — do
    // these two differ in anything a reader can see — so the day the palette
    // ruling lands and the hexes separate, this keeps holding without being
    // rewritten, and the day somebody flattens the form back it goes red.
    const body = (mark: Element): string => mark.getAttribute('fill') ?? '';
    const rim = (mark: Element): string => mark.getAttribute('stroke') ?? '';
    const solid = (mark: Element): boolean => {
      const painted = body(mark);
      return painted !== '' && painted !== 'none'
        && painted.toLowerCase() !== HUD_COLORS.ground.toLowerCase();
    };

    expect(body(self).toLowerCase() === body(blip).toLowerCase()
      && solid(self) === solid(blip))
      .toBe(false);

    // …and what the difference IS today, so a reader of this file can picture
    // the instrument: we are a ring around the ground, they are a filled disc.
    expect(solid(self)).toBe(false);
    expect(solid(blip)).toBe(true);
    expect(body(self).toLowerCase()).toBe(HUD_COLORS.ground.toLowerCase());
    expect(rim(self)).toBe(NODE_SELF_ACCENT);
    expect(body(blip)).toBe(PEER_NETWORK_HEX.outbound);
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

  it('resolves and arms every fact on the first frame, with no clock to wait on', () => {
    const onFacetChange = vi.fn();
    const { container } = renderCard({ onFacetChange });
    const facts = Array.from(container.querySelectorAll('[data-peer-probe-fact]'));
    expect(facts).toHaveLength(6);
    for (const fact of facts) {
      const facet = fact.getAttribute('data-peer-probe-fact') ?? '';
      expect(fact.getAttribute('data-peer-probe-fact-state'), facet).toBe('resolved');
      expect(fact.hasAttribute('disabled'), facet).toBe(false);
      // The value carries its own title from the start — a hover on a
      // truncated address never has to wait for a walk to reach it.
      const value = fact.lastElementChild as HTMLElement;
      expect(value.getAttribute('title'), facet).toBe(value.textContent);
      expect(value.textContent, facet).not.toBe('');
    }
    // No timer advanced: the poll that opened the card already held these.
    fireEvent.click(container.querySelector('[data-peer-probe-fact="addr"]')!);
    expect(onFacetChange).toHaveBeenLastCalledWith('addr');
  });

  it('claims no scan state and counts no progress in the plate header', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-peer-probe-scan-state]')).toBeNull();
    expect(container.querySelector('[data-peer-probe-scan-progress]')).toBeNull();
    expect(container.querySelector('[data-peer-probe-fact-state="scanning"]')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toContain('SCANNING');
    expect(text).toContain('LINK·04');
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

/** The crawler's account of the same node, as the App hands it down. */
function sighting(overrides: Partial<PeerSightingRecord> = {}): PeerSightingState {
  return {
    phase: 'ready',
    record: {
      source: 'ckbadger',
      as_of: { block: TIP, hash: '0xanchor' },
      updated_at_ms: Date.now(),
      node_id: 'QmPeerAlpha0123456789',
      country: 'DE',
      asn: 'AS24940 Hetzner Online GmbH',
      client_version: LOCAL_VERSION,
      protocols: ['/ckb/syn'],
      first_seen_ms: Date.now() - 400 * 86_400_000,
      last_seen_ms: Date.now() - 60_000,
      last_reachable_at_ms: Date.now() - 60_000,
      reachable: true,
      rtt_ms: 41,
      advertiser_peer_count: 45,
      advertised_address_count: 5_727,
      ...overrides,
    },
  };
}

describe('PeerLinkCard dossier', () => {
  it('carries no dossier plate when the source cannot offer one', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-sighting-plate]')).toBeNull();
    expect(container.textContent).not.toContain('DOSSIER');
  });

  it('hangs the dossier below the line facts as the fifth module', () => {
    const { container } = renderCard({ sighting: sighting() });
    const modules = Array.from(container.querySelectorAll('[data-peer-probe-module],[data-sighting-plate]'))
      .map((node) => node.getAttribute('data-peer-probe-module') ?? 'dossier');
    expect(modules).toEqual(['header', 'signal', 'sync', 'facts', 'dossier']);
    expect(container.textContent).toContain('LINK·05');
    // The card's own live readings are the other half of the cross-check.
    expect(container.querySelector('[data-sighting-row="identify"]')?.textContent)
      .toContain('AGREES WITH THE LIVE RPC VERSION');
    expect(container.querySelector('[data-sighting-row="exposure"]')?.textContent)
      .toContain('OUR PING 84 MS');
  });

  it('ages the crawler stamp on the same 1 Hz tick as the link', () => {
    vi.useFakeTimers();
    const { container } = renderCard({ sighting: sighting() });
    const stamp = () => container.querySelector('[data-sighting-stamp]')?.textContent;
    expect(stamp()).toBe('SIGHTED 1m 0s AGO');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(stamp()).toBe('SIGHTED 2m 0s AGO');
  });

  it('keeps the dossier through the link\'s ending', () => {
    // The connection dropped; the node it reached did not stop existing, and
    // neither did the crawler's account of it.
    const { container } = renderCard({ linkLost: true, sighting: sighting() });
    expect(container.querySelector('[data-sighting-plate]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="whereabouts"]')?.textContent)
      .toContain('DE');
  });

  it('prints the crawler\'s silence rather than dropping the plate', () => {
    const { container } = renderCard({
      sighting: { phase: 'unsighted', record: null, reason: 'no_crawler' },
    });
    expect(container.textContent).toContain('NO CRAWLER ON SOURCE');
  });
});

describe('PeerLinkCard mining stamp', () => {
  function candidacy(oneOf: number): PeerMiningCandidacy {
    return {
      role: 'candidate',
      oneOf,
      version: LOCAL_VERSION,
      producerKeys: [`0x${'ab'.repeat(32)}`],
    };
  }

  it('asks whether this peer stands inside a mining cohort, and never answers', () => {
    const { container } = renderCard({ candidacy: candidacy(6) });
    const stamp = container.querySelector('[data-mining-candidacy]');
    // ⭐ §9.2. This card holds a live link to a real, named machine — which is
    // exactly why it is the most dangerous surface in the HUD to let state
    // anything about mining. The join behind the stamp is two self-declared
    // strings meeting; it narrows a set and never names a member.
    expect(stamp?.textContent).toBe('IN A MINING COHORT? · 1 OF 6 ON THIS BUILD');
    // ⭐⭐ `IN`, NEVER `IS`. A cohort is the set of machines one payout identity
    // stands for; this peer is one machine. Asking whether it IS the cohort is
    // a category error on top of a claim the fan could never support.
    expect(stamp?.textContent).not.toContain('MINER');
    expect(stamp?.getAttribute('data-mining-candidacy')).toBe('6');
  });

  it('says nothing at all about mining for a peer in no drawn fan', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-mining-candidacy]')).toBeNull();
    expect(container.textContent).not.toContain('COHORT');
    expect(container.textContent).not.toContain('MINER');
  });

  it('stands in the masthead rather than among the link readings', () => {
    // The same slot `NodeSelfCard` stamps the role it can actually MEASURE.
    // Not in LINE FACTS: those are readings off this connection, and nothing
    // about a connection says anything about mining — the join that produced
    // this sentence never touched the wire.
    const { container } = renderCard({ candidacy: candidacy(4) });
    expect(container.querySelector('[data-peer-probe-module="header"] [data-mining-candidacy]'))
      .not.toBeNull();
    expect(container.querySelector('[data-peer-probe-module="facts"] [data-mining-candidacy]'))
      .toBeNull();
  });

  it('survives the link\'s ending, because it was never about the link', () => {
    const { container } = renderCard({ linkLost: true, candidacy: candidacy(3) });
    expect(container.querySelector('[data-mining-candidacy]')?.textContent)
      .toBe('IN A MINING COHORT? · 1 OF 3 ON THIS BUILD');
  });
});
